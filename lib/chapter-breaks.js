'use strict';

// Chapter breaks written into the text: a line of its own,
//
//   === New chapter: The long repair ===
//
// put there by the editor's "New chapter" button (or typed). On publish,
// everything from the line after it is a new chapter, straight after this
// one, with that title; the line itself is never part of anybody's text.
// It is how a chapter boundary is added where the writer is looking --
// in the prose -- rather than on a page of its own.
//
// Only the marker is recognised: three or more "=", the words "new
// chapter", a title, and optionally the "=" again. Anything else that
// happens to start with "===" is prose.

const MARKER = /^[ \t]*={3,}[ \t]*new chapter\b[ \t]*:?[ \t]*(.*?)[ \t]*=*[ \t]*$/i;
const MAX_TITLE = 200;

const isMarker = (line) => MARKER.test(line);
const hasBreaks = (text) => String(text || '').split('\n').some(isMarker);

/** The line the editor puts in. */
const markerLine = (title) => `=== New chapter: ${title} ===`;

/**
 * The text with its markers taken out, and where each new chapter starts
 * in that text: at the start of the first line after its marker that has
 * something on it -- which is always a line start, the only place a
 * chapter can be cut (see models/split.js).
 * @param {string} content
 * @returns {{ text: string, cuts: { at: number, title: string }[], error?: string }}
 */
function parseBreaks(content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const cuts = [];
  let text = '';
  let pending = null; // the title of a marker whose chapter has not started yet
  for (const line of lines) {
    const m = MARKER.exec(line);
    if (m) {
      if (pending !== null) return { text: '', cuts: [], error: `The chapter break "${pending}" has no text after it before the next one.` };
      if (!text.trim()) return { text: '', cuts: [], error: 'A chapter break needs some of the chapter before it.' };
      pending = m[1].replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
      text = `${text.replace(/\s+$/, '')}\n\n`;
      continue;
    }
    if (pending !== null) {
      if (!line.trim()) continue;
      cuts.push({ at: text.length, title: pending });
      pending = null;
    }
    text += `${line}\n`;
  }
  if (pending !== null) return { text: '', cuts: [], error: `The chapter break "${pending || 'New chapter'}" has nothing after it.` };
  // The last newline is the loop's, not the writer's.
  text = text.replace(/\n$/, '');
  return { text, cuts };
}

module.exports = { MARKER, hasBreaks, isMarker, markerLine, parseBreaks };
