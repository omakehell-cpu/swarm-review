// Importing a StoriesOnline EPUB, and claiming its author
// (lib/sol-import.js, models/imports.js, routes/import.js).
//
// The EPUBs here are made in the test, in the shape SOL's generator
// writes: an info page, a finish page with the story's and the author's
// links, and either one file per chapter or the whole story in one.
'use strict';

const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipartWithFile } = require('./helpers/app');
const { readSolEpub, htmlToMarkdown } = require('../lib/sol-import');

const JSZip = require(require.resolve('jszip', { paths: [path.dirname(require.resolve('mammoth'))] }));
const PASSWORD = 'a long enough password';

const page = (title, body) => `<?xml version="1.0"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${body}</body></html>`;

async function solEpub({ id, title, chapters, oneFile = false, tags = 'Science Fiction, Space Opera' }) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
  const files = oneFile ? [['contents.xhtml', page(title, chapters.join(''))]]
    : chapters.map((c, i) => [`${9000 + i}.xhtml`, page(`Chapter ${i + 1}`, c)]);
  zip.file('OEBPS/content.opf', `<package><metadata>
    <dc:title>${title}</dc:title><dc:creator>Test Author</dc:creator>
    <dc:description>A test story.</dc:description>
    <meta name="calibre:series" content="The Test Cycle"/></metadata>
    <manifest>
      <item id="xcover" href="itscover.xhtml" media-type="application/xhtml+xml" />
      <item id="Info" href="info.xhtml" media-type="application/xhtml+xml" />
      ${files.map(([f], i) => `<item id="c${i}" href="${f}" media-type="application/xhtml+xml" />`).join('')}
      <item id="Finish" href="finish.xhtml" media-type="application/xhtml+xml" />
    </manifest>
    <spine><itemref idref="xcover" /><itemref idref="Info" />${files.map((f, i) => `<itemref idref="c${i}" />`).join('')}<itemref idref="Finish" /></spine></package>`);
  zip.file('OEBPS/itscover.xhtml', page('Cover', '<p>cover</p>'));
  zip.file('OEBPS/info.xhtml', page(title, `<h1>${title}</h1><h2>by Test Author</h2>
    <p><b>Description:</b> A test story.</p><p><b>Tags:</b> ${tags}</p>
    <p><b>Published:</b> 2007-06-14</p><p><b>Updated:</b> 2007-06-17</p><p><b>Status:</b> Complete</p>`));
  zip.file('OEBPS/finish.xhtml', page('Finish', `<h3 class="end">The End</h3>
    <p class="c">View on Website:<br /><a href="https://storiesonline.net/s/${id}/test">x</a></p>
    <p class="c">More From Test Author:<br /><a href="https://storiesonline.net/a/test-author">Test Author</a></p>`));
  for (const [f, body] of files) zip.file(`OEBPS/${f}`, body);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('XHTML becomes Markdown: paragraphs, italics, bold, breaks and scene breaks', () => {
  const md = htmlToMarkdown('<p>She was <i>there</i>, <b>really</b>.</p><hr /><p>Line one<br />line two</p><blockquote><p>Quoted.</p></blockquote><p>&ldquo;Hi&rdquo; &amp; bye</p>');
  assert.strictEqual(md, 'She was *there*, **really**.\n\n---\n\nLine one  \nline two\n\n> Quoted.\n\n“Hi” & bye');
});

test('one file per chapter: each is a chapter, titled by its own heading', async () => {
  const parsed = await readSolEpub(await solEpub({ id: 1, title: 'Pickup', chapters: [
    '<h2>Chapter 1</h2><p>First words.</p><h4 class="copy">Copyright 2007 by Test Author</h4>',
    '<h2>Chapter 2: The Diner</h2><p>Second words.</p>',
  ] }));
  assert.deepStrictEqual(parsed.chapters.map((c) => [c.title, c.markdown]), [['Chapter 1', 'First words.'], ['Chapter 2: The Diner', 'Second words.']]);
  assert.strictEqual(parsed.author, 'Test Author');
  assert.strictEqual(parsed.authorSlug, 'test-author');
  assert.strictEqual(parsed.series, 'The Test Cycle');
  assert.strictEqual(parsed.solId, '1');
  assert.strictEqual(parsed.status, 'complete');
  assert.deepStrictEqual(parsed.tags, ['Science Fiction', 'Space Opera']);
});

test('one file with the whole story: cut at its chapter headings, or kept whole', async () => {
  const split = await readSolEpub(await solEpub({ id: 2, title: 'Joes', oneFile: true, chapters: [
    '<h3>Prologue</h3><p>Before.</p>', '<h3>Chapter One</h3><p>During.</p>', '<h3>Epilogue</h3><p>After.</p>',
  ] }));
  assert.deepStrictEqual(split.chapters.map((c) => c.title), ['Prologue', 'Chapter One', 'Epilogue']);
  const whole = await readSolEpub(await solEpub({ id: 3, title: 'Average', oneFile: true, chapters: ['<p>One.</p><hr /><p>Two.</p>'] }));
  assert.deepStrictEqual(whole.chapters.map((c) => [c.title, c.markdown]), [['Average', 'One.\n\n---\n\nTwo.']]);
});

