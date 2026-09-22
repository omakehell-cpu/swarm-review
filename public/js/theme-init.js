// public/js/theme-init.js -- runs synchronously in <head>, before the
// stylesheet paints, so a saved manual theme choice (see theme-toggle.js)
// applies immediately with no flash of the wrong theme. Deliberately its
// own tiny file rather than an inline <script>: the app's Content-
// Security-Policy only allows same-origin scripts (script-src 'self'),
// not inline ones. Split out from theme-toggle.js, which wires up the
// toggle button, because that one needs the button to already exist in
// the DOM -- this one must run before anything is even parsed yet.
(function () {
  'use strict';
  // Tells the stylesheet that scripts run, so anything folded away for a
  // script to open (the phone menu) is only folded when one will.
  document.documentElement.classList.add('js');
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) { /* ignore -- falls back to prefers-color-scheme */ }
})();
