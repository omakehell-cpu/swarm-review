// public/js/editor-tools.js -- a few buttons over the chapter text, the
// keyboard shortcuts every other editor has, and a way to make everything
// but the writing go away.
//
// The text is still Markdown in a plain textarea, on purpose: it is what
// the anchored notes are counted against, and it survives being pasted
// anywhere. What was missing was not a different editor but the reflexes
// people bring from every other one -- Ctrl+B to embolden, a button for a
// scene break -- so nobody has to remember which symbols do what.
//
// Everything goes through the browser's own insert command where it
// exists, so Ctrl+Z undoes a button press like any other typing, and an
// `input` event follows, so the writing checks and the draft keeping both
// see the change.
(function () {
  'use strict';

  const areas = /** @type {HTMLTextAreaElement[]} */ (Array.from(document.querySelectorAll('textarea[data-editor-tools]')));
  if (!areas.length) return;

  function insert(textarea, text, selectFrom, selectTo) {
    textarea.focus();
    const start = textarea.selectionStart;
    let done;
    try { done = document.execCommand('insertText', false, text); } catch (e) { done = false; }
    if (!done) {
      textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (selectFrom !== undefined) textarea.setSelectionRange(start + selectFrom, start + (selectTo ?? selectFrom));
  }

  // *word* around the selection, or around nothing with the cursor in the
  // middle. Pressing it again on text that is already wrapped unwraps it.
  function wrap(textarea, mark) {
    const { selectionStart: s, selectionEnd: e, value } = textarea;
    const selected = value.slice(s, e);
    if (selected.startsWith(mark) && selected.endsWith(mark) && selected.length >= mark.length * 2) {
      insert(textarea, selected.slice(mark.length, selected.length - mark.length), 0, selected.length - mark.length * 2);
      return;
    }
    if (value.slice(s - mark.length, s) === mark && value.slice(e, e + mark.length) === mark) {
      textarea.setSelectionRange(s - mark.length, e + mark.length);
      insert(textarea, selected, 0, selected.length);
      return;
    }
    insert(textarea, `${mark}${selected}${mark}`, mark.length, mark.length + selected.length);
  }

  // A line-level mark: "> " for a quoted line, "# " for a heading. Put at
  // the start of every line the selection touches.
  function prefixLines(textarea, prefix) {
    const { value } = textarea;
    const lineStart = value.lastIndexOf('\n', textarea.selectionStart - 1) + 1;
    let lineEnd = value.indexOf('\n', textarea.selectionEnd);
    if (lineEnd === -1) lineEnd = value.length;
    const lines = value.slice(lineStart, lineEnd).split('\n');
    const all = lines.every((l) => l.startsWith(prefix));
    const next = lines.map((l) => (all ? l.slice(prefix.length) : prefix + l)).join('\n');
    textarea.setSelectionRange(lineStart, lineEnd);
    insert(textarea, next, 0, next.length);
  }

  function sceneBreak(textarea) {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const lead = before === '' || before.endsWith('\n\n') ? '' : (before.endsWith('\n') ? '\n' : '\n\n');
    const text = `${lead}---\n\n`;
    insert(textarea, text, text.length);
  }

  // ---- focus mode ----
  // Everything on the page except the title, the text and the buttons that
  // save it, gone until Escape or the button again. Remembered for this
  // browser, because somebody who writes that way writes that way every
  // time.
  const FOCUS_KEY = 'editor-focus';
  function setFocus(on, button) {
    document.body.classList.toggle('writing-focus', on);
    if (button) {
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.textContent = on ? 'Leave focus' : 'Focus';
    }
    try { localStorage.setItem(FOCUS_KEY, on ? '1' : '0'); } catch (e) { /* private window */ }
  }

  const ACTIONS = [
    { id: 'bold', label: 'B', title: 'Bold (Ctrl+B)', key: 'b', run: (t) => wrap(t, '**') },
    { id: 'italic', label: 'I', title: 'Italic (Ctrl+I)', key: 'i', run: (t) => wrap(t, '*') },
    { id: 'quote', label: '“', title: 'Quote the line (Ctrl+Shift+.)', run: (t) => prefixLines(t, '> ') },
    { id: 'heading', label: 'H', title: 'Heading', run: (t) => prefixLines(t, '## ') },
    { id: 'break', label: '* * *', title: 'Scene break (Ctrl+Enter)', run: (t) => sceneBreak(t) },
  ];

  for (const textarea of areas) {
    const bar = document.createElement('div');
    bar.className = 'editor-tools';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Formatting');
    for (const action of ACTIONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `editor-tool tool-${action.id}`;
      b.textContent = action.label;
      b.title = action.title;
      b.setAttribute('aria-label', action.title);
      // Keep the selection in the textarea: a mousedown on a button would
      // otherwise take focus and the selection with it.
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.addEventListener('click', () => action.run(textarea));
      bar.appendChild(b);
    }
    const spacer = document.createElement('span');
    spacer.className = 'editor-tools-spacer';
    bar.appendChild(spacer);
    const focusBtn = document.createElement('button');
    focusBtn.type = 'button';
    focusBtn.className = 'editor-tool tool-focus';
    focusBtn.title = 'Hide everything but the writing (Esc to come back)';
    focusBtn.setAttribute('aria-pressed', 'false');
    focusBtn.textContent = 'Focus';
    focusBtn.addEventListener('click', () => {
      setFocus(!document.body.classList.contains('writing-focus'), focusBtn);
      textarea.focus();
    });
    bar.appendChild(focusBtn);

    // After the writing checks have built their frame round the textarea,
    // the bar goes directly above the text itself; without them, directly
    // above the textarea.
    const place = () => {
      const editorWrap = textarea.closest('.wa-editor-wrap');
      const anchor = editorWrap ? editorWrap.closest('.wa-split') || editorWrap : textarea;
      anchor.parentNode.insertBefore(bar, anchor);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place);
    else place();

    textarea.addEventListener('keydown', (ev) => {
      const mod = ev.ctrlKey || ev.metaKey;
      if (!mod || ev.altKey) return;
      const k = ev.key.toLowerCase();
      if (!ev.shiftKey && (k === 'b' || k === 'i')) {
        ev.preventDefault();
        wrap(textarea, k === 'b' ? '**' : '*');
      } else if (ev.shiftKey && (k === '.' || k === '>')) {
        ev.preventDefault();
        prefixLines(textarea, '> ');
      } else if (!ev.shiftKey && k === 'enter') {
        ev.preventDefault();
        sceneBreak(textarea);
      }
    });

    let startFocused = false;
    try { startFocused = localStorage.getItem(FOCUS_KEY) === '1'; } catch (e) { /* ignore */ }
    if (startFocused) setFocus(true, focusBtn);
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && document.body.classList.contains('writing-focus')) setFocus(false, focusBtn);
    });
  }
}());
