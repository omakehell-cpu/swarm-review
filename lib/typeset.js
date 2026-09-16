'use strict';

// What a compiled story *is*, before anybody decides what it looks like.
//
// Compiling used to mean one string of markdown, which every output format
// then re-parsed and guessed at. A .docx cannot tell a scene break from a
// horizontal rule that way, and a PDF cannot tell a part title from a
// chapter title, because by then they are both just a line beginning with
// a hash.
//
// So this turns a story into a list of blocks that say what they are --
// title page, part, chapter opening, paragraph, scene break -- and the
// three writers (PDF, EPUB, Word) each render that. The markdown exporter
// still writes markdown, because markdown is what the chapters are
// written in and it should stay the plain-text answer.
//
// The two presets are the two real uses, and they are genuinely different
// documents rather than two skins:
//
//   manuscript  what an editor or a competition asks for. Times 12,
//               double-spaced, ragged right, first line indented, a
//               running head with surname and title, each chapter
//               starting a third of the way down its page. Deliberately
//               plain: it is a format for being read by somebody working,
//               and every deviation from it is a distraction.
//
//   book        what you send a friend. Justified, tighter leading,
//               chapters opening on a right-hand page, scene breaks as an
//               ornament rather than a gap, the first line after a break
//               not indented -- the things a typesetter does that nobody
//               notices until they are missing.

const { parseMarkdown } = require('./markdown');
const { groupChaptersIntoArcs } = require('./story-state');

const LAYOUTS = ['manuscript', 'book'];
const DEFAULT_LAYOUT = 'manuscript';
const layoutName = (value) => (LAYOUTS.includes(String(value)) ? String(value) : DEFAULT_LAYOUT);

// Everything a writer needs to know, in one place, so "what does the book
// preset do about scene breaks" has one answer rather than three.
const PRESETS = {
  manuscript: {
    name: 'manuscript',
    label: 'Manuscript',
    note: 'What an editor or a competition asks for: double-spaced, ragged right, running heads.',
    serif: 'Times-Roman',
    bodySize: 12,
    lineHeight: 2,
    justify: false,
    indentFirstParagraph: false,
    indentEm: 2,
    sceneBreak: '#',
    chapterOpensOnRecto: false,
    // A third of the way down, which is where a manuscript chapter starts.
    chapterDropRatio: 1 / 3,
    runningHead: 'surname',
    pageNumbers: true,
    marginIn: 1,
  },
  book: {
    name: 'book',
    label: 'Book',
    note: 'What you send a friend: justified, chapters opening on the right, scene breaks as an ornament.',
    serif: 'Times-Roman',
    bodySize: 11.5,
    lineHeight: 1.45,
    justify: true,
    indentFirstParagraph: false,
    indentEm: 1.2,
    // Not an asterism: the standard PDF fonts are WinAnsi and would draw
    // it as a stray "B". Three spaced asterisks is the older convention
    // anyway, and it exists in every encoding there is.
    sceneBreak: '* * *',
    chapterOpensOnRecto: true,
    chapterDropRatio: 0.22,
    runningHead: 'title',
    pageNumbers: true,
    marginIn: 0.9,
  },
};

const preset = (layout) => PRESETS[layoutName(layout)];

// The surname, for a running head. Nothing clever: the last word of the
// name, which is right for most people and wrong quietly rather than
// loudly for the rest.
function surnameOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/**
 * @typedef {{ layout: string, rules: any, title: string, author: string,
 *   surname: string, blocks: any[] }} TypesetDocument
 */

/**
 * A story as a list of blocks that know what they are.
 *
 * @returns {TypesetDocument}
 * @param {any} story
 * @param {any[]} chapters in running order, each with its current content
 * @param {{ layout?: string, synopsis?: boolean, numbers?: boolean, frontMatter?: boolean }} [opts]
 */
function typesetStory(story, chapters, opts = {}) {
  const { synopsis = false, numbers = true, frontMatter = true } = opts;
  const rules = preset(opts.layout);
  /** @type {any[]} */
  const blocks = [];

  if (frontMatter) {
    blocks.push({
      type: 'titlePage',
      title: story.title,
      author: story.author_name || '',
      blurb: story.description || '',
      words: chapters.reduce((sum, c) => sum + (c.word_count || 0), 0),
    });
    if (synopsis && story.synopsis) {
      blocks.push({ type: 'section', title: 'Synopsis' });
      for (const b of bodyBlocks(story.synopsis)) blocks.push(b);
    }
  }

  for (const group of groupChaptersIntoArcs(chapters)) {
    if (group.title) blocks.push({ type: 'part', title: group.title });
    for (const chapter of group.chapters) {
      blocks.push({
        type: 'chapter',
        number: chapter.chapter_number,
        title: chapter.title,
        heading: numbers ? `Chapter ${chapter.chapter_number}` : '',
      });
      for (const b of bodyBlocks(chapter.content)) blocks.push(b);
    }
  }

  return {
    layout: rules.name,
    rules,
    title: story.title,
    author: story.author_name || '',
    surname: surnameOf(story.author_name),
    blocks,
  };
}

// Prose, in blocks that a page can be built out of. The first paragraph
// after a chapter opening or a scene break is marked, because not
// indenting it is the single thing that most makes a page look typeset
// rather than typed.
function bodyBlocks(markdown) {
  const out = [];
  let opening = true;
  for (const node of parseMarkdown(String(markdown || ''))) {
    if (node.type === 'hr') {
      out.push({ type: 'sceneBreak' });
      opening = true;
      continue;
    }
    if (node.type === 'heading') {
      // A heading inside a chapter is the writer's own subheading, not a
      // chapter title: the chapter's own title came from its field.
      out.push({ type: 'subheading', level: node.level, inline: node.inline });
      opening = true;
      continue;
    }
    if (node.type === 'paragraph') {
      out.push({ type: 'paragraph', inline: node.inline, opening });
      opening = false;
      continue;
    }
    out.push({ ...node, opening });
    opening = false;
  }
  return out;
}

// Inline nodes flattened to runs of text with their styling, which is what
// both PDF and Word want and what EPUB does not mind.
function runsOf(inline, inherited = {}) {
  const runs = [];
  for (const node of inline || []) {
    if (node.type === 'text') { runs.push({ text: node.value, ...inherited }); continue; }
    if (node.type === 'em') { runs.push(...runsOf(node.children, { ...inherited, italic: true })); continue; }
    if (node.type === 'strong') { runs.push(...runsOf(node.children, { ...inherited, bold: true })); continue; }
    if (node.type === 'strike') { runs.push(...runsOf(node.children, { ...inherited, strike: true })); continue; }
    if (node.type === 'code') { runs.push({ text: node.value, ...inherited, mono: true }); continue; }
    if (node.type === 'link') {
      runs.push(...runsOf(node.children || [{ type: 'text', value: node.href }], { ...inherited, href: node.href }));
      continue;
    }
    if (node.children) { runs.push(...runsOf(node.children, inherited)); continue; }
    if (node.value) runs.push({ text: String(node.value), ...inherited });
  }
  return runs;
}

const plainText = (inline) => runsOf(inline).map((r) => r.text).join('');

module.exports = {
  DEFAULT_LAYOUT, LAYOUTS, PRESETS,
  bodyBlocks, layoutName, plainText, preset, runsOf, surnameOf, typesetStory,
};
