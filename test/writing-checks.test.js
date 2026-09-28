// The writing checks, run as code rather than looked at in a screenshot.
//
// public/js/writing-analyzer.js is a browser IIFE with no module system --
// no build step, by design. So it is evaluated here inside a vm with a
// stub of the handful of browser globals it touches at load time, and the
// pure detection functions come back through the test seam at the bottom
// of that file.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAnalyzer() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'writing-analyzer.js'), 'utf8'
  );
  const noop = () => {};
  const element = () => ({
    className: '', style: { setProperty: noop, cssText: '' }, dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: noop, addEventListener: noop, setAttribute: noop,
    querySelector: () => null, querySelectorAll: () => [], insertBefore: noop,
    textContent: '', innerHTML: '',
  });
  const sandbox = {
    document: {
      readyState: 'complete',
      addEventListener: noop,
      createElement: element,
      createTextNode: (t) => ({ textContent: t }),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      body: element(),
      documentElement: element(),
    },
    window: {
      matchMedia: () => ({ matches: false, addEventListener: noop }),
      addEventListener: noop,
      localStorage: { getItem: () => null, setItem: noop },
    },
    localStorage: { getItem: () => null, setItem: noop },
    fetch: () => Promise.resolve({ ok: false }),
    console,
  };
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'writing-analyzer.js' });
  return sandbox.window.__writingAnalyzer;
}

const wa = loadAnalyzer();
// No dictionary is loaded in here, so spelling never fires; every other
// check is pure text analysis and runs exactly as it does in the browser.
const run = (text, overrides = {}) => {
  const settings = {};
  for (const id of wa.CHECK_ORDER) settings[id] = true;
  Object.assign(settings, overrides);
  return wa.analyze(text, new Set(), settings, null);
};
// Array.from matters: everything the analyzer returns was built inside the
// vm, so its arrays have that realm's Array prototype and deepStrictEqual
// refuses them however well the contents match.
const kinds = (text, kind, overrides) =>
  Array.from(run(text, overrides).ranges)
    .filter((r) => r.kind === kind)
    .map((r) => text.slice(r.start, r.end));

test('the seam exposes the checks the control card offers', () => {
  assert.ok(wa, 'the analyzer loaded outside a browser');
  for (const id of ['echo', 'filter', 'dialogue', 'opening']) {
    assert.ok(wa.CHECK_META[id], `${id} has a label and a colour`);
    assert.ok(wa.CHECK_ORDER.includes(id));
  }
});

// ---- repeated words --------------------------------------------------

test('the same distinctive word twice in a paragraph is an echo', () => {
  const text = 'The anchorage was cold. She crossed the deck and thought about the anchorage again.';
  assert.deepStrictEqual(kinds(text, 'echo'), ['anchorage']);
});

test('common and short words are not echoes', () => {
  const text = 'She went to the door. She went to the window. There was a door there.';
  assert.deepStrictEqual(kinds(text, 'echo'), []);
});

test('a word in the story dictionary is allowed to repeat', () => {
  // A character's name is supposed to appear twice in a paragraph.
  const text = 'Kessler crossed the deck. Kessler did not look back.';
  const settings = {};
  for (const id of wa.CHECK_ORDER) settings[id] = true;
  const withName = wa.analyze(text, new Set(['kessler']), settings, null);
  assert.strictEqual(withName.ranges.filter((r) => r.kind === 'echo').length, 0);
  const without = wa.analyze(text, new Set(), settings, null);
  assert.strictEqual(without.ranges.filter((r) => r.kind === 'echo').length, 1);
});

test('the same word far apart is not an echo', () => {
  // Sixty distinct words between the two, so the filler itself cannot
  // trigger the check it is standing in for.
  const filler = Array.from({ length: 60 }, (_, i) => `placeholder${i}`).join(' ');
  const text = `The anchorage was cold. ${filler}. She remembered the anchorage.`;
  assert.ok(!kinds(text, 'echo').includes('anchorage'), 'fifty words is far enough apart');
});

// ---- filter verbs ----------------------------------------------------

test('a perception verb after a subject is a filter verb', () => {
  assert.deepStrictEqual(kinds('She saw the door swing open.', 'filter'), ['She saw']);
  assert.deepStrictEqual(kinds('He could hear the engines.', 'filter'), ['He could hear']);
});

test('the same verb without a subject in front is left alone', () => {
  assert.deepStrictEqual(kinds('The watch saw three shifts change.', 'filter'), []);
});

test('"looked" and "seemed" are deliberately not filter verbs', () => {
  // Far too often innocent -- "she looked tired" is not a craft problem.
  assert.deepStrictEqual(kinds('She looked tired. He seemed calm.', 'filter'), []);
});

