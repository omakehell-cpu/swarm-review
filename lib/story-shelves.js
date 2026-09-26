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
  complete: { label: 'Finished', states: ['complete'] },
  dropped: { label: 'Set aside', states: ['dropped'] },
  all: { label: 'All', states: null },
};
const SHELF_ORDER = ['writing', 'complete', 'dropped', 'all'];
const DEFAULT_SHELF = 'writing';
const PAGE_SIZE = 30;

const ORIGINS = { here: 'Written here', imported: 'From StoriesOnline' };

// How long, for the advanced search: in words, which is what a reader
// deciding whether they have an evening or a month is really asking.
const LENGTHS = {
  short: { label: 'Short (under 10k words)', test: (w) => w < 10000 },
  medium: { label: 'Medium (10k to 50k)', test: (w) => w >= 10000 && w < 50000 },
  long: { label: 'Long (50k to 150k)', test: (w) => w >= 50000 && w < 150000 },
  epic: { label: 'Very long (150k and up)', test: (w) => w >= 150000 },
};

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
 *           author?: string, length?: string, onlyIds?: Set<number>|null,
 *           tagsByStory?: Map<number, any[]>, coauthorsByStory?: Map<number, any[]> }} opts
 */
function shelve(stories, opts = {}) {
  const fallback = SHELVES[opts.defaultShelf || ''] ? String(opts.defaultShelf) : DEFAULT_SHELF;
  const shelf = SHELVES[opts.shelf || ''] ? String(opts.shelf) : fallback;
  const words = fold(opts.q).split(/\s+/).filter(Boolean);
  const origin = ORIGINS[opts.origin || ''] ? String(opts.origin) : '';
  const series = String(opts.series || '').trim();
  const author = fold(opts.author).trim();
  const length = LENGTHS[opts.length || ''] ? String(opts.length) : '';
  const onlyIds = opts.onlyIds || null;
  const tagsFor = (s) => (opts.tagsByStory && opts.tagsByStory.get(s.id)) || [];
  const coauthorsFor = (s) => (opts.coauthorsByStory && opts.coauthorsByStory.get(s.id)) || [];

  // Every filter but the shelf, so each shelf can say how many it holds
  // for this search -- a search that finds nothing being written can
  // still point at the three complete stories it did find.
  const matching = stories.filter((s) => {
    if (origin === 'here' && isImported(s)) return false;
    if (origin === 'imported' && !isImported(s)) return false;
    if (series && fold(s.series) !== fold(series)) return false;
    if (onlyIds && !onlyIds.has(s.id)) return false;
    if (length && !LENGTHS[length].test(Number(s.word_count) || 0)) return false;
    if (author && !fold([s.author_name, ...coauthorsFor(s).map((c) => c.display_name)].join(' ')).includes(author)) return false;
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
    shelf, defaultShelf: fallback, q: String(opts.q || '').trim(), origin, series, author: String(opts.author || '').trim(), length,
    counts,
    total: onShelf.length,
    stories: onShelf.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    page, pages,
    seriesList,
    hasImported: stories.some(isImported),
  };
}

module.exports = { DEFAULT_SHELF, LENGTHS, ORIGINS, PAGE_SIZE, SHELVES, SHELF_ORDER, isImported, searchText, shelfOf, shelve };
