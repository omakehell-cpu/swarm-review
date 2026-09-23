// public/js/mention-complete.js -- "@" in a note offers the people there
// are to name. Type @ and a few letters of a name or a username; the
// matches appear under the box. Up and down to choose, Enter or Tab to
// take one, Escape to carry on typing. It writes @username, the one name
// that never changes, which is what makes it land in their inbox.
(function () {
  'use strict';
  const data = document.getElementById('mention-people');
  if (!data) return;
  let people = [];
  try { people = JSON.parse(data.textContent || '[]'); } catch (e) { return; }
  if (!people.length) return;

  const list = document.createElement('ul');
  list.className = 'mention-list';
  list.id = 'mention-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  document.body.appendChild(list);
  let field = null;
  let matches = [];
  let active = 0;
  let start = -1;

  function close() {
    list.hidden = true;
    matches = [];
    if (field) { field.removeAttribute('aria-activedescendant'); field.setAttribute('aria-expanded', 'false'); }
  }
  function show() {
    list.innerHTML = '';
    matches.forEach((p, i) => {
      const li = document.createElement('li');
      li.id = `mention-opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      li.textContent = `${p.n} `;
      const u = document.createElement('span');
      u.className = 'muted';
      u.textContent = `@${p.u}`;
      li.appendChild(u);
      li.addEventListener('mousedown', (ev) => { ev.preventDefault(); active = i; take(); });
      list.appendChild(li);
    });
    const rect = field.getBoundingClientRect();
    list.style.top = `${window.scrollY + rect.bottom + 2}px`;
    list.style.left = `${window.scrollX + rect.left}px`;
    list.hidden = false;
    field.setAttribute('aria-expanded', 'true');
    field.setAttribute('aria-activedescendant', `mention-opt-${active}`);
  }
  function take() {
    const p = matches[active];
    if (!p || !field) return;
    const caret = field.selectionStart || 0;
    const before = field.value.slice(0, start);
    const after = field.value.slice(caret);
    field.value = `${before}@${p.u} ${after}`;
    const at = before.length + p.u.length + 2;
    field.setSelectionRange(at, at);
    close();
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function update(el) {
    field = el;
    const caret = el.selectionStart || 0;
    const m = /(^|[\s(])@([\p{L}\p{N}_-]{0,30})$/u.exec(el.value.slice(0, caret));
    if (!m) { close(); return; }
    start = caret - m[2].length - 1;
    const q = m[2].toLowerCase();
    matches = people.filter((p) => p.u.toLowerCase().startsWith(q)
      || p.n.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))).slice(0, 6);
    active = 0;
    if (matches.length) show(); else close();
  }
  const isNoteField = (el) => el instanceof HTMLElement && el.matches('textarea[name="body"], input[name="body"]')
    && Boolean(el.closest('.comments-pane, .new-comment-box, .general-comment, .reply-box, .note-sheet'));

  document.addEventListener('input', (ev) => {
    const el = /** @type {HTMLInputElement|HTMLTextAreaElement} */ (ev.target);
    if (!isNoteField(el)) return;
    el.setAttribute('aria-autocomplete', 'list');
    el.setAttribute('aria-controls', 'mention-list');
    update(el);
  });
  document.addEventListener('keydown', (ev) => {
    if (list.hidden || ev.target !== field) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      active = (active + (ev.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length;
      show();
    } else if (ev.key === 'Enter' || ev.key === 'Tab') {
      ev.preventDefault();
      take();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  }, true);
  document.addEventListener('focusout', (ev) => { if (ev.target === field) setTimeout(close, 150); });
})();
