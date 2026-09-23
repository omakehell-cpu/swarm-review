// public/js/missing-names.js -- the list of names a chapter uses that the
// bible does not know, answered where it stands.
//
// Each row is an ordinary form: Add (as a new entry, or as another name
// for somebody) and Not a name both work with JavaScript off, by posting
// and coming back to the chapter. That round trip reloaded the page and
// dropped the reader at the top of it, a long way from the list. Here the
// same request is sent in the background and the row says what happened;
// the page stays where it is.
(function () {
  'use strict';

  const section = document.querySelector('.missing-names');
  if (!section) return;
  const heading = section.querySelector('.side-head');

  const voice = document.createElement('div');
  voice.className = 'sr-only';
  voice.setAttribute('aria-live', 'polite');
  voice.setAttribute('role', 'status');
  section.appendChild(voice);

  function left() {
    const n = section.querySelectorAll('.missing-list li:not(.done)').length;
    if (!heading) return;
    heading.textContent = n
      ? `${n} name${n === 1 ? '' : 's'} here ${n === 1 ? 'is' : 'are'} not in the bible`
      : 'Every name here is accounted for';
  }

  section.addEventListener('submit', async (ev) => {
    const form = /** @type {HTMLFormElement} */ (ev.target);
    if (!(form instanceof HTMLFormElement)) return;
    const submitter = /** @type {HTMLButtonElement|null} */ (/** @type {any} */ (ev).submitter || null);
    const action = (submitter && submitter.getAttribute('formaction')) || form.getAttribute('action');
    if (!action) return;
    ev.preventDefault();

    const row = /** @type {HTMLElement|null} */ (form.closest('li'));
    // Read the form before anything in it is disabled: a disabled select
    // is left out of what the form sends.
    const fields = new URLSearchParams(/** @type {any} */ (new FormData(form)));
    const buttons = Array.from(form.querySelectorAll('button, select'));
    for (const b of buttons) /** @type {HTMLButtonElement} */ (b).disabled = true;
    const name = String(fields.get('name') || '');
    const kind = /** @type {HTMLSelectElement|null} */ (form.querySelector('select[name="kind"]'));
    const chosen = kind && kind.selectedOptions[0] ? kind.selectedOptions[0].textContent : '';

    try {
      const res = await fetch(action, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: fields,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'That did not work.');

      let said;
      if (/\/not-names$/.test(action)) said = `${name}: not a name. Put away for the whole story.`;
      else if (data.alias) said = `${name} is now another name for ${data.name}.`;
      else if (data.already) said = `${data.name} was already in the bible.`;
      else said = `${name} is in the bible, as ${String(chosen || 'an entry').toLowerCase()}.`;

      if (row) {
        row.classList.add('done');
        form.hidden = true;
        const note = document.createElement('p');
        note.className = 'missing-done';
        if (data.id && !/\/not-names$/.test(action)) {
          note.append(`${said} `);
          const a = document.createElement('a');
          a.href = `/bible/${data.id}`;
          a.textContent = 'Open the entry';
          note.appendChild(a);
        } else {
          note.textContent = said;
        }
        row.appendChild(note);
      }
      voice.textContent = '';
      window.setTimeout(() => { voice.textContent = said; }, 40);
      left();
    } catch (err) {
      for (const b of buttons) /** @type {HTMLButtonElement} */ (b).disabled = false;
      voice.textContent = '';
      window.setTimeout(() => { voice.textContent = err.message; }, 40);
    }
  });
}());
