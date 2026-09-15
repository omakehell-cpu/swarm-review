// The story bible, against the real server.
//
// The interesting half is not the CRUD -- it is that "which chapters is
// she in" is derived from the prose and stays right as the prose changes,
// and that a reader cannot rewrite somebody else's cast.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart } = require('./helpers/app');

let app;
/** @type {any} */
let models;
let owner;   // writes the story
let reader;  // can read it and nothing else
let storyId;
let chapterOne;
let chapterTwo;
let kesslerId;
let pradoId;

const PASSWORD = 'a long enough password';

const CH1 = 'Kessler came up through the spine at 04:20. Prado had left the hatch open again.\n\nThe Old Man said nothing, which was how Kessler knew.';
const CH2 = 'Prado signed the book nobody reads. Prado always did.';

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
    ...multipart([
      ['storyTitle', 'Home is where we are'],
      ['storyDescription', 'An anchorage nobody has decommissioned.'],
      ['chapterTitle', 'The long watch'],
      ['chapterSummary', ''],
      ['content', CH1],
    ]),
  });
  storyId = models.listStories().find((s) => s.title === 'Home is where we are').id;
  chapterOne = models.listChaptersForStory(storyId)[0].id;

  await owner.request(`/stories/${storyId}/chapters/new`, {
    method: 'POST',
    ...multipart([['title', 'Seals and signatures'], ['summary', ''], ['content', CH2]]),
  });
  chapterTwo = models.listChaptersForStory(storyId).find((c) => c.chapter_number === 2).id;
});

test.after(() => app.stop());

test('an empty bible says what it is for', async () => {
  const html = await (await owner.request(`/stories/${storyId}/bible`)).text();
  assert.match(html, /The bible is empty/);
  assert.match(html, /Add the first entry/);
});

test('an entry finds its own chapters the moment it is written down', async () => {
  const res = await owner.request(`/stories/${storyId}/bible`, {
    method: 'POST',
    ...form([
      ['name', 'Kessler'], ['kind', 'person'], ['aliases', 'the Old Man'],
      ['summary', 'Four hundred days on the anchorage.'], ['role', 'main'], ['status', 'alive'],
      ['description', 'She keeps the watch.'], ['secret', 'She is not going home.'],
    ]),
  });
  assert.strictEqual(res.status, 302);
  kesslerId = Number(res.headers.get('location').split('/').pop());

  // Nobody ticked a box: the two mentions of her name and the one of her
  // alias were read out of chapter one.
  const appearances = models.listEntityAppearances(kesslerId);
  assert.deepStrictEqual(appearances.map((a) => a.chapter_id), [chapterOne]);
  assert.strictEqual(appearances[0].mentions, 3);

  const html = await (await owner.request(`/bible/${kesslerId}`)).text();
  assert.match(html, /The long watch/);
  assert.match(html, /3 mentions/);
  assert.match(html, /She keeps the watch/);
  // The spoiler is on the page but folded, not a separate secret page.
  assert.match(html, /entity-secret/);
  assert.match(html, /She is not going home/);
});

test('a name the author writes down stops being a spelling mistake', () => {
  // The dictionary stores words folded down, the way the analyzer looks
  // them up.
  assert.ok(models.getStoryDictionary(storyId).includes('kessler'), 'the name joined the story dictionary');
  assert.ok(models.getStoryDictionary(storyId).includes('old'), 'and so did the words of the alias');
});

