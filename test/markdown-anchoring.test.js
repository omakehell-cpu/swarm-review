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

const { parseMarkdown, flattenLength, renderHighlighted, renderPlainText, countWords } = require('../lib/markdown');

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

// ---- what changed when markdown-it took over the parsing --------------
// The hand-written parser this replaced got these wrong. They are listed
// here rather than in a commit message because each one moves characters,
// and characters are where comments are anchored: before switching, every
// stored version in the live archive was flattened both ways and compared,
// and all twelve came out byte for byte identical. These are the cases
// where they would not have.

test('a backslash escapes a markdown character instead of showing up', () => {
  // The old parser had no escape syntax, so it printed the backslash and
  // ate the asterisks -- which is why "a stray * in an uploaded Word
  // document" used to be a documented hazard.
  assert.strictEqual(flatten('A literal \\*asterisk\\* here.'), 'A literal *asterisk* here.');
});

test('underscores inside a word are not emphasis', () => {
  // The old parser turned file_name_here into "filenamehere", in italics.
  assert.strictEqual(flatten('The file_name_here is odd.'), 'The file_name_here is odd.');
  assert.strictEqual(flatten('un*frigging*believable'), 'unfriggingbelievable');
});

test('an indented list is a nested list, not raw text', () => {
  // The old parser failed to match the indented line, gave up on the whole
  // block, and rendered the dashes as prose.
  const blocks = parseMarkdown('- one\n  - nested\n- two');
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].type, 'ul');
  assert.strictEqual(flatten('- one\n  - nested\n- two'), 'onenestedtwo');
});

test('a lone asterisk in prose is still just an asterisk', () => {
  assert.strictEqual(flatten('He was 5*7 feet, roughly.'), 'He was 5*7 feet, roughly.');
});

test('unclosed emphasis stays literal rather than swallowing the rest', () => {
  assert.strictEqual(flatten('She said **wait, and stopped.'), 'She said **wait, and stopped.');
});

test('raw HTML in a chapter is text, not markup', () => {
  const html = renderHighlighted(parseMarkdown('Text with <b>tags</b> in it.'), [], null);
  assert.ok(!html.includes('<b>'), html);
  assert.match(html, /&lt;b&gt;/);
});

test('a javascript: link never becomes a link', () => {
  // markdown-it validates the target itself and refuses this one, so it
  // stays literal text -- better than the old behaviour, which built an
  // anchor and then pointed it at "#".
  const html = renderHighlighted(parseMarkdown('[click](javascript:alert(1))'), [], null);
  assert.ok(!html.includes('<a '), html);
  assert.ok(!html.includes('href'), html);
});

test('table syntax is not a table here, and its text is left alone', () => {
  // Enabling tables would add a block type renderHighlighted would have to
  // learn to count characters through. Until it does, the pipes are prose.
  assert.match(flatten('| a | b |\n| - | - |'), /\| a \| b \|/);
});

// ---- word counts ------------------------------------------------------
// Stored with every version and shown in three places, so it has to count
// what a writer means by a word: the prose, and nothing that is only there
// to tell the renderer what to do with it.

test('markdown marks are not words', () => {
  assert.strictEqual(countWords('**Kestrel Anchorage**'), 2);
  assert.strictEqual(countWords('*aboard* the ~~old~~ station'), 4);
  assert.strictEqual(countWords('# A heading\n\nAnd a line.'), 5);
});

test('a link counts its text and not its target', () => {
  // renderPlainText writes a link as "the wiki (https://...)", which is
  // right for a .txt file and would put four more words in this count.
  assert.strictEqual(countWords('See [the wiki](https://swarmwiki.tampaad.net/) now.'), 4);
});

test('list markers and scene breaks are not words', () => {
  assert.strictEqual(countWords('- one\n- two\n- three'), 3);
  assert.strictEqual(countWords('1. first\n2. second'), 2);
  assert.strictEqual(countWords('Before.\n\n---\n\nAfter.'), 2);
});

test('words are not fused across a paragraph or a list item', () => {
  assert.strictEqual(countWords('End.\n\nStart.'), 2);
  assert.strictEqual(countWords('- alpha\n- beta'), 2);
});

test('hyphens and apostrophes stay inside their word', () => {
  assert.strictEqual(countWords("It's a well-lit room, isn't it?"), 6);
  assert.strictEqual(countWords('She said \u2018don\u2019t\u2019.'), 3);
});

test('an empty chapter has no words', () => {
  assert.strictEqual(countWords(''), 0);
  assert.strictEqual(countWords('   \n\n  '), 0);
});

test('a realistic paragraph counts the way a person would', () => {
  const para = 'The station had been dying for eleven years, and nobody who lived there said so out loud.';
  assert.strictEqual(countWords(para), para.split(/\s+/).length);
});
