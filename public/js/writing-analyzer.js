// public/js/writing-analyzer.js -- Hemingway-style writing analysis for the
// chapter text editor. No build step, no dependencies, no network calls of
// any kind (in particular: no AI/LLM of any kind is used anywhere in this
// file -- every highlight below comes from a fixed, hand-written rule or
// word list that runs entirely in the browser).
//
// What it does:
//   - Splits the text into sentences and scores each one with the standard
//     Flesch-Kincaid grade-level formula (a public, well known readability
//     formula -- not something proprietary to any product). Sentences that
//     score as "hard to read" are shaded yellow, "very hard to read" are
//     shaded red.
//   - Flags common weakening language -- adverbs ending in "-ly", passive
//     voice ("was written", "is being told"), and filler/hedge words and
//     phrases ("very", "sort of", "due to the fact that") -- in blue.
//   - Flags a curated list of unnecessarily complex/formal words in purple,
//     each with a plainer suggested alternative.
//   - Lets you click any highlighted span to see why it was flagged and
//     (for complex words) swap in the suggested word with one click.
//
// What it deliberately does NOT do:
//   - It does not check spelling. There is no bundled dictionary here --
//     building or maintaining a real one is a much bigger job than this
//     file, and your browser already ships a real, comprehensive,
//     well-maintained spelling dictionary for free (the wavy red underline
//     you already see while typing in the textarea). This script only adds
//     the style/readability layer on top of that.
//   - It never calls out to any server, API, or AI model. All of the
//     analysis below runs synchronously, offline, on whatever is currently
//     in the textarea.
(function () {
  'use strict';

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
  // purple highlight to swap the word for the suggestion shown here.
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
  // against (the caller adds the chunk's own offset back in).
  function findWordHighlights(sentenceText) {
    const found = [];

    function addAll(re, kind, labelFn, suggestionFn) {
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

    // Priority order: passive voice, then adverbs, then filler phrases/words,
    // then complex words. Earlier matches "win" any overlap (see below).
    addAll(PASSIVE_RE, 'blue', () => 'Passive voice -- consider naming who did this and using an active verb.');
    addAll(ADVERB_RE, 'blue', (m) => (LY_EXCLUDE.has(m[0].toLowerCase()) ? null : 'Adverb -- a stronger verb might say this more directly.'));
    addAll(WEAK_PHRASE_RE, 'blue', () => 'This phrase can usually be cut or shortened.');
    addAll(WEAK_WORD_RE, 'blue', () => 'Filler word -- try cutting it and see if the sentence still works.');
    addAll(COMPLEX_WORD_RE, 'purple', (m) => `Simpler alternative: "${COMPLEX_WORDS[m[0].toLowerCase()]}"`, (m) => COMPLEX_WORDS[m[0].toLowerCase()]);

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
    return result;
  }

  // ---------------------------------------------------------------------
  // full-text analysis
  // ---------------------------------------------------------------------

  // Returns { html, ranges, stats } where `html` is what should go inside
  // the overlay, `ranges` is a flat list of {start, end, kind, label,
  // suggestion} in whole-text offsets (for click handling), and `stats` is
  // counts used by the summary bar.
  function analyze(text) {
    const chunks = splitSentences(text);
    const ranges = [];
    const stats = { yellow: 0, red: 0, blue: 0, purple: 0, maxGrade: 0 };
    let html = '';

    for (const chunk of chunks) {
      const score = scoreSentence(chunk);
      if (score.severity === 'yellow') stats.yellow += 1;
      if (score.severity === 'red') stats.red += 1;
      if (score.grade > stats.maxGrade) stats.maxGrade = score.grade;

      const wordHighlights = findWordHighlights(chunk.text);
      for (const w of wordHighlights) {
        if (w.kind === 'blue') stats.blue += 1;
        if (w.kind === 'purple') stats.purple += 1;
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
      // (guaranteed by findWordHighlights), so this is a simple walk.
      let inner = '';
      let cursor = 0;
      for (const w of wordHighlights) {
        if (w.start > cursor) inner += escapeHtml(chunk.text.slice(cursor, w.start));
        inner += `<mark class="wa-word wa-${w.kind}">${escapeHtml(chunk.text.slice(w.start, w.end))}</mark>`;
        cursor = w.end;
      }
      if (cursor < chunk.text.length) inner += escapeHtml(chunk.text.slice(cursor));

      if (score.severity) {
        html += `<mark class="wa-sentence wa-${score.severity}">${inner}</mark>`;
      } else {
        html += inner;
      }
    }

    ranges.sort((a, b) => a.start - b.start);
    return { html, ranges, stats };
  }

  // ---------------------------------------------------------------------
  // DOM wiring -- one instance per chapter-text textarea on the page
  // ---------------------------------------------------------------------

  function setup(textarea) {
    const wrap = document.createElement('div');
    wrap.className = 'wa-wrap';
    textarea.parentNode.insertBefore(wrap, textarea);

    const bar = document.createElement('div');
    bar.className = 'wa-bar';
    wrap.appendChild(bar);

    const summary = document.createElement('span');
    summary.className = 'wa-summary';
    bar.appendChild(summary);

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'wa-toggle';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    let enabled = true;
    try { enabled = localStorage.getItem('wa-enabled') !== '0'; } catch (e) { /* ignore */ }
    toggle.checked = enabled;
    toggleLabel.appendChild(toggle);
    toggleLabel.appendChild(document.createTextNode(' Highlights'));
    bar.appendChild(toggleLabel);

    const editorWrap = document.createElement('div');
    editorWrap.className = 'wa-editor-wrap';
    wrap.appendChild(editorWrap);

    const overlay = document.createElement('div');
    overlay.className = 'wa-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    editorWrap.appendChild(overlay);
    editorWrap.appendChild(textarea);
    textarea.classList.add('wa-textarea');

    const popover = document.createElement('div');
    popover.className = 'wa-popover hidden';
    document.body.appendChild(popover);

    let currentRanges = [];
    let timer = null;

    // Builds one "● N label" chip for the summary bar; returns '' when the
    // count is zero so empty categories don't clutter the bar.
    function statChip(colorClass, count, singular, plural) {
      if (!count) return '';
      return `<span class="wa-chip"><span class="wa-dot wa-${colorClass}"></span>${count} ${count === 1 ? singular : plural}</span>`;
    }

    function render() {
      const { html, ranges, stats } = analyze(textarea.value);
      overlay.innerHTML = html + (textarea.value.endsWith('\n') ? '&nbsp;' : '');
      currentRanges = ranges;
      const total = stats.yellow + stats.red + stats.blue + stats.purple;
      summary.innerHTML = total === 0
        ? 'No style issues spotted.'
        : [
            statChip('red', stats.red, 'very dense sentence', 'very dense sentences'),
            statChip('yellow', stats.yellow, 'long sentence', 'long sentences'),
            statChip('blue', stats.blue, 'weak phrase', 'weak phrases'),
            statChip('purple', stats.purple, 'complex word', 'complex words'),
          ].filter(Boolean).join('');
      syncScroll();
    }

    function syncScroll() {
      overlay.scrollTop = textarea.scrollTop;
      overlay.scrollLeft = textarea.scrollLeft;
    }

    function scheduleRender() {
      if (!enabled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(render, 250);
    }

    function setEnabled(next) {
      enabled = next;
      try { localStorage.setItem('wa-enabled', enabled ? '1' : '0'); } catch (e) { /* ignore */ }
      wrap.classList.toggle('wa-disabled', !enabled);
      if (enabled) render();
      else { overlay.innerHTML = ''; hidePopover(); }
    }

    toggle.addEventListener('change', () => setEnabled(toggle.checked));

    textarea.addEventListener('input', scheduleRender);
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
      if (!enabled) return;
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

    if (enabled) render();
    else wrap.classList.add('wa-disabled');
  }

  function init() {
    document.querySelectorAll('form.chapter-form textarea[name="content"]').forEach((textarea) => {
      try {
        setup(textarea);
      } catch (err) {
        // Never let this optional enhancement break the actual chapter
        // form -- the plain textarea keeps working either way.
        // eslint-disable-next-line no-console
        console.error('writing-analyzer failed to initialize:', err);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
