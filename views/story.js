'use strict';

const { layout } = require('../lib/layout');
const { followButton } = require('./front');
const { escapeHtml } = require('../lib/util');
const { parseMarkdown, renderHighlighted } = require('../lib/markdown');
const { timeHtml } = require('../lib/time');
const { groupChaptersIntoArcs } = require('../lib/story-state');
const { ICONS, bylineWith, chapterStageBadge, emptyState, goalBar, storyCoverImg, storyStateBadge, tagChips, wordCount } = require('./shared');

// Two separate forms, because each posts somewhere different, but one
// control as far as the eye is concerned: a single bordered pair sitting
// against the row, quiet until you point at it. As two floating boxes
// with a gap between them they read as debris in the margin.
function chapterReorderButtons(chapter, index, total) {
  const label = `chapter ${chapter.chapter_number}, ${escapeHtml(chapter.title)}`;
  return `
    <div class="chapter-row-reorder" role="group" aria-label="Reorder ${label}">
      <form method="post" action="/chapters/${chapter.id}/move-up" class="inline-form">
        <button type="submit" title="Move up" aria-label="Move ${label} up" ${index === 0 ? 'disabled' : ''}>&uarr;</button>
      </form>
      <form method="post" action="/chapters/${chapter.id}/move-down" class="inline-form">
        <button type="submit" title="Move down" aria-label="Move ${label} down" ${index === total - 1 ? 'disabled' : ''}>&darr;</button>
      </form>
    </div>`;
}

// The false alarms put away from the unknown-names list live in the
// bible now, beside the names they were mistaken for; this is the way there.
function notNamesSection(story, notNames) {
  if (!notNames.length) return '';
  return `
    <p class="hint story-not-names"><a href="/stories/${story.id}/bible#not-names">${notNames.length} word${notNames.length === 1 ? '' : 's'} put away as not names &rarr;</a></p>`;
}

function storyDictionarySection(story, dictionary) {
  const words = dictionary.length ? `
    <ul class="story-dictionary-list">
      ${dictionary.map((entry) => `
        <li>
          <span class="invite-code-inline">${escapeHtml(entry.word)}</span>
          <form method="post" action="/stories/${story.id}/dictionary/${entry.id}/delete" class="inline-form">
            <button class="btn tiny ghost" type="submit" title="Remove" aria-label="Remove ${escapeHtml(entry.word)} from the dictionary">&times;</button>
          </form>
        </li>
      `).join('')}
    </ul>` : '<p class="muted">No words added yet.</p>';

  return `
    <details class="story-dictionary" id="dictionary">
      <summary>Story dictionary${dictionary.length ? ` (${dictionary.length})` : ''}</summary>
      <p class="hint">Words the writing analyzer should stop flagging as possible misspellings while you write this story -- handy for invented character or place names.</p>
      <form method="post" action="/stories/${story.id}/dictionary" class="named-invite-form">
        <input type="text" name="word" placeholder="e.g. Aetherius" required>
        <button class="btn small" type="submit">Add word</button>
      </form>
      ${words}
    </details>`;
}


// 250 words a minute is the usual figure for adult fiction read for
// pleasure. It is an estimate and is written as one -- "about 40 minutes",
// never "38 minutes" -- because the false precision is what makes this
// kind of number annoying.
function readingTime(words) {
  const minutes = Math.round((Number(words) || 0) / 250);
  if (!minutes) return 'a few minutes';
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!rest) return `about ${hours} hour${hours === 1 ? '' : 's'}`;
  return `about ${hours}h ${rest}m`;
}

function storyStatsBlock(stats) {
  if (!stats) return '';
  const item = (value, label) => `<div class="story-stat"><span class="story-stat-value">${value}</span><span class="story-stat-label">${label}</span></div>`;
  return `
    <div class="story-stats">
      ${stats.arcs ? item(stats.arcs, `arc${stats.arcs === 1 ? '' : 's'}`) : ''}
      ${item(stats.chapters, `chapter${stats.chapters === 1 ? '' : 's'}`)}
      ${stats.words ? item(wordCount(stats.words).replace(/ words$/, ''), 'words') : ''}
      ${stats.words ? item(readingTime(stats.words).replace(/^about /, ''), 'to read') : ''}
      ${stats.comments ? item(stats.comments, `comment${stats.comments === 1 ? '' : 's'}`) : ''}
      ${stats.pending_comments ? item(stats.pending_comments, 'unresolved') : ''}
      ${stats.last_written_at ? `<div class="story-stat"><span class="story-stat-value">${timeHtml(stats.last_written_at)}</span><span class="story-stat-label">last written</span></div>` : ''}
    </div>`;
}

