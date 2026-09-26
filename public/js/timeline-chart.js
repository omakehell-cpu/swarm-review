// public/js/timeline-chart.js -- pointing at something on the drawn
// timeline shows what it is tied to. The thing and everything linked to
// it stay; the rest steps back; the lines between them are drawn in full,
// including the dotted ones to the chapters that name it. With no script
// the picture is still all there, and every item is a link to its row.
(function () {
  'use strict';
  for (const chart of Array.from(document.querySelectorAll('.tl-chart'))) {
    const items = /** @type {HTMLElement[]} */ (Array.from(chart.querySelectorAll('.tl-item')));
    const lines = Array.from(chart.querySelectorAll('.tl-line'));
    function light(item) {
      const key = item.getAttribute('data-tl-key');
      const linked = new Set((item.getAttribute('data-tl-links') || '').split(' ').filter(Boolean));
      chart.classList.add('is-pointing');
      for (const i of items) i.classList.toggle('is-lit', i === item || linked.has(i.getAttribute('data-tl-key') || ''));
      for (const l of lines) l.classList.toggle('is-lit', l.getAttribute('data-a') === key || l.getAttribute('data-b') === key);
    }
    function dark() {
      chart.classList.remove('is-pointing');
      for (const i of items) i.classList.remove('is-lit');
      for (const l of lines) l.classList.remove('is-lit');
    }
    for (const item of items) {
      item.addEventListener('mouseenter', () => light(item));
      item.addEventListener('focus', () => light(item));
      item.addEventListener('mouseleave', dark);
      item.addEventListener('blur', dark);
    }
  }
}());
