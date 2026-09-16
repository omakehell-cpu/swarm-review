// public/js/app.js -- text-selection commenting + small UI niceties.
// No build step, no dependencies: plain browser JS.
(function () {
  'use strict';

  const textEl = document.getElementById('chapter-text');
  if (!textEl) return; // not a chapter page

  const metaEl = document.getElementById('chapter-meta');
  const meta = metaEl ? JSON.parse(metaEl.textContent) : {};

  const versionSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('version-select'));
  if (versionSelect) {
    versionSelect.addEventListener('change', () => {
      window.location.href = `/chapters/${meta.chapterId}?v=${encodeURIComponent(versionSelect.value)}`;
    });
  }

  // ---- "Fill screen": same pattern as the editor's own width controls
  // (see public/js/writing-analyzer.js) -- widens the whole page past its
  // usual 1100px cap, for wide screens where the normal column feels
  // cramped. Available to every reader, not just the chapter's author,
  // since it's about how comfortably *they* want to read, not a writing
  // tool. #chapter-text's own max-width:72ch (style.css) still caps the
  // actual line length either way -- this only gives the layout as a
  // whole (mainly the comments pane) more room.
  const fillScreenBtn = document.getElementById('reading-fill-screen');
  if (fillScreenBtn) {
    const mainEl = document.querySelector('main.container');
    const STORAGE_KEY = 'reading-fullwidth';
    function applyFullWidth(on) {
      mainEl.classList.toggle('wa-fullwidth', on);
      fillScreenBtn.textContent = on ? 'Fit to chapter' : 'Fill screen';
    }
    let fullWidthOn = false;
    try { fullWidthOn = localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { /* ignore */ }
    applyFullWidth(fullWidthOn);
    fillScreenBtn.addEventListener('click', () => {
      fullWidthOn = !fullWidthOn;
      try { localStorage.setItem(STORAGE_KEY, fullWidthOn ? '1' : '0'); } catch (e) { /* ignore */ }
      applyFullWidth(fullWidthOn);
    });
  }

  // ---- wiki-link hover preview: character/place/ship names the server
  // auto-links from the shared wiki's index (lib/wiki.js) carry their
  // summary in data-wiki-summary; show it on hover, same reasoning as the
  // writing analyzer's own hover tooltip (see createHoverTip in writing-
  // analyzer.js -- not reused directly since it's private to that
  // module's closure, but this is the same small pattern). Skipped on
  // touch (hover: hover false) -- there's no real hover there, and a tap
  // should just follow the link like any other, not show a tooltip first.
  if (window.matchMedia && window.matchMedia('(hover: hover)').matches) {
    const wikiTip = document.createElement('div');
    wikiTip.className = 'wa-hover-tip hidden';
    document.body.appendChild(wikiTip);
    // While the card beside the chapter is open (public/js/name-card.js)
    // it is already saying this, at greater length and in a place that
    // does not sit on top of the paragraph being read.
    const cardOpen = () => Boolean(document.querySelector('[data-name-card]:not([hidden])'));
    textEl.addEventListener('mouseover', (ev) => {
      const link = /** @type {HTMLAnchorElement|null} */ (/** @type {Element} */ (ev.target).closest('a.wiki-link'));
      if (!link || cardOpen()) return;
      wikiTip.textContent = link.dataset.wikiSummary || '';
      const rect = link.getBoundingClientRect();
      wikiTip.style.top = `${window.scrollY + rect.top - 8}px`;
      wikiTip.style.left = `${window.scrollX + rect.left}px`;
      wikiTip.classList.remove('hidden');
    });
    textEl.addEventListener('mouseout', (ev) => {
      const link = /** @type {Element} */ (ev.target).closest('a.wiki-link');
      if (link && !link.contains(/** @type {Node} */ (ev.relatedTarget))) wikiTip.classList.add('hidden');
    });
    // Clicking the name answers the question the tip was answering, and
    // the pointer does not move afterwards, so no mouseout comes to take
    // it away.
    textEl.addEventListener('click', (ev) => {
      if (/** @type {Element} */ (ev.target).closest('a.wiki-link')) wikiTip.classList.add('hidden');
    });
  }

  // True while the writing analyzer's "Comments" toggle has the comments
  // panel hidden (see public/js/writing-analyzer.js) -- while hidden, the
  // inline comment highlights are visually neutralized by CSS, and the
  // interactions below should likewise do nothing rather than jump to or
  // pop open a panel the reader can't currently see.
  function commentsCurrentlyHidden() {
    const grid = textEl.closest('.chapter-body-grid');
    return Boolean(grid && grid.classList.contains('comments-hidden'));
  }

  // ---- clicking a highlighted span jumps to the comment in the sidebar ----
  textEl.addEventListener('click', (ev) => {
    if (commentsCurrentlyHidden()) return;
    const span = /** @type {HTMLElement|null} */ (/** @type {Element} */ (ev.target).closest('.hl'));
    if (!span) return;
    const ids = (span.dataset.commentIds || '').split(',').filter(Boolean);
    if (!ids.length) return;
    const target = /** @type {HTMLDetailsElement|null} */ (document.getElementById(`comment-${ids[0]}`));
    if (target) {
      // A settled comment is rendered as a collapsed <details> (see
      // renderComment in views.js) -- scrolling to one that's still shut
      // would land the reader on a one-line summary of the very thing
      // they just asked to see, so open it on the way.
      if (target.tagName === 'DETAILS') target.open = true;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('flash-highlight');
      setTimeout(() => target.classList.remove('flash-highlight'), 1500);
    }
  });

  // ---- text selection -> "add comment" toast -> inline form ----
  const toast = document.getElementById('selection-toast');
  const box = document.getElementById('new-comment-box');
  const previewEl = document.getElementById('nc-preview');
  const startInput = /** @type {HTMLInputElement} */ (document.getElementById('nc-start'));
  const endInput = /** @type {HTMLInputElement} */ (document.getElementById('nc-end'));
  const quotedInput = /** @type {HTMLInputElement} */ (document.getElementById('nc-quoted'));
  const bodyInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('nc-body'));
  const cancelBtn = document.getElementById('nc-cancel');

  let pendingSelection = null;

  function computeOffset(container, node, offsetInNode) {
    let total = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    let current = walker.nextNode();
    while (current) {
      if (current === node) return total + offsetInNode;
      total += current.textContent.length;
      current = walker.nextNode();
    }
    return total;
  }

  function getSelectionOffsets() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return null;
    if (!textEl.contains(range.startContainer) || !textEl.contains(range.endContainer)) return null;
    const start = computeOffset(textEl, range.startContainer, range.startOffset);
    const end = computeOffset(textEl, range.endContainer, range.endOffset);
    const text = sel.toString();
    if (!text.trim() || end <= start) return null;
    return { start, end, text, rect: range.getBoundingClientRect() };
  }

  document.addEventListener('mouseup', (ev) => {
    if (box && box.contains(/** @type {Node} */ (ev.target))) return;
    offerOnSelection();
  });

  // Opening the box on the selection that is there now, however it was
  // made. The toast calls this on a click; the keyboard path below calls
  // it without one.
  function openCommentBox() {
    if (!pendingSelection) return false;
    startInput.value = String(pendingSelection.start);
    endInput.value = String(pendingSelection.end);
    quotedInput.value = pendingSelection.text;
    const shown = pendingSelection.text.length > 200
      ? pendingSelection.text.slice(0, 200) + '...'
      : pendingSelection.text;
    previewEl.textContent = `"${shown}"`;
    box.classList.remove('hidden');
    toast.classList.add('hidden');
    // The passage is the context for what is about to be typed, so it is
    // the label of the box rather than a line of decoration above it.
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', `Comment on: ${shown}`);
    bodyInput.focus();
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return true;
  }

  toast.addEventListener('click', openCommentBox);

  // ---- the same thing, from the keyboard ----
  //
  // Selecting a passage and commenting on it was the heart of this app and
  // the one thing in it that could only be done with a mouse: the offer
  // appeared on mouseup and nowhere else. A selection made with shift and
  // the arrow keys is the same selection as far as the browser is
  // concerned, so all that was missing was noticing it and saying so.
  const selectionSay = document.createElement('div');
  selectionSay.className = 'sr-only';
  selectionSay.setAttribute('aria-live', 'polite');
  document.body.appendChild(selectionSay);

  let lastAnnounced = '';
  function offerOnSelection() {
    if (commentsCurrentlyHidden()) return;
    const result = getSelectionOffsets();
    if (!result) {
      toast.classList.add('hidden');
      lastAnnounced = '';
      return;
    }
    pendingSelection = result;
    // Placed for the eye, and announced for everybody else.
    const top = window.scrollY + result.rect.top - 40;
    toast.style.top = `${Math.max(top, window.scrollY + 8)}px`;
    toast.style.left = `${window.scrollX + result.rect.left}px`;
    toast.classList.remove('hidden');
    if (result.text !== lastAnnounced) {
      lastAnnounced = result.text;
      const words = result.text.trim().split(/\s+/).length;
      selectionSay.textContent = words === 1
        ? `One word selected: ${result.text.trim()}. Press C to comment on it.`
        : `${words} words selected. Press C to comment on them.`;
    }
  }

  document.addEventListener('keyup', (ev) => {
    // Only the keys that can move a selection edge, so this does not run
    // on every keystroke somewhere else on the page. Anything that is not
    // a selection inside the chapter falls out of offerOnSelection
    // anyway, which is the one place that decides.
    if (!/^(Arrow|Home|End|Page)/.test(ev.key) && !(ev.key === 'a' && (ev.ctrlKey || ev.metaKey))) return;
    offerOnSelection();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'c' && ev.key !== 'C') return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const active = document.activeElement;
    const tag = active ? active.tagName : '';
    // Never steal a letter somebody is typing.
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      || (active && /** @type {HTMLElement} */ (active).isContentEditable)) return;
    if (!pendingSelection) return;
    if (openCommentBox()) ev.preventDefault();
  });

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      box.classList.add('hidden');
      bodyInput.value = '';
    });
  }

})();
