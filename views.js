'use strict';

const { layout } = require('./lib/layout');
const { escapeHtml, toScriptJson } = require('./lib/util');
const { parseMarkdown, renderHighlighted } = require('./lib/markdown');
const { timeHtml } = require('./lib/time');

const MARKDOWN_HINT = `Markdown is supported: **bold**, *italic*, ***both***, ~~strikethrough~~, \`code\`, [link](https://...), # Heading, &gt; quote, --- for a scene break, and - list items. Line breaks are kept as you type them.`;

function fileUploadField() {
  return `
    <label>Or upload a file instead (.md, .txt, or .docx) &mdash; replaces the text above
      <input type="file" name="file" accept=".md,.markdown,.txt,.docx">
    </label>`;
}

// ---------- auth pages ----------

function loginPage({ error } = {}) {
  return layout({
    title: 'Log in',
    user: null,
    body: `
      <div class="auth-card">
        <h1>Log in</h1>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/login">
          <label>Username<input type="text" name="username" required autofocus></label>
          <label>Password<input type="password" name="password" required></label>
          <button class="btn" type="submit">Log in</button>
        </form>
        <p class="muted">No account yet? <a href="/register">Register</a></p>
      </div>`,
  });
}

function registerPage({ error, values = {} } = {}) {
  return layout({
    title: 'Register',
    user: null,
    body: `
      <div class="auth-card">
        <h1>Create an account</h1>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/register">
          <label>Display name<input type="text" name="displayName" value="${escapeHtml(values.displayName || '')}" required></label>
          <label>Username<input type="text" name="username" value="${escapeHtml(values.username || '')}" required pattern="[a-zA-Z0-9_\\-]{3,30}"></label>
          <label>Password<input type="password" name="password" required minlength="8"></label>
          <label>Invite code<input type="text" name="inviteCode" required></label>
          <button class="btn" type="submit">Create account</button>
        </form>
        <p class="muted">Already have an account? <a href="/login">Log in</a></p>
      </div>`,
  });
}

// ---------- stories list (dashboard) ----------

function storiesPage({ user, stories, since }) {
  const sinceQs = since ? `?since=${encodeURIComponent(since)}` : '';
  const rows = stories.length ? stories.map((s) => `
    <a class="chapter-row" href="/stories/${s.id}${sinceQs}">
      <div class="chapter-row-main">
        <h3>${escapeHtml(s.title)} ${s.has_new_chapters ? '<span class="badge new">New</span>' : ''}</h3>
        <p class="muted">${escapeHtml(s.description || '')}</p>
      </div>
      <div class="chapter-row-meta">
        <span>by ${escapeHtml(s.author_name)}</span>
        <span>${s.chapter_count} chapter${s.chapter_count === 1 ? '' : 's'}</span>
        ${timeHtml(s.last_chapter_at || s.created_at)}
        ${s.pending_comments > 0 ? `<span class="badge pending">${s.pending_comments} pending</span>` : ''}
      </div>
    </a>
  `).join('') : '<p class="muted">No stories yet. Be the first to start one.</p>';

  return layout({
    title: 'Stories',
    user,
    body: `
      <div class="page-head">
        <h1>The Swarm stories</h1>
        <a class="btn" href="/stories/new">New story</a>
      </div>
      <div class="chapter-list">${rows}</div>
      <p class="muted archive-link"><a href="/archived-stories">View archived stories &rarr;</a></p>`,
  });
}

// ---------- archived stories ----------

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
          <form method="post" action="/stories/${s.id}/delete" class="inline-form" onsubmit="return confirm('Delete this story and everything in it forever? This cannot be undone.');">
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

