// Writing with something open beside you.
//
// Everything in the picker is a real link to a real page with
// target="_blank", so with this file missing or JavaScript off the panel
// still works -- it just opens a tab instead of a column. All this does
// is fetch the same page's fragment into the column, which is the same
// thing without losing the draft in the textarea.
(function () {
  'use strict';

  const details = document.querySelector('[data-beside]');
  const pane = /** @type {HTMLElement|null} */ (document.querySelector('[data-beside-pane]'));
  if (!details || !pane) return;

  const card = details.closest('.writer-card') || details.parentElement;
  const body = pane.querySelector('[data-beside-body]');
  const title = pane.querySelector('[data-beside-title]');
  const closeButton = pane.querySelector('[data-beside-close]');
  if (!card || !body || !title) return;

  // The pane has to be a sibling of the card, not a child of it: two
  // columns cannot be a parent and its child. It is written inside the
  // card so that with JavaScript off it is simply hidden, and moved out
  // here, once.
  //
  // A chapter with comments on it already has a second column. Joining
  // that one rather than making another is the difference between two
  // columns and three: the pane goes above the comments, and the editor
  // keeps the width it already had.
  const existingGrid = card.closest('.chapter-body-grid');
  const comments = existingGrid ? existingGrid.querySelector('.comments-pane') : null;
  let wrap = null;
  if (comments) {
    const column = document.createElement('div');
    column.className = 'editor-side';
    comments.parentNode.insertBefore(column, comments);
    column.appendChild(pane);
    column.appendChild(comments);
  } else {
    wrap = document.createElement('div');
    wrap.className = 'editor-split';
    card.parentNode.insertBefore(wrap, card);
    wrap.appendChild(card);
    wrap.appendChild(pane);
  }

  const split = (on) => { if (wrap) wrap.classList.toggle('is-split', on); };

  const shut = () => {
    pane.hidden = true;
    split(false);
  };

  /** @param {HTMLAnchorElement} link */
  async function open(link) {
    const src = link.getAttribute('data-beside-src');
    if (!src) return;
    title.textContent = link.textContent.trim();
    body.innerHTML = '<p class="muted">Loading&hellip;</p>';
    pane.hidden = false;
    split(true);
    try {
      const res = await fetch(src, { headers: { accept: 'text/html' } });
      if (!res.ok) throw new Error(String(res.status));
      const header = res.headers.get('x-beside-title');
      if (header) title.textContent = decodeURIComponent(header);
      body.innerHTML = await res.text();
      body.scrollTop = 0;
    } catch (err) {
      // The link still works. Say so, rather than leaving a spinner.
      body.innerHTML = `<p class="muted">That would not load. <a href="${link.getAttribute('href')}" target="_blank" rel="noopener noreferrer">Open it in a tab instead &rarr;</a></p>`;
    }
  }

  details.addEventListener('click', (event) => {
    const link = /** @type {HTMLElement} */ (event.target).closest('[data-beside-src]');
    if (!link) return;
    event.preventDefault();
    open(/** @type {HTMLAnchorElement} */ (link));
  });

  if (closeButton) closeButton.addEventListener('click', shut);

  // Filtering the cast, for a story with more names than fit on a screen.
  const filter = details.querySelector('[data-beside-filter]');
  const list = details.querySelector('[data-beside-list]');
  if (filter && list) {
    filter.addEventListener('input', () => {
      const needle = /** @type {HTMLInputElement} */ (filter).value.trim().toLowerCase();
      for (const item of Array.from(list.children)) {
        const link = item.querySelector('[data-search]');
        const hay = link ? link.getAttribute('data-search') || '' : '';
        /** @type {HTMLElement} */ (item).hidden = Boolean(needle) && !hay.includes(needle);
      }
    });
  }
}());
