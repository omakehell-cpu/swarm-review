'use strict';

// The layout model, and the two writers that read it.
//
// The point of typesetting from a document rather than from a string of
// markdown is that every format agrees about what things *are*. These
// tests are mostly about that agreement: a scene break is a scene break in
// all three, and the first paragraph after one is the first paragraph
// after one.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { typesetStory, preset, layoutName, surnameOf, runsOf, plainText, LAYOUTS } = require('../lib/typeset');
const { renderEpub } = require('../lib/epub');
const { renderPdf } = require('../lib/pdf');
const { zip, crc32 } = require('../lib/zip');

const STORY = {
  title: 'Home is where we are',
  author_name: 'Ana Vilar',
  description: 'A slow, cold story.',
  synopsis: 'Everybody leaves.',
};
const CHAPTERS = [
  {
    chapter_number: 1, title: 'The long watch', arc_title: 'Book One', word_count: 40,
    content: 'Kessler came up.\n\nPrado had left the hatch open.\n\n---\n\nAt six the drop came down. He **stopped**.',
  },
  { chapter_number: 2, title: 'Seals and signatures', arc_title: '', word_count: 20, content: 'Prado signed it.' },
];

test('an unknown layout is the safe one, not an error', () => {
  assert.strictEqual(layoutName('book'), 'book');
  assert.strictEqual(layoutName('manuscript'), 'manuscript');
  assert.strictEqual(layoutName('elvish'), 'manuscript');
  assert.strictEqual(layoutName(undefined), 'manuscript');
  for (const name of LAYOUTS) assert.ok(preset(name).serif, `${name} is a real preset`);
});

test('the two layouts are different documents, not two skins', () => {
  const m = preset('manuscript');
  const b = preset('book');
  assert.strictEqual(m.lineHeight, 2, 'a manuscript is double-spaced');
  assert.ok(b.lineHeight < 1.6, 'a book is not');
  assert.strictEqual(m.justify, false, 'a manuscript is ragged right');
  assert.strictEqual(b.justify, true, 'a book is justified');
  assert.strictEqual(b.chapterOpensOnRecto, true, 'a book opens its chapters on the right');
  assert.strictEqual(m.chapterOpensOnRecto, false);
  // The scene break has to exist in the standard PDF encoding, or it
  // silently draws as a different letter.
  for (const name of LAYOUTS) {
    assert.match(preset(name).sceneBreak, /^[\x20-\x7E]+$/, `${name}'s scene break survives WinAnsi`);
  }
});

test('a story becomes blocks that know what they are', () => {
  const doc = typesetStory(STORY, CHAPTERS, { layout: 'book', synopsis: true });
  const kinds = doc.blocks.map((b) => b.type);
  assert.strictEqual(kinds[0], 'titlePage');
  assert.ok(kinds.includes('part'), 'the arc became a part');
  assert.strictEqual(kinds.filter((k) => k === 'chapter').length, 2);
  assert.ok(kinds.includes('sceneBreak'), 'the rule became a scene break, not a rule');
  assert.strictEqual(doc.surname, 'Vilar');
});

test('the first paragraph after a chapter or a scene break is marked', () => {
  const doc = typesetStory(STORY, CHAPTERS, {});
  const paragraphs = doc.blocks.filter((b) => b.type === 'paragraph');
  assert.strictEqual(paragraphs[0].opening, true, 'the first of the chapter');
  assert.strictEqual(paragraphs[1].opening, false, 'the second is not');
  const afterBreak = doc.blocks[doc.blocks.findIndex((b) => b.type === 'sceneBreak') + 1];
  assert.strictEqual(afterBreak.opening, true, 'and the first after a break is');
});

test('styling survives being flattened into runs', () => {
  const doc = typesetStory(STORY, CHAPTERS, {});
  const runs = doc.blocks.filter((b) => b.type === 'paragraph').flatMap((b) => runsOf(b.inline));
  assert.ok(runs.some((r) => r.bold), 'the bold word is still bold');
  assert.ok(plainText(doc.blocks.find((b) => b.type === 'paragraph').inline).includes('Kessler'));
});

test('a surname is the last word, and nothing when there is no name', () => {
  assert.strictEqual(surnameOf('Ana Vilar'), 'Vilar');
  assert.strictEqual(surnameOf('Prado'), 'Prado');
  assert.strictEqual(surnameOf(''), '');
  assert.strictEqual(surnameOf(null), '');
});

// --- the zip underneath the EPUB ---

