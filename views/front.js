'use strict';

// The pieces of the front page (views/stories.js storiesPage) and of the
// advanced search (views/find.js). The front page is weighted the way the
// group works: writing first, then reviewing, then reading what is
// finished. So: a story as a card; your desk; what is waiting for your
// eyes; what you follow and have been reading; and the list's controls.

const { escapeHtml } = require('../lib/util');
const { timeHtml } = require('../lib/time');
const { storyState, STORY_STATES } = require('../lib/story-state');
const { bylineWith, storyCoverImg } = require('./shared');
const { LENGTHS, SHELVES, SHELF_ORDER } = require('../lib/story-shelves');

// ---------- small words ----------

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "48k words", "940 words". */
function shortWords(n) {
  const w = Number(n) || 0;
  if (!w) return '';
  return w < 1000 ? `${w} words` : `${Math.round(w / 1000)}k words`;
}

/** How long it takes to read, at an ordinary pace, said roughly. */
function readTime(words) {
  const minutes = Math.round((Number(words) || 0) / 230);
  if (minutes < 5) return '';
  if (minutes < 60) return `about ${minutes} min`;
  const hours = minutes / 60;
  return `about ${hours < 10 ? Math.round(hours * 2) / 2 : Math.round(hours)} h`;
}

// Where a story stands, as a mark and a word: never the colour alone.
const STATE_MARK = { ongoing: '&#9998;', hiatus: '&#8987;', complete: '&#10003;', dropped: '&#10005;' };
function stateLabel(s) {
  const state = storyState(s);
  const meta = STORY_STATES[state];
  if (!meta) return '';
  const label = meta.label;
  return `<span class="story-state state-${state}" title="${escapeHtml(meta.hint)}"><span aria-hidden="true">${STATE_MARK[state] || ''}</span> ${escapeHtml(label)}</span>`;
}

