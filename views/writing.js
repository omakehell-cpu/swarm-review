'use strict';

const { layout } = require('../lib/layout');
const { escapeHtml, toScriptJson } = require('../lib/util');
const { parseMarkdown, renderHighlighted } = require('../lib/markdown');
const { timeHtml } = require('../lib/time');
const { besidePanel, editorBiblePanel } = require('./bible');
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


/** @param {{ user: Row, error?: string|null, values?: FormValues, groups?: any[], selectedTagIds?: number[] }} props */
function newStoryPage({ user, error, values = /** @type {FormValues} */ ({}), groups = [], selectedTagIds = [] }) {
  return layout({
    title: 'New story',
    user,
    current: 'new-story',
    wide: true,
    body: `
      <div class="writer-card">
        <h1>Start a new story</h1>
        <p class="muted writer-intro">A story groups together all the chapters that belong to it. You're writing the first chapter now; you can add more later from the story page.</p>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/stories/new" class="chapter-form" enctype="multipart/form-data">
          <label>Story title<input type="text" name="storyTitle" value="${escapeHtml(values.storyTitle || '')}" required></label>
          <label>Chapter 1 title<input type="text" name="chapterTitle" value="${escapeHtml(values.chapterTitle || '')}" required></label>
          <label class="main-field">Chapter 1 text<textarea name="content" rows="24" placeholder="Paste or write the chapter here...">${escapeHtml(values.content || '')}</textarea>
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
      <div class="writer-card">
        <h1>Add a chapter to "${escapeHtml(story.title)}"</h1>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/stories/${story.id}/chapters/new" class="chapter-form" enctype="multipart/form-data">
          <label>Chapter title<input type="text" name="title" value="${escapeHtml(values.title || '')}" required></label>
          <label class="main-field">Chapter text<textarea name="content" rows="24" placeholder="Paste or write the chapter here..." data-story-id="${story.id}">${escapeHtml(values.content || '')}</textarea>
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




/** @param {{ user: Row, chapter: Row, latestContent: string, comments?: Row[], error?: string|null, canWrite?: boolean, conflict?: any, latestVersionNumber?: number, vocabulary?: any, siblings?: Row[], castList?: Row[], values?: FormValues }} props */
function editChapterPage({ user, chapter, latestContent, comments = [], error, canWrite = true, conflict = null, latestVersionNumber = 0, vocabulary = {}, siblings = [], castList = [], values = /** @type {FormValues} */ ({}) }) {
  const topLevelComments = comments.filter((c) => c.parent_id == null);
  const repliesByParent = {};
  comments.filter((c) => c.parent_id != null).forEach((c) => {
    (repliesByParent[c.parent_id] = repliesByParent[c.parent_id] || []).push(c);
  });
  const hasComments = topLevelComments.length > 0;
  const commentsHtml = topLevelComments
    .map((c) => renderCommentReadOnly(c, { replies: repliesByParent[c.id] || [] }))
    .join('');
  // Data for the editor's best-effort inline highlight -- see
  // resolveCommentRanges in writing-analyzer.js for why this is a plain
  // substring search rather than an exact offset mapping.
  const commentsData = topLevelComments
    .filter((c) => !c.deleted_at && c.quoted_text)
    .map((c) => ({ id: c.id, quoted: c.quoted_text, status: c.status }));

  const writerCard = `
    <div class="writer-card">
      <h1>Edit chapter</h1>
      <p class="muted writer-intro">Saving publishes a new version automatically if you changed the text, so any existing comments stay anchored to the passage they were originally made about. The version history is still available from the "Version" dropdown on the chapter page.</p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      ${conflict ? conflictNotice(chapter, conflict) : ''}
      <form method="post" action="/chapters/${chapter.id}/edit" class="chapter-form" enctype="multipart/form-data">
        <input type="hidden" name="baseVersion" value="${conflict ? conflict.version : (latestVersionNumber || '')}">
        <label>Chapter title<input type="text" name="title" value="${escapeHtml(values.title ?? chapter.title)}" required></label>
        <label class="main-field">Chapter text<textarea name="content" rows="24" data-story-id="${chapter.story_id}">${escapeHtml(values.content ?? latestContent)}</textarea>
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
          <button class="btn" type="submit">Save changes</button>
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
  const mainHtml = hasComments ? `
    <div class="chapter-body-grid">
      ${writerCard}
      <aside class="comments-pane">
        <h2>Comments</h2>
        <p class="hint">For reference while you edit -- to reply to a comment or accept/reject it, do that from the chapter page instead.</p>
        <div id="comment-list">${commentsHtml}</div>
      </aside>
    </div>
    <script type="application/json" id="chapter-comments-data">${toScriptJson(commentsData)}</script>` : writerCard;

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

// ---------- story detail (chapter list) ----------

module.exports = {
  archivedStoriesPage,
  conflictNotice,
  editChapterPage,
  newChapterPage,
  newStoryPage,
};
