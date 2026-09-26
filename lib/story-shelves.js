'use strict';

// The front page's list, once there are more stories than fit on a screen.
//
// Three shelves, by where a story is: being written (ongoing, or quiet for
// a while), complete, and set aside. A reader looking for something to
// follow and a reader looking for something finished to sit down with are
// asking different questions, and one long list answers neither. Then the
// things a big list needs: a search that reaches every story, not just the
// ones on the screen; where it was written (here, or brought in from
// StoriesOnline); a series; and pages.
//
// Pure: it takes the stories the page already has and returns what to
// show, so the rules can be tested without a server.

const { storyState } = require('./story-state');

const SHELVES = {
  writing: { label: 'Being written', states: ['ongoing', 'hiatus'] },
  complete: { label: 'Complete', states: ['complete'] },
  dropped: { label: 'Set aside', states: ['dropped'] },
  all: { label: 'All', states: null },
};
const SHELF_ORDER = ['writing', 'complete', 'dropped', 'all'];
const DEFAULT_SHELF = 'writing';
const PAGE_SIZE = 30;

const ORIGINS = { here: 'Written here', imported: 'From StoriesOnline' };

// Brought in from StoriesOnline: it says where from, or at least when it
// came (a few EPUBs carry no link back).
const isImported = (s) => Boolean(s.source_url || s.imported_at);

const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Which shelf a story sits on. */
function shelfOf(story) {
  const state = storyState(story);
  if (state === 'complete') return 'complete';
  if (state === 'dropped') return 'dropped';
  return 'writing';
}

/**
 * Everything a story can be found by, folded: title, author and coauthors,
 * blurb, series, tags. Accents do not matter: "emile" finds Émile.
 */
function searchText(story, { tags = [], coauthors = [] } = {}) {
  return fold([
    story.title, story.author_name, story.description, story.series,
    ...coauthors.map((c) => c.display_name), ...tags.map((t) => t.name),
  ].filter(Boolean).join(' '));
}

/**
 * @param {any[]} stories
 * @param {{ shelf?: string, q?: string, origin?: string, series?: string, page?: number, defaultShelf?: string,
 *           tagsByStory?: Map<number, any[]>, coauthorsByStory?: Map<number, any[]> }} opts
 */
function shelve(stories, opts = {}) {
  const fallback = SHELVES[opts.defaultShelf || ''] ? String(opts.defaultShelf) : DEFAULT_SHELF;
  const shelf = SHELVES[opts.shelf || ''] ? String(opts.shelf) : fallback;
  const words = fold(opts.q).split(/\s+/).filter(Boolean);
  const origin = ORIGINS[opts.origin || ''] ? String(opts.origin) : '';
  const series = String(opts.series || '').trim();
  const tagsFor = (s) => (opts.tagsByStory && opts.tagsByStory.get(s.id)) || [];
  const coauthorsFor = (s) => (opts.coauthorsByStory && opts.coauthorsByStory.get(s.id)) || [];

  // Every filter but the shelf, so each shelf can say how many it holds
  // for this search -- a search that finds nothing being written can
  // still point at the three complete stories it did find.
  const matching = stories.filter((s) => {
    if (origin === 'here' && isImported(s)) return false;
    if (origin === 'imported' && !isImported(s)) return false;
    if (series && fold(s.series) !== fold(series)) return false;
    if (!words.length) return true;
    const text = searchText(s, { tags: tagsFor(s), coauthors: coauthorsFor(s) });
    return words.every((w) => text.includes(w));
  });

  const counts = Object.fromEntries(SHELF_ORDER.map((k) => [k, 0]));
  for (const s of matching) { counts[shelfOf(s)] += 1; counts.all += 1; }

  const onShelf = shelf === 'all' ? matching : matching.filter((s) => shelfOf(s) === shelf);

  // The series on this shelf, biggest first: the handful worth a chip.
  const seriesCounts = new Map();
  for (const s of (shelf === 'all' ? stories : stories.filter((x) => shelfOf(x) === shelf))) {
    if (s.series) seriesCounts.set(s.series, (seriesCounts.get(s.series) || 0) + 1);
  }
  const seriesList = Array.from(seriesCounts, ([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

  const pages = Math.max(1, Math.ceil(onShelf.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(opts.page) || 1)));
  return {
    shelf, defaultShelf: fallback, q: String(opts.q || '').trim(), origin, series,
    counts,
    total: onShelf.length,
    stories: onShelf.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    page, pages,
    seriesList,
    hasImported: stories.some(isImported),
  };
}

/**
 * A few stories to try, for the "Something to read" row: from the
 * library, not by this reader, not begun by them. The same ones all day
 * and different tomorrow -- a row that changes on every reload is noise,
 * one that never changes is wallpaper.
 * @param {any[]} stories
 * @param {{ userId: number, readStoryIds?: Set<number>, day?: string, n?: number }} opts
 */
function discoverPicks(stories, { userId, readStoryIds = new Set(), day = new Date().toISOString().slice(0, 10), n = 4 }) {
  const seed = `${day}:${userId}`;
  const score = (id) => {
    // FNV-1a over the day, the reader and the story: cheap, and stable.
    let h = 2166136261;
    for (const ch of `${seed}:${id}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h;
  };
  return stories
    .filter((s) => isImported(s) && s.author_id !== userId && !readStoryIds.has(s.id) && s.chapter_count > 0)
    .map((s) => ({ s, k: score(s.id) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, n)
    .map((x) => x.s);
}

module.exports = { DEFAULT_SHELF, ORIGINS, PAGE_SIZE, SHELVES, SHELF_ORDER, discoverPicks, isImported, searchText, shelfOf, shelve };