function newStoryPage({ user, error, values = {} }) {
  return layout({
    title: 'New story',
    user,
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
            <span class="hint">${MARKDOWN_HINT}</span>
          </label>
          <div class="writer-section">
            <p class="writer-section-label">Optional details</p>
            <label>Story description<textarea name="storyDescription" rows="2">${escapeHtml(values.storyDescription || '')}</textarea></label>
            <label>Chapter summary<textarea name="chapterSummary" rows="2">${escapeHtml(values.chapterSummary || '')}</textarea></label>
            ${fileUploadField()}
          </div>
          <div class="writer-actions">
            <a class="btn ghost" href="/">Cancel</a>
            <button class="btn" type="submit">Publish story</button>
          </div>
        </form>
      </div>
      <script src="/js/writing-analyzer.js" defer></script>`,
  });
}

// ---------- add another chapter to an existing story ----------

function positionField(chapters, selectedValue) {
  if (!chapters.length) return '';
  const selected = selectedValue || 'end';
  const options = chapters.map((c) =>
    `<option value="${c.chapter_number}" ${String(c.chapter_number) === selected ? 'selected' : ''}>Before Chapter ${c.chapter_number}: ${escapeHtml(c.title)}</option>`
  ).join('');
  return `
    <label>Position
      <select name="position">
        ${options}
        <option value="end" ${selected === 'end' ? 'selected' : ''}>At the end</option>
      </select>
      <span class="hint">Inserting before an existing chapter renumbers it and everything after it.</span>
    </label>`;
}

function newChapterPage({ user, story, chapters = [], error, values = {} }) {
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
            <span class="hint">${MARKDOWN_HINT}</span>
          </label>
          <div class="writer-section">
            <p class="writer-section-label">Optional details</p>
            <label>Chapter summary<textarea name="summary" rows="2">${escapeHtml(values.summary || '')}</textarea></label>
            ${fileUploadField()}
            ${positionField(chapters, values.position)}
          </div>
          <div class="writer-actions">
            <a class="btn ghost" href="/stories/${story.id}">Cancel</a>
            <button class="btn" type="submit">Publish chapter</button>
          </div>
        </form>
      </div>
      <script src="/js/writing-analyzer.js" defer></script>`,
  });
}

// ---------- edit chapter (title, summary, and the text itself) ----------

function editChapterPage({ user, chapter, latestContent, error, values = {} }) {
  return layout({
    title: `Edit - ${chapter.title}`,
    user,
    wide: true,
    body: `
      <p class="breadcrumb"><a href="/chapters/${chapter.id}">&larr; Chapter ${chapter.chapter_number}: ${escapeHtml(chapter.title)}</a></p>
      <div class="writer-card">
        <h1>Edit chapter</h1>
        <p class="muted writer-intro">Saving publishes a new version automatically if you changed the text, so any existing comments stay anchored to the passage they were originally made about. The version history is still available from the "Version" dropdown on the chapter page.</p>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/chapters/${chapter.id}/edit" class="chapter-form" enctype="multipart/form-data">
          <label>Chapter title<input type="text" name="title" value="${escapeHtml(values.title ?? chapter.title)}" required></label>
          <label class="main-field">Chapter text<textarea name="content" rows="24" data-story-id="${chapter.story_id}">${escapeHtml(values.content ?? latestContent)}</textarea>
            <span class="hint">${MARKDOWN_HINT}</span>
          </label>
          <div class="writer-section">
            <p class="writer-section-label">Optional details</p>
            <label>Chapter summary<textarea name="summary" rows="2">${escapeHtml(values.summary ?? chapter.summary ?? '')}</textarea></label>
            ${fileUploadField()}
            <label>What changed? (shown in the version history)<input type="text" name="changelog" value="${escapeHtml(values.changelog || '')}" placeholder="e.g. Fixed a couple of typos"></label>
          </div>
          <div class="writer-actions">
            <a class="btn ghost" href="/chapters/${chapter.id}">Cancel</a>
            <button class="btn" type="submit">Save changes</button>
          </div>
        </form>
      </div>
      <script src="/js/writing-analyzer.js" defer></script>`,
  });
}

// ---------- story detail (chapter list) ----------

