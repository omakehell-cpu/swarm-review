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
  const html = await (await ana.request(`/stories/${storyId}/timeline`)).text();
  assert.match(html, /class="tl-chart"/);
  assert.match(html, /tl-item tl-item-event is-span/);
  assert.match(html, /class="tl-line tl-line-relation"/);
  assert.match(html, /<span class="tl-day">5&ndash;20<\/span>/);
  assert.match(html, /src="\/js\/timeline-chart\.js"/);
  const entry = await (await ana.request(`/bible/${ids.siege}`)).text();
  assert.match(entry, /On the timeline/);
  assert.match(entry, /Day 5&ndash;20/);
  assert.match(entry, new RegExp(`Before it</span> <a href="/bible/${ids.blackout}">`));
  assert.match(entry, /list="relation-words"/);
});
