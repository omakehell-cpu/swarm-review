'use strict';

const { layout } = require('../lib/layout');
const { escapeHtml, toScriptJson } = require('../lib/util');
const { parseMarkdown, renderHighlighted } = require('../lib/markdown');
const { timeHtml } = require('../lib/time');
const { besidePanel, editorBiblePanel } = require('./bible');
const { diffBlockHtml } = require('./chapter');
const { arcField, fileUploadField, markdownHint, positionField, povAndStrandFields, renderCommentReadOnly, stageField, tagPicker, uploadVersionField, whenFields } = require('./shared');
function archivedStoriesPage({ user, stories }) {
  const rows = stories.length ? stories.map((s) => `
    <div class="chapter-row archived-row">
      <div class="chapter-row-main">
        <h3>${escapeHtml(s.title)}</h3>
        <p class="muted">by ${escapeHtml(s.author_name)} &middot; archived ${timeHtml(s.archived_at)}</p>
      </div>
      <div class="chapter-row-meta">
        ${user.id === s.author_id ? `
          <form method="post" action="/stories/${s.id}/unarchive" class="inline-form">
            <button class="btn small ghost" type="submit">Unarchive</button>
          </form>
          <form method="post" action="/stories/${s.id}/delete" class="inline-form" data-confirm="Delete this story and everything in it forever? This cannot be undone.">
            <button class="btn small danger" type="submit">Delete forever</button>
          </form>` : ''}
      </div>
    </div>
  `).join('') : '<p class="muted">No archived stories.</p>';

  return layout({
    title: 'Archived stories',
    user,
    body: `
      <p class="breadcrumb"><a href="/">&larr; Stories</a></p>
      <h1>Archived stories</h1>
      <div class="chapter-list">${rows}</div>`,
  });
}

// ---------- new story (+ first chapter) ----------


// The editor is two columns on a wide screen, as Hemingway is: the text,
// and beside it the writing checks (placed there by writing-analyzer.js)
// and, when the chapter has any, the notes it was given.
function editorGrid(writerCard, side = '') {
  return `
    <div class="chapter-body-grid editor-grid">
      ${writerCard}
      <aside class="comments-pane editor-side" aria-label="Beside the text">${side}</aside>
    </div>`;
}

/** @param {{ user: Row, error?: string|null, values?: FormValues, groups?: any[], selectedTagIds?: number[] }} props */
function newStoryPage({ user, error, values = /** @type {FormValues} */ ({}), groups = [], selectedTagIds = [] }) {
  return layout({
    title: 'New story',
    user,
    current: 'new-story',
    wide: true,
    body: `
      ${editorGrid(`
      <div class="writer-card">
        <h1>Start a new story</h1>
        <p class="muted writer-intro">A story groups together all the chapters that belong to it. You're writing the first chapter now; you can add more later from the story page.</p>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/stories/new" class="chapter-form" enctype="multipart/form-data">
          <label>Story title<input type="text" name="storyTitle" value="${escapeHtml(values.storyTitle || '')}" required></label>
          <label>Chapter 1 title<input type="text" name="chapterTitle" value="${escapeHtml(values.chapterTitle || '')}" required></label>
          <label class="main-field">Chapter 1 text<textarea name="content" rows="24" placeholder="Paste or write the chapter here..." data-editor-tools>${escapeHtml(values.content || '')}</textarea>
            ${markdownHint()}
          </label>
          <details class="writer-section" data-fold-on-phone open>
            <summary class="writer-section-label">Optional details</summary>
            <label>Story description<textarea name="storyDescription" rows="2">${escapeHtml(values.storyDescription || '')}</textarea></label>
            <label>Chapter summary<textarea name="chapterSummary" rows="2">${escapeHtml(values.chapterSummary || '')}</textarea></label>
            ${fileUploadField()}
          </details>
          <div class="writer-section">
            <p class="writer-section-label">Tags</p>
            <p class="hint">What readers are walking into. You can change these later from the story page.</p>
            ${tagPicker(groups, selectedTagIds, { allowPropose: true })}
          </div>
          <div class="writer-actions">
            <a class="btn ghost" href="/">Cancel</a>
            <button class="btn" type="submit">Publish story</button>
          </div>
        </form>
      </div>
      `)}
      <script src="/js/nspell.bundle.js"></script>
      <script src="/js/writing-analyzer.js" defer></script>`,
  });
}

// ---------- add another chapter to an existing story ----------


