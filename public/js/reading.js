// public/js/reading.js -- how the chapter is read, as opposed to what it
// says. Two things, both remembered in this browser and nowhere else:
//
//   1. the mode: reading it, reviewing it, or (its author) revising it
//   2. the three numbers that decide what reading it is like -- the size
//      of the type, the length of the line, the space between lines
//
// The defaults are exactly what the stylesheet had hard-coded before this
// existed, so somebody who never opens the control sees no change at all.
(function () {
  'use strict';

  const bar = /** @type {HTMLElement|null} */ (document.getElementById('reading-controls'));
  if (!bar) return;
  const main = /** @type {HTMLElement|null} */ (document.querySelector('main.container'));
  const text = /** @type {HTMLElement|null} */ (document.getElementById('chapter-text'));
  if (!main || !text) return;

  const store = {
    get(key, fallback) {
      try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch (e) { /* a private window; the page still works */ }
    },
  };

  // ---- mode ----------------------------------------------------------
  // A chapter with nothing to review is opened to be read; one with
  // comments on it is opened to deal with them. That is only the first
  // guess, and only until somebody says otherwise once.
  const MODE_KEY = 'reading-mode';
  const hasComments = bar.dataset.hasComments === '1';
  // Somebody who has asked, on their account page, for chapters to open
  // ready to read gets that every time, whatever this browser remembers.
  const readFirst = bar.dataset.readFirst === '1';
  // Two ways to have the page, one switch: Read, the story alone, and the
  // other one -- Review (the story and the notes) for a reader, Revise (the
  // notes and the writing checks as well) for its author. A choice stored
  // as the one means the other on a page that offers the other.
  const offered = Array.from(bar.querySelectorAll('[data-mode]')).map((b) => /** @type {HTMLElement} */ (b).dataset.mode);
  const working = offered.indexOf('revise') >= 0 ? 'revise' : 'review';
  let mode = readFirst ? 'read' : (store.get(MODE_KEY, '') || (hasComments ? working : 'read'));
  if (mode !== 'read') mode = working;

  function applyMode() {
    main.dataset.reading = mode;
    placeFloat();
    // In Review, a passage with notes on it is announced as highlighted;
    // in Read, nothing is put between the listener and the story.
    for (const el of Array.from(text.querySelectorAll('.hl'))) {
      if (mode !== 'read') el.setAttribute('role', 'mark');
      else el.removeAttribute('role');
    }
    for (const el of bar.querySelectorAll('[data-mode]')) {
      const btn = /** @type {HTMLElement} */ (el);
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
    }
    document.dispatchEvent(new CustomEvent('reading-mode', { detail: mode }));
  }
  bar.addEventListener('click', (ev) => {
    const btn = /** @type {HTMLElement|null} */ (/** @type {Element} */ (ev.target).closest('[data-mode]'));
    if (!btn) return;
    mode = btn.dataset.mode;
    // Remembered as "notes on" or "off", so an author's Revise is a
    // reader's Review on somebody else's chapter.
    store.set(MODE_KEY, mode === 'read' ? 'read' : 'review');
    applyMode();
  });

  // ---- type ----------------------------------------------------------
  // Each option carries the value it sets, so the scale lives in the HTML
  // next to its label rather than being duplicated here.
  const PREFS = [
    { key: 'reading-size', prop: '--read-size', fallback: '' },
    { key: 'reading-measure', prop: '--read-measure', fallback: '' },
    { key: 'reading-leading', prop: '--read-leading', fallback: '' },
  ];

  function applyPref(pref) {
    const value = store.get(pref.key, pref.fallback);
    // An empty value means "whatever the stylesheet says", which is what
    // removing the property gives -- not a hard-coded copy of the default
    // that would then drift away from it.
    if (value) text.style.setProperty(pref.prop, value);
    else text.style.removeProperty(pref.prop);
    for (const el of bar.querySelectorAll(`[data-pref="${pref.key}"]`)) {
      const btn = /** @type {HTMLElement} */ (el);
      btn.setAttribute('aria-pressed', String(btn.dataset.value === value));
    }
  }

  bar.addEventListener('click', (ev) => {
    const btn = /** @type {HTMLElement|null} */ (/** @type {Element} */ (ev.target).closest('[data-pref]'));
    if (!btn) return;
    const pref = PREFS.find((p) => p.key === btn.dataset.pref);
    if (!pref) return;
    store.set(pref.key, btn.dataset.value);
    applyPref(pref);
    placeFloat();
  });

  // ---- the floating arrows -------------------------------------------
  // They hang either side of the text column, which moves whenever the
  // type size or the line length changes, so their offsets are measured
  // rather than guessed. CSS does the rest (see .chapter-float-arrow).
  const float = /** @type {HTMLElement|null} */ (document.querySelector('.chapter-float'));

  function placeFloat() {
    if (!float) return;
    // Left from the pane, which starts at the rule the chapter hangs
    // from; right from the text, since the pane itself runs on to the
    // end of the column and the measure is what you can see.
    const pane = text.closest('.reading-pane') || text;
    float.style.setProperty('--float-left', `${Math.round(pane.getBoundingClientRect().left)}px`);
    float.style.setProperty('--float-right', `${Math.round(window.innerWidth - text.getBoundingClientRect().right)}px`);
  }

  window.addEventListener('resize', placeFloat);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeFloat);

  applyMode();
  PREFS.forEach(applyPref);
  placeFloat();
})();

// ---- turning the page with the keyboard -------------------------------
// Left and right move between chapters, the way they do in anything else
// you read a chapter at a time in. Only when the arrow is not already
// doing something, though: not while the caret is in a field, not with a
// modifier held (those belong to the browser -- back, forward, word
// jumps), and not while anything is selected, since extending a
// selection is the other thing arrows are for.
//
// The destinations are read off the foot navigation rather than passed
// in: it is on the page already, it is rendered from the same data, and
// a chapter with nowhere to go doesn't render it at all.
(function () {
  'use strict';

  const foot = document.querySelector('.chapter-nav.foot');
  if (!foot) return;

  function destination(rel) {
    const a = foot.querySelector(`a[rel="${rel}"]`);
    return a instanceof HTMLAnchorElement ? a.href : null;
  }

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && el.isContentEditable) return;
    if (el && /^(?:INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const href = destination(ev.key === 'ArrowLeft' ? 'prev' : 'next');
    if (!href) return;
    ev.preventDefault();
    window.location.href = href;
  });
})();
