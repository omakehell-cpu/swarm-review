// The story's timeline: events that last, and what ties things together.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { startApp, makeClient, form, multipart } = require('./helpers/app');

const PASSWORD = 'a long enough password';
let app;
let models;
let ana;
let storyId;
const ids = {};

test.before(async () => {
  app = await startApp();
  models = app.models;
  ana = makeClient(app.base);
  await ana.request('/register', { method: 'POST', ...form([['username', 'ana'], ['displayName', 'Ana'], ['password', PASSWORD], ['inviteCode', models.getActiveInviteCode().code]]) });
  await ana.login('ana', PASSWORD);
  await ana.request('/stories/new', { method: 'POST', ...multipart([['storyTitle', 'Siege'], ['storyDescription', ''], ['chapterTitle', 'One'], ['chapterSummary', ''], ['content', 'The Blackout came first. Mara Kessler saw it.']]) });
  storyId = models.listStories().find((s) => s.title === 'Siege').id;
  const chapter = models.listChaptersForStory(storyId)[0];
  const { db } = require('../models/shared');
  db.prepare('UPDATE chapters SET story_day = 1 WHERE id = ?').run(chapter.id);
  ids.chapter = chapter.id;
  const make = async (fields) => {
    const res = await ana.request(`/stories/${storyId}/bible`, { method: 'POST', ...form(fields) });
    return Number(res.headers.get('location').split('/').pop().split('?')[0]);
  };
  ids.blackout = await make([['name', 'The Blackout'], ['kind', 'event'], ['storyDay', '1']]);
  ids.siege = await make([['name', 'Siege of Kestrel'], ['kind', 'event'], ['storyDay', '5'], ['storyDayEnd', '20']]);
  ids.mara = await make([['name', 'Mara Kessler'], ['kind', 'person'], ['storyDay', '0']]);
  ids.later = await make([['name', 'The Reckoning'], ['kind', 'event']]);
  await ana.request(`/bible/${ids.blackout}/links`, { method: 'POST', ...form([['to', String(ids.siege)], ['label', 'leads to'], ['reverse_label', 'caused by']]) });
  await ana.request(`/bible/${ids.mara}/links`, { method: 'POST', ...form([['to', String(ids.siege)], ['label', 'fought in']]) });
});
test.after(() => app && app.stop());

test('an event can last, and an end before its start is no end', () => {
  assert.strictEqual(models.getStoryEntity(ids.siege).story_day_end, 20);
  const bad = models.createStoryEntity({ storyId, name: 'Backwards', kind: 'event', storyDay: 9, storyDayEnd: 3, createdBy: null });
  assert.strictEqual(models.getStoryEntity(bad.id).story_day_end, null);
  models.deleteStoryEntity(bad.id);
});

test('the timeline knows what ties things together', () => {
  const t = models.storyTimeline(storyId);
  const siege = t.placed.find((i) => i.key === `e${ids.siege}`);
  assert.strictEqual(siege.end, 20);
  assert.deepStrictEqual(siege.related.map((r) => [r.name, r.label]).sort(), [['Mara Kessler', 'fought in'], ['The Blackout', 'caused by']]);
  assert.ok(t.links.some((l) => l.from === `e${ids.blackout}` && l.to === `e${ids.siege}` && l.label === 'leads to'));
  assert.ok(t.links.some((l) => l.type === 'told' && l.from === `e${ids.blackout}` && l.to === `c${ids.chapter}`), 'the chapter that names it');
  assert.ok(t.undated.some((i) => i.key === `e${ids.later}`), 'an event with no day is waiting for one');
  assert.strictEqual(t.span.to, 20, 'the span runs to the end of what lasts');
});

