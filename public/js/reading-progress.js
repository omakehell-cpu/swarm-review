// public/js/reading-progress.js -- the thin line in the story's colour
// across the top of a chapter, as far along as the reader has got. It is
// decoration (hidden from screen readers): the page says the chapter
// number and length in words already.
(function () {
  'use strict';
  const bar = /** @type {HTMLElement|null} */ (document.querySelector('.chapter-progress > span'));
  const text = document.getElementById('chapter-text');
  if (!bar || !text) return;
  let queued = false;
  function draw() {
    queued = false;
    const box = text.getBoundingClientRect();
    const span = box.height - window.innerHeight;
    const done = span <= 0 ? (box.top < 0 ? 1 : 0) : Math.min(1, Math.max(0, -box.top / span));
    bar.style.transform = `scaleX(${done})`;
  }
  function queue() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(draw);
  }
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  draw();
}());
