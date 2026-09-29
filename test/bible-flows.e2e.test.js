// The story bible, second pass: how names are found, and changing an entry
// where it is shown rather than on a form of its own.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart } = require('./helpers/app');
const bible = require('../lib/story-bible');

const PASSWORD = 'a long enough password';
let app;
/** @type {any} */
let models;
let owner;
let reader;
let storyId;
const chapters = [];

const json = (body) => ({
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify(body),
});

const TEXTS = [
  'Anna Kessler came aboard. Kessler did not like the will they read. Will stayed below. Renée waved.',
  'Captain Kessler signed. The old man in the corner said nothing; the Old Man never did.',
  'Kessler was dead by morning, and Émile Duarte found her.',
];

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');
  owner = makeClient(app.base);
  await owner.request('/register', { method: 'POST', ...form([['username', 'ana'], ['displayName', 'Ana'], ['password', PASSWORD], ['inviteCode', models.getActiveInviteCode().code]]) });
  await owner.login('ana', PASSWORD);
  models.createUser({ username: 'marta', displayName: 'Marta', passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  reader = makeClient(app.base);
  await reader.login('marta', PASSWORD);
  await owner.request('/stories/new', { method: 'POST', ...multipart([['storyTitle', 'The Watch'], ['storyDescription', ''], ['chapterTitle', 'One'], ['chapterSummary', ''], ['content', TEXTS[0]]]) });
  storyId = models.listStories().find((s) => s.title === 'The Watch').id;
  for (const [i, text] of TEXTS.slice(1).entries()) {
    await owner.request(`/stories/${storyId}/chapters/new`, { method: 'POST', ...multipart([['title', `Part ${i + 2}`], ['summary', ''], ['content', text]]) });
  }
  for (const c of models.listChaptersForStory(storyId)) chapters.push(c.id);
});
test.after(() => app && app.stop());

test('a name with a capital is only found with one; the parts of a name are found too', () => {
  const m = bible.buildMatcher([
    { id: 1, name: 'Anna Kessler', kind: 'person' },
    { id: 2, name: 'Will', kind: 'person' },
    { id: 3, name: 'Ren', kind: 'person' },
    { id: 4, name: 'the Old Man', kind: 'person' },
  ]);
  const found = bible.scanText(TEXTS[0] + ' ' + TEXTS[1], m);
  assert.strictEqual(found.get(1).mentions, 3, 'Anna Kessler, Kessler, and Captain Kessler');
  assert.strictEqual(found.get(2).mentions, 1, '"the will" is not Will');
  assert.ok(!found.has(3), 'Ren is not inside Renée');
  assert.strictEqual(found.get(4).mentions, 2, 'a name written in lower case is found in any case');
});

test('a part two people share, or an ordinary word, is nobody on its own', () => {
  const m = bible.buildMatcher([
    { id: 1, name: 'Anna Kessler', kind: 'person' },
    { id: 2, name: 'Piet Kessler', kind: 'person' },
    { id: 3, name: 'Rose Tyler', kind: 'person' },
  ]);
  assert.deepStrictEqual(m.forms.get(1).shared, ['kessler']);
  assert.deepStrictEqual(m.forms.get(3).common, ['Rose']);
  const found = bible.scanText('Kessler left. Rose smiled. Tyler ran.', m);
  assert.ok(!found.has(1) && !found.has(2));
  assert.strictEqual(found.get(3).mentions, 1, 'Tyler is her, Rose on its own is a flower');
});

test('suggestions: accented names, names with "of" and "de", and glossary names marked', () => {
  const found = bible.findProperNames('She joined the Order of the Silent Star with Pedro de Alvarado and Chloë. Then Kestrel Anchorage.', new Set(), { glossary: new Set(['kestrel anchorage']) });
  const names = found.map((f) => f.name);
  assert.ok(names.includes('Order of the Silent Star'), names.join(', '));
  assert.ok(names.includes('Pedro de Alvarado'));
  assert.ok(names.includes('Chloë'));
  assert.deepStrictEqual(found[found.length - 1], { name: 'Kestrel Anchorage', count: 1, inGlossary: true });
});

