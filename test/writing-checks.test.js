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

test('an adverb propping up a speech tag is flagged', () => {
  const found = kinds('"I know," she said quietly.', 'dialogue');
  assert.strictEqual(found.length, 1);
  assert.match(found[0], /said quietly/);
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