test('the zip writer writes a zip somebody else can read', () => {
  const buf = zip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'a.txt', data: 'hello '.repeat(100) },
  ]);
  assert.strictEqual(buf.readUInt32LE(0), 0x04034B50, 'a local file header');
  // Stored, first, uncompressed: the EPUB specification requires exactly
  // this and a reader sniffs for it at a fixed offset.
  assert.strictEqual(buf.readUInt16LE(8), 0, 'the first entry is stored');
  assert.strictEqual(buf.slice(30, 38).toString(), 'mimetype');
  assert.strictEqual(buf.slice(38, 58).toString(), 'application/epub+zip');
  // And the second entry really is deflated, and inflates back.
  const nameLen = buf.readUInt16LE(30 + 8 + 20 + 26);
  const start = 30 + 8 + 20 + 30 + nameLen;
  const size = buf.readUInt32LE(30 + 8 + 20 + 18);
  assert.strictEqual(zlib.inflateRawSync(buf.slice(start, start + size)).toString(), 'hello '.repeat(100));
});

test('crc32 agrees with everybody else about crc32', () => {
  // The one value every implementation quotes, so a broken table shows up
  // here rather than in somebody's e-reader.
  assert.strictEqual(crc32(Buffer.from('123456789')), 0xCBF43926);
});

// --- EPUB ---

test('the EPUB has the four things a reader looks for', () => {
  const doc = typesetStory(STORY, CHAPTERS, { layout: 'book' });
  const buf = renderEpub(doc);
  const text = buf.toString('latin1');
  for (const name of ['mimetype', 'META-INF/container.xml', 'OEBPS/package.opf', 'OEBPS/nav.xhtml']) {
    assert.ok(text.includes(name), `${name} is in it`);
  }
  assert.ok(text.indexOf('mimetype') < text.indexOf('container.xml'), 'and mimetype is first');
});

test('the same story compiles to the same bytes twice', () => {
  // Not pedantry: a timestamp in the zip would make every download a
  // different file, so no checksum, diff or cache ever means anything.
  const doc = typesetStory(STORY, CHAPTERS, { layout: 'book' });
  assert.ok(renderEpub(doc).equals(renderEpub(typesetStory(STORY, CHAPTERS, { layout: 'book' }))));
});

test("a chapter's prose survives into the EPUB, escaped", () => {
  const doc = typesetStory(
    { ...STORY, title: 'Jack & Jill <b>' },
    [{ chapter_number: 1, title: 'One', arc_title: '', word_count: 4, content: 'He said "no" & left.' }],
    {}
  );
  const buf = renderEpub(doc);
  const chapterFile = namesIn(buf).find((n) => /^OEBPS\/ch\d+\.xhtml$/.test(n));
  assert.ok(chapterFile, 'there is a chapter file');
  const raw = zlib.inflateRawSync(chunkOf(buf, chapterFile)).toString('utf8');
  assert.match(raw, /He said &quot;no&quot; &amp; left\./);
  assert.ok(!raw.includes('<b>'), 'a title with a tag in it does not become a tag');
});

function namesIn(buf) {
  const names = [];
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034B50) {
    const nameLen = buf.readUInt16LE(at + 26);
    const extraLen = buf.readUInt16LE(at + 28);
    const size = buf.readUInt32LE(at + 18);
    names.push(buf.slice(at + 30, at + 30 + nameLen).toString());
    at = at + 30 + nameLen + extraLen + size;
  }
  return names;
}

// Pulls one file back out of the zip, which is also a check that the
// offsets in the headers are right.
function chunkOf(buf, wanted) {
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034B50) {
    const nameLen = buf.readUInt16LE(at + 26);
    const extraLen = buf.readUInt16LE(at + 28);
    const size = buf.readUInt32LE(at + 18);
    const name = buf.slice(at + 30, at + 30 + nameLen).toString();
    const start = at + 30 + nameLen + extraLen;
    if (name === wanted) return buf.slice(start, start + size);
    at = start + size;
  }
  throw new Error(`${wanted} is not in there`);
}

// --- PDF ---

test('the PDF is a PDF, and says what it is of', async () => {
  const doc = typesetStory(STORY, CHAPTERS, { layout: 'manuscript' });
  const buf = await renderPdf(doc);
  assert.strictEqual(buf.slice(0, 5).toString(), '%PDF-');
  assert.ok(buf.slice(-1024).toString('latin1').includes('%%EOF'), 'and it is finished');
  assert.ok(buf.length > 1000, 'with something in it');
});

const pagesIn = (buf) => Number((buf.toString('latin1').match(/\/Count\s+(\d+)/) || [])[1] || 0);

