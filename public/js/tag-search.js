// public/js/tag-search.js -- picking tags by typing.
//
// The picker is sixty-odd checkboxes in nine folds (views/shared.js
// tagPicker), which is what works with nothing switched on. Here it gets
// a box to type into: the tags chosen sit above it as chips, and the
// matching ones come up under it as you type, each one a click to add.
// The folds are still there, behind "Browse every tag", and every change
// goes through the same checkboxes, so the form sends exactly what it did.
(function () {
  'use strict';
  for (const picker of Array.from(document.querySelectorAll('.tag-picker'))) {
    const boxes = /** @type {HTMLInputElement[]} */ (Array.from(picker.querySelectorAll('input[type="checkbox"][name="tagIds"]')));
    if (!boxes.length) continue;
    const tags = boxes.map((box) => {
      const label = /** @type {HTMLElement} */ (box.closest('label'));
      const group = box.closest('details');
      const groupName = group ? (group.querySelector('.tag-group-name') || { textContent: '' }).textContent : '';
      return { box, label, name: (label.querySelector('span') || label).textContent.trim(), group: groupName.trim() };
    });
    const fold = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

    const head = document.createElement('div');
    head.className = 'tag-search';
    const chips = document.createElement('div');
    chips.className = 'tag-search-chosen';
    chips.setAttribute('aria-label', 'Tags chosen');
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'tag-search-input';
    input.placeholder = 'Type to find a tag';
    input.setAttribute('aria-label', 'Find a tag');
    input.autocomplete = 'off';
    const list = document.createElement('div');
    list.className = 'tag-search-results';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Matching tags');
    const browse = document.createElement('button');
    browse.type = 'button';
    browse.className = 'btn ghost tiny tag-search-browse';
    browse.textContent = 'Browse every tag';
    browse.setAttribute('aria-expanded', 'false');
    head.append(chips, input, list, browse);
    picker.insertBefore(head, picker.firstChild);
    picker.classList.add('is-searchable');

    const voice = document.createElement('div');
    voice.className = 'sr-only';
    voice.setAttribute('aria-live', 'polite');
    head.appendChild(voice);

    function drawChips() {
      chips.textContent = '';
      for (const t of tags.filter((x) => x.box.checked)) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tag-chip is-chosen';
        chip.textContent = `${t.name} ×`;
        chip.setAttribute('aria-label', `Take off ${t.name}`);
        chip.addEventListener('click', () => { set(t, false); input.focus(); });
        chips.appendChild(chip);
      }
    }
    function set(t, on) {
      t.box.checked = on;
      t.label.classList.toggle('checked', on);
      drawChips();
      drawResults();
      voice.textContent = `${t.name} ${on ? 'added' : 'taken off'}.`;
    }
    function drawResults() {
      const needle = fold(input.value.trim());
      list.textContent = '';
      if (!needle) return;
      const hits = tags.filter((t) => !t.box.checked && (fold(t.name).includes(needle) || fold(t.group).includes(needle))).slice(0, 12);
      if (!hits.length) {
        const none = document.createElement('p');
        none.className = 'hint';
        none.textContent = 'No tag like that. Propose it below.';
        list.appendChild(none);
        return;
      }
      for (const t of hits) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tag-chip';
        b.innerHTML = '';
        b.append(t.name);
        if (t.group) {
          const g = document.createElement('span');
          g.className = 'tag-chip-count';
          g.textContent = t.group;
          b.appendChild(g);
        }
        b.addEventListener('click', () => { set(t, true); input.value = ''; drawResults(); input.focus(); });
        list.appendChild(b);
      }
    }
    input.addEventListener('input', drawResults);
    input.addEventListener('keydown', (ev) => {
      // Enter takes the first match rather than sending the whole form.
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const first = /** @type {HTMLButtonElement|null} */ (list.querySelector('button'));
      if (first) first.click();
    });
    browse.addEventListener('click', () => {
      const open = picker.classList.toggle('show-groups');
      browse.setAttribute('aria-expanded', String(open));
    });
    for (const t of tags) t.box.addEventListener('change', () => { t.label.classList.toggle('checked', t.box.checked); drawChips(); });
    drawChips();
  }
}());
