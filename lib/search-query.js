'use strict';

// What somebody types, turned into something FTS5 will accept.
//
// FTS5's MATCH takes a small query language: bare words, "phrases in
// quotes", prefix*, AND/OR/NOT, parentheses. Handing it a person's raw
// input is how a search for `it's` or `Kessler -- the long watch` becomes
// a syntax error and an apologetic page. So every word goes in quotes,
// which strips it of any meaning as an operator, and the two things people
// actually mean by punctuation are kept:
//
//   "held its breath"  a phrase, because they asked for one
//   anch               the last word gets a *, because a search for a
//                      half-typed name should find it
//
// Everything else -- the dashes, the apostrophes, the stray bracket -- is
// just a word separator, which is what it looks like it is.

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;

/**
 * @param {string} raw what the person typed
 * @returns {string|null} an FTS5 MATCH expression, or null if there is
 *   nothing in it to search for
 */
function toMatchQuery(raw) {
  const text = String(raw || '');
  const parts = [];
  let rest = text;

  // Quoted runs first, so the words inside them stay together.
  rest = rest.replace(/"([^"]*)"/g, (_whole, inside) => {
    const words = String(inside).match(WORD);
    if (words && words.length) parts.push({ phrase: words.join(' ') });
    return ' ';
  });

  for (const word of rest.match(WORD) || []) parts.push({ word });
  if (!parts.length) return null;

  // The last thing typed is the one most likely to be half-finished --
  // but only if it was a bare word, since a phrase in quotes is a
  // deliberate statement about where it ends.
  const last = parts[parts.length - 1];
  const prefix = last.word && !/["*\s]$/.test(text.trimEnd().slice(-1)) ? last : null;

  return parts
    .map((p) => {
      const body = p.phrase !== undefined ? p.phrase : p.word;
      const quoted = `"${body.replace(/"/g, '')}"`;
      return p === prefix && body.length >= 2 ? `${quoted}*` : quoted;
    })
    .join(' AND ');
}

// snippet() marks the hit with whatever delimiters it is given. These two
// are control characters: they cannot occur in anybody's prose, so the
// view can escape the whole snippet as text and then turn exactly these
// into markup, with no way for a chapter to smuggle a tag through.
const HIT_OPEN = '';
const HIT_CLOSE = '';

module.exports = { toMatchQuery, HIT_OPEN, HIT_CLOSE };
