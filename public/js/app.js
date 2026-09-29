// public/js/app.js -- text-selection commenting + small UI niceties.
// No build step, no dependencies: plain browser JS.
(function () {
  'use strict';

  const textEl = document.getElementById('chapter-text');
  if (!textEl) return; // not a chapter page

  // The first underlined stretch of each note gets an address, so the
  // note's "Go to the passage" link has somewhere to land -- and can be
  // focused when it gets there.
  for (const span of Array.from(textEl.querySelectorAll('.hl[data-comment-ids]'))) {
    for (const id of (/** @type {HTMLElement} */ (span).dataset.commentIds || '').split(',')) {
      if (id && !document.getElementById(`passage-${id}`) && !span.id) {
        span.id = `passage-${id}`;
        span.setAttribute('tabindex', '-1');
      }
    }
  }

  // ---- a note leads to its words ----
  //
  // Clicking a note (anywhere on it but its own buttons, links and fields)
  // or its "Go to the passage" link scrolls the words it is about to the
  // middle of the window, and marks them: they blink twice so the eye finds
  // them, then stay marked until another note is chosen. Every stretch the
  // note covers is marked, not just the first, and the second of two notes
  // on the same words still finds them.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const spansOf = (id) => /** @type {HTMLElement[]} */ (Array.from(textEl.querySelectorAll('.hl[data-comment-ids]'))
    .filter((el) => (/** @type {HTMLElement} */ (el).dataset.commentIds || '').split(',').includes(id)));
  function showPassage(id, note) {
    const spans = spansOf(id);
    if (!spans.length) return false;
    for (const old of Array.from(textEl.querySelectorAll('.hl-chosen'))) old.classList.remove('hl-chosen', 'hl-blink');
    for (const old of Array.from(document.querySelectorAll('.comment.is-chosen'))) old.classList.remove('is-chosen');
    for (const span of spans) {
      span.classList.add('hl-chosen');
      if (!reduceMotion.matches) {
        span.classList.remove('hl-blink');
        void span.offsetWidth; // restart the blink when the same note is clicked again
        span.classList.add('hl-blink');
      }
    }
    if (note) note.classList.add('is-chosen');
    const first = spans[0];
    first.setAttribute('tabindex', '-1');
    first.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'center' });
    first.focus({ preventScroll: true });
    return true;
  }
  document.addEventListener('click', (ev) => {
    const target = /** @type {Element} */ (ev.target);
    const link = /** @type {HTMLAnchorElement|null} */ (target.closest('a.note-goto'));
    if (link) {
      const id = (link.getAttribute('href') || '').replace('#passage-', '');
      if (showPassage(id, link.closest('.comment'))) ev.preventDefault();
      return;
    }
    const note = /** @type {HTMLElement|null} */ (target.closest('#comment-list .comment[data-comment-id]'));
    if (!note || note.classList.contains('as-sheet')) return;
    // Its own controls do their own thing; so does selecting its text.
    if (target.closest('a, button, input, textarea, select, label, summary, form, details.edit-comment')) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && note.contains(selection.anchorNode)) return;
    showPassage(String(note.dataset.commentId), note);
  });
  textEl.addEventListener('animationend', (ev) => {
    /** @type {Element} */ (ev.target).classList.remove('hl-blink');
  });

  const metaEl = document.getElementById('chapter-meta');
  const meta = metaEl ? JSON.parse(metaEl.textContent) : {};

  const versionSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('version-select'));
  if (versionSelect) {
    versionSelect.addEventListener('change', () => {
      window.location.href = `/chapters/${meta.chapterId}?v=${encodeURIComponent(versionSelect.value)}`;
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
  // Read is only the story: no offer to comment, no box, nothing between
  // the reader and the words. Notes are for Review (and Revise).
  function commentsCurrentlyHidden() {
    const main = document.querySelector('main');
    if (main && main.dataset.reading === 'read') return true;
    const grid = textEl.closest('.chapter-body-grid');
    return Boolean(grid && grid.classList.contains('comments-hidden'));
  }

  // ---- on a phone, a note comes up from the bottom of the screen ----
  //
  // Below the two-column width the notes are listed after the chapter, so
  // "jump to the note" meant scrolling a long way from the sentence and
  // then all the way back. Instead the note itself is lifted over the text
  // as a sheet -- the same element, with its buttons working as before --
  // and put back in its place when the sheet is closed.
  const narrowScreen = window.matchMedia('(max-width: 999px)');
  const backdrop = document.createElement('div');
  backdrop.className = 'note-sheet-backdrop';
  document.body.appendChild(backdrop);
  let sheet = null;
  let sheetReturnFocus = null;
  function closeSheet() {
    if (!sheet) return;
    sheet.classList.remove('as-sheet');
    const close = sheet.querySelector('.note-sheet-close');
    if (close) close.remove();
    sheet = null;
    backdrop.classList.remove('open');
    if (sheetReturnFocus) sheetReturnFocus.focus({ preventScroll: true });
  }
  function openSheet(note) {
    closeSheet();
    sheet = note;
    sheetReturnFocus = /** @type {HTMLElement|null} */ (document.activeElement);
    note.classList.add('as-sheet');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn ghost tiny note-sheet-close';
    close.textContent = 'Close';
    close.addEventListener('click', closeSheet);
    note.insertBefore(close, note.firstChild);
    backdrop.classList.add('open');
    note.setAttribute('tabindex', '-1');
    note.focus({ preventScroll: true });
  }
  backdrop.addEventListener('click', closeSheet);
  document.addEventListener('note-replaced', (ev) => {
    const { from, to } = /** @type {CustomEvent} */ (ev).detail;
    if (sheet === from) { sheet = null; openSheet(to); }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeSheet(); });

  // ---- clicking a highlighted span jumps to the comment in the sidebar ----
  textEl.addEventListener('click', (ev) => {
    if (commentsCurrentlyHidden()) return;
    const span = /** @type {HTMLElement|null} */ (/** @type {Element} */ (ev.target).closest('.hl'));
    if (!span) return;
    const ids = (span.dataset.commentIds || '').split(',').filter(Boolean);
    if (!ids.length) return;
    const target = /** @type {HTMLDetailsElement|null} */ (document.getElementById(`comment-${ids[0]}`));
    if (target && narrowScreen.matches) {
      if (target.tagName === 'DETAILS') target.open = true;
      openSheet(target);
      return;
    }
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
  const suggestionInput = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('nc-suggestion'));
  const suggestToggle = /** @type {HTMLInputElement|null} */ (document.getElementById('nc-suggest-toggle'));
  // Ticking "suggest a rewrite" puts the cursor in the rewrite, where the
  // work is, with the passage already selected for overtyping.
  if (suggestToggle && suggestionInput) {
    suggestToggle.addEventListener('change', () => {
      if (suggestToggle.checked) {
        suggestionInput.focus();
        suggestionInput.select();
      }
    });
  }

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
    if (commentsCurrentlyHidden()) return false;
    startInput.value = String(pendingSelection.start);
    endInput.value = String(pendingSelection.end);
    quotedInput.value = pendingSelection.text;
    const shown = pendingSelection.text.length > 200
      ? pendingSelection.text.slice(0, 200) + '...'
      : pendingSelection.text;
    previewEl.textContent = `"${shown}"`;
    // The rewrite box starts as the passage itself, so suggesting a change
    // is editing a sentence rather than retyping it. It stays folded until
    // asked for; the server ignores it unless the box is ticked and the
    // words actually differ.
    if (suggestionInput) suggestionInput.value = pendingSelection.text;
    if (suggestToggle) suggestToggle.checked = false;
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
      const react = document.getElementById('reactions-data') && !document.querySelector('.reacted-heat, [data-reaction-author]')
        ? ' Or R to say how the paragraph read.' : '';
      selectionSay.textContent = (words === 1
        ? `One word selected: ${result.text.trim()}. Press C to comment on it.`
        : `${words} words selected. Press C to comment on them.`) + react;
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
      if (suggestToggle) suggestToggle.checked = false;
    });
  }

})();
