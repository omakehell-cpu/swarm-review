'use strict';

const { layout } = require('../lib/layout');
const { escapeHtml } = require('../lib/util');
const { timeHtml } = require('../lib/time');
const { storyState, STORY_STATES, CHAPTER_STAGES, DEFAULT_CHAPTER_STAGE, CHAPTER_STAGE_META } = require('../lib/story-state');

const wiki = require('../lib/wiki');

const taxonomy = require('../lib/glossary-taxonomy');

const bible = require('../lib/story-bible');

const bibleImages = require('../lib/entity-images');

const docs = require('../lib/docs');


// A reminder, not a manual: open on a screen with room for it, and one
// line you can put away on a screen without.
function markdownHint() {
  return `
    <details class="md-hint hint" data-fold-on-phone open>
      <summary>Markdown is supported</summary>
      <span>${MARKDOWN_HINT}</span>
    </details>`;
}

const MARKDOWN_HINT = `**bold**, *italic*, ***both***, ~~strikethrough~~, \`code\`, [link](https://...), # Heading, &gt; quote, --- for a scene break, and - or 1. list items. Put a backslash before a character to keep it literal (\\* shows a real asterisk). Line breaks are kept as you type them.`;


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


// Whose eyes the chapter is behind, and which thread it belongs to. Free
// text, with what this story has already used offered back -- so a
// vocabulary settles by being reused rather than by being configured
// before anybody has written anything.
// When this happens in the story's own calendar, which has nothing to do
// with the order it is told in. Two fields because they answer two
// different questions: what the story calls this moment, and where it
// goes on a line. The line needs a number; the reader needs the words.
function whenFields(storyWhen, storyDay, { whens = [] } = {}) {
  const list = whens.length
    ? `<datalist id="known-whens">${whens.map((v) => `<option value="${escapeHtml(v)}"></option>`).join('')}</datalist>`
    : '';
  return `
    <div class="entity-form-row">
      <label>When this happens
        <input type="text" name="storyWhen" value="${escapeHtml(storyWhen || '')}" maxlength="80" list="known-whens" placeholder="Day 412, or Third of Marrow">
      </label>
      <label>Day number
        <input type="number" name="storyDay" value="${storyDay === null || storyDay === undefined ? '' : escapeHtml(String(storyDay))}" step="1" placeholder="412">
      </label>
    </div>
    <span class="hint">Both optional. The words are what the story calls it; the number is what puts it on the timeline, on whatever scale you pick -- days, years, chapters of a war. Leave the number empty and nothing is assumed: undated is not day zero.</span>
    ${list}`;
}

function povAndStrandFields(pov, strand, { povs = [], strands = [] } = {}) {
  const list = (id, values) => (values.length
    ? `<datalist id="${id}">${values.map((v) => `<option value="${escapeHtml(v.value)}"></option>`).join('')}</datalist>`
    : '');
  return `
    <div class="entity-form-row">
      <label>Point of view
        <input type="text" name="pov" value="${escapeHtml(pov || '')}" maxlength="80" list="known-povs" placeholder="Whose eyes we are behind">
      </label>
      <label>Strand
        <input type="text" name="strand" value="${escapeHtml(strand || '')}" maxlength="80" list="known-strands" placeholder="Which thread of the story">
      </label>
    </div>
    <span class="hint">Both are optional and both are free text. What this story has used before is offered as you type, so they settle into a vocabulary on their own. They show up on the outline and in the story's analysis.</span>
    ${list('known-povs', povs)}${list('known-strands', strands)}`;
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


// The shape of the story at a glance: how much there is, how long it takes,
// how much of it is waiting on somebody.
// Progress towards a goal somebody actually set. One bar, one colour, a
// number beside it: the story is a single measure and a single measure is
// not a chart. The bar is drawn from the numbers in the sentence next to
// it, so what it says is readable without seeing it.
function goalBar(words, goal) {
  if (!goal || goal <= 0) return '';
  const done = Math.max(0, Math.min(1, words / goal));
  const percent = Math.round(done * 100);
  const over = words > goal;
  return `
    <div class="goal">
      <p class="goal-line">
        <span class="goal-figure">${wordCount(words)}</span>
        <span class="muted">of ${wordCount(goal)}${over ? ' &mdash; past it' : `, ${percent}%`}</span>
      </p>
      <div class="goal-track" role="img" aria-label="${wordCount(words)} of ${wordCount(goal)}, ${percent} per cent">
        <div class="goal-fill${over ? ' over' : ''}" style="width: ${percent}%"></div>
      </div>
    </div>`;
}


// How much somebody has written lately, and whether they are keeping to
// their own number. Three figures, so three figures -- a bar chart of one
// person's week is a chart looking for a job.
//
// Without a goal it counts days written rather than pretending the goal
// was one word: a number nobody set is not a target anybody met.
function writingBlock(streak, { own = false } = {}) {
  if (!streak) return '';
  const item = (value, label) => `<div class="story-stat"><span class="story-stat-value">${value}</span><span class="story-stat-label">${label}</span></div>`;
  const nothing = !streak.week && !streak.today && !streak.streak;
  if (nothing) {
    return own
      ? '<p class="muted">Nothing written in the last week. That is allowed.</p>'
      : '';
  }
  return `
    <div class="story-stats">
      ${streak.today ? item(wordCount(streak.today).replace(/ words$/, ''), 'today') : ''}
      ${streak.week ? item(wordCount(streak.week).replace(/ words$/, ''), 'this week') : ''}
      ${streak.streak ? item(streak.streak, streak.goal
    ? `day${streak.streak === 1 ? '' : 's'} at ${wordCount(streak.goal).replace(/ words$/, '')}+`
    : `day${streak.streak === 1 ? '' : 's'} running`) : ''}
    </div>`;
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

const STATUS_LABEL = { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected' };


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

module.exports = {
  EMPTY_ART,
  ERROR_HEADINGS,
  ICONS,
  MARKDOWN_HINT,
  STATUS_LABEL,
  arcField,
  bible,
  bibleImages,
  bylineWith,
  chapterStageBadge,
  docs,
  emptyState,
  errorPage,
  fileUploadField,
  goalBar,
  hiddenTagsSection,
  markdownHint,
  personLink,
  positionField,
  povAndStrandFields,
  readersLine,
  renderCommentReadOnly,
  stageField,
  storyStateBadge,
  tagChip,
  tagChips,
  tagPicker,
  taxonomy,
  whenFields,
  wiki,
  wordCount,
  writingBlock,
};
