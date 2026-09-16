'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { compileStory } = require('../lib/compile');

const STORY = { title: 'Home is where we are', author_name: 'Ana Vilar', description: 'An anchorage.', synopsis: 'She cannot sleep.' };
const CHAPTERS = [
  { chapter_number: 1, title: 'The long watch', arc_title: 'Book One', content: 'Alpha.' },
  { chapter_number: 2, title: 'Seals', arc_title: '', content: 'Beta.' },
  { chapter_number: 3, title: 'The freighter', arc_title: 'Book Two', content: 'Gamma.' },
];

test('the manuscript is the chapters in order, with arcs as parts', () => {
  const out = compileStory(STORY, CHAPTERS);
  const lines = out.split('\n').filter(Boolean);
  assert.deepStrictEqual(
    lines.filter((l) => l.startsWith('#')),
    ['# Home is where we are', '# Book One', '## Chapter 1: The long watch',
      '## Chapter 2: Seals', '# Book Two', '## Chapter 3: The freighter']
  );
  // The text itself is carried through untouched.
  assert.ok(out.includes('Alpha.') && out.includes('Beta.') && out.includes('Gamma.'));
  // The order of the chapters is the order they came in.
  assert.ok(out.indexOf('Alpha.') < out.indexOf('Beta.'));
  assert.ok(out.indexOf('Beta.') < out.indexOf('Gamma.'));
});

test('the front matter is there, and the synopsis is not unless asked for', () => {
  const plain = compileStory(STORY, CHAPTERS);
  assert.ok(plain.includes('*by Ana Vilar*'));
  assert.ok(plain.includes('An anchorage.'));
  assert.ok(!plain.includes('She cannot sleep.'), 'a synopsis is a note to the group, not the front of the book');

  const withIt = compileStory(STORY, CHAPTERS, { synopsis: true });
  assert.ok(withIt.includes('## Synopsis'));
  assert.ok(withIt.includes('She cannot sleep.'));

  const bare = compileStory(STORY, CHAPTERS, { frontMatter: false });
  assert.ok(!bare.includes('*by Ana Vilar*'));
  assert.ok(bare.startsWith('# Book One'));
});

test('numbering can be dropped for a story that does not want it', () => {
  const out = compileStory(STORY, CHAPTERS, { numbers: false });
  assert.ok(out.includes('## The long watch'));
  assert.ok(!out.includes('## Chapter 1:'));
});

test('a story with no arcs reads as it always did', () => {
  const out = compileStory(STORY, CHAPTERS.map((c) => ({ ...c, arc_title: '' })));
  assert.ok(!out.includes('# Book'), 'no part headings invented');
  assert.strictEqual((out.match(/^## /gm) || []).length, 3);
});

test('the file ends once, not in a drift of blank lines', () => {
  const out = compileStory(STORY, [{ chapter_number: 1, title: 'One', content: 'Alpha.\n\n\n\n' }]);
  assert.ok(out.endsWith('Alpha.\n'), JSON.stringify(out.slice(-20)));
  assert.ok(!/\n{3}/.test(out), 'never three newlines in a row');
});
