// The story bible, against the real server.
//
// The interesting half is not the CRUD -- it is that "which chapters is
// she in" is derived from the prose and stays right as the prose changes,
// and that a reader cannot rewrite somebody else's cast.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart, multipartWithFile } = require('./helpers/app');

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

// ---------- pictures ----------
// A one-pixel PNG and a one-pixel GIF, written out by hand: enough for the
// signature check to have something real to recognise, and small enough to
// sit in the test file.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

test('a picture goes up, comes back, and is the entry\'s face', async () => {
  const res = await owner.request(`/bible/${kesslerId}/images`, {
    method: 'POST',
    ...multipartWithFile([['caption', 'On the spine, 04:20']], { name: 'image', filename: 'kessler.png', body: PNG }),
  });
  assert.strictEqual(res.status, 302);

  const images = models.listEntityImages(kesslerId);
  assert.strictEqual(images.length, 1);
  assert.strictEqual(images[0].content_type, 'image/png', 'recognised by its bytes, not its name');
  assert.strictEqual(images[0].caption, 'On the spine, 04:20');

  // It is served from outside public/, through a route, with its real type.
  const shown = await owner.request(`/entity-images/${images[0].id}`);
  assert.strictEqual(shown.status, 200);
  assert.strictEqual(shown.headers.get('content-type'), 'image/png');
  assert.strictEqual(Buffer.from(await shown.arrayBuffer()).length, PNG.length);

  const page = await (await owner.request(`/bible/${kesslerId}`)).text();
  assert.match(page, new RegExp(`class="entity-portrait" src="/entity-images/${images[0].id}"`));
  const index = await (await owner.request(`/stories/${storyId}/bible`)).text();
  assert.match(index, new RegExp(`class="row-cover" src="/entity-images/${images[0].id}"`));
});

test('the gallery reorders, and the first picture is the cover', async () => {
  await owner.request(`/bible/${kesslerId}/images`, {
    method: 'POST',
    ...multipartWithFile([['caption', 'Later']], { name: 'image', filename: 'second.gif', body: GIF }),
  });
  let images = models.listEntityImages(kesslerId);
  assert.deepStrictEqual(images.map((i) => i.caption), ['On the spine, 04:20', 'Later']);

  await owner.request(`/bible/${kesslerId}/images/${images[1].id}/up`, { method: 'POST', ...form([]) });
  images = models.listEntityImages(kesslerId);
  assert.deepStrictEqual(images.map((i) => i.caption), ['Later', 'On the spine, 04:20']);
  assert.strictEqual(models.coverImagesFor(storyId).get(kesslerId), images[0].id, 'the cover moved with it');

  await owner.request(`/bible/${kesslerId}/images/${images[0].id}/caption`, {
    method: 'POST', ...form([['caption', 'A sketch']]),
  });
  assert.strictEqual(models.listEntityImages(kesslerId)[0].caption, 'A sketch');
});

test('a file that is not one of the four formats is refused, SVG included', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');
  const res = await owner.request(`/bible/${kesslerId}/images`, {
    method: 'POST',
    // Named and typed as a PNG; it is the bytes that give it away.
    ...multipartWithFile([['caption', '']], { name: 'image', filename: 'portrait.png', body: svg }),
  });
  assert.strictEqual(res.status, 200, 'the page comes back with the reason, not a bare error');
  assert.match(await res.text(), /not a PNG, JPEG, GIF or WebP/);
  assert.strictEqual(models.listEntityImages(kesslerId).length, 2, 'and nothing was stored');
});

test('a reader cannot add or remove pictures', async () => {
  const images = models.listEntityImages(kesslerId);
  const upload = await reader.request(`/bible/${kesslerId}/images`, {
    method: 'POST',
    ...multipartWithFile([['caption', '']], { name: 'image', filename: 'x.png', body: PNG }),
  });
  assert.strictEqual(upload.status, 403);
  const remove = await reader.request(`/bible/${kesslerId}/images/${images[0].id}/delete`, { method: 'POST', ...form([]) });
  assert.strictEqual(remove.status, 403);
  assert.strictEqual(models.listEntityImages(kesslerId).length, 2);

  // Reading one, though, is the same right as reading the story.
  assert.strictEqual((await reader.request(`/entity-images/${images[0].id}`)).status, 200);
});