function chapterReorderButtons(chapter, index, total) {
  return `
    <div class="chapter-row-reorder">
      <form method="post" action="/chapters/${chapter.id}/move-up" class="inline-form">
        <button class="btn tiny ghost" type="submit" title="Move up" ${index === 0 ? 'disabled' : ''}>&uarr;</button>
      </form>
      <form method="post" action="/chapters/${chapter.id}/move-down" class="inline-form">
        <button class="btn tiny ghost" type="submit" title="Move down" ${index === total - 1 ? 'disabled' : ''}>&darr;</button>
      </form>
    </div>`;
}

function storyDictionarySection(story, dictionary) {
  const words = dictionary.length ? `
    <ul class="story-dictionary-list">
      ${dictionary.map((entry) => `
        <li>
          <span class="invite-code-inline">${escapeHtml(entry.word)}</span>
          <form method="post" action="/stories/${story.id}/dictionary/${entry.id}/delete" class="inline-form">
            <button class="btn tiny ghost" type="submit" title="Remove">&times;</button>
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

function storyPage({ user, story, chapters, isStoryAuthor, dictionary = [] }) {
  const rows = chapters.length ? chapters.map((c, i) => `
    <div class="chapter-row-outer">
      <a class="chapter-row" href="/chapters/${c.id}">
        <div class="chapter-row-main">
          <h3>Chapter ${c.chapter_number}: ${escapeHtml(c.title)}
            ${c.is_new ? '<span class="badge new">New</span>' : (c.has_new_comments ? '<span class="badge new-comments">New comments</span>' : '')}
          </h3>
          <p class="muted">${escapeHtml(c.summary || '')}</p>
        </div>
        <div class="chapter-row-meta">
          <span>v${c.latest_version}</span>
          ${timeHtml(c.created_at)}
          ${c.pending_comments > 0 ? `<span class="badge pending">${c.pending_comments} pending</span>` : ''}
        </div>
      </a>
      ${isStoryAuthor ? chapterReorderButtons(c, i, chapters.length) : ''}
    </div>
  `).join('') : '<p class="muted">No chapters yet.</p>';

  return layout({
    title: story.title,
    user,
    body: `
      <div class="page-head">
        <div>
          <h1>${escapeHtml(story.title)}</h1>
          <p class="muted byline">by ${escapeHtml(story.author_name)} &middot; ${timeHtml(story.created_at)}</p>
          ${story.description ? `<p class="summary">${escapeHtml(story.description)}</p>` : ''}
        </div>
        <div class="page-head-actions">
          ${isStoryAuthor ? `<a class="btn" href="/stories/${story.id}/chapters/new">Add chapter</a>` : ''}
          ${isStoryAuthor ? `
            <form method="post" action="/stories/${story.id}/archive" class="inline-form">
              <button class="btn ghost small" type="submit">Archive story</button>
            </form>` : ''}
        </div>
      </div>
      <div class="chapter-list">${rows}</div>
      <p class="muted archive-link"><a href="/stories/${story.id}/archived-chapters">View archived chapters &rarr;</a></p>
      ${isStoryAuthor ? storyDictionarySection(story, dictionary) : ''}`,
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
          <form method="post" action="/chapters/${c.id}/delete" class="inline-form" onsubmit="return confirm('Delete this chapter and all its versions and comments forever? This cannot be undone.');">
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

const STATUS_LABEL = { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected' };

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
        <form method="post" action="/comments/${r.id}/retract" class="inline-form" onsubmit="return confirm('Retract this reply?');">
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

  return `
    <div class="comment status-${c.status}" id="comment-${c.id}" data-comment-id="${c.id}">
      <div class="comment-meta">
        <strong>${escapeHtml(c.author_name)}</strong>
        <span class="status-badge status-${c.status}">${statusLabel}</span>
        ${timeHtml(c.created_at)}
        ${c.edited_at ? '<span class="muted edited-tag">(edited)</span>' : ''}
      </div>
      ${c.quoted_text ? `<blockquote class="quoted">${escapeHtml(c.quoted_text)}</blockquote>` : ''}
      <p class="comment-body">${escapeHtml(c.body)}</p>
      <div class="comment-actions">
        ${isChapterAuthor && c.status === 'pending' ? `
          <form method="post" action="/comments/${c.id}/status" class="inline-form">
            <button name="status" value="accepted" class="btn small accept" type="submit">Accept</button>
            <button name="status" value="rejected" class="btn small reject" type="submit">Reject</button>
          </form>` : ''}
        ${isChapterAuthor && c.status !== 'pending' ? `
          <form method="post" action="/comments/${c.id}/reopen" class="inline-form">
            <button class="btn small ghost" type="submit">Reopen</button>
          </form>` : ''}
        ${isCommentAuthor ? `
          <form method="post" action="/comments/${c.id}/retract" class="inline-form" onsubmit="return confirm('Retract this comment?');">
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
      <form method="post" action="/comments/${c.id}/reply" class="reply-form">
        <input type="text" name="body" placeholder="Reply..." required maxlength="2000">
        <button type="submit" class="btn small ghost">Reply</button>
      </form>
    </div>`;
}

function chapterPage({ user, chapter, versions, currentVersion, comments, isChapterAuthor }) {
  const topLevel = comments.filter((c) => c.parent_id == null);
  const repliesByParent = {};
  comments.filter((c) => c.parent_id != null).forEach((c) => {
    (repliesByParent[c.parent_id] = repliesByParent[c.parent_id] || []).push(c);
  });

  const versionOptions = versions.map((v) => `
    <option value="${v.version_number}" ${v.id === currentVersion.id ? 'selected' : ''}>
      v${v.version_number}${v.id === versions[0].id ? ' (latest)' : ''}
    </option>`).join('');

  const commentsHtml = topLevel.length
    ? topLevel.map((c) => renderComment(c, { isChapterAuthor, currentUserId: user.id, replies: repliesByParent[c.id] || [] })).join('')
    : '<p class="muted">No comments yet on this version.</p>';

  const ast = parseMarkdown(currentVersion.content);
  const highlighted = renderHighlighted(ast, comments);

  const body = `
    <p class="breadcrumb"><a href="/stories/${chapter.story_id}">&larr; ${escapeHtml(chapter.story_title)}</a></p>
    <div class="chapter-header">
      <h1>Chapter ${chapter.chapter_number}: ${escapeHtml(chapter.title)}</h1>
      <p class="muted byline">by ${escapeHtml(chapter.author_name)} &middot; ${timeHtml(chapter.created_at)}</p>
      ${chapter.summary ? `<p class="summary">${escapeHtml(chapter.summary)}</p>` : ''}
      <div class="version-bar">
        <label>Version:
          <select id="version-select">${versionOptions}</select>
        </label>
        ${timeHtml(currentVersion.created_at, 'version-ts')}
        ${currentVersion.changelog ? `<span class="changelog muted">"${escapeHtml(currentVersion.changelog)}"</span>` : ''}
        ${isChapterAuthor ? `<a class="btn ghost" href="/chapters/${chapter.id}/edit">Edit chapter</a>` : ''}
        ${isChapterAuthor ? `
          <form method="post" action="/chapters/${chapter.id}/archive" class="inline-form">
            <button class="btn ghost small" type="submit">Archive chapter</button>
          </form>` : ''}
        <span class="download-links muted">Download:
          <a href="/chapters/${chapter.id}/download.md?v=${currentVersion.version_number}">.md</a>
          <a href="/chapters/${chapter.id}/download.txt?v=${currentVersion.version_number}">.txt</a>
          <a href="/chapters/${chapter.id}/download.docx?v=${currentVersion.version_number}">.docx</a>
        </span>
      </div>
    </div>
    <div class="chapter-body-grid">
      <div class="reading-pane">
        <div id="chapter-text" data-chapter-id="${chapter.id}" data-version-id="${currentVersion.id}" data-story-id="${chapter.story_id}" data-can-edit-dictionary="${isChapterAuthor ? '1' : '0'}">${highlighted}</div>
      </div>
      <aside class="comments-pane">
        <h2>Comments</h2>
        <div id="comment-list">${commentsHtml}</div>

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
    <button id="selection-toast" class="selection-toast hidden" type="button">+ Comment on selection</button>
    <script type="application/json" id="chapter-meta">${toScriptJson({ chapterId: chapter.id })}</script>
    <script src="/js/app.js"></script>
  `;

  return layout({ title: chapter.title, user, body });
}

// ---------- account settings ----------

function accountPage({ user, error, notice }) {
  return layout({
    title: 'Account',
    user,
    flash: notice ? { type: 'info', message: notice } : null,
    body: `
      <h1>Account</h1>
      <div class="auth-card">
        <h2>Change password</h2>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/account/password">
          <label>Current password<input type="password" name="currentPassword" required></label>
          <label>New password<input type="password" name="newPassword" required minlength="8"></label>
          <label>Confirm new password<input type="password" name="confirmPassword" required minlength="8"></label>
          <button class="btn" type="submit">Change password</button>
        </form>
        <p class="muted">Changing your password signs you out of any other device or browser where you're currently logged in.</p>
      </div>`,
  });
}

// ---------- admin panel ----------

function inviteCodeCard(activeInviteCode) {
  if (!activeInviteCode) {
    return `
      <div class="invite-card closed">
        <p><strong>Registration is closed.</strong> No code will work until you generate a new one.</p>
        <form method="post" action="/admin/invite-code/generate" class="inline-form">
          <button class="btn small" type="submit">Generate a code</button>
        </form>
      </div>`;
  }
  return `
    <div class="invite-card">
      <p class="muted">Current invite code (single-use, not used yet):</p>
      <p class="invite-code">${escapeHtml(activeInviteCode.code)}</p>
      <p class="muted">Created ${timeHtml(activeInviteCode.created_at)}${activeInviteCode.created_by_name ? ` by ${escapeHtml(activeInviteCode.created_by_name)}` : ''}</p>
      <div class="row">
        <form method="post" action="/admin/invite-code/generate" class="inline-form">
          <button class="btn small" type="submit">Generate a new code</button>
        </form>
        <form method="post" action="/admin/invite-code/close" class="inline-form" onsubmit="return confirm('Close registration? Nobody will be able to register until you generate a new code.');">
          <button class="btn small ghost" type="submit">Close registration</button>
        </form>
      </div>
    </div>`;
}

function inviteCodeHistoryTable(history) {
  if (!history.length) return '';
  const rows = history.map((c) => {
    let statusText;
    if (c.used_at) statusText = `used by ${escapeHtml(c.used_by_name || 'someone since removed')}`;
    else if (c.active) statusText = 'active';
    else statusText = 'invalidated';
    return `
      <tr>
        <td>${escapeHtml(c.code)}</td>
        <td>${c.username ? `@${escapeHtml(c.username)}` : 'Anyone'}</td>
        <td>${timeHtml(c.created_at)}</td>
        <td>${statusText}</td>
      </tr>`;
  }).join('');
  return `
    <details class="invite-history">
      <summary>Invite code history (${history.length})</summary>
      <table class="admin-table">
        <thead><tr><th>Code</th><th>For</th><th>Created</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>`;
}

function namedInviteRow(inv) {
  return `
    <div class="admin-user-row">
      <div class="admin-user-main">
        <strong>@${escapeHtml(inv.username)}</strong>
        <p class="muted small-meta">Code: <span class="invite-code-inline">${escapeHtml(inv.code)}</span> &middot; created ${timeHtml(inv.created_at)}${inv.created_by_name ? ` by ${escapeHtml(inv.created_by_name)}` : ''}</p>
      </div>
      <div class="admin-user-actions">
        <form method="post" action="/admin/invite-code/named/${inv.id}/revoke" class="inline-form" onsubmit="return confirm('Revoke this invite? The code will stop working.');">
          <button class="btn small ghost" type="submit">Revoke</button>
        </form>
      </div>
    </div>`;
}

function namedInviteSection(pendingNamedInvites) {
  const rows = pendingNamedInvites.length
    ? pendingNamedInvites.map(namedInviteRow).join('')
    : '<p class="muted">No pending invites.</p>';
  return `
    <section class="admin-section">
      <h2>Invite a specific person</h2>
      <p class="muted">Generates a code that only works to register with that exact username -- unlike the general code above, this doesn't affect the open code or anyone else's pending invite. Adding the same username again replaces their old code with a new one.</p>
      <form method="post" action="/admin/invite-code/named" class="named-invite-form">
        <input type="text" name="username" placeholder="username" required pattern="[a-zA-Z0-9_\\-]{3,30}">
        <button class="btn small" type="submit">Generate invite</button>
      </form>
      <div class="admin-user-list">${rows}</div>
    </section>`;
}

function adminUserRow(u, { currentUserId }) {
  const isSelf = u.id === currentUserId;
  const locked = !!u.locked_at;
  const lockLabel = locked
    ? (u.locked_reason === 'failed_attempts' ? 'Locked (3 failed logins)' : 'Locked (by admin)')
    : '';
  return `
    <div class="admin-user-row ${locked ? 'locked' : ''}">
      <div class="admin-user-main">
        <strong>${escapeHtml(u.display_name)}</strong> <span class="muted">@${escapeHtml(u.username)}</span>
        ${u.is_admin ? '<span class="badge admin-badge">Admin</span>' : ''}
        ${locked ? `<span class="badge locked-badge">${lockLabel}</span>` : ''}
        <p class="muted small-meta">Joined ${timeHtml(u.created_at)} &middot; last seen ${timeHtml(u.last_seen_at)}${u.failed_login_attempts > 0 && !locked ? ` &middot; ${u.failed_login_attempts} recent failed login${u.failed_login_attempts === 1 ? '' : 's'}` : ''}</p>
      </div>
      <div class="admin-user-actions">
        <details class="admin-inline-form">
          <summary>Change password</summary>
          <form method="post" action="/admin/users/${u.id}/password">
            <input type="password" name="password" placeholder="New password" required minlength="8">
            <button class="btn small" type="submit">Set password</button>
          </form>
        </details>
        ${locked
          ? `<form method="post" action="/admin/users/${u.id}/unlock" class="inline-form">
               <button class="btn small ghost" type="submit">Reactivate</button>
             </form>`
          : (isSelf ? '' : `<form method="post" action="/admin/users/${u.id}/lock" class="inline-form">
               <button class="btn small ghost" type="submit">Lock account</button>
             </form>`)
        }
        ${isSelf ? '' : `
          <form method="post" action="/admin/users/${u.id}/delete" class="inline-form" onsubmit="return confirm('Delete this account? Their stories/chapters/comments stay, credited to Deleted user. This cannot be undone.');">
            <button class="btn small danger" type="submit">Delete account</button>
          </form>`}
      </div>
    </div>`;
}

function adminPage({ user, users, activeInviteCode, inviteCodeHistory, pendingNamedInvites, notice }) {
  const userRows = users.map((u) => adminUserRow(u, { currentUserId: user.id })).join('');
  return layout({
    title: 'Admin',
    user,
    flash: notice ? { type: 'info', message: notice } : null,
    body: `
      <h1>Admin</h1>

      <section class="admin-section">
        <h2>Backup</h2>
        <p class="muted">A complete, self-contained snapshot of the database -- every user, story, chapter, version, comment, and invite code -- as a single .sqlite file, safe to download even while the server is running. This is the only copy of everyone's writing outside this machine, so keep one somewhere else.</p>
        <a class="btn" href="/admin/backup">Download backup (.sqlite)</a>
      </section>

      <section class="admin-section">
        <h2>Registration</h2>
        ${inviteCodeCard(activeInviteCode)}
        ${inviteCodeHistoryTable(inviteCodeHistory)}
      </section>

      ${namedInviteSection(pendingNamedInvites)}

      <section class="admin-section">
        <h2>Users</h2>
        <div class="admin-user-list">${userRows}</div>
      </section>`,
  });
}

module.exports = {
  loginPage,
  registerPage,
  accountPage,
  adminPage,
  storiesPage,
  archivedStoriesPage,
  newStoryPage,
  newChapterPage,
  editChapterPage,
  storyPage,
  archivedChaptersPage,
  chapterPage,
};
