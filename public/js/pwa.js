// public/js/pwa.js -- registers the service worker (public/sw.js), which
// makes the site installable and keeps recently read chapters for reading
// offline. Only where the browser allows it: a secure page.
(function () {
  'use strict';
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* the site works without it */ });
  });
})();
