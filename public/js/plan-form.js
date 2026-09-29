// public/js/plan-form.js -- two small conveniences on the plan's arc forms.
// With no script the forms still work: every field is simply shown.
(function () {
  'use strict';

  // "Ends at" means something only for an arc inside another (a top-level
  // arc runs until the next one starts), so it is shown only then.
  for (const form of Array.from(document.querySelectorAll('form.plan-form'))) {
    const parent = /** @type {HTMLSelectElement|null} */ (form.querySelector('select[name="parentId"]'));
    const end = /** @type {HTMLElement|null} */ (form.querySelector('[data-arc-end]'));
    if (!parent || !end) continue;
    const sync = () => { end.hidden = !parent.value; };
    parent.addEventListener('change', sync);
    sync();
  }

  // "Add an arc inside it", on a long arc: the add form, already set to go
  // inside that one.
  for (const link of Array.from(document.querySelectorAll('[data-arc-inside]'))) {
    link.addEventListener('click', (event) => {
      const form = document.querySelector('form.plan-form[action$="/plan/arcs"]');
      if (!form) return;
      const parent = /** @type {HTMLSelectElement|null} */ (form.querySelector('select[name="parentId"]'));
      if (!parent) return;
      event.preventDefault();
      parent.value = link.getAttribute('data-arc-inside') || '';
      parent.dispatchEvent(new Event('change'));
      const title = /** @type {HTMLInputElement|null} */ (form.querySelector('input[name="title"]'));
      form.scrollIntoView({ block: 'start' });
      if (title) title.focus();
    });
  }
})();
