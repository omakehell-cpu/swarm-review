'use strict';

// Compiling a story into one manuscript: Scrivener's Compile, with the
// dial set to the one setting a writing group actually wants.
//
// Everything downloadable here was a single chapter, which is the unit
// this app works in and the wrong unit for showing somebody your novel.
//
// The output is markdown, because markdown is what the chapters are
// written in, what the .docx exporter already reads, and what stays
// readable if every other part of this stops existing.

const { groupChaptersIntoArcs } = require('./story-state');

// A scene break in the source is `---`; between chapters it is a heading,
// so the two never have to mean the same thing.
const RULE = '---';

/**
 * @param {any} story a story row: title, and optionally author_name,
 *   description and synopsis
 * @param {any[]} chapters chapter rows in running order, each with its
 *   current content
 * @param {{ frontMatter?: boolean, synopsis?: boolean, numbers?: boolean }} [opts]
 */
function compileStory(story, chapters, opts = {}) {
  const { frontMatter = true, synopsis = false, numbers = true } = opts;
  const out = [];

  if (frontMatter) {
    out.push(`# ${story.title}`);
    if (story.author_name) out.push(`*by ${story.author_name}*`);
    if (story.description) out.push(story.description);
    if (synopsis && story.synopsis) {
      out.push(RULE, '## Synopsis', story.synopsis);
    }
    out.push(RULE);
  }

  // Arcs become the parts of the book, using the same grouping the story
  // page shows, so a compiled manuscript is laid out the way its contents
  // page said it would be.
  const groups = groupChaptersIntoArcs(chapters);
  for (const group of groups) {
    if (group.title) out.push(`# ${group.title}`);
    for (const chapter of group.chapters) {
      const heading = numbers
        ? `Chapter ${chapter.chapter_number}: ${chapter.title}`
        : chapter.title;
      out.push(`## ${heading}`);
      out.push(String(chapter.content || '').trim());
    }
  }

  // One blank line between blocks, two at most, and a single newline at
  // the end: a file that ends in eleven blank lines is a file somebody
  // has to tidy before they send it anywhere.
  return `${out.filter((piece) => String(piece).trim()).join('\n\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

module.exports = { compileStory };
