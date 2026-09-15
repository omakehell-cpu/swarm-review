'use strict';

// The story bible: the people, places, groups, things and events one story
// is made of. This module is the part with no database in it -- what the
// kinds are, what a name matches, and how the text of a chapter turns into
// a list of who is in it. models.js does the storing; server.js does the
// asking; everything here is pure, so the matching rules can be tested
// against awkward real names ("Sa'arm", "O'Brien", "A-22") rather than
// against a fixture.
//
// Nothing here reaches the network. The scan reads text this app already
// has, and that is the whole of it.

const KINDS = ['person', 'place', 'group', 'thing', 'event'];

const KIND_LABELS = {
  person: 'Person', place: 'Place', group: 'Group', thing: 'Thing', event: 'Event',
};

const KIND_PLURALS = {
  person: 'People', place: 'Places', group: 'Groups', thing: 'Things', event: 'Events',
};

const KIND_BLURBS = {
  person: 'Anybody with a name and a pulse, or who had one.',
  place: 'Ships, stations, worlds, rooms -- anywhere a scene happens.',
  group: 'Crews, families, services, factions.',
  thing: 'Objects that matter: a weapon, a letter, a ring.',
  event: 'Battles, treaties, disasters -- the things people date their lives by.',
};

const DEFAULT_KIND = 'person';

// Status is a small fixed set because it is a filter ("who is still
// alive"), and a free-text field cannot be filtered on. Everything the set
// cannot say belongs in the description, which has no vocabulary at all.
const STATUSES = ['', 'alive', 'dead', 'missing', 'unknown'];
const STATUS_LABELS = {
  '': 'Not said', alive: 'Alive', dead: 'Dead', missing: 'Missing', unknown: 'Unknown',
};

const ROLES = ['', 'main', 'supporting', 'minor'];
const ROLE_LABELS = {
  '': 'Not said', main: 'Main', supporting: 'Supporting', minor: 'Minor',
};

const MAX_NAME_LENGTH = 120;
const MAX_ALIASES = 24;

// Two characters is the floor. Below that a name is not a name, it is a
// letter, and a letter turns every page of prose into an appearance.
const MIN_NAME_LENGTH = 2;

const oneOf = (list, value, fallback) => (list.includes(String(value || '')) ? String(value || '') : fallback);
const entityKind = (value) => oneOf(KINDS, value, DEFAULT_KIND);
const entityStatus = (value) => oneOf(STATUSES, value, '');
const entityRole = (value) => oneOf(ROLES, value, '');

