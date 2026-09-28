'use strict';

// Finding a paragraph again. A pin on the timeline is dropped at a
// paragraph of a chapter, and a chapter is rewritten version after
// version; the pin keeps to its paragraph by the paragraph's opening words,
// which survive most edits that are not to those words themselves.
//
// Everything here counts in the chapter's flattened text -- the words a
// reader sees, markdown taken out -- the same text the notes are anchored
// to (see lib/suggestions.js).

const { flatOf } = require('./suggestions');

const SCENE_BREAK = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const ANCHOR_LENGTH = 60;

/**
 * Every paragraph of a chapter -- every non-empty line that is not a scene
 * break -- with the words it opens on and where they are.
 * @param {string} content
 * @returns {{ index: number, text: string, anchor: string, offset: number }[]}
 */
function paragraphsOf(content) {
  const flat = flatOf(content);
  const out = [];
  let cursor = 0;
  for (const line of String(content || '').split('\n')) {
    if (!line.trim() || SCENE_BREAK.test(line)) continue;
    const words = flatOf(line).trim();
    if (!words) continue;
    const anchor = words.slice(0, ANCHOR_LENGTH);
    let at = flat.indexOf(anchor, cursor);
    if (at === -1) at = flat.indexOf(anchor);
    if (at === -1) continue;
    out.push({ index: out.length, text: words, anchor, offset: at });
    cursor = at + anchor.length;
  }
  return out;
}

/**
 * Which paragraph a pin is on now: the paragraph opening with its words,
 * the nearest one to where it was if more than one does. Null when no
 * paragraph opens that way any more.
 * @param {any} mark a story_time_marks row: anchor_text and anchor_offset
 * @param {{ anchor: string, offset: number, index: number, text: string }[]} paragraphs
 */
function locateMark(mark, paragraphs) {
  const hits = paragraphs.filter((p) => p.anchor === mark.anchor_text);
  if (!hits.length) return null;
  return hits.reduce((best, p) => (Math.abs(p.offset - mark.anchor_offset) < Math.abs(best.offset - mark.anchor_offset) ? p : best));
}

module.exports = { ANCHOR_LENGTH, locateMark, paragraphsOf };
