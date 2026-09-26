'use strict';

// The pieces of the front page (views/stories.js storiesPage): a story as
// a card, what this reader was in the middle of, what is new to read a
// story at a time, a few things from the library to try, and the library's
// own controls -- where from, which shelf, the order, the look, and the
// filters, with what is switched on said back as chips you can take off.

const { escapeHtml } = require('../lib/util');
const { storyState, STORY_STATES } = require('../lib/story-state');
const { bylineWith, storyCoverImg } = require('./shared');
const { SHELVES, SHELF_ORDER } = require('../lib/story-shelves');

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
  return `<span class="story-state state-${state}" title="${escapeHtml(meta.hint)}"><span aria-hidden="true">${STATE_MARK[state] || ''}</span> ${escapeHtml(meta.label)}</span>`;
}

// A story with no picture still gets a face: its first letter, set large.
// Nothing invented about it -- no stock image standing in for the story.
function coverOrLetter(s, className = 'story-card-cover') {
  const img = storyCoverImg(s, className);
  if (img) return img;
  const letter = (String(s.title || s.story_title || '?').match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  return `<span class="${className} cover-letter" aria-hidden="true">${escapeHtml(letter)}</span>`;
}

// ---------- a story, as a card ----------

/**
 * One link per card -- the title -- stretched across it, so the whole card
 * is a target without a link inside a link. The tags are words, not
 * links, for the same reason; the story's page has them as links.
 */
function storyCard(s, { tags = [], coauthors = [], sinceQs = '', compact = false } = {}) {
  const size = [plural(s.chapter_count || 0, 'chapter'), shortWords(s.word_count), readTime(s.word_count)].filter(Boolean).join(' &middot; ');
  return `
    <li class="story-card story-row${compact ? ' is-compact' : ''}" data-find="${escapeHtml(`${s.title} ${s.author_name || ''} ${s.series || ''} ${s.description || ''} ${tags.map((t) => t.name).join(' ')}`.toLowerCase())}">
      ${coverOrLetter(s)}
      <div class="story-card-body">
        <h3 class="story-card-title"><a class="row-link" href="/stories/${s.id}${sinceQs}">${escapeHtml(s.title)}</a>${s.has_new_chapters ? ' <span class="badge new">New</span>' : ''}</h3>
        <p class="story-card-by">${bylineWith(s.author_name, coauthors)}</p>
        <p class="story-card-facts">${stateLabel(s)} <span>${size}</span></p>
        ${s.series && !compact ? `<p class="story-card-series">${escapeHtml(s.series)}</p>` : ''}
        ${s.description ? `<p class="story-card-blurb">${escapeHtml(s.description)}</p>` : ''}
        ${tags.length && !compact ? `<p class="story-card-tags"><i class="sr-only">Tags: </i>${tags.slice(0, 3).map((t) => `<span>${escapeHtml(t.name)}</span>`).join('')}${tags.length > 3 ? `<span class="more">+${tags.length - 3}</span>` : ''}</p>` : ''}
        ${s.pending_comments > 0 ? `<p><span class="badge pending">${s.pending_comments} waiting</span></p>` : ''}
      </div>
    </li>`;
}

// ---------- for you ----------

function continueSection(items) {
  if (!items || !items.length) return '';
  return `
    <section class="for-you-group" aria-labelledby="continue-title">
      <h2 id="continue-title">Pick up where you left off</h2>
      <ul class="continue-list">
        ${items.map((c) => `
          <li class="continue-item story-row">
            ${coverOrLetter({ ...c, id: c.story_id, title: c.story_title }, 'continue-cover')}
            <div>
              <a class="row-link" href="/chapters/${c.chapter_id}">${escapeHtml(c.story_title)}</a>
              <span class="continue-where">Chapter ${c.chapter_number} of ${c.chapters}${c.percent ? `, ${c.percent}% in` : ''} &middot; by ${escapeHtml(c.author_name)}</span>
              <span class="continue-bar" aria-hidden="true"><span style="width:${Math.round(((c.read + (c.percent || 0) / 100) / Math.max(1, c.chapters)) * 100)}%"></span></span>
            </div>
          </li>`).join('')}
      </ul>
    </section>`;
}

function newToReadSection(groups) {
  if (!groups || !groups.length) return '';
  return `
    <section class="for-you-group" aria-labelledby="new-title">
      <h2 id="new-title">New to read</h2>
      <ul class="inbox-list">
        ${groups.map((g) => `
          <li>
            <a href="/chapters/${g.first.id}">
              <span class="inbox-what"><strong>${escapeHtml(g.story_title)}</strong> &middot; ${g.chapters.length === 1
    ? `chapter ${g.first.chapter_number}${g.first.title && !/^chapter\s+\d+$/i.test(g.first.title) ? `: ${escapeHtml(g.first.title.replace(/^chapter\s+\d+\s*[:.-]\s*/i, ''))}` : ''}`
    : `${g.chapters.length} new chapters, from chapter ${g.first.chapter_number}`}</span>
              <span class="inbox-where">by ${escapeHtml(g.author_name)}${g.words ? ` &middot; ${shortWords(g.words)}` : ''}</span>
            </a>
          </li>`).join('')}
      </ul>
    </section>`;
}

function discoverRow(stories, { tagsFor, coauthorsFor }) {
  if (!stories || !stories.length) return '';
  return `
    <section class="discover" aria-labelledby="discover-title">
      <div class="discover-head">
        <h2 id="discover-title">Something to read</h2>
        <p class="muted">From the library, a different few every day.</p>
      </div>
      <ul class="story-cards is-row">${stories.map((s) => storyCard(s, { tags: tagsFor(s), coauthors: coauthorsFor(s), compact: true })).join('')}</ul>
    </section>`;
}

// ---------- the library's controls ----------

/**
 * The front page's address with some of its settings changed, always
 * landing on the list rather than the top of the page.
 * @param {any} state
 * @param {Record<string, any>} [change]  `tags` replaces the tags switched on
 */
function listHref(state, change = {}) {
  const { tags: tagsChange, ...rest } = change;
  const next = {
    origin: state.originParam, shelf: state.shelf === state.defaultShelf ? '' : state.shelf,
    q: state.q, series: state.series, sort: state.sort, view: state.view,
    page: '', ...rest,
  };
  if ('origin' in rest && !('shelf' in rest)) next.shelf = '';
  const parts = [];
  for (const [k, v] of Object.entries(next)) if (v) parts.push(`${k}=${encodeURIComponent(String(v))}`);
  for (const t of tagsChange || state.activeTags || []) parts.push(`tag=${encodeURIComponent(t.slug)}`);
  return `${parts.length ? `/?${parts.join('&amp;')}` : '/'}#library`;
}

const segment = (label, items) => `
  <nav class="segmented" aria-label="${label}">
    ${items.map(([text, href, current]) => (current
    ? `<span class="segmented-current" aria-current="true">${text}</span>`
    : `<a href="${href}">${text}</a>`)).join('')}
  </nav>`;

function originTabs(state) {
  if (!state.hasImported) return '';
  const tab = (key, label) => {
    const current = state.originParam === key || (!state.originParam && key === 'here');
    const n = state.originCounts[key] || 0;
    return `<a class="origin-tab${current ? ' current' : ''}" href="${listHref(state, { origin: key === 'here' ? '' : key, page: '' })}"${current ? ' aria-current="page"' : ''}>${label}<span class="origin-count">${n}</span></a>`;
  };
  return `
    <nav class="origin-tabs" aria-label="Where the stories were written">
      ${tab('here', 'Written here')}${tab('imported', 'From StoriesOnline')}${tab('all', 'Everything')}
      <a class="origin-aside" href="/authors">By author &rarr;</a>
    </nav>`;
}

function shelfTabs(state) {
  const tab = (key) => {
    const current = state.shelf === key;
    const n = state.counts[key] || 0;
    // A shelf with nothing on it is only shown when it is the one open.
    if (!n && !current && key === 'dropped') return '';
    return `<a class="tag-chip shelf-tab${current ? ' current' : ''}${n ? '' : ' is-empty'}" href="${listHref(state, { shelf: key === state.defaultShelf ? '' : key })}"${current ? ' aria-current="page"' : ''}>${escapeHtml(SHELVES[key].label)}<span class="tag-chip-count">${n}</span></a>`;
  };
  return `<nav class="shelf-tabs" aria-label="Which stories">${SHELF_ORDER.map(tab).join('')}</nav>`;
}

function storySearch(state) {
  const keep = (name, value) => (value ? `<input type="hidden" name="${name}" value="${escapeHtml(value)}">` : '');
  return `
    <form method="get" action="/" class="story-search" role="search">
      ${keep('origin', state.originParam)}${keep('shelf', state.shelf === state.defaultShelf ? '' : state.shelf)}${keep('series', state.series)}${keep('sort', state.sort)}${keep('view', state.view)}
      ${(state.activeTags || []).map((t) => keep('tag', t.slug)).join('')}
      <label class="sr-only" for="story-find">Search every story</label>
      <input type="search" class="list-find" id="story-find" name="q" value="${escapeHtml(state.q)}"
             placeholder="Title, author, series or tag" autocomplete="off">
      <button class="btn small" type="submit">Search</button>
    </form>`;
}

// Series and tags, in one form: pick any, press Show. The order and the
// look are one click each and stay outside it.
function filtersPanel(state, allGroups) {
  const active = new Set((state.activeTags || []).map((t) => t.slug));
  const n = (state.series ? 1 : 0) + active.size;
  const keep = (name, value) => (value ? `<input type="hidden" name="${name}" value="${escapeHtml(value)}">` : '');
  if (!state.seriesList.length && !allGroups.length) return '';
  return `
    <details class="list-more library-filters">
      <summary>Filters${n ? ` <span class="filter-n">${n}</span>` : ''}</summary>
      <form method="get" action="/#library" class="list-more-body">
        ${keep('origin', state.originParam)}${keep('shelf', state.shelf === state.defaultShelf ? '' : state.shelf)}${keep('q', state.q)}${keep('sort', state.sort)}${keep('view', state.view)}
        ${state.seriesList.length ? `
          <label class="filter-label" for="series-pick">Series</label>
          <select name="series" id="series-pick">
            <option value="">Any</option>
            ${state.seriesList.map((s) => `<option value="${escapeHtml(s.name)}"${s.name === state.series ? ' selected' : ''}>${escapeHtml(s.name)} (${s.n})</option>`).join('')}
          </select>` : ''}
        ${allGroups.map((g) => `
          <fieldset class="tag-group">
            <legend>${escapeHtml(g.group)}</legend>
            <div class="tag-group-options">${g.tags.map((t) => `
              <label class="tag-pick${active.has(t.slug) ? ' checked' : ''}">
                <input type="checkbox" name="tag" value="${escapeHtml(t.slug)}"${active.has(t.slug) ? ' checked' : ''}>
                <span>${escapeHtml(t.name)}</span>
              </label>`).join('')}</div>
          </fieldset>`).join('')}
        <div class="tag-filter-actions">
          <button class="btn small" type="submit">Show</button>
          <span class="hint">A story has to carry every tag you pick.</span>
        </div>
      </form>
    </details>`;
}

function activeChips(state) {
  const chips = [];
  if (state.q) chips.push([`&ldquo;${escapeHtml(state.q)}&rdquo;`, listHref(state, { q: '' })]);
  if (state.series) chips.push([`Series: ${escapeHtml(state.series)}`, listHref(state, { series: '' })]);
  for (const t of state.activeTags || []) {
    chips.push([`Tag: ${escapeHtml(t.name)}`, listHref(state, { tags: state.activeTags.filter((x) => x.slug !== t.slug) })]);
  }
  if (!chips.length) return '';
  return `
    <div class="active-filters" aria-label="Switched on">
      ${chips.map(([label, href]) => `<a class="active-filter" href="${href}">${label} <span aria-hidden="true">&times;</span><span class="sr-only">, take it off</span></a>`).join('')}
      ${chips.length > 1 ? `<a class="active-filter-clear" href="${listHref(state, { q: '', series: '', tags: [] })}">Clear all</a>` : ''}
    </div>`;
}

function libraryControls(state, allGroups) {
  return `
    ${originTabs(state)}
    ${storySearch(state)}
    <div class="library-controls">
      ${shelfTabs(state)}
      <div class="library-view">
        ${segment('Order of the stories', [
    ['Latest', listHref(state, { sort: '' }), !state.sort],
    ['A&ndash;Z', listHref(state, { sort: 'title' }), state.sort === 'title'],
    ['Mine', listHref(state, { sort: 'mine' }), state.sort === 'mine'],
  ])}
        ${segment('How the list looks', [
    ['Cards', listHref(state, { view: '' }), !state.view],
    ['List', listHref(state, { view: 'list' }), state.view === 'list'],
  ])}
        ${filtersPanel(state, allGroups)}
      </div>
    </div>
    ${activeChips(state)}`;
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

module.exports = {
  continueSection, discoverRow, libraryControls, listHref, newToReadSection, pager, shortWords, storyCard,
};