test('not an EPUB is said plainly', async () => {
  await assert.rejects(readSolEpub(Buffer.from('not a zip')), /not an EPUB/);
});

let app;
let models;
let admin;
let luis;

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');
  const invite = models.getActiveInviteCode();
  admin = makeClient(app.base);
  await admin.request('/register', { method: 'POST', ...form([['username', 'ana'], ['displayName', 'Ana'], ['password', PASSWORD], ['inviteCode', invite.code]]) });
  await admin.login('ana', PASSWORD);
  models.createUser({ username: 'luis', displayName: 'Luis', passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  luis = makeClient(app.base); await luis.login('luis', PASSWORD);
});
test.after(() => app && app.stop());

const upload = async (client, buffer) => client.request('/admin/import', {
  method: 'POST', ...multipartWithFile([], { name: 'epub', filename: 'story.epub', body: buffer }),
});

test('an admin imports: nothing is written until the preview is confirmed', async () => {
  assert.strictEqual((await upload(luis, Buffer.from('x'))).status, 403, 'members cannot import');
  const epub = await solEpub({ id: 52775, title: 'Pickup Number Eighteen', chapters: ['<h2>Chapter 1</h2><p>Diner.</p>', '<h2>Chapter 2</h2><p>Pods.</p>'] });
  const res = await upload(admin, epub);
  const html = await res.text();
  assert.strictEqual(res.status, 200);
  assert.match(html, /2 chapters/);
  assert.match(html, /new: an imported author will be made/);
  assert.strictEqual(models.listStories().length, 0, 'the preview writes nothing');
  const key = /action="\/admin\/import\/([a-f0-9]{24})"/.exec(html)[1];

  const done = await admin.request(`/admin/import/${key}`, { method: 'POST', ...form([['title', 'Pickup Number Eighteen'], ['title0', 'The Diner'], ['title1', 'Chapter 2']]) });
  assert.strictEqual(done.status, 302);
  const story = models.listStories()[0];
  assert.strictEqual(story.title, 'Pickup Number Eighteen');
  const chapters = models.listChaptersForStory(story.id);
  assert.deepStrictEqual(chapters.map((c) => c.title), ['The Diner', 'Chapter 2'], 'the titles as the admin left them');
  const author = models.getUserByUsername('sol-test-author');
  assert.ok(author && author.is_placeholder, 'an imported author was made');
  assert.strictEqual(story.author_id, author.id);

  // The same story again is refused, not doubled.
  const again = await (await upload(admin, epub)).text();
  assert.match(again, /already here/);
  assert.ok(!/<button class="btn" type="submit">Import<\/button>/.test(again));
});

test('an imported author is a name, not a member', async () => {
  const author = models.getUserByUsername('sol-test-author');
  const res = await makeClient(app.base).request('/login', { method: 'POST', ...form([['username', 'sol-test-author'], ['password', 'anything at all']]) });
  assert.strictEqual(res.status, 401, 'it cannot sign in');
  assert.ok(!models.listMentionable().some((p) => p.username === author.username), 'nobody can @ it');
  assert.ok(!models.listUsersForAdmin().some((p) => p.id === author.id), 'it is not in the list of members');
  const reg = await makeClient(app.base).request('/register', { method: 'POST', ...form([['username', 'sol-somebody'], ['displayName', 'X'], ['password', PASSWORD], ['inviteCode', models.generateNewInviteCode(models.getUserByUsername('ana').id).code]]) });
  assert.match(await reg.text(), /reserved/, 'and nobody can register a name like it');
});

test('a member claims the author; an admin agrees; the stories move', async () => {
  const author = models.getUserByUsername('sol-test-author');
  const page = await (await luis.request('/users/sol-test-author')).text();
  assert.match(page, /Imported author/);
  assert.match(page, /This is me/);
  await luis.request('/users/sol-test-author/claim', { method: 'POST', ...form([['message', 'I post there as Test Author.']]) });
  const waiting = models.listPendingClaims();
  assert.strictEqual(waiting.length, 1);
  assert.match(await (await admin.request('/admin')).text(), /I post there as Test Author/);
  assert.strictEqual(models.listStories()[0].author_id, author.id, 'nothing moves before an admin agrees');

  await admin.request(`/admin/claims/${waiting[0].id}/approve`, { method: 'POST', ...form([]) });
  const luisId = models.getUserByUsername('luis').id;
  const story = models.listStories()[0];
  assert.strictEqual(story.author_id, luisId);
  assert.ok(models.listChaptersForStory(story.id).every((c) => c.author_id === luisId));
  const res = await luis.request('/users/sol-test-author');
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), '/users/luis', 'the imported author is Luis now');
});

