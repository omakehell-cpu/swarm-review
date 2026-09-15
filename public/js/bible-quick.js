// The bible panel in the chapter editor: write somebody down without
// leaving the chapter, and ask what names the draft uses that the bible
// has never heard of.
//
// Both talk only to this app's own server. The name test lives there, not
// here, so there is one implementation of what counts as a name.
(function () {
  'use strict';
  const panel = document.getElementById('editor-bible');
  if (!panel) return;
  const storyId = panel.getAttribute('data-story-id');
  const result = /** @type {HTMLElement|null} */ (panel.querySelector('[data-quick-result]'));

  function say(message, isError) {
    if (!result) return;
    result.textContent = message;
    result.hidden = !message;
    result.classList.toggle('error', !!isError);
  }

  async function post(path, payload) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'That did not work.');
    return data;
  }

  const quick = panel.querySelector('[data-quick-entry]');
  if (quick) {
    quick.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fields = new FormData(/** @type {HTMLFormElement} */ (quick));
      const name = String(fields.get('name') || '').trim();
      if (!name) return;
      say('Saving...', false);
      try {
        const made = await post(`/stories/${storyId}/bible/quick`, {
          name, kind: fields.get('kind'), summary: fields.get('summary'),
        });
        say(made.already ? `${made.name} was already in the bible.` : `${made.name} is in the bible.`, false);
        /** @type {HTMLFormElement} */ (quick).reset();
      } catch (err) {
        say(err.message, true);
      }
    });
  }

  const scan = panel.querySelector('[data-scan-names]');
  const list = panel.querySelector('[data-missing-list]');
  if (scan && list) {
    scan.addEventListener('click', async () => {
      const text = /** @type {HTMLTextAreaElement|null} */ (document.querySelector('textarea[name="content"]'));
      if (!text) return;
      list.textContent = 'Reading the draft...';
      try {
        const found = await post(`/stories/${storyId}/bible/unknown-names`, { text: text.value });
        if (!found.names.length) { list.textContent = 'Every name in this draft is already written down.'; return; }
        list.textContent = '';
        const ul = document.createElement('ul');
        ul.className = 'missing-list';
        for (const candidate of found.names) {
          const li = document.createElement('li');
          const label = document.createElement('span');
          label.className = 'missing-name';
          label.textContent = `${candidate.name} (${candidate.count}×)`;
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn ghost tiny';
          button.textContent = 'Add';
          button.addEventListener('click', async () => {
            button.disabled = true;
            try {
              await post(`/stories/${storyId}/bible/quick`, { name: candidate.name, kind: 'person' });
              li.classList.add('added');
              button.textContent = 'Added';
            } catch (err) {
              button.disabled = false;
              say(err.message, true);
            }
          });
          li.appendChild(label);
          li.appendChild(button);
          ul.appendChild(li);
        }
        list.appendChild(ul);
      } catch (err) {
        list.textContent = err.message;
      }
    });
  }
}());
