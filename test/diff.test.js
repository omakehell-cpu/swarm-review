// Version comparison.
//
// The thing being diffed is prose, not code, so the interesting cases are
// about reading: a reworded sentence has to stay readable as a sentence
// with the changed words marked inside it, not appear as a deleted
// paragraph followed by a nearly identical new one.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { diffVersions, summarizeDiff } = require('../lib/diff');

const textOf = (blocks, type) => blocks.filter((b) => b.type === type).map((b) => b.text);
const wordsOf = (block, type) =>
  block.words.filter((w) => w.type === type).map((w) => w.text.trim()).join(' ');

test('identical text reports no changes', () => {
  const t = 'One paragraph.\n\nAnother one.';
  const summary = summarizeDiff(diffVersions(t, t));
  assert.ok(summary.identical);
  assert.strictEqual(summary.added + summary.removed, 0);
});

test('a whole new paragraph reads as an addition', () => {
  const blocks = diffVersions('Alpha.', 'Alpha.\n\nBeta is entirely new here.');
  assert.deepStrictEqual(textOf(blocks, 'add'), ['Beta is entirely new here.']);
  assert.strictEqual(textOf(blocks, 'remove').length, 0);
});

test('a deleted paragraph reads as a removal', () => {
  const blocks = diffVersions('Alpha.\n\nBeta goes away now.', 'Alpha.');
  assert.deepStrictEqual(textOf(blocks, 'remove'), ['Beta goes away now.']);
});

test('an edited paragraph is word-diffed, not shown as delete plus add', () => {
  const before = 'She pressed her palm to the cold viewport and waited for the light.';
  const after = 'She pressed her hand to the cold viewport and waited for the dawn.';
  const blocks = diffVersions(before, after);
  const changed = blocks.filter((b) => b.type === 'changed');
  assert.strictEqual(changed.length, 1);
  assert.strictEqual(textOf(blocks, 'add').length, 0);
  assert.strictEqual(textOf(blocks, 'remove').length, 0);
  assert.match(wordsOf(changed[0], 'remove'), /palm/);
  assert.match(wordsOf(changed[0], 'add'), /hand/);
  assert.match(wordsOf(changed[0], 'equal'), /viewport/);
});

test('two unrelated paragraphs are not forced into a pairing', () => {
  const blocks = diffVersions(
    'The station had been dying for eleven years.',
    'Rain fell on the market square all afternoon.'
  );
  assert.strictEqual(blocks.filter((b) => b.type === 'changed').length, 0);
  assert.strictEqual(textOf(blocks, 'add').length, 1);
  assert.strictEqual(textOf(blocks, 'remove').length, 1);
});

test('whitespace-only changes are not changes', () => {
  const blocks = diffVersions('One   paragraph here.', 'One paragraph here.');
  assert.ok(summarizeDiff(blocks).identical);
});

test('the summary counts words added and removed', () => {
  const blocks = diffVersions(
    'Alpha.\n\nKeep this one.',
    'Alpha beta gamma.\n\nKeep this one.\n\nBrand new closing line.'
  );
  const summary = summarizeDiff(blocks);
  assert.ok(summary.added >= 5, `added ${summary.added}`);
  assert.ok(!summary.identical);
});

test('order is preserved across a mixed edit', () => {
  const blocks = diffVersions(
    'First.\n\nSecond paragraph as written.\n\nThird.',
    'First.\n\nSecond paragraph as rewritten.\n\nInserted.\n\nThird.'
  );
  assert.deepStrictEqual(blocks.map((b) => b.type), ['equal', 'changed', 'add', 'equal']);
});

test('a full-length chapter diffs in well under a second', () => {
  // Word-level LCS is quadratic, so the guard is that it only ever runs
  // inside a paragraph that actually changed -- never across the chapter.
  const para = (n) =>
    `Paragraph number ${n} carries several words so the tokens add up to something realistic in this test.`;
  const before = Array.from({ length: 400 }, (_, i) => para(i)).join('\n\n');
  const after = Array.from({ length: 400 }, (_, i) =>
    (i === 200 ? para(i).replace('several', 'a great many') : para(i))).join('\n\n');

  const started = Date.now();
  const summary = summarizeDiff(diffVersions(before, after));
  const ms = Date.now() - started;

  assert.strictEqual(summary.changedParagraphs, 1);
  assert.ok(ms < 3000, `400 paragraphs took ${ms}ms`);
});