test('deleting a picture takes the file with it, and so does deleting the entry', async () => {
  const fs2 = require('node:fs');
  const entityImages = require('../lib/entity-images');
  const images = models.listEntityImages(kesslerId);
  const first = entityImages.imagePath(images[0].filename);
  const second = entityImages.imagePath(images[1].filename);
  assert.ok(fs2.existsSync(first) && fs2.existsSync(second));

  await owner.request(`/bible/${kesslerId}/images/${images[0].id}/delete`, { method: 'POST', ...form([]) });
  assert.ok(!fs2.existsSync(first), 'the file went with the row');

  // And an entry deleted whole leaves nothing on disk either.
  const doomed = await owner.request(`/stories/${storyId}/bible`, {
    method: 'POST', ...form([['name', 'Someone Else'], ['kind', 'person']]),
  });
  const id = Number(doomed.headers.get('location').split('/').pop());
  await owner.request(`/bible/${id}/images`, {
    method: 'POST', ...multipartWithFile([['caption', '']], { name: 'image', filename: 'p.png', body: PNG }),
  });
  const path2 = entityImages.imagePath(models.listEntityImages(id)[0].filename);
  assert.ok(fs2.existsSync(path2));
  await owner.request(`/bible/${id}/delete`, { method: 'POST', ...form([]) });
  assert.ok(!fs2.existsSync(path2), 'no orphaned faces on disk');
});

// ---------- custom fields ----------
test('a template asks every entry of a kind the same questions', async () => {
  const res = await owner.request(`/stories/${storyId}/bible/fields`, {
    method: 'POST',
    ...form([['person', 'Rank\nHome world\nrank'], ['place', 'Class'], ['group', ''], ['thing', ''], ['event', '']]),
  });
  assert.strictEqual(res.status, 200);
  // Repeats fold together; the order is the order typed.
  assert.deepStrictEqual(models.listFieldTemplate(storyId, 'person'), ['Rank', 'Home world']);
  assert.deepStrictEqual(models.listFieldTemplate(storyId, 'place'), ['Class']);

  const formPage = await (await owner.request(`/bible/${kesslerId}/edit`)).text();
  assert.match(formPage, /data-kind="person"/);
  assert.match(formPage, /Home world/);
  // The other kinds' blocks are there but hidden and disabled, so changing
  // your mind about the kind does not post two kinds' fields.
  assert.match(formPage, /data-kind="place" hidden/);
});

test('an entry answers the template and adds its own', async () => {
  await owner.request(`/bible/${kesslerId}`, {
    method: 'POST',
    ...form([
      ['name', 'Kessler'], ['kind', 'person'], ['aliases', 'the Old Man'],
      ['summary', 'Four hundred days on the anchorage.'], ['role', 'main'], ['status', 'alive'],
      ['fieldLabel', 'Rank'], ['fieldValue', 'Chief of the watch'],
      ['fieldLabel', 'Home world'], ['fieldValue', ''],
      ['fieldLabel', 'Eyes'], ['fieldValue', 'grey'],
      ['fieldLabel', ''], ['fieldValue', 'orphan with no label'],
    ]),
  });
  // The template slot nobody answered is not stored as an empty answer,
  // and a value with no label is not stored at all.
  assert.deepStrictEqual(
    models.listEntityFields(kesslerId).map((f) => [f.label, f.value]),
    [['Rank', 'Chief of the watch'], ['Eyes', 'grey']]
  );

  const page = await (await owner.request(`/bible/${kesslerId}`)).text();
  assert.match(page, /class="entity-fields"/);
  assert.match(page, /Chief of the watch/);
  assert.match(page, /grey/);

  // The labels already in use are offered back as suggestions.
  const next = await (await owner.request(`/stories/${storyId}/bible/new`)).text();
  assert.match(next, /<datalist id="known-field-labels">/);
  assert.match(next, /<option value="Eyes">/);
});

test('taking a label out of the template does not take what an entry said', async () => {
  await owner.request(`/stories/${storyId}/bible/fields`, {
    method: 'POST',
    ...form([['person', 'Home world'], ['place', ''], ['group', ''], ['thing', ''], ['event', '']]),
  });
  const fields = models.listEntityFields(kesslerId).map((f) => f.label);
  assert.ok(fields.includes('Rank'), 'the answer outlived the question');
  // It is still shown, now as one of the entry's own extras.
  assert.match(await (await owner.request(`/bible/${kesslerId}`)).text(), /Chief of the watch/);
});

test('only the story\'s authors can set the template', async () => {
  const res = await reader.request(`/stories/${storyId}/bible/fields`, {
    method: 'POST', ...form([['person', 'Whatever I like']]),
  });
  assert.strictEqual(res.status, 403);
  assert.strictEqual((await reader.request(`/stories/${storyId}/bible/fields`)).status, 403);
  assert.deepStrictEqual(models.listFieldTemplate(storyId, 'person'), ['Home world']);
});
