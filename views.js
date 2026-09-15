'use strict';

const { layout } = require('./lib/layout');
const { escapeHtml, toScriptJson } = require('./lib/util');
const { parseMarkdown, renderHighlighted } = require('./lib/markdown');
const { timeHtml } = require('./lib/time');
const {
  storyState, STORY_STATES, CHOOSABLE_STORY_STATES,
  CHAPTER_STAGES, DEFAULT_CHAPTER_STAGE, CHAPTER_STAGE_META,
} = require('./lib/story-state');
const wiki = require('./lib/wiki');
const taxonomy = require('./lib/glossary-taxonomy');
const bible = require('./lib/story-bible');
const bibleImages = require('./lib/entity-images');
const docs = require('./lib/docs');

const MARKDOWN_HINT = `Markdown is supported: **bold**, *italic*, ***both***, ~~strikethrough~~, \`code\`, [link](https://...), # Heading, &gt; quote, --- for a scene break, and - or 1. list items. Put a backslash before a character to keep it literal (\\* shows a real asterisk). Line breaks are kept as you type them.`;

// Word counts are read at a glance, not audited: exact under ten thousand,
// rounded to a tenth of a thousand above it, where the last three digits
// stop telling anybody anything.
function wordCount(n) {
  const count = Number(n) || 0;
  if (!count) return '';
  if (count < 10000) return `${count.toLocaleString('en-GB')} words`;
  return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k words`;
}

// Inline SVG, one line each, inheriting the button's own colour -- no
// icon font and no dependency. Only the verbs get one: accepting and
// rejecting a comment are what this app is for, and they should be
// distinguishable across a room rather than by reading them. A picture
// beside every label would be noise.
const ICONS = {
  tick: '<svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><polyline points="4,10.5 8,14.5 16,5.5"/></svg>',
  cross: '<svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><line x1="5.5" y1="5.5" x2="14.5" y2="14.5"/><line x1="14.5" y1="5.5" x2="5.5" y2="14.5"/></svg>',
  plus: '<svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><line x1="10" y1="4.5" x2="10" y2="15.5"/><line x1="4.5" y1="10" x2="15.5" y2="10"/></svg>',
};

// ---------- empty states ----------
// A list with nothing in it used to say "No chapters yet." in grey and
// stop there. That is the moment somebody is most lost and the app is
// most silent: it should say what goes here, and offer the one thing
// there is to do.
//
// The drawings are line art in the page's own ink -- a thin stroke, no
// fill, no colour of their own -- so they read as a mark on paper rather
// than as clip art, and they cost nothing to ship.
const EMPTY_ART = {
  sheets: '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="12" y="8" width="32" height="42" rx="2"/><rect x="20" y="14" width="32" height="42" rx="2"/><line x1="27" y1="26" x2="45" y2="26"/><line x1="27" y1="34" x2="45" y2="34"/><line x1="27" y1="42" x2="38" y2="42"/></svg>',
  margin: '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="12" width="48" height="34" rx="3"/><line x1="17" y1="23" x2="39" y2="23"/><line x1="17" y1="31" x2="33" y2="31"/><path d="M20 46 L20 55 L29 46"/></svg>',
  glass: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="28" cy="27" r="15"/><line x1="39" y1="38" x2="52" y2="51"/><line x1="21" y1="24" x2="35" y2="24"/><line x1="21" y1="31" x2="30" y2="31"/></svg>',
  label: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 20 L34 20 L52 32 L34 44 L8 44 Z"/><circle cx="18" cy="32" r="2.6"/></svg>',
};

/**
 * @param {{ art?: string, title: string, body?: string, action?: string }} content
 */
function emptyState({ art, title, body, action }) {
  return `
    <div class="empty-state">
      ${art ? `<div class="empty-art">${EMPTY_ART[art] || ''}</div>` : ''}
      <p class="empty-title">${escapeHtml(title)}</p>
      ${body ? `<p class="empty-body">${body}</p>` : ''}
      ${action ? `<p class="empty-action">${action}</p>` : ''}
    </div>`;
}

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
        ${storyState(s) === 'ongoing' ? '' : storyStateBadge(s)}
        <span>${s.chapter_count} chapter${s.chapter_count === 1 ? '' : 's'}${s.word_count ? ` &middot; ${wordCount(s.word_count)}` : ''}</span>
        ${timeHtml(s.last_chapter_at || s.created_at)}
        ${s.pending_comments > 0 ? `<span class="badge pending">${s.pending_comments} pending</span>` : ''}
      </div>
    </div>
  `;
}

// A short quote of a comment, enough to recognise which one it is without
// reproducing the whole thing where it can't be replied to.
function commentGist(body, max = 120) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  return escapeHtml(text.length > max ? `${text.slice(0, max - 1).trimEnd()}\u2026` : text);
}

// What's waiting for this reader, above the list of everything. Renders
// nothing at all when there is nothing -- an empty "you're all caught up"
// box every single day is furniture, not information.
function inboxSection(inbox) {
  if (!inbox || inbox.empty) return '';

  const pending = inbox.pending.length ? `
    <section class="inbox-group">
      <h3>Waiting on you</h3>
      <ul class="inbox-list">
        ${inbox.pending.map((row) => `
          <li>
            <a href="/chapters/${row.chapter_id}">
              <span class="inbox-count">${row.pending}</span>
              <span class="inbox-what">comment${row.pending === 1 ? '' : 's'} to accept or reject</span>
              <span class="inbox-where">${escapeHtml(row.story_title)} &middot; chapter ${row.chapter_number}: ${escapeHtml(row.chapter_title)}</span>
            </a>
          </li>`).join('')}
      </ul>
    </section>` : '';

  const replies = inbox.replies.length ? `
    <section class="inbox-group">
      <h3>Replies to you</h3>
      <ul class="inbox-list">
        ${inbox.replies.map((r) => `
          <li>
            <a href="/chapters/${r.chapter_id}#comment-${r.id}">
              <span class="inbox-what"><strong>${escapeHtml(r.author_name)}</strong> ${commentGist(r.body)}</span>
              <span class="inbox-where">${escapeHtml(r.story_title)} &middot; chapter ${r.chapter_number}: ${escapeHtml(r.chapter_title)}</span>
            </a>
          </li>`).join('')}
      </ul>
    </section>` : '';

  const fresh = inbox.newChapters.length ? `
    <section class="inbox-group">
      <h3>New to read</h3>
      <ul class="inbox-list">
        ${inbox.newChapters.map((c) => `
          <li>
            <a href="/chapters/${c.id}">
              <span class="inbox-what">Chapter ${c.chapter_number}: ${escapeHtml(c.title)}</span>
              <span class="inbox-where">${escapeHtml(c.story_title)} &middot; by ${escapeHtml(c.author_name)}${c.word_count ? ` &middot; ${wordCount(c.word_count)}` : ''}</span>
            </a>
          </li>`).join('')}
      </ul>
    </section>` : '';

  return `<div class="inbox">${pending}${replies}${fresh}</div>`;
}

function storiesPage({ user, stories, folded = [], since, tagsByStory, coauthorsByStory = new Map(), activeTags = [], allGroups = [], inbox = null }) {
  const sinceQs = since ? `?since=${encodeURIComponent(since)}` : '';
  const tagsFor = (s) => (tagsByStory && tagsByStory.get(s.id)) || [];
  const rows = stories.length
    ? stories.map((s) => storyRow(s, { tags: tagsFor(s), sinceQs, coauthors: coauthorsByStory.get(s.id) || [] })).join('')
    : (activeTags.length
      ? emptyState({
        art: 'label',
        title: 'Nothing carries every tag you picked',
        body: `A story has to have <em>all</em> of them, not any. Try taking one off: ${activeTags.map((t) => escapeHtml(t.name)).join(', ')}.`,
        action: '<a class="btn ghost small" href="/">Clear the filter</a>',
      })
      : emptyState({
        art: 'sheets',
        title: 'No stories yet',
        body: 'A story is a set of chapters with one author and, if they want, coauthors. You write the first chapter as you create it.',
        action: '<a class="btn" href="/stories/new">Start the first one</a>',
      }));

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
      ${activeTags.length ? '' : inboxSection(inbox)}
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
  // Sixty-four checkboxes in nine groups is most of the height of this
  // form. Each group folds, and opens itself when it already has
  // something ticked -- so editing a story shows you what you picked and
  // creating one is a list of nine headings instead of a wall.
  return `<div class="tag-picker">${groups.map((g) => {
    const chosen = g.tags.filter((t) => selected.has(t.id));
    return `
    <details class="tag-group"${chosen.length ? ' open' : ''}>
      <summary>
        <span class="tag-group-name">${escapeHtml(g.group)}</span>
        ${chosen.length
          ? `<span class="tag-group-chosen">${chosen.map((t) => escapeHtml(t.name)).join(', ')}</span>`
          : `<span class="tag-group-count">${g.tags.length}</span>`}
      </summary>
      <div class="tag-group-options">${g.tags.map((t) => `
        <label class="tag-pick${selected.has(t.id) ? ' checked' : ''}${t.status === 'proposed' ? ' proposed' : ''}"${
          t.description ? ` title="${escapeHtml(t.description)}"` : ''}>
          <input type="checkbox" name="tagIds" value="${t.id}"${selected.has(t.id) ? ' checked' : ''}>
          <span>${escapeHtml(t.name)}</span>
        </label>`).join('')}</div>
    </details>`;
  }).join('')}</div>${propose}`;
}

