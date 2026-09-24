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

// Letters and digits in any alphabet: a name ends where the word ends, and
// "Ren" is not inside "Renée", nor "Chloë" cut down to "Chlo".
const WORD_CHAR = '[\\p{L}\\p{N}_]';

// Titles and small words that say nothing about who somebody is: "Uncle
// Jack" and "Colonel Jack" are both Jack. Also the connectors inside a
// name ("de", "von"), which are never a name on their own.
const NAME_TITLES = new Set(['the', 'old', 'young', 'little', 'big', 'uncle', 'aunt', 'auntie', 'father', 'mother',
  'brother', 'sister', 'grandma', 'grandpa', 'mr', 'mrs', 'ms', 'miss', 'sir', 'lady', 'lord', 'dr', 'doctor',
  'captain', 'capt', 'colonel', 'col', 'major', 'general', 'admiral', 'commander', 'lieutenant', 'lt',
  'sergeant', 'sgt', 'corporal', 'private', 'chief', 'saint', 'st', 'professor', 'prof', 'agent', 'officer',
  'commodore', 'ensign', 'marshal', 'president', 'senator', 'governor', 'king', 'queen', 'prince', 'princess',
  'don', 'doña', 'señor', 'señora', 'señorita', 'sr', 'sra', 'srta', 'capitán', 'capitana', 'teniente', 'sargento',
  'coronel', 'almirante', 'doctora', 'tío', 'tía', 'padre', 'madre', 'jr',
  'de', 'del', 'la', 'las', 'los', 'el', 'of', 'von', 'van', 'der', 'den', 'da', 'di', 'du', 'le', 'y', 'e']);

/** True when the first letter is a capital -- in any alphabet. */
const startsUpper = (s) => {
  const ch = String(s || '').charAt(0);
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
};

// Ordinary words, from the spellchecker's own dictionary: a first name that
// is also a word ("Rose", "Will", "Mark") is not found on its own unless
// somebody says so by making it an alias, because on its own it is as
// likely to be the word.
/** @type {Set<string>|null} */
let commonWords = null;
function isCommonWord(word) {
  if (!commonWords) {
    commonWords = new Set();
    try {
      const raw = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'dictionary', 'en.dic'), 'utf8');
      for (const line of raw.split('\n')) {
        const stem = line.split('/')[0].trim();
        if (stem && stem === stem.toLowerCase()) commonWords.add(stem);
      }
    } catch (err) { /* no dictionary: every part counts as a name */ }
  }
  return commonWords.has(String(word).toLowerCase());
}

/**
 * The parts of a person's name that stand for them on their own: "Anna
 * Kessler" is also "Anna" and "Kessler" (and "Captain Kessler" has
 * "Kessler" in it). Titles and connectors are not parts; ordinary words
 * are set aside and reported, so the entry can say why "Rose" was not.
 * @param {string} name
 * @returns {{ parts: string[], common: string[] }}
 */
