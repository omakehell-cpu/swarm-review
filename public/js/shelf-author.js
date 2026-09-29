// public/js/shelf-author.js -- the author filter over the finished
// stories goes as soon as a name is picked. The form works on its own
// (views/front.js authorFilter); without this it has a Show button.
(function () {
  'use strict';
  for (const form of /** @type {HTMLFormElement[]} */ (Array.from(document.querySelectorAll('[data-shelf-author]')))) {
    const select = form.querySelector('select');
    if (!select) continue;
    form.classList.add('is-live');
    select.addEventListener('change', () => form.submit());
  }
}());