test('rewriting a chapter moves the cast with it', async () => {
  const create = await owner.request(`/stories/${storyId}/bible`, {
    method: 'POST',
    ...form([['name', 'Prado'], ['kind', 'person'], ['summary', 'Leaves the hatch open.']]),
  });
  pradoId = Number(create.headers.get('location').split('/').pop());
  assert.deepStrictEqual(
    models.listEntityAppearances(pradoId).map((a) => a.chapter_id), [chapterOne, chapterTwo]
  );

  // Take him out of chapter two and the appearance goes with him -- no
  // rescan button, no stale row.
  await owner.request(`/chapters/${chapterTwo}/edit`, {
    method: 'POST',
    ...multipart([
      ['title', 'Seals and signatures'], ['summary', ''],
      ['content', 'She signed the book nobody reads.'], ['changelog', 'took a name out'],
    ]),
  });
  assert.deepStrictEqual(
    models.listEntityAppearances(pradoId).map((a) => a.chapter_id), [chapterOne]
  );
});

test('the chapter page says who is in it', async () => {
  const html = await (await owner.request(`/chapters/${chapterOne}`)).text();
  assert.match(html, /In this chapter/);
  assert.match(html, new RegExp(`href="/bible/${kesslerId}"`));
  assert.match(html, new RegExp(`href="/bible/${pradoId}"`));
});

test('the author can overrule the scan, and the override outlives a rewrite', async () => {
  // Kessler is in chapter two in spirit -- nobody says her name.
  await owner.request(`/bible/${kesslerId}/appearances`, {
    method: 'POST', ...form([['chapter', String(chapterOne)], ['chapter', String(chapterTwo)]]),
  });
  let chapters = models.listEntityAppearances(kesslerId);
  assert.deepStrictEqual(chapters.map((a) => a.chapter_id), [chapterOne, chapterTwo]);
  assert.strictEqual(chapters.find((a) => a.chapter_id === chapterTwo).source, 'manual');

  // A rebuild throws the scan away and redoes it; the correction stays.
  models.rebuildStoryAppearances(storyId);
  assert.strictEqual(models.listEntityAppearances(kesslerId).length, 2);

  // And the other way: take her out of the chapter she is named in.
  await owner.request(`/bible/${kesslerId}/appearances`, {
    method: 'POST', ...form([['chapter', String(chapterTwo)]]),
  });
  chapters = models.listEntityAppearances(kesslerId);
  assert.deepStrictEqual(chapters.map((a) => a.chapter_id), [chapterTwo]);
});

test('a relation is written once and read from both ends', async () => {
  await owner.request(`/bible/${kesslerId}/links`, {
    method: 'POST',
    ...form([['to', String(pradoId)], ['label', 'keeps watch with'], ['reverse_label', 'keeps watch with']]),
  });
  const hers = await (await owner.request(`/bible/${kesslerId}`)).text();
  const his = await (await owner.request(`/bible/${pradoId}`)).text();
  assert.match(hers, /keeps watch with/);
  assert.match(hers, new RegExp(`href="/bible/${pradoId}"`));
  assert.match(his, /keeps watch with/);
  assert.match(his, new RegExp(`href="/bible/${kesslerId}"`));

  // Linking the same pair again edits the one relation instead of growing
  // a second, mirrored one the two pages would disagree about.
  await owner.request(`/bible/${pradoId}/links`, {
    method: 'POST', ...form([['to', String(kesslerId)], ['label', 'owes money to']]),
  });
  assert.strictEqual(models.listStoryEntityLinks(kesslerId).length, 1);
  assert.strictEqual(models.listStoryEntityLinks(pradoId)[0].label, 'owes money to');
});

test('two entries cannot share a name, and a shared alias is reported', async () => {
  const clash = await owner.request(`/stories/${storyId}/bible`, {
    method: 'POST', ...form([['name', 'kessler'], ['kind', 'person']]),
  });
  assert.strictEqual(clash.status, 400);
  assert.match(await clash.text(), /already in this bible/);

  await owner.request(`/bible/${pradoId}`, {
    method: 'POST',
    ...form([['name', 'Prado'], ['kind', 'person'], ['aliases', 'the Old Man'], ['summary', 'Leaves the hatch open.']]),
  });
  const conflicts = models.storyBibleNameConflicts(storyId);
  assert.deepStrictEqual(conflicts.map((c) => c.name), ['the old man']);
  const html = await (await owner.request(`/stories/${storyId}/bible`)).text();
  assert.match(html, /shared by more than one entry/);

  // Put it back the way it was, so the rest of the file reads a clean bible.
  await owner.request(`/bible/${pradoId}`, {
    method: 'POST', ...form([['name', 'Prado'], ['kind', 'person'], ['summary', 'Leaves the hatch open.']]),
  });
});

