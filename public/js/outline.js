// Dragging a chapter into a different place, and saving a summary without
// leaving the table. Both are conveniences over forms that already work:
// with JavaScript off, the up and down buttons move a chapter and the
// Save button saves a summary, which is why they are in the markup rather
// than drawn from here.
(function () {
  'use strict';
  const body = document.querySelector('#outline tbody[data-reorder]');
  const endpoint = body && body.getAttribute('data-reorder');
  const status = /** @type {HTMLElement|null} */ (document.querySelector('[data-outline-status]'));

  function say(message, isError) {
    if (!status) return;
    status.textContent = message || '';
    status.hidden = !message;
    status.classList.toggle('error', !!isError);
  }

  async function post(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'That did not save.');
    return data;
  }

  if (body && endpoint) {
    let dragging = null;

    body.addEventListener('dragstart', (ev) => {
      const e = /** @type {DragEvent} */ (ev);
      const row = /** @type {HTMLElement} */ (e.target).closest('tr.outline-row');
      if (!row) return;
      dragging = row;
      row.classList.add('dragging');
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });

    body.addEventListener('dragover', (ev) => {
      const e = /** @type {DragEvent} */ (ev);
      if (!dragging) return;
      e.preventDefault();
      const over = /** @type {HTMLElement} */ (e.target).closest('tr.outline-row');
      if (!over || over === dragging) return;
      const box = over.getBoundingClientRect();
      const below = e.clientY > box.top + box.height / 2;
      body.insertBefore(dragging, below ? over.nextSibling : over);
    });

    body.addEventListener('dragend', async () => {
      if (!dragging) return;
      dragging.classList.remove('dragging');
      dragging = null;
      const order = Array.from(body.querySelectorAll('tr.outline-row'))
        .map((row) => Number(row.getAttribute('data-chapter')));
      say('Saving the order...', false);
      try {
        const saved = await post(endpoint, { order });
        // The numbers come back from the database rather than being
        // counted here, so what the page shows is what was actually
        // written.
        const byId = new Map(saved.order.map((c) => [c.id, c.number]));
        for (const row of body.querySelectorAll('tr.outline-row')) {
          const cell = row.querySelector('.outline-number');
          const number = byId.get(Number(row.getAttribute('data-chapter')));
          if (cell && number) cell.textContent = String(number);
        }
        say('Order saved.', false);
      } catch (err) {
        say(`${err.message} The page will show the real order if you reload.`, true);
      }
    });
  }

  // A summary saves when you leave the box, and the button stays for
  // anyone who would rather press it.
  for (const form of document.querySelectorAll('form.summary-form')) {
    const field = /** @type {HTMLTextAreaElement|null} */ (form.querySelector('textarea'));
    if (!field) continue;
    let original = field.value;
    const save = async () => {
      if (field.value === original) return;
      const wanted = field.value;
      try {
        await post(form.getAttribute('action') || '', { summary: wanted });
        original = wanted;
        say('Summary saved.', false);
      } catch (err) {
        say(err.message, true);
      }
    };
    field.addEventListener('blur', save);
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  }
}());
