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
  assert.match(html, /class="kind-tabs"/);
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
  assert.strictEqual(models.coverImagesFor(storyId).get(kesslerId).id, images[0].id, 'the cover moved with it');

  await owner.request(`/bible/${kesslerId}/images/${images[0].id}/caption`, {
    method: 'POST', ...form([['caption', 'A sketch']]),
  });
  assert.strictEqual(models.listEntityImages(kesslerId)[0].caption, 'A sketch');
});

test('the crop point is chosen, saved, and used in both places', async () => {
  const image = models.listEntityImages(kesslerId)[0];
  await owner.request(`/bible/${kesslerId}/images/${image.id}/focus`, {
    method: 'POST', ...form([['focusX', '30'], ['focusY', '18']]),
  });
  const saved = models.getEntityImage(image.id);
  assert.strictEqual(saved.focus_x, 30);
  assert.strictEqual(saved.focus_y, 18);

  // The entry's own page and the index are cut the same way, or the face
  // you framed is not the face in the list.
  const page = await (await owner.request(`/bible/${kesslerId}`)).text();
  assert.match(page, /class="entity-portrait"[^>]*object-position: 30% 18%/);
  const index = await (await owner.request(`/stories/${storyId}/bible`)).text();
  assert.match(index, /class="row-cover"[^>]*object-position: 30% 18%/);

  // Nonsense is not a correction. Off the picture, or not a number at
  // all, goes back to the middle rather than to the edge.
  await owner.request(`/bible/${kesslerId}/images/${image.id}/focus`, {
    method: 'POST', ...form([['focusX', '900'], ['focusY', 'left a bit']]),
  });
  const fixed = models.getEntityImage(image.id);
  assert.strictEqual(fixed.focus_x, 100);
  assert.strictEqual(fixed.focus_y, 50);
});

test('an entry with no picture still has the box, so the list does not go ragged', async () => {
  const index = await (await owner.request(`/stories/${storyId}/bible`)).text();
  // Every row in the cast list is built the same way, with or without a
  // picture: one has an <img>, the other an initial in the same box.
  const rows = index.match(/class="chapter-row glossary-row[^"]*"/g) || [];
  assert.ok(rows.length > 1, 'more than one entry to compare');
  assert.ok(rows.every((row) => row.includes('has-cover')), 'no row is missing the picture column');
  assert.match(index, /class="row-cover row-cover-empty"/);
});