function tagsIndexPage({ user, groups }) {
  const total = groups.reduce((n, g) => n + g.tags.length, 0);
  const chip = (t) => `
    <a class="tag-chip${t.story_count ? '' : ' unused'}" href="/tags/${encodeURIComponent(t.slug)}"${
      t.description ? ` title="${escapeHtml(t.description)}"` : ''}>
      ${escapeHtml(t.name)}<span class="tag-count">${t.story_count}</span>
    </a>`;

  // Most of the vocabulary is unused most of the time -- a starting list
  // of sixty-odd against an archive of a handful of stories. Showing all
  // of it at once made the page read as a catalogue of nothing: rows and
  // rows of "0". What somebody wants first is the tags that would
  // actually take them somewhere.
  const used = groups.map((g) => ({ ...g, tags: g.tags.filter((t) => t.story_count > 0) }))
    .filter((g) => g.tags.length);
  const unusedCount = total - used.reduce((n, g) => n + g.tags.length, 0);

  const section = (g) => `
    <section class="tag-index-group">
      <h2>${escapeHtml(g.group)}</h2>
      <div class="tag-chips">${g.tags.map(chip).join('')}</div>
    </section>`;

  let body;
  if (!groups.length) {
    body = emptyState({
      art: 'label',
      title: 'No tags have been set up',
      body: 'Tags are the vocabulary the whole group shares. An admin adds them from the admin page.',
      action: user.is_admin ? '<a class="btn ghost small" href="/admin#tags">Set them up</a>' : '',
    });
  } else if (!used.length) {
    body = emptyState({
      art: 'label',
      title: 'Nothing is tagged yet',
      body: `The vocabulary is there \u2014 ${total} tag${total === 1 ? '' : 's'} \u2014 but no story carries one. They go on a story from its own page, under &ldquo;Edit details&rdquo;.`,
    }) + `
      <details class="tag-vocabulary">
        <summary>See the whole vocabulary</summary>
        ${groups.map(section).join('')}
      </details>`;
  } else {
    body = `
      ${used.map(section).join('')}
      ${unusedCount ? `
        <details class="tag-vocabulary">
          <summary>${unusedCount} more tag${unusedCount === 1 ? '' : 's'} nothing is using yet</summary>
          ${groups.map((g) => ({ ...g, tags: g.tags.filter((t) => !t.story_count) }))
            .filter((g) => g.tags.length).map(section).join('')}
        </details>` : ''}`;
  }

  return layout({
    title: 'Tags',
    user,
    current: 'tags',
    body: `
      <div class="page-head"><h1>Tags</h1></div>
      <p class="muted">${total} tag${total === 1 ? '' : 's'} in the group's shared vocabulary. The number on each is how many stories carry it.</p>
      ${body}`,
  });
}

function tagPage({ user, tag, stories, tagsByStory }) {
  const rows = stories.length
    ? stories.map((s) => storyRow(s, { tags: tagsByStory.get(s.id) || [] })).join('')
    : emptyState({
      art: 'label',
      title: 'No stories carry this tag yet',
      body: 'Tags go on a story from its own page, under &ldquo;Edit details&rdquo;.',
    });
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
  const synopsis = values.synopsis !== undefined ? values.synopsis : (story.synopsis || '');
  const status = values.status !== undefined ? values.status : (story.status || 'ongoing');
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
          <label>Synopsis
            <textarea name="synopsis" rows="6">${escapeHtml(synopsis)}</textarea>
            <span class="hint">What actually happens, for somebody coming back to chapter nine after a month away. Spoilers are fine &mdash; it stays folded on the story page.</span>
          </label>
          <label>Where it stands
            <select name="status">
              ${CHOOSABLE_STORY_STATES.map((key) => `
                <option value="${key}"${key === status ? ' selected' : ''}>${escapeHtml(STORY_STATES[key].label)} &mdash; ${escapeHtml(STORY_STATES[key].hint)}</option>`).join('')}
            </select>
            <span class="hint">There is no &ldquo;on hiatus&rdquo; to pick: a story that has been ongoing with nothing new for six months says so on its own, and stops saying it the day you add a chapter.</span>
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
// The wiki's own categories are three different things at once -- what a
// page is, what it is about, what state its text is in -- so the index
// splits them apart instead of showing one 691-line list behind one row of
// chips. lib/glossary-taxonomy.js is where that split is decided; this file
// only draws it.

function glossaryIntro(totalPages) {
  return `<p class="muted">A local, offline copy of <a href="${escapeHtml(wiki.WIKI_BASE_URL)}" target="_blank" rel="noopener noreferrer">the shared-universe wiki</a> -- ${totalPages} page${totalPages === 1 ? '' : 's'}, kept here so nothing in this app has to reach out to the wiki to render a link.</p>`;
}

function glossarySearchForm(q, hidden = {}) {
  const fields = Object.entries(hidden)
    .filter(([, v]) => v)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(String(v))}">`)
    .join('');
  return `
    <form method="get" action="/glossary" class="inline-form glossary-search">
      <input type="search" name="q" id="glossary-filter" placeholder="Search the glossary..." value="${escapeHtml(q || '')}" autocomplete="off">
      ${fields}
      <button class="btn ghost small" type="submit">Search</button>
      ${q ? '<a class="btn ghost small" href="/glossary">Clear</a>' : ''}
    </form>`;
}

// The front page of the glossary: three doors for the three kinds of page,
// then the world's subjects as a printed directory rather than a chip
// soup. Nobody has to scroll 691 rows to find out what is in here.
function glossaryDirectoryPage({ user, totalPages = 0, kinds = { world: 0, stories: 0, authors: 0 }, families = [] }) {
  if (!totalPages) {
    return layout({
      title: 'Glossary',
      user,
      current: 'glossary',
      body: `
        <div class="page-head"><h1>Glossary</h1></div>
        <p class="muted">The glossary is empty -- an admin needs to sync the wiki from the ${user.is_admin ? '<a href="/admin">admin page</a>' : 'admin page'} first.</p>`,
    });
  }

  const door = (kind) => `
    <a class="glossary-door" href="/glossary?kind=${kind}">
      <span class="door-count">${kinds[kind] || 0}</span>
      <h2>${escapeHtml(taxonomy.KIND_LABELS[kind])}</h2>
      <p class="muted">${escapeHtml(taxonomy.KIND_BLURBS[kind])}</p>
    </a>`;

  const directory = families.map((family) => `
    <section class="family">
      <h3 class="family-head">${escapeHtml(family.name)} <span class="family-count">${family.total}</span></h3>
      <ul class="family-list">
        ${family.categories.map((c) => `
          <li><a href="/glossary?category=${encodeURIComponent(c.category)}">${escapeHtml(c.category)}</a> <span class="family-n">${c.n}</span></li>`).join('')}
      </ul>
    </section>`).join('');

  return layout({
    title: 'Glossary',
    user,
    current: 'glossary',
    body: `
      <div class="page-head"><h1>Glossary</h1></div>
      ${glossaryIntro(totalPages)}
      ${glossarySearchForm('')}
      <div class="glossary-doors">
        ${taxonomy.KINDS.map(door).join('')}
      </div>
      ${families.length ? `
        <section class="glossary-directory">
          <h2 class="directory-head">By subject</h2>
          <p class="muted">The wiki's own subject categories, gathered. A page can sit under several.</p>
          <div class="family-grid">${directory}</div>
        </section>` : ''}
      <p class="directory-foot"><a href="/glossary?view=all">Every page, A to Z (${totalPages})</a></p>`,
  });
}

function glossaryStatusFilters(counts, active, params) {
  if (!counts.length) return '';
  const href = (status) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, String(v));
    if (status) qs.set('status', status); else qs.delete('status');
    return `/glossary?${qs.toString()}`;
  };
  const chip = (label, n, target, current) => `
    <a class="tag-chip${current ? ' current' : ''}" href="${escapeHtml(href(target))}"${current ? ' aria-current="true"' : ''}>
      ${escapeHtml(label)}${n === null ? '' : ` <span class="tag-chip-count">${n}</span>`}
    </a>`;
  return `
    <div class="glossary-filters">
      <span class="filter-label">State</span>
      <div class="tag-chips">
        ${chip('Any', null, '', !active)}
        ${counts.map((c) => chip(c.category, c.n, c.category, c.category === active)).join('')}
      </div>
    </div>`;
}

