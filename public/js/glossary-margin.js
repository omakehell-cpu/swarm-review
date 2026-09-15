// public/js/glossary-margin.js -- what the links in a glossary entry are
// about, in the margin beside them.
//
// A page in this wiki is half links: every ship, colony and author in a
// paragraph is another page. Following one means losing your place, and
// coming back means finding it again. The margin already has the room --
// the text stops at its measure and the rest of the window is empty --
// so the summary of each linked page goes there, level with the line
// that mentions it.
//
// Only the first mention of each page gets a card (the server marks it;
// see markFirstGlossaryLinks in views.js): eight cards saying the same
// thing about Akarge is not eight times the help.
//
// Measured, not declared, like the margin notes on a chapter: if the
// numbers cannot be trusted -- no room, no JavaScript, a narrow window --
// nothing happens and the page reads exactly as it did before.
(function () {
  'use strict';

  const GAP = 14;            // between two cards that would otherwise overlap
  const COLUMN_GAP = 48;     // between the text and the cards
  const MIN_CARD = 230;      // narrower than this and a summary is a column of syllables
  const MAX_CARD = 340;
  const ANCHOR_OFFSET = 10;  // a card sits a little below its line's top

  const body = /** @type {HTMLElement|null} */ (document.querySelector('.glossary-body'));
  const content = /** @type {HTMLElement|null} */ (document.querySelector('.glossary-content'));
  const margin = /** @type {HTMLElement|null} */ (document.querySelector('.glossary-margin'));
  if (!body || !content || !margin) return;

  const cards = /** @type {HTMLElement[]} */ (Array.from(margin.querySelectorAll('.glossary-preview')));
  if (!cards.length) return;

  let svg = null;

  function teardown() {
    body.classList.remove('with-previews');
    margin.style.removeProperty('left');
    margin.style.removeProperty('width');
    margin.style.removeProperty('height');
    for (const card of cards) {
      card.style.removeProperty('top');
      card.hidden = false;
    }
    if (svg) { svg.remove(); svg = null; }
  }

  function layout() {
    const bodyBox = body.getBoundingClientRect();
    const textBox = content.getBoundingClientRect();
    const room = bodyBox.right - textBox.right - COLUMN_GAP;
    if (room < MIN_CARD) { teardown(); return; }

    const width = Math.min(MAX_CARD, room);
    body.classList.add('with-previews');
    margin.style.left = `${Math.round(textBox.right - bodyBox.left + COLUMN_GAP)}px`;
    margin.style.width = `${Math.round(width)}px`;

    // Measure every anchor before moving a single card: the cards are
    // taken out of the flow, so the first one placed would otherwise
    // change where the rest think their lines are.
    const placements = [];
    for (const card of cards) {
      const key = card.dataset.previewFor;
      const link = key ? content.querySelector(`a[data-preview="${CSS.escape(key)}"]`) : null;
      if (!link) { placements.push(null); continue; }
      placements.push({
        card,
        link: /** @type {HTMLElement} */ (link),
        wanted: link.getBoundingClientRect().top - bodyBox.top - ANCHOR_OFFSET,
      });
    }
    if (placements.every((p) => p === null)) { teardown(); return; }

    let lastBottom = 0;
    for (let i = 0; i < placements.length; i += 1) {
      const p = placements[i];
      if (!p) { cards[i].hidden = true; continue; }
      p.card.hidden = false;
      const top = Math.max(p.wanted, lastBottom + GAP);
      p.card.style.top = `${top}px`;
      p.top = top;
      lastBottom = top + p.card.offsetHeight;
    }
    margin.style.height = `${lastBottom}px`;

    // The thread back to the word, which matters exactly when a card has
    // been pushed away from its line by the ones above it.
    if (svg) svg.remove();
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'margin-links');
    svg.setAttribute('aria-hidden', 'true');
    for (const p of placements) {
      if (!p || p.top === undefined) continue;
      const r = p.link.getBoundingClientRect();
      const x1 = r.right - bodyBox.left + 4;
      const y1 = r.top - bodyBox.top + r.height / 2;
      const x2 = margin.getBoundingClientRect().left - bodyBox.left - 4;
      const y2 = p.top + ANCHOR_OFFSET + 6;
      const mid = (x1 + x2) / 2;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
      svg.appendChild(path);
    }
    body.appendChild(svg);
  }

  let frame = 0;
  function schedule() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { frame = 0; layout(); });
  }

  window.addEventListener('resize', schedule);
  document.addEventListener('toggle', schedule, true);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  schedule();
})();