// The whole story as one file, in whichever shape it is for.
//
// The two layouts are not two skins on one document: a manuscript is what
// an editor asks for and is deliberately plain, and a book is what you
// send a friend. Choosing between them at the moment of downloading is
// the only place the choice makes sense -- it is a fact about where the
// file is going, not a setting about the story.
//
// A form rather than a row of links, because otherwise every format would
// need two buttons, then four when somebody wants the synopsis.
function compileSection(story) {
  const layouts = [
    ['manuscript', 'Manuscript', 'Double-spaced, ragged right, running heads. What an editor or a competition asks for.'],
    ['book', 'Book', 'Justified, chapters opening on the right, scene breaks as an ornament. What you send a friend.'],
  ];
  return `
    <section class="compile">
      <h2 class="side-head">The whole story, in one file</h2>
      <p class="muted">Every chapter in order, arcs as parts, with a title page. The chapters are compiled as they stand now.</p>
      <form class="compile-form" method="get" action="/stories/${story.id}/download.pdf" data-compile>
        <fieldset class="compile-layouts">
          <legend>Laid out as</legend>
          ${layouts.map(([value, label, note], i) => `
            <label class="compile-layout">
              <input type="radio" name="layout" value="${value}"${i === 0 ? ' checked' : ''}>
              <span><strong>${label}</strong><span class="muted">${escapeHtml(note)}</span></span>
            </label>`).join('')}
        </fieldset>
        ${story.synopsis ? `
          <label class="compile-option">
            <input type="checkbox" name="synopsis" value="1"> Include the synopsis
          </label>` : ''}
        <p class="compile-links">
          ${[['pdf', 'PDF'], ['epub', 'EPUB'], ['docx', 'Word'], ['md', 'Markdown'], ['txt', 'Plain text']]
    .map(([ext, label]) => `<button class="btn ghost small" type="submit" formaction="/stories/${story.id}/download.${ext}">${label}</button>`).join('')}
        </p>
        <p class="hint">PDF and EPUB are laid out; Word, Markdown and plain text carry the text and let whatever opens them decide how it looks.</p>
      </form>
    </section>`;
}

function synopsisSection(story) {
  if (!story.synopsis) return '';
  return `
    <details class="story-synopsis">
      <summary>Synopsis &mdash; what happens so far <span class="muted">(spoilers)</span></summary>
      <div class="prose">${renderHighlighted(parseMarkdown(story.synopsis), [], null)}</div>
    </details>`;
}


// The same thing in one glyph per person, for a list of chapters where the
// names would not fit.
function readerDots(readers, currentVersionNumber) {
  if (!readers || !readers.length) return '';
  const title = readers.map((r) => r.display_name).join(', ');
  return `<span class="reader-dots" title="Opened by ${escapeHtml(title)}">${readers.map((r) => `
    <span class="reader-dot${r.version_number >= currentVersionNumber ? '' : ' earlier'}"
          aria-hidden="true">${escapeHtml(r.display_name.trim()[0] || '?')}</span>`).join('')}<span class="visually-hidden">Opened by ${escapeHtml(title)}</span></span>`;
}

function coauthorsSection({ story, coauthors, addableCoauthors, isStoryAuthor, currentUserId }) {
  const rows = coauthors.length
    ? coauthors.map((c) => `
        <li>
          <span>${escapeHtml(c.display_name)}</span>
          ${(isStoryAuthor || c.id === currentUserId) ? `
            <form method="post" action="/stories/${story.id}/authors/${c.id}/remove" class="inline-form"
                  data-confirm="${isStoryAuthor
                    ? `Remove ${escapeHtml(c.display_name)} as a coauthor? The chapters they wrote stay theirs.`
                    : 'Step back from this story? The chapters you wrote stay yours.'}">
              <button class="linklike" type="submit">${isStoryAuthor ? 'Remove' : 'Step back'}</button>
            </form>` : ''}
        </li>`).join('')
    : '<li class="muted">Nobody yet.</li>';

  const addForm = (isStoryAuthor && addableCoauthors.length) ? `
    <form method="post" action="/stories/${story.id}/authors" class="coauthor-add">
      <label>Add a coauthor
        <select name="userId">
          ${addableCoauthors.map((u) => `<option value="${u.id}">${escapeHtml(u.display_name)}</option>`).join('')}
        </select>
      </label>
      <button class="btn small" type="submit">Add</button>
    </form>` : '';

  return `
    <section class="coauthors" id="authors">
      <h2>Who can write in this story</h2>
      <p class="muted">A coauthor can add chapters and edit the ones they wrote, and shares the story's dictionary. Editing someone else's chapter, changing the story's details or archiving it stay with ${escapeHtml(story.author_name)}.</p>
      <ul class="coauthor-list">${rows}</ul>
      ${addForm}
    </section>`;
}

