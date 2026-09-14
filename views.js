'use strict';

const { layout } = require('./lib/layout');
const { escapeHtml, toScriptJson } = require('./lib/util');
const { parseMarkdown, renderHighlighted } = require('./lib/markdown');
const { timeHtml } = require('./lib/time');
const wiki = require('./lib/wiki');

const MARKDOWN_HINT = `Markdown is supported: **bold**, *italic*, ***both***, ~~strikethrough~~, \`code\`, [link](https://...), # Heading, &gt; quote, --- for a scene break, and - or 1. list items. Put a backslash before a character to keep it literal (\\* shows a real asterisk). Line breaks are kept as you type them.`;

function fileUploadField() {
  return `
    <label>Or upload a file instead (.md, .txt, or .docx) &mdash; replaces the text above
      <input type="file" name="file" accept=".md,.markdown,.txt,.docx">
    </label>`;
}

// ---------- errors ----------
// Every 403/404/500 used to be a bare string written straight into the
// response: a white page, no typography, no navigation, no way back. A
// wrong link is the most ordinary thing that happens on a site, and it
// should look like part of the site.
const ERROR_HEADINGS = {
  400: "That didn't work",
  403: 'Not yours to change',
  404: "That isn't here",
  409: 'Already taken',
  500: 'Something broke',
};

function errorPage({ user, status, message }) {
  const heading = ERROR_HEADINGS[status] || 'Something went wrong';
  return layout({
    title: heading,
    user,
    body: `
      <div class="error-page">
        <p class="error-status">${status}</p>
        <h1>${escapeHtml(heading)}</h1>
        <p class="error-message">${escapeHtml(message)}</p>
        <p class="error-actions">
          <a class="btn" href="/">Back to the stories</a>
          ${status === 404 ? '<a class="btn ghost" href="/search">Search instead</a>' : ''}
        </p>
      </div>`,
  });
}

// ---------- auth pages ----------

