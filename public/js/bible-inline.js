// public/js/bible-inline.js -- changing a bible entry where it is shown.
//
// Two things, both working on the page and on the card that floats beside
// a chapter (which arrives after this script has loaded, so everything
// here listens on the document rather than on elements that exist now):
//
//   [data-inline-edit]  a piece of an entry -- its name, one line, kind,
//                       role, other names. Click it (or Enter on it), change
//                       it, Enter to keep, Escape to leave it be. It goes to
//                       /bible/:id/set and the text is put back.
//   form[data-inline-form]
//                       an ordinary form that also works with JavaScript
//                       off. Here it is sent in the background and the page
//                       stays put: data-then says what happens after --
//                       "reload", "remove" (its row goes), "unlink" (the
//                       chapter's links to that entry stop being links),
//                       "relation", or "say" (the default).
(function () {
  'use strict';

  // The buttons a form needs only without JavaScript.
  for (const b of Array.from(document.querySelectorAll('[data-no-js]'))) /** @type {HTMLElement} */ (b).hidden = true;

  const voice = document.createElement('div');
  voice.className = 'sr-only';
  voice.setAttribute('aria-live', 'polite');
  voice.setAttribute('role', 'status');
  document.body.appendChild(voice);
  function say(message) {
    voice.textContent = '';
    window.setTimeout(() => { voice.textContent = message; }, 40);
  }

  function flash(near, message, isError) {
    let note = near.querySelector(':scope > .inline-note');
    if (!note) {
      note = document.createElement('p');
      note.className = 'inline-note';
      near.appendChild(note);
    }
    note.textContent = message;
    note.classList.toggle('error', !!isError);
    say(message);
  }

  async function send(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'That did not work.');
    return data;
  }

  // ---------- one piece of an entry ----------

  function shownFor(field, entity) {
    const escape = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    if (field === 'name') return escape(entity.name);
    if (field === 'summary') return escape(entity.summary);
    if (field === 'kind') return escape(entity.kindLabel);
    if (field === 'role') return entity.role ? escape(entity.roleLabel) : '';
    if (field === 'aliases') return escape((entity.aliases || []).join(', '));
    return '';
  }

  function valueFor(field, entity) {
    if (field === 'aliases') return (entity.aliases || []).join(', ');
    return String(entity[field] == null ? '' : entity[field]);
  }

  function begin(el) {
    if (el.classList.contains('is-editing')) return;
    const field = el.getAttribute('data-inline-edit');
    const id = el.getAttribute('data-entity');
    const before = el.innerHTML;
    const optionsRaw = el.getAttribute('data-options');
    const options = optionsRaw ? JSON.parse(optionsRaw) : null;
    let input;
    if (options) {
      input = document.createElement('select');
      for (const [value, label] of options) input.appendChild(new Option(label, value, false, value === el.getAttribute('data-value')));
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = el.getAttribute('data-value') || '';
      input.placeholder = el.getAttribute('data-placeholder') || '';
      input.maxLength = field === 'summary' ? 240 : 400;
    }
    input.className = 'inline-input';
    input.setAttribute('aria-label', `Change the ${field === 'aliases' ? 'other names' : field}`);
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'btn tiny';
    keep.textContent = 'Keep';
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'btn ghost tiny';
    leave.textContent = 'Cancel';

    el.classList.add('is-editing');
    el.removeAttribute('role');
    el.innerHTML = '';
    el.append(input, ' ', keep, ' ', leave);
    input.focus();
    if (input instanceof HTMLInputElement) input.select();

    function finish(html) {
      el.classList.remove('is-editing');
      el.setAttribute('role', 'button');
      el.innerHTML = html || `<span class="inline-empty">${el.getAttribute('data-placeholder') || 'Add'}</span>`;
      el.focus();
    }

    async function save() {
      keep.disabled = true;
      try {
        const data = await send(`/bible/${id}/set`, { field, value: input.value });
        el.setAttribute('data-value', valueFor(field, data.entity));
        finish(shownFor(field, data.entity));
        if (field === 'name') document.title = document.title.replace(/^[^|·]*/, `${data.entity.name} `);
        const host = el.closest('.page-head, .name-card-body, .beside-pane-body') || el.parentElement;
        if (data.notice && host) flash(host, data.notice, false);
        else say('Saved.');
      } catch (err) {
        keep.disabled = false;
        flash(el.parentElement || el, err.message, true);
      }
    }

    keep.addEventListener('click', save);
    leave.addEventListener('click', () => finish(before));
    input.addEventListener('keydown', (/** @type {KeyboardEvent} */ ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); save(); }
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(before); }
    });
  }

  document.addEventListener('click', (ev) => {
    const target = /** @type {Element|null} */ (ev.target);
    const el = target && target.closest ? target.closest('[data-inline-edit]') : null;
    if (!el || el.classList.contains('is-editing')) return;
    ev.preventDefault();
    begin(el);
  });
  document.addEventListener('keydown', (ev) => {
    const target = /** @type {Element|null} */ (ev.target);
    if (!target || !target.matches || !target.matches('[data-inline-edit]:not(.is-editing)')) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); begin(target); }
  });

  // ---------- forms, sent in the background ----------

  // The chapter's links to an entry stop being links: after "not them in
  // this chapter", every one; after "that word is never them", the ones
  // spelled that way.
  function unlink(entityId, as) {
    const text = document.getElementById('chapter-text');
    if (!text) return;
    for (const a of Array.from(text.querySelectorAll(`a.cast-link[href="/bible/${entityId}"]`))) {
      if (as && a.textContent.trim().toLowerCase() !== as.toLowerCase()) continue;
      a.replaceWith(document.createTextNode(a.textContent));
    }
  }

  document.addEventListener('change', (ev) => {
    const target = /** @type {Element|null} */ (ev.target);
    const form = target && target.closest ? target.closest('form[data-autosubmit]') : null;
    if (form instanceof HTMLFormElement) form.requestSubmit();
  });

  document.addEventListener('submit', async (ev) => {
    const form = /** @type {HTMLFormElement} */ (ev.target);
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-inline-form')) return;
    // A confirm that was said no to has already stopped it.
    if (ev.defaultPrevented) return;
    ev.preventDefault();
    const payload = {};
    for (const [key, value] of new FormData(form)) payload[key] = value;
    const buttons = Array.from(form.querySelectorAll('button'));
    for (const b of buttons) b.disabled = true;
    try {
      const data = await send(form.getAttribute('action') || '', payload);
      const then = form.getAttribute('data-then') || 'say';
      if (then === 'reload') { window.location.reload(); return; }
      if (then === 'remove') {
        const row = form.closest('li');
        if (row) row.remove();
        say('Done.');
        return;
      }
      if (then === 'unlink') {
        unlink(form.getAttribute('data-unlink'), form.getAttribute('data-unlink-as') || '');
      }
      if (then === 'relation' && data.other) {
        const list = form.closest('.name-card-body, .beside-pane-body, body').querySelector('[data-card-relations]');
        if (list) {
          const li = document.createElement('li');
          const label = document.createElement('span');
          label.className = 'rel-label';
          label.textContent = data.label;
          const a = document.createElement('a');
          a.href = `/bible/${data.other.id}`;
          a.textContent = data.other.name;
          li.append(label, ' ', a);
          list.appendChild(li);
        }
        form.reset();
      }
      for (const b of buttons) b.disabled = false;
      flash(form.parentElement || form, data.said || 'Saved.', false);
    } catch (err) {
      for (const b of buttons) b.disabled = false;
      flash(form.parentElement || form, err.message, true);
    }
  });
}());
