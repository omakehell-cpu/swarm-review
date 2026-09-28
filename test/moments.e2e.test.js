// Pins on the story's calendar inside a chapter: dropped on a paragraph,
// kept on it through edits, and on the timeline as moments of the chapter.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart } = require('./helpers/app');
const { paragraphsOf, locateMark } = require('../lib/moments');

let app;
let models;
let ana;
let luis;
let storyId;
let chapterId;
const PASSWORD = 'a long enough password';
const TEXT = [
  'They reached the gate at dusk.',
  '',
  'By morning the walls were manned.',
  '',
  '---',
  '',
  'Ten years earlier, Kessler had built those walls herself.',
  '',
  'Now she watched them hold.',
].join('\n');

const save = (client, rows, extra = []) => client.request(`/chapters/${chapterId}/moments`, {
  method: 'POST',
  ...form([...rows.flatMap((r) => [['anchor', r.anchor], ['offset', String(r.offset)], ['when', r.when || ''], ['day', r.day || '']]), ...extra]),
});
const rowsWith = (days) => paragraphsOf(models.getLatestVersion(chapterId).content)
  .map((p, i) => ({ anchor: p.anchor, offset: p.offset, ...(days[i] || {}) }));

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');
  ana = makeClient(app.base);
  await ana.request('/register', { method: 'POST', ...form([['username', 'ana'], ['displayName', 'Ana'], ['password', PASSWORD], ['inviteCode', models.getActiveInviteCode().code]]) });
  await ana.login('ana', PASSWORD);
  models.createUser({ username: 'luis', displayName: 'Luis', passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  luis = makeClient(app.base);
  await luis.login('luis', PASSWORD);
  await ana.request('/stories/new', { method: 'POST', ...multipart([['storyTitle', 'Siege'], ['chapterTitle', 'The gate'], ['content', TEXT]]) });
  storyId = models.listStories()[0].id;
  chapterId = models.listChaptersForStory(storyId)[0].id;
  const { db } = require('../models/shared');
  db.prepare("UPDATE chapters SET story_day = 100, story_when = 'Day 100' WHERE id = ?").run(chapterId);
});
test.after(() => app.stop());

test('a chapter\'s paragraphs are found, and a pin finds its paragraph again', () => {
  const ps = paragraphsOf(TEXT);
  assert.deepStrictEqual(ps.map((p) => p.text.slice(0, 8)), ['They rea', 'By morni', 'Ten year', 'Now she ']);
  const mark = { anchor_text: ps[2].anchor, anchor_offset: ps[2].offset };
  const edited = `A new opening line.\n\n${TEXT}`;
  assert.strictEqual(locateMark(mark, paragraphsOf(edited)).text.slice(0, 8), 'Ten year', 'after an edit above it');
  assert.strictEqual(locateMark(mark, paragraphsOf(TEXT.replace('Ten years earlier', 'Long before'))), null, 'but not once its words are gone');
});

test('only the chapter\'s writer (or the story owner) pins moments in it', async () => {
  assert.strictEqual((await luis.request(`/chapters/${chapterId}/moments`)).status, 403);
  assert.strictEqual((await save(luis, rowsWith([]))).status, 403);
  const page = await (await ana.request(`/chapters/${chapterId}/moments`)).text();
  assert.match(page, /When things happen in this chapter/);
  assert.match(page, /Day 100/);
});

test('pins are saved on their paragraphs, and a day counts from the row above', async () => {
  // Next morning (+1 from the chapter's day 100), then a flashback ten years back.
  const res = await save(ana, rowsWith({ 1: { when: 'Next morning', day: '+1' }, 2: { when: 'Ten years before', day: '-3650' } }));
  assert.strictEqual(res.status, 302);
  const { paragraphs } = models.chapterMoments(chapterId);
  assert.deepStrictEqual(paragraphs.map((p) => (p.mark ? p.mark.story_day : null)), [null, 101, -3549, null]);
});

test('the timeline shows the pins as moments of the chapter, and the flashback as told out of order', async () => {
  const t = models.storyTimeline(storyId);
  const marks = t.placed.filter((i) => i.kind === 'mark');
  assert.strictEqual(marks.length, 2);
  assert.strictEqual(t.moments, 2);
  assert.strictEqual(t.dated, 1, 'a pin is not a chapter of its own');
  assert.ok(marks.find((m) => m.day === -3549).outOfOrder, 'ten years back, halfway through the chapter');
  const html = await (await ana.request(`/stories/${storyId}/timeline`)).text();
  assert.match(html, /The gate, from “By morning the walls were manned\.”/);
  assert.match(html, new RegExp(`href="/chapters/${chapterId}/moments"`), 'the dates form links to the pins');
  // Nobody reading the timeline is shown anything they could not see before.
  assert.strictEqual((await luis.request(`/stories/${storyId}/timeline`)).status, 200);
});

test('a pin whose paragraph is rewritten away is kept until it is taken off', async () => {
  const v = models.getLatestVersion(chapterId);
  models.editChapter({ chapterId, title: 'The gate', content: v.content.replace('By morning the walls', 'At first light the walls') });
  const { lost } = models.chapterMoments(chapterId);
  assert.strictEqual(lost.length, 1);
  const page = await (await ana.request(`/chapters/${chapterId}/moments`)).text();
  assert.match(page, /Pins whose paragraph has changed/);
  // Saving the page without ticking it keeps it; ticking it takes it off.
  const existing = models.chapterMoments(chapterId).paragraphs.map((p) => ({ anchor: p.anchor, offset: p.offset, when: p.mark ? p.mark.story_when : '', day: p.mark ? String(p.mark.story_day) : '' }));
  await save(ana, existing);
  assert.strictEqual(models.chapterMoments(chapterId).lost.length, 1);
  await save(ana, existing, [['removeLost', String(lost[0].id)]]);
  assert.strictEqual(models.chapterMoments(chapterId).lost.length, 0);
  assert.strictEqual(models.chapterMoments(chapterId).paragraphs.filter((p) => p.mark).length, 1, 'and the other pin is untouched');
});
