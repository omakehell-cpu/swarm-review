// Accepting, turning down, retracting, reopening and replying to a note,
// without the page going away and coming back.
//
// This exists for two reasons, and the second is the important one.
//
// A reload loses your place. On a chapter with forty notes, answering the
// eleventh sent you back to the top of the page to find the twelfth.
//
// And a reload is far worse if you are not looking at the screen. It
// re-reads the whole document: the title, the navigation, the chapter,
// and eventually the note you just dealt with. Doing it in place means
// one sentence is announced -- "Note accepted." -- and the focus stays on
// the note, which is where you were.
//
// Every control here is a real form posting to a real route. With this
// file missing, all of it still works; the page just reloads, as it did.
(function () {
  'use strict';

  const list = document.getElementById('comment-list');
  if (!list) return;

  // One live region for the whole column. Polite, so it waits for a gap
  // rather than cutting across whatever is being read.
  const announcer = document.createElement('div');
  announcer.className = 'sr-only';
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('role', 'status');
  document.body.appendChild(announcer);
  const say = (message) => {
    if (!message) return;
    // Cleared first: the same message twice in a row is not announced
    // again unless the region actually changes.
    announcer.textContent = '';
    window.setTimeout(() => { announcer.textContent = message; }, 50);
  };

  const ACTIONS = /\/comments\/\d+\/(status|reply|edit|retract|reopen)$/;

  document.addEventListener('submit', async (event) => {
    const form = /** @type {HTMLFormElement} */ (event.target);
    if (!form || !form.action || !ACTIONS.test(new URL(form.action, location.href).pathname)) return;
    const block = form.closest('.comment');
    if (!block) return;

    event.preventDefault();
    // Accept and Reject are one form and two buttons -- the answer is the
    // button's own name and value, and a FormData built without the
    // submitter does not contain it. Posted that way, both buttons say
    // nothing and the server, correctly, does nothing.
    const submitter = /** @type {any} */ (event).submitter
      || form.querySelector('button[type="submit"], button:not([type])');
    const fields = new FormData(form);
    if (submitter && submitter.name) fields.append(submitter.name, submitter.value);

    const buttons = Array.from(form.querySelectorAll('button'));
    for (const b of buttons) b.disabled = true;

    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'x-fragment': 'comment' },
        body: new URLSearchParams(/** @type {any} */ (fields)),
      });
      if (!res.ok) throw new Error(String(res.status));
      const html = await res.text();
      const announcement = decodeURIComponent(res.headers.get('x-announce') || '');

      const holder = document.createElement('div');
      holder.innerHTML = html;
      const fresh = holder.firstElementChild;
      if (!fresh) throw new Error('empty');

      // Focus first, then swap. Replacing the element the keyboard is on
      // drops focus to the top of the document, which for somebody
      // listening means losing their place entirely.
      fresh.setAttribute('tabindex', '-1');
      block.replaceWith(fresh);
      // Whatever was holding the old element (the phone's note sheet, in
      // app.js) needs to know it is gone.
      document.dispatchEvent(new CustomEvent('note-replaced', { detail: { from: block, to: fresh } }));
      /** @type {HTMLElement} */ (fresh).focus({ preventScroll: true });
      say(announcement);
    } catch (err) {
      // Whatever went wrong, the form still works the way it always did.
      for (const b of buttons) b.disabled = false;
      form.submit();
    }
  });
}());
