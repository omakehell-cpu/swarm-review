// The wikitext -> HTML converter for glossary entries.
//
// The cases below are the shapes the real swarmwiki actually contains --
// literal HTML tags, wikitext tables, HTML entities, links with an empty
// label, a link somebody never closed -- rather than tidy textbook
// wikitext. The first version of this converter escaped everything, which
// is safe and unreadable: the glossary printed its own angle brackets.
'use strict';

const { useTempDatabase } = require('./helpers/tmpdb');
const tmp = useTempDatabase(); // must precede the require below: wiki -> models -> db

const test = require('node:test');
const assert = require('node:assert');

const { wikitextToHtml } = require('../lib/wiki');

test.after(() => tmp.cleanup());

const known = new Map([
  ['akarge', 'Akarge'],
  ['kestrel anchorage', 'Kestrel Anchorage'],
  ['m1 abrams', 'M1 Abrams'],
]);
const H = (src) => wikitextToHtml(src, known);

test('literal HTML tags render as HTML, not as visible text', () => {
  const h = H(`<h3>[https://storiesonline.net/s/23701/131-flavors 131 Flavors]</h3>
<h4>by:[[Akarge]]</h4>
A short (very short) pick up story. No sex.
<hr>
<b>Bold bit</b> of text.`);
  assert.ok(!h.includes('&lt;'), 'no escaped tags should remain');
  assert.ok(h.includes('<h3>') && h.includes('<h4>'));
  assert.ok(h.includes('<hr>'));
  assert.ok(h.includes('<b>Bold bit</b>'));
  assert.ok(h.includes('<a href="/glossary/Akarge">Akarge</a>'), 'internal link resolved');
  assert.ok(h.includes('storiesonline.net'), 'external link kept');
  assert.ok(!/<p>\s*<h3>/.test(h), 'a heading must not be wrapped in a paragraph');
});

test('tags outside the allowlist stay inert text', () => {
  const h = H('Danger <script>alert(1)</script> and <iframe src="x"></iframe> end.');
  assert.ok(!h.includes('<script'));
  assert.ok(!h.includes('<iframe'));
  assert.ok(h.includes('&lt;script&gt;'), 'shown as text instead');
});

test('attributes are stripped from allowed tags', () => {
  const h = H('<div style="font-size: 150%;"><center><b>NO STORIES</b></center></div>');
  assert.ok(!h.includes('style='));
  assert.ok(h.includes('<div>') && h.includes('<center>'));
});

test('HTML entities decode instead of showing raw', () => {
  const h = H('Spaced&nbsp;out &amp; punctuated &mdash; nicely&hellip;');
  assert.ok(!h.includes('&amp;nbsp;'), 'no double-escaped nbsp');
  assert.ok(h.includes(' '), 'nbsp became a real non-breaking space');
  assert.ok(h.includes('—') && h.includes('…'));
  assert.ok(h.includes('&amp;'), 'a literal ampersand is still escaped for HTML');
});

test('the pipe trick leaves no brackets behind', () => {
  const h = H('This wiki currently has [[Special:AllPages|]] articles.');
  assert.ok(!h.includes('[['));
  assert.ok(h.includes('Special:AllPages'), 'target used as the label');
});

test('an unclosed link degrades to plain text', () => {
  const h = H('* 001-041+ [[Absecon Class');
  assert.ok(!h.includes('[['));
  assert.ok(h.includes('Absecon Class'));
});

test('wikitext tables become real tables', () => {
  const h = H(`{| cellspacing='0' cellpadding='1' border='1'
|- valign='top'
! scope='col' | ACRONYM
! scope='col' | Expanded
! scope='col' | Comments
|- valign='top'
! scope='row' | [[M1 Abrams]]
| Main battle tank
| Still in service
|}`);
  assert.ok(h.includes('<table'));
  assert.ok(h.includes('<th>ACRONYM</th>'), 'header cell without its attributes');
  assert.ok(h.includes('<td>Main battle tank</td>'));
  assert.ok(h.includes('<a href="/glossary/M1%20Abrams">M1 Abrams</a>'), 'links work inside cells');
  assert.ok(!h.includes('{|') && !h.includes('|-') && !h.includes('scope='), 'no raw markup left');
  assert.ok(!/<p>[^<]*<table/.test(h), 'table not wrapped in a paragraph');
});

test('plain wikitext still renders as before', () => {
  const h = H(`== A heading ==
Some '''bold''' and ''italic'' text with [[Kestrel Anchorage]].

* one
* two`);
  assert.ok(h.includes('<h2>A heading</h2>'));
  assert.ok(h.includes('<strong>bold</strong>') && h.includes('<em>italic</em>'));
  assert.ok(h.includes('<ul><li>one</li><li>two</li></ul>'));
  assert.ok(h.includes('/glossary/Kestrel%20Anchorage'));
});

test('templates, files and categories are dropped', () => {
  const h = H(`{{Infobox|name=Foo}}
[[File:Cover.png|thumb|A cover]]Real text.[[Category:Ships]]`);
  assert.ok(!h.includes('{{') && !h.includes('Infobox'));
  assert.ok(!h.includes('Cover.png') && !h.includes('Category'));
  assert.ok(h.includes('Real text.'));
});
