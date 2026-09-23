// public/js/reactions.js -- how each paragraph read, in one tap.
//
// A reader, in Review: click (or tap) a paragraph, or select some words
// and press R, and a small bar offers four reactions -- Hooked, Lost me,
// Dragged, Didn't buy it. Each is a switch; pressing it again takes it
// back. Paragraphs you have reacted to carry a thin mark in the margin.
//
// The author, in Review: the same paragraphs are shaded by what readers
// felt there -- the colour of the reaction most had, stronger the more
// readers had it -- with the counts beside them, and a line above the
// text lists the paragraphs where the most readers were lost.
//
// Nothing is ever put inside the text itself: the paragraph elements get a
// class and a data attribute, which changes no offsets, so notes anchored
// to the words stay exactly where they were.
(function () {
  'use strict';
  const dataEl = document.getElementById('reactions-data');
  const text = /** @type {HTMLElement|null} */ (document.getElementById('chapter-text'));
  if (!dataEl || !text) return;
  let data;
  try { data = JSON.parse(dataEl.textContent || '{}'); } catch (e) { return; }
  const blocks = /** @type {HTMLElement[]} */ (Array.from(text.children));
  const KINDS = [
    ['hooked', 'Hooked'],
    ['lost', 'Lost me'],
    ['slow', 'Dragged'],
    ['unconvinced', 'Didn’t buy it'],
  ];
  const LABEL = Object.fromEntries(KINDS);
  const main = document.querySelector('main');
  const reviewing = () => !main || main.dataset.reading !== 'read';

  // --------------------------------------------------------------- author
  if (data.mode === 'author') {
    const by = data.map && data.map.byParagraph ? data.map.byParagraph : {};
    const readers = Math.max(1, (data.map && data.map.readers) || 1);
    Object.keys(by).forEach((key) => {
      const block = blocks[Number(key) - 1];
      if (!block) return;
      const counts = by[key];
      const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      const total = Object.values(counts).reduce((s, n) => s + Number(n), 0);
      block.classList.add('reacted-heat', `heat-${top}`);
      block.style.setProperty('--heat', String(Math.min(1, 0.35 + 0.65 * (counts[top] / readers))));
      block.dataset.heatLabel = KINDS.filter(([k]) => counts[k]).map(([k, l]) => `${l} ${counts[k]}`).join(' · ');
      block.dataset.heatTotal = String(total);
    });
    // The summary above the text: its links go to the paragraph.
    document.addEventListener('click', (ev) => {
      const link = /** @type {HTMLElement} */ (ev.target).closest('[data-para]');
      if (!link) return;
      ev.preventDefault();
      const block = blocks[Number(/** @type {HTMLElement} */ (link).dataset.para) - 1];
      if (!block) return;
      block.setAttribute('tabindex', '-1');
      block.scrollIntoView({ block: 'center', behavior: 'smooth' });
      block.focus({ preventScroll: true });
      block.classList.add('heat-flash');
      setTimeout(() => block.classList.remove('heat-flash'), 1600);
    });
    return;
  }

  // --------------------------------------------------------------- reader
  const mine = data.mine || {};
  const token = (document.querySelector('meta[name="csrf-token"]') || { getAttribute: () => '' }).getAttribute('content') || '';
  function markMine(index) {
    const block = blocks[index - 1];
    if (!block) return;
    const kinds = mine[index] || [];
    block.classList.toggle('reacted-mine', kinds.length > 0);
    KINDS.forEach(([k]) => block.classList.toggle(`mine-${k}`, kinds.includes(k)));
  }
  Object.keys(mine).forEach((k) => markMine(Number(k)));

  const bar = document.createElement('div');
  bar.className = 'react-bar';
  bar.setAttribute('role', 'toolbar');
  bar.hidden = true;
  const buttons = KINDS.map(([kind, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `react-btn react-${kind}`;
    b.dataset.kind = kind;
    b.textContent = label;
    b.setAttribute('aria-pressed', 'false');
    bar.appendChild(b);
    return b;
  });
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'react-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  bar.appendChild(close);
  document.body.appendChild(bar);
  const say = document.createElement('div');
  say.className = 'sr-only';
  say.setAttribute('role', 'status');
  document.body.appendChild(say);

  let open = 0;
  let returnTo = null;
  function show(index, { focus = false } = {}) {
    const block = blocks[index - 1];
    if (!block) return;
    open = index;
    const kinds = mine[index] || [];
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(kinds.includes(b.dataset.kind))));
    bar.setAttribute('aria-label', `How paragraph ${index} read for you`);
    const rect = block.getBoundingClientRect();
    bar.hidden = false;
    bar.style.top = `${window.scrollY + rect.top - bar.offsetHeight - 6}px`;
    bar.style.left = `${window.scrollX + rect.left}px`;
    if (focus) { returnTo = document.activeElement; buttons[0].focus(); }
  }
  function hide() {
    bar.hidden = true;
    open = 0;
    if (returnTo && returnTo instanceof HTMLElement) returnTo.focus();
    returnTo = null;
  }
  const blockIndexOf = (node) => {
    const el = node instanceof Element ? node : node && node.parentElement;
    if (!el) return 0;
    const block = blocks.find((b) => b === el || b.contains(el));
    return block ? blocks.indexOf(block) + 1 : 0;
  };

  text.addEventListener('click', (ev) => {
    if (!reviewing()) return;
    const target = /** @type {HTMLElement} */ (ev.target);
    if (target.closest('a, mark, .hl, button')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const index = blockIndexOf(target);
    if (index) show(index);
  });
  document.addEventListener('keydown', (ev) => {
    if (!bar.hidden && ev.key === 'Escape') { hide(); return; }
    if ((ev.key !== 'r' && ev.key !== 'R') || ev.metaKey || ev.ctrlKey || ev.altKey || !reviewing()) return;
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !text.contains(sel.anchorNode)) return;
    const index = blockIndexOf(sel.anchorNode);
    if (!index) return;
    ev.preventDefault();
    show(index, { focus: true });
  });
  document.addEventListener('click', (ev) => {
    if (bar.hidden) return;
    const target = /** @type {HTMLElement} */ (ev.target);
    if (bar.contains(target) || text.contains(target)) return;
    hide();
  });
  close.addEventListener('click', hide);

  bar.addEventListener('click', async (ev) => {
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (ev.target).closest('.react-btn'));
    if (!b || !open) return;
    const kind = b.dataset.kind || '';
    const index = open;
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    const list = new Set(mine[index] || []);
    if (on) list.add(kind); else list.delete(kind);
    mine[index] = Array.from(list);
    markMine(index);
    say.textContent = on ? `${LABEL[kind]}, noted for paragraph ${index}.` : `${LABEL[kind]}, taken back.`;
    try {
      const res = await fetch(`/chapters/${text.dataset.chapterId}/react`, {
        method: 'POST',
        credentials: 'same-origin',
        body: new URLSearchParams({ _csrf: token, versionId: String(data.versionId), paragraph: String(index), kind, on: on ? '1' : '0' }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch (e) {
      // Put it back as it was, and say so.
      if (on) list.delete(kind); else list.add(kind);
      mine[index] = Array.from(list);
      markMine(index);
      b.setAttribute('aria-pressed', String(!on));
      say.textContent = 'That did not go through. Try again in a moment.';
    }
  });
})();
