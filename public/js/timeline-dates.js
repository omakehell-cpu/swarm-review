// public/js/timeline-dates.js -- the timeline's Dates table, one row at a
// time. What a relative day comes to ("+1" after day 100 is 101) is worked
// out as it is typed and said beside the row; leaving a row saves it, and
// the number it came to replaces the "+1". With no script the table is an
// ordinary form and its button saves everything.
(function () {
  'use strict';
  const form = /** @type {HTMLFormElement|null} */ (document.querySelector('form.tl-dates'));
  if (!form) return;
  const storyId = form.getAttribute('data-story');

  const REL = /^([+-])\s*(\d+)$/;
  const toDay = (text, previous) => {
    const t = String(text || '').trim();
    if (!t) return { day: null };
    const rel = REL.exec(t);
    if (rel) return previous === null ? { day: null, error: 'Nothing above it to count from' } : { day: previous + (rel[1] === '+' ? 1 : -1) * Number(rel[2]) };
    const n = Number(t);
    return Number.isFinite(n) ? { day: Math.round(n) } : { day: null, error: 'Not a number of days' };
  };

  // Every row of one table, with what its day comes to and whether it
  // goes back in time -- a flashback, for chapters.
  function resolve(tbody) {
    let previous = null;
    let latest = null;
    const out = [];
    for (const row of Array.from(tbody.querySelectorAll('tr[data-key]'))) {
      const input = /** @type {HTMLInputElement|null} */ (row.querySelector('input[name="day"]'));
      const text = input ? input.value : (row.children[3] ? row.children[3].textContent : '');
      const r = toDay(text, previous);
      if (r.day !== null) {
        r.back = tbody.getAttribute('data-list') === 'c' && latest !== null && r.day < latest ? latest - r.day : 0;
        previous = r.day;
        if (latest === null || r.day > latest) latest = r.day;
      }
      out.push({ row, input, r, relative: !!(input && REL.test(input.value.trim())) });
    }
    return out;
  }

  function show(tbody) {
    for (const { row, r, relative } of resolve(tbody)) {
      const cell = row.querySelector('.tl-resolved');
      if (!cell || row.classList.contains('is-locked')) continue;
      const parts = [];
      if (r.back) parts.push(`<span class="chron-flag">Flashback &middot; ${r.back} day${r.back === 1 ? '' : 's'} back</span>`);
      if (r.error) parts.push(`<span class="error-text">${r.error}</span>`);
      else if (relative && r.day !== null) parts.push(`<span class="muted">day ${r.day}</span>`);
      if (row.dataset.saved) parts.push(`<span class="muted">${row.dataset.saved}</span>`);
      cell.innerHTML = parts.join(' ');
    }
  }

  async function save(row) {
    const tbody = /** @type {HTMLElement} */ (row.closest('tbody'));
    const mine = resolve(tbody).find((x) => x.row === row);
    if (!mine || mine.r.error) { show(tbody); return; }
    const field = (name) => {
      const el = /** @type {HTMLInputElement|null} */ (row.querySelector(`input[name="${name}"]`));
      return el ? el.value : '';
    };
    row.dataset.saved = 'Saving…';
    show(tbody);
    try {
      const res = await fetch(`/stories/${storyId}/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ key: row.getAttribute('data-key'), when: field('when'), day: mine.r.day === null ? '' : String(mine.r.day), end: field('end') }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (mine.input && mine.relative) mine.input.value = data.day === null ? '' : String(data.day);
      row.dataset.saved = data.saved ? 'Saved' : 'Not yours to change';
    } catch (e) {
      row.dataset.saved = 'Not saved -- use the button below';
    }
    show(tbody);
  }

  for (const tbody of Array.from(form.querySelectorAll('tbody[data-list]'))) {
    tbody.addEventListener('input', () => { show(/** @type {HTMLElement} */ (tbody)); });
    tbody.addEventListener('change', (ev) => {
      const row = /** @type {HTMLElement} */ (ev.target).closest('tr[data-key]');
      if (row) save(/** @type {HTMLElement} */ (row));
    });
    show(/** @type {HTMLElement} */ (tbody));
  }

  // Arrived from "Date it" on the grid: straight to that row's day.
  // After the page has loaded, so the browser's own jump to the row does
  // not take the focus back.
  if (location.hash.indexOf('#row-') === 0) {
    window.addEventListener('load', () => window.setTimeout(() => {
      const target = document.getElementById(location.hash.slice(1));
      const day = target && /** @type {HTMLInputElement|null} */ (target.querySelector('input[name="day"]'));
      if (day) { day.focus(); day.select(); }
    }, 0));
  }
})();
