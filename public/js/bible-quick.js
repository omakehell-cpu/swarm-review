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
        say(made.already ? `${made.name} was already in the story notes.` : `${made.name} is in the story notes.`, false);
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
          li.setAttribute('data-name', candidate.name);
          const label = document.createElement('span');
          label.className = 'missing-name';
          label.textContent = `${candidate.name} (${candidate.count}×)`;
          // A new entry of some kind, or another name for somebody already
          // written down -- the server's guess at who, chosen to begin with.
          const kind = document.createElement('select');
          kind.setAttribute('aria-label', `What ${candidate.name} is`);
          const fresh = document.createElement('optgroup');
          fresh.label = 'A new entry';
          const kinds = quick ? Array.from(quick.querySelectorAll('select[name="kind"] option')) : [];
          for (const o of kinds) fresh.appendChild(o.cloneNode(true));
          if (!kinds.length) fresh.appendChild(new Option('Person', 'person'));
          kind.appendChild(fresh);
          if (found.entries && found.entries.length) {
            const same = document.createElement('optgroup');
            same.label = 'Another name for';
            for (const e of found.entries) same.appendChild(new Option(e.name, `alias:${e.id}`, false, e.id === candidate.sameAs));
            kind.appendChild(same);
          }
          if (candidate.inGlossary) {
            const tag = document.createElement('span');
            tag.className = 'missing-tag';
            tag.textContent = 'in the glossary';
            label.appendChild(document.createTextNode(' '));
            label.appendChild(tag);
          }
          // One line, for a new entry; another name for somebody has theirs.
          const summary = document.createElement('input');
          summary.type = 'text';
          summary.className = 'missing-summary';
          summary.maxLength = 240;
          summary.placeholder = 'One line (optional)';
          summary.setAttribute('aria-label', `One line about ${candidate.name} (optional)`);
          const fit = () => { summary.hidden = /^alias:/.test(kind.value); };
          kind.addEventListener('change', fit);
          fit();
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn ghost tiny';
          button.textContent = 'Add';
          button.addEventListener('click', async () => {
            button.disabled = true;
            try {
              const made = await post(`/stories/${storyId}/bible/quick`, { name: candidate.name, kind: kind.value, summary: summary.hidden ? '' : summary.value });
              li.classList.add('added');
              button.textContent = made.alias ? `Added to ${made.name}` : 'Added';
              // Its parts are found as it now: "Kessler" is Mara Kessler.
              if (kind.value === 'person') {
                const parts = new Set(candidate.name.split(/\s+/).filter((w) => w.length > 2).map((w) => w.toLowerCase()));
                for (const other of Array.from(ul.querySelectorAll('li:not(.added)'))) {
                  const who = other.getAttribute('data-name') || '';
                  if (parts.has(who.toLowerCase())) other.remove();
                }
              }
            } catch (err) {
              button.disabled = false;
              say(err.message, true);
            }
          });
          // A false alarm, put away for the whole story.
          const dismiss = document.createElement('button');
          dismiss.type = 'button';
          dismiss.className = 'btn ghost tiny missing-dismiss';
          dismiss.textContent = 'Not a name';
          dismiss.setAttribute('aria-label', `${candidate.name} is not a name`);
          dismiss.addEventListener('click', async () => {
            dismiss.disabled = true;
            try {
              await post(`/stories/${storyId}/bible/not-names`, { name: candidate.name });
              li.remove();
              say(`${candidate.name} will not be offered again. Bring it back from the story notes' list of words that are not names.`, false);
            } catch (err) {
              dismiss.disabled = false;
              say(err.message, true);
            }
          });
          li.appendChild(label);
          li.appendChild(kind);
          li.appendChild(summary);
          li.appendChild(button);
          li.appendChild(dismiss);
          ul.appendChild(li);
        }
        list.appendChild(ul);
      } catch (err) {
        list.textContent = err.message;
      }
    });
  }
}());