// A few thousand words, because the two layouts differ by how much text
// they fit on a page and a three-line fixture cannot show that.
const LONG = [{
  id: 1, chapter_number: 1, title: 'One', arc_title: '',
  content: Array.from({ length: 60 }, (_, i) =>
    `Paragraph ${i} of a chapter that goes on for a while, long enough that the `
    + 'lines wrap several times and the page has to decide where to break, which '
    + 'is the whole of what a layout is for.').join('\n\n'),
}, {
  id: 2, chapter_number: 2, title: 'Two', arc_title: '',
  content: Array.from({ length: 60 }, (_, i) =>
    `Another paragraph, number ${i}, with enough words in it to wrap more than `
    + 'once so that leading and measure both matter to where it ends.').join('\n\n'),
}];

test('the book layout fits more on a page than the manuscript one', async () => {
  // Manuscript is double-spaced with an inch of margin; book is single
  // spaced, smaller and tighter. Same words, so the book must be shorter.
  // It was not: a folio written below the bottom margin made pdfkit start
  // a fresh page for every page it stamped, and the book came out twice
  // its own length.
  const asManuscript = await renderPdf(typesetStory(STORY, LONG, { layout: 'manuscript' }));
  const asBook = await renderPdf(typesetStory(STORY, LONG, { layout: 'book' }));
  const m = pagesIn(asManuscript);
  const b = pagesIn(asBook);
  assert.ok(m > 4, `the fixture is long enough to paginate, got ${m} pages`);
  assert.ok(b < m, `book ${b} pages, manuscript ${m} -- the book must be the shorter one`);
});

test('a folio does not cost a page', async () => {
  // The same bug from the other side, and the reason for the number: a
  // book page holds roughly twice what a double-spaced manuscript page
  // holds, and the recto rule spends one blank page per chapter against
  // that. Three quarters is the loosest bound that still fails the day
  // something starts a page it should not.
  const m = pagesIn(await renderPdf(typesetStory(STORY, LONG, { layout: 'manuscript' })));
  const b = pagesIn(await renderPdf(typesetStory(STORY, LONG, { layout: 'book' })));
  assert.ok(b <= m * 0.75, `book ${b} pages against manuscript ${m}: not tight enough to be set`);
});

test('a story with nothing in it does not take the compiler down with it', async () => {
  const empty = typesetStory({ title: 'Nothing', author_name: '' }, [], {});
  assert.ok((await renderPdf(empty)).length > 500);
  assert.ok(renderEpub(empty).length > 500);
});

// --- typographic quotes ---

const QUOTED = [{
  chapter_number: 1, title: 'Quoted', arc_title: '', word_count: 20,
  content: '"That\'s mine," she said. The girls\' room. Then `git commit -m "x"` ran.',
}];

test('the book curls its quotes and the manuscript leaves them alone', () => {
  const body = (layout) => typesetStory(STORY, QUOTED, { layout, frontMatter: false })
    .blocks.filter((b) => b.type === 'paragraph').map((b) => plainText(b.inline)).join('');

  const book = body('book');
  assert.ok(book.includes('“That’s mine,”'), `quotes and apostrophe curled: ${book}`);
  assert.ok(book.includes('girls’ room'), 'a plural possessive closes rather than opens');
  // The code span is the only straight pair left, and it is left on purpose.
  assert.strictEqual(book.replace('git commit -m "x"', '').indexOf('"'), -1,
    'nothing straight is left in the prose');

  const manuscript = body('manuscript');
  assert.ok(manuscript.includes('"That\'s mine," she said'),
    'a manuscript is the text as it was typed');
});

test('a code span keeps its straight quotes, and does not confuse the next one', () => {
  const doc = typesetStory(STORY, QUOTED, { layout: 'book', frontMatter: false });
  const runs = doc.blocks.filter((b) => b.type === 'paragraph')
    .flatMap((b) => Array.from(runsOf(b.inline)));
  const code = runs.find((r) => r.mono);
  assert.ok(code && code.text.includes('"x"'), `a quote in code is a character: ${code && code.text}`);
});

test('a quote around an italic word is still one pair', () => {
  const doc = typesetStory(STORY, [{
    chapter_number: 1, title: 'x', arc_title: '', content: 'He said "*now*" and left.',
  }], { layout: 'book', frontMatter: false });
  const text = doc.blocks.filter((b) => b.type === 'paragraph').map((b) => plainText(b.inline)).join('');
  assert.ok(text.includes('“now”'), `open then close across the italic: ${text}`);
});
