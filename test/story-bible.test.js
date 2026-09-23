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

// ---------- names the bible has not heard of ----------
// A heuristic, so these tests are the record of which mistakes it is
// allowed to make: it may miss, it may not invent.

test('a name in the middle of a sentence is a name', () => {
  const found = bible.findProperNames('The hatch was open, because Prado had left it open again.');
  assert.deepStrictEqual(found.map((c) => c.name), ['Prado']);
});

test('a word is not a name just because a sentence started with it', () => {
  const found = bible.findProperNames('The station was cold. Suddenly the lights went. But nobody moved. Then nothing.');
  assert.deepStrictEqual(found, []);
});

test('a sentence-starter glued to a real name does not swallow it', () => {
  // "Suddenly the Kestrel Anchorage shook" -- the run of capitals must not
  // reach across "the" and come back as one candidate.
  const found = bible.findProperNames('Suddenly the Kestrel Anchorage shook.');
  assert.deepStrictEqual(found.map((c) => c.name), ['Kestrel Anchorage']);
});

test('two capitals in a row are a name even at the start of a sentence', () => {
  assert.deepStrictEqual(
    bible.findProperNames('Marta Sein watched from the door.').map((c) => c.name), ['Marta Sein']
  );
  // And a leading sentence-starter is peeled off what follows it.
  assert.deepStrictEqual(
    bible.findProperNames('The Old Man said nothing.').map((c) => c.name), ['Old Man']
  );
});

test('a name that is always at the start of a sentence needs to earn it', () => {
  assert.deepStrictEqual(bible.findProperNames('Prado left. Prado returned.'), []);
  // The threshold is high on purpose: this is the only way an ordinary
  // word can get in, and on a real chapter a low one lets through every
  // "Good" and "People" that ever opened a paragraph.
  assert.deepStrictEqual(bible.findProperNames('Prado left. Prado returned. Prado went.'), []);
  assert.deepStrictEqual(
    bible.findProperNames('Prado left. Prado returned. Prado went. Prado waited. Prado swore.').map((c) => c.name),
    ['Prado']
  );
});

test('a possessive is the same person, and a contraction is nobody', () => {
  // Found on seventy thousand words of real prose: "Jack" and "Jack's"
  // were being offered as two different characters, and "Don't", "I'm",
  // "You're" and "That's" were being offered as four more.
  const found = bible.findProperNames(
    "She took Jack's boots. Then she took Jack again. Don't, said Riley, and Riley meant it. You're late. That's that."
  );
  assert.deepStrictEqual(found.map((c) => [c.name, c.count]), [['Jack', 2], ['Riley', 2]]);

  // A name that simply contains an apostrophe keeps it.
  assert.deepStrictEqual(
    bible.findProperNames("Later, O'Brien found the Sa'arm.").map((c) => c.name),
    ["O'Brien", "Sa'arm"]
  );
  assert.strictEqual(bible.unpossess("Jack's"), 'Jack');
  assert.strictEqual(bible.unpossess("Don't"), null);
  assert.strictEqual(bible.unpossess("Sa'arm"), "Sa'arm");
});

test('what the app already knows about is not offered again', () => {
  const text = 'Kessler and Prado went to Tampaad together.';
  assert.deepStrictEqual(
    bible.findProperNames(text, new Set(['kessler', 'tampaad'])).map((c) => c.name), ['Prado']
  );
});

test('code, links and URLs are not prose', () => {
  assert.deepStrictEqual(
    bible.findProperNames('See `Kessler` and [the log](https://Example.com/Kessler) and https://Tampaad.example/A.'),
    []
  );
});

test('candidates come back commonest first, alphabetical on a tie', () => {
  const found = bible.findProperNames('Ana saw Prado. Prado saw Ana and Sein. Prado shrugged. Ana left.');
  assert.deepStrictEqual(found.map((c) => [c.name, c.count]), [['Ana', 3], ['Prado', 3], ['Sein', 1]]);
});

test('another name for somebody: the likeliest entry is the one sharing a word', () => {
  const entries = [
    { id: 1, name: 'Jack Harlan', alias_list: null },
    { id: 2, name: 'Mara Voss', alias_list: 'the Widow' },
    { id: 3, name: 'Kestrel Anchorage', aliases: ['the Kestrel'] },
  ];
  assert.strictEqual(bible.likelySameAs('Colonel Jack', entries), 1, 'a title is not the name');
  assert.strictEqual(bible.likelySameAs('uncle Jack', entries), 1);
  assert.strictEqual(bible.likelySameAs("Harlan's", entries), 1, 'a possessive is the same person');
  assert.strictEqual(bible.likelySameAs('Widow Voss', entries), 2, 'aliases count too');
  assert.strictEqual(bible.likelySameAs('Kestrel', entries), 3);
  assert.strictEqual(bible.likelySameAs('Captain Obi', entries), null, 'nobody, and no guess');
  assert.strictEqual(bible.likelySameAs('Colonel', entries), null, 'a title alone says nothing');
});
