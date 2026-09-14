// public/js/writing-analyzer.js -- Hemingway-style writing analysis for the
// chapter text editor AND the chapter reading page. No build step, no
// runtime dependencies -- this file itself is still hand-written, plain
// JS. No AI/LLM of any kind is used anywhere in this file, and it never
// talks to anything but this same app's own server (plain GET requests for
// the dictionary files, a GET/POST pair for the story's own spelling
// exceptions, and a POST for rendering a markdown preview) -- no external
// service, API, or third party is ever contacted.
//
// What it does:
//   - Several independent checks, each with its own color, each one
//     individually switchable on/off (the choice is remembered across
//     pages and devices sharing this browser's storage):
//       - Spelling: every word is checked with a real, affix-aware
//         spellchecker (nspell, an Hunspell-like engine -- vendored as a
//         static bundle at public/js/nspell.bundle.js, built once from the
//         npm package with esbuild; that's a build-time tool only, nothing
//         the running server needs) against the en_US dictionary from the
//         "dictionary-en" npm package (public/dictionary/en.aff, en.dic),
//         served as static files the same way words-en.txt used to be.
//         Being affix-aware means it recognizes inflections ("running",
//         "friendlier") and possessives ("dog's") on its own, instead of
//         needing every form spelled out in a flat list. Unrecognized
//         words are underlined in teal. Because this is a shared fiction
//         universe full of invented names, each story keeps its own
//         approved-word list (the "Story dictionary" on the story page);
//         clicking a teal highlight offers to add that word to it. On by
//         default.
//       - Passive voice, adverbs, filler/hedge words, and complex/formal
//         words -- each its own check, its own color.
//       - Long/dense sentences (Flesch-Kincaid grade level), shaded yellow
//         or red depending on severity.
//   - All of this runs identically on the chapter editor (over the raw
//     textarea text) and on the chapter reading page (over the already
//     rendered HTML, by walking its text nodes -- bold/italic/links and
//     comment highlights are left completely alone).
//   - A visual control card sits above the text in both places, showing
//     live counts and a colored, clickable pill for every check.
//   - The editor also offers an optional markdown preview: turn it on to
//     split the editor 50/50 with a live-rendered preview (rendered by
//     this same server, from the same markdown code that renders the real
//     chapter page -- see the /markdown/preview route in server.js).
//   - Click any highlighted span to see why it was flagged and (for
//     complex words, in the editor) swap in the suggested word.
//   - Because this app's own dictionary now does spelling, the textarea's
//     native browser spellcheck is turned off to avoid double underlines.
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // check registry -- one source of truth for label, color, and toggle
  // state, shared by both the highlight rendering and the control card.
  // ---------------------------------------------------------------------
  // Muted, ink-and-pigment colors rather than saturated highlighter ones:
  // these sit *under* prose the reader is trying to judge, often several
  // at once, so they have to be legible as marks without ever becoming
  // the thing you look at. Each one is chosen to hold up on both the warm
  // paper and the warm near-black theme (see public/css/style.css), since
  // they're applied as inline styles and can't vary per theme.
  const CHECK_META = {
    spell: { label: 'Spelling', color: '#3f9e92' },
    passive: { label: 'Passive voice', color: '#5585b5' },
    adverb: { label: 'Adverbs', color: '#c08445' },
    filler: { label: 'Filler words', color: '#b06a8f' },
    complex: { label: 'Complex words', color: '#8d72b8' },
    sentence: { label: 'Long sentences', color: '#c2a04e' },
  };
  const CHECK_ORDER = ['spell', 'passive', 'adverb', 'filler', 'complex', 'sentence'];
  const SEVERITY_COLOR = { yellow: '#c2a04e', red: '#c26a4e' };

  const DEFAULT_SETTINGS = { spell: true, passive: true, adverb: true, filler: true, complex: true, sentence: true };
  const SETTINGS_KEY = 'wa-settings-v2';
  const LEGACY_ENABLED_KEY = 'wa-enabled'; // the old single on/off switch

  // The reading page is where you go to read a chapter and see what people
  // said about it. Arriving to prose already covered in five colours of
  // mark answers a question nobody asked, so the checks start off there
  // and remember separately: turning "long sentences" off while reading
  // shouldn't turn it off in the editor, where it is the whole point.
  const READ_DEFAULT_SETTINGS = { spell: false, passive: false, adverb: false, filler: false, complex: false, sentence: false };
  const READ_SETTINGS_KEY = 'wa-read-settings-v1';

  function loadSettings(key = SETTINGS_KEY, defaults = DEFAULT_SETTINGS) {
    const settings = Object.assign({}, defaults);
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        CHECK_ORDER.forEach((id) => { if (typeof parsed[id] === 'boolean') settings[id] = parsed[id]; });
        return settings;
      }
      // First time this browser sees the new per-check settings: honor the
      // old master on/off switch, if it was ever turned off, instead of
      // silently re-enabling everything.
      if (key === SETTINGS_KEY && localStorage.getItem(LEGACY_ENABLED_KEY) === '0') {
        CHECK_ORDER.forEach((id) => { settings[id] = false; });
      }
    } catch (e) { /* ignore, defaults stand */ }
    return settings;
  }

  function saveSettings(settings, key = SETTINGS_KEY) {
    try { localStorage.setItem(key, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  // The "show comments" toggle is shared by the editor and the reading
  // page, and by every story -- once someone picks a value in this
  // browser it sticks everywhere, the same way the check settings above
  // do. `defaultOn` (the story-author-vs-everyone-else rule) only applies
  // the very first time, before anyone has chosen anything yet.
  const COMMENTS_VISIBLE_KEY = 'wa-comments-visible';
  function loadCommentsVisible(defaultOn) {
    try {
      const raw = localStorage.getItem(COMMENTS_VISIBLE_KEY);
      if (raw === '1') return true;
      if (raw === '0') return false;
    } catch (e) { /* ignore */ }
    return defaultOn;
  }
  function saveCommentsVisible(visible) {
    try { localStorage.setItem(COMMENTS_VISIBLE_KEY, visible ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  // Same pattern as comments visibility above, for the character/place/
  // ship name links the server auto-inserts from the shared wiki's index
  // (see lib/wiki.js) -- on by default, but some readers may find them
  // distracting or too eager to match short/common titles.
  const WIKI_LINKS_VISIBLE_KEY = 'wa-wikilinks-visible';
  function loadWikiLinksVisible() {
    try {
      const raw = localStorage.getItem(WIKI_LINKS_VISIBLE_KEY);
      if (raw === '0') return false;
    } catch (e) { /* ignore */ }
    return true;
  }
  function saveWikiLinksVisible(visible) {
    try { localStorage.setItem(WIKI_LINKS_VISIBLE_KEY, visible ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Inline style for a word-level <mark>, so every color lives in this one
  // place instead of being duplicated across CSS classes.
  //
  // Word-level checks mark with an underline, not a filled block. Blocks
  // were unreadable in practice: a word-level highlight almost always sits
  // *inside* a sentence-level one, and two stacked translucent fills turn
  // the passage into mud exactly where the writer most needs to read it.
  // An underline carries the same color coding, stacks cleanly with the
  // sentence tint underneath, and leaves the letterforms alone. The very
  // faint wash on top is just enough to find the span at a glance.
  function wordMarkStyle(kind) {
    if (kind === 'spell') {
      return `text-decoration-line:underline;text-decoration-style:wavy;text-decoration-color:${CHECK_META.spell.color};text-decoration-thickness:1px;text-underline-offset:3px;`;
    }
    const meta = CHECK_META[kind];
    if (!meta) return '';
    return `background:${hexToRgba(meta.color, 0.1)};`
      + `text-decoration-line:underline;text-decoration-style:solid;text-decoration-color:${hexToRgba(meta.color, 0.85)};`
      + 'text-decoration-thickness:2px;text-underline-offset:3px;';
  }

  // Sentence-level marks span whole sentences, so they stay a wash rather
  // than an underline -- a 40-word underline reads as a redaction bar, and
  // it would collide with the word-level underlines sitting inside it.
  function sentenceMarkStyle(severity) {
    const color = SEVERITY_COLOR[severity];
    return color ? `background:${hexToRgba(color, severity === 'red' ? 0.16 : 0.11)};` : '';
  }

  // ---------------------------------------------------------------------
  // word lists (all hand-curated; see comments above each one)
  // ---------------------------------------------------------------------

  // Common irregular past participles, used to spot passive voice ("was
  // written", "were taken"). Regular participles are matched separately
  // with a plain "-ed" pattern, so this list only needs the irregular ones.
  const IRREGULAR_PARTICIPLES = [
    'done', 'gone', 'seen', 'known', 'given', 'taken', 'made', 'said', 'found',
    'thought', 'told', 'felt', 'kept', 'left', 'brought', 'bought', 'caught',
    'taught', 'fought', 'sought', 'held', 'meant', 'met', 'paid', 'sent',
    'spent', 'built', 'sold', 'understood', 'stood', 'won', 'begun', 'become',
    'come', 'run', 'sung', 'drunk', 'chosen', 'spoken', 'broken', 'stolen',
    'driven', 'ridden', 'written', 'bitten', 'hidden', 'forgotten', 'grown',
    'thrown', 'blown', 'drawn', 'flown', 'shown', 'sworn', 'torn', 'worn',
    'born', 'gotten', 'shot', 'hurt', 'cut', 'put', 'set', 'hit', 'cost',
    'spread', 'shut', 'split', 'quit', 'burst', 'cast', 'bet', 'bid', 'let',
    'read', 'led', 'bent', 'lent', 'sent', 'spent', 'crept', 'swept', 'wept',
    'slept', 'dealt', 'dreamt', 'burnt', 'learnt', 'spoilt', 'smelt', 'lit',
    'fled', 'bled', 'fed', 'bred', 'sped', 'struck', 'stuck', 'swung', 'slung',
    'flung', 'clung', 'strung', 'wound', 'bound', 'found', 'ground', 'stung',
    'sung', 'rung', 'sunk', 'shrunk', 'swum', 'begun',
  ];

  // Common -ly words that are NOT weakening adverbs of manner (they're
  // ordinary nouns/adjectives that happen to end in "-ly"), so they're
  // excluded from the adverb check to keep false positives down.
  const LY_EXCLUDE = new Set([
    'family', 'supply', 'reply', 'apply', 'imply', 'comply', 'rally', 'ally',
    'bully', 'jelly', 'belly', 'folly', 'jolly', 'fully', 'only', 'ugly',
    'holy', 'silly', 'likely', 'lonely', 'friendly', 'lovely', 'deadly',
    'costly', 'elderly', 'orderly', 'lively', 'monthly', 'hourly', 'daily',
    'weekly', 'yearly', 'early', 'ghastly', 'homely', 'burly', 'curly',
    'gully', 'assembly', 'anomaly', 'analogy', 'ply', 'butterfly', 'dragonfly',
  ]);

  // Filler/hedge words -- single words. Longer phrases are handled by
  // WEAK_PHRASES below.
  const WEAK_WORDS = [
    'very', 'really', 'quite', 'just', 'actually', 'basically', 'definitely',
    'probably', 'certainly', 'clearly', 'obviously', 'simply', 'somewhat',
    'rather', 'extremely', 'literally', 'totally', 'completely', 'absolutely',
    'virtually', 'practically', 'essentially', 'generally', 'particularly',
    'specifically', 'especially', 'perhaps', 'maybe', 'possibly', 'apparently',
    'seemingly', 'presumably', 'arguably', 'honestly', 'frankly', 'surely',
    'undoubtedly', 'admittedly', 'somehow', 'suddenly',
  ];

  // Filler/hedge phrases (checked longest-first so e.g. "due to the fact
  // that" is matched whole rather than only "due to").
  const WEAK_PHRASES = [
    'due to the fact that', 'in spite of the fact that', 'at this point in time',
    'for all intents and purposes', 'it is important to note that',
    'needless to say', 'as a matter of fact', 'each and every',
    'first and foremost', 'with regard to', 'in terms of', 'in the event that',
    'a large number of', 'a majority of', 'the fact that', 'in order to',
    'sort of', 'kind of', 'close proximity', 'end result', 'final outcome',
    'past history', 'future plans', 'unexpected surprise', 'basic fundamentals',
    'there is', 'there are', 'there was', 'there were',
  ].sort((a, b) => b.length - a.length);

  // Complex/formal words with a plainer suggested alternative. Click a
  // purple highlight (in the editor) to swap the word for the suggestion
  // shown here.
  const COMPLEX_WORDS = {
    utilize: 'use', utilise: 'use', utilizes: 'uses', utilized: 'used',
    endeavor: 'try', endeavour: 'try', commence: 'begin', commenced: 'began',
    terminate: 'end', terminated: 'ended', assistance: 'help',
    numerous: 'many', sufficient: 'enough', purchase: 'buy',
    purchased: 'bought', demonstrate: 'show', demonstrated: 'showed',
    facilitate: 'help', approximately: 'about', subsequently: 'later',
    additional: 'more', individual: 'person', component: 'part',
    methodology: 'method', prioritize: 'rank', leverage: 'use',
    optimal: 'best', implement: 'carry out', ascertain: 'find out',
    notwithstanding: 'despite', erroneous: 'wrong', cognizant: 'aware',
    expeditious: 'fast', predicament: 'problem', ameliorate: 'improve',
    cessation: 'stop', circumvent: 'avoid', deleterious: 'harmful',
    egregious: 'outrageous', extemporaneous: 'improvised',
    fastidious: 'picky', garrulous: 'talkative', incessant: 'constant',
    juxtapose: 'compare', labyrinthine: 'maze-like', meticulous: 'careful',
    nefarious: 'wicked', obfuscate: 'confuse', panacea: 'cure-all',
    quintessential: 'classic', recalcitrant: 'stubborn',
    surreptitious: 'secret', tantamount: 'equal to', ubiquitous: 'everywhere',
    vociferous: 'loud', whimsical: 'playful', irregardless: 'regardless',
    henceforth: 'from now on', heretofore: 'until now', aforementioned: 'this',
    pursuant: 'following', regarding: 'about', concerning: 'about',
    numerousness: 'number', multitudinous: 'many', innumerable: 'countless',
    magnitude: 'size', proximity: 'closeness', ostensibly: 'apparently',
    inadvertently: 'accidentally', predominantly: 'mostly',
    substantiate: 'prove', corroborate: 'confirm', delineate: 'outline',
    exacerbate: 'worsen', mitigate: 'lessen', proliferate: 'spread',
    ramification: 'consequence', paradigm: 'model', synergy: 'teamwork',
    holistic: 'whole', robust: 'strong', myriad: 'countless',
  };

  const COMPLEX_WORD_RE = new RegExp(
    '\\b(' + Object.keys(COMPLEX_WORDS).sort((a, b) => b.length - a.length).join('|') + ')\\b',
    'gi',
  );
  const WEAK_PHRASE_RE = new RegExp(
    '\\b(' + WEAK_PHRASES.map(escapeRegExp).join('|') + ')\\b',
    'gi',
  );
  const WEAK_WORD_RE = new RegExp('\\b(' + WEAK_WORDS.join('|') + ')\\b', 'gi');
  const PASSIVE_RE = new RegExp(
    '\\b(am|is|are|was|were|be|being|been)\\b((?:\\s+\\w+ly)?\\s+(?:\\w+ed|' +
      IRREGULAR_PARTICIPLES.join('|') + '))\\b',
    'gi',
  );
  const ADVERB_RE = /\b(\w+ly)\b/gi;

  const ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'st', 'vs', 'jr', 'sr', 'prof', 'sgt', 'capt',
    'gen', 'rev', 'etc', 'eg', 'ie', 'no', 'vol', 'ave', 'blvd', 'inc', 'ltd',
  ]);

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------------
  // sentence splitting
  // ---------------------------------------------------------------------

  // Splits `text` into a contiguous list of {start, end, text} chunks that
  // together cover the whole string (so the overlay can be rebuilt by just
  // concatenating the rendering of each chunk in order). A chunk ends at a
  // sentence-terminating punctuation mark or a newline; "Mr.", "Dr." etc.
  // don't end a sentence.
  function splitSentences(text) {
    const chunks = [];
    let start = 0;
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\n') {
        chunks.push({ start, end: i + 1, text: text.slice(start, i + 1) });
        start = i + 1;
        i += 1;
        continue;
      }
      if (ch === '.' || ch === '!' || ch === '?') {
        let j = i;
        while (j + 1 < text.length && '.!?'.includes(text[j + 1])) j += 1;
        if (ch === '.') {
          const before = text.slice(start, i).match(/([a-zA-Z]+)$/);
          if (before && ABBREVIATIONS.has(before[1].toLowerCase())) {
            i = j + 1;
            continue;
          }
        }
        let k = j + 1;
        while (k < text.length && '"\')”’]'.includes(text[k])) k += 1;
        chunks.push({ start, end: k, text: text.slice(start, k) });
        start = k;
        i = k;
        continue;
      }
      i += 1;
    }
    if (start < text.length) {
      chunks.push({ start, end: text.length, text: text.slice(start) });
    }
    return chunks;
  }

  function countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!word) return 0;
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]e|ed|es)$/, '');
    word = word.replace(/^y/, '');
    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  }

  // Scores one sentence chunk. Returns null for chunks with too few words
  // to meaningfully judge (this also naturally skips blank lines).
  function scoreSentence(chunk) {
    const words = chunk.text.split(/\s+/).map((w) => w.replace(/^[^a-zA-Z']+|[^a-zA-Z']+$/g, '')).filter(Boolean);
    if (words.length < 6) return { words: words.length, grade: 0, severity: null };
    const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
    const grade = 0.39 * words.length + 11.8 * (syllables / words.length) - 15.59;
    let severity = null;
    if (grade >= 15 || words.length > 40) severity = 'red';
    else if (grade >= 9 || words.length > 20) severity = 'yellow';
    return { words: words.length, grade, severity };
  }

  // ---------------------------------------------------------------------
  // word/phrase-level detectors (run within one sentence chunk at a time)
  // ---------------------------------------------------------------------

  // Each detector returns a list of {start, end, kind, label, suggestion}
  // with offsets relative to the start of the sentence chunk it was run
  // against (the caller adds the chunk's own offset back in). `settings`
  // controls which checks actually run -- a disabled check is simply
  // never matched, rather than matched-then-hidden, so it costs nothing.
  function findWordHighlights(sentenceText, storyWords, settings) {
    const found = [];

    function addAll(re, kind, labelFn, suggestionFn) {
      if (settings && settings[kind] === false) return;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(sentenceText))) {
        found.push({
          start: m.index,
          end: m.index + m[0].length,
          kind,
          label: labelFn(m),
          suggestion: suggestionFn ? suggestionFn(m) : null,
        });
        if (m[0].length === 0) re.lastIndex += 1; // safety, shouldn't happen
      }
    }

    // Priority order: passive voice, then adverbs, then filler phrases/
    // words, then complex words. Earlier matches "win" any overlap (see
    // below) -- this only matters when two DIFFERENT checks would
    // otherwise both claim the same span, e.g. a filler word that's also
    // technically part of a passive-voice match.
    addAll(PASSIVE_RE, 'passive', () => 'Passive voice -- consider naming who did this and using an active verb.');
    addAll(ADVERB_RE, 'adverb', (m) => (LY_EXCLUDE.has(m[0].toLowerCase()) ? null : 'Adverb -- a stronger verb might say this more directly.'));
    addAll(WEAK_PHRASE_RE, 'filler', () => 'This phrase can usually be cut or shortened.');
    addAll(WEAK_WORD_RE, 'filler', () => 'Filler word -- try cutting it and see if the sentence still works.');
    addAll(COMPLEX_WORD_RE, 'complex', (m) => `Simpler alternative: "${COMPLEX_WORDS[m[0].toLowerCase()]}"`, (m) => COMPLEX_WORDS[m[0].toLowerCase()]);

    // Drop the adverb matches we deliberately nulled out above (excluded
    // words), then keep matches sorted by start position.
    const filtered = found.filter((f) => f.label !== null).sort((a, b) => a.start - b.start || b.end - a.end);

    // Resolve overlaps: first match found (highest priority, since we added
    // detectors in priority order and sorted stably by start) wins; any
    // later match that overlaps it is dropped so ranges never overlap.
    const result = [];
    let lastEnd = -1;
    for (const f of filtered) {
      if (f.start < lastEnd) continue;
      result.push(f);
      lastEnd = f.end;
    }

    // Spelling runs as a separate, lower-priority pass over the same text:
    // a word already flagged above (adverb, filler, complex word, ...) is
    // by definition a real English word, so in practice this never
    // collides -- but skip anything that overlaps anyway, defensively, so
    // a single token can never end up wrapped in two <mark> elements.
    if (!settings || settings.spell !== false) {
      for (const s of findSpellingHighlights(sentenceText, storyWords)) {
        if (result.some((r) => s.start < r.end && s.end > r.start)) continue;
        result.push(s);
      }
    }
    result.sort((a, b) => a.start - b.start);
    return result;
  }

  // ---------------------------------------------------------------------
  // spelling (real dictionary lookup + per-story exceptions)
  // ---------------------------------------------------------------------

  // Common contractions: the dictionary file is plain alphabetic words with
  // no apostrophes, so "don't"/"it's"/etc. would otherwise always come up
  // as "unknown". This list is intentionally short -- it only needs to
  // cover contractions, not every word in the language.
  const CONTRACTIONS = new Set([
    "don't", "can't", "won't", "isn't", "aren't", "wasn't", "weren't",
    "hasn't", "haven't", "hadn't", "doesn't", "didn't", "couldn't",
    "shouldn't", "wouldn't", "mustn't", "mightn't", "needn't", "shan't",
    "i'm", "i've", "i'll", "i'd", "you're", "you've", "you'll", "you'd",
    "he's", "he'll", "he'd", "she's", "she'll", "she'd", "it's", "it'll",
    "we're", "we've", "we'll", "we'd", "they're", "they've", "they'll",
    "they'd", "that's", "that'll", "there's", "there'll", "here's",
    "what's", "what're", "who's", "who'll", "let's", "ain't", "y'all",
    "o'clock",
  ]);

  const WORD_TOKEN_RE = /[A-Za-z][A-Za-z']*/g;

  // Real spellchecking (affix-aware, not a flat word list) via nspell -- a
  // plain-JS Hunspell-like engine, vendored as a static bundle (see
  // public/js/nspell.bundle.js, built from the "nspell" npm package with
  // esbuild -- it's a build-time-only dependency, the app still needs no
  // npm install to run). The en_US affix/dictionary documents come from the
  // "dictionary-en" npm package, served as static files the same way
  // words-en.txt used to be. Being affix-aware means it understands
  // inflections ("running", "friendlier") and possessives ("dog's")
  // without needing every form spelled out, unlike a flat list. Stays null
  // (spelling checks simply don't run yet) until both files are loaded.
  let SPELL = null;
  let dictionaryPromise = null;
  function loadDictionary() {
    if (dictionaryPromise) return dictionaryPromise;
    dictionaryPromise = Promise.all([
      fetch('/dictionary/en.aff').then((r) => (r.ok ? r.text() : '')),
      fetch('/dictionary/en.dic').then((r) => (r.ok ? r.text() : '')),
    ])
      .then(([aff, dic]) => {
        if (aff && dic && window.NSpell) SPELL = window.NSpell({ aff, dic });
      })
      .catch(() => { SPELL = null; });
    return dictionaryPromise;
  }

  // Each story keeps its own list of approved words (invented character/
  // place names and the like) -- see the "Story dictionary" section on the
  // story page and server.js's /stories/:id/dictionary routes. Cached per
  // story id so multiple textareas/pages for the same story (shouldn't
  // normally happen, but just in case) don't each fetch it separately.
  const storyWordsCache = new Map();
  function loadStoryWords(storyId) {
    if (!storyId) return Promise.resolve(new Set());
    if (!storyWordsCache.has(storyId)) {
      storyWordsCache.set(storyId, fetch(`/stories/${storyId}/dictionary`, { headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : { words: [] }))
        .then((data) => new Set((data.words || []).map((w) => w.toLowerCase())))
        .catch(() => new Set()));
    }
    return storyWordsCache.get(storyId);
  }

  // `raw` keeps its original casing -- nspell's dictionary is case-aware
  // (e.g. "HTML" is known but "html" isn't; "The" is fine anywhere, but a
  // name like "Sarah" is only recognized capitalized), so lowercasing
  // before checking, like the old flat-list version did, would throw that
  // signal away. `lower` is still what the story's own word list and the
  // contraction list are matched against, since those are stored lowercase.
  function knownWord(raw, storyWords) {
    const lower = raw.toLowerCase();
    if (CONTRACTIONS.has(lower)) return true;
    if (storyWords && storyWords.has(lower)) return true;
    if (SPELL.correct(raw) || SPELL.correct(lower)) return true;
    // Possessive of a word that's only known via this story's own
    // dictionary (nspell already handles possessives of words in its own
    // dictionary through affix rules, e.g. "dog's") -- e.g. the story
    // dictionary has "Aetherius" but the text says "Aetherius's".
    if (lower.endsWith("'s")) return Boolean(storyWords && storyWords.has(lower.slice(0, -2)));
    if (lower.endsWith("s'")) return Boolean(storyWords && storyWords.has(lower.slice(0, -1)));
    return false;
  }

  // Returns {start, end, kind: 'spell', label} for every word-like token in
  // `sentenceText` that isn't in the dictionary, a contraction, or this
  // story's approved-word list. Returns [] while the dictionary hasn't
  // loaded yet, rather than guessing.
  function findSpellingHighlights(sentenceText, storyWords) {
    if (!SPELL) return [];
    const found = [];
    WORD_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = WORD_TOKEN_RE.exec(sentenceText))) {
      const raw = m[0];
      if (raw.length < 2) continue;
      if (knownWord(raw, storyWords)) continue;
      found.push({
        start: m.index,
        end: m.index + raw.length,
        kind: 'spell',
        label: 'Not in the dictionary -- could be a typo, or a name/word specific to your story.',
      });
    }
    return found;
  }

  // ---------------------------------------------------------------------
  // full-text analysis
  // ---------------------------------------------------------------------

  // Builds the editor overlay's HTML from plain (escaped) text plus two
  // independent, freely-overlapping sets of ranges: the writing-quality
  // ranges from analyze() below (sentence-level ranges always contain the
  // word-level ranges inside them, by construction) and, in the editor
  // only, the story's existing comments (resolved to raw-text positions
  // by resolveCommentRanges in setup() -- see the comment there for why
  // that's a best-effort match rather than an exact offset mapping).
  // Works by cutting the text into atomic segments at every range
  // boundary (the same technique lib/markdown.js's renderHighlighted uses
  // server-side) and wrapping each segment in whichever marks apply to
  // it, comments outermost.
  function buildOverlayHtml(text, waRanges, commentRanges) {
    const comments = commentRanges || [];
    const points = new Set([0, text.length]);
    waRanges.forEach((r) => { points.add(r.start); points.add(r.end); });
    comments.forEach((r) => { points.add(r.start); points.add(r.end); });
    const sorted = Array.from(points).filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b);

    let html = '';
    for (let i = 0; i < sorted.length - 1; i++) {
      const segStart = sorted[i];
      const segEnd = sorted[i + 1];
      if (segStart >= segEnd) continue;
      let inner = escapeHtml(text.slice(segStart, segEnd));

      const wordRange = waRanges.find((r) => r.kind.indexOf('sentence-') !== 0 && r.start <= segStart && r.end >= segEnd);
      if (wordRange) {
        inner = `<mark class="wa-word wa-${wordRange.kind}" style="${wordMarkStyle(wordRange.kind)}" `
          + `data-wa-start="${wordRange.start}" data-wa-end="${wordRange.end}" data-wa-label="${escapeHtml(wordRange.label)}">${inner}</mark>`;
      }

      const sentenceRange = waRanges.find((r) => r.kind.indexOf('sentence-') === 0 && r.start <= segStart && r.end >= segEnd);
      if (sentenceRange) {
        const severity = sentenceRange.kind.slice('sentence-'.length);
        inner = `<mark class="wa-sentence wa-${severity}" style="${sentenceMarkStyle(severity)}" `
          + `data-wa-start="${sentenceRange.start}" data-wa-end="${sentenceRange.end}" data-wa-label="${escapeHtml(sentenceRange.label)}">${inner}</mark>`;
      }

      const activeComments = comments.filter((r) => r.start <= segStart && r.end >= segEnd);
      if (activeComments.length) {
        const statuses = new Set(activeComments.map((c) => c.status));
        let cls = 'hl';
        if (statuses.has('pending')) cls += ' hl-pending';
        else if (statuses.has('rejected') && !statuses.has('accepted')) cls += ' hl-rejected';
        else cls += ' hl-accepted';
        inner = `<span class="${cls}">${inner}</span>`;
      }

      html += inner;
    }
    return html;
  }

  // Returns { html, ranges, stats } where `html` is what should go inside
  // the editor's overlay (unused by the read-only view -- it applies
  // `ranges` directly onto the existing DOM instead, see applyRangesToDom
  // below), `ranges` is a flat list of {start, end, kind, label,
  // suggestion} in whole-text offsets, and `stats` is counts used by the
  // summary bar. `storyWords` is the Set of this story's approved words
  // (see loadStoryWords above) -- pass an empty Set (or leave it
  // undefined) if there's no story yet, e.g. the "new story" page, or
  // while it's still loading. `settings` controls which checks run.
  // `commentRanges` (editor only -- see resolveCommentRanges in setup())
  // additionally shades existing comments into the returned `html`.
  function analyze(text, storyWords, settings, commentRanges) {
    const chunks = splitSentences(text);
    const ranges = [];
    const stats = {
      yellow: 0, red: 0, passive: 0, adverb: 0, filler: 0, complex: 0, spell: 0, maxGrade: 0,
    };
    const sentenceChecksOn = !settings || settings.sentence !== false;

    for (const chunk of chunks) {
      const score = sentenceChecksOn ? scoreSentence(chunk) : { words: 0, grade: 0, severity: null };
      if (score.severity === 'yellow') stats.yellow += 1;
      if (score.severity === 'red') stats.red += 1;
      if (score.grade > stats.maxGrade) stats.maxGrade = score.grade;

      const wordHighlights = findWordHighlights(chunk.text, storyWords, settings);
      for (const w of wordHighlights) {
        if (stats[w.kind] !== undefined) stats[w.kind] += 1;
      }

      if (score.severity) {
        ranges.push({
          start: chunk.start,
          end: chunk.end,
          kind: 'sentence-' + score.severity,
          label: score.severity === 'red'
            ? `Very dense sentence (about ${score.words} words) -- try splitting it into two.`
            : `Long/complex sentence (about ${score.words} words) -- consider shortening or splitting it.`,
        });
      }
      for (const w of wordHighlights) {
        ranges.push({
          start: chunk.start + w.start,
          end: chunk.start + w.end,
          kind: w.kind,
          label: w.label,
          suggestion: w.suggestion,
        });
      }
    }

    ranges.sort((a, b) => a.start - b.start);
    const html = buildOverlayHtml(text, ranges, commentRanges);
    return { html, ranges, stats };
  }

  // Builds one "● N label" chip; returns '' when the count is zero so
  // empty categories don't clutter the bar. `colorId` looks up its color
  // in CHECK_META/SEVERITY_COLOR so the dot always matches its check/mark.
  function statChip(color, count, singular, plural) {
    if (!count) return '';
    return `<span class="wa-chip"><span class="wa-dot" style="background:${color}"></span>${count} ${count === 1 ? singular : plural}</span>`;
  }

  // A writing group counts words, so the count is always there -- even
  // when nothing else is, and even with every check switched off. It sits
  // with the issue chips rather than under the textarea because that strip
  // is the one place on the page already reserved for "how is this going".
  function wordsChip(text) {
    const words = String(text || '')
      // A link's target is not prose. Dropping it keeps this in step with
      // the count the server stores (see countWords in lib/markdown.js),
      // which works on the parsed document rather than on the source.
      .replace(/\]\([^)]*\)/g, ']')
      .replace(/[*_~`#>]/g, ' ')
      .match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu);
    const count = words ? words.length : 0;
    const shown = count < 10000 ? count.toLocaleString('en-GB') : `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return `<span class="wa-chip wa-words">${shown} ${count === 1 ? 'word' : 'words'}</span>`;
  }

  function summaryHtml(stats, text) {
    const words = wordsChip(text);
    const total = stats.yellow + stats.red + stats.passive + stats.adverb + stats.filler + stats.complex + stats.spell;
    if (total === 0) return `${words}<span class="wa-chip muted">No issues spotted.</span>`;
    return words + [
      statChip(SEVERITY_COLOR.red, stats.red, 'very dense sentence', 'very dense sentences'),
      statChip(SEVERITY_COLOR.yellow, stats.yellow, 'long sentence', 'long sentences'),
      statChip(CHECK_META.passive.color, stats.passive, 'passive-voice phrase', 'passive-voice phrases'),
      statChip(CHECK_META.adverb.color, stats.adverb, 'adverb', 'adverbs'),
      statChip(CHECK_META.filler.color, stats.filler, 'filler word/phrase', 'filler words/phrases'),
      statChip(CHECK_META.complex.color, stats.complex, 'complex word', 'complex words'),
      statChip(CHECK_META.spell.color, stats.spell, 'possible misspelling', 'possible misspellings'),
    ].filter(Boolean).join('');
  }

  // ---------------------------------------------------------------------
  // shared control card -- a list of toggle rows grouped into labeled
  // sections (Spelling / Style / Markdown preview / Comments), rather than
  // one flat row of colored pills -- easier to scan, and grouping the five
  // Hemingway-style checks under one "Style" heading reads as one related
  // group instead of five unrelated buttons.
  // ---------------------------------------------------------------------

  // One checkbox-and-label row inside a section. The checkbox itself
  // carries the check's color (via accent-color, tied to --wa-color) --
  // that's the only color cue a row needs, so unlike the old pill this
  // doesn't need a separate dot element.
  function buildCheckRow(color, label, checked, onChange) {
    const row = document.createElement('label');
    row.className = 'wa-check-row';
    row.style.setProperty('--wa-color', color);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => {
      row.classList.toggle('active', input.checked);
      onChange(input.checked);
    });
    const text = document.createElement('span');
    text.textContent = label;
    row.appendChild(input);
    row.appendChild(text);
    row.classList.toggle('active', checked);
    return row;
  }

  // A titled group of rows -- one of the four sections.
  function buildSection(title, rows) {
    const section = document.createElement('div');
    section.className = 'wa-section';
    const heading = document.createElement('div');
    heading.className = 'wa-section-title';
    heading.textContent = title;
    section.appendChild(heading);
    // Rows wrap horizontally instead of stacking one per line -- Style
    // has five of them, and stacked they made the whole card as tall as
    // its longest section even though Spelling/Comments only ever need
    // one line each.
    const list = document.createElement('div');
    list.className = 'wa-section-rows';
    rows.forEach((row) => list.appendChild(row));
    section.appendChild(list);
    return section;
  }

  // A bare-bones card with a single "Comments" section and no title/
  // summary -- used for readers who aren't the story's author: they only
  // ever get the comments toggle, never the writing-quality checks (see
  // setupReadView).
  function buildMinimalCard(row) {
    const card = document.createElement('div');
    card.className = 'wa-card wa-card-reading';
    const sections = document.createElement('div');
    sections.className = 'wa-sections';
    sections.appendChild(buildSection('Comments', [row]));
    card.appendChild(sections);
    return card;
  }

  // Builds the visual card that sits above the text in both the editor and
  // the reading page, with two built-in sections (Spelling, Style).
  // `onToggle(checkId, enabled)` fires when a row is toggled. Returns the
  // card element, a `summary` element to update, and a `sections` element
  // callers append their own extra sections to (the editor adds a
  // "Markdown preview" section, and both the editor and the reading page
  // add a "Comments" section, after this).
  function buildControlsCard(settings, onToggle, { startOpen = true } = {}) {
    const card = document.createElement('div');
    card.className = 'wa-card';

    const head = document.createElement('div');
    head.className = 'wa-card-head';
    // The head is the fold's handle: the whole strip toggles, so the
    // counts stay readable at a glance with the switches put away.
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'wa-card-title wa-card-toggle';
    title.setAttribute('aria-expanded', startOpen ? 'true' : 'false');
    title.innerHTML = '<span class="wa-card-caret" aria-hidden="true"></span>Writing checks';
    const summary = document.createElement('span');
    summary.className = 'wa-summary';
    summary.innerHTML = 'Checking...';
    head.appendChild(title);
    head.appendChild(summary);
    card.appendChild(head);

    const sections = document.createElement('div');
    sections.className = 'wa-sections';
    if (!startOpen) card.classList.add('wa-card-folded');
    title.addEventListener('click', () => {
      const open = card.classList.toggle('wa-card-folded');
      title.setAttribute('aria-expanded', open ? 'false' : 'true');
    });

    const spellRow = buildCheckRow(
      CHECK_META.spell.color, CHECK_META.spell.label, settings.spell !== false,
      (checked) => onToggle('spell', checked),
    );
    sections.appendChild(buildSection('Spelling', [spellRow]));

    const styleRows = CHECK_ORDER.filter((id) => id !== 'spell').map((id) => {
      const meta = CHECK_META[id];
      return buildCheckRow(meta.color, meta.label, settings[id] !== false, (checked) => onToggle(id, checked));
    });
    sections.appendChild(buildSection('Style', styleRows));

    card.appendChild(sections);

    return { card, summary, sections };
  }

  // A small, non-interactive preview shown on hover over a highlighted word
  // or sentence -- separate from the click-triggered `.wa-popover` (which
  // carries action buttons and stays open until you click elsewhere), so a
  // stray mouse pass over one mark can't fight with a popover already open
  // for another. Shared by both the editor and the reading view.
  function createHoverTip() {
    // On a touch device there's no real "hover" -- the closest equivalent
    // is a finger already down on the screen, at which point showing a
    // tooltip that then has to be dismissed before the actual tap-to-open
    // popover registers is just an extra step in the way, not a preview.
    // (hover: hover) is true only when the primary input can meaningfully
    // hover (a mouse) -- false for touch, so this stays a no-op there and
    // callers fall straight through to the tap-triggered popover instead,
    // exactly like a phone visitor would expect.
    if (!(window.matchMedia && window.matchMedia('(hover: hover)').matches)) {
      return { show() {}, hide() {} };
    }
    const tip = document.createElement('div');
    tip.className = 'wa-hover-tip hidden';
    document.body.appendChild(tip);
    function show(mark) {
      tip.textContent = mark.dataset.waLabel || '';
      const rect = mark.getBoundingClientRect();
      tip.style.top = `${window.scrollY + rect.top - 8}px`;
      tip.style.left = `${window.scrollX + rect.left}px`;
      tip.classList.remove('hidden');
    }
    function hide() { tip.classList.add('hidden'); }
    return { show, hide };
  }

  // ---------------------------------------------------------------------
  // DOM wiring -- the chapter-text EDITOR (one instance per textarea)
  // ---------------------------------------------------------------------

  function setup(textarea) {
    // This app's own real dictionary now does spelling, so the browser's
    // native spellcheck would just double up on the same words with its
    // own (differently styled) red underline -- turn it off here.
    textarea.spellcheck = false;
    const storyId = textarea.dataset.storyId || null;
    let settings = loadSettings();

    const wrap = document.createElement('div');
    wrap.className = 'wa-wrap';
    textarea.parentNode.insertBefore(wrap, textarea);

    const { card, summary, sections } = buildControlsCard(settings, (id, checked) => {
      settings = Object.assign({}, settings, { [id]: checked });
      saveSettings(settings);
      render();
    });
    wrap.appendChild(card);

    // --- markdown preview toggle (editor only) ---
    let previewOn = false;
    try { previewOn = localStorage.getItem('wa-preview-on') === '1'; } catch (e) { /* ignore */ }
    const previewRow = buildCheckRow('#8b7bd8', 'Markdown preview', previewOn, (checked) => {
      previewOn = checked;
      try { localStorage.setItem('wa-preview-on', previewOn ? '1' : '0'); } catch (e2) { /* ignore */ }
      applyPreviewState();
    });
    sections.appendChild(buildSection('Markdown preview', [previewRow]));

    // --- existing comments: reference list + optional inline highlight ---
    // Only present on the edit-chapter page (see views.js's editChapterPage
    // and its #chapter-comments-data script) -- the new-story/new-chapter
    // pages have no chapter yet, so there's nothing to reference and this
    // whole block simply does nothing there.
    const commentsDataEl = document.getElementById('chapter-comments-data');
    let commentsPayload = [];
    if (commentsDataEl) {
      try { commentsPayload = JSON.parse(commentsDataEl.textContent) || []; } catch (e) { commentsPayload = []; }
    }
    const editorGridEl = document.querySelector('.chapter-body-grid');
    // The editor only ever runs for the chapter's own author (see the
    // route guards in server.js), so "show comments" defaults to on here.
    let commentsVisible = loadCommentsVisible(true);
    function applyCommentsVisibility() {
      if (editorGridEl) editorGridEl.classList.toggle('comments-hidden', !commentsVisible);
    }
    if (commentsDataEl && editorGridEl && commentsPayload.length) {
      const commentsRow = buildCheckRow('#4bbf7e', 'Comments', commentsVisible, (checked) => {
        commentsVisible = checked;
        saveCommentsVisible(checked);
        applyCommentsVisibility();
        scheduleRender();
      });
      sections.appendChild(buildSection('Comments', [commentsRow]));
    }
    applyCommentsVisibility();

    // Finds each existing comment's quoted passage in the CURRENT raw
    // textarea text with a plain substring search, re-run on every render
    // so edits that shift positions self-correct on the next pass. This is
    // a best-effort visual aid, not the source of truth for anchoring (that
    // stays server-side, exact, tied to the version the comment was made
    // on) -- a quote that no longer appears verbatim (already edited away)
    // or that only exists inside bold/italic text (the quote was captured
    // from the rendered, syntax-stripped text, so it won't literally match
    // raw markdown source in that case) is simply skipped rather than
    // guessed at.
    function resolveCommentRanges() {
      if (!commentsVisible || !commentsPayload.length) return [];
      const text = textarea.value;
      const found = [];
      for (const c of commentsPayload) {
        if (!c.quoted) continue;
        const idx = text.indexOf(c.quoted);
        if (idx === -1) continue;
        found.push({ start: idx, end: idx + c.quoted.length, status: c.status });
      }
      return found;
    }

    // --- editor width controls ---
    // The textarea (and its overlay, kept matched via syncOverlayWidth)
    // fills the available space by default (.wa-textarea's width:100%),
    // same as any other block element -- until the user drags its
    // resize:both handle, at which point that pixel width is remembered
    // (see the ResizeObserver below) and wins from then on, on every
    // future visit, per the "unless manually overridden" rule. These two
    // buttons are the way back: one clears that override (returns to
    // filling the normal chapter-form column), the other both clears it
    // and additionally widens the whole writer-card past its usual cap so
    // the editor can use the full page width -- for wide-screen setups
    // where the normal column feels cramped for long-form writing.
    const writerCardEl = textarea.closest('.writer-card');
    const widthBar = document.createElement('div');
    widthBar.className = 'wa-width-bar';
    const widthLabel = document.createElement('span');
    widthLabel.className = 'wa-width-label';
    widthLabel.textContent = 'Editor width:';
    const fitChapterBtn = document.createElement('button');
    fitChapterBtn.type = 'button';
    fitChapterBtn.className = 'btn ghost tiny';
    fitChapterBtn.textContent = 'Fit to chapter';
    const fitScreenBtn = document.createElement('button');
    fitScreenBtn.type = 'button';
    fitScreenBtn.className = 'btn ghost tiny';
    fitScreenBtn.textContent = 'Fill screen';
    widthBar.appendChild(widthLabel);
    widthBar.appendChild(fitChapterBtn);
    widthBar.appendChild(fitScreenBtn);
    wrap.appendChild(widthBar);

    function setFullWidth(on) {
      try { localStorage.setItem('wa-editor-fullwidth', on ? '1' : '0'); } catch (e) { /* ignore */ }
      if (writerCardEl) writerCardEl.classList.toggle('wa-fullwidth', on);
    }
    let fullWidthOn = false;
    try { fullWidthOn = localStorage.getItem('wa-editor-fullwidth') === '1'; } catch (e) { /* ignore */ }
    setFullWidth(fullWidthOn);

    fitChapterBtn.addEventListener('click', () => {
      setFullWidth(false);
      try { localStorage.removeItem('wa-editor-width'); } catch (e) { /* ignore */ }
      applyPreviewState();
    });
    fitScreenBtn.addEventListener('click', () => {
      setFullWidth(true);
      try { localStorage.removeItem('wa-editor-width'); } catch (e) { /* ignore */ }
      applyPreviewState();
    });

    const splitWrap = document.createElement('div');
    splitWrap.className = 'wa-split';
    wrap.appendChild(splitWrap);

    const editorWrap = document.createElement('div');
    editorWrap.className = 'wa-editor-wrap';
    splitWrap.appendChild(editorWrap);

    const overlay = document.createElement('div');
    overlay.className = 'wa-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    editorWrap.appendChild(overlay);
    editorWrap.appendChild(textarea);
    textarea.classList.add('wa-textarea');

    const previewPane = document.createElement('div');
    previewPane.className = 'md-preview';
    previewPane.innerHTML = '<p class="muted">The preview will appear here.</p>';
    splitWrap.appendChild(previewPane);

    // The overlay is a separate element from the textarea (absolutely
    // positioned on top of it -- see .wa-overlay/.wa-textarea in
    // style.css), stretched to fill their shared wrapper by default. That
    // only matches the textarea's own box as long as the textarea is also
    // filling the wrapper; the moment the textarea gets an explicit
    // narrower width (restored below, or live while dragging its
    // resize:both handle), the overlay would stay full-width, wrapping its
    // (identical) text later than the narrower textarea actually does --
    // the two visibly drift apart, and the textarea's own scrollbar ends
    // up cutting through the middle of the wider overlay's text instead of
    // sitting at its right edge. Keeping the overlay's width locked to the
    // textarea's actual rendered width is what keeps them wrapping (and
    // scrolling) identically.
    function syncOverlayWidth() {
      overlay.style.width = previewOn ? '' : `${textarea.getBoundingClientRect().width}px`;
    }

    function applyPreviewState() {
      splitWrap.classList.toggle('wa-split-active', previewOn);
      if (previewOn) {
        textarea.style.width = ''; // let the 50/50 flex layout govern width
        schedulePreview();
      } else {
        let savedWidth = null;
        try { savedWidth = localStorage.getItem('wa-editor-width'); } catch (e) { /* ignore */ }
        // No saved width (never manually resized, or reset via one of the
        // "Fit to..." buttons below) -- fall back to .wa-textarea's own
        // width:100%, so it tracks the available space same as any other
        // block element, rather than staying stuck at a stale pixel value.
        textarea.style.width = savedWidth ? `${savedWidth}px` : '';
      }
      syncOverlayWidth();
    }

    let previewTimer = null;
    function schedulePreview() {
      if (!previewOn) return;
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(renderPreview, 400);
    }
    function renderPreview() {
      fetch('/markdown/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textarea.value }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && typeof data.html === 'string') {
            previewPane.innerHTML = data.html || '<p class="muted">Nothing to preview yet.</p>';
          }
        })
        .catch(() => { /* keep whatever preview is already showing */ });
    }

    // Remembers a manually-resized width (the textarea has resize:both) so
    // it's still that width next time -- but only while the preview is
    // off, since with it on the width is governed by the 50/50 flex split.
    // ResizeObserver alone can't tell "the user dragged the corner handle"
    // apart from "the textarea's size changed for some other reason" (the
    // page loading into a narrower/wider viewport, a saved width being
    // restored, the Fit-to-chapter/Fill-screen buttons, ...) -- it fires
    // for all of those identically. Without this, loading the editor on a
    // narrow phone once was enough to "learn" that width and lock the
    // editor to it forever after, on every device, since every resize
    // looked like a manual one. So only track real drags: the native
    // resize:both handle lives in the last ~20px of the bottom-right
    // corner, and dragging it means a mousedown that starts there.
    let isDraggingResizeHandle = false;
    textarea.addEventListener('mousedown', (ev) => {
      const rect = textarea.getBoundingClientRect();
      isDraggingResizeHandle = (rect.right - ev.clientX < 20) && (rect.bottom - ev.clientY < 20);
    });
    window.addEventListener('mouseup', () => {
      // Cleared on a short delay, not immediately -- the ResizeObserver
      // callback for the drag's final size fires asynchronously and can
      // land just after mouseup.
      setTimeout(() => { isDraggingResizeHandle = false; }, 50);
    });

    if (typeof ResizeObserver !== 'undefined') {
      let widthTimer = null;
      const ro = new ResizeObserver(() => {
        if (previewOn) return;
        syncOverlayWidth(); // live, not debounced -- keep the overlay matched to the drag as it happens
        if (!isDraggingResizeHandle) return;
        if (widthTimer) clearTimeout(widthTimer);
        widthTimer = setTimeout(() => {
          try { localStorage.setItem('wa-editor-width', String(Math.round(textarea.getBoundingClientRect().width))); } catch (e) { /* ignore */ }
        }, 300);
      });
      ro.observe(textarea);
    }

    const popover = document.createElement('div');
    popover.className = 'wa-popover hidden';
    document.body.appendChild(popover);

    let currentRanges = [];
    let timer = null;
    let storyWords = new Set();

    // Kick off both fetches in the background. Whichever finishes last
    // triggers a re-render, so anything already typed before they resolve
    // gets its spelling checked retroactively instead of being stuck
    // looking clean until the next keystroke.
    Promise.all([loadDictionary(), loadStoryWords(storyId)]).then(([, words]) => {
      if (words) storyWords = words;
      render();
    });

    function render() {
      const { html, ranges, stats } = analyze(textarea.value, storyWords, settings, resolveCommentRanges());
      overlay.innerHTML = html + (textarea.value.endsWith('\n') ? '&nbsp;' : '');
      currentRanges = ranges;
      summary.innerHTML = summaryHtml(stats, textarea.value);
      syncScroll();
    }

    function syncScroll() {
      overlay.scrollTop = textarea.scrollTop;
      overlay.scrollLeft = textarea.scrollLeft;
    }

    function scheduleRender() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(render, 250);
    }

    textarea.addEventListener('input', () => { scheduleRender(); schedulePreview(); });
    textarea.addEventListener('scroll', syncScroll);
    window.addEventListener('resize', syncScroll);

    const hoverTip = createHoverTip();

    function hidePopover() {
      popover.classList.add('hidden');
    }

    function rangeAt(pos) {
      // Prefer the most specific (shortest) range containing pos.
      let best = null;
      for (const r of currentRanges) {
        if (pos >= r.start && pos < r.end) {
          if (!best || (r.end - r.start) < (best.end - best.start)) best = r;
        }
      }
      return best;
    }

    // The overlay is what's actually visible (the real textarea's text is
    // transparent -- see .wa-textarea) but it's *underneath* the textarea
    // in the stacking order (.wa-textarea has z-index:1, needed so it can
    // still be typed into/clicked normally) -- so the real hit-test target
    // of any mouse event in this area is always the textarea, never a
    // mark, no matter what pointer-events says on the mark itself. (An
    // earlier version tried pointer-events:auto on the marks directly;
    // dispatching synthetic events straight at a mark in testing made
    // that look like it worked, since dispatchEvent() skips hit-testing
    // entirely, but real clicks/hovers -- which go through the browser's
    // actual point-based hit test -- always landed on the textarea on
    // top, so hover never fired and clicks never found a mark.)
    // markUnderPoint briefly makes the textarea transparent to hit-testing
    // so elementFromPoint can "see" the overlay mark actually rendered at
    // that point, then immediately restores it -- synchronous, so there's
    // no visible or functional gap in the textarea's own interactivity.
    function markUnderPoint(x, y) {
      const prevPointerEvents = textarea.style.pointerEvents;
      textarea.style.pointerEvents = 'none';
      const el = document.elementFromPoint(x, y);
      textarea.style.pointerEvents = prevPointerEvents;
      return el ? /** @type {HTMLElement|null} */ (el.closest('.wa-word, .wa-sentence')) : null;
    }

    let hoveredMark = null;
    textarea.addEventListener('mousemove', (ev) => {
      const mark = markUnderPoint(ev.clientX, ev.clientY);
      if (mark === hoveredMark) return;
      hoveredMark = mark;
      if (mark) hoverTip.show(mark); else hoverTip.hide();
      // mark.wa-word's own cursor:pointer (see style.css) never shows --
      // the textarea sitting on top has the only cursor the browser ever
      // actually applies here -- so set it directly on hover/unhover.
      textarea.style.cursor = mark ? 'pointer' : '';
    });
    textarea.addEventListener('mouseleave', () => {
      hoveredMark = null;
      hoverTip.hide();
      textarea.style.cursor = '';
    });

    textarea.addEventListener('click', (ev) => {
      const mark = markUnderPoint(ev.clientX, ev.clientY);
      if (!mark) { hidePopover(); return; }
      hoverTip.hide();
      // mark's own start/end always satisfy rangeAt's containment check
      // (it's literally where that range came from), so this recovers the
      // exact original range object -- suggestion included -- rather than
      // reconstructing one from the mark's (more limited) dataset.
      const range = rangeAt(Number(mark.dataset.waStart));
      if (!range) { hidePopover(); return; }
      // The click landed on the real textarea (that's the only element
      // that ever receives real clicks here -- see above), so the caret
      // already moved to the clicked position on its own; nothing to do.

      popover.innerHTML = '';
      const text = document.createElement('div');
      text.className = 'wa-popover-text';
      text.textContent = range.label;
      popover.appendChild(text);
      if (range.suggestion) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn tiny';
        btn.textContent = `Use "${range.suggestion}"`;
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          const original = textarea.value.slice(range.start, range.end);
          const replacement = matchCase(original, range.suggestion);
          textarea.setRangeText(replacement, range.start, range.end, 'end');
          hidePopover();
          textarea.focus();
          scheduleRender();
        });
        popover.appendChild(btn);
      } else if (range.kind === 'spell' && storyId) {
        const word = textarea.value.slice(range.start, range.end);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn tiny';
        btn.textContent = `Add "${word}" to this story's dictionary`;
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          btn.disabled = true;
          fetch(`/stories/${storyId}/dictionary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ word }),
          })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error('request failed'))))
            .then((data) => {
              storyWords = new Set((data.words || []).map((w) => w.toLowerCase()));
              hidePopover();
              scheduleRender();
            })
            .catch(() => { btn.disabled = false; btn.textContent = 'Could not save -- try again'; });
        });
        popover.appendChild(btn);
      }

      // Position right above the actual mark that was clicked -- reliable
      // now that the click comes from a real element in the overlay
      // (previously this had to fall back to the textarea's own box, since
      // there's no cross-browser way to get the on-screen position of a
      // character inside a plain <textarea>).
      const rect = mark.getBoundingClientRect();
      popover.style.top = `${window.scrollY + rect.top - 8}px`;
      popover.style.left = `${window.scrollX + rect.left}px`;
      popover.classList.remove('hidden');
    });

    document.addEventListener('click', (ev) => {
      // Every click in the editor area lands on the textarea itself (see
      // markUnderPoint above) -- its own click listener already decided
      // whether to show or hide the popover, so this is only for clicks
      // truly outside the editor.
      if (ev.target === textarea) return;
      if (popover.contains(/** @type {Node} */ (ev.target))) return;
      hidePopover();
    });

    function matchCase(original, suggestion) {
      if (original === original.toUpperCase() && original !== original.toLowerCase()) return suggestion.toUpperCase();
      if (original[0] === original[0].toUpperCase()) return suggestion[0].toUpperCase() + suggestion.slice(1);
      return suggestion;
    }

    applyPreviewState();
    render();
  }

  // ---------------------------------------------------------------------
  // DOM wiring -- the READ-ONLY chapter page
  // ---------------------------------------------------------------------

  // Walks every text node under `root`, in document order, without
  // touching anything (bold/italic/links/existing comment highlights are
  // left completely alone -- this only reads).
  function textNodesInOrder(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n = walker.nextNode();
    while (n) { nodes.push(n); n = walker.nextNode(); }
    return nodes;
  }

  function flattenText(root) {
    return textNodesInOrder(root).map((n) => n.nodeValue).join('');
  }

  // Converts a flattened-text offset back into a (node, offset) DOM point
  // by re-walking the LIVE tree every time. This is intentionally not
  // cached: wrapping one range can split a text node the walk previously
  // saw, and re-walking is the simplest way to always get correct, live
  // node references afterward (a chapter's text is small enough that this
  // costs nothing noticeable).
  function pointAt(root, pos) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let total = 0;
    let node = walker.nextNode();
    let last = null;
    while (node) {
      const len = node.nodeValue.length;
      if (pos <= total + len) return { node, offset: pos - total };
      total += len;
      last = node;
      node = walker.nextNode();
    }
    return last ? { node: last, offset: last.nodeValue.length } : null;
  }

  // Wraps every range in its own <mark>, directly in the existing DOM,
  // without disturbing bold/italic/links or the comment-highlight <span>s
  // already there. Sentence-level ranges are applied first (they're always
  // supersets of the word-level ranges inside them, by construction), so
  // word marks end up nested inside their sentence mark, matching the
  // editor's overlay. A range that can't be wrapped cleanly (very rare --
  // e.g. it would partially straddle a bold/italic boundary) is simply
  // skipped rather than risking a broken page.
  function applyRangesToDom(root, ranges) {
    const ordered = ranges.slice().sort((a, b) => (b.end - b.start) - (a.end - a.start));
    for (const r of ordered) {
      if (r.end <= r.start) continue;
      const startPt = pointAt(root, r.start);
      const endPt = pointAt(root, r.end);
      if (!startPt || !endPt) continue;
      try {
        const range = document.createRange();
        range.setStart(startPt.node, startPt.offset);
        range.setEnd(endPt.node, endPt.offset);
        if (range.collapsed) continue;
        const isSentence = r.kind.indexOf('sentence-') === 0;
        const mark = document.createElement('mark');
        if (isSentence) {
          const severity = r.kind.slice('sentence-'.length);
          mark.className = `wa-sentence wa-${severity}`;
          mark.style.cssText = sentenceMarkStyle(severity);
        } else {
          mark.className = `wa-word wa-${r.kind}`;
          mark.style.cssText = wordMarkStyle(r.kind);
        }
        mark.dataset.waLabel = r.label;
        mark.dataset.waKind = r.kind;
        range.surroundContents(mark);
      } catch (e) {
        // Skip this one highlight; never let it break the reading page.
      }
    }
  }

  // On the reading page the controls belong above the whole two-column
  // layout, not inside the sheet the chapter is printed on -- dropping the
  // card in right before #chapter-text (which sits inside .reading-pane)
  // reads as a box stuck onto the manuscript. It has to go before the grid
  // itself rather than before .reading-pane, though: .reading-pane is a
  // grid item, so anything inserted as its sibling becomes a third grid
  // item and takes a column of its own. Falls back to the old position
  // anywhere that structure isn't there.
  function insertControlsCard(card, container) {
    const anchor = container.closest('.chapter-body-grid') || container.closest('.reading-pane') || container;
    anchor.parentNode.insertBefore(card, anchor);
  }

  function setupReadView(container) {
    const storyId = container.dataset.storyId || null;
    const canEditDictionary = container.dataset.canEditDictionary === '1';
    const isAuthor = container.dataset.isAuthor === '1';
    const gridEl = container.closest('.chapter-body-grid');

    // "Show comments" is available to everyone; the writing-quality checks
    // below are only ever built for the story's own author -- a reviewer
    // reading someone else's chapter never even fetches the (multi-MB)
    // dictionary or runs the analysis, since it's not their tool to use.
    let commentsVisible = loadCommentsVisible(isAuthor);
    function applyCommentsVisibility() {
      if (gridEl) gridEl.classList.toggle('comments-hidden', !commentsVisible);
    }
    applyCommentsVisibility(); // apply immediately, before any async work, to avoid a flash of the other state

    function commentsToggleChanged(checked) {
      commentsVisible = checked;
      saveCommentsVisible(checked);
      applyCommentsVisibility();
    }

    // Wiki-link visibility is its own toggle (not tied to isAuthor the way
    // the writing-quality checks are) -- every reader gets it, since it's
    // about how *they* want to read, same reasoning as "Fill screen".
    let wikiLinksVisible = loadWikiLinksVisible();
    function applyWikiLinksVisibility() {
      container.classList.toggle('wikilinks-hidden', !wikiLinksVisible);
    }
    applyWikiLinksVisibility();
    function wikiLinksToggleChanged(checked) {
      wikiLinksVisible = checked;
      saveWikiLinksVisible(checked);
      applyWikiLinksVisibility();
    }

    if (!isAuthor) {
      const commentsRow = buildCheckRow('#4bbf7e', 'Comments', commentsVisible, commentsToggleChanged);
      const wikiRow = buildCheckRow('#5a8cd8', 'Wiki links', wikiLinksVisible, wikiLinksToggleChanged);
      const card = buildMinimalCard(commentsRow);
      card.querySelector('.wa-sections').appendChild(buildSection('Wiki', [wikiRow]));
      insertControlsCard(card, container);
      return;
    }

    let settings = loadSettings(READ_SETTINGS_KEY, READ_DEFAULT_SETTINGS);
    let storyWords = new Set();

    const { card, summary, sections } = buildControlsCard(settings, (id, checked) => {
      settings = Object.assign({}, settings, { [id]: checked });
      saveSettings(settings, READ_SETTINGS_KEY);
      render();
    }, { startOpen: false });
    const commentsRow = buildCheckRow('#4bbf7e', 'Comments', commentsVisible, commentsToggleChanged);
    sections.appendChild(buildSection('Comments', [commentsRow]));
    const wikiRow = buildCheckRow('#5a8cd8', 'Wiki links', wikiLinksVisible, wikiLinksToggleChanged);
    sections.appendChild(buildSection('Wiki', [wikiRow]));
    card.classList.add('wa-card-reading');
    insertControlsCard(card, container);

    const popover = document.createElement('div');
    popover.className = 'wa-popover hidden';
    document.body.appendChild(popover);
    function hidePopover() { popover.classList.add('hidden'); }
    const hoverTip = createHoverTip();

    function clearMarks() {
      container.querySelectorAll('mark.wa-word, mark.wa-sentence').forEach((mark) => {
        mark.replaceWith(...mark.childNodes);
      });
      container.normalize();
    }

    function render() {
      clearMarks();
      hidePopover();
      const text = flattenText(container);
      const { ranges, stats } = analyze(text, storyWords, settings);
      applyRangesToDom(container, ranges);
      summary.innerHTML = summaryHtml(stats, text);
    }

    Promise.all([loadDictionary(), loadStoryWords(storyId)]).then(([, words]) => {
      if (words) storyWords = words;
      render();
    });

    container.addEventListener('mouseover', (ev) => {
      const mark = ev.target.closest('mark.wa-word, mark.wa-sentence');
      if (mark) hoverTip.show(mark);
    });
    container.addEventListener('mouseout', (ev) => {
      const mark = ev.target.closest('mark.wa-word, mark.wa-sentence');
      if (mark && !mark.contains(ev.relatedTarget)) hoverTip.hide();
    });

    container.addEventListener('click', (ev) => {
      const mark = ev.target.closest('mark.wa-word, mark.wa-sentence');
      if (!mark) { hidePopover(); return; }
      hoverTip.hide();

      popover.innerHTML = '';
      const text = document.createElement('div');
      text.className = 'wa-popover-text';
      text.textContent = mark.dataset.waLabel || '';
      popover.appendChild(text);

      if (mark.dataset.waKind === 'spell' && storyId && canEditDictionary) {
        const word = mark.textContent;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn tiny';
        btn.textContent = `Add "${word}" to this story's dictionary`;
        btn.addEventListener('click', (ev2) => {
          ev2.preventDefault();
          btn.disabled = true;
          fetch(`/stories/${storyId}/dictionary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ word }),
          })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error('request failed'))))
            .then((data) => {
              storyWords = new Set((data.words || []).map((w) => w.toLowerCase()));
              hidePopover();
              render();
            })
            .catch(() => { btn.disabled = false; btn.textContent = 'Could not save -- try again'; });
        });
        popover.appendChild(btn);
      }

      const rect = mark.getBoundingClientRect();
      popover.style.top = `${window.scrollY + rect.top - 8}px`;
      popover.style.left = `${window.scrollX + rect.left}px`;
      popover.classList.remove('hidden');
    });

    document.addEventListener('click', (ev) => {
      if (container.contains(ev.target)) return;
      if (popover.contains(/** @type {Node} */ (ev.target))) return;
      hidePopover();
    });
  }

  // ---------------------------------------------------------------------
  // boot
  // ---------------------------------------------------------------------

  function init() {
    document.querySelectorAll('form.chapter-form textarea[name="content"]').forEach((textarea) => {
      try {
        setup(textarea);
      } catch (err) {
        // Never let this optional enhancement break the actual chapter
        // form -- the plain textarea keeps working either way.
        // eslint-disable-next-line no-console
        console.error('writing-analyzer failed to initialize (editor):', err);
      }
    });

    const readContainer = document.getElementById('chapter-text');
    if (readContainer) {
      try {
        setupReadView(readContainer);
      } catch (err) {
        // Same guarantee for the reading page: comments and everything
        // else on the page must keep working even if this fails.
        // eslint-disable-next-line no-console
        console.error('writing-analyzer failed to initialize (reading view):', err);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
