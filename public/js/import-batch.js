// public/js/import-batch.js -- importing a shelf of stories at once.
//
// The form (views/import.js) sends one file, which is how a .zip works
// with no script. Here every chosen file goes on its own, two at a time,
// so three hundred EPUBs are three hundred small requests rather than one
// enormous one that a proxy would refuse -- and each line of the list
// says what happened to its file as soon as it has.
(function () {
  'use strict';
  const form = /** @type {HTMLFormElement|null} */ (document.querySelector('[data-import-batch]'));
  if (!form) return;
  const input = /** @type {HTMLInputElement} */ (form.querySelector('input[type="file"]'));
  const panel = /** @type {HTMLElement} */ (document.querySelector('[data-batch-progress]'));
  const summary = /** @type {HTMLElement} */ (document.querySelector('[data-batch-summary]'));
  const bar = /** @type {HTMLProgressElement} */ (document.querySelector('[data-batch-bar]'));
  const list = /** @type {HTMLElement} */ (document.querySelector('[data-batch-list]'));
  const SAID = { imported: 'Imported', duplicate: 'Already here', error: 'Could not be read' };
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function row(r) {
    const li = document.createElement('li');
    li.className = `batch-row is-${r.status}`;
    const link = r.storyId ? `<a href="/stories/${r.storyId}">${esc(r.title || r.file)}</a>` : esc(r.file);
    const detail = r.status === 'imported'
      ? `by ${esc(r.author)} · ${r.chapters} chapter${r.chapters === 1 ? '' : 's'}${r.proposed && r.proposed.length ? ` · proposed: ${esc(r.proposed.join(', '))}` : ''}`
      : esc(r.message || (r.status === 'duplicate' ? 'skipped' : ''));
    li.innerHTML = `<span class="batch-status">${esc(SAID[r.status] || r.status)}</span> ${link} <span class="muted">${detail}</span>`;
    return li;
  }

  form.addEventListener('submit', async (ev) => {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    ev.preventDefault();
    const tags = String(new FormData(form).get('tags') || 'propose');
    const button = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
    button.disabled = true;
    input.disabled = true;
    panel.hidden = false;
    list.textContent = '';
    const counts = { imported: 0, duplicate: 0, error: 0 };
    let done = 0;
    bar.max = files.length;
    bar.value = 0;
    const say = (finished) => {
      summary.textContent = `${finished ? 'Done. ' : `${done} of ${files.length} files… `}`
        + `${counts.imported} imported, ${counts.duplicate} already here, ${counts.error} could not be read.`;
    };
    say(false);

    let next = 0;
    async function worker() {
      while (next < files.length) {
        const file = files[next];
        next += 1;
        const body = new FormData();
        body.append('tags', tags);
        body.append('file', file);
        let results;
        try {
          const res = await fetch(form.action, { method: 'POST', body, headers: { Accept: 'application/json' }, credentials: 'same-origin' });
          const data = await res.json().catch(() => null);
          results = data && data.results ? data.results : [{ file: file.name, status: 'error', message: res.ok ? 'No answer.' : `The server said ${res.status}.` }];
        } catch (err) {
          results = [{ file: file.name, status: 'error', message: 'The connection dropped.' }];
        }
        for (const r of results) {
          counts[r.status] = (counts[r.status] || 0) + 1;
          list.appendChild(row(r));
        }
        done += 1;
        bar.value = done;
        say(false);
      }
    }
    await Promise.all([worker(), worker()]);
    say(true);
    const more = document.createElement('p');
    more.innerHTML = '<a href="/?shelf=all&amp;origin=imported">See them all on the front page &rarr;</a>'
      + (tags === 'propose' ? ' &middot; <a href="/admin#tag-queue">Tags waiting for approval &rarr;</a>' : '');
    panel.appendChild(more);
    button.disabled = false;
    input.disabled = false;
    input.value = '';
  });
}());