test('the index sorts by kind and filters without leaving the page', async () => {
  await owner.request(`/stories/${storyId}/bible`, {
    method: 'POST',
    ...form([['name', 'Kestrel Anchorage'], ['kind', 'place'], ['summary', 'A deep-space anchorage.']]),
  });
  const html = await (await owner.request(`/stories/${storyId}/bible`)).text();
  assert.match(html, /class="glossary-doors bible-doors"/);
  assert.match(html, /href="\/stories\/\d+\/bible\?kind=place"/);
  assert.match(html, /data-search="[^"]*kestrel anchorage/);

  const places = await (await owner.request(`/stories/${storyId}/bible?kind=place`)).text();
  assert.match(places, /Kestrel Anchorage/);
  assert.ok(!places.includes('>Kessler '), 'a person is not a place');

  // The no-JavaScript filter is the same filter.
  const filtered = await (await owner.request(`/stories/${storyId}/bible?q=anchorage`)).text();
  assert.match(filtered, /Kestrel Anchorage/);
  assert.ok(!filtered.includes('>Prado '), 'and it does narrow');
});

test('a reader reads the bible and cannot write in it', async () => {
  const read = await reader.request(`/bible/${kesslerId}`);
  assert.strictEqual(read.status, 200);
  const html = await read.text();
  assert.ok(!html.includes(`/bible/${kesslerId}/edit`), 'no edit button for somebody else\'s cast');

  const refusals = [
    { path: `/stories/${storyId}/bible`, fields: [['name', 'Interloper'], ['kind', 'person']] },
    { path: `/bible/${kesslerId}`, fields: [['name', 'Renamed'], ['kind', 'person']] },
    { path: `/bible/${kesslerId}/delete`, fields: [] },
    { path: `/bible/${kesslerId}/links`, fields: [['to', String(pradoId)], ['label', 'x']] },
    { path: `/bible/${kesslerId}/appearances`, fields: [] },
    { path: `/stories/${storyId}/bible/rescan`, fields: [] },
  ];
  for (const { path, fields } of refusals) {
    const res = await reader.request(path, { method: 'POST', ...form(fields) });
    assert.strictEqual(res.status, 403, `${path} refused`);
  }
  assert.ok(models.getStoryEntity(kesslerId), 'and nothing of it was deleted');
  assert.strictEqual(models.getStoryEntity(kesslerId).name, 'Kessler');
});

test('deleting an entry takes its aliases, relations and appearances with it', async () => {
  const doomed = await owner.request(`/stories/${storyId}/bible`, {
    method: 'POST', ...form([['name', 'Tampaad'], ['kind', 'place'], ['aliases', 'the reach']]),
  });
  const id = Number(doomed.headers.get('location').split('/').pop());
  await owner.request(`/bible/${id}/links`, {
    method: 'POST', ...form([['to', String(kesslerId)], ['label', 'home of']]),
  });
  assert.strictEqual(models.listStoryEntityLinks(kesslerId).length, 2);

  const res = await owner.request(`/bible/${id}/delete`, { method: 'POST', ...form([]) });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(models.getStoryEntity(id), null);
  assert.strictEqual(models.listEntityAliases(id).length, 0);
  assert.strictEqual(models.listStoryEntityLinks(kesslerId).length, 1, 'the far end of the relation went too');
});

test('the story page offers the way in', async () => {
  const html = await (await owner.request(`/stories/${storyId}`)).text();
  assert.match(html, new RegExp(`href="/stories/${storyId}/bible"`));
});
