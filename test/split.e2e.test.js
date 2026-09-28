// Moving a chapter boundary, against the real server: a chapter cut in two
// takes the notes on its second half with it, a merge brings them back,
// and neither loses a word or a version.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart } = require('./helpers/app');

let app;
let models;
let ana;
let luis;
let storyId;

const PASSWORD = 'a long enough password';
const TEXT = [
  'The station had been dying for twelve years, and nobody said so out loud.',
  '',
  'Kessler came up the service spine at 04:20, boots ringing on the *grating*.',
  '',
  '---',
  '',
  'Prado was waiting at the lock with the **Kestrel** manifest in one hand.',
  '',
  'Nobody had said so out loud there either.',
].join('\n');

const { flatOf } = require('../lib/suggestions');
const chapters = () => models.listChaptersForStory(storyId);
const latestOf = (id) => models.getLatestVersion(id);
const noteOn = async (client, chapterId, quote, body) => {
  const v = latestOf(chapterId);
  const start = flatOf(v.content).indexOf(quote);
  assert.ok(start >= 0, `"${quote}" is in the chapter`);
  const res = await client.request(`/chapters/${chapterId}/comments`, {
    method: 'POST',
    ...form([['versionId', String(v.id)], ['start', String(start)], ['end', String(start + quote.length)], ['quoted', quote], ['body', body]]),
  });
  assert.ok(res.status < 400, `the note "${body}" was left`);
};
const notesOn = (chapterId) => models.listCommentsForVersion(latestOf(chapterId).id).filter((c) => c.parent_id == null);
const quoteOf = (chapterId, note) => flatOf(latestOf(chapterId).content).slice(note.start_offset, note.end_offset);

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
  await ana.request('/stories/new', { method: 'POST', ...multipart([['storyTitle', 'Anchorage'], ['chapterTitle', 'The long watch'], ['content', TEXT]]) });
  storyId = models.listStories()[0].id;
  await ana.request(`/stories/${storyId}/chapters/new`, { method: 'POST', ...multipart([['title', 'Afterwards'], ['summary', ''], ['content', 'The last chapter.']]) });
});
test.after(() => app.stop());

test('the places a chapter can be cut are the starts of its paragraphs', () => {
  const points = Array.from(models.splitPoints(TEXT));
  assert.deepStrictEqual(points.map((p) => p.text.slice(0, 7)), ['Kessler', '---', 'Prado w', 'Nobody ']);
  assert.ok(points[1].isBreak, 'a scene break is offered as one');
  assert.deepStrictEqual(Array.from(models.splitPoints('One paragraph only.')), []);
});

test('only the chapter author sees the page or can cut', async () => {
  const [first] = chapters();
  assert.strictEqual((await luis.request(`/chapters/${first.id}/split`)).status, 403);
  const refused = await luis.request(`/chapters/${first.id}/split`, { method: 'POST', ...form([['at', '10'], ['title', 'x']]) });
  assert.strictEqual(refused.status, 403);
  const page = await (await ana.request(`/chapters/${first.id}/split`)).text();
  assert.match(page, /Split it in two/);
  assert.match(page, /Merge the next chapter into it/);
  const chapterPage = await (await ana.request(`/chapters/${first.id}`)).text();
  assert.match(chapterPage, new RegExp(`href="/chapters/${first.id}/split"`), 'it is offered from the chapter');
});

test('a chapter split at a scene break becomes two, and the notes go with their words', async () => {
  const [first, last] = chapters();
  await noteOn(luis, first.id, 'twelve years', 'How long exactly?');
  await noteOn(luis, first.id, 'Kestrel', 'Which ship is this?');
  await noteOn(luis, first.id, 'said so out loud there', 'Echo of the opening -- on purpose?');
  // Luis read it, so he has read both halves.
  await luis.request(`/chapters/${first.id}`);
  const before = latestOf(first.id);
  const breakAt = models.splitPoints(before.content).find((p) => p.isBreak).at;

  const res = await ana.request(`/chapters/${first.id}/split`, { method: 'POST', ...form([['at', String(breakAt)], ['title', 'At the lock']]) });
  assert.strictEqual(res.status, 302);
  const [one, two, three] = chapters();
  assert.strictEqual(one.id, first.id);
  assert.strictEqual(two.title, 'At the lock');
  assert.strictEqual(two.chapter_number, first.chapter_number + 1);
  assert.strictEqual(three.id, last.id, 'the chapter after moved down one');
  assert.match(res.headers.get('location'), new RegExp(`^/chapters/${two.id}\\?notice=`));

  const head = latestOf(one.id).content;
  const tail = latestOf(two.id).content;
  assert.ok(head.endsWith('the *grating*.'), 'the first keeps the first half');
  assert.ok(tail.startsWith('Prado was waiting'), 'the scene break is the boundary now, not the new first line');
  assert.strictEqual(latestOf(one.id).version_number, before.version_number + 1, 'a new version, not a rewrite');
  assert.strictEqual(models.getVersion(before.id).content, TEXT, 'and the whole chapter is still in its history');

  const firstNotes = notesOn(one.id);
  assert.deepStrictEqual(firstNotes.map((n) => quoteOf(one.id, n)), ['twelve years']);
  const secondNotes = notesOn(two.id);
  assert.deepStrictEqual(secondNotes.map((n) => quoteOf(two.id, n)).sort(), ['Kestrel', 'said so out loud there'],
    'the notes on the second half are on the same words in the new chapter');

  const luisUser = models.getUserByUsername('luis');
  assert.ok(!models.chaptersNewToMe(luisUser.id, 50).some((c) => c.id === two.id), 'somebody who read it is not told it is new');
});

