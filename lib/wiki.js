// lib/wiki.js -- syncs a local, cached copy of the shared-universe wiki
// (models.js's wiki_pages table: every page's title, a short summary, and
// its full rendered content) and turns that index into two things: (1) a
// matcher chapter text is scanned against to auto-link character/place/ship
// names to their wiki page (see lib/markdown.js's renderHighlighted), and
// (2) the in-app "Glossary" section (see server.js's /glossary routes),
// which lets the whole shared-universe wiki be read from inside this app
// even if the wiki itself is slow, unreachable, or offline. Talks to the
// wiki only during a sync -- rendering a chapter, or a glossary page,
// never makes an external request, so neither ever depends on the wiki
// being reachable at that moment.
//
// Uses only the wiki's public MediaWiki API (api.php), which needs no
// authentication for a public wiki like this one, and Node's built-in
// fetch (stable since Node 18) -- no HTTP client dependency.
'use strict';

const models = require('../models');
const { escapeHtml } = require('./util');

const WIKI_BASE_URL = (process.env.WIKI_BASE_URL || 'https://swarmwiki.tampaad.net').replace(/\/+$/, '');
const WIKI_API_URL = `${WIKI_BASE_URL}/api.php`;

// A title shorter than this is skipped entirely when building the index --
// not a defense against every possible false positive (the reader's own
// "Wiki links" toggle, see writing-analyzer.js, is what's actually relied
// on for that), just a minimum sanity floor against single-letter or
// two-letter disambiguation-stub titles that would otherwise turn almost
// any short word into a link.
const MIN_TITLE_LENGTH = 3;

