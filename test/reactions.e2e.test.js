// Reactions: a reader's one-tap "how this paragraph read", and the
// author's heat map of them (models/reactions.js, public/js/reactions.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart } = require('./helpers/app');

let app;
let models;
let ana;
let luis;
let marta;
let chapterId;
let versionId;
const PASSWORD = 'a long enough password';

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');
  const invite = models.getActiveInviteCode();
  ana = makeClient(app.base);
  await ana.request('/register', {
    method: 'POST', ...form([['username', 'ana'], ['displayName', 'Ana'], ['password', PASSWORD], ['inviteCode', invite.code]]),
  });
  await ana.login('ana', PASSWORD);
  for (const u of ['luis', 'marta']) {
    models.createUser({ username: u, displayName: u, passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  }
  luis = makeClient(app.base); await luis.login('luis', PASSWORD);
  marta = makeClient(app.base); await marta.login('marta', PASSWORD);
  await ana.request('/stories/new', {
    method: 'POST', ...multipart([['storyTitle', 'Anchorage'], ['chapterTitle', 'One'], ['content', 'First.\n\nSecond, the long one.\n\nThird.']]),
  });
  chapterId = models.listChaptersForStory(models.listStories()[0].id)[0].id;
  versionId = models.getLatestVersion(chapterId).id;
});

test.after(() => app.stop());

const react = (client, paragraph, kind, on = '1') => client.request(`/chapters/${chapterId}/react`, {
  method: 'POST', ...form([['versionId', String(versionId)], ['paragraph', String(paragraph)], ['kind', kind], ['on', on]]),
});

test('a reader reacts to a paragraph, and can take it back', async () => {
  assert.strictEqual((await react(luis, 2, 'lost')).status, 200);
  assert.strictEqual((await react(luis, 2, 'slow')).status, 200);
  assert.strictEqual((await react(luis, 3, 'hooked')).status, 200);
  assert.deepStrictEqual(models.myReactions(versionId, models.getUserByUsername('luis').id), { 2: ['lost', 'slow'], 3: ['hooked'] });
  await react(luis, 2, 'slow', '0');
  assert.deepStrictEqual(models.myReactions(versionId, models.getUserByUsername('luis').id)[2], ['lost']);
  // Only the four kinds, and only a real paragraph number.
  assert.strictEqual((await react(luis, 2, 'furious')).status, 400);
  assert.strictEqual((await react(luis, 0, 'lost')).status, 400);
  // The page gives the reader their own, and nobody else's.
  await react(marta, 2, 'lost');
  const page = await (await luis.request(`/chapters/${chapterId}`)).text();
  const data = JSON.parse(/<script type="application\/json" id="reactions-data">([^<]*)<\/script>/.exec(page)[1]);
  assert.strictEqual(data.mode, 'reader');
  assert.deepStrictEqual(data.mine, { 2: ['lost'], 3: ['hooked'] });
  assert.ok(!('map' in data), 'no totals for readers');
});

test('the author cannot react to their own chapter, and sees everybody added up', async () => {
  assert.strictEqual((await react(ana, 1, 'hooked')).status, 403);
  const page = await (await ana.request(`/chapters/${chapterId}`)).text();
  const data = JSON.parse(/<script type="application\/json" id="reactions-data">([^<]*)<\/script>/.exec(page)[1]);
  assert.strictEqual(data.mode, 'author');
  assert.strictEqual(data.map.readers, 2);
  assert.deepStrictEqual(data.map.byParagraph['2'], { lost: 2 });
  assert.match(page, /How it read, from 2 readers/);
  assert.match(page, /<strong>Lost me<\/strong> 2 &middot; <a href="#chapter-text" data-para="2">paragraph 2 \(2\)<\/a>/);
  assert.match(page, /src="\/js\/reactions\.js"/);
});
