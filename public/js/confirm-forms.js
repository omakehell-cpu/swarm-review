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
    // A form can have one button that needs asking about and others that
    // do not -- the editor's "Upload and publish" beside its Save. The
    // button that was pressed is the one whose message applies; only when
    // it has nothing to say does the form's own apply.
    const submitter = /** @type {Element|null} */ (/** @type {any} */ (ev).submitter);
    const fromButton = submitter && submitter.getAttribute
      ? submitter.getAttribute('data-confirm') : null;
    const message = fromButton || (form.getAttribute && form.getAttribute('data-confirm'));
    if (message && !window.confirm(message)) ev.preventDefault();
  });
})();
