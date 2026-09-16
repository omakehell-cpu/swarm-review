// Clicking the picture to say which part of it the thumbnail keeps.
//
// This is a convenience and nothing more: the two number fields underneath
// are the real control, they are what the form posts, and with JavaScript
// off they still work. All this does is let you point at the face instead
// of guessing at percentages, and show you the crop before you save it.
(function () {
  'use strict';

  /** @param {number} n */
  const clamp = (n) => Math.min(100, Math.max(0, Math.round(n)));

  for (const picker of Array.from(document.querySelectorAll('[data-focus-picker]'))) {
    const key = picker.getAttribute('data-focus-picker');
    const form = document.querySelector(`[data-focus-form="${key}"]`);
    if (!form) continue;
    const x = /** @type {HTMLInputElement|null} */ (form.querySelector('[data-focus-x]'));
    const y = /** @type {HTMLInputElement|null} */ (form.querySelector('[data-focus-y]'));
    const preview = /** @type {HTMLImageElement|null} */ (form.querySelector('[data-focus-preview]'));
    const pin = /** @type {HTMLElement|null} */ (picker.querySelector('.focus-pin'));
    if (!x || !y) continue;

    const show = () => {
      const px = clamp(Number(x.value));
      const py = clamp(Number(y.value));
      if (preview) preview.style.objectPosition = `${px}% ${py}%`;
      if (pin) { pin.style.left = `${px}%`; pin.style.top = `${py}%`; }
    };

    // The picture is a link to the full-size file, and stays one for
    // anybody using a keyboard. A click that is aimed at the crop is not
    // aimed at the link, so it does not follow it.
    picker.addEventListener('click', (event) => {
      const rect = picker.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      event.preventDefault();
      x.value = String(clamp(((/** @type {MouseEvent} */ (event).clientX - rect.left) / rect.width) * 100));
      y.value = String(clamp(((/** @type {MouseEvent} */ (event).clientY - rect.top) / rect.height) * 100));
      show();
    });

    x.addEventListener('input', show);
    y.addEventListener('input', show);
    picker.classList.add('is-pickable');
    show();
  }
}());
