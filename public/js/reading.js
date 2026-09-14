// public/js/reading.js -- how the chapter is read, as opposed to what it
// says. Two things, both remembered in this browser and nowhere else:
//
//   1. the mode: reading it, or reviewing it
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
  let mode = store.get(MODE_KEY, '') || (hasComments ? 'review' : 'read');

  function applyMode() {
    main.dataset.reading = mode;
    for (const el of bar.querySelectorAll('[data-mode]')) {
      const btn = /** @type {HTMLElement} */ (el);
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
    }
  }
  bar.addEventListener('click', (ev) => {
    const btn = /** @type {HTMLElement|null} */ (/** @type {Element} */ (ev.target).closest('[data-mode]'));
    if (!btn) return;
    mode = btn.dataset.mode;
    store.set(MODE_KEY, mode);
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
  });

  applyMode();
  PREFS.forEach(applyPref);
})();
