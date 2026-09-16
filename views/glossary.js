'use strict';

const { layout } = require('../lib/layout');
const { escapeHtml } = require('../lib/util');
const { timeHtml } = require('../lib/time');
const { taxonomy, wiki } = require('./shared');
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

module.exports = {
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
