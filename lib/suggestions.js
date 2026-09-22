// lib/suggestions.js -- putting a reviewer's rewrite into the text, and
// finding a note's passage again in the next version of a chapter.
//
// Both problems are about the same two coordinate spaces. A note is
// anchored by offsets into the *flattened* text -- the prose with every
// mark of markdown taken out (see lib/markdown.js). The chapter itself is
// stored as markdown source. A reviewer selects words they can see; the
// author's file has asterisks, `>` and `#` among them.
//
// Nothing here guesses silently. Every rewrite is checked after it is
// made: the text on either side of it must come out exactly as it was, and
// the rewritten words must read as the reviewer wrote them. If either is
// not true the answer is "do it by hand", never a chapter with a stray
// asterisk in it.
'use strict';

const { parseMarkdown, inlineToPlainText } = require('./markdown');

// The flattened text itself, in the same order flattenLength() counts it:
// every block's words, nothing between blocks, no scene breaks.
function flattenText(blocks) {
  let out = '';
  for (const block of blocks) {
    if (block.type === 'hr') continue;
    if (block.type === 'ul' || block.type === 'ol') {
      for (const item of block.items) out += inlineToPlainText(item);
    } else {
      out += inlineToPlainText(block.inline);
    }
  }
  return out;
}

const flatOf = (source) => flattenText(parseMarkdown(source));

// Where each flattened character sits in the source, found by walking
// both in step: every character a reader sees is in the source, in order,
// with markup in between. A link's destination is text the reader never
// sees, so it is stepped over rather than matched against.
function alignFlatToSource(source, flat) {
  const skip = new Uint8Array(source.length);
  for (const m of source.matchAll(/\]\([^)\n]*\)/g)) {
    for (let i = m.index; i < m.index + m[0].length; i++) skip[i] = 1;
  }
  const positions = new Int32Array(flat.length);
  let j = 0;
  for (let i = 0; i < flat.length; i++) {
    while (j < source.length && (skip[j] || source[j] !== flat[i])) j++;
    if (j >= source.length) return null;
    positions[i] = j;
    j++;
  }
  return positions;
}

const MARKUP = new Set(['*', '_', '~', '`']);
// A link opens with a bracket the reader never sees; a rewrite that
// swallows the link's closing half has to take its opening half too.
const OPENERS = new Set([...MARKUP, '[']);

// The candidate stretches of source that could stand for flat[a, b): the
// tight one first, then the same widened over emphasis marks at either
// end -- because replacing the words inside *aboard* should take the
// asterisks with them rather than leave one orphaned.
function candidateSpans(source, s, e) {
  let left = s;
  while (left > 0 && OPENERS.has(source[left - 1])) left--;
  let right = e;
  while (right < source.length && MARKUP.has(source[right])) right++;
  const spans = [[s, e], [left, e], [s, right], [left, right]];
  const seen = new Set();
  return spans.filter(([x, y]) => {
    const key = `${x}:${y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Replace the flattened range [start, end) of `source` with `replacement`.
 * @param {string} source
 * @param {number} start
 * @param {number} end
 * @param {string} replacement
 * @returns {{ ok: true, content: string } | { ok: false, reason: string }}
 */
function applySuggestion(source, start, end, replacement) {
  const text = String(source ?? '').replace(/\r\n/g, '\n');
  const rep = String(replacement ?? '').replace(/\r\n/g, '\n');
  const flat = flatOf(text);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > flat.length) {
    return { ok: false, reason: 'The note is not anchored to a passage of this version.' };
  }
  const before = flat.slice(0, start);
  const after = flat.slice(end);
  const wanted = flatOf(rep);
  const blockCount = parseMarkdown(text).length;
  const splitsParagraph = /\n\s*\n/.test(rep);

  const check = (content) => {
    const result = flatOf(content);
    if (!result.startsWith(before) || !result.endsWith(after)) return false;
    if (result.length < before.length + after.length) return false;
    if (result.slice(before.length, result.length - after.length) !== wanted) return false;
    if (!splitsParagraph && parseMarkdown(content).length !== blockCount) return false;
    return true;
  };

  const tryAt = (s, e) => {
    const span = text.slice(s, e);
    // A passage that runs across a paragraph break is two passages; a
    // rewrite of it would quietly join them.
    if (/\n\s*\n/.test(span)) return null;
    for (const [x, y] of candidateSpans(text, s, e)) {
      const content = text.slice(0, x) + rep + text.slice(y);
      if (check(content)) return content;
    }
    return null;
  };

  // The quick case first: the words appear exactly once in the source, as
  // written. That is most prose.
  const needle = flat.slice(start, end);
  const first = text.indexOf(needle);
  if (needle && first !== -1 && text.indexOf(needle, first + 1) === -1) {
    const done = tryAt(first, first + needle.length);
    if (done !== null) return { ok: true, content: done };
  }
  const positions = alignFlatToSource(text, flat);
  if (positions) {
    const done = tryAt(positions[start], positions[end - 1] + 1);
    if (done !== null) return { ok: true, content: done };
  }
  return { ok: false, reason: 'The passage crosses formatting or a paragraph break in a way that cannot be rewritten safely.' };
}

/**
 * Where the words a note was about are in a new version, if they are.
 * `oldFlat` and `newFlat` are flattened texts; the note covered
 * oldFlat[start, end). When the words occur more than once the one
 * nearest the old place wins, measured relative to how much text moved
 * before it -- a paragraph added at the top shifts everything, and the
 * right occurrence shifts with it.
 * @returns {{ start: number, end: number } | null}
 */
function relocate(oldFlat, newFlat, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
  const needle = oldFlat.slice(start, end);
  if (!needle.trim()) return null;
  const hits = [];
  let at = newFlat.indexOf(needle);
  while (at !== -1) {
    hits.push(at);
    at = newFlat.indexOf(needle, at + 1);
  }
  if (!hits.length) return null;
  // How far the text before the note moved: compare what came just before
  // it in the old text with the new, if that context is still unique.
  let expected = start;
  const context = oldFlat.slice(Math.max(0, start - 40), start);
  if (context.length >= 12) {
    const c = newFlat.indexOf(context);
    if (c !== -1 && newFlat.indexOf(context, c + 1) === -1) expected = c + context.length;
  }
  let best = hits[0];
  for (const h of hits) if (Math.abs(h - expected) < Math.abs(best - expected)) best = h;
  return { start: best, end: best + needle.length };
}

module.exports = { alignFlatToSource, applySuggestion, flattenText, flatOf, relocate };