function loginPage({ error, notice } = /** @type {{ error?: string, notice?: string }} */ ({})) {
  return layout({
    title: 'Log in',
    user: null,
    flash: notice ? { type: 'info', message: notice } : null,
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
        <p class="muted">Forgot your password? Ask an admin for a reset link.</p>
      </div>`,
  });
}

function registerPage({ error, values = /** @type {FormValues} */ ({}) } = /** @type {{ error?: string, values?: FormValues }} */ ({})) {
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

// ---------- password reset (from an admin-generated link, see /admin) ----------
function resetPasswordPage({ token, displayName, error } = /** @type {{ token?: string, displayName?: string, error?: string }} */ ({})) {
  return layout({
    title: 'Reset password',
    user: null,
    body: `
      <div class="auth-card">
        <h1>Reset your password</h1>
        <p class="muted">Setting a new password for ${escapeHtml(displayName)}.</p>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/reset-password/${escapeHtml(token)}">
          <label>New password<input type="password" name="password" required minlength="8" autofocus></label>
          <label>Confirm new password<input type="password" name="confirm" required minlength="8"></label>
          <button class="btn" type="submit">Set new password</button>
        </form>
      </div>`,
  });
}

function resetPasswordExpiredPage() {
  return layout({
    title: 'Reset link expired',
    user: null,
    body: `
      <div class="auth-card">
        <h1>This reset link no longer works</h1>
        <p class="muted">It may have already been used, or it's older than 24 hours. Ask an admin to generate a new one.</p>
        <p class="muted"><a href="/login">Back to login</a></p>
      </div>`,
  });
}

// ---------- stories list (dashboard) ----------

// One story as it appears in any list -- the front page, a tag's page, a
// search result. `hiddenBy` is the reader's own hidden tags that this
// story tripped (see handleStories); it only ever arrives set from a list
// that has already decided to fold the story away.
function storyRow(s, { tags = [], sinceQs = '', hiddenBy = [], coauthors = [] } = {}) {
  // Not an <a> wrapping the whole row, which is what every other list
  // here does: the tag chips are links themselves, and an anchor inside
  // an anchor is invalid -- the parser closes the outer one early and the
  // row falls apart. The title carries the link and stretches an overlay
  // across the row instead (see .story-row in style.css), so the row is
  // still clickable everywhere the chips aren't.
  return `
    <div class="chapter-row story-row">
      <div class="chapter-row-main">
        <h3><a class="row-link" href="/stories/${s.id}${sinceQs}">${escapeHtml(s.title)}</a> ${s.has_new_chapters ? '<span class="badge new">New</span>' : ''}</h3>
        <p class="muted">${escapeHtml(s.description || '')}</p>
        ${hiddenBy.length
          ? `<p class="hidden-by">Hidden by your tag settings: ${hiddenBy.map((t) => escapeHtml(t.name)).join(', ')}</p>`
          : tagChips(tags)}
      </div>
      <div class="chapter-row-meta">
        <span>${bylineWith(s.author_name, coauthors)}</span>
        <span>${s.chapter_count} chapter${s.chapter_count === 1 ? '' : 's'}</span>
        ${timeHtml(s.last_chapter_at || s.created_at)}
        ${s.pending_comments > 0 ? `<span class="badge pending">${s.pending_comments} pending</span>` : ''}
      </div>
    </div>
  `;
}

function storiesPage({ user, stories, folded = [], since, tagsByStory, coauthorsByStory = new Map(), activeTags = [], allGroups = [] }) {
  const sinceQs = since ? `?since=${encodeURIComponent(since)}` : '';
  const tagsFor = (s) => (tagsByStory && tagsByStory.get(s.id)) || [];
  const rows = stories.length
    ? stories.map((s) => storyRow(s, { tags: tagsFor(s), sinceQs, coauthors: coauthorsByStory.get(s.id) || [] })).join('')
    : `<p class="muted">${activeTags.length ? 'No stories carry every tag you picked.' : 'No stories yet. Be the first to start one.'}</p>`;

  // The filter is a form of checkboxes rather than a list of links, so
  // picking several tags is one action instead of one page load each.
  const activeSlugs = new Set(activeTags.map((t) => t.slug));
  const filter = allGroups.length ? `
    <details class="tag-filter"${activeTags.length ? ' open' : ''}>
      <summary>${activeTags.length
        ? `Filtered by ${activeTags.map((t) => escapeHtml(t.name)).join(', ')}`
        : 'Filter by tag'}</summary>
      <form method="get" action="/" class="tag-filter-form">
        ${allGroups.map((g) => `
          <fieldset class="tag-group">
            <legend>${escapeHtml(g.group)}</legend>
            <div class="tag-group-options">${g.tags.map((t) => `
              <label class="tag-pick${activeSlugs.has(t.slug) ? ' checked' : ''}">
                <input type="checkbox" name="tag" value="${escapeHtml(t.slug)}"${activeSlugs.has(t.slug) ? ' checked' : ''}>
                <span>${escapeHtml(t.name)}</span>
              </label>`).join('')}</div>
          </fieldset>`).join('')}
        <div class="tag-filter-actions">
          <button class="btn small" type="submit">Apply</button>
          ${activeTags.length ? '<a class="btn ghost small" href="/">Clear</a>' : ''}
          <span class="hint">A story has to carry every tag you pick.</span>
        </div>
      </form>
    </details>` : '';

  // Stories folded away by this reader's own hidden tags (see /account) --
  // out of the way, but never silently gone.
  const foldedBlock = folded.length ? `
    <details class="folded-stories">
      <summary>${folded.length} stor${folded.length === 1 ? 'y' : 'ies'} hidden by your tag settings</summary>
      <div class="chapter-list">${folded.map((s) => storyRow(s, { tags: tagsFor(s), sinceQs, hiddenBy: s.hiddenBy, coauthors: coauthorsByStory.get(s.id) || [] })).join('')}</div>
    </details>` : '';

  return layout({
    title: 'Stories',
    user,
    current: 'stories',
    body: `
      <div class="page-head">
        <h1>The Swarm stories</h1>
        <a class="btn" href="/stories/new">New story</a>
      </div>
      ${filter}
      <div class="chapter-list">${rows}</div>
      ${foldedBlock}
      <p class="muted archive-link"><a href="/archived-stories">View archived stories &rarr;</a></p>`,
  });
}

// ---------- story tags ----------
// One tag, as it appears anywhere it's being displayed rather than picked.
function tagChip(tag, { muted } = /** @type {{ muted?: boolean }} */ ({})) {
  const proposed = tag.status === 'proposed';
  const title = proposed
    ? `Proposed${tag.proposed_by_name ? ` by ${tag.proposed_by_name}` : ''} -- waiting for an admin to confirm it`
    : (tag.description || '');
  return `<a class="tag-chip${muted ? ' muted-chip' : ''}${proposed ? ' proposed' : ''}" href="/tags/${encodeURIComponent(tag.slug)}"${
    title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(tag.name)}</a>`;
}

function tagChips(tags) {
  if (!tags || !tags.length) return '';
  return `<div class="tag-chips">${tags.map((t) => tagChip(t)).join('')}</div>`;
}

// The picker used when writing or editing a story: the whole vocabulary,
// in its groups, with the story's own tags ticked. Plain checkboxes, so it
// works without JavaScript and reads correctly to a screen reader; the
// styling (see .tag-pick in style.css) is what makes them read as chips.
function tagPicker(groups, selectedTagIds, { allowPropose = false } = {}) {
  const selected = new Set((selectedTagIds || []).map(Number));
  // A plain text field rather than its own form: this picker lives inside
  // the story form, and a <form> can't nest inside another one. The names
  // are turned into proposed tags when the story is saved.
  const propose = allowPropose ? `
    <label class="tag-propose">Can't find the right one? Propose new tags
      <input type="text" name="proposeTags" placeholder="Separate several with commas">
      <span class="hint">They go on this story straight away, marked as proposed until an admin confirms them.</span>
    </label>` : '';
  if (!groups.length) {
    return `<p class="hint">No tags have been set up yet. An admin can add them from the admin page.</p>${propose}`;
  }
  return `<div class="tag-picker">${groups.map((g) => `
    <fieldset class="tag-group">
      <legend>${escapeHtml(g.group)}</legend>
      <div class="tag-group-options">${g.tags.map((t) => `
        <label class="tag-pick${selected.has(t.id) ? ' checked' : ''}${t.status === 'proposed' ? ' proposed' : ''}"${
          t.description ? ` title="${escapeHtml(t.description)}"` : ''}>
          <input type="checkbox" name="tagIds" value="${t.id}"${selected.has(t.id) ? ' checked' : ''}>
          <span>${escapeHtml(t.name)}</span>
        </label>`).join('')}</div>
    </fieldset>`).join('')}</div>${propose}`;
}

function tagsIndexPage({ user, groups }) {
  const total = groups.reduce((n, g) => n + g.tags.length, 0);
  const body = groups.length ? groups.map((g) => `
    <section class="tag-index-group">
      <h2>${escapeHtml(g.group)}</h2>
      <div class="tag-chips">${g.tags.map((t) => `
        <a class="tag-chip${t.story_count ? '' : ' unused'}" href="/tags/${encodeURIComponent(t.slug)}"${
          t.description ? ` title="${escapeHtml(t.description)}"` : ''}>
          ${escapeHtml(t.name)}<span class="tag-count">${t.story_count}</span>
        </a>`).join('')}</div>
    </section>`).join('') : '<p class="muted">No tags yet. An admin can add them from the admin page.</p>';

  return layout({
    title: 'Tags',
    user,
    current: 'tags',
    body: `
      <div class="page-head"><h1>Tags</h1></div>
      <p class="muted">${total} tag${total === 1 ? '' : 's'} in use across the group's stories. The number on each is how many stories carry it.</p>
      ${body}`,
  });
}

function tagPage({ user, tag, stories, tagsByStory }) {
  const rows = stories.length
    ? stories.map((s) => storyRow(s, { tags: tagsByStory.get(s.id) || [] })).join('')
    : '<p class="muted">No stories carry this tag yet.</p>';
  return layout({
    title: tag.name,
    user,
    current: 'tags',
    body: `
      <p class="breadcrumb"><a href="/tags">&larr; All tags</a></p>
      <div class="page-head"><h1>${escapeHtml(tag.name)}</h1></div>
      <p class="muted">${tag.description ? `${escapeHtml(tag.description)} ` : ''}${escapeHtml(tag.tag_group)} tag &middot; ${stories.length} stor${stories.length === 1 ? 'y' : 'ies'}.</p>
      <div class="chapter-list">${rows}</div>`,
  });
}

function tagNotFoundPage({ user, slug }) {
  return layout({
    title: 'Tag not found',
    user,
    current: 'tags',
    body: `
      <p class="breadcrumb"><a href="/tags">&larr; All tags</a></p>
      <h1>No such tag</h1>
      <p class="muted">Nothing here is tagged "${escapeHtml(slug)}" -- it may have been renamed or removed since that link was made.</p>`,
  });
}

/** @param {{ user: Row, story: Row, groups: any[], selectedTagIds: number[], error?: string|null, values?: FormValues }} props */
function editStoryPage({ user, story, groups, selectedTagIds, error, values = /** @type {FormValues} */ ({}) }) {
  const title = values.title !== undefined ? values.title : story.title;
  const description = values.description !== undefined ? values.description : story.description;
  return layout({
    title: `Edit - ${story.title}`,
    user,
    body: `
      <p class="breadcrumb"><a href="/stories/${story.id}">&larr; ${escapeHtml(story.title)}</a></p>
      <div class="writer-card">
        <h1>Story details</h1>
        <p class="muted writer-intro">The title, the blurb, and the tags that tell everyone what they're walking into. Editing these doesn't touch a single chapter.</p>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/stories/${story.id}/edit" class="chapter-form">
          <label class="main-field">Title
            <input type="text" name="title" value="${escapeHtml(title)}" required>
          </label>
          <label>Description
            <textarea name="description" rows="3">${escapeHtml(description || '')}</textarea>
            <span class="hint">A couple of lines on what this story is, shown wherever it's listed.</span>
          </label>
          <div class="writer-section">
            <p class="writer-section-label">Tags</p>
            ${tagPicker(groups, selectedTagIds, { allowPropose: true })}
          </div>
          <div class="writer-actions">
            <a class="btn ghost" href="/stories/${story.id}">Cancel</a>
            <button class="btn" type="submit">Save details</button>
          </div>
        </form>
      </div>`,
  });
}

// ---------- glossary (a local, offline mirror of the shared-universe
// wiki -- see lib/wiki.js for how it's kept in sync) ----------
function glossaryIndexPage({ user, pages, q }) {
  const rows = pages.length ? pages.map((p) => `
    <a class="chapter-row" href="/glossary/${encodeURIComponent(p.title)}">
      <div class="chapter-row-main">
        <h3>${escapeHtml(p.title)}</h3>
        ${p.summary ? `<p class="muted">${escapeHtml(p.summary)}</p>` : ''}
      </div>
    </a>
  `).join('') : `<p class="muted">${q
    ? 'No glossary entries match your search.'
    : 'The glossary is empty -- an admin needs to sync the wiki from the admin page first.'}</p>`;

  return layout({
    title: 'Glossary',
    user,
    current: 'glossary',
    body: `
      <div class="page-head">
        <h1>Glossary</h1>
      </div>
      <p class="muted">A local, offline copy of <a href="${escapeHtml(wiki.WIKI_BASE_URL)}" target="_blank" rel="noopener noreferrer">the shared-universe wiki</a> -- ${pages.length} page${pages.length === 1 ? '' : 's'}${q ? ' matching your search' : ''}. Pages link to each other the same way they do on the wiki itself.</p>
      <form method="get" action="/glossary" class="inline-form glossary-search">
        <input type="search" name="q" placeholder="Search the glossary..." value="${escapeHtml(q)}">
        <button class="btn ghost small" type="submit">Search</button>
        ${q ? '<a class="btn ghost small" href="/glossary">Clear</a>' : ''}
      </form>
      <div class="chapter-list">${rows}</div>`,
  });
}

function glossaryPage({ user, page }) {
  // A page can be in the index (title + summary, from an older sync) with
  // no body yet, if the sync that stored it predates full-content syncing
  // or the most recent sync failed. Say so plainly instead of rendering an
  // empty sheet that reads like a broken page.
  const body = page.content_html
    ? `<div class="glossary-content">${page.content_html}</div>`
    : `<div class="glossary-empty">
         <p><strong>This entry hasn't been copied across yet.</strong></p>
         <p class="muted">The glossary knows this page exists and what it's about, but not its full text -- that arrives with the next wiki sync. ${user.is_admin ? 'You can run one now from the <a href="/admin">admin page</a>.' : 'An admin can run one from the admin page.'}</p>
         ${page.summary ? `<blockquote class="quoted">${escapeHtml(page.summary)}</blockquote>` : ''}
       </div>`;
  return layout({
    title: page.title,
    user,
    current: 'glossary',
    body: `
      <p class="breadcrumb"><a href="/glossary">&larr; Glossary</a></p>
      <div class="page-head">
        <h1>${escapeHtml(page.title)}</h1>
        <a class="btn ghost small" href="${escapeHtml(wiki.pageUrl(page.title))}" target="_blank" rel="noopener noreferrer">Open on the wiki &#8599;</a>
      </div>
      <p class="muted glossary-meta">A local copy${page.fetched_at ? `, last synced ${timeHtml(page.fetched_at)}` : ''}.</p>
      <div class="reading-pane">
        ${body}
      </div>`,
  });
}

function glossaryNotFoundPage({ user, title }) {
  return layout({
    title: 'Not found',
    user,
    body: `
      <p class="breadcrumb"><a href="/glossary">&larr; Glossary</a></p>
      <h1>Not in the glossary</h1>
      <p class="muted">"${escapeHtml(title)}" hasn't been synced from the wiki (or doesn't exist there). Try <a href="${escapeHtml(wiki.pageUrl(title))}" target="_blank" rel="noopener noreferrer">the wiki itself</a>, or ask an admin to sync from the admin page.</p>`,
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
            <span class="hint">${MARKDOWN_HINT}</span>
          </label>
          <div class="writer-section">
            <p class="writer-section-label">Optional details</p>
            <label>Story description<textarea name="storyDescription" rows="2">${escapeHtml(values.storyDescription || '')}</textarea></label>
            <label>Chapter summary<textarea name="chapterSummary" rows="2">${escapeHtml(values.chapterSummary || '')}</textarea></label>
            ${fileUploadField()}
          </div>
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

/** @param {{ user: Row, story: Row, chapters?: Row[], error?: string|null, values?: FormValues }} props */
function newChapterPage({ user, story, chapters = [], error, values = /** @type {FormValues} */ ({}) }) {
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
      <script src="/js/nspell.bundle.js"></script>
      <script src="/js/writing-analyzer.js" defer></script>`,
  });
}

