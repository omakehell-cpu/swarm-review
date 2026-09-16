'use strict';

const { layout } = require('../lib/layout');
const { escapeHtml, toScriptJson } = require('../lib/util');
const { parseMarkdown, renderHighlighted } = require('../lib/markdown');
const { timeHtml } = require('../lib/time');
const { chapterCastBlock, missingNamesBlock } = require('./bible');
const { ICONS, STATUS_LABEL, emptyState, personLink, readersLine, wiki, wordCount } = require('./shared');
function renderReply(r, { currentUserId }) {
  const isReplyAuthor = currentUserId === r.author_id;
  if (r.deleted_at) {
    return `<div class="reply retracted"><strong>${escapeHtml(r.author_name)}</strong> <span class="muted"><em>[retracted]</em></span></div>`;
  }
  return `
    <div class="reply">
      <strong>${escapeHtml(r.author_name)}</strong>
      <span>${escapeHtml(r.body)}</span>
      ${timeHtml(r.created_at)}
      ${isReplyAuthor ? `
        <form method="post" action="/comments/${r.id}/retract" class="inline-form" data-confirm="Retract this reply?">
          <button class="btn tiny ghost" type="submit">Retract</button>
        </form>` : ''}
    </div>`;
}

function renderComment(c, { isChapterAuthor, currentUserId, replies }) {
  const statusLabel = STATUS_LABEL[c.status] || c.status;
  const repliesHtml = replies.map((r) => renderReply(r, { currentUserId })).join('');

  if (c.deleted_at) {
    return `
      <div class="comment status-${c.status} retracted" id="comment-${c.id}" data-comment-id="${c.id}">
        <div class="comment-meta">
          <strong>${escapeHtml(c.author_name)}</strong>
          <span class="status-badge status-${c.status}">${statusLabel}</span>
          ${timeHtml(c.created_at)}
        </div>
        <p class="comment-body muted"><em>[comment retracted]</em></p>
        ${repliesHtml}
      </div>`;
  }

  const isCommentAuthor = currentUserId === c.author_id;
  // An accepted or rejected note has been dealt with, so it folds to one
  // line: the column should read as a list of what still needs answering,
  // with the settled ones a click away rather than gone. Pending notes are
  // the actual work and stay open. <details> rather than a script, so the
  // column still behaves with JavaScript off.
  const settled = c.status !== 'pending';
  const statusBadge = `<span class="status-badge status-${c.status}">${statusLabel}</span>`;

  const inner = `
      ${c.quoted_text ? `<blockquote class="quoted">${escapeHtml(c.quoted_text)}</blockquote>` : ''}
      <p class="comment-body">${escapeHtml(c.body)}</p>
      <div class="comment-actions">
        ${isChapterAuthor && c.status === 'pending' ? `
          <form method="post" action="/comments/${c.id}/status" class="inline-form">
            <button name="status" value="accepted" class="btn small accept" type="submit">${ICONS.tick}Accept</button>
            <button name="status" value="rejected" class="btn small reject" type="submit">${ICONS.cross}Reject</button>
          </form>` : ''}
        ${isChapterAuthor && c.status !== 'pending' ? `
          <form method="post" action="/comments/${c.id}/reopen" class="inline-form">
            <button class="btn small ghost" type="submit">Reopen</button>
          </form>` : ''}
        ${isCommentAuthor ? `
          <form method="post" action="/comments/${c.id}/retract" class="inline-form" data-confirm="Retract this comment?">
            <button class="btn small ghost" type="submit">Retract</button>
          </form>` : ''}
      </div>
      ${isCommentAuthor ? `
        <details class="edit-comment">
          <summary>Edit</summary>
          <form method="post" action="/comments/${c.id}/edit">
            <textarea name="body" required maxlength="4000">${escapeHtml(c.body)}</textarea>
            <button type="submit" class="btn small">Save</button>
          </form>
        </details>` : ''}
      ${repliesHtml}
      <details class="reply-box">
        <summary>Reply</summary>
        <form method="post" action="/comments/${c.id}/reply" class="reply-form">
          <input type="text" name="body" placeholder="Reply..." required maxlength="2000">
          <button type="submit" class="btn small ghost">Reply</button>
        </form>
      </details>`;

  if (settled) {
    return `
    <details class="comment settled status-${c.status}" id="comment-${c.id}" data-comment-id="${c.id}">
      <summary class="comment-summary">
        <strong>${escapeHtml(c.author_name)}</strong>
        ${statusBadge}
        <span class="comment-gist">${escapeHtml(c.body)}</span>
      </summary>
      <p class="comment-when muted">${timeHtml(c.created_at)}${c.edited_at ? ' &middot; edited' : ''}</p>
      ${inner}
    </details>`;
  }

  return `
    <div class="comment status-${c.status}" id="comment-${c.id}" data-comment-id="${c.id}">
      <div class="comment-meta">
        <strong>${escapeHtml(c.author_name)}</strong>
        ${statusBadge}
        ${timeHtml(c.created_at)}
        ${c.edited_at ? '<span class="muted edited-tag">(edited)</span>' : ''}
      </div>
      ${inner}
    </div>`;
}


