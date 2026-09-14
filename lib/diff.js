// lib/diff.js -- what changed between two versions of a chapter.
//
// Done in two passes rather than one. A straight word-by-word diff of a
// whole chapter is a least-common-subsequence problem over tens of
// thousands of tokens, and the textbook dynamic-programming table for
// that is tokens-squared: two 8,000-word versions would be a 64-million
// cell table for what is usually a handful of edited sentences. So:
// paragraphs first (a few hundred at most, a table of a few thousand
// cells), then words only inside the paragraphs that actually changed,
// each of which is a hundred words or so. Both passes are exact -- this
// is a smaller problem, not an approximation of the bigger one.
'use strict';

// Longest common subsequence over two arrays, returned as a list of
// { type: 'equal' | 'remove' | 'add', a, b } steps in order.
function lcsDiff(a, b, isEqual = (x, y) => x === y) {
  const n = a.length;
  const m = b.length;
  // table[i][j] = length of the LCS of a[i..] and b[j..]
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = isEqual(a[i], b[j])
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const steps = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (isEqual(a[i], b[j])) {
      steps.push({ type: 'equal', a: a[i], b: b[j] });
      i += 1; j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      steps.push({ type: 'remove', a: a[i] });
      i += 1;
    } else {
      steps.push({ type: 'add', b: b[j] });
      j += 1;
    }
  }
  while (i < n) { steps.push({ type: 'remove', a: a[i] }); i += 1; }
  while (j < m) { steps.push({ type: 'add', b: b[j] }); j += 1; }
  return steps;
}

// Paragraphs, keeping blank-line structure out of the way: the diff is
// about prose, and an author moving a blank line shouldn't read as a
// change. Each entry keeps its text and a normalized key to compare on.
function splitParagraphs(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// Words plus the whitespace after them, so re-joining a run of tokens
// gives back the original spacing rather than collapsing it.
function splitWords(text) {
  return String(text || '').match(/\S+\s*/g) || [];
}

const normalize = (s) => String(s).replace(/\s+/g, ' ').trim();

// Pairs up a run of removed paragraphs with a run of added ones, so a
// paragraph that was edited (rather than deleted outright and a new one
// written) can be word-diffed against the version it came from. Only
// pairs that still resemble each other: a genuinely new paragraph
// shouldn't be shown as a word-by-word rewrite of an unrelated one.
function similarity(a, b) {
  const wordsA = new Set(normalize(a).toLowerCase().split(' '));
  const wordsB = new Set(normalize(b).toLowerCase().split(' '));
  if (!wordsA.size || !wordsB.size) return 0;
  let shared = 0;
  for (const w of wordsA) if (wordsB.has(w)) shared += 1;
  return shared / Math.max(wordsA.size, wordsB.size);
}

const PAIR_THRESHOLD = 0.4;

// Returns a list of blocks:
//   { type: 'equal',   text }
//   { type: 'add',     text }
//   { type: 'remove',  text }
//   { type: 'changed', words: [{ type, text }, ...] }
function diffVersions(oldText, newText) {
  const oldParas = splitParagraphs(oldText);
  const newParas = splitParagraphs(newText);
  const steps = lcsDiff(oldParas, newParas, (x, y) => normalize(x) === normalize(y));

  const blocks = [];
  let pendingRemoves = [];
  let pendingAdds = [];

  function flushPending() {
    // Walk the two runs together, pairing off paragraphs that look like
    // edits of each other and emitting the leftovers as plain
    // additions/removals.
    const removes = pendingRemoves;
    const adds = pendingAdds;
    pendingRemoves = [];
    pendingAdds = [];
    const usedAdds = new Set();
    removes.forEach((removed) => {
      let bestIndex = -1;
      let bestScore = PAIR_THRESHOLD;
      adds.forEach((added, index) => {
        if (usedAdds.has(index)) return;
        const score = similarity(removed, added);
        if (score > bestScore) { bestScore = score; bestIndex = index; }
      });
      if (bestIndex === -1) {
        blocks.push({ type: 'remove', text: removed });
        return;
      }
      usedAdds.add(bestIndex);
      const words = lcsDiff(splitWords(removed), splitWords(adds[bestIndex]), (x, y) => x.trim() === y.trim())
        .map((step) => ({ type: step.type, text: step.type === 'add' ? step.b : step.a }));
      blocks.push({ type: 'changed', words });
    });
    adds.forEach((added, index) => {
      if (!usedAdds.has(index)) blocks.push({ type: 'add', text: added });
    });
  }

  for (const step of steps) {
    if (step.type === 'equal') {
      flushPending();
      blocks.push({ type: 'equal', text: step.a });
    } else if (step.type === 'remove') {
      pendingRemoves.push(step.a);
    } else {
      pendingAdds.push(step.b);
    }
  }
  flushPending();
  return blocks;
}

// Words added and removed across the whole comparison -- the one-line
// summary at the top of the page ("+142 / -38"), which is usually all an
// author wants before deciding whether to read the rest.
function summarizeDiff(blocks) {
  let added = 0;
  let removed = 0;
  let changedParagraphs = 0;
  for (const block of blocks) {
    if (block.type === 'add') added += splitWords(block.text).length;
    else if (block.type === 'remove') removed += splitWords(block.text).length;
    else if (block.type === 'changed') {
      changedParagraphs += 1;
      for (const word of block.words) {
        if (word.type === 'add') added += 1;
        else if (word.type === 'remove') removed += 1;
      }
    }
  }
  const touched = blocks.filter((b) => b.type !== 'equal').length;
  return { added, removed, changedParagraphs, touched, identical: touched === 0 };
}

module.exports = { diffVersions, summarizeDiff, splitParagraphs, splitWords, lcsDiff };
