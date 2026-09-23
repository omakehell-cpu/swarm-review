// public/js/story-filter.js -- the "Find a story" box on the front page.
// Narrows the list as you type; nothing is fetched, the rows are all
// there. Without a script the box is never shown.
(function () {
  'use strict';
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('story-find'));
  if (!input) return;
  const rows = /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll('.story-row[data-find]')));
  const count = document.querySelector('.list-head .list-count');
  const total = rows.length;
  input.hidden = false;
  input.addEventListener('input', () => {
    const needle = input.value.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const hit = !needle || (row.getAttribute('data-find') || '').includes(needle);
      row.hidden = !hit;
      if (hit) shown += 1;
    }
    if (count) count.textContent = needle ? `${shown} of ${total}` : String(total);
  });
})();