/** @param {{ user: Row, story: Row, chapters?: Row[], castList?: Row[], error?: string|null, vocabulary?: any, values?: FormValues }} props */
function newChapterPage({ user, story, chapters = [], castList = [], error, vocabulary = {}, values = /** @type {FormValues} */ ({}) }) {
  return layout({
    title: `New chapter - ${story.title}`,
    user,
    wide: true,
    body: `
      <p class="breadcrumb"><a href="/stories/${story.id}">&larr; ${escapeHtml(story.title)}</a></p>
      ${editorGrid(`
      <div class="writer-card">
        <h1>Add a chapter to "${escapeHtml(story.title)}"</h1>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/stories/${story.id}/chapters/new" class="chapter-form" enctype="multipart/form-data">
          <label>Chapter title<input type="text" name="title" value="${escapeHtml(values.title || '')}" required></label>
          <label class="main-field">Chapter text<textarea name="content" rows="24" placeholder="Paste or write the chapter here..." data-story-id="${story.id}" data-editor-tools>${escapeHtml(values.content || '')}</textarea>
            ${markdownHint()}
          </label>
          <details class="writer-section" data-fold-on-phone open>
            <summary class="writer-section-label">Optional details</summary>
            <label>Chapter summary<textarea name="summary" rows="2">${escapeHtml(values.summary || '')}</textarea></label>
            ${fileUploadField()}
            ${positionField(chapters, values.position)}
            ${stageField(values.stage)}
            ${arcField(values.arcTitle)}
            ${povAndStrandFields(values.pov, values.strand, vocabulary)}
            ${whenFields(values.storyWhen, values.storyDay, vocabulary)}
          </details>
          <div class="writer-actions">
            <a class="btn ghost" href="/stories/${story.id}">Cancel</a>
            <button class="btn" type="submit">Publish chapter</button>
          </div>
        </form>
        ${besidePanel({ story, chapters, entities: castList })}
      </div>
      `)}
      <script src="/js/nspell.bundle.js"></script>
      <script src="/js/writing-analyzer.js" defer></script>`,
  });
}

// ---------- edit chapter (title, summary, and the text itself) ----------


// Somebody saved while this editor was open. Nothing of theirs and
// nothing of yours is thrown away here: their version is in the database
// and shown below, yours is still in the box above, and the next save is
// yours to make on purpose.
function conflictNotice(chapter, conflict) {
  return `
    <div class="conflict-notice">
      <p><strong>Somebody saved version ${conflict.version} of this chapter while you had it open.</strong>
      Nothing has been lost and nothing has been overwritten: your text is still in the box below, and theirs is in the chapter.</p>
      <p class="muted">Saved ${timeHtml(conflict.at)}${conflict.changelog ? ` &middot; &ldquo;${escapeHtml(conflict.changelog)}&rdquo;` : ''}.
      <a href="/chapters/${chapter.id}/diff" target="_blank" rel="noopener noreferrer">See what changed &#8599;</a></p>
      <details class="conflict-theirs">
        <summary>What version ${conflict.version} says</summary>
        <div class="reading-pane">${renderHighlighted(parseMarkdown(conflict.content), [], null)}</div>
      </details>
      <p>Take anything of theirs you want into your own text, then save again. Saving now publishes your version on top of theirs, which is a thing you can do, but the version history keeps both either way.</p>
    </div>`;
}