test('an edit with nobody attached still works, and says what went wrong if it does not', () => {
  // A caller that does not know who is asking -- a script, an import --
  // used to blow up inside the dictionary and then have the failure
  // replaced by "cannot rollback", which is a much less useful sentence.
  const entity = models.listStoryEntities(storyId).find((e) => e.name === 'Kessler');
  const updated = models.updateStoryEntity({
    entityId: entity.id, kind: entity.kind, name: entity.name, summary: entity.summary,
    description: entity.description, secret: entity.secret, status: entity.status,
    role: entity.role, aliases: [], fields: [],
    storyWhen: 'Day 412', storyDay: '412',
  });
  assert.strictEqual(updated.story_day, 412);
  assert.strictEqual(updated.story_when, 'Day 412');
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

// ---------- the cast in the prose ----------
test('a name in a chapter links to its entry, and beats the wiki to it', async () => {
  // The same name exists on the shared wiki. The author's own account of
  // somebody is the one their reader should get.
  models.replaceWikiPages([
    { title: 'Kessler', summary: 'A wiki page about somebody else entirely.', categories: ['Story Characters'], contentHtml: '<p>.</p>' },
    { title: 'Tampaad', summary: 'A reach.', categories: ['Systems'], contentHtml: '<p>.</p>' },
  ]);
  // She was taken out of chapter one by hand above; put her back, or the
  // chapter would rightly not link her.
  models.setAppearanceOverride({ entityId: kesslerId, chapterId: chapterOne, state: 'auto' });
  const html = await (await owner.request(`/chapters/${chapterOne}`)).text();
  assert.match(html, new RegExp(`class="wiki-link cast-link" href="/bible/${kesslerId}"`));
  assert.ok(!html.includes('href="/glossary/Kessler"'), 'the wiki did not get the name');
});

test('the chapter says who is new in it', async () => {
  const html = await (await owner.request(`/chapters/${chapterOne}`)).text();
  assert.match(html, /New here/);
});

test('names the bible has never heard of are offered, to writers only', async () => {
  await owner.request(`/chapters/${chapterTwo}/edit`, {
    method: 'POST',
    ...multipart([
      ['title', 'Seals and signatures'], ['summary', ''],
      ['content', 'She signed the book, and Sergeant Iona Vell countersigned it. Iona Vell always did.'],
      ['changelog', 'a new name'],
    ]),
  });
  const html = await (await owner.request(`/chapters/${chapterTwo}`)).text();
  assert.match(html, /not in the bible/);
  assert.match(html, /Iona Vell/);
  assert.match(html, new RegExp(`action="/stories/${storyId}/bible/quick"`));

  // A reader is not offered somebody else's homework.
  const readerHtml = await (await reader.request(`/chapters/${chapterTwo}`)).text();
  assert.ok(!readerHtml.includes('not in the bible'));
});

test('one click writes the entry, and the name stops being offered', async () => {
  const res = await owner.request(`/stories/${storyId}/bible/quick`, {
    method: 'POST',
    ...form([['name', 'Iona Vell'], ['kind', 'person'], ['returnTo', `/chapters/${chapterTwo}`]]),
  });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), `/chapters/${chapterTwo}`);
  const made = models.getStoryEntityByName(storyId, 'Iona Vell');
  assert.ok(made, 'the entry exists');
  // And it immediately knows where she is, because the scan reran.
  assert.deepStrictEqual(models.listEntityAppearances(made.id).map((a) => a.chapter_id), [chapterTwo]);

  const html = await (await owner.request(`/chapters/${chapterTwo}`)).text();
  assert.ok(!html.includes('class="missing-name">Iona Vell'), 'she is no longer a suggestion');
  // She is in the chapter's cast instead, and linked in its prose.
  assert.match(html, new RegExp(`class="wiki-link cast-link" href="/bible/${made.id}"`));
});

test('returnTo cannot be pointed off the site', async () => {
  const res = await owner.request(`/stories/${storyId}/bible/quick`, {
    method: 'POST',
    ...form([['name', 'Somewhere'], ['kind', 'place'], ['returnTo', 'https://example.com/phish']]),
  });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), `/stories/${storyId}/bible`);
});

test('a name can be added as another name for somebody already there', async () => {
  // The list offers the entries, with the likeliest chosen.
  const res = await owner.request(`/stories/${storyId}/bible/unknown-names`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ text: 'Colonel Kessler came in. Colonel Kessler sat down. The Kessler Station was dark.' }),
  });
  const data = await res.json();
  assert.ok(data.entries.some((e) => e.id === kesslerId), 'the entries are offered');
  const offered = data.names.find((n) => n.name === 'Colonel Kessler');
  assert.ok(offered, `the new name is offered: ${data.names.map((n) => n.name).join(', ')}`);
  assert.strictEqual(offered.sameAs, kesslerId, 'and Kessler is the guess');
  // Sharing a word is not being somebody: no guess is chosen in advance.
  const station = data.names.find((n) => n.name === 'Kessler Station');
  assert.ok(station, 'the station is offered too');
  assert.strictEqual(station.sameAs, null, 'and nobody is guessed for it');

  // Somebody else's story's entry is refused.
  const bad = await owner.request(`/stories/${storyId}/bible/quick`, {
    method: 'POST', ...form([['name', 'Anyone'], ['kind', 'alias:999999']]),
  });
  assert.strictEqual(bad.status, 302);
  assert.ok(!models.getStoryEntity(999999));

  const added = await owner.request(`/stories/${storyId}/bible/quick`, {
    method: 'POST', ...form([['name', offered.name], ['kind', `alias:${kesslerId}`], ['returnTo', `/chapters/${chapterOne}`]]),
  });
  assert.strictEqual(added.status, 302);
  assert.strictEqual(added.headers.get('location'), `/chapters/${chapterOne}`);
  assert.ok(models.listEntityAliases(kesslerId).includes(offered.name), 'it is one of her aliases now');
  assert.ok(!models.getStoryEntityByName(storyId, offered.name) || models.getStoryEntityByName(storyId, offered.name).id === kesslerId,
    'and not an entry of its own');
});

