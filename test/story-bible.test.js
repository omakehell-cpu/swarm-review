'use strict';

const test = require('node:test');
const assert = require('node:assert');
const bible = require('../lib/story-bible');

// The scan is the part of the bible that can be wrong in ways nobody
// notices for months -- a character quietly missing from half their own
// chapters. These are the rules it is allowed to follow.

test('a name is found where it is named, and nowhere else', () => {
  const matcher = bible.buildMatcher([{ id: 1, name: 'Kessler' }]);
  const hits = bible.scanText(
    "Kessler came up the spine. Kessler's boots rang. Kesslerian nonsense, said MacKessler.",
    matcher
  );
  // Twice: the plain name and the possessive. Not the longer word that
  // merely starts the same way, and not the one it sits inside.
  assert.strictEqual(hits.get(1).mentions, 2);
});

test('an alias counts as the character, and the first name used is kept', () => {
  const matcher = bible.buildMatcher([{ id: 1, name: 'Commodore Raye', aliases: ['the Old Man', 'Raye'] }]);
  const hits = bible.scanText('The Old Man said nothing. Raye never did. Commodore Raye least of all.', matcher);
  assert.strictEqual(hits.get(1).mentions, 3);
  assert.strictEqual(hits.get(1).firstName, 'The Old Man');
});

test('a longer name wins over a shorter one standing inside it', () => {
  const matcher = bible.buildMatcher([{ id: 1, name: 'Raye' }, { id: 2, name: 'Commodore Raye' }]);
  const hits = bible.scanText('Commodore Raye came aboard.', matcher);
  assert.ok(!hits.has(1), 'the short name did not fire inside the long one');
  assert.strictEqual(hits.get(2).mentions, 1);
});

test('a name two entries share is counted for neither, and reported', () => {
  const matcher = bible.buildMatcher([
    { id: 1, name: 'Kessler', aliases: ['the Old Man'] },
    { id: 2, name: 'Prado', aliases: ['the Old Man'] },
  ]);
  const hits = bible.scanText('The Old Man said nothing. Kessler did.', matcher);
  assert.strictEqual(hits.size, 1, 'only the unambiguous name counted');
  assert.strictEqual(hits.get(1).mentions, 1);
  assert.deepStrictEqual(matcher.conflicts.map((c) => c.name), ['the old man']);
});

test('names with apostrophes and hyphens survive the regex', () => {
  const matcher = bible.buildMatcher([
    { id: 1, name: "Sa'arm" }, { id: 2, name: "O'Brien" }, { id: 3, name: 'A-22' },
  ]);
  const hits = bible.scanText("The Sa'arm came. O'Brien flew the A-22.", matcher);
  assert.deepStrictEqual([...hits.keys()].sort(), [1, 2, 3]);
});

test('code is not prose', () => {
  const matcher = bible.buildMatcher([{ id: 1, name: 'Kessler' }]);
  assert.strictEqual(bible.scanText('`Kessler` and ```\nKessler\n```', matcher).size, 0);
  assert.strictEqual(bible.scanText('Kessler walked in. `Kessler`', matcher).get(1).mentions, 1);
});

test('a one-letter name is not a name', () => {
  assert.strictEqual(bible.buildMatcher([{ id: 1, name: 'K' }]).regex, null);
  assert.deepStrictEqual(bible.parseAliases('K, Jo, , Kessler'), ['Jo', 'Kessler']);
});

test('aliases come in however they were typed, once each', () => {
  assert.deepStrictEqual(
    bible.parseAliases('the Old Man\nRaye, raye\n  Commodore  Raye  ', 'Commodore Raye'),
    ['the Old Man', 'Raye']
  );
});

test('a whole story scans in one pass', () => {
  const { rows } = bible.scanStory(
    [{ id: 10, content: 'Kessler and Prado.' }, { id: 11, content: 'Prado alone. Prado again.' }],
    [{ id: 1, name: 'Kessler' }, { id: 2, name: 'Prado' }]
  );
  assert.deepStrictEqual(
    rows.map((r) => [r.entityId, r.chapterId, r.mentions]).sort(),
    [[1, 10, 1], [2, 10, 1], [2, 11, 2]]
  );
});

test('kind, status and role never take a value they do not have', () => {
  assert.strictEqual(bible.entityKind('place'), 'place');
  assert.strictEqual(bible.entityKind('spaceship'), 'person');
  assert.strictEqual(bible.entityStatus('dead'), 'dead');
  assert.strictEqual(bible.entityStatus('undead'), '');
  assert.strictEqual(bible.entityRole('main'), 'main');
  assert.strictEqual(bible.entityRole('protagonist'), '');
  assert.strictEqual(bible.cleanName('  Kessler   Raye  '), 'Kessler Raye');
});
