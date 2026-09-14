// public/js/theme-toggle.js -- wires up the light/dark toggle button in
// the top bar (present on every page, see lib/layout.js). The saved
// choice, if any, was already applied before paint by theme-init.js;
// this only needs to handle clicks and keep the button's own icon/label
// in sync with whichever theme is actually showing right now (which,
// with no saved choice yet, follows the OS's prefers-color-scheme).
(function () {
  'use strict';
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  function isDarkNow() {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'dark') return true;
    if (explicit === 'light') return false;
    return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  // Shows the icon for the mode a click would switch TO, not the current
  // one -- the usual convention for this kind of toggle.
  function updateButton() {
    const dark = isDarkNow();
    btn.textContent = dark ? '☀' : '☾';
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = btn.getAttribute('aria-label');
  }

  btn.addEventListener('click', function () {
    const next = isDarkNow() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { /* ignore */ }
    updateButton();
  });

  // If nothing's been explicitly chosen yet, keep the icon correct if the
  // OS-level preference changes while the page is open.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (!document.documentElement.getAttribute('data-theme')) updateButton();
    });
  }

  updateButton();
})();