// Where this editor stands relative to what readers see. Said once, at
// the top, in a sentence -- the difference between "saved" and
// "published" is the whole point of having drafts, and it must never be
// something the author has to work out.
function draftNotice(chapter, draft, justDrafted, publishedVersionNumber) {
  if (!draft) return '';
  const behind = draft.base_version && publishedVersionNumber > draft.base_version;
  return `
    <div class="draft-notice${justDrafted ? ' just-saved' : ''}" role="status">
      <p><strong>${justDrafted ? 'Draft saved.' : 'This is your unpublished draft.'}</strong>
      Last saved ${timeHtml(draft.updated_at)}. Readers still see version ${publishedVersionNumber}; nobody sees this until you publish it.</p>
      ${behind ? `<p class="draft-behind">Version ${publishedVersionNumber} was published after you started this draft (from v${draft.base_version}). <a href="/chapters/${chapter.id}/diff?from=${draft.base_version}&to=${publishedVersionNumber}" target="_blank" rel="noopener noreferrer">See what changed &#8599;</a> Publishing will ask before it goes on top.</p>` : ''}
      <form method="post" action="/chapters/${chapter.id}/draft/discard" class="inline-form"
            data-confirm="Throw this draft away and go back to version ${publishedVersionNumber}? The draft cannot be recovered.">
        <button class="btn ghost tiny" type="submit">Discard the draft</button>
      </form>
    </div>`;
}

// A note beside the editor, as something to act on while rewriting. The
// reference copy (renderCommentReadOnly) with the author's answers under
// it: go to the words, put a suggested rewrite into the text, accept,
// turn down. The forms work without a script (they go to the chapter
// page); editor-notes.js does them in place so the rewrite is not left.
function editorNote(c, replies) {
  const inner = renderCommentReadOnly(c, { replies });
  if (c.deleted_at || c.kind === 'praise') return inner;
  const pending = c.status === 'pending';
  const hasSuggestion = c.suggestion != null;
  const attrs = ` data-comment-id="${c.id}" data-status="${escapeHtml(c.status)}"`
    + `${c.quoted_text ? ` data-quoted="${escapeHtml(c.quoted_text)}"` : ''}`
    + `${hasSuggestion ? ` data-suggestion="${escapeHtml(c.suggestion)}"` : ''}`;
  const who = escapeHtml(c.author_name);
  const actions = pending ? `
      <div class="editor-note-actions" role="group" aria-label="What to do with the note by ${who}">
        ${c.quoted_text ? '<button type="button" class="btn tiny ghost note-find" hidden>Go to the words</button>' : ''}
        ${hasSuggestion ? '<button type="button" class="btn tiny note-use" hidden>Put it in the text</button>' : ''}
        <form method="post" action="/comments/${c.id}/status" class="inline-form note-answer">
          <button name="status" value="accepted" class="btn tiny" type="submit">Accept</button>
          <button name="status" value="rejected" class="btn tiny ghost" type="submit">Turn down</button>
        </form>
      </div>` : `
      <div class="editor-note-actions" role="group" aria-label="What to do with the note by ${who}">
        <form method="post" action="/comments/${c.id}/reopen" class="inline-form note-answer">
          <button class="btn tiny ghost" type="submit">Reopen</button>
        </form>
      </div>`;
  // The reference copy is one element; the actions go inside it, at the end.
  return inner.replace(/^(\s*<div class="comment[^"]*")/, `$1${attrs}`).replace(/<\/div>\s*$/, `${actions}\n    </div>`);
}

/** @param {{ user: Row, chapter: Row, latestContent: string, comments?: Row[], error?: string|null, canWrite?: boolean, conflict?: any, latestVersionNumber?: number, publishedVersionNumber?: number, draft?: Row|null, justDrafted?: boolean, desk?: any, vocabulary?: any, siblings?: Row[], castList?: Row[], values?: FormValues }} props */
function editChapterPage({ user, chapter, latestContent, comments = [], error, canWrite = true, conflict = null, latestVersionNumber = 0, publishedVersionNumber = 0, draft = null, justDrafted = false, desk = null, vocabulary = {}, siblings = [], castList = [], values = /** @type {FormValues} */ ({}) }) {
  const published = publishedVersionNumber || latestVersionNumber;
  const topLevelComments = comments.filter((c) => c.parent_id == null);
  const repliesByParent = {};
  comments.filter((c) => c.parent_id != null).forEach((c) => {
    (repliesByParent[c.parent_id] = repliesByParent[c.parent_id] || []).push(c);
  });
  const hasComments = topLevelComments.length > 0;
  const commentsHtml = topLevelComments
    .map((c) => editorNote(c, repliesByParent[c.id] || []))
    .join('');
  const pendingCount = topLevelComments.filter((c) => c.status === 'pending' && !c.deleted_at && c.kind !== 'praise').length;
  // Data for the editor's best-effort inline highlight -- see
  // resolveCommentRanges in writing-analyzer.js for why this is a plain
  // substring search rather than an exact offset mapping.
  const commentsData = topLevelComments
    .filter((c) => !c.deleted_at && c.quoted_text)
    .map((c) => ({ id: c.id, quoted: c.quoted_text, status: c.status }));

  const writerCard = `
    <div class="writer-card">
      <h1>Edit chapter</h1>
      <details class="writer-intro-fold">
        <summary>Drafts and versions, in two lines</summary>
        <p class="muted">Your writing is kept as a <strong>draft</strong> while you work &mdash; every few seconds, and on this device and your others. Only you see it. <strong>Publish</strong> turns it into the next version: readers see it, notes still waiting on the passage follow it there, and the old version stays in the history.</p>
      </details>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      ${conflict ? conflictNotice(chapter, conflict) : ''}
      ${conflict ? '' : draftNotice(chapter, draft, justDrafted, published)}
      <form method="post" action="/chapters/${chapter.id}/edit" class="chapter-form" enctype="multipart/form-data"
            data-draft-url="/chapters/${chapter.id}/draft"${desk ? ' data-desk' : ''}>
        ${desk ? `<script type="application/json" id="desk-data">${toScriptJson(desk)}</script>` : ''}
        <input type="hidden" name="baseVersion" value="${conflict ? conflict.version : (latestVersionNumber || '')}">
        <label>Chapter title<input type="text" name="title" value="${escapeHtml(values.title ?? chapter.title)}" required></label>
        <label class="main-field">Chapter text<textarea name="content" rows="24" data-story-id="${chapter.story_id}" data-editor-tools>${escapeHtml(values.content ?? latestContent)}</textarea>
          ${markdownHint()}
        </label>
        ${uploadVersionField()}
        <details class="writer-section" data-fold-on-phone open>
          <summary class="writer-section-label">Optional details</summary>
          <label>Chapter summary<textarea name="summary" rows="2">${escapeHtml(values.summary ?? chapter.summary ?? '')}</textarea></label>
          ${stageField(values.stage ?? chapter.stage)}
          ${arcField(values.arcTitle ?? chapter.arc_title)}
          ${povAndStrandFields(values.pov ?? chapter.pov, values.strand ?? chapter.strand, vocabulary)}
          ${whenFields(values.storyWhen ?? chapter.story_when, values.storyDay ?? chapter.story_day, vocabulary)}
          <label>What changed? (shown in the version history)<input type="text" name="changelog" value="${escapeHtml(values.changelog || '')}" placeholder="e.g. Fixed a couple of typos"></label>
        </details>
        <div class="writer-actions">
          <a class="btn ghost" href="/chapters/${chapter.id}">Cancel</a>
          <button class="btn ghost" type="submit" name="intent" value="draft" formnovalidate>Save draft</button>
          <button class="btn" type="submit" name="intent" value="publish">Publish${published ? ` as v${published + 1}` : ''}</button>
        </div>
      </form>
      ${canWrite ? editorBiblePanel(chapter) : ''}
      ${canWrite ? besidePanel({ chapter, story: { id: chapter.story_id }, chapters: siblings, entities: castList }) : ''}
    </div>`;

  // The comments sidebar (and its "Comments" toggle, added client-side by
  // writing-analyzer.js) only ever shows up once there's actually
  // something to reference -- a brand new or not-yet-commented chapter
  // just gets the plain, maximally wide editor, same as before this
  // feature existed.
  const mainHtml = editorGrid(writerCard, hasComments ? `
      <section class="editor-notes" aria-labelledby="editor-notes-title" data-pending="${pendingCount}">
        <div class="editor-notes-head">
          <h2 id="editor-notes-title">Notes <span class="notes-count">${pendingCount} pending</span></h2>
          <span class="editor-notes-step" hidden>
            <button type="button" class="btn tiny ghost" data-step="-1" title="Previous note waiting (Alt+K)">&uarr; Previous</button>
            <button type="button" class="btn tiny ghost" data-step="1" title="Next note waiting (Alt+J)">Next &darr;</button>
          </span>
        </div>
        <p class="hint">Go to each note's words, rewrite, and answer it here. Replies are on the chapter page.</p>
        <div id="editor-note-list">${commentsHtml}</div>
      </section>` : '') + (hasComments ? `
    <script type="application/json" id="chapter-comments-data">${toScriptJson(commentsData)}</script>` : '');

  return layout({
    title: `Edit - ${chapter.title}`,
    user,
    wide: true,
    body: `
      <p class="breadcrumb"><a href="/chapters/${chapter.id}">&larr; Chapter ${chapter.chapter_number}: ${escapeHtml(chapter.title)}</a></p>
      ${mainHtml}
      <script src="/js/nspell.bundle.js"></script>
      <script src="/js/writing-analyzer.js" defer></script>`,
  });
}

// A snapshot against the chapter as it stands, in prose, the same way the
// version comparison shows it.
function snapshotComparePage({ user, chapter, snapshot, againstLabel, blocks, summary }) {
  const body = summary.identical
    ? '<p class="muted diff-identical">The snapshot and the chapter say the same thing, word for word.</p>'
    : blocks.map(diffBlockHtml).join('\n');
  return layout({
    title: `Snapshot - ${chapter.title}`,
    user,
    body: `
      <p class="breadcrumb"><a href="/chapters/${chapter.id}/edit">&larr; Back to the editor</a></p>
      <div class="page-head"><h1>&ldquo;${escapeHtml(snapshot.name)}&rdquo;</h1></div>
      <p class="muted diff-summary">Snapshot taken ${timeHtml(snapshot.created_at)}, compared with ${escapeHtml(againstLabel)}.
        ${summary.identical ? '' : `<span class="diff-count added">+${summary.added} word${summary.added === 1 ? '' : 's'}</span>
        <span class="diff-count removed">&minus;${summary.removed} word${summary.removed === 1 ? '' : 's'}</span>`}
        Struck through is what the snapshot had; underlined is what is there now.</p>
      <div class="reading-pane"><div class="diff-body">${body}</div></div>`,
  });
}

// ---------- story detail (chapter list) ----------

module.exports = {
  snapshotComparePage,
  archivedStoriesPage,
  conflictNotice,
  editChapterPage,
  newChapterPage,
  newStoryPage,
};
