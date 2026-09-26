'use strict';

const { layout } = require('../lib/layout');
const { escapeHtml } = require('../lib/util');
const { timeHtml } = require('../lib/time');
const { emptyState, taxonomy, wiki } = require('./shared');
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
        ${emptyState({
    art: 'book',
    title: 'The glossary is waiting for the wiki',
    body: 'This is the shared universe: its people, ships, places and history, brought in from the wiki. Once it is here, names in every chapter link to it, and a card tells you who someone is without leaving the page.',
    action: user.is_admin
      ? '<a class="btn" href="/admin#wiki">Bring the wiki in</a>'
      : 'An admin brings it in from the admin page. Until then, each story\'s own bible still works.',
  })}`,
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
// A listing longer than this is sent a letter at a time: all 691 pages
// in one response was half a megabyte down a home connection to a phone,
// and 691 rows for a screen reader to walk past. A search is never cut:
// what it found is what you asked for.
const LETTER_AT_A_TIME_OVER = 150;

function glossaryListPage({
  user, pages = [], byPage = new Map(), heading = 'Glossary', q = '',
  kind = '', category = '', status = '', view = '', statusCounts = [], totalPages = 0, letter = '',
}) {
  const allLetters = taxonomy.groupByLetter(pages);
  const present = new Set(allLetters.map((l) => l.letter));
  const paged = !q && pages.length > LETTER_AT_A_TIME_OVER && allLetters.length > 1;
  const current = paged ? (present.has(letter) ? letter : allLetters[0].letter) : '';
  const letters = paged ? allLetters.filter((l) => l.letter === current) : allLetters;
  const hrefFor = (l) => {
    const params = new URLSearchParams();
    if (view) params.set('view', view);
    if (kind) params.set('kind', kind);
    if (category) params.set('category', category);
    if (status) params.set('status', status);
    params.set('letter', l);
    return `/glossary?${params.toString()}`;
  };
  const jump = taxonomy.ALPHABET.map((l) => {
    if (!present.has(l)) return `<span data-letter="${l}">${l}</span>`;
    if (!paged) return `<a href="#letter-${l === '#' ? 'num' : l}" data-letter="${l}">${l}</a>`;
    return `<a href="${escapeHtml(hrefFor(l))}" data-letter="${l}"${l === current ? ' aria-current="page" class="current"' : ''}>${l}</a>`;
  }).join('');
  const at = paged ? allLetters.findIndex((l) => l.letter === current) : -1;
  const prevLetter = at > 0 ? allLetters[at - 1].letter : null;
  const nextLetter = at >= 0 && at < allLetters.length - 1 ? allLetters[at + 1].letter : null;
  const letterNav = paged ? `
        <nav class="letter-steps" aria-label="Letters">
          ${prevLetter ? `<a href="${escapeHtml(hrefFor(prevLetter))}">&larr; ${prevLetter}</a>` : '<span></span>'}
          ${nextLetter ? `<a href="${escapeHtml(hrefFor(nextLetter))}">${nextLetter} &rarr;</a>` : '<span></span>'}
        </nav>` : '';

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

  const shownHere = paged ? letters[0].pages.length : pages.length;
  const count = paged
    ? `${shownHere} of ${pages.length} pages, under ${current === '#' ? 'a number' : current}`
    : `${pages.length} page${pages.length === 1 ? '' : 's'}`;
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
        <nav class="az-bar" aria-label="${paged ? 'Letters' : 'Jump to a letter'}">${jump}</nav>
        <div class="glossary-letters" id="glossary-list"${paged ? ' data-paged="1"' : ''}>${sections}</div>
        ${letterNav}
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

// A wiki page that is about something in the group -- a story that was
// brought in, or the writer of some -- says so at the top, with the way
// to it. The wiki's text stays as it is under it.
function inGroupNote(inGroup) {
  if (!inGroup) return '';
  const bits = [];
  for (const s of inGroup.stories) {
    bits.push(`<p><strong>This story is here.</strong> <a href="/stories/${s.id}">Read <em>${escapeHtml(s.title)}</em></a> &middot; ${s.chapters} chapter${s.chapters === 1 ? '' : 's'}, by <a href="/users/${encodeURIComponent(s.author_username)}">${escapeHtml(s.author_name)}</a>.</p>`);
  }
  const a = inGroup.author;
  if (a) {
    bits.push(`<p><strong>Their stories are here.</strong> <a href="/authors#a-${encodeURIComponent(a.username)}">${a.stories} ${a.stories === 1 ? 'story' : 'stories'} by ${escapeHtml(a.display_name)}</a>${a.claimed_by
      ? `, who is <a href="/users/${encodeURIComponent(a.claimed_by_username)}">${escapeHtml(a.claimed_by_name)}</a> in the group.`
      : '; nobody in the group has claimed them yet.'}</p>`);
  }
  return bits.length ? `<div class="glossary-in-group">${bits.join('')}</div>` : '';
}

function glossaryPage({ user, page, summaries = new Map(), categories = [], inGroup = null }) {
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
        ${page.story_id
    ? `<a class="btn ghost small" href="/stories/${Number(page.story_id)}">Open the story</a>`
    : `<a class="btn ghost small" href="${escapeHtml(wiki.pageUrl(page.title))}" target="_blank" rel="noopener noreferrer">Open on the wiki &#8599;</a>`}
      </div>
      <p class="muted glossary-meta">${page.story_id
    ? `Made from the story, which is in this group${page.fetched_at ? `; brought up to date ${timeHtml(page.fetched_at)}` : ''}.`
    : `A local copy${page.fetched_at ? `, last synced ${timeHtml(page.fetched_at)}` : ''}.`}</p>
      ${entryChips(categories)}
      ${inGroupNote(inGroup)}
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

// A glossary page as a card, for the column beside a chapter: the same
// shape as a bible entry's card (see besideEntityFragment) so a reader
// clicking a name gets one kind of thing, whether the name belongs to
// this story's bible or to the shared wiki.
function besideGlossaryFragment(page, { lead = '', categories = [] } = {}) {
  const topics = taxonomy.topicalCategories(categories).slice(0, 4);
  return `
    <h3>${escapeHtml(page.title)}</h3>
    <p class="muted">${page.story_id ? 'A story in this group' : 'From the glossary'}${topics.length ? ` &middot; ${topics.map((c) => escapeHtml(c)).join(', ')}` : ''}</p>
    ${page.summary ? `<p class="summary">${escapeHtml(page.summary)}</p>` : ''}
    ${lead
    ? `<div class="reading-pane beside-reading">${lead}</div>`
    : '<p class="muted">This page has not been copied across from the wiki yet.</p>'}`;
}


// ---------- the story bible ----------

module.exports = {
  besideGlossaryFragment,
  entryChips,
  glossaryDirectoryPage,
  glossaryIntro,
  glossaryListPage,
  glossaryNotFoundPage,
  glossaryPage,
  glossaryPreviewCards,
  glossarySearchForm,
  glossaryStatusFilters,
  markFirstGlossaryLinks,
};
