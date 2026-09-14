// public/js/margin-notes.js -- puts each note beside the passage it is
// about, instead of in a column ordered by when it was written.
//
// This is the whole difference between an app with comments on it and a
// tool for correcting drafts. In a list, the relationship between a note
// and the words it refers to is something you work out: you read the
// quoted fragment, then find it in the text. In the margin it is something
// you see, which is how corrections have been read on paper forever.
//
// The layout is measured, not declared, so it has to be redone whenever
// anything that moves the text moves: the window resizing, the reading
// preferences changing the type, a folded note being opened. If the
// measurements cannot be trusted -- no room, no JavaScript, a narrow
// screen -- nothing happens at all and the plain column underneath is
// what the reader gets.
(function () {
  'use strict';

  const MIN_WIDTH = 1000;   // below this the two columns stack anyway
  const GAP = 12;           // between two notes that would otherwise overlap
  const ANCHOR_OFFSET = 14; // a note sits a little below its line's top

  const grid = /** @type {HTMLElement|null} */ (document.querySelector('.chapter-body-grid'));
  const text = /** @type {HTMLElement|null} */ (document.getElementById('chapter-text'));
  const list = /** @type {HTMLElement|null} */ (document.getElementById('comment-list'));
  if (!grid || !text || !list) return;

  const cards = /** @type {HTMLElement[]} */ (
    Array.from(list.children).filter((el) => el.classList.contains('comment'))
  );
  if (!cards.length) return;

  let svg = null;

  function anchorFor(card) {
    const id = (card.id || '').replace('comment-', '');
    if (!id) return null;
    for (const el of text.querySelectorAll('.hl')) {
      const hl = /** @type {HTMLElement} */ (el);
      const ids = (hl.dataset.commentIds || '').split(',');
      if (ids.indexOf(id) !== -1) return hl;
    }
    return null;
  }

  function teardown() {
    grid.classList.remove('margin-notes');
    list.style.removeProperty('height');
    for (const card of cards) {
      card.style.removeProperty('position');
      card.style.removeProperty('top');
      card.style.removeProperty('left');
      card.style.removeProperty('right');
    }
    if (svg) { svg.remove(); svg = null; }
  }

  function layout() {
    // Read mode has no comment column at all, and a narrow window stacks
    // the two columns, at which point "beside" means nothing.
    const main = /** @type {HTMLElement|null} */ (document.querySelector('main.container'));
    if ((main && main.dataset.reading === 'read') || window.innerWidth < MIN_WIDTH) {
      teardown();
      return;
    }

    // Measure everything before moving anything: positioning the first
    // card changes the height of the list, which would move the anchors
    // of every card measured after it.
    const gridTop = grid.getBoundingClientRect().top;
    const placements = [];
    for (const card of cards) {
      const hl = anchorFor(card);
      if (!hl) { placements.push(null); continue; }
      placements.push({ card, hl, wanted: hl.getBoundingClientRect().top - gridTop - ANCHOR_OFFSET });
    }
    // A note with no anchor left in this version -- the passage it was
    // about has been edited away -- keeps the column's normal flow rather
    // than being pinned to a guess.
    if (placements.every((p) => p === null)) { teardown(); return; }

    grid.classList.add('margin-notes');
    let lastBottom = 0;
    for (const p of placements) {
      if (!p) continue;
      const top = Math.max(p.wanted, lastBottom + GAP);
      p.card.style.position = 'absolute';
      p.card.style.left = '0';
      p.card.style.right = '0';
      p.card.style.top = top + 'px';
      p.top = top;
      lastBottom = top + p.card.offsetHeight;
    }
    list.style.height = lastBottom + 'px';

    // The connector matters when a note has been pushed away from its line
    // by the ones above it, which is most of the time on a busy chapter.
    if (svg) svg.remove();
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'margin-links');
    svg.setAttribute('aria-hidden', 'true');
    const gridBox = grid.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    for (const p of placements) {
      if (!p || p.top === undefined) continue;
      const r = p.hl.getBoundingClientRect();
      const x1 = r.right - gridBox.left + 4;
      const y1 = r.top - gridBox.top + r.height / 2;
      const x2 = listBox.left - gridBox.left - 4;
      const y2 = p.top + ANCHOR_OFFSET + 6;
      const mid = (x1 + x2) / 2;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
      svg.appendChild(path);
    }
    grid.appendChild(svg);
  }

  let frame = 0;
  function schedule() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { frame = 0; layout(); });
  }

  // Everything that can move the text: the window, the reading controls,
  // a folded note opening, the fonts arriving after first paint.
  window.addEventListener('resize', schedule);
  document.addEventListener('toggle', schedule, true);
  const controls = document.getElementById('reading-controls');
  if (controls) controls.addEventListener('click', () => setTimeout(schedule, 0));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);

  schedule();
})();
