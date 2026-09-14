// public/js/confirm-forms.js -- any <form data-confirm="message"> asks for
// confirmation before submitting (used for delete/retract/close-
// registration actions across the app). This used to be an inline
// onsubmit="return confirm(...)" attribute on each form, but the app's
// Content-Security-Policy (script-src 'self', no unsafe-inline/nonce)
// silently blocks inline event handlers -- meaning every one of those
// confirmations stopped actually running the moment that CSP shipped,
// with no visible error to the user (the submit just went through). One
// delegated listener here covers every such form instead, present now or
// added later, without needing an inline attribute at all.
(function () {
  'use strict';
  document.addEventListener('submit', function (ev) {
    const form = /** @type {Element} */ (ev.target);
    const message = form.getAttribute && form.getAttribute('data-confirm');
    if (message && !window.confirm(message)) ev.preventDefault();
  });
})();