// ---- dialogue tags ---------------------------------------------------

test('a speech verb carrying a line of dialogue is flagged', () => {
  const found = kinds('"Get out," he snarled.', 'dialogue');
  assert.strictEqual(found.length, 1);
  assert.match(found[0], /snarled/);
});

test('the same verb in narration is not a dialogue tag', () => {
  assert.deepStrictEqual(kinds('The engine snarled and died.', 'dialogue'), []);
});

test('an adverb propping up a speech tag is flagged, and named', () => {
  // Both the dialogue check and the adverb check have something to say
  // about "said quietly". The adverb one wins because it is the one that
  // proposes a word -- being told "murmured" beats being told that the
  // adverb is doing the work.
  const marks = Array.from(run('"I know," she said quietly.').ranges)
    .filter((r) => r.kind === 'adverb' || r.kind === 'dialogue');
  assert.strictEqual(marks.length, 1, 'one note, not two on the same words');
  assert.strictEqual(marks[0].suggestion, 'murmured');

  // With the adverb check off, the dialogue check still catches it.
  const withoutAdverbs = Array.from(run('"I know," she said quietly.', { adverb: false }).ranges)
    .filter((r) => r.kind === 'dialogue');
  assert.strictEqual(withoutAdverbs.length, 1);
});

test('a plain said is invisible and stays that way', () => {
  assert.deepStrictEqual(kinds('"I know," she said.', 'dialogue'), []);
});

// ---- repeated openings -----------------------------------------------

test('three sentences in a row on the same word is a stutter', () => {
  const text = 'She opened the hatch. She checked the seals. She signed the book.';
  const found = kinds(text, 'opening');
  assert.deepStrictEqual(found, ['She']);
});

test('two in a row is not yet a pattern', () => {
  assert.deepStrictEqual(kinds('She opened the hatch. She checked the seals.', 'opening'), []);
});

test('two participle openings in a row are flagged', () => {
  const text = 'Turning the wheel, she braced. Watching the dial, she waited.';
  assert.deepStrictEqual(kinds(text, 'opening'), ['Watching']);
});

// ---- the switches actually switch ------------------------------------

test('a check that is off finds nothing at all', () => {
  const text = 'The anchorage was cold. She saw the anchorage again. "Go," he snarled.';
  assert.ok(run(text).ranges.length > 0);
  const off = run(text, { echo: false, filter: false, dialogue: false, opening: false });
  for (const kind of ['echo', 'filter', 'dialogue', 'opening']) {
    assert.strictEqual(off.ranges.filter((r) => r.kind === kind).length, 0, kind);
  }
});

test('two checks never mark the same words twice', () => {
  const text = 'She saw the anchorage. The anchorage was cold and she saw nothing else there.';
  const words = Array.from(run(text).ranges).filter((r) => r.kind.indexOf('sentence-') !== 0);
  const sorted = [...words].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].start >= sorted[i - 1].end,
      `${JSON.stringify(sorted[i - 1])} overlaps ${JSON.stringify(sorted[i])}`);
  }
});

test('the summary counts every kind it marks', () => {
  const text = 'The anchorage was cold. She saw the anchorage. "Go," he snarled. She said quietly.';
  const { ranges, stats } = run(text);
  const all = Array.from(ranges);
  for (const kind of ['echo', 'filter', 'dialogue', 'opening']) {
    assert.strictEqual(stats[kind], all.filter((r) => r.kind === kind).length, kind);
  }
});

test('a perception verb inside dialogue is somebody speaking, not filtering', () => {
  // "I know" is a line, not a camera between the reader and the scene.
  assert.deepStrictEqual(kinds('"I know," she said.', 'filter'), []);
  assert.deepStrictEqual(kinds('"I saw it too," he answered.', 'filter'), []);
  // But the narration around the dialogue is still checked.
  const mixed = kinds('"I know," she said. She saw the hatch swing open.', 'filter');
  assert.deepStrictEqual(mixed, ['She saw']);
});

test('an unclosed quote protects the rest of the line, the way dialogue runs on', () => {
  assert.deepStrictEqual(kinds('"I know what I saw and I heard it too', 'filter'), []);
});

// ---- leaving dialogue alone -------------------------------------------

const spans = (text) => Array.from(wa.dialogueSpans(text), (s) => text.slice(s[0], s[1]));

test('dialogue is found across sentences, in straight and curly quotes', () => {
  assert.deepStrictEqual(spans('"Stop. Put it down." She did.'), ['"Stop. Put it down."']);
  assert.deepStrictEqual(spans('“Go,” she said. “Now.”'), ['“Go,”', '“Now.”']);
  assert.deepStrictEqual(spans('‘I don’t know,’ he said.'), ['‘I don’t know,’']);
});