// One listing -- a kind, a subject, a search or the lot -- always cut into
// A-Z sections with a jump bar, because 300 rows in one run is the thing
// that made the old index unreadable.
function glossaryListPage({
  user, pages = [], byPage = new Map(), heading = 'Glossary', q = '',
  kind = '', category = '', status = '', view = '', statusCounts = [], totalPages = 0,
}) {
  const letters = taxonomy.groupByLetter(pages);
  const present = new Set(letters.map((l) => l.letter));
  const jump = taxonomy.ALPHABET.map((letter) => (present.has(letter)
    ? `<a href="#letter-${letter === '#' ? 'num' : letter}" data-letter="${letter}">${letter}</a>`
    : `<span data-letter="${letter}">${letter}</span>`)).join('');

  const row = (p) => {
    const own = byPage.get(p.title_lower) || [];
    const topics = taxonomy.topicalCategories(own);
    const search = `${p.title} ${p.summary || ''}`.toLowerCase();
    return `
      <a class="chapter-row glossary-row" href="/glossary/${encodeURIComponent(p.title)}" data-search="${escapeHtml(search)}">
        <div class="chapter-row-main">
          <h3>${escapeHtml(p.title)}</h3>
          ${p.summary ? `<p class="muted">${escapeHtml(p.summary)}</p>` : ''}
          ${topics.length ? `<p class="entry-categories">${topics.map((c) => escapeHtml(c)).join(' &middot; ')}</p>` : ''}
        </div>
      </a>`;
  };

  const sections = letters.map((block) => `
    <section class="letter-block" id="letter-${block.letter === '#' ? 'num' : block.letter}" data-letter="${block.letter}">
      <h2 class="letter-mark" aria-hidden="true">${block.letter}</h2>
      <div class="chapter-list">${block.pages.map(row).join('')}</div>
    </section>`).join('');

  const count = `${pages.length} page${pages.length === 1 ? '' : 's'}`;
  // The heading already says which door this is, so only a category needs
  // spelling out in the line under it.
  const describe = category ? ` filed under ${escapeHtml(category)}` : '';

  return layout({
    title: heading,
    user,
    current: 'glossary',
    body: `
      <p class="breadcrumb"><a href="/glossary">&larr; Glossary</a></p>
      <div class="page-head"><h1>${escapeHtml(heading)}</h1></div>
      <p class="muted"><span id="glossary-count">${count}</span>${describe}${q ? ` matching &ldquo;${escapeHtml(q)}&rdquo;` : ''}${totalPages && pages.length !== totalPages ? ` &middot; <a href="/glossary?view=all">all ${totalPages}</a>` : ''}.</p>
      ${glossarySearchForm(q, { kind, category, status, view })}
      ${glossaryStatusFilters(statusCounts, status, { kind, category, view, q })}
      ${pages.length ? `
        <nav class="az-bar" aria-label="Jump to a letter">${jump}</nav>
        <div class="glossary-letters" id="glossary-list">${sections}</div>
        <p class="no-matches" id="glossary-no-matches" hidden>Nothing here matches.</p>`
    : '<p class="muted">Nothing here matches.</p>'}`,
  });
}

// Every internal link in a glossary entry points at another entry this
// app already has a summary of. The first time each one appears it gets
// marked, and the marked link is what the margin preview hangs off --
// later mentions of the same page are left alone, because eight cards
// saying the same thing about "Akarge" is not eight times the help.
function markFirstGlossaryLinks(html) {
  const seen = new Set();
  const marked = String(html || '').replace(/<a href="\/glossary\/([^"]+)"/g, (whole, encoded) => {
    let title;
    try { title = decodeURIComponent(encoded); } catch (e) { return whole; }
    const key = title.toLowerCase();
    if (seen.has(key)) return whole;
    seen.add(key);
    return `${whole} data-preview="${escapeHtml(key)}"`;
  });
  return { html: marked, titles: Array.from(seen) };
}

function glossaryPreviewCards(titles, summaries) {
  const cards = titles
    .map((key) => ({ key, entry: summaries.get(key) }))
    .filter((c) => c.entry && c.entry.summary)
    .map(({ key, entry }) => `
      <article class="glossary-preview" data-preview-for="${escapeHtml(key)}">
        <h3><a href="/glossary/${encodeURIComponent(entry.title)}">${escapeHtml(entry.title)}</a></h3>
        <p>${escapeHtml(entry.summary)}</p>
      </article>`);
  if (!cards.length) return '';
  return `<aside class="glossary-margin" aria-label="What the linked pages say">${cards.join('')}</aside>`;
}

// What a page is filed under, split the same way the index splits it: the
// subjects are links out to the rest of the glossary, the state of the page
// is a flat badge, and the wiki's housekeeping categories stay out of the
// reader's way entirely.
function entryChips(categories) {
  const topics = taxonomy.topicalCategories(categories);
  const states = taxonomy.statusCategories(categories);
  if (!topics.length && !states.length) return '';
  return `<div class="tag-chips entry-chips">
    ${topics.map((c) => `<a class="tag-chip" href="/glossary?category=${encodeURIComponent(c)}">${escapeHtml(c)}</a>`).join('')}
    ${states.map((c) => `<span class="tag-chip state-chip">${escapeHtml(c)}</span>`).join('')}
  </div>`;
}

