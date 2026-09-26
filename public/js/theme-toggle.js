// public/js/theme-toggle.js -- wires up the theme button in the top bar
// (present on every page, see lib/layout.js). Three lights, in the order
// the day goes: light, dusk, dark, and round again. The saved choice, if
// any, was already applied before paint by theme-init.js; with none, the
// page follows the system's light or dark, and the first press moves on
// from whichever that is.
(function () {
  'use strict';
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  const ORDER = ['light', 'dusk', 'dark'];
  const MARK = { light: '☀', dusk: '◑', dark: '☾' };
  const NAME = { light: 'Light', dusk: 'Dusk', dark: 'Dark' };

  function current() {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (ORDER.includes(explicit || '')) return /** @type {string} */ (explicit);
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  const nextOf = (theme) => ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];

  // The button shows the light you are in, and says what a press does.
  function updateButton() {
    const now = current();
    const next = nextOf(now);
    btn.textContent = MARK[now];
    btn.setAttribute('aria-label', `Theme: ${NAME[now]}. Switch to ${NAME[next].toLowerCase()}`);
    btn.title = `${NAME[now]} -- press for ${NAME[next].toLowerCase()}`;
  }

  btn.addEventListener('click', function () {
    const next = nextOf(current());
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { /* ignore */ }
    updateButton();
  });

  // If nothing's been explicitly chosen yet, keep the button right if the
  // system's preference changes while the page is open.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (!document.documentElement.getAttribute('data-theme')) updateButton();
    });
  }

  updateButton();
})();
