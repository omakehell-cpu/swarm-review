// Comment anchoring.
//
// A comment is stored as a pair of character offsets into the *flattened*
// text of a chapter -- the prose with every mark of markdown removed, but
// nothing else added or taken away. The renderer walks the same flattened
// space when it wraps highlights, which is the only reason a comment made
// on a phrase inside a bold run lands back on that phrase.
//
// Everything here is really one invariant: flattenLength() and the
// renderer must agree, character for character, about what the text is.
// It is also the contract to check first if the markdown renderer is ever
// swapped for a library -- a renderer that emits the same HTML but counts
// its characters differently would silently slide every existing comment
// in the archive off its quote.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parseMarkdown, flattenLength, renderHighlighted, renderPlainText } = require('../lib/markdown');

// Where `needle` starts in the flattened text -- the offset the browser
// would have computed from a selection, and what gets stored.
function flatten(source) {
  const blocks = parseMarkdown(source);
  let out = '';
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type === 'text' || n.type === 'code') out += n.value;
      else walk(n.children);
    }
  };
  for (const b of blocks) {
    if (b.type === 'hr') continue;
    if (b.type === 'ul' || b.type === 'ol') b.items.forEach(walk);
    else walk(b.inline);
  }
  return out;
}

function anchor(source, needle, id = 1) {
  const flat = flatten(source);
  const start = flat.indexOf(needle);
  assert.notStrictEqual(start, -1, `"${needle}" is not in the flattened text`);
  return { id, parent_id: null, start_offset: start, end_offset: start + needle.length };
}

test('the flattened length is the length of the flattened text', () => {
  const source = 'A **bold** claim and *an italic* one, with `code` too.\n\n- a list item\n- another';
  assert.strictEqual(flattenLength(parseMarkdown(source)), flatten(source).length);
});

test('markdown marks do not count toward offsets', () => {
  // "bold" sits at index 2 of "A bold claim", not at index 4 where the
  // asterisks would put it.
  const source = 'A **bold** claim.';
  assert.strictEqual(flatten(source), 'A bold claim.');
  assert.strictEqual(flatten(source).indexOf('bold'), 2);
});

test('a highlight wraps exactly the quoted words', () => {
  const source = 'She pressed her palm to the cold viewport.';
  const html = renderHighlighted(parseMarkdown(source), [anchor(source, 'cold viewport')], null);
  assert.match(html, /<span class="hl[^"]*"[^>]*>cold viewport<\/span>/);
});

test('a highlight inside a bold run keeps the bold and the highlight nested properly', () => {
  const source = 'The **cold viewport** was fogged.';
  const html = renderHighlighted(parseMarkdown(source), [anchor(source, 'cold viewport')], null);
  assert.ok(html.includes('<strong>'), 'the bold survives');
  assert.match(html, /<strong><span class="hl[^"]*"[^>]*>cold viewport<\/span><\/strong>/);
  // Not "colour**d viewport" or similar: the marks must not leak into the text.
  assert.ok(!html.includes('**'));
});

test('a highlight spanning a bold boundary does not produce crossed tags', () => {
  const source = 'The **cold** viewport was fogged.';
  const html = renderHighlighted(parseMarkdown(source), [anchor(source, 'cold viewport')], null);
  // The highlight is cut at the </strong>: two well-nested spans rather
  // than one that straddles the boundary and crosses its tags.
  const hits = html.match(/<span class="hl[^"]*"[^>]*>/g) || [];
  assert.strictEqual(hits.length, 2, html);
  assert.ok(html.includes('<strong><span class="hl'), 'the first sits inside the bold');
  assert.ok(!/<span class="hl[^"]*"[^>]*>[^<]*<\/strong>/.test(html), 'no span closes a tag it did not open');
  assert.strictEqual((html.match(/<span/g) || []).length, (html.match(/<\/span>/g) || []).length);
});

test('two comments on the same words merge into one highlight carrying both ids', () => {
  const source = 'She pressed her palm to the cold viewport.';
  const html = renderHighlighted(
    parseMarkdown(source),
    [anchor(source, 'cold viewport', 7), anchor(source, 'cold viewport', 9)],
    null
  );
  const m = /data-comment-ids="([^"]+)"/.exec(html);
  assert.ok(m, 'a highlight with comment ids');
  assert.deepStrictEqual(m[1].split(',').sort(), ['7', '9']);
});

test('offsets past the end of the text are clamped, not thrown', () => {
  const source = 'Short.';
  const html = renderHighlighted(
    parseMarkdown(source),
    [{ id: 1, parent_id: null, start_offset: 3, end_offset: 9999 }],
    null
  );
  assert.match(html, /<span class="hl[^"]*"/);
  assert.ok(html.includes('rt.'), 'the real text is still all there');
});

test('replies carry no offsets and highlight nothing', () => {
  const source = 'Short paragraph.';
  const html = renderHighlighted(
    parseMarkdown(source),
    [{ id: 2, parent_id: 1, start_offset: null, end_offset: null }],
    null
  );
  assert.ok(!html.includes('class="hl'));
});

test('the plain-text rendering keeps the prose and drops the markup', () => {
  const text = renderPlainText(parseMarkdown('A **bold** claim.\n\n---\n\n- one\n- two'));
  assert.match(text, /A bold claim\./);
  assert.ok(!text.includes('**'));
});