function glossaryPage({ user, page, summaries = new Map(), categories = [] }) {
  // A page can be in the index (title + summary, from an older sync) with
  // no body yet, if the sync that stored it predates full-content syncing
  // or the most recent sync failed. Say so plainly instead of rendering an
  // empty sheet that reads like a broken page.
  const marked = markFirstGlossaryLinks(page.content_html);
  const body = page.content_html
    ? `<div class="glossary-content">${marked.html}</div>`
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
      ${entryChips(categories)}
      <div class="glossary-body">
        <div class="reading-pane">
          ${body}
        </div>
        ${glossaryPreviewCards(marked.titles, summaries)}
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

// ---------- the story bible ----------
// One per story: its people, places, groups, things and events. Not the
// glossary -- that mirrors the shared wiki and is read-only here. This is
// the author's own, and it is the only thing in the app that knows which
// chapters a character is actually in (see lib/story-bible.js).

const KIND_ORDER = bible.KINDS;

function entityKindLabel(kind) {
  return bible.KIND_LABELS[kind] || bible.KIND_LABELS[bible.DEFAULT_KIND];
}

function entityBadges(entity) {
  const bits = [];
  if (entity.role) bits.push(`<span class="ent-badge role-${entity.role}">${escapeHtml(bible.ROLE_LABELS[entity.role])}</span>`);
  if (entity.status) bits.push(`<span class="ent-badge status-${entity.status}">${escapeHtml(bible.STATUS_LABELS[entity.status])}</span>`);
  return bits.join('');
}

// "Chapters 3-11, 7 of them" says more in one line than either number
// does alone: the span is where they live in the story, the count is how
// much of it they are in.
function appearanceSummary(entity) {
  if (!entity.appearances) return '<span class="ent-none">Not named in any chapter</span>';
  if (entity.appearances === 1) return `Chapter ${entity.first_chapter}`;
  return `Chapters ${entity.first_chapter}&ndash;${entity.last_chapter} &middot; ${entity.appearances} of them`;
}

function entityRow(entity, coverId) {
  const search = `${entity.name} ${entity.summary || ''} ${entity.alias_list || ''}`.toLowerCase();
  return `
    <a class="chapter-row glossary-row${coverId ? ' has-cover' : ''}" href="/bible/${entity.id}" data-search="${escapeHtml(search)}">
      ${coverId ? `<img class="row-cover" src="/entity-images/${coverId}" alt="" loading="lazy">` : ''}
      <div class="chapter-row-main">
        <h3>${escapeHtml(entity.name)} ${entityBadges(entity)}</h3>
        ${entity.summary ? `<p class="muted">${escapeHtml(entity.summary)}</p>` : ''}
        ${entity.alias_list ? `<p class="entry-categories">a.k.a. ${escapeHtml(entity.alias_list)}</p>` : ''}
      </div>
      <div class="chapter-row-meta">
        <span>${appearanceSummary(entity)}</span>
        ${entity.link_count ? `<span>${entity.link_count} relation${entity.link_count === 1 ? '' : 's'}</span>` : ''}
      </div>
    </a>`;
}

function bibleConflictNotice(conflicts) {
  if (!conflicts.length) return '';
  return `
    <div class="bible-conflicts">
      <p><strong>${conflicts.length} name${conflicts.length === 1 ? ' is' : 's are'} shared by more than one entry.</strong>
      A shared name is counted for nobody, because guessing which of them a chapter meant would put people in scenes they are not in. Give one of them a distinguishing alias and the appearances come back.</p>
      <ul>
        ${conflicts.map((c) => `<li><strong>${escapeHtml(c.name)}</strong> &mdash; ${c.entities.map((e) => `<a href="/bible/${e.id}">${escapeHtml(e.name)}</a>`).join(', ')}</li>`).join('')}
      </ul>
    </div>`;
}

const SORT_LABELS = {
  name: 'A to Z', appearances: 'Most present', role: 'By role', recent: 'Lately changed',
};

function bibleSortBar(story, kind, sort) {
  const href = (value) => {
    const qs = new URLSearchParams();
    if (kind) qs.set('kind', kind);
    if (value !== 'name') qs.set('sort', value);
    const tail = qs.toString();
    return `/stories/${story.id}/bible${tail ? `?${tail}` : ''}`;
  };
  return `
    <div class="glossary-filters">
      <span class="filter-label">Order</span>
      <div class="tag-chips">
        ${Object.keys(SORT_LABELS).map((value) => `
          <a class="tag-chip${value === sort ? ' current' : ''}" href="${escapeHtml(href(value))}"${value === sort ? ' aria-current="true"' : ''}>${escapeHtml(SORT_LABELS[value])}</a>`).join('')}
      </div>
    </div>`;
}

// Who can read this bible, said plainly, with the switch beside it for
// whoever gets to decide. A coauthor sees the state and not the switch:
// they write in the bible, but whether it is anybody else's business is
// the story's to say, and the story has one owner.
function biblePrivacyBlock(story, isOwner) {
  // The owner's, and nobody else's -- not the switch, and not the state
  // it is in. A coauthor writes in the bible; who else may read it is the
  // one thing about it that is not theirs to see or to set.
  if (!isOwner) return '';
  const isPrivate = !!story.bible_private;
  const line = isPrivate
    ? 'Only the people who write this story can see it, and its names do not link in the chapters.'
    : 'Anyone who can read the story can read its bible.';
  return `
    <form method="post" action="/stories/${story.id}/bible/privacy" class="bible-privacy inline-form">
      <span class="ent-badge${isPrivate ? ' status-private' : ''}">${isPrivate ? 'Private' : 'Open'}</span>
      <span class="muted">${line}</span>
      <input type="hidden" name="visibility" value="${isPrivate ? 'open' : 'private'}">
      <button class="btn ghost small" type="submit">${isPrivate ? 'Open it to readers' : 'Make it private'}</button>
    </form>`;
}

function bibleIndexPage({
  user, story, entities = [], counts = {}, total = 0, kind = '', canWrite = false,
  conflicts = [], notice = '', covers = new Map(), sort = 'name', isOwner = false,
}) {
  const door = (k) => `
    <a class="glossary-door${k === kind ? ' current' : ''}" href="/stories/${story.id}/bible?kind=${k}">
      <span class="door-count">${counts[k] || 0}</span>
      <h2>${escapeHtml(bible.KIND_PLURALS[k])}</h2>
      <p class="muted">${escapeHtml(bible.KIND_BLURBS[k])}</p>
    </a>`;

  const list = entities.length
    ? `<div class="chapter-list" id="glossary-list">${entities.map((e) => entityRow(e, covers.get(e.id))).join('')}</div>
       <p class="no-matches" id="glossary-no-matches" hidden>Nothing here matches.</p>`
    : emptyState({
      art: 'sheets',
      title: total ? 'Nothing of that kind yet' : 'The bible is empty',
      body: total
        ? 'Every entry is filed under one kind. Nothing has been filed under this one yet.'
        : 'This is where the people, places and things of the story live -- who they are, who they know, and which chapters they turn up in. The chapters are worked out from the text itself, so an entry starts paying for itself the moment you write it down.',
      action: canWrite ? `<a class="btn" href="/stories/${story.id}/bible/new">${ICONS.plus}Add the first entry</a>` : '',
    });

  return layout({
    title: `Bible &middot; ${story.title}`,
    user,
    body: `
      <p class="breadcrumb"><a href="/stories/${story.id}">&larr; ${escapeHtml(story.title)}</a></p>
      <div class="page-head">
        <div>
          <h1>Story bible</h1>
          <p class="muted">The people, places and things of <a href="/stories/${story.id}">${escapeHtml(story.title)}</a> &mdash; ${total} entr${total === 1 ? 'y' : 'ies'}. Which chapters each one appears in is read out of the chapters themselves, every time they change.</p>
        </div>
        <div class="page-head-actions">
          ${canWrite ? `<a class="btn" href="/stories/${story.id}/bible/new">${ICONS.plus}New entry</a>` : ''}
          ${canWrite ? `
            <form method="post" action="/stories/${story.id}/bible/rescan" class="inline-form">
              <button class="btn ghost small" type="submit">Rescan chapters</button>
            </form>` : ''}
        </div>
      </div>
      ${notice ? `<p class="flash info">${escapeHtml(notice)}</p>` : ''}
      ${biblePrivacyBlock(story, isOwner)}
      ${bibleConflictNotice(conflicts)}
      ${total ? `
        <div class="glossary-doors bible-doors">${KIND_ORDER.map(door).join('')}</div>
        <form method="get" action="/stories/${story.id}/bible" class="inline-form glossary-search">
          <input type="search" id="glossary-filter" name="q" placeholder="Filter by name, alias or summary..." autocomplete="off">
          ${kind ? `<input type="hidden" name="kind" value="${escapeHtml(kind)}">` : ''}
          <button class="btn ghost small" type="submit">Filter</button>
          ${kind ? `<a class="btn ghost small" href="/stories/${story.id}/bible">Everything</a>` : ''}
        </form>
        ${bibleSortBar(story, kind, sort)}
        <p class="muted"><span id="glossary-count">${entities.length} entr${entities.length === 1 ? 'y' : 'ies'}</span>${kind ? ` &middot; ${escapeHtml(bible.KIND_PLURALS[kind])}` : ''}.</p>` : ''}
      ${list}`,
  });
}

function entityAppearanceList(entity, appearances, chapters, canWrite) {
  const shown = appearances.filter((a) => !a.archived_at);
  const first = shown.length ? shown[0].chapter_number : null;
  const rows = shown.length ? shown.map((a) => `
    <li>
      <a href="/chapters/${a.chapter_id}">Chapter ${a.chapter_number}: ${escapeHtml(a.title)}</a>
      ${a.chapter_number === first ? '<span class="ent-badge first-here">First</span>' : ''}
      <span class="ent-mentions">${a.source === 'manual'
        ? 'added by hand'
        : `${a.mentions} mention${a.mentions === 1 ? '' : 's'}${a.first_name && a.first_name.toLowerCase() !== entity.name.toLowerCase() ? ` as &ldquo;${escapeHtml(a.first_name)}&rdquo;` : ''}`}</span>
    </li>`).join('') : '<li class="ent-none">Not named in any chapter yet.</li>';

  const inChapter = new Set(shown.map((a) => a.chapter_id));
  const editor = canWrite && chapters.length ? `
    <details class="appearance-editor">
      <summary>Correct this</summary>
      <p class="muted">The scan only sees names. Somebody present but never named is missed; a name that is also a ship or a common word is found too often. Tick what the text got wrong -- your correction survives every rescan.</p>
      <form method="post" action="/bible/${entity.id}/appearances">
        <ul class="appearance-ticks">
          ${chapters.filter((c) => !c.archived_at).map((c) => `
            <li>
              <label class="tick">
                <input type="checkbox" name="chapter" value="${c.id}" ${inChapter.has(c.id) ? 'checked' : ''}>
                <span>Chapter ${c.chapter_number}: ${escapeHtml(c.title)}</span>
              </label>
            </li>`).join('')}
        </ul>
        <button class="btn ghost small" type="submit">Save appearances</button>
      </form>
    </details>` : '';

  return `<ul class="appearance-list">${rows}</ul>${editor}`;
}

function entityRelationBlock(entity, links, others, canWrite) {
  const rows = links.length ? links.map((l) => `
    <li>
      <div class="rel-main">
        <span class="rel-label">${l.label ? escapeHtml(l.label) : 'related to'}</span>
        <a href="/bible/${l.other_id}">${escapeHtml(l.other_name)}</a>
        <span class="rel-kind">${escapeHtml(entityKindLabel(l.other_kind))}</span>
      </div>
      ${canWrite ? `
        <form method="post" action="/bible/${entity.id}/links/${l.id}/delete" class="inline-form rel-remove">
          <button class="btn ghost tiny" type="submit">Remove</button>
        </form>` : ''}
    </li>`).join('') : '<li class="ent-none">Nobody yet.</li>';

  const form = canWrite && others.length ? `
    <form method="post" action="/bible/${entity.id}/links" class="relation-form">
      <label>Relation
        <input type="text" name="label" placeholder="sister of, serves under, owns..." maxlength="80">
      </label>
      <label>To
        <select name="to">
          ${others.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}
        </select>
      </label>
      <label>Called back the other way
        <input type="text" name="reverse_label" placeholder="leave blank if it reads the same both ways" maxlength="80">
      </label>
      <button class="btn ghost small" type="submit">Add relation</button>
    </form>` : '';

  return `<ul class="relation-list">${rows}</ul>${form}`;
}

// The gallery. The first picture is the entry's face -- in the index, at
// the top of its own page -- so "make this the portrait" is just "move it
// to the front", and there is no second concept to keep in step.
function entityImageBlock(entity, images, canWrite) {
  const figures = images.map((image, i) => `
    <figure class="entity-figure">
      <a href="/entity-images/${image.id}" target="_blank" rel="noopener noreferrer">
        <img src="/entity-images/${image.id}" alt="${escapeHtml(image.caption || entity.name)}" loading="lazy">
      </a>
      ${i === 0 ? '<span class="cover-flag">Cover</span>' : ''}
      <figcaption>
        ${canWrite ? `
          <form method="post" action="/bible/${entity.id}/images/${image.id}/caption" class="caption-form">
            <input type="text" name="caption" value="${escapeHtml(image.caption)}" placeholder="Caption" maxlength="240">
            <button class="btn ghost tiny" type="submit">Save</button>
          </form>
          <div class="figure-actions">
            ${i > 0 ? `<form method="post" action="/bible/${entity.id}/images/${image.id}/up" class="inline-form"><button class="btn ghost tiny" type="submit">&larr; Earlier</button></form>` : ''}
            ${i < images.length - 1 ? `<form method="post" action="/bible/${entity.id}/images/${image.id}/down" class="inline-form"><button class="btn ghost tiny" type="submit">Later &rarr;</button></form>` : ''}
            <form method="post" action="/bible/${entity.id}/images/${image.id}/delete" class="inline-form"><button class="btn ghost tiny danger" type="submit">Remove</button></form>
          </div>`
    : (image.caption ? escapeHtml(image.caption) : '')}
      </figcaption>
    </figure>`).join('');

  const adder = canWrite && images.length < bibleImages.MAX_IMAGES_PER_ENTRY ? `
    <form method="post" action="/bible/${entity.id}/images" enctype="multipart/form-data" class="image-form">
      <label>Add a picture
        <input type="file" name="image" accept="${bibleImages.ACCEPT_ATTRIBUTE}" data-shrink required>
      </label>
      <label>Caption <input type="text" name="caption" maxlength="240" placeholder="Optional"></label>
      <button class="btn ghost small" type="submit">Upload</button>
      <span class="hint">PNG, JPEG, GIF or WebP. Large pictures are shrunk in your browser before they are sent, so nothing waits on the upload.</span>
    </form>` : '';

  if (!figures && !adder) return '';
  return `
    <section class="entity-pictures" id="pictures">
      <h2 class="side-head">Pictures</h2>
      ${figures ? `<div class="figure-strip">${figures}</div>` : '<p class="ent-none">None yet.</p>'}
      ${adder}
    </section>`;
}

// The custom fields on an entry's page: what the template asked for, in
// its order, then whatever else this one entry needed. Blanks are not
// shown -- an unanswered question belongs in the form, not on the page.
function entityFieldList(fields) {
  if (!fields.length) return '';
  return `
    <section class="entity-fields">
      <h2 class="side-head">Details</h2>
      <dl class="field-list">
        ${fields.map((f) => `
          <div><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd></div>`).join('')}
      </dl>
    </section>`;
}

// One block per kind, all but the current one hidden. With JavaScript the
// block follows the "What is it" select; without it, the hidden ones stay
// hidden and you get the fields for the kind the entry actually is, which
// is the right answer anyway.
function fieldTemplateBlocks(templates, fields, currentKind) {
  return bible.KINDS.map((kind) => {
    const rows = bible.fieldRows(templates[kind] || [], kind === currentKind ? fields : [], 0);
    if (!rows.length) return '';
    return `
      <div class="template-fields" data-kind="${kind}"${kind === currentKind ? '' : ' hidden'}>
        ${rows.map((row) => `
          <label class="field-row">
            <span class="field-name">${escapeHtml(row.label)}</span>
            <input type="hidden" name="fieldLabel" value="${escapeHtml(row.label)}"${kind === currentKind ? '' : ' disabled'}>
            <input type="text" name="fieldValue" value="${escapeHtml(row.value)}" maxlength="${bible.MAX_FIELD_VALUE}"${kind === currentKind ? '' : ' disabled'}>
          </label>`).join('')}
      </div>`;
  }).join('');
}

function entityFieldFieldset({ templates, fields, currentKind, usedLabels }) {
  const template = templates[currentKind] || [];
  const inTemplate = new Set(template.map((l) => l.toLowerCase()));
  const extras = (fields || []).filter((f) => !inTemplate.has(f.label.toLowerCase()));
  const blank = (label = '', value = '') => `
    <div class="field-pair">
      <input type="text" name="fieldLabel" value="${escapeHtml(label)}" list="known-field-labels" placeholder="Field" maxlength="${bible.MAX_FIELD_LABEL}">
      <input type="text" name="fieldValue" value="${escapeHtml(value)}" placeholder="Value" maxlength="${bible.MAX_FIELD_VALUE}">
    </div>`;
  return `
    <div class="writer-section">
      <p class="writer-section-label">Details</p>
      <p class="hint">Whatever this story needs written down: a rank, a class, a home world, a colour of eyes. Fields the whole story shares are set once, <a href="#field-template">as a template per kind</a>; anything below that is this entry's own.</p>
      ${fieldTemplateBlocks(templates, fields, currentKind)}
      <div class="field-extras" id="field-extras">
        ${extras.map((f) => blank(f.label, f.value)).join('')}
        ${blank()}${blank()}${blank()}
      </div>
      <button class="btn ghost tiny" type="button" data-add-field>Another field</button>
      <datalist id="known-field-labels">
        ${(usedLabels || []).map((l) => `<option value="${escapeHtml(l)}"></option>`).join('')}
      </datalist>
    </div>`;
}

// The template editor: one box per kind, one label per line. A short
// ordered list is easier to rewrite than to edit row by row, and
// rewriting it is also how it gets reordered.
function fieldTemplatePage({ user, story, templates = {}, notice = '' }) {
  return layout({
    title: `Fields &middot; ${story.title}`,
    user,
    body: `
      <p class="breadcrumb"><a href="/stories/${story.id}/bible">&larr; ${escapeHtml(story.title)} bible</a></p>
      <div class="writer-card">
        <h1>What every entry says</h1>
        <p class="muted writer-intro">The fields the form should ask for, per kind. Every person gets a Rank and a Home world; every ship a Class. One label per line, in the order you want them asked.</p>
        <p class="muted">Taking a label out never deletes what an entry already said under it -- it just stops being asked for, and stays on the entries that answered it.</p>
        ${notice ? `<p class="flash info">${escapeHtml(notice)}</p>` : ''}
        <form method="post" action="/stories/${story.id}/bible/fields" class="chapter-form">
          ${bible.KINDS.map((kind) => `
            <label>${escapeHtml(bible.KIND_PLURALS[kind])}
              <textarea name="${kind}" rows="5" placeholder="One label per line">${escapeHtml((templates[kind] || []).join('\n'))}</textarea>
            </label>`).join('')}
          <div class="writer-actions">
            <a class="btn ghost" href="/stories/${story.id}/bible">Cancel</a>
            <button class="btn" type="submit">Save the template</button>
          </div>
        </form>
      </div>`,
  });
}

function entityPage({
  user, story, entity, aliases = [], links = [], appearances = [], chapters = [],
  others = [], images = [], fields = [], canWrite = false, error = '',
}) {
  return layout({
    title: entity.name,
    user,
    body: `
      <p class="breadcrumb"><a href="/stories/${story.id}/bible">&larr; ${escapeHtml(story.title)} bible</a></p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <div class="page-head entity-head">
        <div class="entity-head-main">
          ${images.length ? `<img class="entity-portrait" src="/entity-images/${images[0].id}" alt="${escapeHtml(images[0].caption || entity.name)}">` : ''}
          <div>
          <h1>${escapeHtml(entity.name)} ${entityBadges(entity)}</h1>
          <p class="muted">${escapeHtml(entityKindLabel(entity.kind))}${aliases.length ? ` &middot; also ${aliases.map((a) => escapeHtml(a)).join(', ')}` : ''}</p>
          ${entity.summary ? `<p class="summary">${escapeHtml(entity.summary)}</p>` : ''}
          </div>
        </div>
        <div class="page-head-actions">
          ${canWrite ? `<a class="btn ghost small" href="/bible/${entity.id}/edit">Edit</a>` : ''}
        </div>
      </div>
      <div class="entity-grid">
        <div class="entity-main">
          ${entity.description ? `<div class="reading-pane entity-description">${renderHighlighted(parseMarkdown(entity.description), [], null)}</div>`
    : '<p class="muted">No description yet.</p>'}
          ${entity.secret ? `
            <details class="entity-secret">
              <summary>Spoilers &mdash; what the reader does not know yet</summary>
              <div class="reading-pane">${renderHighlighted(parseMarkdown(entity.secret), [], null)}</div>
            </details>` : ''}
          ${entityImageBlock(entity, images, canWrite)}
        </div>
        <aside class="entity-side">
          ${entityFieldList(fields)}
          <section>
            <h2 class="side-head">Appears in</h2>
            ${entityAppearanceList(entity, appearances, chapters, canWrite)}
          </section>
          <section>
            <h2 class="side-head">Related</h2>
            ${entityRelationBlock(entity, links, others, canWrite)}
          </section>
        </aside>
      </div>
      ${canWrite ? `
        <form method="post" action="/bible/${entity.id}/delete" class="inline-form danger-form">
          <button class="btn ghost small danger" type="submit">Delete this entry</button>
        </form>` : ''}`,
  });
}

function entityFormPage({ user, story, entity = null, aliases = [], fields = [], templates = {}, usedLabels = [], error = '' }) {
  const value = (field) => escapeHtml(entity ? entity[field] || '' : '');
  const selected = (field, option) => ((entity ? entity[field] : '') === option ? ' selected' : '');
  return layout({
    title: entity ? `Edit ${entity.name}` : 'New bible entry',
    user,
    body: `
      <p class="breadcrumb"><a href="${entity ? `/bible/${entity.id}` : `/stories/${story.id}/bible`}">&larr; Back</a></p>
      <div class="writer-card">
      <h1>${entity ? `Edit ${escapeHtml(entity.name)}` : 'New bible entry'}</h1>
      <p class="muted writer-intro">An entry is for you, not the reader: who this is, who they know, and which chapters they turn up in. The chapters are worked out from the text -- you only write the rest.</p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <form method="post" action="${entity ? `/bible/${entity.id}` : `/stories/${story.id}/bible`}" class="chapter-form entity-form">
        <label>Name
          <input type="text" name="name" value="${value('name')}" maxlength="${bible.MAX_NAME_LENGTH}" required autofocus>
        </label>
        <label>What is it
          <select name="kind">
            ${bible.KINDS.map((k) => `<option value="${k}"${selected('kind', k)}>${escapeHtml(bible.KIND_LABELS[k])}</option>`).join('')}
          </select>
        </label>
        <label>Also called
          <textarea name="aliases" rows="2" placeholder="One per line, or separated by commas. Ranks, nicknames, maiden names -- anything the prose calls them.">${escapeHtml(aliases.join('\n'))}</textarea>
        </label>
        <span class="hint">Aliases are how the chapter scan finds them: a chapter that only ever says "the Old Man" still counts as an appearance.</span>
        <label>One line
          <input type="text" name="summary" value="${value('summary')}" maxlength="240" placeholder="The sentence you would say if somebody asked who this was.">
        </label>
        <div class="entity-form-row">
          <label>Role
            <select name="role">
              ${bible.ROLES.map((r) => `<option value="${r}"${selected('role', r)}>${escapeHtml(bible.ROLE_LABELS[r])}</option>`).join('')}
            </select>
          </label>
          <label>Status
            <select name="status">
              ${bible.STATUSES.map((s2) => `<option value="${s2}"${selected('status', s2)}>${escapeHtml(bible.STATUS_LABELS[s2])}</option>`).join('')}
            </select>
          </label>
        </div>
        ${entityFieldFieldset({
    templates, fields, usedLabels,
    currentKind: (entity && entity.kind) || bible.DEFAULT_KIND,
  })}
        <label>Description
          <textarea name="description" rows="14" placeholder="Who they are, what they want, how they talk, what they look like. Markdown works here, and so do links to other chapters.">${value('description')}</textarea>
        </label>
        <label>Spoilers
          <textarea name="secret" rows="6" placeholder="What you know and the reader does not -- kept folded away on the entry page.">${value('secret')}</textarea>
        </label>
        <div class="writer-actions">
          <button class="btn" type="submit">${entity ? 'Save' : 'Create entry'}</button>
          <a class="btn ghost" href="${entity ? `/bible/${entity.id}` : `/stories/${story.id}/bible`}">Cancel</a>
        </div>
      </form>
      <p class="muted" id="field-template"><a href="/stories/${story.id}/bible/fields">Set the fields every entry of a kind is asked for &rarr;</a></p>
      </div>`,
  });
}

// Names the chapter uses that the bible has never heard of. A suggestion,
// not a decision: one click writes the entry, and the entry is a stub with
// the name in it, which is the part that was stopping anybody.
function missingNamesBlock(names, storyId, returnTo) {
  if (!names.length) return '';
  return `
    <section class="missing-names">
      <h2 class="side-head">${names.length} name${names.length === 1 ? '' : 's'} here ${names.length === 1 ? 'is' : 'are'} not in the bible</h2>
      <p class="muted">Proper names this chapter uses that no entry, glossary page or dictionary word accounts for. Guesswork, so some of it will be wrong -- take what is useful.</p>
      <ul class="missing-list">
        ${names.map((n) => `
          <li>
            <form method="post" action="/stories/${storyId}/bible/quick" class="inline-form">
              <input type="hidden" name="name" value="${escapeHtml(n.name)}">
              <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
              <span class="missing-name">${escapeHtml(n.name)}</span>
              <span class="missing-count">${n.count}&times;</span>
              <select name="kind" aria-label="What ${escapeHtml(n.name)} is">
                ${bible.KINDS.map((k) => `<option value="${k}">${escapeHtml(bible.KIND_LABELS[k])}</option>`).join('')}
              </select>
              <button class="btn ghost tiny" type="submit">Add</button>
            </form>
          </li>`).join('')}
      </ul>
    </section>`;
}

// The same thing inside the editor, where the text is not saved yet: the
// panel asks the server about the draft in the textarea, so there is one
// implementation of what counts as a name rather than a second one in
// JavaScript drifting away from the first.
function editorBiblePanel(chapter) {
  return `
    <aside class="editor-bible" id="editor-bible" data-story-id="${chapter.story_id}">
      <h2 class="side-head">Bible</h2>
      <p class="muted">Somebody new turned up mid-scene? Write them down here without leaving the chapter.</p>
      <form class="quick-entry" data-quick-entry>
        <input type="text" name="name" placeholder="Name" maxlength="${bible.MAX_NAME_LENGTH}" required>
        <select name="kind">
          ${bible.KINDS.map((k) => `<option value="${k}">${escapeHtml(bible.KIND_LABELS[k])}</option>`).join('')}
        </select>
        <input type="text" name="summary" placeholder="One line (optional)" maxlength="240">
        <button class="btn ghost small" type="submit">Add to the bible</button>
      </form>
      <p class="quick-result" data-quick-result hidden></p>
      <div class="editor-missing">
        <button class="btn ghost small" type="button" data-scan-names>Names in this draft</button>
        <div data-missing-list></div>
      </div>
      <p class="muted"><a href="/stories/${chapter.story_id}/bible" target="_blank" rel="noopener noreferrer">The whole bible &rarr;</a></p>
    </aside>`;
}

// The cast of one chapter, shown on the chapter page. Reading a chapter
// six months after writing it, this is the line that saves you.
function chapterCastBlock(entities, storyId) {
  if (!entities.length) return '';
  return `
    <section class="chapter-cast">
      <h2 class="side-head">In this chapter</h2>
      <ul class="cast-line">
        ${entities.map((e) => `<li><a href="/bible/${e.id}">${escapeHtml(e.name)}</a>${
  e.first_chapter != null && e.first_chapter === e.this_chapter ? '<span class="ent-badge first-here">New here</span>' : ''
}${e.summary ? `<span class="cast-note">${escapeHtml(e.summary)}</span>` : ''}</li>`).join('')}
      </ul>
      <p class="muted"><a href="/stories/${storyId}/bible">The whole bible &rarr;</a></p>
    </section>`;
}

// ---------- help and the changelog (see lib/docs.js) ----------
// Two pages of writing about the app rather than in it. They are markdown
// files in docs/, rendered with the same parser chapters use, so a how-to
// is written the way everything else here is written.

// A release is dated to the day, not to an instant, so it is written out
// plainly rather than through timeHtml -- there is no "3h ago" to be had
// from a date, and no clock reading to localise.
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function releaseDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return escapeHtml(String(iso || ''));
  return `${MONTH_NAMES[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// Prose and pictures alternate; the prose goes through the same renderer
// chapters use, and the pictures never touch it (see lib/docs.js for why).
function docBody(markdown) {
  const parts = docs.splitFigures(markdown).map((part) => (part.type === 'figure'
    ? `<figure class="doc-figure">
         <img src="${escapeHtml(part.src)}" alt="${escapeHtml(part.caption)}" loading="lazy">
         ${part.caption ? `<figcaption>${escapeHtml(part.caption)}</figcaption>` : ''}
       </figure>`
    : renderHighlighted(parseMarkdown(part.value), [], null))).join('');
  return `<div class="reading-pane doc-body">${parts}</div>`;
}

function helpIndexPage({ user, topics = [], releases = [], unread = false }) {
  const rows = topics.map((t) => `
    <a class="chapter-row" href="/help/${escapeHtml(t.slug)}">
      <div class="chapter-row-main">
        <h3>${escapeHtml(t.title)}</h3>
        ${t.summary ? `<p class="muted">${escapeHtml(t.summary)}</p>` : ''}
      </div>
    </a>`).join('');
  const latest = releases[0];
  return layout({
    title: 'Help',
    user,
    current: 'help',
    body: `
      <div class="page-head"><h1>How to</h1></div>
      <p class="muted">What each part of the site is for, and how to get it to do what you want. Nothing here is a manual you have to read: take the one page you need and close the rest.</p>
      <div class="chapter-list">${rows || '<p class="muted">No how-tos yet.</p>'}</div>
      ${latest ? `
        <a class="chapter-row changelog-row" href="/help/changelog">
          <div class="chapter-row-main">
            <h3>What's new ${unread ? '<span class="badge new">New</span>' : ''}</h3>
            <p class="muted">Every change to the site, newest first. Latest: ${escapeHtml(latest.heading || latest.date)}.</p>
          </div>
          <div class="chapter-row-meta"><span>${releaseDate(latest.date)}</span></div>
        </a>` : ''}`,
  });
}

function helpTopicPage({ user, topic, topics = [] }) {
  const index = topics.findIndex((t) => t.slug === topic.slug);
  const previous = index > 0 ? topics[index - 1] : null;
  const next = index >= 0 && index < topics.length - 1 ? topics[index + 1] : null;
  return layout({
    title: topic.title,
    user,
    current: 'help',
    body: `
      <p class="breadcrumb"><a href="/help">&larr; How to</a></p>
      <div class="page-head"><h1>${escapeHtml(topic.title)}</h1></div>
      ${docBody(topic.body || topic.markdown)}
      <nav class="doc-nav">
        ${previous ? `<a href="/help/${escapeHtml(previous.slug)}">&larr; ${escapeHtml(previous.title)}</a>` : '<span></span>'}
        ${next ? `<a href="/help/${escapeHtml(next.slug)}">${escapeHtml(next.title)} &rarr;</a>` : '<span></span>'}
      </nav>`,
  });
}

// Releases the reader has not seen are marked rather than hidden: the
// point of a changelog is that you can also read the ones you have.
function changelogPage({ user, releases = [], seenAt = null }) {
  const isNew = (release) => !seenAt || release.date > String(seenAt).slice(0, 10);
  const sections = releases.map((release) => `
    <section class="release${isNew(release) ? ' unseen' : ''}">
      <h2 class="release-head">
        <span class="release-date">${releaseDate(release.date)}</span>
        ${release.heading ? `<span class="release-title">${escapeHtml(release.heading)}</span>` : ''}
        ${isNew(release) ? '<span class="badge new">New to you</span>' : ''}
      </h2>
      ${docBody(release.markdown)}
    </section>`).join('');
  return layout({
    title: "What's new",
    user,
    current: 'help',
    body: `
      <p class="breadcrumb"><a href="/help">&larr; How to</a></p>
      <div class="page-head"><h1>What's new</h1></div>
      <p class="muted">Every change to the site, newest first, in plain language. Anything published since you last looked is marked. The dates are when the work was done -- if something here is missing on the site, it has not been restarted yet.</p>
      ${sections || '<p class="muted">Nothing recorded yet.</p>'}`,
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

// What the chapter is asking for, and whether it opens an arc. Both live
// in the same fold as the summary and the upload: they are things you set
// once in a while, not things you fill in to publish.
function stageField(selectedValue) {
  const selected = CHAPTER_STAGES.includes(selectedValue) ? selectedValue : DEFAULT_CHAPTER_STAGE;
  return `
    <label>What this chapter wants
      <select name="stage">
        ${CHAPTER_STAGES.map((key) => `
          <option value="${key}"${key === selected ? ' selected' : ''}>${escapeHtml(CHAPTER_STAGE_META[key].label)} &mdash; ${escapeHtml(CHAPTER_STAGE_META[key].hint)}</option>`).join('')}
      </select>
      <span class="hint">Only shows on the story's contents when it is not the usual one.</span>
    </label>`;
}

function arcField(selectedValue) {
  return `
    <label>Starts an arc (optional)
      <input type="text" name="arcTitle" value="${escapeHtml(selectedValue || '')}" maxlength="80" placeholder="e.g. Book Two: The long winter">
      <span class="hint">Name the arc this chapter opens, and the story's contents group everything from here to the next named chapter under it. Leave it empty on every chapter that just carries on.</span>
    </label>`;
}

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
            ${stageField(values.stage)}
            ${arcField(values.arcTitle)}
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

/** @param {{ user: Row, chapter: Row, latestContent: string, comments?: Row[], error?: string|null, canWrite?: boolean, values?: FormValues }} props */
function editChapterPage({ user, chapter, latestContent, comments = [], error, canWrite = true, values = /** @type {FormValues} */ ({}) }) {
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
          ${stageField(values.stage ?? chapter.stage)}
          ${arcField(values.arcTitle ?? chapter.arc_title)}
          <label>What changed? (shown in the version history)<input type="text" name="changelog" value="${escapeHtml(values.changelog || '')}" placeholder="e.g. Fixed a couple of typos"></label>
        </div>
        <div class="writer-actions">
          <a class="btn ghost" href="/chapters/${chapter.id}">Cancel</a>
          <button class="btn" type="submit">Save changes</button>
        </div>
      </form>
      ${canWrite ? editorBiblePanel(chapter) : ''}
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

// A name is a way to the person it belongs to, wherever their handle
// came along with it. Where it did not (an older query that only selects
// display_name), it stays plain text rather than guessing a URL.
function personLink(username, name) {
  return username
    ? `<a href="/users/${escapeHtml(username)}">${escapeHtml(name)}</a>`
    : escapeHtml(name);
}

// Reads "by Ana", "by Ana with Luis", "by Ana with Luis and Marta",
// "by Ana with Luis, Marta and Sergio" -- a byline, not a field listing.
function bylineWith(authorName, coauthors, authorUsername = null) {
  const names = (coauthors || []).map((c) => personLink(c.username, c.display_name));
  const base = `by ${personLink(authorUsername, authorName)}`;
  if (!names.length) return base;
  if (names.length === 1) return `${base} with ${names[0]}`;
  return `${base} with ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
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

// The shape of the story at a glance: how much there is, how long it takes,
// how much of it is waiting on somebody.
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

function synopsisSection(story) {
  if (!story.synopsis) return '';
  return `
    <details class="story-synopsis">
      <summary>Synopsis &mdash; what happens so far <span class="muted">(spoilers)</span></summary>
      <div class="prose">${renderHighlighted(parseMarkdown(story.synopsis), [], null)}</div>
    </details>`;
}

// Who has been through a chapter, and whether it was this draft or an
// earlier one. Stated plainly, because the reading is recorded by opening
// the page and anything grander than "opened it" would be a claim the app
// cannot support.
function readersLine(readers, currentVersionNumber) {
  if (!readers || !readers.length) return '<span class="readers none">Nobody has opened this yet</span>';
  const current = readers.filter((r) => r.version_number >= currentVersionNumber);
  const earlier = readers.filter((r) => r.version_number < currentVersionNumber);
  const names = (list) => list.map((r) => escapeHtml(r.display_name)).join(', ');
  const parts = [];
  if (current.length) parts.push(`Read by ${names(current)}`);
  if (earlier.length) {
    parts.push(`${current.length ? '' : 'Read by '}${names(earlier)} <span class="readers-note">(an earlier draft)</span>`);
  }
  return `<span class="readers">${parts.join(' &middot; ')}</span>`;
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

// The badge that says where a story is. The three chosen states are ink
// or grey; only the one nobody chose -- six months of silence -- gets the
// red, because it is the only one that is news.
function storyStateBadge(story) {
  const state = storyState(story);
  const meta = STORY_STATES[state];
  if (!meta) return '';
  return `<span class="state-badge state-${state}" title="${escapeHtml(meta.hint)}">${escapeHtml(meta.label)}</span>`;
}

// A chapter says what it wants only when it wants something other than
// the usual. Fifteen rows all saying "wants notes" is not information.
function chapterStageBadge(chapter) {
  const stage = chapter.stage || DEFAULT_CHAPTER_STAGE;
  if (stage === DEFAULT_CHAPTER_STAGE) return '';
  const meta = CHAPTER_STAGE_META[stage];
  if (!meta) return '';
  return `<span class="state-badge stage-${stage}" title="${escapeHtml(meta.hint)}">${escapeHtml(meta.label)}</span>`;
}

// An arc is the stretch from the chapter that names it to the chapter
// that names the next one. Chapters before the first named one are not an
// arc and get no heading -- a story that never mentions arcs reads
// exactly as it did before this existed.
function groupChaptersIntoArcs(chapters) {
  const groups = [];
  for (const chapter of chapters) {
    const name = (chapter.arc_title || '').trim();
    if (name || !groups.length) {
      groups.push({ title: name, chapters: [chapter] });
    } else {
      groups[groups.length - 1].chapters.push(chapter);
    }
  }
  return groups;
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

function storyPage({ user, story, chapters, isStoryAuthor, canWrite = false, dictionary = [], tags = [], coauthors = [], addableCoauthors = [], stats = null, readersByChapter = new Map(), bibleCount = 0, bibleVisible = true }) {
  const chapterRow = (c, i) => `
    <div class="chapter-row-outer">
      <a class="chapter-row" href="/chapters/${c.id}">
        <div class="chapter-row-main">
          <h3>Chapter ${c.chapter_number}: ${escapeHtml(c.title)}
            ${c.is_new ? '<span class="badge new">New</span>' : (c.has_new_comments ? '<span class="badge new-comments">New comments</span>' : '')}
            ${chapterStageBadge(c)}
          </h3>
          <p class="muted">${escapeHtml(c.summary || '')}</p>
        </div>
        <div class="chapter-row-meta">
          ${readerDots(readersByChapter.get(c.id) || [], c.latest_version)}
          <span>by ${escapeHtml(c.author_name)}</span>
          <span>v${c.latest_version}${c.word_count ? ` &middot; ${wordCount(c.word_count)}` : ''}</span>
          ${timeHtml(c.created_at)}
          ${c.pending_comments > 0 ? `<span class="badge pending">${c.pending_comments} pending</span>` : ''}
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
    return `<section class="arc">${arcHeading(group, arcNumber)}<div class="chapter-list">${
      group.chapters.map((c) => chapterRow(c, chapters.indexOf(c))).join('')
    }</div></section>`;
  }).join('') : emptyState({
    art: 'sheets',
    title: 'No chapters here',
    body: 'Every chapter of this story has been archived. They are still readable, and can be brought back.',
    action: `<a class="btn ghost small" href="/stories/${story.id}/archived-chapters">View archived chapters</a>`,
  });

  return layout({
    title: story.title,
    user,
    body: `
      <div class="page-head">
        <div>
          <h1>${escapeHtml(story.title)} ${storyStateBadge(story)}</h1>
          <p class="muted byline">${bylineWith(story.author_name, coauthors, story.author_username)} &middot; ${timeHtml(story.created_at)}</p>
          ${story.description ? `<p class="summary">${escapeHtml(story.description)}</p>` : ''}
          ${tagChips(tags)}
          ${storyStatsBlock(stats)}
        </div>
        <div class="page-head-actions">
          ${canWrite ? `<a class="btn" href="/stories/${story.id}/chapters/new">${ICONS.plus}Add chapter</a>` : ''}
          ${bibleVisible ? `<a class="btn ghost small" href="/stories/${story.id}/bible">Bible${bibleCount ? ` <span class="btn-count">${bibleCount}</span>` : ''}${story.bible_private && isStoryAuthor ? ' <span class="btn-count">private</span>' : ''}</a>` : ''}
          ${isStoryAuthor ? `<a class="btn ghost small" href="/stories/${story.id}/edit">Edit details</a>` : ''}
          ${isStoryAuthor ? `
            <form method="post" action="/stories/${story.id}/archive" class="inline-form">
              <button class="btn ghost small" type="submit">Archive story</button>
            </form>` : ''}
        </div>
      </div>
      ${synopsisSection(story)}
      ${named ? `<div class="arc-stack">${rows}</div>` : `<div class="chapter-list">${rows}</div>`}
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

  const total = results.stories.length + results.chapters.length + results.passages.length
    + results.glossary.length + (results.bible ? results.bible.length : 0);

  const section = (title, items, render) => (items.length ? `
    <section class="search-group">
      <h2>${title} <span class="search-count">${items.length}</span></h2>
      <div class="search-results">${items.map(render).join('')}</div>
    </section>` : '');

  const body = total === 0
    ? emptyState({
      art: 'glass',
      title: `Nothing matches \u201c${results.query}\u201d`,
      body: 'Archived stories and chapters are not searched, and only each chapter\'s current version is \u2014 so a phrase that was edited out will not be found.',
      action: '<a class="btn ghost small" href="/">Back to the stories</a>',
    })
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
      section('Bibles', results.bible || [], (e) => `
        <a class="search-result" href="/bible/${e.id}">
          <span class="search-result-title">${searchSnippet(e.name, results.query, { radius: 60 })} <span class="muted">&middot; ${escapeHtml(e.story_title)}</span></span>
          <span class="search-result-snippet">${escapeHtml(entityKindLabel(e.kind))}${e.alias_list ? ` &middot; also ${escapeHtml(e.alias_list)}` : ''}${e.summary ? ` &mdash; ${searchSnippet(e.summary, results.query)}` : ''}</span>
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


// ---------- the log, in words ----------
// One sentence per kind, with the subject the event was written with
// dropped into it. Anything not listed falls back to its own kind with
// the dashes taken out, so a new kind recorded in server.js shows up as
// something readable on the day it is added rather than as nothing.
const EVENT_SENTENCES = {
  joined: () => 'joined the Swarm',
  'signed-in': () => 'signed in',
  'password-changed': () => 'changed their password',
  'name-changed': (s) => `changed their name to ${s}`,
  'story-started': (s) => `started ${s}`,
  'story-edited': (s) => `edited the details of ${s}`,
  'story-archived': (s) => `archived ${s}`,
  'story-restored': (s) => `took ${s} out of the archive`,
  'story-deleted': (s) => `deleted ${s} for good`,
  'coauthor-added': (s) => `added ${s}`,
  'coauthor-removed': (s) => `removed ${s}`,
  'coauthor-left': (s) => `stepped back from ${s}`,
  'chapter-added': (s) => `added ${s}`,
  'chapter-revised': (s) => `saved a new version of ${s}`,
  'chapter-edited': (s) => `edited the details of ${s}`,
  'chapter-archived': (s) => `archived ${s}`,
  'chapter-restored': (s) => `took ${s} out of the archive`,
  'chapter-deleted': (s) => `deleted ${s} for good`,
  'chapter-moved': (s) => `moved ${s} in the running order`,
  'chapter-read': (s) => `read ${s}`,
  downloaded: (s) => `downloaded ${s}`,
  'comment-added': (s) => `commented on ${s}`,
  'comment-replied': (s) => `replied on ${s}`,
  'comment-accepted': (s) => `accepted a note on ${s}`,
  'comment-rejected': (s) => `turned down a note on ${s}`,
  'comment-edited': () => 'edited a comment',
  'comment-retracted': () => 'retracted a comment',
  'comment-reopened': (s) => `reopened a note on ${s}`,
  'bible-closed': (s) => `made the bible of ${s} private`,
  'bible-opened': (s) => `opened the bible of ${s} to readers`,
  'bible-entry-added': (s) => `added ${s} to the bible`,
  'bible-image-added': (s) => `added a picture to ${s}`,
  'bible-entry-edited': (s) => `rewrote ${s} in the bible`,
  'bible-entry-deleted': (s) => `took ${s} out of the bible`,
  'word-added': (s) => `taught the dictionary ${s}`,
  'word-removed': (s) => `took a word out of the dictionary of ${s}`,
  'invite-made': () => 'generated an invite code',
  'registration-closed': () => 'closed registration',
  'password-set-for': (s) => `set a new password for ${s}`,
  'account-locked': (s) => `locked ${s}`,
  'account-unlocked': (s) => `reactivated ${s}`,
  'reset-link-made': (s) => `made a password reset link for ${s}`,
  'backup-downloaded': () => 'downloaded a backup of everything',
  'wiki-synced': (s) => `synced the wiki (${s})`,
  'tag-created': (s) => `added the tag ${s}`,
  'tag-edited': (s) => `edited the tag ${s}`,
  'tag-approved': (s) => `approved the tag ${s}`,
  'tag-merged': (s) => `merged a tag into ${s}`,
  'tag-deleted': (s) => `deleted the tag ${s}`,
  'arc-started': (s) => `began an arc, ${s}`,
  'arc-removed': (s) => `took out the arc ${s}`,
  'stage-changed': (s) => `moved ${s}`,
  'status-changed': (s) => `moved ${s}`,
};

function eventLine(ev) {
  const subject = ev.subject
    ? (ev.href
      ? `<a href="${escapeHtml(ev.href)}">${escapeHtml(ev.subject)}</a>`
      : `<strong>${escapeHtml(ev.subject)}</strong>`)
    : '';
  const sentence = EVENT_SENTENCES[ev.kind]
    ? EVENT_SENTENCES[ev.kind](subject)
    : `${escapeHtml(ev.kind).replace(/-/g, ' ')}${subject ? ` ${subject}` : ''}`;
  return `<li class="log-line"><span class="log-when">${timeHtml(ev.created_at)}</span> <span class="log-what">${sentence}</span></li>`;
}

function eventLog(events) {
  if (!events.length) return '<p class="muted">Nothing recorded yet.</p>';
  return `<ol class="log-list">${events.map(eventLine).join('')}</ol>`;
}

// ---------- somebody's page ----------
// Everything the group can see about a member in one place: who they are,
// what they have written, and the numbers underneath it. No activity feed
// and no reading history -- what somebody has read is between them and
// the author whose chapter it was.
/** @param {{ user: Row, person: Row, stats: any, stories: any[], chapters: any[] }} props */
function profilePage({ user, person, stats, stories, chapters }) {
  const isSelf = person.id === user.id;
  const stat = (value, label) => `<div class="story-stat"><span class="story-stat-value">${value}</span><span class="story-stat-label">${label}</span></div>`;

  const storyRows = stories.length ? `<div class="chapter-list">${stories.map((s) => `
    <a class="chapter-row" href="/stories/${s.id}">
      <div class="chapter-row-main">
        <h3>${escapeHtml(s.title)}</h3>
        ${s.description ? `<p class="muted">${escapeHtml(s.description)}</p>` : ''}
      </div>
      <div class="chapter-row-meta">
        <span>${s.is_owner ? 'author' : 'coauthor'}</span>
        <span>${s.own_chapters} of ${s.chapters} chapter${s.chapters === 1 ? '' : 's'}</span>
      </div>
    </a>`).join('')}</div>` : `<p class="muted">${isSelf ? 'You have not started or been invited into a story yet.' : 'Nothing yet.'}</p>`;

  const chapterRows = chapters.length ? `<div class="chapter-list">${chapters.map((c) => `
    <a class="chapter-row" href="/chapters/${c.id}">
      <div class="chapter-row-main">
        <h3>${escapeHtml(c.title)}</h3>
        <p class="muted">${escapeHtml(c.story_title)}</p>
      </div>
      <div class="chapter-row-meta">
        ${c.word_count ? `<span>${wordCount(c.word_count)}</span>` : ''}
        ${timeHtml(c.created_at)}
      </div>
    </a>`).join('')}</div>` : `<p class="muted">${isSelf ? 'Nothing written yet.' : 'Nothing yet.'}</p>`;

  return layout({
    title: person.display_name,
    user,
    body: `
      <div class="page-head">
        <div>
          <h1>${escapeHtml(person.display_name)}</h1>
          <p class="muted byline">@${escapeHtml(person.username)} &middot; joined ${timeHtml(person.created_at)}${
  person.last_seen_at ? ` &middot; last seen ${timeHtml(person.last_seen_at)}` : ''
}</p>
        </div>
        ${isSelf ? '<div class="page-head-actions"><a class="btn ghost small" href="/account">Account</a></div>' : ''}
      </div>

      <div class="story-stats">
        ${stat(stats.words.toLocaleString('en-GB'), 'words')}
        ${stat(stats.chapters, `chapter${stats.chapters === 1 ? '' : 's'}`)}
        ${stat(stats.versions, `version${stats.versions === 1 ? '' : 's'}`)}
        ${stat(stats.storiesStarted, `stor${stats.storiesStarted === 1 ? 'y' : 'ies'} started`)}
        ${stat(stats.commentsWritten, 'notes given')}
        ${stat(stats.commentsReceived, 'notes taken')}
      </div>

      <section class="profile-section">
        <h2>Stories</h2>
        ${storyRows}
      </section>

      <section class="profile-section">
        <h2>Chapters</h2>
        ${chapterRows}
      </section>`,
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
        <h2>Your name</h2>
        <p class="muted">The name on everything you write and every note you leave. Your sign-in name, <strong>@${escapeHtml(user.username)}</strong>, does not change -- it is what the app knows you by.</p>
        <form method="post" action="/account/name">
          <label>Name people see<input type="text" name="displayName" value="${escapeHtml(user.display_name)}" required maxlength="60"></label>
          <button class="btn" type="submit">Save name</button>
        </form>
        <p class="muted"><a href="/users/${escapeHtml(user.username)}">See your page as the group sees it &rarr;</a></p>
      </div>
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
        <p class="muted small-meta">Joined ${timeHtml(u.created_at)} &middot; last seen ${timeHtml(u.last_seen_at)}${u.failed_login_attempts > 0 && !locked ? ` &middot; ${u.failed_login_attempts} recent failed login${u.failed_login_attempts === 1 ? '' : 's'}` : ''} &middot; <a href="/users/${escapeHtml(u.username)}">their page</a></p>
        <details class="user-log">
          <summary>What they have done${u.event_count ? ` (${u.event_count})` : ''}</summary>
          ${eventLog(u.events || [])}
          ${u.event_count > (u.events || []).length ? `<p class="muted small-meta">Showing the last ${(u.events || []).length} of ${u.event_count}.</p>` : ''}
        </details>
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
  profilePage,
  storiesPage,
  archivedStoriesPage,
  newStoryPage,
  newChapterPage,
  editChapterPage,
  storyPage,
  archivedChaptersPage,
  chapterPage,
  bibleIndexPage,
  changelogPage,
  helpIndexPage,
  helpTopicPage,
  fieldTemplatePage,
  chapterCastBlock,
  entityFormPage,
  entityPage,
  glossaryDirectoryPage,
  glossaryListPage,
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
