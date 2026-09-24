// public/js/story-filter.js -- the search box on the front page.
// The box is a real search (it asks the server, across every story and
// shelf) and works with nothing switched on. With a script, typing also
// narrows the rows already on the screen straight away; Enter searches
// the rest. And the series picker goes as soon as a series is picked.
(function () {
  'use strict';
  for (const b of Array.from(document.querySelectorAll('.series-pick [data-no-js]'))) /** @type {HTMLElement} */ (b).hidden = true;
  const series = /** @type {HTMLSelectElement|null} */ (document.querySelector('[data-autosubmit-series]'));
  if (series && series.form) series.addEventListener('change', () => /** @type {HTMLFormElement} */ (series.form).submit());

  // The two panels under the list's heading: one open at a time, and a
  // click anywhere else, or Escape, puts it away.
  const panels = /** @type {HTMLDetailsElement[]} */ (Array.from(document.querySelectorAll('.list-head details')));
  for (const d of panels) {
    d.addEventListener('toggle', () => {
      if (d.open) for (const other of panels) if (other !== d) other.open = false;
    });
  }
  document.addEventListener('click', (ev) => {
    const t = /** @type {Node} */ (ev.target);
    for (const d of panels) if (d.open && !d.contains(t)) d.open = false;
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    for (const d of panels) {
      if (!d.open) continue;
      d.open = false;
      const summary = d.querySelector('summary');
      if (summary) summary.focus();
    }
  });

  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('story-find'));
  if (!input) return;
  const rows = /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll('.story-row[data-find]')));
  const count = document.getElementById('story-count');
  const total = count ? count.textContent : String(rows.length);
  const start = input.value.trim().toLowerCase();
  input.addEventListener('input', () => {
    const needle = input.value.trim().toLowerCase();
    // What the server already searched for is not searched again here.
    if (needle === start) {
      for (const row of rows) row.hidden = false;
      if (count) count.textContent = total;
      return;
    }
    let shown = 0;
    for (const row of rows) {
      const hit = !needle || (row.getAttribute('data-find') || '').includes(needle);
      row.hidden = !hit;
      if (hit) shown += 1;
    }
    if (count) count.textContent = needle ? `${shown} on this page` : total;
  });
})();
