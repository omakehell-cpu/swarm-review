'use strict';

// A story's face and its way round, the same on every page that belongs
// to it:
//
// - its colour: one of eight inks, picked by the story's number so it
//   never changes, used for its generated cover and to mark its pages;
// - a cover for a story nobody has given one: its title set on its colour,
//   with a mark of its own, instead of a grey square with a letter;
// - the header and tabs every page of a story shares -- Chapters, Plan,
//   Outline, Glossary, Timeline, Analysis -- instead of a row of small
//   links on one page and buttons on the others.

const { escapeHtml } = require('../lib/util');

// Eight inks, each dark enough to carry white type (every one is 6.5:1 or more
// against white), and different enough from each other to tell two
// stories apart side by side on a shelf.
const STORY_INKS = ['#1f5f6b', '#7a2e2e', '#3a4a7a', '#4f5c27', '#80551a', '#6a3a6a', '#2f5d46', '#3d4f5c'];
const MARKS = ['ring', 'diamond', 'double', 'halo', 'bar', 'ring', 'diamond', 'halo'];

const storyIndex = (story) => Math.abs(Number(story && story.id) || 0) % STORY_INKS.length;
const storyInk = (story) => STORY_INKS[storyIndex(story)];

/** The style attribute that gives an element its story's colour as --story-base. */
const storyStyle = (story) => `--story-base:${storyInk(story)}`;

/**
 * A cover for a story with no picture: its title on its colour. Decorative
 * where it stands beside the title it shows, like a real cover, so it is
 * hidden from screen readers.
 * @param {any} story needs id and title; author_name if the author is to show
 * @param {string} className the size class the page already gives covers
 * @param {{ author?: string }} [opts]
 */
function generatedCover(story, className, { author } = {}) {
  const title = String(story.title || story.story_title || '');
  const by = author !== undefined ? author : (story.author_name || '');
  const i = storyIndex(story);
  return `<span class="${className} gen-cover mark-${MARKS[i]}" style="${storyStyle(story)}" aria-hidden="true">`
    + `${by ? `<span class="gen-cover-by">${escapeHtml(by)}</span>` : ''}`
    + `<span class="gen-cover-title">${escapeHtml(title)}</span></span>`;
}

/**
 * The story's cover: its picture, cropped where its author said, or one
 * made from its title.
 */
function storyCover(story, className, opts = {}) {
  if (story && story.cover_filename) {
    const x = Number.isFinite(Number(story.cover_focus_x)) ? Number(story.cover_focus_x) : 50;
    const y = Number.isFinite(Number(story.cover_focus_y)) ? Number(story.cover_focus_y) : 50;
    return `<img class="${className}" src="/stories/${story.id}/cover?v=${encodeURIComponent(story.cover_filename)}" alt="" loading="lazy" draggable="false" style="object-position: ${x}% ${y}%">`;
  }
  return generatedCover(story, className, opts);
}

/**
 * The tabs of a story. `current` is the one this page is.
 * @param {any} story
 * @param {{ current: string, canWrite?: boolean, isOwner?: boolean, counts?: { chapters?: number, glossary?: number }, more?: string }} o
 */
function storyTabs(story, { current, canWrite = false, isOwner = false, counts = {}, more = '' }) {
  const glossaryOpen = !story.bible_private || canWrite;
  const tab = (key, href, label, count) => `<a class="story-tab${key === current ? ' is-current' : ''}" href="${href}"${key === current ? ' aria-current="page"' : ''}>${label}${count ? ` <span class="story-tab-count">${count}</span>` : ''}</a>`;
  return `
    <nav class="story-tabs" aria-label="This story" style="${storyStyle(story)}">
      <div class="story-tabs-row">
        <div class="story-tabs-scroll">
        ${tab('chapters', `/stories/${story.id}`, 'Chapters', counts.chapters)}
        ${canWrite ? tab('plan', `/stories/${story.id}/plan`, 'Plan') : ''}
        ${canWrite ? tab('outline', `/stories/${story.id}/outline`, 'Outline') : ''}
        ${glossaryOpen ? tab('glossary', `/stories/${story.id}/bible`, 'Glossary', counts.glossary) : ''}
        ${tab('timeline', `/stories/${story.id}/timeline`, 'Timeline')}
        ${tab('analysis', `/stories/${story.id}/analysis`, 'Analysis')}
        </div>
        <span class="story-tabs-end">
          ${isOwner ? `<a class="story-tab" href="/stories/${story.id}/edit">Edit details</a>` : ''}
          ${more}
        </span>
      </div>
    </nav>`;
}

/**
 * The top of every page of a story but its own: a small cover, the title
 * back to the story, and the tabs. The page's own heading comes after.
 * @param {any} story
 * @param {{ current: string, canWrite?: boolean, isOwner?: boolean }} o
 */
function storyBar(story, { current, canWrite = false, isOwner = false }) {
  return `
    <header class="story-bar" style="${storyStyle(story)}">
      <a class="story-bar-title" href="/stories/${story.id}">
        ${storyCover(story, 'story-bar-cover', { author: '' })}
        <span><span class="story-bar-name">${escapeHtml(story.title)}</span>${story.author_name ? `<span class="story-bar-by">by ${escapeHtml(story.author_name)}</span>` : ''}</span>
      </a>
      ${storyTabs(story, { current, canWrite, isOwner })}
    </header>`;
}

module.exports = { STORY_INKS, generatedCover, storyBar, storyCover, storyInk, storyStyle, storyTabs };