function arcHeading(group, position) {
  if (!group.title) return '';
  const words = group.chapters.reduce((sum, c) => sum + (c.word_count || 0), 0);
  return `
    <div class="arc-head">
      <h3 class="arc-title"><span class="arc-number">${String(position).padStart(2, '0')}</span>${escapeHtml(group.title)}</h3>
      <p class="arc-meta">${group.chapters.length} chapter${group.chapters.length === 1 ? '' : 's'}${words ? ` &middot; ${wordCount(words)}` : ''}</p>
    </div>`;
}

// Where a reader should start: the first chapter they have not opened
// yet, or the beginning if they have read them all or none.
function readingStart(chapters, readersByChapter, userId) {
  if (!chapters.length) return null;
  const read = (c) => (readersByChapter.get(c.id) || []).some((r) => r.id === userId);
  const readCount = chapters.filter(read).length;
  if (readCount === 0) return { chapter: chapters[0], label: 'Start reading' };
  const next = chapters.find((c) => !read(c) && c.author_id !== userId);
  if (next) return { chapter: next, label: `Continue with chapter ${next.chapter_number}` };
  return { chapter: chapters[0], label: 'Read it again from the start' };
}

// The story page is set like the front of a book: a title page -- the
// cover, the title, who wrote it, what it is about, and the one thing a
// reader came to do, which is start reading -- and then the contents, one
// line per chapter with a dotted leader to its length. Everything the
// authors need (outline, analysis, the bible, the details) is still here,
// on a quieter row under the title page.
function storyPage({ user, story, chapters, isStoryAuthor, canWrite = false, dictionary = [], notNames = [], tags = [], coauthors = [], addableCoauthors = [], stats = null, readersByChapter = new Map(), bibleCount = 0, bibleVisible = true, glossary = null, following = false, followers = 0 }) {
  const pad = (n) => String(n).padStart(2, '0');
  const chapterRow = (c, i) => `
    <div class="chapter-row-outer toc-entry">
      <a class="chapter-row toc-row" href="/chapters/${c.id}">
        <div class="chapter-row-main">
          <h3><span class="toc-num" aria-hidden="true">${pad(c.chapter_number)}</span><span class="toc-title"><span class="sr-only">Chapter ${c.chapter_number}: </span>${escapeHtml(c.title)}</span>
            ${c.is_new ? '<span class="badge new">New</span>' : (c.has_new_comments ? '<span class="badge new-comments">New comments</span>' : '')}
            ${chapterStageBadge(c)}
            <span class="toc-leader" aria-hidden="true"></span>
            <span class="toc-words">${c.word_count ? wordCount(c.word_count) : ''}</span>
          </h3>
          ${c.summary ? `<p class="muted">${escapeHtml(c.summary)}</p>` : ''}
        </div>
        <div class="chapter-row-meta">
          ${readerDots(readersByChapter.get(c.id) || [], c.latest_version)}
          <span>by ${escapeHtml(c.author_name)}</span>
          <span>v${c.latest_version}</span>
          ${timeHtml(c.created_at)}
          ${c.pending_comments > 0 ? `<span class="badge pending">${c.pending_comments} waiting</span>` : ''}
        </div>
      </a>
      ${isStoryAuthor ? chapterReorderButtons(c, i, chapters.length) : ''}
    </div>
  `;
  const arcs = groupChaptersIntoArcs(chapters);
  const named = arcs.filter((g) => g.title).length;
  let arcNumber = 0;
  const rows = chapters.length ? arcs.map((group) => {
    if (group.title) arcNumber += 1;
    return `<section class="arc">${arcHeading(group, arcNumber)}<div class="chapter-list toc">${
      group.chapters.map((c) => chapterRow(c, chapters.indexOf(c))).join('')
    }</div></section>`;
  }).join('') : emptyState({
    art: 'sheets',
    title: 'No chapters here',
    body: 'Every chapter of this story has been archived. They are still readable, and can be brought back.',
    action: `<a class="btn ghost small" href="/stories/${story.id}/archived-chapters">View archived chapters</a>`,
  });
  const start = readingStart(chapters, readersByChapter, user.id);

  return layout({
    title: story.title,
    user,
    body: `
      <section class="title-page${story.cover_filename ? ' has-cover' : ''}">
        ${storyCoverImg(story, 'story-page-cover')}
        <div class="title-page-text">
          <p class="title-page-kicker">A story ${bylineWith(story.author_name, coauthors, story.author_username)}</p>
          <h1>${escapeHtml(story.title)}</h1>
          ${story.description ? `<p class="title-page-blurb">${escapeHtml(story.description)}</p>` : ''}
          <p class="title-page-facts">${storyStateBadge(story)} ${chapters.length} chapter${chapters.length === 1 ? '' : 's'}${stats && stats.words ? ` &middot; ${wordCount(stats.words)}` : ''} &middot; started ${timeHtml(story.created_at)}</p>
          ${story.series || story.source_url || glossary ? `<p class="title-page-source">${[
    story.series ? `Part of <em>${escapeHtml(story.series)}</em>` : '',
    story.source_url ? `<a href="${escapeHtml(story.source_url)}" target="_blank" rel="noopener noreferrer">first published on StoriesOnline</a>` : '',
    glossary ? `<a href="/wiki/${encodeURIComponent(glossary.title)}">${glossary.fromWiki ? 'its page in the wiki' : 'in the wiki'}</a>` : '',
  ].filter(Boolean).join(' &middot; ')}</p>` : ''}
          ${tagChips(tags)}
          <div class="title-page-actions">
            ${start ? `<a class="btn" href="/chapters/${start.chapter.id}">${ICONS.book}${escapeHtml(start.label)}</a>` : ''}
            ${canWrite ? `<a class="btn ghost" href="/stories/${story.id}/chapters/new">${ICONS.plus}Add chapter</a>` : ''}
            ${isStoryAuthor ? '' : followButton(story.id, following, { followers })}
          </div>
        </div>
      </section>
      <nav class="story-tools" aria-label="About this story">
        ${canWrite ? `<a href="/stories/${story.id}/plan">Plan</a>` : ''}
        <a href="/stories/${story.id}/outline">Outline</a>
        <a href="/stories/${story.id}/analysis">Analysis</a>
        <a href="/stories/${story.id}/timeline">Timeline</a>
        ${bibleVisible ? `<a href="/stories/${story.id}/bible">Glossary${bibleCount ? ` <span class="btn-count">${bibleCount}</span>` : ''}${story.bible_private && isStoryAuthor ? ' <span class="btn-count">private</span>' : ''}</a>` : ''}
        ${isStoryAuthor ? `<a href="/stories/${story.id}/edit">Edit details</a>` : ''}
        ${isStoryAuthor ? `
          <details class="menu story-more">
            <summary aria-label="More for this story: archiving">More</summary>
            <div class="menu-panel">
              <form method="post" action="/stories/${story.id}/archive" class="inline-form"
                    data-confirm="Archive this story? It leaves the front page and stays readable from the archived stories.">
                <button class="menu-danger" type="submit">Archive story</button>
              </form>
            </div>
          </details>` : ''}
      </nav>
      <details class="story-numbers">
        <summary>The story in numbers</summary>
        ${storyStatsBlock(stats)}
        ${goalBar(stats ? stats.words : 0, story.word_goal)}
      </details>
      ${synopsisSection(story)}
      <h2 class="toc-heading">Contents</h2>
      ${named ? `<div class="arc-stack">${rows}</div>` : `<div class="chapter-list toc">${rows}</div>`}
      ${chapters.length ? compileSection(story) : ''}
      <p class="muted archive-link"><a href="/stories/${story.id}/archived-chapters">View archived chapters &rarr;</a></p>
      ${(isStoryAuthor || coauthors.length) ? coauthorsSection({ story, coauthors, addableCoauthors, isStoryAuthor, currentUserId: user.id }) : ''}
      ${canWrite ? storyDictionarySection(story, dictionary) + notNamesSection(story, notNames) : ''}`,
  });
}