test('a false alarm can be put away, and brought back', async () => {
  const text = 'Yevgenia Bru waited. Somewhere Quiet was the name of nothing at all.';
  const ask = async () => (await (await owner.request(`/stories/${storyId}/bible/unknown-names`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ text }),
  })).json()).names.map((n) => n.name);
  const before = await ask();
  const alarm = before.find((n) => n !== 'Yevgenia Bru');
  assert.ok(alarm, `something besides her is offered: ${before.join(', ')}`);

  // Only the story's writers can say so.
  const refused = await reader.request(`/stories/${storyId}/bible/not-names`, {
    method: 'POST', ...form([['name', alarm]]),
  });
  assert.strictEqual(refused.status, 403);

  const res = await owner.request(`/stories/${storyId}/bible/not-names`, {
    method: 'POST', ...form([['name', alarm], ['kind', 'person'], ['returnTo', `/chapters/${chapterTwo}`]]),
  });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), `/chapters/${chapterTwo}`);
  assert.deepStrictEqual(await ask(), before.filter((n) => n !== alarm));
  assert.ok(!models.getStoryEntityByName(storyId, alarm), 'nothing was added to the bible');

  // The bible lists it (the story page points there), and removing it offers it again.
  const story = await (await owner.request(`/stories/${storyId}`)).text();
  assert.match(story, /bible#not-names/);
  const bibleHtml = await (await owner.request(`/stories/${storyId}/bible`)).text();
  assert.match(bibleHtml, /id="not-names"/);
  assert.ok(bibleHtml.includes(`>${alarm}<`), 'the word is listed in the bible');
  const row = models.listNotNames(storyId).find((n) => n.name === alarm);
  await owner.request(`/stories/${storyId}/bible/not-names/${row.id}/delete`, { method: 'POST', ...form([]) });
  assert.deepStrictEqual(await ask(), before);
});

test('the editor can ask about a draft that has not been saved', async () => {
  const res = await owner.request(`/stories/${storyId}/bible/unknown-names`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ text: 'The hatch stood open, and Yevgenia Bru was already through it.' }),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.deepStrictEqual(data.names.map((n) => n.name), ['Yevgenia Bru']);

  const refused = await reader.request(`/stories/${storyId}/bible/unknown-names`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ text: 'Anything' }),
  });
  assert.strictEqual(refused.status, 403);
});

test('the bible is in the site search', async () => {
  const html = await (await owner.request('/search?q=' + encodeURIComponent('Iona'))).text();
  assert.match(html, /Bibles/);
  assert.match(html, new RegExp(`href="/bible/${models.getStoryEntityByName(storyId, 'Iona Vell').id}"`));
});