test('a split is refused while unpublished writing is waiting in the editor', async () => {
  const [one] = chapters();
  const v = latestOf(one.id);
  await ana.request(`/chapters/${one.id}/draft`, { method: 'POST', ...form([['content', `${v.content}\n\nStill writing this bit.`], ['title', one.title], ['baseVersion', String(v.version_number)]]) });
  const page = await (await ana.request(`/chapters/${one.id}/split`)).text();
  assert.match(page, /not published yet/);
  const at = models.splitPoints(v.content)[0].at;
  const res = await ana.request(`/chapters/${one.id}/split`, { method: 'POST', ...form([['at', String(at)], ['title', 'Nope']]) });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(chapters().length, 3, 'nothing was cut');
  models.discardDraft(one.id, models.getUserByUsername('ana').id);
});

test('merging folds the next chapter back in, notes and all, and archives it', async () => {
  const [one, two] = chapters();
  const res = await ana.request(`/chapters/${one.id}/merge`, { method: 'POST', ...form([]) });
  assert.strictEqual(res.status, 302);
  const now = chapters();
  assert.strictEqual(now.length, 2, 'the merged chapter is out of the story');
  assert.deepStrictEqual(now.map((c) => c.chapter_number), [1, 2], 'and the numbering has no hole in it');
  assert.strictEqual(models.getChapterById(two.id).archived_at !== null, true, 'archived, not deleted');
  const text = latestOf(one.id).content;
  assert.ok(text.includes('the *grating*.') && text.includes('Prado was waiting'), 'both halves are in it');
  assert.deepStrictEqual(notesOn(one.id).map((n) => quoteOf(one.id, n)).sort(), ['Kestrel', 'said so out loud there', 'twelve years'],
    'every waiting note is back on its words');
});

test('an arc that opened on a merged chapter opens on the one after it', async () => {
  const { db } = require('../models/shared');
  await ana.request(`/stories/${storyId}/chapters/new`, { method: 'POST', ...multipart([['title', 'Book two opens'], ['summary', ''], ['content', 'Book two.']]) });
  await ana.request(`/stories/${storyId}/chapters/new`, { method: 'POST', ...multipart([['title', 'Book two goes on'], ['summary', ''], ['content', 'More.']]) });
  const list = chapters();
  const [before, opener, after] = list.slice(-3);
  db.prepare("UPDATE chapters SET arc_title = 'Book Two' WHERE id = ?").run(opener.id);
  const res = await ana.request(`/chapters/${before.id}/merge`, { method: 'POST', ...form([]) });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(models.getChapterById(after.id).arc_title, 'Book Two');
});

test('a chapter cannot be merged with somebody else\'s', async () => {
  models.addStoryCoauthor(storyId, models.getUserByUsername('luis').id, models.getUserByUsername('ana').id);
  await luis.request(`/stories/${storyId}/chapters/new`, { method: 'POST', ...multipart([['title', 'Luis writes'], ['summary', ''], ['content', 'His chapter.']]) });
  const list = chapters();
  const beforeLuis = list[list.length - 2];
  assert.strictEqual(beforeLuis.author_id, models.getUserByUsername('ana').id);
  const res = await ana.request(`/chapters/${beforeLuis.id}/merge`, { method: 'POST', ...form([]) });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(chapters().length, list.length);
  const page = await (await ana.request(`/chapters/${beforeLuis.id}/split`)).text();
  assert.match(page, /written by somebody else/);
});
