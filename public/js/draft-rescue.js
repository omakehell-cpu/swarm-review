// Keeps what is being typed, in this browser, so that a crash, a closed
// tab or a dropped session does not take an afternoon's writing with it.
//
// Scrivener writes to disk every two seconds; a web page has no disk, so
// this uses local storage, which is the same idea with a smaller cupboard.
// Nothing is sent anywhere: the draft never leaves the machine it was
// typed on, and it is thrown away the moment the real save lands.
//
// Deliberately a rescue and not a sync. It never silently replaces what
// the server has -- it offers, and a person decides. Restoring text
// somebody had already abandoned would be its own kind of data loss.
(function () {
  'use strict';
  const form = document.querySelector('form.chapter-form');
  if (!form) return;
  const text = /** @type {HTMLTextAreaElement|null} */ (form.querySelector('textarea[name="content"]'));
  if (!text) return;

  // One key per form: a chapter being edited, or the new-chapter form of
  // one story. Two drafts must never be able to land on each other.
  const key = `swarm-draft:${form.getAttribute('action') || location.pathname}`;
  const SAVE_AFTER_MS = 1500;
  const store = {
    read() { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } },
    write(value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private window, or full */ } },
    clear() { try { localStorage.removeItem(key); } catch (e) { /* nothing to do */ } },
  };

  const title = /** @type {HTMLInputElement|null} */ (form.querySelector('input[name="title"], input[name="chapterTitle"]'));
  const storyTitle = /** @type {HTMLInputElement|null} */ (form.querySelector('input[name="storyTitle"]'));
  // Where it is kept is said in the bar along the top when there is one,
  // which is always in view; otherwise under the text.
  const inBar = document.querySelector('[data-draft-status]');
  const status = /** @type {HTMLElement} */ (inBar || document.createElement('p'));
  if (!inBar) {
    status.className = 'draft-status';
    text.parentElement.appendChild(status);
  }
  status.hidden = true;

  const say = (message) => {
    status.textContent = message;
    status.hidden = !message;
  };

  const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // What was on the page when it loaded. A stored draft equal to this is
  // not a rescue, it is an echo, and saying "you have unsaved work" about
  // work that is saved is how a warning stops being believed.
  const original = text.value;
  let timer = null;

  // ---- the server copy ----
  //
  // On the chapter editor there is also a draft on the server
  // (form[data-draft-url]), which is the one that follows the author to
  // another device. It is written a few seconds after typing stops and
  // when the tab is put away, and once it has landed, closing the tab no
  // longer needs a warning: nothing would be lost.
  const draftUrl = form.getAttribute('data-draft-url');
  const summaryField = /** @type {HTMLTextAreaElement|null} */ (form.querySelector('textarea[name="summary"]'));
  const baseField = /** @type {HTMLInputElement|null} */ (form.querySelector('input[name="baseVersion"]'));
  const SERVER_AFTER_MS = 4000;
  let serverCopy = original;
  let serverTimer = null;
  // The page leaving sends its draft as a beacon, which carries no
  // headers, so the CSRF token rides in the body (see lib/csrf.js).
  const csrfField = /** @type {HTMLInputElement|null} */ (document.querySelector('input[name="_csrf"]'));
  const draftFields = () => new URLSearchParams({
    _csrf: csrfField ? csrfField.value : '',
    content: text.value,
    title: title ? title.value : '',
    summary: summaryField ? summaryField.value : '',
    baseVersion: baseField ? baseField.value : '',
  });
  async function sendToServer() {
    if (!draftUrl || text.value === serverCopy || !text.value.trim()) return;
    const sending = text.value;
    try {
      const res = await fetch(draftUrl, { method: 'POST', body: draftFields(), credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      serverCopy = sending;
      if (text.value === sending) {
        store.clear();
        say(`Draft saved to your account, ${clock()} \u2014 not published yet`);
      }
    } catch (e) {
      say(`Draft kept in this browser, ${clock()} (the server copy will be tried again)`);
    }
  }
  if (draftUrl) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden' || saving || text.value === serverCopy || !text.value.trim()) return;
      try {
        const blob = new Blob([draftFields().toString()], { type: 'application/x-www-form-urlencoded' });
        if (navigator.sendBeacon(draftUrl, blob)) serverCopy = text.value;
      } catch (e) { /* the local copy still has it */ }
    });
  }

  function keep() {
    if (text.value === original && text.value === serverCopy) { store.clear(); say(''); return; }
    store.write({ content: text.value, title: title ? title.value : '', storyTitle: storyTitle ? storyTitle.value : '', at: Date.now() });
    say(`Draft kept in this browser, ${clock()}`);
    if (draftUrl) {
      clearTimeout(serverTimer);
      serverTimer = setTimeout(sendToServer, SERVER_AFTER_MS);
    }
  }

  const saved = store.read();
  if (saved && saved.content && saved.content !== original) {
    const when = new Date(saved.at || Date.now()).toLocaleString();
    const bar = document.createElement('div');
    bar.className = 'draft-rescue';
    bar.innerHTML = '<p><strong>There is unsaved writing from this browser.</strong> '
      + `Last kept ${when}. It has not been published: the text below is what the server has.</p>`;
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'btn ghost small';
    restore.textContent = 'Put my draft back';
    restore.addEventListener('click', () => {
      text.value = saved.content;
      if (title && saved.title) title.value = saved.title;
      if (storyTitle && saved.storyTitle) storyTitle.value = saved.storyTitle;
      // Setting .value does not fire "input", and the writing checks draw
      // the visible text on a layer over a transparent textarea: without
      // this the layer kept showing the old text, so the restored draft
      // came back as blank lines and stray words until the next keystroke.
      text.dispatchEvent(new Event('input', { bubbles: true }));
      bar.remove();
      text.focus();
      say('Your draft is back in the box. It still has to be saved.');
    });
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'btn ghost small';
    drop.textContent = 'Throw it away';
    drop.addEventListener('click', () => { store.clear(); bar.remove(); });
    const actions = document.createElement('div');
    actions.className = 'draft-rescue-actions';
    actions.appendChild(restore);
    actions.appendChild(drop);
    bar.appendChild(actions);
    form.insertBefore(bar, form.firstChild);
  }

  for (const field of [text, title, storyTitle].filter(Boolean)) {
    field.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(keep, SAVE_AFTER_MS);
    });
  }

  // The save is a normal form post, so the page is about to go away. If it
  // fails, or the server refuses it, the draft is still here when the
  // page comes back.
  let saving = false;
  form.addEventListener('submit', () => {
    saving = true;
    clearTimeout(timer);
    keep();
    // The next page load is the one that knows whether it worked: the
    // editor is rendered with the saved text as its original, so the
    // check at the top of this file clears the draft by itself.
  });

  // Coming back to this page from the browser's history does not reload
  // it: without this, a Save followed by Back would leave the page
  // convinced it was still on its way out, and the next attempt to leave
  // would go through with no warning at all.
  window.addEventListener('pageshow', () => { saving = false; });

  // "Are you sure you want to leave? You may lose changes." Worth asking
  // when somebody closes the tab on top of an hour's writing, and an
  // insult when they have just pressed Save: pressing Save IS leaving the
  // page, on purpose, and the text is on its way to the server.
  window.addEventListener('beforeunload', (e) => {
    if (saving) return;
    if (text.value === original) return;
    if (draftUrl && text.value === serverCopy) return;
    keep();
    e.preventDefault();
    e.returnValue = '';
  });
}());