// Moving between chapters without going back to the story page. Absent
// entirely for a one-chapter story, where "next" and "previous" are just
// two dead controls.
function chapterNav(chapter, neighbours, { compact = false, canWrite = false } = {}) {
  const total = neighbours ? neighbours.total : 1;
  const prev = neighbours ? neighbours.prev : null;
  const next = neighbours ? neighbours.next : null;
  const label = (c) => `Chapter ${c.chapter_number}: ${escapeHtml(c.title)}`;

  // The compact one rides on the breadcrumb line, where the breadcrumb
  // itself is already the link back to the story and the byline under it
  // already says which chapter of how many this is -- so it carries the
  // two arrows and nothing else. Saying "chapter 1 of 3" a third time
  // within four lines is not navigation, it is noise.
  if (compact) {
    if (total < 2) return '';
    return `
      <nav class="chapter-nav compact" aria-label="Chapters">
        ${prev ? `<a class="chapter-nav-arrow" href="/chapters/${prev.id}" title="${label(prev)}" rel="prev">&larr; Previous</a>`
               : '<span class="chapter-nav-arrow disabled">&larr; Previous</span>'}
        ${next ? `<a class="chapter-nav-arrow" href="/chapters/${next.id}" title="${label(next)}" rel="next">Next &rarr;</a>`
               : '<span class="chapter-nav-arrow disabled">Next &rarr;</span>'}
      </nav>`;
  }
  // The one at the foot of the chapter carries the titles: by the time
  // you get there you've finished reading and the question is what comes
  // next, which a bare arrow doesn't answer.
  //
  // For whoever writes the story, the answer to that question at the end
  // of the last chapter is "nothing yet" -- which is the moment to offer
  // the next one, in the slot the next chapter would occupy. It is the
  // one place on this page where adding a chapter is the obvious thing
  // to do, and it is why the foot still renders for a story with a
  // single chapter and no neighbours at all.
  const writeNext = !next && canWrite
    ? `<a class="chapter-nav-link next add" href="/stories/${chapter.story_id}/chapters/new">
          <span class="chapter-nav-dir">Next &rarr;</span>
          <span class="chapter-nav-title">${ICONS.plus}Write the next chapter</span>
        </a>`
    : '<span></span>';
  if (total < 2 && !canWrite) return '';
  return `
    <nav class="chapter-nav foot" aria-label="Chapters">
      ${prev ? `<a class="chapter-nav-link prev" href="/chapters/${prev.id}" rel="prev">
          <span class="chapter-nav-dir">&larr; Previous</span>
          <span class="chapter-nav-title">${label(prev)}</span>
        </a>` : '<span></span>'}
      <a class="chapter-nav-here" href="/stories/${chapter.story_id}">All chapters</a>
      ${next ? `<a class="chapter-nav-link next" href="/chapters/${next.id}" rel="next">
          <span class="chapter-nav-dir">Next &rarr;</span>
          <span class="chapter-nav-title">${label(next)}</span>
        </a>` : writeNext}
    </nav>`;
}


// Two arrows pinned to the edges of the window, and only while the
// chapter is being read rather than reviewed: in read mode there is
// nothing else on screen to click, and what you want next is almost
// always the next chapter. They stay out of the way -- half-faded until
// pointed at -- and they are gone entirely on any window too narrow to
// have margins to spare, where they would sit on top of the prose.
function chapterFloatNav(chapter, neighbours) {
  if (!neighbours || neighbours.total < 2) return '';
  const { prev, next } = neighbours;
  const label = (c) => `Chapter ${c.chapter_number}: ${escapeHtml(c.title)}`;
  return `
    <nav class="chapter-float" aria-label="Chapters, while reading">
      ${prev ? `<a class="chapter-float-arrow prev" href="/chapters/${prev.id}" rel="prev"
          title="${label(prev)}" aria-label="Previous chapter" aria-keyshortcuts="ArrowLeft">&larr;</a>` : ''}
      ${next ? `<a class="chapter-float-arrow next" href="/chapters/${next.id}" rel="next"
          title="${label(next)}" aria-label="Next chapter" aria-keyshortcuts="ArrowRight">&rarr;</a>` : ''}
    </nav>`;
}