// ---------- archived chapters (within a story) ----------

function archivedChaptersPage({ user, story, chapters }) {
  const rows = chapters.length ? chapters.map((c) => `
    <div class="chapter-row archived-row">
      <div class="chapter-row-main">
        <h3>Chapter ${c.chapter_number}: ${escapeHtml(c.title)}</h3>
        <p class="muted">archived ${timeHtml(c.archived_at)}</p>
      </div>
      <div class="chapter-row-meta">
        ${user.id === c.author_id ? `
          <form method="post" action="/chapters/${c.id}/unarchive" class="inline-form">
            <button class="btn small ghost" type="submit">Unarchive</button>
          </form>
          <form method="post" action="/chapters/${c.id}/delete" class="inline-form" data-confirm="Delete this chapter and all its versions and comments forever? This cannot be undone.">
            <button class="btn small danger" type="submit">Delete forever</button>
          </form>` : ''}
      </div>
    </div>
  `).join('') : '<p class="muted">No archived chapters.</p>';

  return layout({
    title: `Archived chapters - ${story.title}`,
    user,
    body: `
      <p class="breadcrumb"><a href="/stories/${story.id}">&larr; ${escapeHtml(story.title)}</a></p>
      <h1>Archived chapters</h1>
      <div class="chapter-list">${rows}</div>`,
  });
}

// ---------- chapter reading + review page ----------

module.exports = {
  arcHeading,
  archivedChaptersPage,
  chapterReorderButtons,
  coauthorsSection,
  readerDots,
  readingTime,
  storyDictionarySection,
  storyPage,
  storyStatsBlock,
  compileSection,
  synopsisSection,
};
