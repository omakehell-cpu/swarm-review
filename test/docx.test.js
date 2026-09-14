// Word round trips.
//
// A chapter goes out as .docx, somebody edits it in Word, and it comes
// back. Every assertion here is about what survives that journey -- which
// is the part the old hand-written reader kept getting wrong: numbered
// lists came back as bullets, tables and footnotes vanished, and the
// chapter's own title came back as a stray bold line in the prose.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { markdownToDocxBuffer, docxBufferToMarkdown, htmlToMarkdown } = require('../lib/docx');

// Out to Word and back again.
const roundTrip = async (markdown, title = 'Chapter One') =>
  docxBufferToMarkdown(await markdownToDocxBuffer({ title, markdownSource: markdown }));

test('prose survives unchanged', async () => {
  const md = 'The station had been dying for eleven years.\n\nNobody said so out loud.';
  const back = await roundTrip(md);
  assert.match(back, /The station had been dying for eleven years\./);
  assert.match(back, /Nobody said so out loud\./);
});

test('the chapter title does not come back as part of the text', async () => {
  // The title lives in its own field in this app. Writing it into the
  // document is a courtesy for reading it in Word; it must not reappear as
  // a bold first line every time the file is uploaded again.
  const back = await roundTrip('Just the prose.', 'A Distinctive Title');
  assert.ok(!back.includes('A Distinctive Title'), back);
  assert.match(back, /Just the prose\./);
});

test('emphasis survives', async () => {
  const back = await roundTrip('Some **bold** and *italic* and ***both*** and ~~struck~~ words.');
  assert.match(back, /\*\*bold\*\*|__bold__/);
  assert.match(back, /\*italic\*|_italic_/);
  assert.match(back, /~~struck~~/);
  assert.match(back, /both/);
});

test('headings keep their level', async () => {
  const back = await roundTrip('# One\n\n## Two\n\n### Three\n\nText.');
  assert.match(back, /^# One$/m);
  assert.match(back, /^## Two$/m);
  assert.match(back, /^### Three$/m);
});

test('a numbered list comes back numbered, not bulleted', async () => {
  // This is the regression the old reader could never pass: it wrote list
  // markers as literal text and read every list back as bullets.
  const back = await roundTrip('1. first\n2. second\n3. third');
  assert.match(back, /^1\. first$/m, back);
  assert.match(back, /^2\. second$/m, back);
  assert.match(back, /^3\. third$/m, back);
  assert.ok(!/^- first/m.test(back), 'it must not degrade into a bullet list');
});

test('two separate numbered lists each start at one', async () => {
  const back = await roundTrip('1. alpha\n2. beta\n\nA paragraph between them.\n\n1. gamma\n2. delta');
  const starts = back.split('\n').filter((line) => /^1\. /.test(line));
  assert.strictEqual(starts.length, 2, back);
});

test('a bullet list stays a bullet list', async () => {
  const back = await roundTrip('- one\n- two');
  assert.match(back, /^- one$/m);
  assert.match(back, /^- two$/m);
});

test('links keep their target', async () => {
  const back = await roundTrip('See [the wiki](https://swarmwiki.tampaad.net/) for more.');
  assert.match(back, /\[the wiki\]\(https:\/\/swarmwiki\.tampaad\.net\/?\)/);
});

test('inline code survives as inline code', async () => {
  const back = await roundTrip('Type `sudo reboot` and wait.');
  assert.match(back, /`sudo reboot`/);
});

test('a blockquote comes back as a blockquote', async () => {
  const back = await roundTrip('> She had said it first.\n\nAnd he remembered.');
  assert.match(back, /^> She had said it first\./m, back);
});

test('an empty chapter produces a document rather than throwing', async () => {
  const buffer = await markdownToDocxBuffer({ title: 'Empty', markdownSource: '' });
  assert.ok(Buffer.isBuffer(buffer) && buffer.length > 0);
  assert.strictEqual((await docxBufferToMarkdown(buffer)).trim(), '');
});

test('a .docx that is not a .docx fails loudly', async () => {
  await assert.rejects(() => docxBufferToMarkdown(Buffer.from('this is not a zip archive')));
});

// ---- the HTML mammoth hands us, converted on its own ------------------
// Word features this app's Markdown has no syntax for. The rule is that
// the words survive even when the formatting cannot.

test('table cells keep their text', () => {
  const md = htmlToMarkdown('<table><tr><th>Ship</th><th>Class</th></tr><tr><td>Kestrel</td><td>Anchorage</td></tr></table>');
  assert.match(md, /Ship \| Class/);
  assert.match(md, /Kestrel \| Anchorage/);
});

test('a footnote marker does not leave a bare anchor link in the prose', () => {
  const md = htmlToMarkdown('<p>A claim<a href="#footnote-1" id="ref-1">[1]</a>.</p><ol><li id="footnote-1">The note itself.</li></ol>');
  assert.ok(!md.includes('](#'), md);
  assert.match(md, /The note itself\./);
});

test('an embedded image is dropped rather than pasted in as base64', () => {
  const md = htmlToMarkdown('<p>Before <img src="data:image/png;base64,iVBORw0KGgo=" /> after.</p>');
  assert.strictEqual(md, 'Before  after.');
});

test('bold that swallowed its trailing space does not break the markdown', () => {
  // Word marks the space after a bold word as bold surprisingly often.
  const md = htmlToMarkdown('<p>A <strong>bold </strong>word.</p>');
  assert.strictEqual(md, 'A **bold** word.');
});

test('an empty bold run leaves no dangling asterisks', () => {
  assert.strictEqual(htmlToMarkdown('<p>Nothing <strong></strong>here.</p>'), 'Nothing here.');
});