test('an open quote runs to the end of its paragraph and no further', () => {
  const text = '"I went down to the hold\nThe hold was empty.';
  assert.deepStrictEqual(spans(text), ['"I went down to the hold']);
});

test('an apostrophe is not the start of a line of dialogue', () => {
  assert.deepStrictEqual(spans("The captain's log. The Swarm's ships."), []);
});

const shown = (text, quiet) => {
  const settings = {};
  for (const id of wa.CHECK_ORDER) settings[id] = true;
  settings['quiet-dialogue'] = quiet;
  return Array.from(wa.shownRanges(run(text).ranges, settings), (r) => ({ kind: r.kind, text: text.slice(r.start, r.end) }));
};

test('with dialogue left alone, its grammar is not marked but the narration still is', () => {
  const text = '"It was really very badly done," she said. He walked slowly to the door.';
  const loud = shown(text, false).map((r) => r.text);
  assert.ok(loud.includes('really'), 'off by default: the dialogue is checked like anything else');
  const quiet = shown(text, true);
  assert.ok(!quiet.some((r) => r.text === 'really' || r.text === 'badly'), 'nothing inside the quotes');
  assert.ok(quiet.some((r) => r.text === 'slowly' || r.text === 'walked slowly'), 'the narration is still checked');
});

test('a long line of dialogue is not a long sentence, a long narration still is', () => {
  const speech = '"' + Array.from({ length: 30 }, () => 'and then we went').join(' ') + '," he said.';
  assert.ok(shown(speech, false).some((r) => r.kind.startsWith('sentence-')));
  assert.ok(!shown(speech, true).some((r) => r.kind.startsWith('sentence-')));
  const narration = Array.from({ length: 30 }, () => 'and then we went').join(' ') + '.';
  assert.ok(shown(narration, true).some((r) => r.kind.startsWith('sentence-')));
});

test('the dialogue-tag check is about the narration, so it stays', () => {
  const text = '"Get out," he snarled.';
  assert.ok(shown(text, true).some((r) => r.kind === 'dialogue'));
});

test('the counts leave dialogue out too when it is left alone', () => {
  const text = '"It was really very badly done," she said. He walked quietly home.';
  const { stats } = run(text);
  const settings = { 'quiet-dialogue': true };
  const quiet = wa.quietStats(stats, settings);
  assert.ok(stats.adverb > quiet.adverb, 'the adverbs in the dialogue are no longer counted');
  assert.strictEqual(wa.quietStats(stats, { 'quiet-dialogue': false }), stats);
});

// ---- turning the diagnosis into a rewrite ----------------------------

const suggestionFor = (text, kind) => {
  const r = Array.from(run(text).ranges).find((x) => x.kind === kind && x.suggestion);
  return r ? { was: text.slice(r.start, r.end), now: r.suggestion } : null;
};

test('a passive that names who did it is turned round', () => {
  assert.deepStrictEqual(suggestionFor('The door was opened by Kessler.', 'passive'),
    { was: 'The door was opened by Kessler', now: 'Kessler opened the door' });
});

test('an irregular participle is conjugated, not left as it is', () => {
  // "written" -> "wrote", which is the whole reason there is a verb table.
  assert.deepStrictEqual(suggestionFor('The report was written by the committee.', 'passive'),
    { was: 'The report was written by the committee', now: 'The committee wrote the report' });
  assert.strictEqual(suggestionFor('The song was sung by Marta.', 'passive').now, 'Marta sang the song');
});

test('pronouns change case when the sentence turns round', () => {
  // Not "The noise frightened she".
  assert.strictEqual(suggestionFor('She was frightened by the noise.', 'passive').now,
    'The noise frightened her');
  assert.strictEqual(suggestionFor('The hatch was closed by him.', 'passive').now,
    'He closed the hatch');
});

test('the rest of the sentence is left alone', () => {
  const r = suggestionFor('The seals were checked by Luis every morning.', 'passive');
  assert.strictEqual(r.was, 'The seals were checked by Luis');
  assert.strictEqual(r.now, 'Luis checked the seals');
});

test('a passive with nobody in it is not rewritten, only flagged', () => {
  // "The hatch was left open" -- by whom? A machine that guessed here
  // would be inventing the one word that matters.
  const text = 'The hatch was left open.';
  const passive = Array.from(run(text).ranges).filter((r) => r.kind === 'passive');
  assert.strictEqual(passive.length, 1, 'still flagged');
  assert.ok(!passive[0].suggestion, 'but no rewrite is offered');
});