test('tags the vocabulary lacks are offered: add one, use a near spelling, or leave it off', async () => {
  const luisId = models.getUserByUsername('luis').id;
  models.proposeTag({ name: 'Coercion', userId: luisId });
  const epub = await solEpub({ id: 777, title: 'Tagged', chapters: ['<p>Words.</p>'], tags: 'Science-Fiction, Ma/ft, Reluctant, Coercion' });
  const html = await (await upload(admin, epub)).text();
  assert.match(html, /Not in the vocabulary yet/);
  assert.match(html, /<option value="use" selected>Use Science fiction<\/option>/, 'a near spelling is offered first');
  assert.match(html, /Approve the proposed tag/, 'a waiting proposal is offered for approval');
  assert.match(html, /name="group1">[\s\S]*?<option selected>Pairings<\/option>/, 'Ma/ft goes with the pairings');
  const key = /action="\/admin\/import\/([a-f0-9]{24})"/.exec(html)[1];

  await admin.request(`/admin/import/${key}`, { method: 'POST', ...form([
    ['title', 'Tagged'], ['tag0', 'use'], ['tag1', 'add'], ['group1', 'Pairings'],
    ['tag2', 'skip'], ['group2', 'Content notes'], ['tag3', 'add'], ['group3', 'Content notes'],
  ]) });
  const story = models.listStories().find((st) => st.title === 'Tagged');
  const names = models.getStoryTags(story.id).map((t) => t.name).sort();
  assert.deepStrictEqual(names, ['Coercion', 'Ma/ft', 'Science fiction']);
  const all = models.listTags();
  const maft = all.find((t) => t.name === 'Ma/ft');
  assert.strictEqual(maft.tag_group, 'Pairings');
  assert.notStrictEqual(maft.status, 'proposed', 'an added tag is in the vocabulary, not the queue');
  assert.strictEqual(all.find((t) => t.name === 'Coercion').status, 'approved');
  assert.ok(!all.some((t) => t.name === 'Reluctant'), 'what was left off was not added');
});

test('many at once: a .zip of EPUBs, each imported, duplicates skipped, tags proposed', async () => {
  const zip = new JSZip();
  zip.file('shelf/one.epub', await solEpub({ id: 9001, title: 'Batch One', chapters: ['<h2>Chapter 1</h2><p>A.</p>', '<h2>Chapter 2</h2><p>B.</p>'], tags: 'Science Fiction, Batchtag' }));
  zip.file('shelf/two.epub', await solEpub({ id: 9002, title: 'Batch Two', chapters: ['<p>Only.</p>'], tags: 'Science Fiction' }));
  zip.file('shelf/z-again.epub', await solEpub({ id: 9001, title: 'Batch One', chapters: ['<p>x</p>'] }));
  zip.file('shelf/broken.epub', Buffer.from('not a book'));
  zip.file('__MACOSX/shelf/._one.epub', Buffer.from('mac'));
  const body = await zip.generateAsync({ type: 'nodebuffer' });

  assert.strictEqual((await luis.request('/admin/import/batch', { method: 'POST', ...multipartWithFile([['tags', 'propose']], { name: 'file', filename: 'shelf.zip', body }) })).status, 403, 'admins only');

  const res = await admin.request('/admin/import/batch', {
    method: 'POST', headers: { Accept: 'application/json' },
    ...multipartWithFile([['tags', 'propose']], { name: 'file', filename: 'shelf.zip', body }),
  });
  assert.strictEqual(res.status, 200);
  const { results } = await res.json();
  assert.deepStrictEqual(results.map((r) => [r.file, r.status]), [
    ['broken.epub', 'error'], ['one.epub', 'imported'], ['two.epub', 'imported'], ['z-again.epub', 'duplicate'],
  ], 'in name order, the Mac\'s shadow copy left out');
  const one = models.listStories().find((s) => s.title === 'Batch One');
  const tags = models.getStoryTags(one.id).map((t) => [t.name, t.status || 'approved']);
  assert.ok(tags.some(([n, st]) => n === 'Batchtag' && st === 'proposed'), `proposed, and waiting: ${JSON.stringify(tags)}`);
  assert.ok(tags.some(([n]) => n === 'Science fiction'), 'the one the site has is used');

  // The same file on its own, again: already here.
  const single = await admin.request('/admin/import/batch', {
    method: 'POST', headers: { Accept: 'application/json' },
    ...multipartWithFile([['tags', 'skip']], { name: 'file', filename: 'two.epub', body: await solEpub({ id: 9002, title: 'Batch Two', chapters: ['<p>Only.</p>'] }) }),
  });
  assert.deepStrictEqual((await single.json()).results.map((r) => r.status), ['duplicate']);
});