// ---------- edit chapter (title, summary, and the text itself) ----------

/** @param {{ user: Row, chapter: Row, latestContent: string, comments?: Row[], error?: string|null, values?: FormValues }} props */
function editChapterPage({ user, chapter, latestContent, comments = [], error, values = /** @type {FormValues} */ ({}) }) {
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

// Reads "by Ana", "by Ana with Luis", "by Ana with Luis and Marta",
// "by Ana with Luis, Marta and Sergio" -- a byline, not a field listing.
function bylineWith(authorName, coauthors) {
  const names = (coauthors || []).map((c) => escapeHtml(c.display_name));
  const base = `by ${escapeHtml(authorName)}`;
  if (!names.length) return base;
  if (names.length === 1) return `${base} with ${names[0]}`;
  return `${base} with ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
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

function storyPage({ user, story, chapters, isStoryAuthor, canWrite = false, dictionary = [], tags = [], coauthors = [], addableCoauthors = [] }) {
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
          <p class="muted byline">${bylineWith(story.author_name, coauthors)} &middot; ${timeHtml(story.created_at)}</p>
          ${story.description ? `<p class="summary">${escapeHtml(story.description)}</p>` : ''}
          ${tagChips(tags)}
        </div>
        <div class="page-head-actions">
          ${canWrite ? `<a class="btn" href="/stories/${story.id}/chapters/new">Add chapter</a>` : ''}
          ${isStoryAuthor ? `<a class="btn ghost small" href="/stories/${story.id}/edit">Edit details</a>` : ''}
          ${isStoryAuthor ? `
            <form method="post" action="/stories/${story.id}/archive" class="inline-form">
              <button class="btn ghost small" type="submit">Archive story</button>
            </form>` : ''}
        </div>
      </div>
      <div class="chapter-list">${rows}</div>
      <p class="muted archive-link"><a href="/stories/${story.id}/archived-chapters">View archived chapters &rarr;</a></p>
      ${(isStoryAuthor || coauthors.length) ? coauthorsSection({ story, coauthors, addableCoauthors, isStoryAuthor, currentUserId: user.id }) : ''}
      ${canWrite ? storyDictionarySection(story, dictionary) : ''}`,
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
            <button name="status" value="accepted" class="btn small accept" type="submit">Accept</button>
            <button name="status" value="rejected" class="btn small reject" type="submit">Reject</button>
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

// A read-only rendering of a comment for reference contexts (the edit
// page) where clicking an action button would navigate away and lose
// whatever's currently unsaved in the editor -- no reply/accept/reject/
// retract/edit controls here, just what was said and by whom.
function renderCommentReadOnly(c, { replies }) {
  const statusLabel = STATUS_LABEL[c.status] || c.status;
  if (c.deleted_at) {
    return `
      <div class="comment status-${c.status} retracted">
        <div class="comment-meta">
          <strong>${escapeHtml(c.author_name)}</strong>
          <span class="status-badge status-${c.status}">${statusLabel}</span>
          ${timeHtml(c.created_at)}
        </div>
        <p class="comment-body muted"><em>[comment retracted]</em></p>
      </div>`;
  }
  const repliesHtml = replies.filter((r) => !r.deleted_at).map((r) => `
    <div class="reply">
      <strong>${escapeHtml(r.author_name)}</strong>
      <span>${escapeHtml(r.body)}</span>
      ${timeHtml(r.created_at)}
    </div>`).join('');
  return `
    <div class="comment status-${c.status}">
      <div class="comment-meta">
        <strong>${escapeHtml(c.author_name)}</strong>
        <span class="status-badge status-${c.status}">${statusLabel}</span>
        ${timeHtml(c.created_at)}
        ${c.edited_at ? '<span class="muted edited-tag">(edited)</span>' : ''}
      </div>
      ${c.quoted_text ? `<blockquote class="quoted">${escapeHtml(c.quoted_text)}</blockquote>` : ''}
      <p class="comment-body">${escapeHtml(c.body)}</p>
      ${repliesHtml}
    </div>`;
}

// Moving between chapters without going back to the story page. Absent
// entirely for a one-chapter story, where "next" and "previous" are just
// two dead controls.
function chapterNav(chapter, neighbours, { compact = false } = {}) {
  if (!neighbours || neighbours.total < 2) return '';
  const { prev, next, position, total } = neighbours;
  const label = (c) => `Chapter ${c.chapter_number}: ${escapeHtml(c.title)}`;
  const here = position ? `Chapter ${position} of ${total}` : `${total} chapters`;

  if (compact) {
    return `
      <nav class="chapter-nav compact" aria-label="Chapters">
        ${prev ? `<a class="chapter-nav-arrow" href="/chapters/${prev.id}" title="${label(prev)}" rel="prev">&larr; Previous</a>`
               : '<span class="chapter-nav-arrow disabled">&larr; Previous</span>'}
        <a class="chapter-nav-here" href="/stories/${chapter.story_id}">${here}</a>
        ${next ? `<a class="chapter-nav-arrow" href="/chapters/${next.id}" title="${label(next)}" rel="next">Next &rarr;</a>`
               : '<span class="chapter-nav-arrow disabled">Next &rarr;</span>'}
      </nav>`;
  }
  // The one at the foot of the chapter carries the titles: by the time
  // you get there you've finished reading and the question is what comes
  // next, which a bare arrow doesn't answer.
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
        </a>` : '<span></span>'}
    </nav>`;
}

function chapterPage({ user, chapter, versions, currentVersion, comments, isChapterAuthor, neighbours = null }) {
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
  const highlighted = renderHighlighted(ast, comments, wiki.findWikiMatches);

  const body = `
    <p class="breadcrumb"><a href="/stories/${chapter.story_id}">&larr; ${escapeHtml(chapter.story_title)}</a></p>
    <div class="chapter-header">
      <h1>Chapter ${chapter.chapter_number}: ${escapeHtml(chapter.title)}</h1>
      <p class="muted byline">by ${escapeHtml(chapter.author_name)} &middot; ${timeHtml(chapter.created_at)}${
        neighbours && neighbours.total > 1 ? ` &middot; <a href="/stories/${chapter.story_id}">chapter ${neighbours.position} of ${neighbours.total}</a>` : ''
      }</p>
      ${chapter.summary ? `<p class="summary">${escapeHtml(chapter.summary)}</p>` : ''}
      <div class="version-bar">
        <div class="version-context">
          <label>Version:
            <select id="version-select">${versionOptions}</select>
          </label>
          ${timeHtml(currentVersion.created_at, 'version-ts')}
          ${currentVersion.changelog ? `<span class="changelog muted">&ldquo;${escapeHtml(currentVersion.changelog)}&rdquo;</span>` : ''}
          ${versions.length > 1 ? `<a class="version-compare" href="/chapters/${chapter.id}/diff?to=${currentVersion.version_number}">What changed?</a>` : ''}
        </div>
        <div class="version-actions">
          <button id="reading-fill-screen" class="btn ghost small" type="button">Fill screen</button>
          ${isChapterAuthor ? `<a class="btn ghost small" href="/chapters/${chapter.id}/edit">Edit</a>` : ''}
          <details class="menu">
            <summary class="btn ghost small">More</summary>
            <div class="menu-panel">
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
    ${chapterNav(chapter, neighbours)}
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
// A window of text around the first occurrence, with the term marked.
// Works on plain text, so anything HTML (a glossary body) has to be
// flattened before it gets here.
function searchSnippet(text, query, { radius = 110 } = {}) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const at = source.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1) return escapeHtml(source.slice(0, radius * 2)) + (source.length > radius * 2 ? '&hellip;' : '');
  const from = Math.max(0, at - radius);
  const to = Math.min(source.length, at + query.length + radius);
  // Don't cut a word in half at either end.
  const start = from === 0 ? 0 : source.indexOf(' ', from) + 1;
  const end = to === source.length ? source.length : source.lastIndexOf(' ', to);
  const before = source.slice(start, at);
  const match = source.slice(at, at + query.length);
  const after = source.slice(at + query.length, end);
  return `${start > 0 ? '&hellip;' : ''}${escapeHtml(before)}<mark class="search-hit">${escapeHtml(match)}</mark>${escapeHtml(after)}${end < source.length ? '&hellip;' : ''}`;
}

const stripTags = (html) => String(html || '').replace(/<[^>]*>/g, ' ');

function searchPage({ user, results, query }) {
  const box = `
    <form method="get" action="/search" class="search-page-form">
      <input type="search" name="q" value="${escapeHtml(query || '')}" placeholder="Search stories, chapters and the glossary" autofocus>
      <button class="btn" type="submit">Search</button>
    </form>`;

  if (!results) {
    return layout({
      title: 'Search',
      user,
      current: 'search',
      body: `
        <div class="page-head"><h1>Search</h1></div>
        ${box}
        <p class="muted">${query ? 'Give it at least two characters.' : 'Looks through story titles and blurbs, chapter titles and summaries, the current text of every chapter, and the glossary.'}</p>`,
    });
  }

  const total = results.stories.length + results.chapters.length + results.passages.length + results.glossary.length;

  const section = (title, items, render) => (items.length ? `
    <section class="search-group">
      <h2>${title} <span class="search-count">${items.length}</span></h2>
      <div class="search-results">${items.map(render).join('')}</div>
    </section>` : '');

  const body = total === 0
    ? `<p class="muted search-empty">Nothing matches &ldquo;${escapeHtml(results.query)}&rdquo;. Archived stories and chapters aren't searched, and only each chapter's current version is.</p>`
    : [
      section('Stories', results.stories, (s) => `
        <a class="search-result" href="/stories/${s.id}">
          <span class="search-result-title">${searchSnippet(s.title, results.query, { radius: 60 })}</span>
          <span class="search-result-where">by ${escapeHtml(s.author_name)}</span>
          ${s.description ? `<span class="search-result-snippet">${searchSnippet(s.description, results.query)}</span>` : ''}
        </a>`),
      section('Chapters', results.chapters, (c) => `
        <a class="search-result" href="/chapters/${c.id}">
          <span class="search-result-title">${searchSnippet(`Chapter ${c.chapter_number}: ${c.title}`, results.query, { radius: 60 })}</span>
          <span class="search-result-where">${escapeHtml(c.story_title)}</span>
          ${c.summary ? `<span class="search-result-snippet">${searchSnippet(c.summary, results.query)}</span>` : ''}
        </a>`),
      section('In the text', results.passages, (p) => `
        <a class="search-result" href="/chapters/${p.id}">
          <span class="search-result-title">${escapeHtml(p.story_title)} &middot; Chapter ${p.chapter_number}: ${escapeHtml(p.title)}</span>
          <span class="search-result-snippet prose">${searchSnippet(p.content, results.query)}</span>
        </a>`),
      section('Glossary', results.glossary, (g) => `
        <a class="search-result" href="/glossary/${encodeURIComponent(g.title)}">
          <span class="search-result-title">${searchSnippet(g.title, results.query, { radius: 60 })}</span>
          <span class="search-result-snippet">${searchSnippet(stripTags(g.content_html) || g.summary, results.query)}</span>
        </a>`),
    ].join('');

  return layout({
    title: `Search: ${results.query}`,
    user,
    current: 'search',
    body: `
      <div class="page-head"><h1>Search</h1></div>
      ${box}
      <p class="muted search-summary">${total} result${total === 1 ? '' : 's'} for &ldquo;${escapeHtml(results.query)}&rdquo;.</p>
      ${body}`,
  });
}

// ---------- account settings ----------

/** @param {{ user: Row, error?: string|null, notice?: string|null, groups?: any[], hiddenTagIds?: number[] }} props */
function accountPage({ user, error, notice, groups = [], hiddenTagIds = [] }) {
  return layout({
    title: 'Account',
    user,
    current: 'account',
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
      </div>
      ${hiddenTagsSection(groups, hiddenTagIds)}`,
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
        <form method="post" action="/admin/invite-code/close" class="inline-form" data-confirm="Close registration? Nobody will be able to register until you generate a new code.">
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
        <form method="post" action="/admin/invite-code/named/${inv.id}/revoke" class="inline-form" data-confirm="Revoke this invite? The code will stop working.">
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
        <form method="post" action="/admin/users/${u.id}/reset-link" class="inline-form">
          <button class="btn small ghost" type="submit">Send reset link</button>
        </form>
        ${locked
          ? `<form method="post" action="/admin/users/${u.id}/unlock" class="inline-form">
               <button class="btn small ghost" type="submit">Reactivate</button>
             </form>`
          : (isSelf ? '' : `<form method="post" action="/admin/users/${u.id}/lock" class="inline-form">
               <button class="btn small ghost" type="submit">Lock account</button>
             </form>`)
        }
        ${isSelf ? '' : `
          <form method="post" action="/admin/users/${u.id}/delete" class="inline-form" data-confirm="Delete this account? Their stories/chapters/comments stay, credited to Deleted user. This cannot be undone.">
            <button class="btn small danger" type="submit">Delete account</button>
          </form>`}
      </div>
    </div>`;
}

function adminPage({ user, users, activeInviteCode, inviteCodeHistory, pendingNamedInvites, pendingResetLinks, wikiSyncState, notice, tagGroups = [], proposedTags = [] }) {
  const userRows = users.map((u) => adminUserRow(u, { currentUserId: user.id })).join('');
  return layout({
    title: 'Admin',
    user,
    current: 'admin',
    flash: notice ? { type: 'info', message: notice } : null,
    body: `
      <h1>Admin</h1>

      <section class="admin-section">
        <h2>Backup</h2>
        <p class="muted">A complete, self-contained snapshot of the database -- every user, story, chapter, version, comment, and invite code -- as a single .sqlite file, safe to download even while the server is running. This is the only copy of everyone's writing outside this machine, so keep one somewhere else.</p>
        <a class="btn ghost" href="/admin/backup">Download backup (.sqlite)</a>
      </section>

      <section class="admin-section">
        <h2>Registration</h2>
        ${inviteCodeCard(activeInviteCode)}
        ${inviteCodeHistoryTable(inviteCodeHistory)}
      </section>

      ${namedInviteSection(pendingNamedInvites)}

      ${resetLinksSection(pendingResetLinks)}

      ${wikiSyncSection(wikiSyncState)}

      ${tagAdminSection(tagGroups, proposedTags)}

      <section class="admin-section">
        <h2>Users</h2>
        <div class="admin-user-list">${userRows}</div>
      </section>`,
  });
}

// The tag vocabulary, managed in one place: authors only ever pick from
// this list, so this is where "Sci-Fi" and "Science fiction" get stopped
// from both existing.
// Tags authors proposed while writing. Each row offers the three things
// an admin actually wants to do with a proposal: take it as it stands
// (possibly renaming and filing it under a real group first), fold it
// into a tag that already says the same thing, or throw it out.
function proposedTagsSection(proposedTags, tagGroups) {
  if (!proposedTags.length) return '';
  const approved = tagGroups.flatMap((g) => g.tags.filter((t) => t.status !== 'proposed').map((t) => ({ ...t, group: g.group })));
  const groupNames = Array.from(new Set(tagGroups.map((g) => g.group))).filter((n) => n !== 'Proposed');

  return `
    <div class="proposed-queue">
      <h3 class="tag-admin-group">Proposed by authors (${proposedTags.length})</h3>
      <p class="muted">These are already on the stories they were proposed for and marked as proposed wherever they show. Approving one files it in the vocabulary properly; merging moves its stories onto a tag that already exists and drops the duplicate.</p>
      ${proposedTags.map((t) => `
        <div class="proposed-row">
          <div class="proposed-row-head">
            <strong>${escapeHtml(t.name)}</strong>
            <span class="muted">${t.proposed_by_name ? `proposed by ${escapeHtml(t.proposed_by_name)}` : 'proposed'} &middot; ${t.story_count} stor${t.story_count === 1 ? 'y' : 'ies'}</span>
          </div>
          <div class="proposed-row-actions">
            <form method="post" action="/admin/tags/${t.id}/approve" class="proposed-form">
              <input type="text" name="name" value="${escapeHtml(t.name)}" aria-label="Name to approve it under">
              <select name="group" aria-label="Group">
                ${groupNames.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}
              </select>
              <button class="btn small" type="submit">Approve</button>
            </form>
            <form method="post" action="/admin/tags/${t.id}/merge" class="proposed-form">
              <select name="intoTagId" aria-label="Merge into">
                ${approved.map((a) => `<option value="${a.id}">${escapeHtml(a.group)}: ${escapeHtml(a.name)}</option>`).join('')}
              </select>
              <button class="btn ghost small" type="submit">Merge into</button>
            </form>
            <form method="post" action="/admin/tags/${t.id}/delete" class="proposed-form">
              <button class="btn danger small" type="submit"
                data-confirm="Throw out the proposed tag &quot;${escapeHtml(t.name)}&quot;?${t.story_count ? ` It will be taken off ${t.story_count} stor${t.story_count === 1 ? 'y' : 'ies'}.` : ''}">Reject</button>
            </form>
          </div>
        </div>`).join('')}
    </div>`;
}

function tagAdminSection(tagGroups, proposedTags = []) {
  const groupNames = Array.from(new Set(tagGroups.map((g) => g.group)));
  const rows = tagGroups.map((g) => `
    <h3 class="tag-admin-group">${escapeHtml(g.group)}</h3>
    <div class="tag-admin-list">${g.tags.map((t) => `
      <form method="post" action="/admin/tags/${t.id}" class="tag-admin-row">
        <input type="text" name="name" value="${escapeHtml(t.name)}" aria-label="Tag name">
        <input type="text" name="group" value="${escapeHtml(t.tag_group)}" list="tag-groups" aria-label="Group">
        <input type="text" name="description" value="${escapeHtml(t.description || '')}" placeholder="What it means (optional)" aria-label="Description">
        <span class="tag-admin-count">${t.story_count} stor${t.story_count === 1 ? 'y' : 'ies'}</span>
        <button class="btn ghost small" type="submit">Save</button>
        <button class="btn danger small" type="submit" formaction="/admin/tags/${t.id}/delete"
          data-confirm="Delete the tag &quot;${escapeHtml(t.name)}&quot;?${t.story_count ? ` It is on ${t.story_count} stor${t.story_count === 1 ? 'y' : 'ies'}, and will be taken off ${t.story_count === 1 ? 'it' : 'them'}.` : ''}">Delete</button>
      </form>`).join('')}</div>`).join('');

  return `
    <section class="admin-section" id="tags">
      <h2>Tags</h2>
      <p class="muted">The vocabulary authors pick from when they tag a story (see the <a href="/tags">tag index</a>). Renaming one updates it everywhere at once; its link keeps working, since a tag is identified by its own row rather than by its name.</p>
      ${proposedTagsSection(proposedTags, tagGroups)}
      <datalist id="tag-groups">${groupNames.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('')}</datalist>
      <form method="post" action="/admin/tags" class="tag-admin-new">
        <input type="text" name="name" placeholder="New tag" required aria-label="New tag name">
        <input type="text" name="group" placeholder="Group" list="tag-groups" aria-label="Group">
        <input type="text" name="description" placeholder="What it means (optional)" aria-label="Description">
        <button class="btn small" type="submit">Add tag</button>
      </form>
      ${tagGroups.length ? rows : '<p class="muted">No tags yet.</p>'}
    </section>`;
}

// A reader's own "not for me" list -- the equivalent of SOL's excluded
// codes. Stories carrying any of these fold away on their story list
// instead of vanishing, so nothing ever goes missing without saying so.
function hiddenTagsSection(groups, hiddenTagIds) {
  if (!groups.length) return '';
  return `
    <section class="admin-section">
      <h2>Tags you'd rather not see</h2>
      <p class="muted">Stories carrying any of these get folded away on your story list, behind a line saying how many there are. This only affects what you see.</p>
      <form method="post" action="/account/hidden-tags">
        ${tagPicker(groups, hiddenTagIds)}
        <div class="writer-actions">
          <button class="btn" type="submit">Save</button>
        </div>
      </form>
    </section>`;
}

function wikiSyncSection(state) {
  const statusLine = !state || !state.last_synced_at
    ? '<p class="muted">Never synced yet.</p>'
    : `<p class="muted">Last synced ${timeHtml(state.last_synced_at)} &middot; ${state.page_count} pages${
        state.last_status === 'error' ? ` &middot; <span class="error">failed: ${escapeHtml(state.last_error || 'unknown error')}</span>` : ''
      }</p>`;
  return `
    <section class="admin-section">
      <h2>Wiki linking</h2>
      <p class="muted">Character/place/ship names recognized from <a href="${escapeHtml(wiki.WIKI_BASE_URL)}" target="_blank" rel="noopener noreferrer">the shared-universe wiki</a> get auto-linked in chapter text, with a hover preview of the wiki page's summary -- readers can turn this off from the "Wiki links" toggle on the chapter page. The same local copy also powers the <a href="/glossary">Glossary</a> section, a full offline mirror of the wiki's pages. Nothing here refreshes automatically -- click "Sync wiki now" below whenever the wiki has changed.</p>
      ${statusLine}
      <form method="post" action="/admin/wiki/sync" class="inline-form">
        <button class="btn ghost small" type="submit">Sync wiki now</button>
      </form>
    </section>`;
}

function resetLinksSection(pendingResetLinks) {
  if (!pendingResetLinks.length) return '';
  const rows = pendingResetLinks.map((t) => `
    <div class="admin-user-row">
      <div class="admin-user-main">
        <strong>${escapeHtml(t.user_display_name)}</strong> <span class="muted">@${escapeHtml(t.user_username)}</span>
        <p class="muted small-meta">Requested ${timeHtml(t.created_at)} &middot; expires ${timeHtml(t.expires_at)}</p>
      </div>
      <div class="admin-user-actions">
        <form method="post" action="/admin/reset-link/${t.id}/revoke" class="inline-form">
          <button class="btn small ghost" type="submit">Revoke</button>
        </form>
      </div>
    </div>`).join('');
  return `
    <section class="admin-section">
      <h2>Pending password reset links</h2>
      <p class="muted">Generated from a user's "Send reset link" button below. Each link is single-use and expires after 24 hours.</p>
      <div class="admin-user-list">${rows}</div>
    </section>`;
}

module.exports = {
  errorPage,
  loginPage,
  registerPage,
  resetPasswordPage,
  resetPasswordExpiredPage,
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
  glossaryIndexPage,
  glossaryPage,
  glossaryNotFoundPage,
  chapterDiffPage,
  diffUnavailablePage,
  searchPage,
  tagsIndexPage,
  tagPage,
  tagNotFoundPage,
  editStoryPage,
};