test('the page draws it, and an event says where it sits', async () => {
  const grid = await (await ana.request(`/stories/${storyId}/timeline`)).text();
  assert.match(grid, /class="tg"/, 'the grid is the first view');
  assert.match(grid, /class="tg-event"[^>]*>The Blackout/);
  const chronicle = await (await ana.request(`/stories/${storyId}/timeline?view=chronicle`)).text();
  assert.match(chronicle, /lasts 16 days, to day 20/);
  assert.match(chronicle, /<span class="chron-day-num">5<\/span>/);
  assert.match(chronicle, /Not on the line yet[\s\S]*The Reckoning/);
  const dates = await (await ana.request(`/stories/${storyId}/timeline?view=dates`)).text();
  assert.match(dates, /src="\/js\/timeline-dates\.js"/);
  const entry = await (await ana.request(`/bible/${ids.siege}`)).text();
  assert.match(entry, /On the timeline/);
  assert.match(entry, /Day 5&ndash;20/);
  assert.match(entry, new RegExp(`Before it</span> <a href="/bible/${ids.blackout}">`));
  assert.match(entry, /list="relation-words"/);
});

test('the whole story is dated from one table, counting from the row above', async () => {
  const res = await ana.request(`/stories/${storyId}/timeline`, {
    method: 'POST',
    ...form([['key', `c${ids.chapter}`], ['when', 'The first night'], ['day', '3'], ['end', ''],
      ['key', `e${ids.blackout}`], ['when', ''], ['day', '3'], ['end', ''],
      ['key', `e${ids.later}`], ['when', 'Much later'], ['day', '+40'], ['end', '+50']]),
  });
  assert.strictEqual(res.status, 302);
  assert.match(decodeURIComponent(res.headers.get('location')), /3 dates saved\./);
  assert.strictEqual(models.getChapterById(ids.chapter).story_day, 3);
  assert.strictEqual(models.getChapterById(ids.chapter).story_when, 'The first night');
  assert.strictEqual(models.getStoryEntity(ids.later).story_day, 43, '+40 from the row above');

  const one = await ana.request(`/stories/${storyId}/timeline`, {
    method: 'POST', contentType: 'application/json', body: JSON.stringify({ key: `c${ids.chapter}`, when: 'The first night', day: '1', end: '' }),
  });
  assert.deepStrictEqual(await one.json(), { day: 1, saved: true });
  assert.strictEqual(models.getChapterById(ids.chapter).story_day, 1);
});

test('eras name stretches of time, and the chronicle is read in them', async () => {
  const add = await ana.request(`/stories/${storyId}/timeline/eras`, { method: 'POST', ...form([['title', 'The siege'], ['fromDay', '5']]) });
  assert.strictEqual(add.status, 302);
  const clash = await ana.request(`/stories/${storyId}/timeline/eras`, { method: 'POST', ...form([['title', 'Again'], ['fromDay', '5']]) });
  assert.strictEqual(clash.status, 400);
  const era = models.storyEras(storyId)[0];
  const page = await (await ana.request(`/stories/${storyId}/timeline?view=chronicle`)).text();
  assert.match(page, new RegExp(`id="era-${era.id}">The siege <span class="muted">from day 5`));
  const happens = await (await ana.request(`/stories/${storyId}/timeline?view=grid&order=happens`)).text();
  assert.match(happens, /class="tg-eras"/);
  await ana.request(`/timeline/eras/${era.id}`, { method: 'POST', ...form([['title', 'The long siege'], ['fromDay', '4']]) });
  assert.strictEqual(models.getEra(era.id).title, 'The long siege');
  await ana.request(`/timeline/eras/${era.id}/delete`, { method: 'POST', ...form([]) });
  assert.strictEqual(models.getEra(era.id), null);
});

test('only the people who write the story date it', async () => {
  const auth = require('../auth');
  models.createUser({ username: 'reader', displayName: 'Reader', passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  const reader = makeClient(app.base);
  await reader.login('reader', PASSWORD);
  const page = await (await reader.request(`/stories/${storyId}/timeline`)).text();
  assert.ok(!page.includes('view=dates'), 'no Dates tab');
  const res = await reader.request(`/stories/${storyId}/timeline`, { method: 'POST', ...form([['key', `c${ids.chapter}`], ['day', '99']]) });
  assert.strictEqual(res.status, 403);
  assert.notStrictEqual(models.getChapterById(ids.chapter).story_day, 99);
});