function chapterPage({ user, chapter, versions, currentVersion, comments, isChapterAuthor, canWrite = false, neighbours = null, readers = [], cast = [], findMatches = null, missingNames = [] }) {
  const topLevel = comments.filter((c) => c.parent_id == null);
  const repliesByParent = {};
  comments.filter((c) => c.parent_id != null).forEach((c) => {
    (repliesByParent[c.parent_id] = repliesByParent[c.parent_id] || []).push(c);
  });

  const versionOptions = versions.map((v) => `
    <option value="${v.version_number}" ${v.id === currentVersion.id ? 'selected' : ''}>
      v${v.version_number}${v.id === versions[0].id ? ' (latest)' : ''}
    </option>`).join('');

  // Two different things wearing one heading: a note on a passage, which
  // belongs next to that passage, and a note on the chapter, which belongs
  // to no particular line. Splitting them is what lets the first kind sit
  // in the margin -- and it is better information either way.
  const anchored = topLevel.filter((c) => c.start_offset != null && c.end_offset != null);
  const general = topLevel.filter((c) => c.start_offset == null || c.end_offset == null);
  const render = (c) => renderComment(c, { isChapterAuthor, currentUserId: user.id, replies: repliesByParent[c.id] || [] });
  const anchoredHtml = anchored.map(render).join('');
  const generalHtml = general.length ? `
    <section class="general-notes">
      <h3>On the chapter as a whole</h3>
      ${general.map(render).join('')}
    </section>` : '';

  const commentsHtml = topLevel.length
    ? topLevel.map((c) => renderComment(c, { isChapterAuthor, currentUserId: user.id, replies: repliesByParent[c.id] || [] })).join('')
    : emptyState({
      art: 'margin',
      title: 'No comments on this version',
      body: 'Select any passage in the chapter to comment on it, or use the general comment below for something that is not about one particular line.',
    });

  const ast = parseMarkdown(currentVersion.content);
  // The story's own cast first, then whatever wiki names are left over
  // (see lib/cast-links.js); falling back to the wiki alone for any caller
  // that has not built the combined matcher.
  const highlighted = renderHighlighted(ast, comments, findMatches || wiki.findWikiMatches);

  const body = `
    <div class="chapter-topline">
      <p class="breadcrumb"><a href="/stories/${chapter.story_id}">&larr; ${escapeHtml(chapter.story_title)}</a></p>
      ${chapterNav(chapter, neighbours, { compact: true })}
    </div>
    <div class="chapter-header">
      <h1>Chapter ${chapter.chapter_number}: ${escapeHtml(chapter.title)}</h1>
      <p class="muted byline">by ${personLink(chapter.author_username, chapter.author_name)} &middot; ${timeHtml(chapter.created_at)}${
        currentVersion.word_count ? ` &middot; ${wordCount(currentVersion.word_count)}` : ''
      }${
        neighbours && neighbours.total > 1 ? ` &middot; <a href="/stories/${chapter.story_id}">chapter ${neighbours.position} of ${neighbours.total}</a>` : ''
      }</p>
      ${chapter.summary ? `<p class="summary">${escapeHtml(chapter.summary)}</p>` : ''}
      ${isChapterAuthor ? `<p class="readers-line">${readersLine(readers, currentVersion.version_number)}</p>` : ''}
      <div class="version-bar">
        <div class="version-context">
          <label>Version:
            <select id="version-select">${versionOptions}</select>
          </label>
          ${timeHtml(currentVersion.created_at, 'version-ts')}
          ${currentVersion.changelog ? `<span class="changelog muted">&ldquo;${escapeHtml(currentVersion.changelog)}&rdquo;</span>` : ''}
          ${versions.length > 1 ? `<a class="version-compare" href="/chapters/${chapter.id}/diff?to=${currentVersion.version_number}">What changed?</a>` : ''}
        </div>
        <div class="version-actions" id="reading-controls" data-has-comments="${comments.length ? '1' : '0'}">
          <div class="mode-switch" role="group" aria-label="How to view this chapter">
            <button type="button" data-mode="read" aria-pressed="false">Read</button>
            <button type="button" data-mode="review" aria-pressed="false">Review</button>
          </div>
          <details class="reading-prefs">
            <summary>Aa</summary>
            <div class="reading-prefs-panel">
              <div class="reading-prefs-row">
                <span>Type size</span>
                <div class="reading-prefs-options">
                  <button type="button" data-pref="reading-size" data-value="1rem">S</button>
                  <button type="button" data-pref="reading-size" data-value="">M</button>
                  <button type="button" data-pref="reading-size" data-value="1.25rem">L</button>
                  <button type="button" data-pref="reading-size" data-value="1.45rem">XL</button>
                </div>
              </div>
              <div class="reading-prefs-row">
                <span>Line length</span>
                <div class="reading-prefs-options">
                  <button type="button" data-pref="reading-measure" data-value="58ch">Narrow</button>
                  <button type="button" data-pref="reading-measure" data-value="">Normal</button>
                  <button type="button" data-pref="reading-measure" data-value="86ch">Wide</button>
                </div>
              </div>
              <div class="reading-prefs-row">
                <span>Line spacing</span>
                <div class="reading-prefs-options">
                  <button type="button" data-pref="reading-leading" data-value="1.55">Tight</button>
                  <button type="button" data-pref="reading-leading" data-value="">Normal</button>
                  <button type="button" data-pref="reading-leading" data-value="2.05">Loose</button>
                </div>
              </div>
            </div>
          </details>
          <button id="reading-fill-screen" class="btn ghost small" type="button">Fill screen</button>
          ${isChapterAuthor ? `<a class="btn ghost small" href="/chapters/${chapter.id}/edit">Edit</a>` : ''}
          <details class="menu">
            <summary class="btn ghost small">More</summary>
            <div class="menu-panel">
              ${canWrite ? `
                <p class="menu-heading">Story</p>
                <a href="/stories/${chapter.story_id}/chapters/new">Add a chapter</a>` : ''}
              <p class="menu-heading">Download this version</p>
              <a href="/chapters/${chapter.id}/download.docx?v=${currentVersion.version_number}">Word (.docx)</a>
              <a href="/chapters/${chapter.id}/download.md?v=${currentVersion.version_number}">Markdown (.md)</a>
              <a href="/chapters/${chapter.id}/download.txt?v=${currentVersion.version_number}">Plain text (.txt)</a>
              ${isChapterAuthor ? `
                <p class="menu-heading">Chapter</p>
                <form method="post" action="/chapters/${chapter.id}/archive" class="inline-form"
                      data-confirm="Archive this chapter? It stays readable from the story's archived chapters.">
                  <button class="menu-danger" type="submit">Archive chapter</button>
                </form>` : ''}
            </div>
          </details>
        </div>
      </div>
    </div>
    <div class="chapter-body-grid">
      <div class="reading-pane">
        <div id="chapter-text" data-chapter-id="${chapter.id}" data-version-id="${currentVersion.id}" data-story-id="${chapter.story_id}" data-can-edit-dictionary="${isChapterAuthor ? '1' : '0'}" data-is-author="${isChapterAuthor ? '1' : '0'}">${highlighted}</div>
      </div>
      <aside class="comments-pane">
        <h2>Comments</h2>
        <div id="comment-list">${topLevel.length ? anchoredHtml : commentsHtml}</div>
        ${generalHtml}

        <div id="new-comment-box" class="new-comment-box hidden">
          <p class="quoted-preview" id="nc-preview"></p>
          <form method="post" action="/chapters/${chapter.id}/comments">
            <input type="hidden" name="versionId" value="${currentVersion.id}">
            <input type="hidden" name="start" id="nc-start">
            <input type="hidden" name="end" id="nc-end">
            <input type="hidden" name="quoted" id="nc-quoted">
            <textarea name="body" id="nc-body" required maxlength="4000" placeholder="Comment on the selected passage"></textarea>
            <div class="row">
              <button type="submit" class="btn small">Comment</button>
              <button type="button" class="btn small ghost" id="nc-cancel">Cancel</button>
            </div>
          </form>
        </div>

        <details class="general-comment">
          <summary>General comment (no text selected)</summary>
          <form method="post" action="/chapters/${chapter.id}/comments">
            <input type="hidden" name="versionId" value="${currentVersion.id}">
            <textarea name="body" required maxlength="4000" placeholder="General comment about this version"></textarea>
            <button type="submit" class="btn small">Comment</button>
          </form>
        </details>
      </aside>
    </div>
    ${chapterCastBlock(cast, chapter.story_id)}
    ${missingNamesBlock(missingNames, chapter.story_id, `/chapters/${chapter.id}`)}
    ${chapterNav(chapter, neighbours, { canWrite })}
    ${chapterFloatNav(chapter, neighbours)}
    <button id="selection-toast" class="selection-toast hidden" type="button">+ Comment on selection</button>
    <script type="application/json" id="chapter-meta">${toScriptJson({ chapterId: chapter.id })}</script>
    <script src="/js/nspell.bundle.js"></script>
    <script src="/js/writing-analyzer.js" defer></script>
    <script src="/js/app.js"></script>
  `;

  return layout({ title: chapter.title, user, body });
}