function nameParts(name) {
  const words = cleanName(name).split(' ').map((w) => w.replace(/['’]s$/, '').replace(/[.,]+$/, ''));
  if (words.length < 2) return { parts: [], common: [] };
  const parts = [];
  const common = [];
  for (const w of words) {
    if (w.length < 3 || !startsUpper(w) || NAME_TITLES.has(w.toLowerCase())) continue;
    if (/^[IVXLC]+$/.test(w)) continue;
    if (isCommonWord(w)) common.push(w); else parts.push(w);
  }
  return { parts, common };
}

/**
 * One regex for the whole cast.
 *
 * Longest name first, so "Commodore Raye" wins over "Raye" standing inside
 * it -- an alternation takes the first branch that matches at a position,
 * and a full match advances past the whole phrase.
 *
 * Two sorts of name go in. What an entry is called -- its name and its
 * aliases -- and, for people, the parts of the name ("Kessler" for Anna
 * Kessler). A written name always beats a part. A name two entries both
 * wrote down is nobody's: counting it for both would put a character in
 * chapters they are not in, so it is dropped and reported in `conflicts`
 * for the author to fix. A part two people share (two Kesslers) is quietly
 * nobody's too, and reported in `forms` as shared: nothing is wrong, it is
 * just not enough to tell them apart.
 *
 * A name written with a capital is only found with one: "Will" is not every
 * "will". An entry can ask to be found in any case, and a name written in
 * lower case ("the Old Man") is found in any case already.
 *
 * @param {any[]} entities {id, name, kind?, aliases?, any_case?, match_parts?, blocked?}
 */
function buildMatcher(entities) {
  /** @type {Map<string, Set<number>>} */
  const claimants = new Map();
  /** @type {Map<string, Set<number>>} */
  const partOwners = new Map();
  /** @type {Map<string, boolean>} */
  const capital = new Map();
  /** @type {Map<number, {names: string[], parts: string[], common: string[], shared: string[], blocked: string[]}>} */
  const forms = new Map();
  for (const entity of entities || []) {
    const id = Number(entity.id);
    const blocked = new Set((entity.blocked || []).map((b) => String(b).toLowerCase()));
    const names = namesFor(entity, entity.aliases || []);
    const info = { names, parts: /** @type {string[]} */ ([]), common: /** @type {string[]} */ ([]), shared: /** @type {string[]} */ ([]), blocked: Array.from(blocked) };
    forms.set(id, info);
    for (const name of names) {
      const key = name.toLowerCase();
      if (!claimants.has(key)) claimants.set(key, new Set());
      claimants.get(key).add(id);
      capital.set(key, startsUpper(name) && !entity.any_case);
    }
    const wantsParts = (entity.kind || DEFAULT_KIND) === 'person' && entity.match_parts !== 0 && entity.match_parts !== false;
    if (!wantsParts) continue;
    const seen = new Set(names.map((n) => n.toLowerCase()));
    for (const name of names.filter((n) => startsUpper(n))) {
      const { parts, common } = nameParts(name);
      for (const w of common) if (!info.common.includes(w)) info.common.push(w);
      for (const part of parts) {
        const key = part.toLowerCase();
        if (seen.has(key) || blocked.has(key)) continue;
        seen.add(key);
        info.parts.push(part);
        if (!partOwners.has(key)) partOwners.set(key, new Set());
        partOwners.get(key).add(id);
      }
    }
  }
  /** @type {Map<string, number>} */
  const byLower = new Map();
  const conflicts = [];
  for (const [key, ids] of claimants) {
    if (ids.size > 1) conflicts.push({ name: key, entityIds: Array.from(ids) });
    else byLower.set(key, Array.from(ids)[0]);
  }
  for (const [key, ids] of partOwners) {
    const drop = (why) => {
      for (const id of ids) {
        const info = forms.get(id);
        if (!info) continue;
        info.parts = info.parts.filter((p) => p.toLowerCase() !== key);
        if (why === 'shared') info.shared.push(key);
      }
    };
    // Somebody's written name is theirs, and not a part of anyone else.
    if (claimants.has(key)) { drop('named'); continue; }
    if (ids.size > 1) { drop('shared'); continue; }
    byLower.set(key, Array.from(ids)[0]);
    capital.set(key, true);
  }
  const usable = Array.from(byLower.keys());
  if (!usable.length) return { regex: null, conflicts, byLower, capital, forms };
  usable.sort((a, b) => b.length - a.length || a.localeCompare(b));
  // The boundaries are letters-and-digits rather than \b, so a possessive
  // ("Kessler's") still counts as naming her while a longer word that
  // merely starts the same way ("Kesslerian") does not.
  const pattern = usable.map(escapeRegExp).join('|');
  const regex = new RegExp(`(?<!${WORD_CHAR})(?:${pattern})(?!${WORD_CHAR})`, 'giu');
  return { regex, conflicts, byLower, capital, forms };
}

/**
 * Whose name this match is, or null: nobody's, or a lower-case "will"
 * where only "Will" is a name.
 * @param {{byLower: Map<string, number>, capital?: Map<string, boolean>}} matcher
 * @param {string} found
 * @returns {number|null}
 */
function ownerOf(matcher, found) {
  const key = found.toLowerCase();
  const id = matcher.byLower.get(key);
  if (id == null) return null;
  if (matcher.capital && matcher.capital.get(key) && !startsUpper(found)) return null;
  return id;
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
    const id = ownerOf(matcher, m[0]);
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

// Sentence openers in Spanish, for the stories written in it: a capital
// letter after a full stop says nothing there either.
for (const w of ['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'pero', 'cuando', 'entonces', 'después',
  'antes', 'luego', 'sí', 'que', 'qué', 'como', 'cómo', 'donde', 'dónde', 'quien', 'quién', 'él', 'ella', 'ellos',
  'ellas', 'yo', 'tú', 'usted', 'nosotros', 'su', 'sus', 'mi', 'mis', 'tu', 'tus', 'este', 'esta', 'esto', 'eso',
  'esa', 'ese', 'aquel', 'aquella', 'nada', 'nadie', 'todo', 'todos', 'también', 'tampoco', 'ahora', 'aquí', 'allí',
  'hoy', 'ayer', 'mañana', 'por', 'para', 'con', 'sin', 'en', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes',
  'sábado', 'domingo', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
  'octubre', 'noviembre', 'diciembre', 'capítulo', 'dios', 'vale',
  // "Chapter One" is a heading, and One is nobody.
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce']) NOT_NAMES.add(w);

// The small words a name can have in its middle: "Order of the Silent
// Star", "Pedro de Alvarado", "Ludwig van Beethoven". Only ever between two
// capitalised words -- a run cannot start or end on one.
const CONNECTORS = ['of', 'the', 'de', 'del', 'la', 'las', 'los', 'von', 'van', 'der', 'den', 'da', 'di', 'du', 'le', 'y'];

// A capitalised word, or a run of them, in any alphabet: "Kestrel
// Anchorage", "Marta Sein", "Émile", "Order of the Silent Star". Spaces
// only, never a line break: a heading and the paragraph under it are not
// one name.
const NAME_RUN = new RegExp(
  `(?<![\\p{L}\\p{N}_'’-])\\p{Lu}[\\p{L}'’-]*(?:(?:[ \\t]+(?:${CONNECTORS.join('|')}))*[ \\t]+\\p{Lu}[\\p{L}'’-]*)*`,
  'gu'
);

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
  const m = /^(.*)['’](\p{Ll}{1,2})$/u.exec(word);
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
    if (ch === ' ' || ch === '\t' || ch === '"' || ch === '“' || ch === '‘' || ch === "'" || ch === '«' || ch === '—'
      || ch === '(' || ch === '[' || ch === '>' || ch === '*' || ch === '_' || ch === '#' || ch === '¿' || ch === '¡') continue;
    return ch === '.' || ch === '!' || ch === '?' || ch === '\n' || ch === ':' || ch === ';' || ch === '…';
  }
  return true;
}

/**
 * Proper names in this text that nothing in `known` accounts for.
 * `known` holds everything the app already recognises, lower-cased: the
 * bible's names, aliases and name parts, the story's dictionary, the words
 * put away as not names. `glossary` holds the glossary's titles: those are
 * still offered -- a character of yours can share a name with the wiki --
 * but marked, so they can be kept apart from the rest.
 * @param {string} text
 * @param {Set<string>|string[]} [known]
 * @param {{ limit?: number, glossary?: Set<string> }} [opts]
 * @returns {{name: string, count: number, inGlossary?: boolean}[]}
 */
function findProperNames(text, known = new Set(), opts = {}) {
  const seen = known instanceof Set ? known : new Set((known || []).map((k) => String(k).toLowerCase()));
  const glossary = opts.glossary || new Set();
  const prose = proseOnly(text);
  /** @type {Map<string, {name: string, count: number, free: number, words: number}>} */
  const found = new Map();
  NAME_RUN.lastIndex = 0;
  let m;
  while ((m = NAME_RUN.exec(prose))) {
    let words = m[0].split(/[ \t]+/);
    let atSentenceStart = startsSentence(prose, m.index);
    // "Suddenly the Kestrel Anchorage shook": the opener and its article
    // belong to the sentence. What is left is no longer sentence-initial,
    // which is exactly why it is worth offering.
    if (atSentenceStart && words.length > 2 && ['the', 'a', 'an', 'el', 'la', 'los', 'las'].includes(words[1].toLowerCase())) {
      words = words.slice(2);
      atSentenceStart = false;
    }
    while (atSentenceStart && words.length > 1 && NOT_NAMES.has(words[0].toLowerCase())) {
      words = words.slice(1);
      while (words.length > 1 && NOT_NAMES.has(words[0].toLowerCase())) words = words.slice(1);
      atSentenceStart = false;
    }
    // A run starts and ends on a capital, never on a connector.
    while (words.length > 1 && (NOT_NAMES.has(words[words.length - 1].toLowerCase()) || CONNECTORS.includes(words[words.length - 1]))) words = words.slice(0, -1);
    while (words.length > 1 && CONNECTORS.includes(words[0])) words = words.slice(1);
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
    .map((c) => ({ ...c, inGlossary: glossary.has(c.name.toLowerCase()) }))
    // The story's own names first; the ones the glossary already knows after.
    .sort((a, b) => Number(a.inGlossary) - Number(b.inGlossary) || b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, opts.limit || 40)
    .map((c) => (c.inGlossary ? { name: c.name, count: c.count, inGlossary: true } : { name: c.name, count: c.count }));
}

/**
 * Which entry a name found in the text is surely another name for: the
 * one whose names hold every word of it once titles are set aside --
 * "Colonel Jack", "uncle Jack" and "Harlan's" are all Jack Harlan -- and
 * only when exactly one entry does. "Harlan Station" shares a word with
 * him and is not him, so it gets no guess: a wrong answer chosen in
 * advance is one click from being saved.
 * @param {string} name
 * @param {{id: number, name: string, alias_list?: string|null, aliases?: string[]}[]} entities
 * @returns {number|null}
 */
function likelySameAs(name, entities) {
  const words = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}'’-]+/u)
    .map((w) => w.replace(/['’]s$/, ''))
    .filter((w) => w.length > 1 && !NAME_TITLES.has(w));
  const mine = new Set(words(name));
  if (!mine.size) return null;
  const fits = [];
  for (const e of entities || []) {
    const others = [e.name].concat(e.aliases || String(e.alias_list || '').split(','));
    const theirs = new Set(others.flatMap(words));
    if (Array.from(mine).every((w) => theirs.has(w))) fits.push(e);
  }
  return fits.length === 1 ? Number(fits[0].id) : null;
}

/**
 * How an entry stands as of a point in the story. `changes` are in story
 * order, each from a chapter on; `upTo` is how far the one asking has got
 * (Infinity for the people writing it). Anything later is not theirs to
 * know yet.
 * @param {string} base the status at the start
 * @param {{status: string, chapter_number: number}[]} changes
 * @param {number} upTo
 */
function statusAt(base, changes, upTo) {
  let status = base || '';
  for (const c of changes || []) if (c.chapter_number <= upTo) status = c.status;
  return status;
}

module.exports = {
  statusAt,
  likelySameAs,
  nameParts,
  ownerOf,
  startsUpper,
  isCommonWord,
  NAME_TITLES,
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
