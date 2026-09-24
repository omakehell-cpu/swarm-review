// public/js/writing-frame.js -- the frame round the three writing pages
// (new story, new chapter, edit a chapter): the column of tabs beside the
// text, the drawer that holds the chapter's details, and the sheet that
// asks what a publish needs to know.
//
// Every one of them is ordinary markup first (see views/writing.js): with
// no script the tabs are sections one under another, the drawer is a
// fold at the foot of the form, and the publish questions are the last
// part of it. This only rearranges what is already there.
(function () {
  'use strict';

  const form = /** @type {HTMLFormElement|null} */ (document.getElementById('writer-form'));
  if (!form) return;

  // ------------------------------------------------------------- the tabs
  const tablist = /** @type {HTMLElement|null} */ (document.querySelector('.side-tabs'));
  if (tablist) {
    const tabs = /** @type {HTMLButtonElement[]} */ (Array.from(tablist.querySelectorAll('[role="tab"]')));
    const panelOf = (tab) => document.getElementById(tab.getAttribute('aria-controls') || '');
    function choose(tab, focus) {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const panel = panelOf(t);
        if (panel) panel.hidden = !on;
      }
      if (focus) tab.focus();
      try { sessionStorage.setItem('writer-tab', tab.id); } catch (e) { /* no storage */ }
    }
    // The checks go above the text on a small screen, which leaves their
    // tab with nothing in it: the tab goes too, while it is empty.
    const checksTab = tabs.find((t) => t.id === 'tab-checks');
    const checksSlot = document.querySelector('[data-checks-slot]');
    function fitChecks() {
      if (!checksTab || !checksSlot) return;
      const empty = !checksSlot.children.length;
      checksTab.hidden = empty;
      if (empty && checksTab.getAttribute('aria-selected') === 'true') {
        const other = tabs.find((t) => !t.hidden);
        if (other) choose(other, false);
      }
    }
    if (tabs.length > 1 || tabs.length === 1) {
      tablist.hidden = tabs.length < 2;
      let first = tabs[0];
      try {
        const remembered = sessionStorage.getItem('writer-tab');
        const hit = tabs.find((t) => t.id === remembered);
        if (hit) first = hit;
      } catch (e) { /* no storage */ }
      choose(first, false);
      for (const t of tabs) t.addEventListener('click', () => choose(t, false));
      tablist.addEventListener('keydown', (ev) => {
        const visible = tabs.filter((t) => !t.hidden);
        const at = visible.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
        if (at < 0) return;
        let next = -1;
        if (ev.key === 'ArrowRight') next = (at + 1) % visible.length;
        if (ev.key === 'ArrowLeft') next = (at - 1 + visible.length) % visible.length;
        if (ev.key === 'Home') next = 0;
        if (ev.key === 'End') next = visible.length - 1;
        if (next < 0) return;
        ev.preventDefault();
        choose(visible[next], true);
      });
      if (checksSlot) {
        new MutationObserver(fitChecks).observe(checksSlot, { childList: true });
        fitChecks();
      }
    }
  }

  // ---------------------------------------------------------- the drawer
  const drawer = /** @type {HTMLDetailsElement|null} */ (document.querySelector('[data-details-drawer]'));
  const drawerOpen = /** @type {HTMLButtonElement|null} */ (document.querySelector('[data-details-open]'));
  const drawerClose = /** @type {HTMLButtonElement|null} */ (document.querySelector('[data-details-close]'));
  if (drawer && drawerOpen) {
    drawer.classList.add('is-drawer');
    drawer.open = false;
    drawerOpen.hidden = false;
    if (drawerClose) drawerClose.hidden = false;
    const sync = () => {
      drawerOpen.setAttribute('aria-expanded', String(drawer.open));
      document.body.classList.toggle('drawer-open', drawer.open);
    };
    drawer.addEventListener('toggle', () => {
      sync();
      if (drawer.open) {
        const field = drawer.querySelector('input, textarea, select');
        if (field) /** @type {HTMLElement} */ (field).focus();
      }
    });
    drawerOpen.addEventListener('click', () => { drawer.open = !drawer.open; });
    if (drawerClose) drawerClose.addEventListener('click', () => { drawer.open = false; drawerOpen.focus(); });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && drawer.open) { drawer.open = false; drawerOpen.focus(); }
    });
    // A field in the drawer the form finds wrong on the way out opens it.
    form.addEventListener('invalid', (ev) => {
      if (drawer.contains(/** @type {Node} */ (ev.target))) drawer.open = true;
    }, true);
  }

  // ------------------------------------------------------ the publish sheet
  const sheet = /** @type {HTMLElement|null} */ (document.querySelector('[data-publish-sheet]'));
  const opener = /** @type {HTMLButtonElement|null} */ (document.querySelector('[data-publish-open]'));
  if (sheet && opener) {
    const close = /** @type {HTMLButtonElement|null} */ (sheet.querySelector('[data-publish-close]'));
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.hidden = true;
    document.body.appendChild(backdrop);
    sheet.classList.add('is-sheet');
    sheet.hidden = true;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    if (close) close.hidden = false;

    const shut = () => {
      sheet.hidden = true;
      backdrop.hidden = true;
      document.body.classList.remove('sheet-open');
      opener.focus();
    };
    opener.addEventListener('click', (ev) => {
      ev.preventDefault();
      // The titles first: a sheet over a form that cannot be sent is a
      // trap. The browser says what is missing, where it is missing.
      for (const field of Array.from(form.querySelectorAll('input[required]'))) {
        if (!(/** @type {HTMLInputElement} */ (field)).checkValidity()) {
          /** @type {HTMLInputElement} */ (field).reportValidity();
          return;
        }
      }
      sheet.hidden = false;
      backdrop.hidden = false;
      document.body.classList.add('sheet-open');
      const first = sheet.querySelector('input:not([type="hidden"]):not([type="checkbox"]), textarea');
      /** @type {HTMLElement} */ (first || sheet.querySelector('[data-publish-confirm]')).focus();
    });
    if (close) close.addEventListener('click', shut);
    backdrop.addEventListener('click', shut);
    sheet.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.stopPropagation(); shut(); }
    });
  }
}());