/** Collapses whitespace and trims -- the same shape a name is stored in. */
function cleanName(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

const nameKey = (value) => cleanName(value).toLowerCase();

/**
 * The aliases as typed -- one per line, or comma-separated, because people
 * type both. Deduplicated case-insensitively, and never containing the
 * entry's own name twice over.
 * @param {string} raw
 * @param {string} [ownName]
 */
function parseAliases(raw, ownName = '') {
  const seen = new Set([nameKey(ownName)].filter(Boolean));
  const out = [];
  for (const piece of String(raw == null ? '' : raw).split(/[\n,]/)) {
    const alias = cleanName(piece);
    const key = alias.toLowerCase();
    if (!alias || alias.length < MIN_NAME_LENGTH || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
    if (out.length >= MAX_ALIASES) break;
  }
  return out;
}

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every name one entry answers to: its own, then its aliases.
 * @param {{name: string}} entity
 * @param {string[]} [aliases]
 */
function namesFor(entity, aliases = []) {
  const out = [];
  const seen = new Set();
  for (const value of [entity && entity.name, ...aliases]) {
    const name = cleanName(value);
    const key = name.toLowerCase();
    if (!name || name.length < MIN_NAME_LENGTH || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * One regex for the whole cast.
 *
 * Longest name first, so "Commodore Raye" wins over "Raye" standing inside
 * it -- an alternation takes the first branch that matches at a position,
 * and a full match advances past the whole phrase.
 *
 * A name two entries share is nobody's: counting it for both would put a
 * character in chapters they are not in, and picking one at random is
 * worse. Those names are dropped from the scan and reported in
 * `conflicts`, which is what the bible shows the author so they can add a
 * distinguishing alias.
 *
 * @param {{id: number, name: string, aliases?: string[]}[]|any[]} entities
 */
function buildMatcher(entities) {
  /** @type {Map<string, number|null>} */
  const owner = new Map();
  /** @type {Map<string, Set<number>>} */
  const claimants = new Map();
  for (const entity of entities || []) {
    for (const name of namesFor(entity, entity.aliases || [])) {
      const key = name.toLowerCase();
      if (!claimants.has(key)) claimants.set(key, new Set());
      claimants.get(key).add(entity.id);
      owner.set(key, entity.id);
    }
  }
  const conflicts = [];
  for (const [key, ids] of claimants) {
    if (ids.size > 1) { owner.set(key, null); conflicts.push({ name: key, entityIds: Array.from(ids) }); }
  }
  const usable = Array.from(owner.entries()).filter(([, id]) => id != null).map(([key]) => key);
  if (!usable.length) return { regex: null, owner, conflicts, byLower: new Map() };
  usable.sort((a, b) => b.length - a.length || a.localeCompare(b));
  // The boundaries are letters-and-digits rather than \b, so a possessive
  // ("Kessler's") still counts as naming her while a longer word that
  // merely starts the same way ("Kesslerian") does not.
  const pattern = usable.map(escapeRegExp).join('|');
  const regex = new RegExp(`(?<![A-Za-z0-9_])(?:${pattern})(?![A-Za-z0-9_])`, 'gi');
  const byLower = new Map(usable.map((key) => [key, owner.get(key)]));
  return { regex, owner, conflicts, byLower };
}

// Fenced code and inline code are not prose: a name inside them is a
// filename or a snippet, not somebody walking into a room.
function stripCode(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

/**
 * Who is named in one chapter's text.
 * @param {string} text
 * @param {{regex: RegExp|null, byLower: Map<string, number>}} matcher
 * @returns {Map<number, {mentions: number, firstName: string, firstIndex: number}>}
 */
function scanText(text, matcher) {
  const found = new Map();
  if (!matcher || !matcher.regex) return found;
  const prose = stripCode(text);
  matcher.regex.lastIndex = 0;
  let m;
  while ((m = matcher.regex.exec(prose))) {
    const id = matcher.byLower.get(m[0].toLowerCase());
    if (id == null) continue;
    const seen = found.get(id);
    if (seen) seen.mentions += 1;
    else found.set(id, { mentions: 1, firstName: m[0], firstIndex: m.index });
  }
  return found;
}

/**
 * The whole story in one pass: every chapter's text against the whole cast.
 * Returns the rows the appearance cache should hold -- the caller decides
 * what to do with them, so this stays testable without a database.
 * @param {{id: number, content: string}[]} chapters
 * @param {{id: number, name: string, aliases?: string[]}[]|any[]} entities
 */
function scanStory(chapters, entities) {
  const matcher = buildMatcher(entities);
  const rows = [];
  for (const chapter of chapters || []) {
    for (const [entityId, hit] of scanText(chapter.content, matcher)) {
      rows.push({
        entityId, chapterId: chapter.id, mentions: hit.mentions, firstName: hit.firstName,
      });
    }
  }
  return { rows, conflicts: matcher.conflicts };
}


const MAX_FIELD_LABEL = 60;
const MAX_FIELD_VALUE = 400;
const MAX_FIELDS = 40;

/** A field label is a label, not a paragraph, and it is how fields pair up. */
const cleanFieldLabel = (value) => String(value == null ? '' : value)
  .replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD_LABEL);

/**
 * The label/value rows a form posted, paired by position, trimmed, with
 * blanks and repeats dropped. A row with a label and no value is dropped
 * too: an empty template slot is a question nobody answered, not an
 * answer of "".
 * @param {string[]|string|undefined} labels
 * @param {string[]|string|undefined} values
 */
function parseFields(labels, values) {
  const labelList = [].concat(labels === undefined ? [] : labels);
  const valueList = [].concat(values === undefined ? [] : values);
  const seen = new Set();
  const out = [];
  for (let i = 0; i < labelList.length; i += 1) {
    const label = cleanFieldLabel(labelList[i]);
    const value = String(valueList[i] == null ? '' : valueList[i]).trim().slice(0, MAX_FIELD_VALUE);
    const key = label.toLowerCase();
    if (!label || !value || seen.has(key)) continue;
    seen.add(key);
    out.push({ label, value });
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

/** One label per line, the way the template editor takes them. */
function parseFieldTemplate(raw) {
  const seen = new Set();
  const out = [];
  for (const line of String(raw == null ? '' : raw).split(/[\n,]/)) {
    const label = cleanFieldLabel(line);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

/**
 * The form's rows for one entry: the template's fields in the template's
 * order (carrying whatever the entry already said), then the entry's own
 * extras, then blanks to type into.
 * @param {string[]} template
 * @param {{label: string, value: string}[]} fields
 * @param {number} [blanks]
 */
function fieldRows(template, fields, blanks = 3) {
  const byLabel = new Map((fields || []).map((f) => [f.label.toLowerCase(), f]));
  const rows = [];
  for (const label of template || []) {
    const key = label.toLowerCase();
    rows.push({ label, value: byLabel.has(key) ? byLabel.get(key).value : '', fromTemplate: true });
    byLabel.delete(key);
  }
  for (const field of byLabel.values()) rows.push({ label: field.label, value: field.value, fromTemplate: false });
  for (let i = 0; i < blanks; i += 1) rows.push({ label: '', value: '', fromTemplate: false });
  return rows;
}


// ---------- names the bible has not heard of ----------
// Writing down a cast of hundreds one form at a time is the thing nobody
// keeps doing, so the app reads the chapter and asks. This is a heuristic
// and says so: it offers candidates for one click, it never creates
// anything by itself.

// Words that start sentences, not people. Anything here is only ever
// dropped when it is capitalised because a sentence began, which is why
// the list can be short and still do its job.
const NOT_NAMES = new Set([
  'the', 'a', 'an', 'and', 'but', 'or', 'so', 'then', 'there', 'they', 'this', 'that',
  'these', 'those', 'he', 'she', 'it', 'we', 'you', 'i', 'his', 'her', 'their', 'its',
  'if', 'when', 'while', 'after', 'before', 'because', 'once', 'later', 'now', 'no',
  'not', 'nobody', 'nothing', 'somebody', 'something', 'someone', 'everything', 'everyone',
  'what', 'why', 'how', 'who', 'where', 'which', 'yes', 'maybe', 'perhaps', 'still',
  'even', 'only', 'just', 'all', 'both', 'every', 'each', 'another', 'other', 'some',
  'for', 'from', 'with', 'without', 'into', 'onto', 'over', 'under', 'up', 'down', 'out',
  'in', 'on', 'at', 'by', 'to', 'of', 'as', 'was', 'were', 'is', 'are', 'had', 'have',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'chapter', 'part', 'book', 'end', 'god', 'christ', 'ok', 'okay',
]);

// A capitalised word, or a run of adjacent ones: "Kestrel Anchorage",
// "Marta Sein". Deliberately not jumping a lowercase word to reach the
// next capital -- that would let "Suddenly the Kestrel Anchorage shook"
// become one candidate glued together by "the", and a sentence starting
// with an adverb is far commoner than a name with "of" in the middle. A
// name like "Order of the Silent Star" arrives in pieces, and whoever
// clicks one types the rest.
const NAME_RUN = /\b[A-Z][A-Za-z'’-]*(?:\s+[A-Z][A-Za-z'’-]*)*/g;

// What follows a final apostrophe tells you whether a capitalised word is
// a name at all. "Jack's" is Jack; "Don't" and "You're" are a verb with a
// capital letter because a sentence began. Real names keep their
// apostrophes ("O'Brien", "Sa'arm"), which is why this looks only at the
// short lowercase endings English contractions actually use.
const CONTRACTION_TAILS = new Set(['t', 'm', 'd', 're', 've', 'll']);

/**
 * Strips a possessive from a candidate and reports a contraction.
 * @returns {string|null} the name, or null if it was never a name
 */
function unpossess(word) {
  const m = /^(.*)['\u2019]([A-Za-z]{1,2})$/.exec(word);
  if (!m) return word;
  const tail = m[2].toLowerCase();
  if (tail === 's') return m[1] || null;
  return CONTRACTION_TAILS.has(tail) ? null : word;
}

// Prose only: no code, no URLs, no markdown link targets -- a capitalised
// word inside any of those is a filename, not somebody's name.
function proseOnly(text) {
  return stripCode(String(text || ''))
    .replace(/\]\([^)]*\)/g, '] ')
    .replace(/https?:\/\/\S+/g, ' ');
}

// True when this position is where a sentence starts, which is the one
// reason an ordinary word gets a capital letter.
function startsSentence(text, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (ch === ' ' || ch === '"' || ch === '“' || ch === '‘' || ch === "'"
      || ch === '(' || ch === '[' || ch === '>' || ch === '*' || ch === '_' || ch === '#') continue;
    return ch === '.' || ch === '!' || ch === '?' || ch === '\n' || ch === ':' || ch === ';';
  }
  return true;
}

/**
 * Proper names in this text that nothing in `known` accounts for.
 * `known` holds everything the app already recognises, lower-cased: the
 * bible's names and aliases, the glossary's page titles, the story's
 * dictionary.
 * @param {string} text
 * @param {Set<string>|string[]} [known]
 * @param {{ limit?: number }} [opts]
 * @returns {{name: string, count: number}[]}
 */
function findProperNames(text, known = new Set(), opts = {}) {
  const seen = known instanceof Set ? known : new Set((known || []).map((k) => String(k).toLowerCase()));
  const prose = proseOnly(text);
  /** @type {Map<string, {name: string, count: number, free: number, words: number}>} */
  const found = new Map();
  NAME_RUN.lastIndex = 0;
  let m;
  while ((m = NAME_RUN.exec(prose))) {
    let words = m[0].split(/\s+/);
    let atSentenceStart = startsSentence(prose, m.index);
    // "Suddenly the Kestrel Anchorage shook" is one run of capitals glued
    // to a real name by the word "the". The sentence-starter is peeled off
    // the front -- and what is left is no longer sentence-initial, which
    // is exactly why it is worth offering.
    while (atSentenceStart && words.length > 1 && NOT_NAMES.has(words[0].toLowerCase())) {
      words = words.slice(1);
      while (words.length > 1 && NOT_NAMES.has(words[0].toLowerCase())) words = words.slice(1);
      atSentenceStart = false;
    }
    // A trailing connector ("Marta of") belongs to the sentence, not the name.
    while (words.length > 1 && NOT_NAMES.has(words[words.length - 1].toLowerCase())) words = words.slice(0, -1);
    // "Jack's" is Jack, and must not become a second character standing
    // next to him in the list. "Don't" is not anybody.
    const stripped = words.map(unpossess);
    if (stripped.some((w) => w === null)) continue;
    words = /** @type {string[]} */ (stripped).filter(Boolean);
    if (!words.length) continue;
    const name = cleanName(words.join(' '));
    const key = name.toLowerCase();
    if (name.length < 3 || seen.has(key) || NOT_NAMES.has(key)) continue;
    const entry = found.get(key) || { name, count: 0, free: 0, words: words.length };
    entry.count += 1;
    if (!atSentenceStart) entry.free += 1;
    found.set(key, entry);
  }
  return Array.from(found.values())
    // It stood in the middle of a sentence somewhere, or it is two
    // capitalised words in a row (which an ordinary sentence opening is
    // not), or it opened so many sentences that the capital letter cannot
    // be punctuation alone. That last threshold is deliberately high: it
    // is the only route by which an ordinary word can get in, and on
    // seventy thousand words of real prose a low one lets through every
    // "Good", "People" and "Same" that ever started a paragraph.
    .filter((c) => c.free > 0 || c.words > 1 || c.count >= 5)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, opts.limit || 40)
    .map((c) => ({ name: c.name, count: c.count }));
}

module.exports = {
  unpossess,
  NOT_NAMES,
  findProperNames,
  MAX_FIELDS,
  MAX_FIELD_LABEL,
  MAX_FIELD_VALUE,
  cleanFieldLabel,
  fieldRows,
  parseFieldTemplate,
  parseFields,
  DEFAULT_KIND,
  KINDS,
  KIND_BLURBS,
  KIND_LABELS,
  KIND_PLURALS,
  MAX_ALIASES,
  MAX_NAME_LENGTH,
  MIN_NAME_LENGTH,
  ROLES,
  ROLE_LABELS,
  STATUSES,
  STATUS_LABELS,
  buildMatcher,
  cleanName,
  entityKind,
  entityRole,
  entityStatus,
  nameKey,
  namesFor,
  parseAliases,
  scanStory,
  scanText,
};
