// A person's character study, against the real server: asked on the entry
// form, answered on the entry page, and for the people who write the story
// only.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart } = require('./helpers/app');

let app;
let models;
let owner;
let reader;
let storyId;
const PASSWORD = 'a long enough password';

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');
  const invite = models.getActiveInviteCode();
  owner = makeClient(app.base);
  await owner.request('/register', {
    method: 'POST',
    ...form([['username', 'ana'], ['displayName', 'Ana'], ['password', PASSWORD], ['inviteCode', invite.code]]),
  });
  await owner.login('ana', PASSWORD);
  models.createUser({ username: 'marta', displayName: 'Marta', passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  reader = makeClient(app.base);
  await reader.login('marta', PASSWORD);
  await owner.request('/stories/new', {
    method: 'POST',
    ...multipart([['storyTitle', 'Studied'], ['storyDescription', ''], ['chapterTitle', 'One'], ['chapterSummary', ''], ['content', 'Mara Kessler walked in. Prado did not.']]),
  });
  storyId = models.listStories().find((s) => s.title === 'Studied').id;
});

test.after(() => app.stop());

const addEntry = (pairs) => owner.request(`/stories/${storyId}/bible`, { method: 'POST', ...form(pairs) });

test('a person has a character study the writers see and the readers do not', async () => {
  const blank = await (await owner.request(`/stories/${storyId}/bible/new`)).text();
  assert.match(blank, /<legend>Character study<\/legend>/);
  assert.match(blank, /name="study_need"/);

  const made = await addEntry([['name', 'Mara Kessler'], ['kind', 'person'], ['role', 'main'],
    ['study_want', 'To be left alone.'], ['study_change', 'She lets somebody in.']]);
  const url = made.headers.get('location');
  assert.match(url, /^\/bible\/\d+$/);

  const page = await (await owner.request(url)).text();
  assert.match(page, /To be left alone\./);
  assert.match(page, /Not asked yet: what they need, what they fear, how they talk\./);

  const edit = await (await owner.request(`${url}/edit`)).text();
  assert.match(edit, /name="study_change"[^>]*>She lets somebody in\.<\/textarea>/);

  const seen = await (await reader.request(url)).text();
  assert.ok(!seen.includes('To be left alone.'), 'a reader never sees the study');
  assert.ok(!seen.includes('Character study'));
});

test('a place has no study, and the glossary nudges about main characters without one', async () => {
  const place = await addEntry([['name', 'Anchorage'], ['kind', 'place'], ['study_want', 'ignored']]);
  const placeId = Number(place.headers.get('location').split('/').pop());
  assert.deepStrictEqual(models.getCharacterStudy(placeId).want, '');
  await addEntry([['name', 'Prado'], ['kind', 'person'], ['role', 'main']]);

  const glossary = await (await owner.request(`/stories/${storyId}/bible`)).text();
  assert.match(glossary, /No character study yet<\/strong> for <a href="\/bible\/\d+\/edit#study">Prado<\/a>\./);
  assert.ok(!(await (await reader.request(`/stories/${storyId}/bible`)).text()).includes('No character study yet'));
});

test('merging two people keeps what only one of them answered', async () => {
  const a = models.getStoryEntityByName(storyId, 'Prado');
  const b = models.getStoryEntityByName(storyId, 'Mara Kessler');
  models.setCharacterStudy(a.id, { fear: 'Water.' });
  models.mergeStoryEntities(a.id, b.id, null);
  const merged = models.getCharacterStudy(b.id);
  assert.strictEqual(merged.want, 'To be left alone.');
  assert.strictEqual(merged.fear, 'Water.');
});

test('the writing checks are saved to the account, and only as switches', async () => {
  const saved = await owner.request('/account/writing-settings', {
    method: 'POST', body: JSON.stringify({ 'quiet-dialogue': true, adverb: false, evil: '<script>', 'x"><b': true }),
    contentType: 'application/json',
  });
  assert.strictEqual(saved.status, 200);
  const page = await (await owner.request(`/stories/${storyId}`)).text();
  assert.match(page, /<meta name="writing-settings" content="\{&quot;quiet-dialogue&quot;:true,&quot;adverb&quot;:false\}">/);
});
