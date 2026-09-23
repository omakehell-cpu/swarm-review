// public/js/writing-desk.js -- the drawer beside the chapter editor.
//
// Two things a writer keeps next to a draft and never wants a reader to
// see: what each scene is for, and copies of the text from before the
// rewrite they are about to regret.
//
//  * Scenes: the chapter split where its scene breaks are, each with its
//    opening words and its length, a click away -- and a note of the
//    author's own against each one, kept on the server, private to them.
//  * Snapshots: the text in the editor, kept under a name, whenever the
//    author asks. Each can be compared with the chapter as it stands, put
//    back into the editor, or thrown away. A snapshot is not a version:
//    nobody else ever sees it and it never touches the notes.
(function () {
  'use strict';

  const dataEl = document.getElementById('desk-data');
  if (!dataEl) return;
  const desk = JSON.parse(dataEl.textContent || '{}');
  const chapterId = desk.chapterId;
  const notes = new Map((desk.notes || []).map((n) => [n.position, n.body]));
  let snapshots = desk.snapshots || [];

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const post = (url, fields) => fetch(url, { method: 'POST', credentials: 'same-origin', body: new URLSearchParams(fields) })
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });

  // A scene break is a line that is nothing but three or more -, * or _
  // (spaces allowed), exactly what lib/markdown.js turns into a rule.
  const BREAK = /^ {0,3}([-*_])(?: *\1){2,} *$/;
  function scenes(text) {
    const out = [];
    let start = 0;
    let offset = 0;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (BREAK.test(line)) {
        out.push({ start, end: offset });
        start = offset + line.length + 1;
      }
      offset += line.length + (i < lines.length - 1 ? 1 : 0);
    });
    out.push({ start, end: text.length });
    return out.map((s, i) => {
      const body = text.slice(s.start, s.end);
      const plain = body.replace(/[*_~`#>[\]]/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
      const words = (plain.match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu) || []).length;
      return { index: i, offset: s.start, words, opening: plain.slice(0, 90) };
    });
  }

  // ------------------------------------------------------------- the drawer

  const drawer = document.createElement('aside');
  drawer.className = 'desk-drawer';
  drawer.hidden = true;
  drawer.setAttribute('aria-label', 'Writing desk');
  drawer.innerHTML = `
    <div class="desk-head">
      <div class="desk-tabs" role="group" aria-label="Show">
        <button type="button" data-tab="scenes" aria-pressed="true">Scenes</button>
        <button type="button" data-tab="snapshots" aria-pressed="false">Snapshots</button>
      </div>
      <button type="button" class="btn ghost tiny desk-close">Close</button>
    </div>
    <div class="desk-panel" data-panel="scenes">
      <p class="desk-hint">Split where the chapter has a scene break. The notes are yours alone.</p>
      <ol class="desk-scenes"></ol>
    </div>
    <div class="desk-panel" data-panel="snapshots" hidden>
      <form class="desk-snap-form">
        <label class="sr-only" for="desk-snap-name">Name for this snapshot</label>
        <input type="text" id="desk-snap-name" maxlength="120" placeholder="Before the big cut">
        <button class="btn small" type="submit">Keep a snapshot</button>
      </form>
      <p class="desk-hint">A copy of the text in the editor right now. Only you see it; it is not a version.</p>
      <ul class="desk-snaps"></ul>
    </div>`;
  document.body.appendChild(drawer);
  const scenesList = drawer.querySelector('.desk-scenes');
  const snapsList = drawer.querySelector('.desk-snaps');

  // Opening moves the keyboard into the drawer, and closing puts it back
  // on whatever opened it: a panel that appears somewhere the focus is
  // not is a panel a screen reader user never finds.
  let returnTo = null;
  function open(tab) {
    returnTo = /** @type {HTMLElement|null} */ (document.activeElement);
    drawer.hidden = false;
    document.body.classList.add('desk-open');
    selectTab(tab || 'scenes');
    renderScenes();
    renderSnapshots();
    /** @type {HTMLElement} */ (drawer.querySelector('[data-tab][aria-pressed="true"]')).focus();
  }
  function close() {
    drawer.hidden = true;
    document.body.classList.remove('desk-open');
    if (returnTo && document.contains(returnTo)) returnTo.focus();
  }
  function selectTab(tab) {
    for (const b of Array.from(drawer.querySelectorAll('[data-tab]'))) b.setAttribute('aria-pressed', String(b.getAttribute('data-tab') === tab));
    for (const p of Array.from(drawer.querySelectorAll('[data-panel]'))) /** @type {HTMLElement} */ (p).hidden = p.getAttribute('data-panel') !== tab;
  }
  drawer.querySelector('.desk-tabs').addEventListener('click', (ev) => {
    const b = /** @type {Element} */ (ev.target).closest('[data-tab]');
    if (b) selectTab(b.getAttribute('data-tab'));
  });
  drawer.querySelector('.desk-close').addEventListener('click', close);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !drawer.hidden) close(); });

  // ----------------------------------------------------------------- scenes

  const noteTimers = new Map();
  function renderScenes() {
    const editor = /** @type {any} */ (window).swarmEditor;
    if (!editor) return;
    const list = scenes(editor.getText());
    scenesList.innerHTML = list.map((s) => `
      <li class="desk-scene">
        <button type="button" class="desk-scene-go" data-index="${s.index}" data-offset="${s.offset}">
          <span class="desk-scene-num">${s.index + 1}</span>
          <span class="desk-scene-open">${esc(s.opening || '(empty)')}</span>
          <span class="desk-scene-words">${s.words} words</span>
        </button>
        <label class="sr-only" for="scene-note-${s.index + 1}">Your note on scene ${s.index + 1}</label>
        <textarea id="scene-note-${s.index + 1}" class="desk-scene-note" data-position="${s.index + 1}" rows="2" placeholder="What this scene is for">${esc(notes.get(s.index + 1) || '')}</textarea>
      </li>`).join('');
  }
  scenesList.addEventListener('click', (ev) => {
    const go = /** @type {HTMLElement|null} */ (/** @type {Element} */ (ev.target).closest('.desk-scene-go'));
    if (!go) return;
    /** @type {any} */ (window).swarmEditor.goToScene(Number(go.dataset.index), Number(go.dataset.offset));
    if (window.matchMedia('(max-width: 720px)').matches) close();
  });
  scenesList.addEventListener('input', (ev) => {
    const note = /** @type {HTMLTextAreaElement} */ (ev.target);
    if (!note.classList.contains('desk-scene-note')) return;
    const position = Number(note.dataset.position);
    clearTimeout(noteTimers.get(position));
    noteTimers.set(position, setTimeout(async () => {
      try {
        await post(`/chapters/${chapterId}/scene-notes`, { position: String(position), body: note.value });
        notes.set(position, note.value);
        note.classList.add('saved');
        setTimeout(() => note.classList.remove('saved'), 900);
      } catch (e) { note.classList.add('unsaved'); }
    }, 700));
  });

  // -------------------------------------------------------------- snapshots

  const when = (at) => {
    const d = new Date(`${String(at).replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? at : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  };
  function renderSnapshots() {
    snapsList.innerHTML = snapshots.length ? snapshots.map((s) => `
      <li class="desk-snap">
        <span class="desk-snap-name">${esc(s.name)}</span>
        <span class="desk-snap-meta">${esc(when(s.at))} &middot; ${s.words} words</span>
        <span class="desk-snap-actions">
          <a href="/snapshots/${s.id}/compare" target="_blank" rel="noopener noreferrer">Compare</a>
          <button type="button" class="linklike" data-restore="${s.id}">Put back in the editor</button>
          <button type="button" class="linklike" data-delete="${s.id}">Delete</button>
        </span>
      </li>`).join('') : '<li class="desk-empty">None yet.</li>';
  }
  drawer.querySelector('.desk-snap-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = /** @type {HTMLInputElement} */ (drawer.querySelector('#desk-snap-name'));
    const editor = /** @type {any} */ (window).swarmEditor;
    try {
      const res = await post(`/chapters/${chapterId}/snapshots`, { name: input.value || 'Snapshot', content: editor.getText() });
      snapshots = res.snapshots;
      input.value = '';
      renderSnapshots();
    } catch (e) { /* nothing kept; the list says so by not changing */ }
  });
  snapsList.addEventListener('click', async (ev) => {
    const el = /** @type {HTMLElement} */ (ev.target);
    const restore = el.getAttribute('data-restore');
    const del = el.getAttribute('data-delete');
    if (restore) {
      if (!window.confirm('Replace the text in the editor with this snapshot? Nothing is published until you press Publish, and the text you have now is kept as a snapshot first.')) return;
      const editor = /** @type {any} */ (window).swarmEditor;
      const res = await post(`/chapters/${chapterId}/snapshots`, { name: 'Before putting a snapshot back', content: editor.getText() });
      snapshots = res.snapshots;
      const snap = await fetch(`/snapshots/${restore}.json`, { credentials: 'same-origin' }).then((r) => r.json());
      await editor.setText(snap.content);
      renderSnapshots();
      renderScenes();
    } else if (del) {
      if (!window.confirm('Delete this snapshot?')) return;
      const res = await post(`/snapshots/${del}/delete`, {});
      snapshots = res.snapshots;
      renderSnapshots();
    }
  });

  // --------------------------------------------------------------- the door

  function addButton() {
    const editor = /** @type {any} */ (window).swarmEditor;
    if (!editor || !editor.bar || editor.bar.querySelector('.tool-desk')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'editor-tool tool-desk tool-secondary';
    b.textContent = 'Scenes & snapshots';
    b.title = 'The scenes of this chapter, your notes on them, and snapshots of the text';
    b.addEventListener('mousedown', (ev) => ev.preventDefault());
    b.addEventListener('click', () => (drawer.hidden ? open() : close()));
    const focus = editor.bar.querySelector('.tool-typewriter');
    editor.bar.insertBefore(b, focus);
    let t = null;
    document.querySelector('textarea[data-editor-tools]').addEventListener('input', () => {
      if (drawer.hidden) return;
      clearTimeout(t);
      t = setTimeout(() => {
        // Re-list the scenes, but never under somebody's typing in a note.
        if (!drawer.contains(document.activeElement)) renderScenes();
      }, 600);
    });
  }
  if (/** @type {any} */ (window).swarmEditor) addButton();
  else document.addEventListener('swarm-editor-ready', addButton);
}());