let annaId;
test('an entry is changed where it stands, and a new name keeps the old one', async () => {
  const made = await owner.request(`/stories/${storyId}/bible/quick`, { method: 'POST', ...json({ name: 'Anna Kessler', kind: 'person', summary: 'Keeps the watch.' }) });
  annaId = (await made.json()).id;
  assert.deepStrictEqual(models.listEntityAppearances(annaId).map((a) => a.chapter_id), chapters, 'in all three, by her surname');

  const summary = await owner.request(`/bible/${annaId}/set`, { method: 'POST', ...json({ field: 'summary', value: 'Four hundred days aboard.' }) });
  assert.strictEqual((await summary.json()).entity.summary, 'Four hundred days aboard.');
  assert.strictEqual((await reader.request(`/bible/${annaId}/set`, { method: 'POST', ...json({ field: 'summary', value: 'x' }) })).status, 403);

  const rename = await (await owner.request(`/bible/${annaId}/set`, { method: 'POST', ...json({ field: 'name', value: 'Anna Kessler-Prado' }) })).json();
  assert.match(rename.notice, /still found/);
  assert.ok(models.listEntityAliases(annaId).includes('Anna Kessler'), 'the old name is an alias');

  const page = await (await owner.request(`/bible/${annaId}`)).text();
  assert.match(page, /data-inline-edit="summary"/);
  assert.match(page, /Found in the text as/);
  assert.match(page, /data-confirm="Delete Anna Kessler-Prado from the glossary\?/);
  const theirs = await (await reader.request(`/bible/${annaId}`)).text();
  assert.ok(!/data-inline-edit/.test(theirs), 'a reader gets plain text');
});

test('status changes from a chapter, and a reader sees it only once they have read that far', async () => {
  await owner.request(`/bible/${annaId}/status`, { method: 'POST', ...form([['status', 'alive'], ['chapterId', '']]) });
  await owner.request(`/bible/${annaId}/status`, { method: 'POST', ...form([['status', 'dead'], ['chapterId', String(chapters[2])]]) });
  assert.match(await (await owner.request(`/bible/${annaId}`)).text(), /From <a href="\/chapters\/\d+">chapter 3<\/a>/);

  const before = await (await reader.request(`/stories/${storyId}/bible`)).text();
  assert.ok(!/status-dead/.test(before), 'not before they have read it');
  assert.match(before, /status-alive/);
  await reader.request(`/chapters/${chapters[2]}`);
  const after = await (await reader.request(`/stories/${storyId}/bible`)).text();
  assert.match(after, /status-dead/, 'and once they have');

  const card = await (await owner.request(`/bible/${annaId}/beside?chapter=${chapters[0]}`)).text();
  assert.match(card, /Alive in chapter 1/, 'the card from chapter one says how she is there');
  assert.match(card, /Later: Dead from chapter 3/, 'and tells her writer what comes');
});

test('"not them here" unlinks a chapter; "that word is never them" puts a part away', async () => {
  const card = await (await owner.request(`/bible/${annaId}/beside?chapter=${chapters[1]}&as=Kessler`)).text();
  assert.match(card, /Not Anna Kessler-Prado in this chapter/);
  assert.match(card, /&ldquo;Kessler&rdquo; is never Anna Kessler-Prado/);

  await owner.request(`/bible/${annaId}/not-here`, { method: 'POST', ...json({ chapterId: chapters[1] }) });
  const two = await (await owner.request(`/chapters/${chapters[1]}`)).text();
  assert.ok(!two.includes(`href="/bible/${annaId}"`), 'no link to her in chapter two');

  const res = await (await owner.request(`/bible/${annaId}/not-as`, { method: 'POST', ...json({ form: 'Kessler' }) })).json();
  assert.match(res.said, /not Anna Kessler-Prado/);
  assert.deepStrictEqual(models.listEntityAppearances(annaId).map((a) => a.chapter_id), [chapters[0]], 'only where her whole name is');
  await owner.request(`/bible/${annaId}/unblock`, { method: 'POST', ...json({ form: 'kessler' }) });
  assert.strictEqual(models.listEntityAppearances(annaId).length, 2, 'undone (chapter two is still excluded by hand)');
});

test('two entries that were one are merged', async () => {
  const dup = await (await owner.request(`/stories/${storyId}/bible/quick`, { method: 'POST', ...json({ name: 'the Old Man', kind: 'person', summary: '' }) })).json();
  await owner.request(`/bible/${dup.id}/links`, { method: 'POST', ...form([['to', String(annaId)], ['label', 'watches']]) });
  const res = await owner.request(`/bible/${dup.id}/merge`, { method: 'POST', ...form([['into', String(annaId)]]) });
  assert.strictEqual(res.status, 302);
  assert.ok(!models.getStoryEntity(dup.id), 'the duplicate is gone');
  assert.ok(models.listEntityAliases(annaId).includes('the Old Man'), 'its name is an alias');
  assert.strictEqual(models.listStoryEntityLinks(annaId).length, 0, 'a relation between the two is dropped, not made circular');
});

test('the missing-names row takes a line, and the words put away are listed in the bible', async () => {
  const html = await (await owner.request(`/chapters/${chapters[2]}`)).text();
  assert.match(html, /Émile Duarte/);
  assert.match(html, /name="summary" class="missing-summary"/);
  await owner.request(`/stories/${storyId}/bible/quick`, { method: 'POST', ...form([['name', 'Émile Duarte'], ['kind', 'person'], ['summary', 'Finds people.']]) });
  const emile = models.getStoryEntityByName(storyId, 'Émile Duarte');
  assert.strictEqual(models.getStoryEntity(emile.id).summary, 'Finds people.');

  await owner.request(`/stories/${storyId}/bible/not-names`, { method: 'POST', ...form([['name', 'Captain']]) });
  const index = await (await owner.request(`/stories/${storyId}/bible`)).text();
  assert.match(index, /Words that are not names \(1\)/);
  const row = models.listNotNames(storyId)[0];
  const back = await owner.request(`/stories/${storyId}/bible/not-names/${row.id}/delete`, { method: 'POST', ...json({}) });
  assert.strictEqual(back.status, 200);
  assert.strictEqual(models.listNotNames(storyId).length, 0);
});
