'use strict';

// The wiki files its pages under its own categories, and those categories
// are three different things wearing the same hat:
//
//   * what a page IS      -- Stories (314 of them), Authors (66)
//   * what it is ABOUT    -- Navy, Colonies, Culture, Ship Technology...
//   * what STATE it is in -- Canon, Stubs, Temporary, In Progress
//
// Shown as one flat row of chips sorted by size, the biggest chips are the
// ones nobody wants (`All` covers every page and filters nothing) and the
// half of the glossary that is story and author stubs swamps the actual
// world terms. This module is the one place that knows which category is
// which kind of thing, so the views can sort them into separate axes
// instead of one undifferentiated pile.
//
// Everything here is pure: it takes category names and returns category
// names. It never touches the database, so it can be unit-tested against
// the real 84-category list without a fixture wiki.

// `All` is the wiki's own catch-all. It is on every page by construction,
// so it can never tell two pages apart.
const STRUCTURAL_CATEGORIES = ['All'];

// The two categories that say what a page is rather than what it is about.
const KIND_CATEGORIES = { authors: 'Authors', stories: 'Stories' };

const KINDS = ['world', 'stories', 'authors'];

const KIND_LABELS = {
  world: 'The world',
  stories: 'Stories',
  authors: 'Authors',
};

const KIND_BLURBS = {
  world: 'Ships, places, factions, technology -- the shared setting itself.',
  stories: 'One page per story on the wiki, linking back to where it lives.',
  authors: 'Who wrote what.',
};

// How finished the page is, not what it covers. These get their own row so
// they stop competing with Navy and Culture for attention.
const STATUS_CATEGORIES = ['Canon', 'In Progress', 'Stubs', 'Temporary', 'Discussion'];

// Housekeeping the wiki does on itself. Real, but nobody reading a glossary
// is looking for them, so they stay folded away unless asked for.
const MAINTENANCE_CATEGORIES = [
  'Wiki Maintenance',
  'Duplicate',
  'Useless',
  'Pages with broken file links',
  'Disambiguation Pages',
];

// The topical categories, gathered into the handful of families a reader
// would actually browse by. Order is deliberate: the ones this universe is
// mostly made of come first. A category the wiki invents later that is not
// listed here still shows up -- under `Other` -- rather than vanishing.
const FAMILIES = [
  {
    name: 'Fleet and ships',
    categories: [
      'Ships', 'Warships', 'Small Craft', 'Fleet Auxiliary', 'Support Ships',
      'Pod Carriers', 'Carriers', 'Cruisers', 'Battlecruisers', 'Battleships',
      'Destroyers', 'Frigates', 'Corvettes', 'Assault Ships', 'Merchant Ships',
      'Unmanned Vessels', "Sa'arm Ships", 'Ship Operation', 'Ship Technology',
    ],
  },
  {
    name: 'Military',
    categories: [
      'Navy', 'Marines', 'Militia', 'Confederacy Military',
      'Military Organizational Structure', 'Titles and Positions',
      'Naval Weapon Systems', 'Infantry Weapons', 'Missiles', "Sa'arm Weapons",
      'Battles', 'Naval Battles', 'Land Battles',
    ],
  },
  {
    name: 'Factions and peoples',
    categories: [
      'Confederacy', "Sa'arm", 'Races', 'Heresy', 'Cosca', 'Earth First',
      'Japanese Empire', 'Governors', 'Story Characters',
    ],
  },
  {
    name: 'Worlds and places',
    categories: [
      'Colonies', 'Non-Confederacy Colonies', 'Lost Colonies', 'Systems',
      'Earthat System', 'Contested Systems', "Sa'arm Worlds", 'Earth',
      'UK', 'California', 'Canada', 'China',
    ],
  },
  {
    name: 'Society and government',
    categories: [
      'Government', 'Civil Service', 'Law and Justice', 'Confederacy Procedures',
      'Economy', 'Education & Training', 'Medical', 'Social Issues', 'Culture',
      'History',
    ],
  },
  {
    name: 'Technology',
    categories: [
      'Technology', 'FTL Technologies', 'Communication', 'Time and Distance',
      'Gear and Equipment',
    ],
  },
  {
    name: 'About the wiki',
    categories: ['List of Lists', 'Commentary & Rants', 'Humor'],
  },
];

const OTHER_FAMILY = 'Other';

const lower = (s) => String(s || '').toLowerCase();
const setOf = (names) => new Set(names.map(lower));

const STRUCTURAL_SET = setOf(STRUCTURAL_CATEGORIES);
const STATUS_SET = setOf(STATUS_CATEGORIES);
const MAINTENANCE_SET = setOf(MAINTENANCE_CATEGORIES);
const KIND_SET = setOf(Object.values(KIND_CATEGORIES));

const FAMILY_OF = new Map();
for (const family of FAMILIES) {
  for (const category of family.categories) FAMILY_OF.set(lower(category), family.name);
}

const isStructural = (category) => STRUCTURAL_SET.has(lower(category));
const isStatus = (category) => STATUS_SET.has(lower(category));
const isMaintenance = (category) => MAINTENANCE_SET.has(lower(category));
const isKind = (category) => KIND_SET.has(lower(category));

/** Everything that is neither a kind, a state, housekeeping, nor `All`. */
const isTopical = (category) => !isStructural(category) && !isStatus(category)
  && !isMaintenance(category) && !isKind(category);

const familyOf = (category) => FAMILY_OF.get(lower(category)) || OTHER_FAMILY;

