'use strict';

// Replacing a chapter with a file you already have.
//
// The server side of this existed and worked -- a file in the edit form
// has always won over the box -- but it was a field called "Or upload a
// file instead", folded inside "Optional details", that did its work when
// you pressed Save. Nobody found it, and the one person who did had no
// way of telling what it was about to do.
//
// It is now its own control with its own button, which is what these
// tests are about: that the button publishes, and that pressing it with
// nothing chosen does not quietly save something else.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startApp, makeClient } = require('./helpers/app');

const ME = { username: 'uploader', displayName: 'Up Loader', password: 'correct horse battery' };
const BOUNDARY = '----swarmupload';

// A multipart body with whatever fields, and optionally a file, exactly as
// the editor's own form sends it.
function multipart(fields, file) {
  const parts = fields.map(([name, value]) => Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  ));
  if (file) {
    parts.push(Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n`
      + `Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`
    ), Buffer.isBuffer(file.body) ? file.body : Buffer.from(file.body), Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${BOUNDARY}`,
  };
}

let app; let models; let client; let chapter; let markdownToDocxBuffer;

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');
  const me = models.createUser({
    username: ME.username, displayName: ME.displayName,
    passwordHash: auth.hashPassword(ME.password), isAdmin: false,
  });
  const made = models.createStoryWithFirstChapter({
    title: 'Replaced', description: 'x', authorId: me.id,
    chapterTitle: 'The long watch', chapterSummary: 'Kessler cannot sleep.',
    content: 'The text that is in the database.',
  });
  chapter = made.chapter;
  client = makeClient(app.base);
  await client.login(ME.username, ME.password);
  ({ markdownToDocxBuffer } = require('../lib/docx'));
});

test.after(() => app.stop());

const post = (fields, file) => client.request(`/chapters/${chapter.id}/edit`, {
  method: 'POST', ...multipart(fields, file),
});

const base = () => [
  ['title', 'The long watch'],
  ['content', 'What is in the box, which is not what gets saved.'],
  ['changelog', ''],
  ['baseVersion', String(models.getLatestVersion(chapter.id).version_number)],
  ['upload', '1'],
];

test('the editor offers it, in the open', async () => {
  const html = await (await client.request(`/chapters/${chapter.id}/edit`)).text();
  assert.match(html, /Replace this chapter with a file/);
  assert.match(html, /name="upload" value="1"/, 'its own button, not the Save button');
  assert.match(html, /accept="\.md,\.markdown,\.txt,\.docx"/);
  // With a script, the editor's More menu brings a file into the box
  // instead; the form's own field is what works without one.
  assert.match(html, /class="no-js-only">\s*<div class="upload-version">/);
});

test('a file can be brought into the box without publishing it', async () => {
  const before = models.getLatestVersion(chapter.id).version_number;
  const boundary = '----swarmimport';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bits.md"\r\nContent-Type: text/markdown\r\n\r\n`),
    Buffer.from('A line from a file.'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await client.request('/markdown/import', {
    method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body,
  });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { text: 'A line from a file.' });
  assert.strictEqual(models.getLatestVersion(chapter.id).version_number, before, 'nothing was published');
});

test('a .md file becomes the next version', async () => {
  const before = models.getLatestVersion(chapter.id).version_number;
  const res = await post(base(), { name: 'watch.md', type: 'text/markdown', body: '# The long watch\n\nA line that came out of a file.' });
  assert.strictEqual(res.status, 302);
  const after = models.getLatestVersion(chapter.id);
  assert.strictEqual(after.version_number, before + 1);
  assert.match(after.content, /A line that came out of a file/);
  assert.ok(!/What is in the box/.test(after.content), 'the box lost, which is the whole point');
  assert.strictEqual(res.headers.get('location'), `/chapters/${chapter.id}?v=${after.version_number}`);
});

test('a .docx file becomes the next version, as text', async () => {
  const buffer = await markdownToDocxBuffer({
    title: 'The long watch',
    markdownSource: 'A paragraph that came **out of Word**.\n\nAnd a second one.',
  });
  const before = models.getLatestVersion(chapter.id).version_number;
  const res = await post(base(), {
    name: 'watch.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    body: buffer,
  });
  assert.strictEqual(res.status, 302);
  const after = models.getLatestVersion(chapter.id);
  assert.strictEqual(after.version_number, before + 1);
  assert.match(after.content, /out of Word/);
  assert.match(after.content, /\*\*out of Word\*\*/, 'and the bold survived the trip as markdown');
});

test('every version before it is still there', async () => {
  const versions = models.listVersions(chapter.id);
  assert.ok(versions.length >= 3, `three saves, three versions: ${versions.length}`);
  assert.match(versions[versions.length - 1].content, /The text that is in the database/,
    'including the one the chapter started with');
});

test('the button with nothing chosen saves nothing', async () => {
  const before = models.getLatestVersion(chapter.id);
  const res = await post(base(), null);
  assert.strictEqual(res.status, 400);
  const html = await res.text();
  assert.match(html, /Choose a \.md, \.txt or \.docx file first/);
  const after = models.getLatestVersion(chapter.id);
  assert.strictEqual(after.version_number, before.version_number, 'and no version happened');
  assert.strictEqual(after.content, before.content);
  // What was typed is still in the box it was typed in.
  assert.match(html, /What is in the box/);
});

test('a file that is not a file it can read says so', async () => {
  const before = models.getLatestVersion(chapter.id).version_number;
  const res = await post(base(), {
    name: 'broken.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    body: 'this is not a zip archive',
  });
  assert.strictEqual(res.status, 400);
  // The quotes round the file name arrive as &quot;, because everything
  // that goes on a page goes through escapeHtml -- including the name of
  // a file somebody else chose.
  assert.match(await res.text(), /Could not read &quot;broken\.docx&quot;/);
  assert.strictEqual(models.getLatestVersion(chapter.id).version_number, before);
});

test('Save still saves, with no file anywhere near it', async () => {
  const before = models.getLatestVersion(chapter.id).version_number;
  const res = await post([
    ['title', 'The long watch'],
    ['content', 'Typed, not uploaded.'],
    ['changelog', 'typed'],
    ['baseVersion', String(before)],
  ], null);
  assert.strictEqual(res.status, 302);
  const after = models.getLatestVersion(chapter.id);
  assert.strictEqual(after.version_number, before + 1);
  assert.strictEqual(after.content, 'Typed, not uploaded.');
});

const confirmSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'confirm-forms.js'), 'utf8'
);

test('the button asks, and the Save button beside it does not', () => {
  // One form, two buttons, one question. A confirmation on the form would
  // ask about every save; the message belongs to the button that was
  // pressed. (The same event.submitter the comment actions needed.)
  assert.match(confirmSource, /ev\)\.submitter/);
  assert.match(confirmSource, /fromButton \|\| \(form\.getAttribute/,
    "the form's own message is the fallback, not the first answer");
});
