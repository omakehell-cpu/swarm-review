'use strict';

const test = require('node:test');
const assert = require('node:assert');
const taxonomy = require('../lib/glossary-taxonomy');

// The wiki's categories answer three different questions at once. These
// tests are the record of which category answers which, because getting it
// wrong is what made the old index a 691-line pile.

test('a category is a kind, a state, housekeeping or a subject -- never two', () => {
  assert.strictEqual(taxonomy.isStructural('All'), true);
  assert.strictEqual(taxonomy.isKind('Stories'), true);
  assert.strictEqual(taxonomy.isStatus('Canon'), true);
  assert.strictEqual(taxonomy.isMaintenance('Wiki Maintenance'), true);
  assert.strictEqual(taxonomy.isTopical('Navy'), true);

  for (const not of ['All', 'Stories', 'Authors', 'Canon', 'Stubs', 'Temporary', 'Useless']) {
    assert.strictEqual(taxonomy.isTopical(not), false, `${not} is not a subject`);
  }
});

test('what a page is comes from its categories, and Authors beats Stories', () => {
  assert.strictEqual(taxonomy.pageKind(['Stories', 'Canon']), 'stories');
  assert.strictEqual(taxonomy.pageKind(['Authors', 'Stories']), 'authors');
  // Everything the wiki never labelled is a world term -- the right default
  // for a glossary of a shared setting.
  assert.strictEqual(taxonomy.pageKind(['Canon', 'Stubs']), 'world');
  assert.strictEqual(taxonomy.pageKind([]), 'world');
});

test('subjects gather into families, biggest first, in a fixed order', () => {
  const families = taxonomy.groupIntoFamilies([
    { category: 'All', n: 691 },
    { category: 'Stories', n: 314 },
    { category: 'Canon', n: 154 },
    { category: 'Culture', n: 15 },
    { category: 'Navy', n: 50 },
    { category: 'Ships', n: 42 },
    { category: 'Warships', n: 44 },
  ]);
  assert.deepStrictEqual(families.map((f) => f.name), ['Fleet and ships', 'Military', 'Society and government']);
  assert.deepStrictEqual(families[0].categories.map((c) => c.category), ['Warships', 'Ships']);
  assert.strictEqual(families[0].total, 86);
});

test('a category the wiki invents later still shows up, under Other', () => {
  const families = taxonomy.groupIntoFamilies([{ category: 'Something New', n: 3 }]);
  assert.deepStrictEqual(families.map((f) => f.name), [taxonomy.OTHER_FAMILY]);
});

test('titles that do not start with a letter share one bucket', () => {
  assert.strictEqual(taxonomy.letterOf('Akarge'), 'A');
  assert.strictEqual(taxonomy.letterOf('  kestrel'), 'K');
  assert.strictEqual(taxonomy.letterOf('131 Flavors'), '#');
  assert.strictEqual(taxonomy.letterOf(''), '#');

  const blocks = taxonomy.groupByLetter([
    { title: '131 Flavors' }, { title: 'Akarge' }, { title: 'A20' }, { title: 'Kestrel' },
  ]);
  assert.deepStrictEqual(blocks.map((b) => b.letter), ['#', 'A', 'K']);
  assert.strictEqual(blocks[1].pages.length, 2);
  // An empty letter is a hole, not information, so it is not a section.
  assert.ok(!blocks.some((b) => b.letter === 'Q'));
});

test('the filters compose, and none of them is case-sensitive', () => {
  const pages = [
    { title: 'A20', title_lower: 'a20', summary: 'An interface craft.' },
    { title: 'Akarge', title_lower: 'akarge', summary: 'A trading concern.' },
    { title: 'A Story', title_lower: 'a story', summary: '' },
  ];
  const byPage = new Map([
    ['a20', ['Ships', 'Canon']],
    ['akarge', ['Economy', 'Stubs']],
    ['a story', ['Stories']],
  ]);

  const world = taxonomy.selectPages(pages, byPage, { kind: 'world' });
  assert.deepStrictEqual(world.map((p) => p.title), ['A20', 'Akarge']);
  assert.deepStrictEqual(
    taxonomy.selectPages(pages, byPage, { category: 'ships' }).map((p) => p.title), ['A20']
  );
  assert.deepStrictEqual(
    taxonomy.selectPages(pages, byPage, { kind: 'world', status: 'Canon' }).map((p) => p.title), ['A20']
  );
  // The search looks at the summary too, so "trading" finds a page whose
  // title never says it.
  assert.deepStrictEqual(
    taxonomy.selectPages(pages, byPage, { q: 'TRADING' }).map((p) => p.title), ['Akarge']
  );
  assert.deepStrictEqual(taxonomy.countKinds(pages, byPage), { world: 2, stories: 1, authors: 0 });
  assert.deepStrictEqual(taxonomy.statusCounts(pages, byPage), [
    { category: 'Canon', n: 1 }, { category: 'Stubs', n: 1 },
  ]);
});
