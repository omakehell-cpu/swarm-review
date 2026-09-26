// public/js/authors-find.js -- narrowing /authors as you type: an author
// stays if their name, the member they are now, or one of their story
// titles has what was typed in it. With no script the list is all there.
(function () {
  'use strict';
  const input = /** @type {HTMLInputElement|null} */ (document.querySelector('[data-author-find]'));
  if (!input) return;
  const cards = /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll('[data-author-search]')));
  const none = /** @type {HTMLElement|null} */ (document.querySelector('[data-author-none]'));
  const fold = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  input.addEventListener('input', () => {
    const needle = fold(input.value.trim());
    let shown = 0;
    for (const card of cards) {
      const hit = !needle || fold(card.dataset.authorSearch || '').includes(needle);
      card.hidden = !hit;
      if (hit) shown += 1;
    }
    for (const section of Array.from(document.querySelectorAll('.author-list'))) {
      const box = /** @type {HTMLElement} */ (section.parentElement);
      box.hidden = !Array.from(section.children).some((c) => !(/** @type {HTMLElement} */ (c)).hidden);
    }
    if (none) none.hidden = shown > 0;
  });
}());