/**
 * What a page is, from the categories it carries. A page filed under both
 * Authors and Stories is an author page that happens to list their stories,
 * so Authors wins; everything the wiki has not labelled is a world term,
 * which is the right default for a glossary of a shared setting.
 * @param {string[]} categories
 * @returns {'world'|'stories'|'authors'}
 */
function pageKind(categories) {
  const own = setOf(categories || []);
  if (own.has(lower(KIND_CATEGORIES.authors))) return 'authors';
  if (own.has(lower(KIND_CATEGORIES.stories))) return 'stories';
  return 'world';
}

/** The topical categories of one page, in the order they arrived. */
const topicalCategories = (categories) => (categories || []).filter(isTopical);

/** The state categories of one page. */
const statusCategories = (categories) => (categories || []).filter(isStatus);

/**
 * Gathers `[{ category, n }]` counts into the browsable families, dropping
 * the categories that are not topics at all. Families keep their declared
 * order; inside one, the biggest category comes first because that is the
 * likeliest thing to be looking for.
 * @param {{category: string, n: number}[]|any[]} counts
 * @param {{ includeMaintenance?: boolean }} [opts]
 */
function groupIntoFamilies(counts, opts = {}) {
  const buckets = new Map();
  for (const row of counts || []) {
    const keep = opts.includeMaintenance
      ? !isStructural(row.category) && !isStatus(row.category) && !isKind(row.category)
      : isTopical(row.category);
    if (!keep) continue;
    const name = isMaintenance(row.category) ? 'Wiki housekeeping' : familyOf(row.category);
    if (!buckets.has(name)) buckets.set(name, []);
    buckets.get(name).push({ category: row.category, n: row.n });
  }
  const order = [...FAMILIES.map((f) => f.name), OTHER_FAMILY, 'Wiki housekeeping'];
  return order
    .filter((name) => buckets.has(name))
    .map((name) => ({
      name,
      categories: buckets.get(name).sort((a, b) => b.n - a.n
        || a.category.localeCompare(b.category, undefined, { sensitivity: 'base' })),
      total: buckets.get(name).reduce((sum, c) => sum + c.n, 0),
    }));
}

/**
 * The bucket a title sorts into in an A-Z listing. Anything that does not
 * start with a letter -- "8tdeucemedic", "131 Flavors" -- goes under `#`
 * rather than making a section of its own per digit.
 */
function letterOf(title) {
  const first = String(title || '').trim().charAt(0).toUpperCase();
  return first >= 'A' && first <= 'Z' ? first : '#';
}

const ALPHABET = ['#', ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))];

/**
 * Cuts a sorted page list into A-Z sections, keeping only the letters that
 * actually have pages -- an empty `Q` section is a hole, not information.
 * @param {any[]} pages
 */
function groupByLetter(pages) {
  const buckets = new Map();
  for (const page of pages || []) {
    const letter = letterOf(page.title);
    if (!buckets.has(letter)) buckets.set(letter, []);
    buckets.get(letter).push(page);
  }
  return ALPHABET.filter((l) => buckets.has(l)).map((letter) => ({ letter, pages: buckets.get(letter) }));
}

/**
 * The one filter the glossary index runs, so the route handler does not
 * grow its own copy. `byPage` maps title_lower to that page's categories.
 * @param {any[]} pages
 * @param {Map<string, string[]>} byPage
 * @param {{ kind?: string, category?: string, status?: string, q?: string }} filters
 */
function selectPages(pages, byPage, filters = {}) {
  const { kind, category, status, q } = filters;
  const needle = String(q || '').trim().toLowerCase();
  return (pages || []).filter((page) => {
    const own = byPage.get(page.title_lower) || [];
    if (kind && KINDS.includes(kind) && pageKind(own) !== kind) return false;
    if (category && !own.some((c) => lower(c) === lower(category))) return false;
    if (status && !own.some((c) => lower(c) === lower(status))) return false;
    if (needle && !page.title.toLowerCase().includes(needle)
      && !String(page.summary || '').toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** How many pages of each kind there are, for the front page's three doors. */
function countKinds(pages, byPage) {
  const counts = { world: 0, stories: 0, authors: 0 };
  for (const page of pages || []) counts[pageKind(byPage.get(page.title_lower) || [])] += 1;
  return counts;
}

/**
 * The state filters worth offering for a given set of pages, with their
 * counts -- a state nothing in view carries is not offered at all.
 */
function statusCounts(pages, byPage) {
  const counts = new Map(STATUS_CATEGORIES.map((c) => [c, 0]));
  for (const page of pages || []) {
    for (const c of byPage.get(page.title_lower) || []) {
      if (counts.has(c)) counts.set(c, counts.get(c) + 1);
    }
  }
  return STATUS_CATEGORIES.map((category) => ({ category, n: counts.get(category) })).filter((c) => c.n > 0);
}

module.exports = {
  ALPHABET,
  FAMILIES,
  KINDS,
  KIND_BLURBS,
  KIND_CATEGORIES,
  KIND_LABELS,
  MAINTENANCE_CATEGORIES,
  OTHER_FAMILY,
  STATUS_CATEGORIES,
  STRUCTURAL_CATEGORIES,
  countKinds,
  familyOf,
  groupByLetter,
  groupIntoFamilies,
  isKind,
  isMaintenance,
  isStatus,
  isStructural,
  isTopical,
  letterOf,
  pageKind,
  selectPages,
  statusCategories,
  statusCounts,
  topicalCategories,
};
