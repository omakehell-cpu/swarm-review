// public/js/writing-analyzer.js -- Hemingway-style writing analysis for the
// chapter text editor AND the chapter reading page. No build step, no
// dependencies. No AI/LLM of any kind is used anywhere in this file, and it
// never talks to anything but this same app's own server (plain GET
// requests for word lists, a GET/POST pair for the story's own spelling
// exceptions, and a POST for rendering a markdown preview) -- no external
// service, API, or third party is ever contacted.
//
// What it does:
//   - Several independent checks, each with its own color, each one
//     individually switchable on/off (the choice is remembered across
//     pages and devices sharing this browser's storage):
//       - Spelling: every word is checked against a real (~370,000-word)
//         English dictionary (served as a static file -- see
//         server.js/tryServeStatic and public/dictionary/words-en.txt) and
//         underlined in teal if it isn't recognized. Because this is a
//         shared fiction universe full of invented names, each story keeps
//         its own approved-word list (the "Story dictionary" on the story
//         page); clicking a teal highlight offers to add that word to it.
//         On by default.
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
  const CHECK_META = {
    spell: { label: 'Spelling', color: '#3fb8a8' },
    passive: { label: 'Passive voice', color: '#5a8cd8' },
    adverb: { label: 'Adverbs', color: '#d8954b' },
    filler: { label: 'Filler words', color: '#d85a9e' },
    complex: { label: 'Complex words', color: '#a865d8' },
    sentence: { label: 'Long sentences', color: '#d8a44b' },
  };
  const CHECK_ORDER = ['spell', 'passive', 'adverb', 'filler', 'complex', 'sentence'];
  const SEVERITY_COLOR = { yellow: '#d8a44b', red: '#d8654b' };

  const DEFAULT_SETTINGS = { spell: true, passive: true, adverb: true, filler: true, complex: true, sentence: true };
  const SETTINGS_KEY = 'wa-settings-v2';
  const LEGACY_ENABLED_KEY = 'wa-enabled'; // the old single on/off switch

  function loadSettings() {
    const settings = Object.assign({}, DEFAULT_SETTINGS);
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        CHECK_ORDER.forEach((id) => { if (typeof parsed[id] === 'boolean') settings[id] = parsed[id]; });
        return settings;
      }
      // First time this browser sees the new per-check settings: honor the
      // old master on/off switch, if it was ever turned off, instead of
      // silently re-enabling everything.
      if (localStorage.getItem(LEGACY_ENABLED_KEY) === '0') {
        CHECK_ORDER.forEach((id) => { settings[id] = false; });
      }
    } catch (e) { /* ignore, defaults stand */ }
    return settings;
  }

  function saveSettings(settings) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Inline style for a word-level <mark>, so every color lives in this one
  // place instead of being duplicated across CSS classes.
  function wordMarkStyle(kind) {
    if (kind === 'spell') {
      return `text-decoration-line:underline;text-decoration-style:wavy;text-decoration-color:${CHECK_META.spell.color};text-underline-offset:3px;`;
    }
    const meta = CHECK_META[kind];
    return meta ? `background:${hexToRgba(meta.color, 0.38)};` : '';
  }

  function sentenceMarkStyle(severity) {
    const color = SEVERITY_COLOR[severity];
    return color ? `background:${hexToRgba(color, severity === 'red' ? 0.35 : 0.28)};` : '';
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

  // The full word list (~370,000 English words, one per line) is fetched
  // once per page load from this same server -- see server.js and
  // public/dictionary/words-en.txt -- and kept as a Set for fast lookups.
  // Stays null (spelling checks simply don't run yet) until it's loaded.
  let DICTIONARY = null;
  let dictionaryPromise = null;
  function loadDictionary() {
    if (dictionaryPromise) return dictionaryPromise;
    dictionaryPromise = fetch('/dictionary/words-en.txt')
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => {
        DICTIONARY = new Set(text.split(/\r?\n/).map((w) => w.trim()).filter(Boolean));
      })
      .catch(() => { DICTIONARY = null; });
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

  function knownWord(lower, storyWords) {
    if (CONTRACTIONS.has(lower)) return true;
    if (DICTIONARY.has(lower)) return true;
    if (storyWords && storyWords.has(lower)) return true;
    // Strip a trailing possessive ("Aetherius's" -> "aetherius", "the
    // Joneses'" -> "joneses") and check the stem too, so possessives of
    // otherwise-known words don't get flagged just for the apostrophe.
    if (lower.endsWith("'s")) return knownWordStem(lower.slice(0, -2), storyWords);
    if (lower.endsWith("s'")) return knownWordStem(lower.slice(0, -1), storyWords);
    return false;
  }
  function knownWordStem(stem, storyWords) {
    return DICTIONARY.has(stem) || Boolean(storyWords && storyWords.has(stem));
  }

  // Returns {start, end, kind: 'spell', label} for every word-like token in
  // `sentenceText` that isn't in the dictionary, a contraction, or this
  // story's approved-word list. Returns [] while the dictionary hasn't
  // loaded yet, rather than guessing.
  function findSpellingHighlights(sentenceText, storyWords) {
    if (!DICTIONARY) return [];
    const found = [];
    WORD_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = WORD_TOKEN_RE.exec(sentenceText))) {
      const raw = m[0];
      if (raw.length < 2) continue;
      const lower = raw.toLowerCase();
      if (knownWord(lower, storyWords)) continue;
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

  // Returns { html, ranges, stats } where `html` is what should go inside
  // the editor's overlay (unused by the read-only view -- it applies
  // `ranges` directly onto the existing DOM instead, see applyRangesToDom
  // below), `ranges` is a flat list of {start, end, kind, label,
  // suggestion} in whole-text offsets, and `stats` is counts used by the
  // summary bar. `storyWords` is the Set of this story's approved words
  // (see loadStoryWords above) -- pass an empty Set (or leave it
  // undefined) if there's no story yet, e.g. the "new story" page, or
  // while it's still loading. `settings` controls which checks run.
  function analyze(text, storyWords, settings) {
    const chunks = splitSentences(text);
    const ranges = [];
    const stats = {
      yellow: 0, red: 0, passive: 0, adverb: 0, filler: 0, complex: 0, spell: 0, maxGrade: 0,
    };
    let html = '';
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

      // Render this chunk's inner HTML, nesting word-level marks inside the
      // sentence-level mark (if any). Word ranges never overlap each other
      // (guaranteed by findWordHighlights), so this is a simple walk. Only
      // the editor's overlay actually uses this string -- see the comment
      // above `html` in the return value.
      let inner = '';
      let cursor = 0;
      for (const w of wordHighlights) {
        if (w.start > cursor) inner += escapeHtml(chunk.text.slice(cursor, w.start));
        inner += `<mark class="wa-word wa-${w.kind}" style="${wordMarkStyle(w.kind)}">${escapeHtml(chunk.text.slice(w.start, w.end))}</mark>`;
        cursor = w.end;
      }
      if (cursor < chunk.text.length) inner += escapeHtml(chunk.text.slice(cursor));

      if (score.severity) {
        html += `<mark class="wa-sentence wa-${score.severity}" style="${sentenceMarkStyle(score.severity)}">${inner}</mark>`;
      } else {
        html += inner;
      }
    }

    ranges.sort((a, b) => a.start - b.start);
    return { html, ranges, stats };
  }

  // Builds one "● N label" chip; returns '' when the count is zero so
  // empty categories don't clutter the bar. `colorId` looks up its color
  // in CHECK_META/SEVERITY_COLOR so the dot always matches its check/mark.
  function statChip(color, count, singular, plural) {
    if (!count) return '';
    return `<span class="wa-chip"><span class="wa-dot" style="background:${color}"></span>${count} ${count === 1 ? singular : plural}</span>`;
  }

  function summaryHtml(stats) {
    const total = stats.yellow + stats.red + stats.passive + stats.adverb + stats.filler + stats.complex + stats.spell;
    if (total === 0) return 'No issues spotted.';
    return [
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
  // shared control card (colored, clickable check toggles + live counts)
  // ---------------------------------------------------------------------

  // Builds the visual card that sits above the text in both the editor and
  // the reading page. `onToggle(checkId, enabled)` fires when a pill is
  // clicked. Returns the card element plus a `summary` element to update
  // and a `checksRow` element callers can append extra pills to (the
  // editor adds a "Markdown preview" pill after this).
  function buildControlsCard(settings, onToggle) {
    const card = document.createElement('div');
    card.className = 'wa-card';

    const head = document.createElement('div');
    head.className = 'wa-card-head';
    const title = document.createElement('span');
    title.className = 'wa-card-title';
    title.textContent = 'Writing checks';
    const summary = document.createElement('span');
    summary.className = 'wa-summary';
    summary.innerHTML = 'Checking...';
    head.appendChild(title);
    head.appendChild(summary);
    card.appendChild(head);

    const checksRow = document.createElement('div');
    checksRow.className = 'wa-checks';
    CHECK_ORDER.forEach((id) => {
      const meta = CHECK_META[id];
      const pill = document.createElement('label');
      pill.className = 'wa-check-pill';
      pill.style.setProperty('--wa-color', meta.color);
      pill.style.setProperty('--wa-bg-active', hexToRgba(meta.color, 0.16));
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = settings[id] !== false;
      input.addEventListener('change', () => {
        pill.classList.toggle('active', input.checked);
        onToggle(id, input.checked);
      });
      const dot = document.createElement('span');
      dot.className = 'wa-check-dot';
      pill.appendChild(input);
      pill.appendChild(dot);
      pill.appendChild(document.createTextNode(meta.label));
      pill.classList.toggle('active', input.checked);
      checksRow.appendChild(pill);
    });
    card.appendChild(checksRow);

    return { card, summary, checksRow };
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

    const { card, summary, checksRow } = buildControlsCard(settings, (id, checked) => {
      settings = Object.assign({}, settings, { [id]: checked });
      saveSettings(settings);
      render();
    });
    wrap.appendChild(card);

    // --- markdown preview toggle (editor only) ---
    const previewPill = document.createElement('label');
    previewPill.className = 'wa-check-pill wa-preview-pill';
    previewPill.style.setProperty('--wa-color', '#8b7bd8');
    previewPill.style.setProperty('--wa-bg-active', hexToRgba('#8b7bd8', 0.16));
    const previewInput = document.createElement('input');
    previewInput.type = 'checkbox';
    let previewOn = false;
    try { previewOn = localStorage.getItem('wa-preview-on') === '1'; } catch (e) { /* ignore */ }
    previewInput.checked = previewOn;
    const previewDot = document.createElement('span');
    previewDot.className = 'wa-check-dot';
    previewPill.appendChild(previewInput);
    previewPill.appendChild(previewDot);
    previewPill.appendChild(document.createTextNode('Markdown preview'));
    previewPill.classList.toggle('active', previewOn);
    checksRow.appendChild(previewPill);

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

    function applyPreviewState() {
      splitWrap.classList.toggle('wa-split-active', previewOn);
      if (previewOn) {
        textarea.style.width = ''; // let the 50/50 flex layout govern width
        schedulePreview();
      } else {
        try {
          const savedWidth = localStorage.getItem('wa-editor-width');
          if (savedWidth) textarea.style.width = `${savedWidth}px`;
        } catch (e) { /* ignore */ }
      }
    }

    previewInput.addEventListener('change', () => {
      previewOn = previewInput.checked;
      previewPill.classList.toggle('active', previewOn);
      try { localStorage.setItem('wa-preview-on', previewOn ? '1' : '0'); } catch (e) { /* ignore */ }
      applyPreviewState();
    });

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
    if (typeof ResizeObserver !== 'undefined') {
      let widthTimer = null;
      const ro = new ResizeObserver(() => {
        if (previewOn) return;
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
      const { html, ranges, stats } = analyze(textarea.value, storyWords, settings);
      overlay.innerHTML = html + (textarea.value.endsWith('\n') ? '&nbsp;' : '');
      currentRanges = ranges;
      summary.innerHTML = summaryHtml(stats);
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

    textarea.addEventListener('click', () => {
      const pos = textarea.selectionStart;
      const range = rangeAt(pos);
      if (!range) { hidePopover(); return; }
      textarea.setSelectionRange(range.start, range.end);

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

      // Position the popover near the textarea's own box rather than trying
      // to compute the exact on-screen coordinates of a character inside a
      // <textarea> (which has no reliable cross-browser API) -- simple and
      // always visible.
      const rect = textarea.getBoundingClientRect();
      popover.style.top = `${window.scrollY + rect.top - 8}px`;
      popover.style.left = `${window.scrollX + rect.left}px`;
      popover.classList.remove('hidden');
    });

    document.addEventListener('click', (ev) => {
      if (ev.target === textarea) return;
      if (popover.contains(ev.target)) return;
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

  function setupReadView(container) {
    const storyId = container.dataset.storyId || null;
    const canEditDictionary = container.dataset.canEditDictionary === '1';
    let settings = loadSettings();
    let storyWords = new Set();

    const { card, summary } = buildControlsCard(settings, (id, checked) => {
      settings = Object.assign({}, settings, { [id]: checked });
      saveSettings(settings);
      render();
    });
    card.classList.add('wa-card-reading');
    container.parentNode.insertBefore(card, container);

    const popover = document.createElement('div');
    popover.className = 'wa-popover hidden';
    document.body.appendChild(popover);
    function hidePopover() { popover.classList.add('hidden'); }

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
      summary.innerHTML = summaryHtml(stats);
    }

    Promise.all([loadDictionary(), loadStoryWords(storyId)]).then(([, words]) => {
      if (words) storyWords = words;
      render();
    });

    container.addEventListener('click', (ev) => {
      const mark = ev.target.closest('mark.wa-word, mark.wa-sentence');
      if (!mark) { hidePopover(); return; }

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
      if (popover.contains(ev.target)) return;
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