// A story with no picture still gets a face: its first letter, set large.
// Nothing invented about it -- no stock image standing in for the story.
function coverOrLetter(s, className = 'story-card-cover') {
  const img = storyCoverImg(s, className);
  if (img) return img;
  const letter = (String(s.title || s.story_title || '?').match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  return `<span class="${className} cover-letter" aria-hidden="true">${escapeHtml(letter)}</span>`;
}

// ---------- a story, as a row of the catalogue ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthYear(d) {
  const m = /^(\d{4})-(\d{2})/.exec(String(d || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

/**
 * The whole width for one story: its face, then what it is -- title, who,
 * series, the whole blurb, its tags -- and, set apart on the right, the
 * facts to compare it by. Nothing cut short that matters.
 */
function storyWide(s, { tags = [], coauthors = [], sinceQs = '' } = {}) {
  return `
    <li class="story-wide story-row" data-find="${escapeHtml(`${s.title} ${s.author_name || ''} ${s.series || ''} ${s.description || ''}`.toLowerCase())}">
      ${coverOrLetter(s, 'story-wide-cover')}
      <div class="story-wide-main">
        <h3 class="story-wide-title"><a class="row-link" href="/stories/${s.id}${sinceQs}">${escapeHtml(s.title)}</a>${s.has_new_chapters ? ' <span class="badge new">New</span>' : ''}</h3>
        <p class="story-wide-by">${bylineWith(s.author_name, coauthors, s.author_username)}${s.series ? ` <span class="story-wide-series">&middot; ${escapeHtml(s.series)}</span>` : ''}</p>
        ${s.description ? `<p class="story-wide-blurb">${escapeHtml(s.description)}</p>` : ''}
        ${tags.length ? `<p class="story-card-tags"><i class="sr-only">Tags: </i>${tags.slice(0, 6).map((t) => `<span>${escapeHtml(t.name)}</span>`).join('')}${tags.length > 6 ? `<span class="more">+${tags.length - 6}</span>` : ''}</p>` : ''}
      </div>
      <dl class="story-wide-facts">
        <div><dt class="sr-only">Stands</dt><dd>${stateLabel(s) || '&nbsp;'}</dd></div>
        <div><dt>Chapters</dt><dd>${s.chapter_count || 0}</dd></div>
        <div><dt>Words</dt><dd>${shortWords(s.word_count).replace(' words', '') || '&ndash;'}</dd></div>
        ${readTime(s.word_count) ? `<div><dt>To read</dt><dd>${readTime(s.word_count).replace('about ', '')}</dd></div>` : ''}
        <div><dt>Updated</dt><dd>${monthYear(s.last_chapter_at || s.created_at)}</dd></div>
        ${s.pending_comments > 0 ? `<div><dt class="sr-only">Notes</dt><dd><span class="badge pending">${s.pending_comments} waiting</span></dd></div>` : ''}
      </dl>
    </li>`;
}

/**
 * Every story as a line of a table, for comparing a shelf at a glance.
 * @param {any[]} stories
 * @param {{ coauthorsFor?: (s: any) => any[], sinceQs?: string }} [opts]
 */
function storyTable(stories, { coauthorsFor = (_s) => [], sinceQs = '' } = {}) {
  return `
    <div class="story-table-wrap">
      <table class="story-table">
        <thead><tr>
          <th scope="col">Story</th><th scope="col">Stands</th><th scope="col" class="num">Chapters</th>
          <th scope="col" class="num">Words</th><th scope="col">To read</th><th scope="col">Updated</th>
        </tr></thead>
        <tbody>
          ${stories.map((s) => `
            <tr class="story-row">
              <th scope="row">
                <a class="row-link" href="/stories/${s.id}${sinceQs}">${escapeHtml(s.title)}</a>
                <span class="story-table-by">${bylineWith(s.author_name, coauthorsFor(s), s.author_username)}${s.series ? ` &middot; ${escapeHtml(s.series)}` : ''}</span>
              </th>
              <td>${stateLabel(s)}</td>
              <td class="num">${s.chapter_count || 0}</td>
              <td class="num">${(Number(s.word_count) || 0).toLocaleString('en-GB')}</td>
              <td>${readTime(s.word_count).replace('about ', '') || '&ndash;'}</td>
              <td>${monthYear(s.last_chapter_at || s.created_at)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ---------- write: your desk ----------

// What you have on the go: each story of yours still being written, with
// the draft waiting in it if there is one, how far it is towards its goal,
// and the way to the next chapter. The first thing on the page, because
// writing is what the group is for.
function deskColumn(desk, { hasStories = false } = {}) {
  const items = (desk || []).slice(0, 4);
  const body = items.length ? `
      <ul class="desk-list">
        ${items.map((s) => {
    const goal = s.word_goal > 0 ? Math.max(0, Math.min(100, Math.round(((s.word_count || 0) / s.word_goal) * 100))) : null;
    return `
          <li class="desk-item">
            ${coverOrLetter(s, 'desk-cover')}
            <div class="desk-body">
              <h3 class="desk-title"><a href="/stories/${s.id}">${escapeHtml(s.title)}</a></h3>
              <p class="desk-facts">${stateLabel(s)} <span>${plural(s.chapter_count || 0, 'chapter')}${s.word_count ? ` &middot; ${shortWords(s.word_count)}` : ''}</span>${s.pending_comments > 0 ? ` <span class="badge pending">${s.pending_comments} note${s.pending_comments === 1 ? '' : 's'} waiting</span>` : ''}</p>
              ${s.draft
    ? `<p class="desk-draft"><span class="desk-draft-mark" aria-hidden="true">&#9998;</span> Draft of chapter ${s.draft.chapter_number}${s.draft.title ? `, <em>${escapeHtml(s.draft.title)}</em>` : ''}, saved ${timeHtml(s.draft.updated_at)}</p>`
    : (s.latest ? `<p class="desk-last">Latest: chapter ${s.latest.chapter_number}${s.latest.title ? `, ${escapeHtml(s.latest.title)}` : ''}</p>` : '')}
              ${goal !== null ? `<p class="desk-goal"><span class="desk-goal-bar" aria-hidden="true"><span style="width:${goal}%"></span></span> ${goal}% of ${shortWords(s.word_goal)}</p>` : ''}
              <p class="desk-actions">
                ${s.draft ? `<a class="btn small" href="/chapters/${s.draft.chapter_id}/edit">Continue the draft</a>` : ''}
                <a class="btn ghost small" href="/stories/${s.id}/chapters/new">+ New chapter</a>
              </p>
            </div>
          </li>`;
  }).join('')}
      </ul>
      ${desk.length > items.length ? `<p class="band-more"><a href="/?sort=mine&amp;shelf=writing#library">All ${desk.length} you are writing &rarr;</a></p>` : ''}`
    : `
      <div class="desk-empty">
        <p>${hasStories ? 'Nothing of yours is being written right now.' : 'You have not started a story yet.'}</p>
        <a class="btn" href="/stories/new">+ Start a story</a>
      </div>`;
  return `
    <section class="band band-write" aria-labelledby="write-title">
      <h2 id="write-title" class="band-title">Write</h2>
      ${body}
    </section>`;
}

// ---------- review: what is waiting for your eyes ----------

function reviewItem(href, what, where, count = 0) {
  return `
    <li>
      <a href="${href}">
        ${count ? `<span class="inbox-count">${count}</span>` : ''}
        <span class="inbox-what">${what}</span>
        <span class="inbox-where">${where}</span>
      </a>
    </li>`;
}

const chapterWords = (g) => (g.chapters.length === 1
  ? `chapter ${g.first.chapter_number}${g.first.title && !/^chapter\s+\d+$/i.test(g.first.title) ? `: ${escapeHtml(g.first.title.replace(/^chapter\s+\d+\s*[:.-]\s*/i, ''))}` : ''}`
  : `${g.chapters.length} new chapters, from chapter ${g.first.chapter_number}`);

/**
 * Everything that wants you to read and say something, most personal
 * first: asked by name, notes on your own chapters, replies to you, new
 * chapters in what you follow, and new chapters in the group.
 */
function reviewColumn({ inbox, following = [], newByStory = [] }) {
  const groups = [];
  const asked = (inbox && inbox.asked) || [];
  if (asked.length) {
    groups.push(['Asked to read by you', asked.map((r) => reviewItem(`/chapters/${r.chapter_id}`,
      `<strong>${escapeHtml(r.requested_by_name || 'Somebody')}</strong> asked: chapter ${r.chapter_number}, ${escapeHtml(r.chapter_title)}`,
      `${escapeHtml(r.story_title)}${r.question ? ` &middot; &ldquo;${escapeHtml(String(r.question).slice(0, 120))}&rdquo;` : ''}`))]);
  }
  const pending = (inbox && inbox.pending) || [];
  if (pending.length) {
    groups.push(['Notes on your chapters', pending.map((row) => reviewItem(`/chapters/${row.chapter_id}`,
      `note${row.pending === 1 ? '' : 's'} to answer`,
      `${escapeHtml(row.story_title)} &middot; chapter ${row.chapter_number}: ${escapeHtml(row.chapter_title)}`, row.pending))]);
  }
  const replies = (inbox && inbox.replies) || [];
  if (replies.length) {
    groups.push([replies.some((r) => r.mention) ? 'Replies and mentions' : 'Replies to you', replies.map((r) => reviewItem(`/chapters/${r.chapter_id}#comment-${r.id}`,
      `<strong>${escapeHtml(r.author_name)}</strong> ${r.mention ? 'mentioned you: ' : ''}${escapeHtml(String(r.body || '').replace(/\s+/g, ' ').slice(0, 110))}`,
      `${escapeHtml(r.story_title)} &middot; chapter ${r.chapter_number}`))]);
  }
  const news = following.filter((f) => f.fresh > 0);
  if (news.length) {
    groups.push(['<span aria-hidden="true">&#9733;</span> New in what you follow', news.map((f) => reviewItem(`/chapters/${f.first_fresh_id}`,
      `<strong>${escapeHtml(f.title)}</strong> &middot; ${plural(f.fresh, 'new chapter')}, from chapter ${f.first_fresh_number}`,
      `by ${escapeHtml(f.author_name)}`, f.fresh))]);
  }
  if (newByStory.length) {
    groups.push(['New in the group', newByStory.map((g) => reviewItem(`/chapters/${g.first.id}`,
      `<strong>${escapeHtml(g.story_title)}</strong> &middot; ${chapterWords(g)}`,
      `by ${escapeHtml(g.author_name)}${g.words ? ` &middot; ${shortWords(g.words)}` : ''}`))]);
  }
  return `
    <section class="band band-review" aria-labelledby="review-title">
      <h2 id="review-title" class="band-title">Review</h2>
      ${groups.length ? groups.map(([title, items]) => `
        <div class="review-group">
          <h3>${title}</h3>
          <ul class="inbox-list">${items.join('')}</ul>
        </div>`).join('') : '<p class="band-empty">Nothing is waiting for you. When somebody asks you to read, answers a note, or puts up a chapter, it shows here.</p>'}
    </section>`;
}

// ---------- read: what you follow, and what you have been reading ----------

function followingList(stories) {
  if (!stories || !stories.length) return '';
  const shown = stories.slice(0, 5);
  return `
    <div class="read-aside">
      <h3><span aria-hidden="true">&#9733;</span> Following</h3>
      <ul class="read-list">
        ${shown.map((f) => `
          <li><a href="${f.fresh ? `/chapters/${f.first_fresh_id}` : `/stories/${f.id}`}">${escapeHtml(f.title)}</a>
            <span class="muted">${f.fresh ? plural(f.fresh, 'new chapter') : 'up to date'}</span></li>`).join('')}
      </ul>
      ${stories.length > shown.length ? `<p class="band-more"><a href="/find?following=1">All ${stories.length} you follow &rarr;</a></p>` : ''}
    </div>`;
}

function recentlyList(items) {
  if (!items || !items.length) return '';
  return `
    <div class="read-aside">
      <h3>Recently read</h3>
      <ul class="read-list">
        ${items.map((c) => `
          <li><a href="${c.finished ? `/stories/${c.story_id}` : `/chapters/${c.chapter_id}`}">${escapeHtml(c.story_title)}</a>
            <span class="muted">${c.finished ? 'read to the end'
    : (c.percent ? `chapter ${c.chapter_number} of ${c.chapters}, ${c.percent}% in` : `next: chapter ${c.chapter_number} of ${c.chapters}`)}</span></li>`).join('')}
      </ul>
    </div>`;
}

// ---------- the list's controls ----------

/**
 * The address of the list with some of its settings changed. The front
 * page's list lands on #library, the advanced search's on #results. The
 * look (covers or list) is kept per person, so it is only in the address
 * of the link that changes it.
 * @param {any} state
 * @param {Record<string, any>} [change]  `tags` replaces the tags switched on
 */
function listHref(state, change = {}) {
  const { tags: tagsChange, ...rest } = change;
  const next = {
    shelf: state.shelf === state.defaultShelf ? '' : state.shelf,
    q: state.q, author: state.author, text: state.text, length: state.length, following: state.following ? '1' : '',
    series: state.series, sort: state.sort,
    page: '', ...rest,
  };
  const parts = [];
  for (const [k, v] of Object.entries(next)) if (v) parts.push(`${k}=${encodeURIComponent(String(v))}`);
  for (const t of tagsChange || state.activeTags || []) parts.push(`tag=${encodeURIComponent(t.slug)}`);
  const base = state.base || '/';
  return `${parts.length ? `${base}?${parts.join('&amp;')}` : base}${base === '/' ? '#library' : '#results'}`;
}

const segment = (label, items) => `
  <nav class="segmented" aria-label="${label}">
    ${items.map(([text, href, current]) => (current
    ? `<span class="segmented-current" aria-current="true">${text}</span>`
    : `<a href="${href}">${text}</a>`)).join('')}
  </nav>`;

function shelfTabs(state) {
  const order = state.base === '/find' ? SHELF_ORDER : ['writing', 'complete', 'all'];
  const tab = (key) => {
    const current = state.shelf === key;
    const n = state.counts[key] || 0;
    // Set aside is not a shelf of its own on the front page: those are in All.
    if (key === 'dropped' && !current && (state.base !== '/find' || !n)) return '';
    return `<a class="tag-chip shelf-tab${current ? ' current' : ''}${n ? '' : ' is-empty'}" href="${listHref(state, { shelf: key === state.defaultShelf ? '' : key })}"${current ? ' aria-current="page"' : ''}>${escapeHtml(SHELVES[key].label)}<span class="tag-chip-count">${n}</span></a>`;
  };
  return `<nav class="shelf-tabs" aria-label="Which stories">${order.map(tab).join('')}</nav>`;
}

/** The order and the look. */
function viewControls(state) {
  return `
        ${segment('Order of the stories', [
    ['Latest', listHref(state, { sort: '' }), !state.sort || state.sort === 'mine'],
    ['A&ndash;Z', listHref(state, { sort: 'title' }), state.sort === 'title'],
  ])}
        ${segment('How the stories are shown', [
    ['Rows', listHref(state, { view: 'rows' }), state.view !== 'table'],
    ['Table', listHref(state, { view: 'table' }), state.view === 'table'],
  ])}`;
}

/** Shelves, then the order and the look: one row, nothing else. */
function listControls(state) {
  return `
    <div class="library-controls">
      ${shelfTabs(state)}
      <div class="library-view">${viewControls(state)}</div>
    </div>`;
}

function activeChips(state) {
  const chips = [];
  if (state.q) chips.push([`&ldquo;${escapeHtml(state.q)}&rdquo;`, listHref(state, { q: '' })]);
  if (state.author) chips.push([`Author: ${escapeHtml(state.author)}`, listHref(state, { author: '' })]);
  if (state.text) chips.push([`In the text: &ldquo;${escapeHtml(state.text)}&rdquo;`, listHref(state, { text: '' })]);
  if (state.length) chips.push([escapeHtml(LENGTHS[state.length].label), listHref(state, { length: '' })]);
  if (state.series) chips.push([`Series: ${escapeHtml(state.series)}`, listHref(state, { series: '' })]);
  if (state.following) chips.push(['&#9733; Only stories I follow', listHref(state, { following: '' })]);
  if (state.sort === 'mine') chips.push(['Only stories I write in', listHref(state, { sort: '' })]);
  for (const t of state.activeTags || []) {
    chips.push([`Tag: ${escapeHtml(t.name)}`, listHref(state, { tags: state.activeTags.filter((x) => x.slug !== t.slug) })]);
  }
  if (!chips.length) return '';
  return `
    <div class="active-filters" aria-label="Switched on">
      ${chips.map(([label, href]) => `<a class="active-filter" href="${href}">${label} <span aria-hidden="true">&times;</span><span class="sr-only">, take it off</span></a>`).join('')}
      ${chips.length > 1 ? `<a class="active-filter-clear" href="${listHref(state, { q: '', author: '', text: '', length: '', series: '', following: '', sort: '', tags: [] })}">Clear all</a>` : ''}
    </div>`;
}

// The front page shows a dozen of a shelf; the rest of it is in the
// advanced search, on the same shelf, in the same order.
function seeAll(state) {
  if (state.total <= state.stories.length) return '';
  const params = [];
  if (state.shelf !== 'all') params.push(`shelf=${encodeURIComponent(state.shelf)}`);
  if (state.sort) params.push(`sort=${encodeURIComponent(state.sort)}`);
  if (state.q) params.push(`q=${encodeURIComponent(state.q)}`);
  for (const t of state.activeTags || []) params.push(`tag=${encodeURIComponent(t.slug)}`);
  return `
    <p class="see-all"><a class="btn ghost" href="/find${params.length ? `?${params.join('&amp;')}` : ''}#results">See all ${state.total} ${escapeHtml(SHELVES[state.shelf].label.toLowerCase())} &rarr;</a></p>`;
}

// Numbered, with the first and last always there: page 7 of 11 is two
// clicks from anywhere, and says where you are in words as well.
function pager(state) {
  if (state.pages <= 1) return '';
  const want = new Set([1, state.pages, state.page - 1, state.page, state.page + 1]);
  const numbers = [];
  let last = 0;
  for (let n = 1; n <= state.pages; n += 1) {
    if (!want.has(n)) continue;
    if (n - last > 1) numbers.push('<span class="pager-gap" aria-hidden="true">&hellip;</span>');
    numbers.push(n === state.page
      ? `<span class="pager-n current" aria-current="page"><span class="sr-only">Page </span>${n}</span>`
      : `<a class="pager-n" href="${listHref(state, { page: n > 1 ? n : '' })}"><span class="sr-only">Page </span>${n}</a>`);
    last = n;
  }
  return `
    <nav class="pager" aria-label="Pages">
      ${state.page > 1 ? `<a href="${listHref(state, { page: state.page > 2 ? state.page - 1 : '' })}" rel="prev">&larr; Previous</a>` : '<span></span>'}
      <span class="pager-numbers">${numbers.join('')}</span>
      ${state.page < state.pages ? `<a href="${listHref(state, { page: state.page + 1 })}" rel="next">Next &rarr;</a>` : '<span></span>'}
    </nav>
    <p class="pager-where muted">Page ${state.page} of ${state.pages}</p>`;
}

// ---------- following ----------

/**
 * The star on a story: follow it, and its new chapters are called out to
 * you until you have read them. A real button in a real form; the script
 * only keeps the page where it is.
 */
function followButton(storyId, following, { back = '', followers = 0, small = false } = {}) {
  return `
    <form method="post" action="/stories/${storyId}/follow" class="follow-form" data-follow-form>
      <input type="hidden" name="follow" value="${following ? '0' : '1'}">
      ${back ? `<input type="hidden" name="back" value="${escapeHtml(back)}">` : ''}
      <button type="submit" class="btn ghost${small ? ' small' : ''} follow-btn${following ? ' is-following' : ''}" aria-pressed="${following ? 'true' : 'false'}"
              title="${following ? 'You follow this story: its new chapters are shown to you. Press to stop.' : 'Follow: be told when a new chapter goes up.'}">
        <span class="follow-star" aria-hidden="true">${following ? '&#9733;' : '&#9734;'}</span>
        <span class="follow-word">${following ? 'Following' : 'Follow'}</span>${followers ? ` <span class="btn-count follow-n">${followers}</span>` : ''}
      </button>
    </form>`;
}

module.exports = {
  activeChips, seeAll, storyTable, storyWide, deskColumn, followButton, followingList, listControls, listHref, pager, recentlyList, reviewColumn, viewControls,
  shortWords, stateLabel,
};