// The external wiki's own page for a title -- used for the auto-link
// hover-preview URL, and as the glossary's fallback link for any title
// this sync doesn't (or can't) have a local copy of.
function pageUrl(title) {
  return `${WIKI_BASE_URL}/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

// This app's own copy of a page, inside the Glossary section.
function glossaryUrl(title) {
  return `/glossary/${encodeURIComponent(title)}`;
}

// ---------------------------------------------------------------------
// wikitext -> short plain-text summary
// ---------------------------------------------------------------------
// MediaWiki's TextExtracts extension (which would normally do this
// cleanly server-side) isn't installed on this wiki, so this works from
// the raw wikitext instead -- good enough to be readable in a hover
// tooltip, not a general-purpose wikitext renderer.
function wikitextToSummary(wikitext, maxLen) {
  let text = String(wikitext || '')
    .replace(/^==+.*==+\s*$/gm, ' ') // section headings
    .replace(/\{\{[^{}]*\}\}/g, ' ') // simple (non-nested) templates/infoboxes
    .replace(/\[\[[^\]|[]*\|([^\]]+)\]\]/g, '$1') // [[Target|shown text]] -> shown text
    .replace(/\[\[([^\]]+)\]\]/g, '$1') // [[Target]] -> Target
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1') // [http://... label] -> label
    .replace(/'''''([^']+)'''''/g, '$1')
    .replace(/'''([^']+)'''/g, '$1')
    .replace(/''([^']+)''/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]+>/g, ' ') // any other stray HTML/wiki tag
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > maxLen) {
    text = `${text.slice(0, maxLen).replace(/\s+\S*$/, '')}…`;
  }
  return text;
}

// ---------------------------------------------------------------------
// wikitext -> full HTML, for the Glossary section
// ---------------------------------------------------------------------
// Same philosophy as wikitextToSummary above: good enough to be a
// pleasant, readable glossary page, not a general-purpose (or spec-
// accurate) wikitext parser. Templates/infoboxes, tables, and nested
// markup beyond what's handled below are simply dropped rather than
// guessed at -- a missing infobox is a much smaller problem than a
// mangled page.
//
// The one thing this genuinely cares about getting right is internal
// links: [[Some Page]] becomes a link to this app's own /glossary/Some_Page
// when "Some Page" is one of the titles this sync knows about, so the
// glossary ends up interlinked the same way the wiki itself is, instead of
// bouncing the reader back out to the external wiki for every link. A
// title this sync *doesn't* know about (a red link, a page in a namespace
// this app doesn't index, or simply a page that failed to load this run)
// still gets a working link -- just back to the original wiki, opened in
// a new tab, so it's never a dead end.
//
// `knownTitlesLower` is a Map<lowercased title, canonical title> built
// from the full page list *before* any content is fetched (see
// syncWikiIndex below), so link resolution never depends on fetch order.
// A place to park finished HTML while the text around it is still being
// escaped and chopped into blocks. The marker is a string that cannot
// sensibly occur in wikitext, so it can never be mistaken for content.
const STASH_OPEN = '@@wstash';
const STASH_CLOSE = '@@';
function makeStash() {
  const items = [];
  return {
    put(html, block) { items.push({ html, block: Boolean(block) }); return `${STASH_OPEN}${items.length - 1}${STASH_CLOSE}`; },
    get(i) { return items[Number(i)]; },
    // True if `text` leads with a placeholder standing in for a
    // block-level element -- such a line must not be wrapped in <p>.
    startsBlock(text) {
      const m = text.trim().match(/^@@wstash(\d+)@@/);
      return Boolean(m && items[Number(m[1])] && items[Number(m[1])].block);
    },
    restore(text) {
      return text.replace(/@@wstash(\d+)@@/g, (m, i) => (items[Number(i)] ? items[Number(i)].html : ''));
    },
  };
}

// This wiki's pages are written with a lot of plain HTML mixed into the
// wikitext -- <b> far more often than the wiki's own bold markup, plus
// <h3>/<h4> headings, <hr> rules and hand-built <table>s. MediaWiki
// renders those, so escaping them (which is what a naive "escape
// everything, then add our own tags" pass does) put literal "<b>" all
// over the glossary. These tags are let through; anything not on this
// list is still escaped and shown as text, and every attribute is
// dropped except the two that tables need to keep their shape.
const ALLOWED_HTML_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'sup', 'sub',
  'small', 'big', 'code', 'tt', 'kbd', 'abbr', 'cite', 'q', 'span', 'br',
  'hr', 'p', 'div', 'center', 'blockquote', 'pre',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
]);
const BLOCK_HTML_TAGS = new Set([
  'hr', 'p', 'div', 'center', 'blockquote', 'pre',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
]);
const KEPT_ATTRS = new Set(['colspan', 'rowspan']);

// Named entities worth understanding, written out as characters before
// escaping: "&nbsp;" in the source should end up as a non-breaking space,
// not as the visible text "&nbsp;" (escapeHtml would otherwise turn its
// "&" into "&amp;" and freeze it that way).
const ENTITIES = {
  nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', times: '×', middot: '·',
  deg: '°', frac12: '½', prime: '′', Prime: '″',
  quot: '"', apos: "'", amp: '&',
};

function decodeEntities(text) {
  return text
    .replace(/&#(\d{1,6});/g, (m, n) => {
      const code = Number(n);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    })
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    // Note "&lt;" and "&gt;" are deliberately NOT decoded: an author who
    // escaped an angle bracket meant it as a visible character, and
    // turning it back into one here would hand stashHtmlTags a tag that
    // was never supposed to be markup.
    .replace(/&(nbsp|mdash|ndash|hellip|laquo|raquo|ldquo|rdquo|lsquo|rsquo|times|middot|deg|frac12|prime|Prime|quot|apos|amp);/g,
      (m, name) => ENTITIES[name] || m);
}

function renderInline(escapedText, knownTitlesLower) {
  const stashed = [];
  function stash(html) {
    stashed.push(html);
    return `@@wsinline${stashed.length - 1}@@`;
  }

  let text = escapedText;

  // [[Target]], [[Target|Label]], and [[Target|]] -- that last one is
  // MediaWiki's "pipe trick", an empty label meaning "use the target".
  // File/Image/Category links carry no renderable content here (no image
  // hosting, and categories are wiki bookkeeping), so they're dropped
  // rather than linked to nothing.
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (whole, rawTarget, rawLabel) => {
    const target = rawTarget.trim();
    if (/^(File|Image|Archivo|Imagen|Category|Categor[ií]a):/i.test(target)) return '';
    const display = ((rawLabel === undefined ? '' : rawLabel).trim()) || target;
    const titleForUrl = target.replace(/_/g, ' ');
    const known = knownTitlesLower.get(titleForUrl.toLowerCase());
    return known
      ? stash(`<a href="${glossaryUrl(known)}">${display}</a>`)
      : stash(`<a href="${pageUrl(titleForUrl)}" class="wiki-external" target="_blank" rel="noopener noreferrer">${display}</a>`);
  });

  // [http://... Label] and bare [http://...]
  text = text
    .replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, (m, url, label) => stash(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`))
    .replace(/\[(https?:\/\/[^\s\]]+)\]/g, (m, url) => stash(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));

  // Bare autolinked URLs (whatever's left -- the bracketed forms above
  // already consumed themselves, so this only catches plain https://...
  // sitting in running text).
  text = text.replace(/https?:\/\/[^\s<@]+/g, (m) => stash(`<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`));

  // Bold/italic -- longest delimiter first, same as wikitextToSummary.
  // Matched against the already-*escaped* text, so a literal apostrophe
  // is the 5-character entity "&#39;" here, not a raw "'" -- escapeHtml
  // also escapes "&" itself, so this can never collide with wikitext that
  // happened to contain the literal string "&#39;" (that would have come
  // out as "&amp;#39;" instead).
  text = text
    .replace(/(?:&#39;){5}([\s\S]+?)(?:&#39;){5}/g, '<strong><em>$1</em></strong>')
    .replace(/(?:&#39;){3}([\s\S]+?)(?:&#39;){3}/g, '<strong>$1</strong>')
    .replace(/(?:&#39;){2}([\s\S]+?)(?:&#39;){2}/g, '<em>$1</em>');

  return text.replace(/@@wsinline(\d+)@@/g, (m, i) => stashed[Number(i)]);
}

// Escape, then run the inline pass: the standard treatment for any run of
// raw text that should come out as prose with links and emphasis in it.
function inlineFromRaw(rawText, knownTitlesLower) {
  return renderInline(escapeHtml(rawText), knownTitlesLower);
}

// MediaWiki table syntax: {| ... |} with |- between rows, ! for header
// cells and | for ordinary ones, either one per line or several on a line
// separated by !! / ||. Only a handful of pages use it, but left alone it
// renders as a screenful of pipes and quotes. Each table is rendered
// whole and parked in the stash as a single block, so the paragraph logic
// further down never gets the chance to wrap <p> around half a table.
function convertTables(raw, stash, knownTitlesLower) {
  const lines = raw.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*\{\|/.test(lines[i])) { out.push(lines[i]); continue; }
    const rows = [];
    let caption = '';
    let row = null;
    let depth = 1;
    i += 1;
    for (; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*\{\|/.test(line)) { depth += 1; continue; } // nested table: drop its markup
      if (/^\s*\|\}/.test(line)) { depth -= 1; if (depth === 0) break; continue; }
      if (/^\s*\|\+/.test(line)) { caption = line.replace(/^\s*\|\+\s*/, ''); continue; }
      if (/^\s*\|-/.test(line)) { if (row) rows.push(row); row = []; continue; }
      const header = /^\s*!/.test(line);
      if (!header && !/^\s*\|/.test(line)) {
        // A continuation line belonging to the previous cell.
        if (row && row.length) row[row.length - 1].text += `\n${line}`;
        continue;
      }
      if (!row) row = [];
      const body = line.replace(/^\s*[|!]\s?/, '');
      for (const rawCell of body.split(header ? /\s*!!\s*/ : /\s*\|\|\s*/)) {
        // A cell may carry attributes ahead of a single pipe, as in
        // "scope='col' | ACRONYM" -- that part is styling, and goes.
        const split = rawCell.match(/^([^|[\]]*[='"][^|[\]]*)\|(?!\|)([\s\S]*)$/);
        const text = split ? split[2] : rawCell;
        row.push({ header, text: text.trim() });
      }
    }
    if (row) rows.push(row);
    const body = rows.filter((r) => r.length).map((r) => `<tr>${r.map((c) => {
      const tag = c.header ? 'th' : 'td';
      return `<${tag}>${inlineFromRaw(c.text, knownTitlesLower)}</${tag}>`;
    }).join('')}</tr>`).join('');
    if (body) {
      const cap = caption ? `<caption>${inlineFromRaw(caption, knownTitlesLower)}</caption>` : '';
      out.push(stash.put(`<div class="wiki-table-wrap"><table class="wiki-table">${cap}${body}</table></div>`, true));
    }
  }
  return out.join('\n');
}

// Pulls every allowed HTML tag out into the stash, rebuilt from the
// allowlist so whatever attributes and quoting the author used can't come
// through with it, leaving a placeholder behind. Everything still in the
// text after this can then be escaped without harming the markup that was
// meant to survive.
function stashHtmlTags(raw, stash) {
  return raw.replace(/<(\/?)\s*([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>])*?)\/?>/g, (whole, closing, name, attrs) => {
    const tag = name.toLowerCase();
    if (!ALLOWED_HTML_TAGS.has(tag)) return whole; // not ours: gets escaped, shows as text
    let kept = '';
    if (!closing) {
      for (const m of String(attrs).matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
        const attr = m[1].toLowerCase();
        if (!KEPT_ATTRS.has(attr)) continue;
        const value = (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || '').replace(/[^0-9]/g, '');
        if (value) kept += ` ${attr}="${value}"`;
      }
    }
    return stash.put(closing ? `</${tag}>` : `<${tag}${kept}>`, BLOCK_HTML_TAGS.has(tag));
  });
}

function wikitextToHtml(wikitext, knownTitlesLower) {
  const stash = makeStash();
  let raw = String(wikitext || '')
    .replace(/<!--[\s\S]*?-->/g, '') // HTML comments
    .replace(/<\s*\/?\s*nowiki\s*>/gi, ''); // keep the contents, drop the wrapper
  // Templates/infoboxes: {{...}} with no braces inside. Not recursive --
  // real nested templates need a real parser -- but running this a few
  // times peels off a couple of levels of shallow nesting (an infobox
  // whose parameters are themselves simple templates), which covers the
  // common case well enough.
  for (let pass = 0; pass < 3; pass += 1) raw = raw.replace(/\{\{[^{}]*\}\}/g, '');
  raw = decodeEntities(raw);
  raw = convertTables(raw, stash, knownTitlesLower);
  // <br> means "break the line here" to the block parser below, so it is
  // turned into a real newline rather than being stashed as a tag.
  raw = raw.replace(/<br\s*\/?>/gi, '\n');
  raw = stashHtmlTags(raw, stash);

  const escaped = escapeHtml(raw);
  const lines = escaped.split('\n');

  const blocks = [];
  let paragraph = [];
  let list = null; // { tag: 'ul' | 'ol', items: string[] }

  function flushParagraph() {
    const text = paragraph.join(' ').trim();
    paragraph = [];
    if (!text) return;
    // A run that leads with a block-level tag the author wrote themselves
    // (a heading, a rule, a table) is already a block: it gets no <p> of
    // its own, or the browser silently closes the paragraph early and the
    // nesting comes out wrong.
    blocks.push(stash.startsBlock(text)
      ? renderInline(text, knownTitlesLower)
      : `<p>${renderInline(text, knownTitlesLower)}</p>`);
  }
  function flushList() {
    if (!list) return;
    const items = list.items.map((item) => `<li>${renderInline(item, knownTitlesLower)}</li>`).join('');
    blocks.push(`<${list.tag}>${items}</${list.tag}>`);
    list = null;
  }

  for (const line of lines) {
    const headerMatch = line.match(/^(={2,6})\s*(.+?)\s*=+\s*$/);
    if (headerMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(headerMatch[1].length, 6);
      blocks.push(`<h${level}>${renderInline(headerMatch[2].trim(), knownTitlesLower)}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^[*]\s*(.+)$/);
    const numbered = !bullet && line.match(/^#\s*(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((bullet || numbered)[1]);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    // A line opening a block-level element ends whatever paragraph was
    // being collected, and stands on its own.
    if (stash.startsBlock(line)) {
      flushParagraph();
      flushList();
      blocks.push(renderInline(line.trim(), knownTitlesLower));
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();

  const html = stash.restore(blocks.join('\n'));
  // Last sweep: brackets left over from markup this converter doesn't
  // understand, or that the source itself never closed (there is an
  // unclosed "[[Absecon Class" in the real wiki as of this writing).
  // Better a plain name than a visible bracket.
  return html.replace(/\[\[|\]\]/g, '').trim()
    || '<p class="muted">(This page has no readable content.)</p>';
}

// ---------------------------------------------------------------------
// fetching from the wiki's API
// ---------------------------------------------------------------------
async function fetchAllTitles() {
  const titles = [];
  let apcontinue = null;
  for (;;) {
    const url = new URL(WIKI_API_URL);
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'allpages');
    url.searchParams.set('aplimit', '500');
    url.searchParams.set('format', 'json');
    if (apcontinue) url.searchParams.set('apcontinue', apcontinue);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Wiki API request failed (${res.status})`);
    const data = await res.json();
    for (const p of (data.query && data.query.allpages) || []) titles.push(p.title);
    apcontinue = data.continue && data.continue.apcontinue;
    if (!apcontinue) break;
  }
  return titles;
}

// The API's multi-title batch limit for non-bot accounts is 50.
const BATCH_SIZE = 50;

// Fetches each page's full wikitext (one request per BATCH_SIZE titles --
// the same requests this always made) and, from that single fetch, builds
// both the short summary (for auto-link tooltips) and the full rendered
// HTML (for the Glossary). `knownTitlesLower` must already contain every
// title from this sync (see syncWikiIndex) so that link resolution during
// rendering doesn't depend on which batch happens to run first.
async function fetchPageContent(titles, knownTitlesLower) {
  const content = new Map();
  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const batch = titles.slice(i, i + BATCH_SIZE);
    const url = new URL(WIKI_API_URL);
    url.searchParams.set('action', 'query');
    url.searchParams.set('prop', 'revisions');
    url.searchParams.set('rvprop', 'content');
    url.searchParams.set('rvslots', 'main');
    url.searchParams.set('titles', batch.join('|'));
    url.searchParams.set('format', 'json');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Wiki API request failed (${res.status})`);
    const data = await res.json();
    const pages = (data.query && data.query.pages) || {};
    for (const page of Object.values(pages)) {
      const slot = page.revisions && page.revisions[0] && page.revisions[0].slots && page.revisions[0].slots.main;
      const wikitext = slot && slot['*'];
      content.set(page.title, {
        summary: wikitextToSummary(wikitext, 220),
        contentHtml: wikitextToHtml(wikitext, knownTitlesLower),
      });
    }
  }
  return content;
}

// ---------------------------------------------------------------------
// sync entry point
// ---------------------------------------------------------------------
let syncInFlight = null;

// Fetches the full page list + full content for each, and replaces the
// local index in one go. Coalesces concurrent calls (the scheduled sync
// and an admin clicking "Sync now" at the same moment) into a single run
// rather than racing two syncs against the wiki and the database.
async function syncWikiIndex() {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const titles = await fetchAllTitles();
    const eligible = titles.filter((t) => t.length >= MIN_TITLE_LENGTH);
    const knownTitlesLower = new Map(eligible.map((t) => [t.toLowerCase(), t]));
    const content = await fetchPageContent(eligible, knownTitlesLower);
    const pages = eligible.map((title) => {
      const entry = content.get(title);
      return { title, summary: (entry && entry.summary) || '', contentHtml: (entry && entry.contentHtml) || '' };
    });
    models.replaceWikiPages(pages);
    invalidateMatcherCache();
    return { pageCount: pages.length };
  })()
    .then((result) => {
      models.setWikiSyncState({ status: 'ok', pageCount: result.pageCount });
      return result;
    })
    .catch((err) => {
      models.setWikiSyncState({ status: 'error', pageCount: 0, error: err.message });
      throw err;
    })
    .finally(() => { syncInFlight = null; });
  return syncInFlight;
}

// ---------------------------------------------------------------------
// in-memory matcher, rebuilt from the DB whenever the index changes (a
// sync) or lazily on first use (e.g. right after a server restart)
// ---------------------------------------------------------------------
let matcherCache = null;

function invalidateMatcherCache() {
  matcherCache = null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMatcher() {
  const rows = models.listWikiPages();
  if (!rows.length) return { regex: null, byLowerTitle: new Map() };
  // Longest title first, so e.g. "Confederacy Marines" matches whole
  // rather than just "Marines" inside it -- a regex alternation takes the
  // first alternative that matches at a given position, and a full match
  // there advances past the whole phrase, so the shorter alternative
  // never gets a chance to fire inside it during the same scan.
  const sorted = rows.slice().sort((a, b) => b.title.length - a.title.length);
  const pattern = sorted.map((r) => escapeRegExp(r.title)).join('|');
  const regex = new RegExp(`\\b(?:${pattern})\\b`, 'gi');
  // Auto-linked names point at this app's own glossary copy, not out at
  // the wiki: the whole reason the glossary exists is that a reader
  // shouldn't have to leave the chapter (or depend on the wiki being up)
  // to remember who somebody is. The glossary entry itself carries a link
  // on to the real wiki page for anyone who wants the source.
  const byLowerTitle = new Map(rows.map((r) => [r.title_lower, { title: r.title, summary: r.summary, url: glossaryUrl(r.title) }]));
  return { regex, byLowerTitle };
}

function getMatcher() {
  if (!matcherCache) matcherCache = buildMatcher();
  return matcherCache;
}

// Returns [{ start, end, title, summary, url }, ...] for every recognized
// wiki page name found in `text`, in order, non-overlapping (a longer
// match "claims" its whole span -- see buildMatcher's ordering above).
function findWikiMatches(text) {
  const { regex, byLowerTitle } = getMatcher();
  if (!regex) return [];
  const matches = [];
  regex.lastIndex = 0;
  let m;
  while ((m = regex.exec(text))) {
    const info = byLowerTitle.get(m[0].toLowerCase());
    if (info) matches.push({ start: m.index, end: m.index + m[0].length, ...info });
  }
  return matches;
}

module.exports = {
  WIKI_BASE_URL,
  syncWikiIndex,
  findWikiMatches,
  invalidateMatcherCache,
  wikitextToSummary,
  wikitextToHtml,
  glossaryUrl,
  pageUrl,
};