// ---------- comparing two versions of a chapter ----------

function diffVersionOptions(versions, selectedNumber) {
  return versions.map((v) => `
    <option value="${v.version_number}"${v.version_number === selectedNumber ? ' selected' : ''}>
      v${v.version_number}${v.changelog ? ` -- ${escapeHtml(v.changelog)}` : ''}
    </option>`).join('');
}

function diffBlockHtml(block) {
  if (block.type === 'equal') {
    return `<p class="diff-para diff-equal">${escapeHtml(block.text)}</p>`;
  }
  if (block.type === 'add') {
    return `<p class="diff-para diff-added"><ins>${escapeHtml(block.text)}</ins></p>`;
  }
  if (block.type === 'remove') {
    return `<p class="diff-para diff-removed"><del>${escapeHtml(block.text)}</del></p>`;
  }
  // A paragraph that was edited: the surviving words in normal type, with
  // what went and what arrived marked in place, so the sentence can still
  // be read as a sentence.
  const inner = block.words.map((w) => {
    if (w.type === 'equal') return escapeHtml(w.text);
    if (w.type === 'add') return `<ins>${escapeHtml(w.text)}</ins>`;
    return `<del>${escapeHtml(w.text)}</del>`;
  }).join('');
  return `<p class="diff-para diff-changed">${inner}</p>`;
}

