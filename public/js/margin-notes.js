// public/js/margin-notes.js -- a dot in the margin for every passage with a
// note on it.
//
// The notes used to be pinned beside their passages, with a line drawn
// from each passage to its note. On a busy chapter that meant a column of
// gaps and a web of connectors, and on the text itself a note's underline
// fought the writing checks' colours for the same words. Now the checks
// have the text, the notes are a plain list beside it, and each noted
// passage gets one dot in the margin, level with its first line: red for
// a note still waiting, ink for one taken, grey for one turned down.
//
// Pointing at a dot lights its passage; clicking it goes to the note, the
// same as clicking the passage (app.js). The dots are a pointer's aid: the
// passages themselves are announced as highlighted (reading.js) and every
// note has a link back to its words, so nothing here is keyboard-only.
(function () {
  'use strict';

  const pane = /** @type {HTMLElement|null} */ (document.querySelector('.reading-pane'));
  const text = /** @type {HTMLElement|null} */ (document.getElementById('chapter-text'));
  if (!pane || !text) return;
  const marks = () => /** @type {HTMLElement[]} */ (Array.from(text.querySelectorAll('.hl')));
  if (!marks().length) return;

  const layer = document.createElement('div');
  layer.className = 'note-dots';
  layer.setAttribute('aria-hidden', 'true');
  pane.appendChild(layer);

  const statusOf = (hl) => (hl.classList.contains('hl-pending') ? 'pending'
    : hl.classList.contains('hl-rejected') ? 'rejected' : 'accepted');
  const RANK = { pending: 0, accepted: 1, rejected: 2 };

  function layout() {
    layer.textContent = '';
    const main = /** @type {HTMLElement|null} */ (document.querySelector('main'));
    if (main && main.dataset.reading === 'read') return;
    const top0 = pane.getBoundingClientRect().top;
    // One dot per line: several notes starting on the same line share it,
    // and it takes the colour of the one that most needs you.
    /** @type {Map<number, {status: string, hls: HTMLElement[]}>} */
    const lines = new Map();
    for (const hl of marks()) {
      const rect = hl.getClientRects()[0];
      if (!rect) continue;
      const y = Math.round(rect.top - top0 + rect.height / 2);
      let key = null;
      for (const k of lines.keys()) if (Math.abs(k - y) < 8) { key = k; break; }
      if (key === null) { key = y; lines.set(key, { status: statusOf(hl), hls: [] }); }
      const line = lines.get(key);
      line.hls.push(hl);
      if (RANK[statusOf(hl)] < RANK[line.status]) line.status = statusOf(hl);
    }
    for (const [y, line] of lines) {
      const dot = document.createElement('span');
      dot.className = `note-dot note-dot-${line.status}`;
      dot.style.top = `${y}px`;
      dot.title = line.hls.length > 1 ? `${line.hls.length} notes on this line` : 'A note on this line';
      const light = (on) => line.hls.forEach((h) => h.classList.toggle('hl-lit', on));
      dot.addEventListener('mouseenter', () => light(true));
      dot.addEventListener('mouseleave', () => light(false));
      dot.addEventListener('click', () => line.hls[0].click());
      layer.appendChild(dot);
    }
  }

  let frame = 0;
  function schedule() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { frame = 0; layout(); });
  }
  window.addEventListener('resize', schedule);
  document.addEventListener('toggle', schedule, true);
  document.addEventListener('reading-mode', schedule);
  const controls = document.getElementById('reading-controls');
  if (controls) controls.addEventListener('click', () => setTimeout(schedule, 0));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  // The writing checks wrap words in marks after the page has drawn,
  // which can move a line or two.
  if (typeof MutationObserver !== 'undefined') {
    /** @type {any} */
    let pending = 0;
    new MutationObserver(() => { clearTimeout(pending); pending = setTimeout(schedule, 120); })
      .observe(text, { childList: true, subtree: true });
  }
  schedule();
})();
