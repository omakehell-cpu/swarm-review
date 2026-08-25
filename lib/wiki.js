// lib/wiki.js -- syncs a local, cached index of the shared-universe wiki's
// page titles + short summaries (models.js's wiki_pages table), and turns
// that index into a matcher chapter text is scanned against to auto-link
// character/place/ship names to their wiki page (see lib/markdown.js's
// renderHighlighted). Talks to the wiki only during a sync -- rendering a
// chapter never makes an external request, so it never depends on the
// wiki being reachable.
//
// Uses only the wiki's public MediaWiki API (api.php), which needs no
// authentication for a public wiki like this one, and Node's built-in
// fetch (stable since Node 18) -- no HTTP client dependency.
'use strict';

const models = require('../models');

const WIKI_BASE_URL = (process.env.WIKI_BASE_URL || 'https://tampaad.net').replace(/\/+$/, '');
const WIKI_API_URL = `${WIKI_BASE_URL}/api.php`;

// A title shorter than this is skipped entirely when building the index --
// not a defense against every possible false positive (the reader's own
// "Wiki links" toggle, see writing-analyzer.js, is what's actually relied
// on for that), just a minimum sanity floor against single-letter or
// two-letter disambiguation-stub titles that would otherwise turn almost
// any short word into a link.
const MIN_TITLE_LENGTH = 3;

function pageUrl(title) {
  return `${WIKI_BASE_URL}/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}`;
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

async function fetchSummaries(titles) {
  const summaries = new Map();
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
      summaries.set(page.title, wikitextToSummary(wikitext, 220));
    }
  }
  return summaries;
}

// ---------------------------------------------------------------------
// sync entry point
// ---------------------------------------------------------------------
let syncInFlight = null;

// Fetches the full page list + a summary for each, and replaces the local
// index in one go. Coalesces concurrent calls (the daily timer and an
// admin clicking "Sync now" at the same moment) into a single run rather
// than racing two syncs against the wiki and the database.
async function syncWikiIndex() {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const titles = await fetchAllTitles();
    const eligible = titles.filter((t) => t.length >= MIN_TITLE_LENGTH);
    const summaries = await fetchSummaries(eligible);
    const pages = eligible.map((title) => ({ title, summary: summaries.get(title) || '' }));
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
  const byLowerTitle = new Map(rows.map((r) => [r.title_lower, { title: r.title, summary: r.summary, url: pageUrl(r.title) }]));
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
};
