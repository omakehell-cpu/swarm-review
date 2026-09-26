// public/js/follow.js -- the star on a story, without leaving the page.
// The form works on its own (views/front.js followButton); this sends it
// in the background and turns the button over when the answer comes.
(function () {
  'use strict';
  for (const form of /** @type {HTMLFormElement[]} */ (Array.from(document.querySelectorAll('[data-follow-form]')))) {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const button = /** @type {HTMLButtonElement} */ (form.querySelector('button'));
      const field = /** @type {HTMLInputElement} */ (form.querySelector('input[name="follow"]'));
      button.disabled = true;
      try {
        const res = await fetch(form.action, {
          method: 'POST', body: new URLSearchParams({ follow: field.value }),
          headers: { Accept: 'application/json' }, credentials: 'same-origin',
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        const on = Boolean(data.following);
        field.value = on ? '0' : '1';
        button.classList.toggle('is-following', on);
        button.setAttribute('aria-pressed', String(on));
        const star = button.querySelector('.follow-star');
        const word = button.querySelector('.follow-word');
        if (star) star.textContent = on ? '★' : '☆';
        if (word) word.textContent = on ? 'Following' : 'Follow';
        button.title = on ? 'You follow this story: its new chapters are shown to you. Press to stop.' : 'Follow: be told when a new chapter goes up.';
        let n = /** @type {HTMLElement|null} */ (button.querySelector('.follow-n'));
        if (data.followers && !n) {
          n = document.createElement('span');
          n.className = 'btn-count follow-n';
          button.append(' ', n);
        }
        if (n) {
          n.textContent = String(data.followers || '');
          n.hidden = !data.followers;
        }
      } catch (err) {
        form.submit();
      } finally {
        button.disabled = false;
      }
    });
  }
}());
