// public/js/editor-tools.js -- the chapter editor's toolbar and the ways
// of writing it offers.
//
//  * Buttons and the keyboard shortcuts every other editor has: bold,
//    italic, a quoted line, a heading, a scene break.
//  * One place to write: the Markdown, in the textarea, with the writing
//    checks drawn behind it. *Preview* swaps it for the chapter as it will
//    read -- italics in italics, scene breaks as breaks -- until pressed
//    again (or Escape). Nothing is written in the preview; the textarea is
//    the one thing the form sends and the one thing the drafts, the checks
//    and the notes are counted against.
//  * Focus: everything but the writing gone until Escape, with nothing
//    moving -- the rest of the page fades out where it stands.
//  * Typewriter: the line being written stays at the same height on the
//    screen.
//  * How much has been written since the page was opened, and against the
//    day's goal.
//
// Everything the buttons do in the textarea goes through the browser's own
// insert command where it exists, so Ctrl+Z undoes a button like typing.
(function () {
  'use strict';

  // The same key on both: on a Mac it is labelled Option.
  const FKEY = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Option+F' : 'Alt+F';

  const textarea = /** @type {HTMLTextAreaElement|null} */ (document.querySelector('textarea[data-editor-tools]'));
  if (!textarea) return;
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private window */ } },
  };
  const deskEl = document.getElementById('desk-data');
  const desk = deskEl ? JSON.parse(deskEl.textContent || '{}') : null;

  // One polite voice for the whole editor: what a button just did, where
  // the caret is, how many checks there are. Cleared first so the same
  // sentence twice is still said twice.
  const voice = document.createElement('div');
  voice.className = 'sr-only';
  voice.setAttribute('aria-live', 'polite');
  voice.setAttribute('role', 'status');
  document.body.appendChild(voice);
  function announce(message) {
    voice.textContent = '';
    window.setTimeout(() => { voice.textContent = message; }, 40);
  }

  // ---------------------------------------------------------------- textarea

  function insert(text, selectFrom, selectTo) {
    textarea.focus();
    const start = textarea.selectionStart;
    let done;
    try { done = document.execCommand('insertText', false, text); } catch (e) { done = false; }
    if (!done) {
      textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (selectFrom !== undefined) textarea.setSelectionRange(start + selectFrom, start + (selectTo ?? selectFrom));
  }

  function wrap(mark) {
    const { selectionStart: s, selectionEnd: e, value } = textarea;
    const selected = value.slice(s, e);
    if (selected.startsWith(mark) && selected.endsWith(mark) && selected.length >= mark.length * 2) {
      insert(selected.slice(mark.length, selected.length - mark.length), 0, selected.length - mark.length * 2);
      return;
    }
    if (value.slice(s - mark.length, s) === mark && value.slice(e, e + mark.length) === mark) {
      textarea.setSelectionRange(s - mark.length, e + mark.length);
      insert(selected, 0, selected.length);
      return;
    }
    insert(`${mark}${selected}${mark}`, mark.length, mark.length + selected.length);
  }

  function prefixLines(prefix) {
    const { value } = textarea;
    const lineStart = value.lastIndexOf('\n', textarea.selectionStart - 1) + 1;
    let lineEnd = value.indexOf('\n', textarea.selectionEnd);
    if (lineEnd === -1) lineEnd = value.length;
    const lines = value.slice(lineStart, lineEnd).split('\n');
    const all = lines.every((l) => l.startsWith(prefix));
    const next = lines.map((l) => (all ? l.slice(prefix.length) : prefix + l)).join('\n');
    textarea.setSelectionRange(lineStart, lineEnd);
    insert(next, 0, next.length);
  }

  function sceneBreakText() {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const lead = before === '' || before.endsWith('\n\n') ? '' : (before.endsWith('\n') ? '\n' : '\n\n');
    const text = `${lead}---\n\n`;
    insert(text, text.length);
  }

  // ---------------------------------------------------------------- preview

  const preview = document.createElement('div');
  preview.className = 'editor-preview';
  preview.id = 'editor-preview';
  preview.tabIndex = -1;
  preview.setAttribute('role', 'document');
  preview.setAttribute('aria-label', 'Preview of the chapter');
  preview.hidden = true;
  let mode = 'markdown';

  const markdownView = () => /** @type {HTMLElement} */ (textarea.closest('.wa-editor-wrap') || textarea);

  async function renderPreview() {
    const res = await fetch('/markdown/preview', {
      method: 'POST', credentials: 'same-origin',
      body: new URLSearchParams({ text: textarea.value, plain: '1' }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const { html } = await res.json();
    preview.innerHTML = html || '<p class="muted">Nothing written yet.</p>';
    // A preview is for reading: its links go nowhere.
    for (const a of Array.from(preview.querySelectorAll('a'))) a.removeAttribute('href');
  }

  // A window resized while the preview shows: back to the column's width.
  window.addEventListener('resize', () => { if (mode === 'preview') preview.style.width = ''; });

  async function setMode(next, { quiet = false } = {}) {
    if (next === mode) return;
    if (next === 'preview') {
      try {
        await renderPreview();
      } catch (e) {
        if (!quiet) announce('The preview could not be made just now.');
        return;
      }
      // The same box, the same size, in the same place: the preview takes
      // exactly the room the text had, scrolls inside itself as the text
      // does, and opens as far down as the text was scrolled.
      const view = markdownView();
      const size = view.getBoundingClientRect();
      const room = textarea.scrollHeight - textarea.clientHeight;
      const share = room > 0 ? textarea.scrollTop / room : 0;
      preview.style.width = `${Math.round(size.width)}px`;
      preview.style.height = `${Math.round(size.height)}px`;
      view.hidden = true;
      preview.hidden = false;
      mode = 'preview';
      preview.scrollTop = share * Math.max(0, preview.scrollHeight - preview.clientHeight);
      preview.focus({ preventScroll: true });
    } else {
      preview.hidden = true;
      markdownView().hidden = false;
      mode = 'markdown';
      // The checks draw their marks on their own layer; tell them it may have moved.
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.focus({ preventScroll: true });
      centreCaret(true);
    }
    previewBtn.setAttribute('aria-pressed', String(mode === 'preview'));
    document.body.classList.toggle('editor-previewing', mode === 'preview');
    for (const b of Array.from(bar.querySelectorAll('[data-format], .tool-break'))) {
      /** @type {HTMLButtonElement} */ (b).disabled = mode === 'preview';
    }
    if (!quiet) announce(mode === 'preview'
      ? 'Preview: the chapter as it will read. Press Preview again, or Escape, to write.'
      : 'Writing.');
  }
  preview.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); setMode('markdown'); }
  });
  // Double-click the preview to go back to writing.
  preview.addEventListener('dblclick', () => setMode('markdown'));

  // ------------------------------------------------------ what is here
  //
  // Formatting a screen reader does not say: which scene you are in, and
  // whether the line is a quote or a heading. Alt+F -- or the "Formatting
  // here" button -- says it in one sentence. The marks themselves are
  // characters in the text and are read like any other.
  function whereAmI() {
    const parts = [];
    const before = textarea.value.slice(0, textarea.selectionStart);
    const BREAK = /^ {0,3}([-*_])(?: *\1){2,} *$/;
    const all = textarea.value.split('\n');
    const scenes = all.filter((l) => BREAK.test(l)).length + 1;
    const sceneIndex = before.split('\n').filter((l) => BREAK.test(l)).length + 1;
    const line = all[before.split('\n').length - 1] || '';
    parts.push(/^\s*>/.test(line) ? 'on a quoted line' : /^\s*#/.test(line) ? 'on a heading' : /^\s*([-*+]|\d+\.)\s/.test(line) ? 'on a list item' : 'on a line of prose');
    parts.push(`scene ${sceneIndex} of ${scenes}`);
    const text = parts.join(', ');
    announce(text.charAt(0).toUpperCase() + text.slice(1) + '.');
  }
  document.addEventListener('keydown', (ev) => {
    if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.code === 'KeyF' && document.activeElement === textarea) {
      ev.preventDefault();
      whereAmI();
    }
  });

  // ---------------------------------------------------------------- actions
  // ---------------------------------------------------------------- actions

  const ACTIONS = [
    { id: 'bold', label: 'B', title: 'Bold (Ctrl+B)', md: () => wrap('**') },
    { id: 'italic', label: 'I', title: 'Italic (Ctrl+I)', md: () => wrap('*') },
    { id: 'quote', label: '\u201c', title: 'Quote (Ctrl+Shift+.)', md: () => prefixLines('> ') },
    { id: 'heading', label: 'H', title: 'Heading', md: () => prefixLines('## ') },
    { id: 'break', label: '* * *', title: 'Scene break (Ctrl+Enter)', md: sceneBreakText },
  ];
  const SAID = { bold: 'Bold', italic: 'Italic', quote: 'Quote', heading: 'Heading' };
  function run(action) {
    if (mode !== 'markdown') return;
    action.md();
    announce(action.id === 'break' ? 'Scene break inserted.' : `${SAID[action.id]} marks added around the selection.`);
  }

  const bar = document.createElement('div');
  bar.className = 'editor-tools';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Formatting');
  const button = (cls, label, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `editor-tool ${cls}`;
    b.textContent = label;
    b.title = title;
    b.addEventListener('mousedown', (ev) => ev.preventDefault());
    return b;
  };
  for (const action of ACTIONS) {
    const b = button(`tool-${action.id}`, action.label, action.title);
    b.setAttribute('aria-label', action.title);
    if (action.id !== 'break') b.dataset.format = action.id;
    b.addEventListener('click', () => run(action));
    bar.appendChild(b);
  }

  // Writing | Preview: one button, pressed while the preview is showing.
  const previewBtn = button('tool-preview', 'Preview', 'See the chapter as it will read (press again, or Escape, to write)');
  previewBtn.setAttribute('aria-pressed', 'false');
  previewBtn.setAttribute('aria-controls', preview.id);
  previewBtn.addEventListener('click', () => setMode(mode === 'preview' ? 'markdown' : 'preview'));
  bar.appendChild(previewBtn);

  // On a phone the row is the formatting and the preview, and the rest
  // waits behind one button, so the text starts on the first screen
  // rather than under three rows of controls. On a wide screen the button
  // is not shown and everything sits in one row as before.
  const moreBtn = button('tool-more', '\u2026', 'More tools: Checks as a list, Scenes & snapshots, Typewriter, Focus');
  moreBtn.setAttribute('aria-label', 'More tools');
  moreBtn.setAttribute('aria-expanded', 'false');
  moreBtn.addEventListener('click', () => {
    const open = bar.classList.toggle('show-more');
    moreBtn.setAttribute('aria-expanded', String(open));
  });
  bar.appendChild(moreBtn);

  const whereBtn = button('tool-where', 'Formatting here', `Say the formatting and the scene where the caret is (${FKEY})`);
  whereBtn.addEventListener('click', whereAmI);
  whereBtn.classList.add('tool-secondary');
  bar.appendChild(whereBtn);

  const checksBtn = button('tool-checks', 'Checks as a list', 'The writing checks as a list you can walk, each one a jump to its words');
  checksBtn.setAttribute('aria-expanded', 'false');
  checksBtn.classList.add('tool-secondary');
  bar.appendChild(checksBtn);

  const spacer = document.createElement('span');
  spacer.className = 'editor-tools-spacer';
  bar.appendChild(spacer);

  const session = document.createElement('span');
  session.className = 'session-count tool-secondary';
  session.setAttribute('aria-live', 'off');
  bar.appendChild(session);

  const typewriterBtn = button('tool-typewriter', 'Typewriter', 'Keep the line you are writing at the same height on the screen');
  typewriterBtn.setAttribute('aria-pressed', 'false');
  typewriterBtn.classList.add('tool-secondary');
  bar.appendChild(typewriterBtn);
  const focusBtn = button('tool-focus', 'Focus', 'Hide everything but the writing (Esc to come back)');
  focusBtn.setAttribute('aria-pressed', 'false');
  focusBtn.classList.add('tool-secondary');
  bar.appendChild(focusBtn);

  // The bar goes directly above the text, after the writing checks have
  // built their frame round the textarea.
  const place = () => {
    const anchor = markdownView();
    anchor.parentNode.insertBefore(bar, anchor);
    anchor.parentNode.insertBefore(checksPanel, anchor);
    anchor.parentNode.insertBefore(preview, anchor);
  };
  // (Called at the end of this file, once everything it places exists.)

  // ------------------------------------------------------ checks as a list
  //
  // The writing checks mark passages by colour and underline, which is
  // nothing to somebody listening. Here the same marks -- read straight off
  // the layer the checks draw -- become a list: how many of each first,
  // then every one in the order it comes, and each a button that selects
  // its words in the text.
  const CHECK_NAMES = {
    spell: 'Spelling', passive: 'Passive voice', adverb: 'Adverb', filler: 'Filler word',
    complex: 'Complex word', echo: 'Repeated word', filter: 'Filter verb', dialogue: 'Dialogue tag',
    opening: 'Repeated opening', yellow: 'Long sentence', red: 'Very long sentence',
  };
  const PLURAL = { Spelling: 'possible misspellings', 'Passive voice': 'passive voice phrases', 'Repeated opening': 'repeated openings', 'Very long sentence': 'very long sentences' };
  const checksPanel = document.createElement('section');
  checksPanel.className = 'checks-list';
  checksPanel.hidden = true;
  checksPanel.setAttribute('aria-label', 'Writing checks, as a list');
  checksPanel.id = 'checks-list';
  checksBtn.setAttribute('aria-controls', checksPanel.id);

  function readChecks() {
    const overlay = document.querySelector('.wa-overlay');
    if (!overlay) return [];
    return Array.from(overlay.querySelectorAll('mark[data-wa-start]')).map((m) => {
      const el = /** @type {HTMLElement} */ (m);
      const kind = Array.from(el.classList).map((c) => c.replace(/^wa-/, '')).find((c) => CHECK_NAMES[c]) || '';
      const start = Number(el.dataset.waStart);
      const end = Number(el.dataset.waEnd);
      return { kind, name: CHECK_NAMES[kind] || 'Check', start, end, words: textarea.value.slice(start, end), why: el.dataset.waLabel || '' };
    }).filter((c) => Number.isFinite(c.start) && c.end > c.start).sort((a, b) => a.start - b.start);
  }
  function renderChecks() {
    const checks = readChecks();
    const counts = new Map();
    for (const c of checks) counts.set(c.name, (counts.get(c.name) || 0) + 1);
    const summary = checks.length
      ? `${checks.length} check${checks.length === 1 ? '' : 's'}: ${[...counts].map(([n, k]) => `${k} ${(k === 1 ? n : (PLURAL[n] || `${n}s`)).toLowerCase()}`).join(', ')}.`
      : 'No checks to show. Either nothing was flagged, or the checks are switched off.';
    const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const snippet = (t) => { const one = t.replace(/\s+/g, ' ').trim(); return one.length > 70 ? `${one.slice(0, 69)}\u2026` : one; };
    checksPanel.innerHTML = `
      <p class="checks-summary">${esc(summary)}</p>
      ${checks.length ? `<ol class="checks-items">${checks.map((c, i) => `
        <li><button type="button" class="checks-item" data-i="${i}">
          <span class="checks-kind">${esc(c.name)}</span>
          <span class="checks-words">\u201c${esc(snippet(c.words))}\u201d</span>
          ${c.why && c.why !== c.name ? `<span class="checks-why">${esc(c.why)}</span>` : ''}
        </button></li>`).join('')}</ol>` : ''}`;
    checksPanel.dataset.count = String(checks.length);
    return { checks, summary };
  }
  let checksCache = [];
  function openChecks(show) {
    checksPanel.hidden = !show;
    checksBtn.setAttribute('aria-expanded', String(show));
    if (show) {
      const { checks, summary } = renderChecks();
      checksCache = checks;
      announce(summary);
    }
  }
  checksBtn.addEventListener('click', async () => {
    if (checksPanel.hidden && mode === 'preview') await setMode('markdown');
    openChecks(checksPanel.hidden);
  });
  checksPanel.addEventListener('click', (ev) => {
    const item = /** @type {HTMLElement|null} */ (/** @type {Element} */ (ev.target).closest('.checks-item'));
    if (!item) return;
    const c = checksCache[Number(item.dataset.i)];
    if (!c) return;
    textarea.focus();
    textarea.setSelectionRange(c.start, c.end);
    centreCaret(true);
    announce(`${c.name}: ${c.words}. Selected in the text.`);
  });
  let checksTimer = null;
  textarea.addEventListener('input', () => {
    if (checksPanel.hidden) return;
    clearTimeout(checksTimer);
    checksTimer = setTimeout(() => {
      if (checksPanel.contains(document.activeElement)) return;
      checksCache = renderChecks().checks;
    }, 900);
  });

  // ----------------------------------------------------------------- keys

  textarea.addEventListener('keydown', (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (!mod || ev.altKey) return;
    const k = ev.key.toLowerCase();
    if (!ev.shiftKey && (k === 'b' || k === 'i')) { ev.preventDefault(); wrap(k === 'b' ? '**' : '*'); }
    else if (ev.shiftKey && (k === '.' || k === '>')) { ev.preventDefault(); prefixLines('> '); }
    else if (!ev.shiftKey && k === 'enter') { ev.preventDefault(); sceneBreakText(); }
  });
  // ------------------------------------------------------------ focus mode

  // The button keeps its name and its place: pressed is the only change,
  // so it is still under the pointer to press again.
  function setFocus(on) {
    document.body.classList.toggle('writing-focus', on);
    focusBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    store.set('editor-focus', on ? '1' : '0');
  }
  focusBtn.addEventListener('click', () => {
    setFocus(!document.body.classList.contains('writing-focus'));
    if (mode === 'markdown') textarea.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && document.body.classList.contains('writing-focus')
      && !document.querySelector('.desk-drawer:not([hidden])')) setFocus(false);
  });

  // ------------------------------------------------------------- typewriter

  let typewriter = false;
  function setTypewriter(on) {
    typewriter = on;
    typewriterBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    document.body.classList.toggle('typewriter', on);
    store.set('editor-typewriter', on ? '1' : '0');
    if (on) centreCaret();
  }
  typewriterBtn.addEventListener('click', () => {
    setTypewriter(!typewriter);
    if (mode === 'markdown') textarea.focus();
  });

  // Where the caret is inside the textarea, in pixels from its top: a
  // hidden copy of the textarea's text up to the caret, with the same
  // font and width, and a marker at the end of it.
  function caretTopInTextarea() {
    const style = getComputedStyle(textarea);
    const mirror = document.createElement('div');
    for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth', 'boxSizing', 'wordSpacing', 'tabSize']) {
      mirror.style[prop] = style[prop];
    }
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = 'break-word';
    mirror.style.width = `${textarea.clientWidth}px`;
    mirror.textContent = textarea.value.slice(0, textarea.selectionStart);
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const top = marker.offsetTop;
    mirror.remove();
    return top;
  }

  function centreCaret(force = false) {
    if (!typewriter && !force) return;
    const target = window.innerHeight * 0.42;
    if (mode !== 'markdown') return;
    const caretTop = caretTopInTextarea();
    if (textarea.scrollHeight > textarea.clientHeight + 4) {
      textarea.scrollTop = Math.max(0, caretTop - textarea.clientHeight * 0.42);
      const box = textarea.getBoundingClientRect();
      if (box.top > target || box.bottom < target) window.scrollBy({ top: box.top - 80 });
    } else {
      const box = textarea.getBoundingClientRect();
      window.scrollBy({ top: box.top + caretTop - target });
    }
  }

  // ---------------------------------------------------------- session count

  const countWords = (text) => {
    const words = String(text || '').replace(/\]\([^)]*\)/g, ']').replace(/[*_~`#>]/g, ' ')
      .match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu);
    return words ? words.length : 0;
  };
  const startWords = countWords(textarea.value);
  const startedAt = Date.now();
  function updateSession() {
    const delta = countWords(textarea.value) - startWords;
    const minutes = Math.round((Date.now() - startedAt) / 60000);
    const parts = [`${delta >= 0 ? '+' : '\u2212'}${Math.abs(delta)} word${Math.abs(delta) === 1 ? '' : 's'} this session`];
    if (minutes >= 1) parts.push(`${minutes} min`);
    if (desk && desk.goal > 0) {
      const today = Math.max(0, (desk.today || 0) + Math.max(0, delta));
      parts.push(`today ${today} / ${desk.goal}`);
      session.classList.toggle('goal-met', today >= desk.goal);
    }
    session.textContent = parts.join(' \u00b7 ');
  }
  setInterval(updateSession, 30000);

  let afterTimer = null;
  function afterEdit() {
    clearTimeout(afterTimer);
    afterTimer = setTimeout(() => { updateSession(); centreCaret(); }, 30);
  }
  textarea.addEventListener('input', afterEdit);
  textarea.addEventListener('keyup', (ev) => { if (/^(Arrow|Page|Home|End|Enter)/.test(ev.key)) centreCaret(); });
  textarea.addEventListener('click', () => centreCaret());
  updateSession();

  // ------------------------------------------------------------ remembered

  if (store.get('editor-focus') === '1') setFocus(true);
  if (store.get('editor-typewriter') === '1') setTypewriter(true);
  // The old Visual editor's choice, remembered in browsers that used it.
  store.set('editor-mode', '');

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place);
  else place();

  // For the desk (public/js/writing-desk.js) and the notes beside the editor
  // (public/js/editor-notes.js): the text, a way to put text in, to go to a
  // place in it, and to select or replace a passage by its place in the
  // Markdown. A preview showing is put away first.
  /** @type {any} */ (window).swarmEditor = {
    bar,
    getText() { return textarea.value; },
    async setText(text) {
      textarea.value = text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      if (mode === 'preview') await renderPreview();
    },
    async goToScene(index, offset) {
      if (mode === 'preview') await setMode('markdown', { quiet: true });
      textarea.focus();
      textarea.setSelectionRange(offset, offset);
      centreCaret(true);
    },
    async selectText(start, end) {
      if (mode === 'preview') await setMode('markdown', { quiet: true });
      textarea.focus();
      textarea.setSelectionRange(start, end);
      centreCaret(true);
    },
    async replaceText(start, end, text) {
      if (mode === 'preview') await setMode('markdown', { quiet: true });
      textarea.focus();
      textarea.setRangeText(text, start, end, 'select');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      centreCaret(true);
    },
  };
  document.dispatchEvent(new CustomEvent('swarm-editor-ready'));
}());