test('the index can be ordered by something other than the alphabet', async () => {
  const byName = await (await owner.request(`/stories/${storyId}/bible`)).text();
  assert.match(byName, /class="tag-chip current"[^>]*>A to Z/);

  const byPresence = await (await owner.request(`/stories/${storyId}/bible?sort=appearances`)).text();
  const order = (html) => Array.from(html.matchAll(/class="chapter-row glossary-row[^"]*" href="\/bible\/(\d+)"/g)).map((m) => Number(m[1]));
  assert.notDeepStrictEqual(order(byPresence), order(byName), 'the order actually changed');
  assert.match(byPresence, /aria-current="true"[^>]*>Most present|Most present/);

  // A sort nobody offered falls back to the alphabet rather than reaching
  // the query builder.
  const nonsense = await (await owner.request(`/stories/${storyId}/bible?sort=DROP+TABLE`)).text();
  assert.deepStrictEqual(order(nonsense), order(byName));
});

// ---------- a bible somebody keeps to themselves ----------
test('a private bible closes to readers, and stays open to its writers', async () => {
  // Only the owner decides.
  const refused = await reader.request(`/stories/${storyId}/bible/privacy`, {
    method: 'POST', ...form([['visibility', 'private']]),
  });
  assert.strictEqual(refused.status, 403);
  assert.strictEqual(models.getStoryById(storyId).bible_private, 0);

  const closed = await owner.request(`/stories/${storyId}/bible/privacy`, {
    method: 'POST', ...form([['visibility', 'private']]),
  });
  assert.strictEqual(closed.status, 302);
  assert.strictEqual(models.getStoryById(storyId).bible_private, 1);

  // The author still has all of it.
  assert.strictEqual((await owner.request(`/stories/${storyId}/bible`)).status, 200);
  assert.strictEqual((await owner.request(`/bible/${kesslerId}`)).status, 200);

  // The reader has none of it, and is told why rather than told it is gone.
  for (const path of [`/stories/${storyId}/bible`, `/bible/${kesslerId}`]) {
    const res = await reader.request(path);
    assert.strictEqual(res.status, 403, path);
    assert.match(await res.text(), /private to the people who write it/);
  }
  const images = models.listEntityImages(kesslerId);
  assert.strictEqual((await reader.request(`/entity-images/${images[0].id}`)).status, 403);
});

test('a private bible does not leak through the chapter it is about', async () => {
  const authorSees = await (await owner.request(`/chapters/${chapterOne}`)).text();
  assert.match(authorSees, /In this chapter/);
  assert.match(authorSees, /class="wiki-link cast-link"/);

  // For the reader the chapter is what it was before any of this existed:
  // no cast list, no links into a bible they cannot open, no names.
  const readerSees = await (await reader.request(`/chapters/${chapterOne}`)).text();
  assert.strictEqual((await reader.request(`/chapters/${chapterOne}`)).status, 200);
  assert.ok(!readerSees.includes('In this chapter'), 'no cast list');
  assert.ok(!readerSees.includes('cast-link'), 'no links into the bible');
  assert.ok(!readerSees.includes(`/bible/${kesslerId}`), 'and no way in by hand');

  // Nor through the story page's button, nor the search.
  const storyPage = await (await reader.request(`/stories/${storyId}`)).text();
  assert.ok(!storyPage.includes(`/stories/${storyId}/bible`), 'no button to a shut door');
  const found = await (await reader.request('/search?q=' + encodeURIComponent('Kessler'))).text();
  assert.ok(!found.includes(`href="/bible/${kesslerId}"`), 'and nothing in the search');
  // The author still finds it.
  assert.match(await (await owner.request('/search?q=' + encodeURIComponent('Kessler'))).text(), new RegExp(`href="/bible/${kesslerId}"`));
});

test('opening it again gives everything back', async () => {
  await owner.request(`/stories/${storyId}/bible/privacy`, {
    method: 'POST', ...form([['visibility', 'open']]),
  });
  assert.strictEqual(models.getStoryById(storyId).bible_private, 0);
  assert.strictEqual((await reader.request(`/stories/${storyId}/bible`)).status, 200);
  assert.match(await (await reader.request(`/chapters/${chapterOne}`)).text(), /In this chapter/);
});

test('the privacy switch is the owner\'s alone -- a coauthor does not even see it', async () => {
  const auth = require('../auth');
  models.createUser({ username: 'luis', displayName: 'Luis', passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  const helper = makeClient(app.base);
  await helper.login('luis', PASSWORD);
  models.addStoryCoauthor(storyId, models.getUserByUsername('luis').id, models.getUserByUsername('ana').id);

  // A coauthor writes in the bible.
  const made = await helper.request(`/stories/${storyId}/bible`, {
    method: 'POST', ...form([['name', 'Yevgenia Bru'], ['kind', 'person']]),
  });
  assert.strictEqual(made.status, 302, 'they can add an entry');

  for (const state of ['private', 'open']) {
    await owner.request(`/stories/${storyId}/bible/privacy`, {
      method: 'POST', ...form([['visibility', state]]),
    });
    const theirs = await (await helper.request(`/stories/${storyId}/bible`)).text();
    assert.ok(!theirs.includes('bible-privacy'), `no switch when ${state}`);
    assert.ok(!theirs.includes('Make it private'), `and no button when ${state}`);
    assert.ok(!theirs.includes('Open it to readers'), `either way, when ${state}`);

    // And the owner still has it.
    const hers = await (await owner.request(`/stories/${storyId}/bible`)).text();
    assert.match(hers, /class="bible-privacy inline-form"/);
  }

  // Posting it by hand is refused, not merely hidden.
  const refused = await helper.request(`/stories/${storyId}/bible/privacy`, {
    method: 'POST', ...form([['visibility', 'private']]),
  });
  assert.strictEqual(refused.status, 403);
  assert.strictEqual(models.getStoryById(storyId).bible_private, 0);
});