test('an adverb a single verb already contains is offered that verb', () => {
  assert.deepStrictEqual(suggestionFor('She walked slowly to the hatch.', 'adverb'),
    { was: 'walked slowly', now: 'ambled' });
  assert.deepStrictEqual(suggestionFor('He looked quickly at the dial.', 'adverb'),
    { was: 'looked quickly', now: 'glanced' });
});

test('an adverb the verb already means is offered deletion', () => {
  assert.deepStrictEqual(suggestionFor('"Wait," she whispered quietly.', 'adverb'),
    { was: 'whispered quietly', now: 'whispered' });
});

test('an adverb with no honest answer still gets none', () => {
  // There is no single verb meaning "smiled carefully". Inventing one
  // would be worse than saying nothing, so the check reports the adverb
  // and stops there.
  const r = Array.from(run('She smiled carefully at the dial.').ranges).find((x) => x.kind === 'adverb');
  assert.ok(r, 'still flagged as an adverb');
  assert.strictEqual(r.suggestion, null);
});

test('the paired checks win the overlap with the plain adverb check', () => {
  const found = Array.from(run('She walked slowly.').ranges).filter((r) => r.kind === 'adverb');
  assert.strictEqual(found.length, 1, 'one mark, not two');
  assert.strictEqual(found[0].suggestion, 'ambled');
});

test('an adverb on a verb that is not speech is not a dialogue tag', () => {
  // "smiled" is a said-bookism when it carries a line; in a paragraph with
  // no dialogue in it, "she smiled carefully" is just an adverb.
  assert.deepStrictEqual(kinds('She smiled carefully at the dial.', 'dialogue'), []);
  assert.deepStrictEqual(kinds('He laughed bitterly and went below.', 'dialogue'), []);
  // With a line of dialogue in front of it, it is a tag again.
  assert.strictEqual(kinds('"Fine," he laughed bitterly.', 'dialogue').length, 1);
});

test('a rewrite never swallows the space after the previous sentence', () => {
  const text = 'She waited. The door was opened by Kessler.';
  const r = Array.from(run(text).ranges).find((x) => x.kind === 'passive' && x.suggestion);
  const span = text.slice(r.start, r.end);
  assert.strictEqual(span, 'The door was opened by Kessler');
  assert.ok(!/^\s/.test(span), 'the mark starts on a word');
  // And the replacement really does leave a readable sentence behind.
  assert.strictEqual(text.slice(0, r.start) + r.suggestion + text.slice(r.end),
    'She waited. Kessler opened the door.');
});

// ---------------------------------------------------------------------
// the reading grade
// ---------------------------------------------------------------------

test('the reading grade rises with the difficulty of the prose', () => {
  const plain = 'The dog ran. The cat sat. She went home. He ate bread. They slept well.';
  const dense = 'The extraordinary institutional considerations, notwithstanding their '
    + 'demonstrable incompatibility with contemporary administrative methodology, '
    + 'necessitated a comprehensive reconsideration of every operational assumption.';
  const easy = run(plain).stats.grade;
  const hard = run(dense).stats.grade;
  assert.ok(easy < 5, `short plain sentences read low, got ${easy}`);
  assert.ok(hard > 15, `one long Latinate sentence reads high, got ${hard}`);
});

test('the grade is the whole text, not its worst sentence', () => {
  const monster = 'The extraordinary institutional considerations, notwithstanding their '
    + 'demonstrable incompatibility with contemporary administrative methodology, '
    + 'necessitated a comprehensive reconsideration of every operational assumption.';
  const short = ' The dog ran. The cat sat. She went home. He ate bread. They slept well. '
    + 'It was cold. The door shut. He left.';
  const mixed = run(monster + short).stats;
  const alone = run(monster).stats.grade;
  assert.ok(mixed.grade < alone,
    'the short sentences around it pull the grade down');
  assert.strictEqual(mixed.red, 1, 'and the monster is still shaded red on its own');
});

test('the grade survives the checks being switched off', () => {
  const text = 'The dog ran quickly. The cat was seen by the man. She went home.';
  const off = {};
  for (const id of wa.CHECK_ORDER) off[id] = false;
  const quiet = run(text, off).stats;
  assert.ok(quiet.grade > 0, 'the grade is a fact about the text, not a check');
  assert.strictEqual(quiet.yellow + quiet.red + quiet.passive + quiet.adverb, 0,
    'and nothing else fired');
});

test('an empty text has no grade rather than a grade of zero', () => {
  assert.strictEqual(run('').stats.grade, null);
  assert.strictEqual(run('   \n\n  ').stats.grade, null);
});
