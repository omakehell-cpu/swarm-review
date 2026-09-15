// Two small conveniences on the bible entry form. Both are conveniences:
// with JavaScript off the form still asks for the right fields and still
// has blank rows to type into.
(function () {
  'use strict';
  const form = document.querySelector('.entity-form');
  if (!form) return;

  // The template shown follows the "What is it" select. Hidden blocks have
  // their inputs disabled so a person who changes their mind does not post
  // the other kind's fields along with their own.
  const kindSelect = /** @type {HTMLSelectElement|null} */ (form.querySelector('select[name="kind"]'));
  const blocks = Array.from(form.querySelectorAll('.template-fields'));
  if (kindSelect && blocks.length) {
    kindSelect.addEventListener('change', () => {
      for (const block of blocks) {
        const mine = block.getAttribute('data-kind') === kindSelect.value;
        /** @type {HTMLElement} */ (block).hidden = !mine;
        for (const input of block.querySelectorAll('input')) {
          /** @type {HTMLInputElement} */ (input).disabled = !mine;
        }
      }
    });
  }

  const extras = document.getElementById('field-extras');
  const adder = form.querySelector('[data-add-field]');
  if (extras && adder) {
    adder.addEventListener('click', () => {
      const last = extras.lastElementChild;
      if (!last) return;
      const row = /** @type {HTMLElement} */ (last.cloneNode(true));
      for (const input of row.querySelectorAll('input')) {
        /** @type {HTMLInputElement} */ (input).value = '';
      }
      extras.appendChild(row);
      const first = /** @type {HTMLInputElement|null} */ (row.querySelector('input'));
      if (first) first.focus();
    });
  }
}());
