// public/js/editor-notes.js -- answering notes while rewriting.
//
// Beside the editor are the notes the chapter was given. Here each one
// that is still waiting can be dealt with without leaving the text:
//   - Go to the words: the passage is selected in the editor, ready to
//     rewrite;
//   - Put it in the text: a suggested rewrite replaces the passage in the
//     editor (not on the server -- it goes out with the next Publish, like
//     any other edit) and the note is accepted;
//   - Accept, Turn down, Reopen: answered in place, no page load.
// Alt+J and Alt+K (Option on a Mac) step through the notes still waiting,
// selecting each one's words as they go.
(function () {
  'use strict';
  const section = document.querySelector('.editor-notes');
  const textarea = /** @type {HTMLTextAreaElement|null} */ (document.querySelector('textarea[data-editor-tools]'));
  if (!section || !textarea) return;
  const notes = /** @type {HTMLElement[]} */ (Array.from(section.querySelectorAll('.comment[data-comment-id]')));
  if (!notes.length) return;

  const say = document.createElement('div');
  say.className = 'sr-only';
  say.setAttribute('role', 'status');
  document.body.appendChild(say);
  const announce = (text) => { say.textContent = ''; setTimeout(() => { say.textContent = text; }, 40); };

  const editor = () => /** @type {any} */ (window).swarmEditor;
  const count = section.querySelector('.notes-count');
  const pendingNotes = () => notes.filter((n) => n.dataset.status === 'pending');
  function updateCount() {
    const n = pendingNotes().length;
    if (count) count.textContent = n ? `${n} pending` : 'all answered';
  }

  // Where a note's words are in the text now. The quote was taken from the
  // chapter as read, so it is looked for as written first, then with the
  // Markdown's own marks allowed between its words.
  function findWords(note) {
    const quoted = note.dataset.quoted || '';
    if (!quoted) return null;
    const text = textarea.value;
    const at = text.indexOf(quoted);
    if (at >= 0) return { start: at, end: at + quoted.length };
    const words = quoted.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!words.length) return null;
    const m = new RegExp(words.join('[\\s*_~`>]+')).exec(text);
    return m ? { start: m.index, end: m.index + m[0].length } : null;
  }

  let current = -1;
  async function goTo(note) {
    for (const n of notes) n.classList.toggle('is-current', n === note);
    current = notes.indexOf(note);
    note.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const where = findWords(note);
    if (!where) {
      announce('The words this note is about are no longer in the text.');
      return;
    }
    if (editor()) await editor().selectText(where.start, where.end);
    const who = note.querySelector('.comment-meta strong');
    announce(`Note by ${who ? who.textContent : 'somebody'}: its words are selected.`);
  }

  function step(dir) {
    const waiting = pendingNotes();
    if (!waiting.length) { announce('No notes are waiting.'); return; }
    const all = notes;
    let i = current;
    for (let k = 0; k < all.length; k++) {
      i = (i + dir + all.length) % all.length;
      if (all[i].dataset.status === 'pending') { goTo(all[i]); return; }
    }
  }

  async function answer(note, form, submitter) {
    const fields = new URLSearchParams(/** @type {any} */ (new FormData(form)));
    if (submitter && submitter.name) fields.set(submitter.name, submitter.value);
    const res = await fetch(form.action, { method: 'POST', body: fields, credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    const reopen = /\/reopen$/.test(form.action);
    const status = reopen ? 'pending' : (fields.get('status') === 'accepted' ? 'accepted' : 'rejected');
    note.dataset.status = status;
    note.classList.remove('status-pending', 'status-accepted', 'status-rejected');
    note.classList.add(`status-${status}`);
    const badge = note.querySelector('.status-badge');
    if (badge) {
      badge.className = `status-badge status-${status}`;
      badge.textContent = status === 'pending' ? 'Pending' : status === 'accepted' ? 'Accepted' : 'Rejected';
    }
    const actions = note.querySelector('.editor-note-actions');
    if (actions) {
      actions.querySelectorAll('.note-find, .note-use').forEach((b) => { /** @type {HTMLElement} */ (b).hidden = status !== 'pending'; });
      const id = note.dataset.commentId;
      form.outerHTML = status === 'pending'
        ? `<form method="post" action="/comments/${id}/status" class="inline-form note-answer"><button name="status" value="accepted" class="btn tiny" type="submit">Accept</button> <button name="status" value="rejected" class="btn tiny ghost" type="submit">Turn down</button></form>`
        : `<form method="post" action="/comments/${id}/reopen" class="inline-form note-answer"><button class="btn tiny ghost" type="submit">Reopen</button></form>`;
    }
    updateCount();
    announce(status === 'pending' ? 'Note reopened.' : status === 'accepted' ? 'Note accepted.' : 'Note turned down.');
  }

  for (const note of notes) {
    note.querySelectorAll('.note-find, .note-use').forEach((b) => { /** @type {HTMLElement} */ (b).hidden = note.dataset.status !== 'pending'; });
  }
  const stepper = /** @type {HTMLElement|null} */ (section.querySelector('.editor-notes-step'));
  if (stepper) stepper.hidden = false;

  section.addEventListener('click', async (ev) => {
    const target = /** @type {HTMLElement} */ (ev.target);
    const stepBtn = target.closest('[data-step]');
    if (stepBtn) { step(Number(/** @type {HTMLElement} */ (stepBtn).dataset.step)); return; }
    const note = /** @type {HTMLElement|null} */ (target.closest('.comment[data-comment-id]'));
    if (!note) return;
    if (target.closest('.note-find')) { goTo(note); return; }
    if (target.closest('.note-use')) {
      const where = findWords(note);
      if (!where || !editor()) { announce('The words this rewrite was for are no longer in the text, so it cannot go in by itself.'); return; }
      await editor().replaceText(where.start, where.end, note.dataset.suggestion || '');
      const form = /** @type {HTMLFormElement|null} */ (note.querySelector('form.note-answer'));
      const accept = form && form.querySelector('button[value="accepted"]');
      try { if (form) await answer(note, form, accept); } catch (e) { /* the text changed; the note can be answered by hand */ }
      announce('The rewrite is in the text, selected, and the note is accepted. It goes out with your next Publish.');
    }
  });

  section.addEventListener('submit', async (ev) => {
    const form = /** @type {HTMLFormElement} */ (ev.target);
    if (!form.classList.contains('note-answer')) return;
    const note = /** @type {HTMLElement|null} */ (form.closest('.comment[data-comment-id]'));
    if (!note) return;
    ev.preventDefault();
    const submitter = /** @type {any} */ (ev).submitter;
    const buttons = Array.from(form.querySelectorAll('button'));
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await answer(note, form, submitter);
    } catch (e) {
      buttons.forEach((b) => { b.disabled = false; });
      announce('That did not go through. Try again in a moment.');
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (!ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.code === 'KeyJ' || ev.code === 'KeyK') {
      ev.preventDefault();
      step(ev.code === 'KeyJ' ? 1 : -1);
    }
  });
  updateCount();
})();