function chapterDiffPage({ user, chapter, versions, fromVersion, toVersion, blocks, summary, formattingOnly = false }) {
  const body = summary.identical
    ? `<p class="muted diff-identical">${formattingOnly
        ? 'The prose is word for word the same. Only the formatting changed &mdash; emphasis, a heading, a link.'
        : 'These two versions are word for word the same.'}</p>`
    : blocks.map(diffBlockHtml).join('\n');

  // Reading the diff of a version against itself is a legitimate thing to
  // ask for by fiddling with the URL, and produces an empty page rather
  // than an error -- but say so plainly.
  const sameVersion = fromVersion.id === toVersion.id;

  return layout({
    title: `Changes - ${chapter.title}`,
    user,
    body: `
      <p class="breadcrumb"><a href="/chapters/${chapter.id}">&larr; Chapter ${chapter.chapter_number}: ${escapeHtml(chapter.title)}</a></p>
      <div class="page-head">
        <h1>What changed</h1>
      </div>

      <form method="get" action="/chapters/${chapter.id}/diff" class="diff-picker">
        <label>From
          <select name="from">${diffVersionOptions(versions, fromVersion.version_number)}</select>
        </label>
        <label>To
          <select name="to">${diffVersionOptions(versions, toVersion.version_number)}</select>
        </label>
        <button class="btn small" type="submit">Compare</button>
      </form>

      <p class="muted diff-summary">
        ${sameVersion ? 'Comparing a version with itself. ' : ''}
        ${summary.identical ? 'No differences.' : `
          <span class="diff-count added">+${summary.added} word${summary.added === 1 ? '' : 's'}</span>
          <span class="diff-count removed">&minus;${summary.removed} word${summary.removed === 1 ? '' : 's'}</span>
          across ${summary.touched} paragraph${summary.touched === 1 ? '' : 's'}`}
        &middot; v${fromVersion.version_number} ${timeHtml(fromVersion.created_at)} &rarr; v${toVersion.version_number} ${timeHtml(toVersion.created_at)}
      </p>

      <div class="reading-pane">
        <div class="diff-body">${body}</div>
      </div>`,
  });
}


// A chapter that has only ever had one version has nothing to compare it
// with -- which is a normal state for a new chapter, not an error.
function diffUnavailablePage({ user, chapter }) {
  return layout({
    title: `Changes - ${chapter.title}`,
    user,
    body: `
      <p class="breadcrumb"><a href="/chapters/${chapter.id}">&larr; Chapter ${chapter.chapter_number}: ${escapeHtml(chapter.title)}</a></p>
      <h1>Nothing to compare yet</h1>
      <p class="muted">This chapter has only one version. A second one appears the first time its author saves a change to the text, and then this page will show what moved.</p>`,
  });
}

// ---------- search ----------

module.exports = {
  chapterDiffPage,
  chapterFloatNav,
  chapterNav,
  chapterPage,
  diffBlockHtml,
  diffUnavailablePage,
  diffVersionOptions,
  renderComment,
  renderReply,
};
