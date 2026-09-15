// Narrows the glossary listing as you type, without a round trip. The form
// around the box still works on its own -- this only takes over once the
// script has run, so a browser with JavaScript off keeps the old behaviour
// of submitting the search and getting a filtered page back.
//
// Nothing here talks to the network: the whole listing is already in the
// page, and this only hides the rows that do not match.
(function () {
  'use strict';
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('glossary-filter'));
  const list = document.getElementById('glossary-list');
  if (!input || !list) return;

  const rows = /** @type {HTMLElement[]} */ (Array.from(list.querySelectorAll('.glossary-row')));
  const blocks = /** @type {HTMLElement[]} */ (Array.from(list.querySelectorAll('.letter-block')));
  const counter = document.getElementById('glossary-count');
  const empty = document.getElementById('glossary-no-matches');
  const bar = document.querySelector('.az-bar');
  const jumps = bar ? Array.from(bar.querySelectorAll('[data-letter]')) : [];
  const total = rows.length;
  const plural = (n) => `${n} page${n === 1 ? '' : 's'}`;

  function apply() {
    const needle = input.value.trim().toLowerCase();
    const live = new Set();
    let shown = 0;
    for (const row of rows) {
      const hit = !needle || (row.getAttribute('data-search') || '').includes(needle);
      row.hidden = !hit;
      if (hit) shown += 1;
    }
    for (const block of blocks) {
      const any = !!block.querySelector('.glossary-row:not([hidden])');
      block.hidden = !any;
      if (any) live.add(block.getAttribute('data-letter'));
    }
    // A letter with nothing behind it any more is dimmed rather than
    // removed, so the bar does not reflow on every keystroke.
    for (const jump of jumps) jump.classList.toggle('spent', !live.has(jump.getAttribute('data-letter')));
    if (counter) counter.textContent = needle && shown !== total ? `${plural(shown)} of ${total}` : plural(total);
    if (empty) empty.hidden = shown !== 0;
  }

  input.addEventListener('input', apply);
  // Enter would submit and reload a page we have already filtered.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); apply(); }
  });
  if (input.value.trim()) apply();
}());
