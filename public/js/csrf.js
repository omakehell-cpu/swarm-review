// public/js/csrf.js -- every script's POST carries the page's CSRF token.
//
// Forms already have it as a hidden field (lib/layout.js puts one in each).
// Scripts that post with fetch get it as a header, added here once rather
// than remembered in each of them. Only for this site's own addresses: the
// token is nobody else's business.
(function () {
  'use strict';
  const meta = document.querySelector('meta[name="csrf-token"]');
  const token = meta ? meta.getAttribute('content') : '';
  if (!token || !window.fetch) return;
  const original = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const opts = Object.assign({}, init || {});
    const method = String(opts.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (method !== 'GET' && method !== 'HEAD' && url.origin === location.origin) {
      const headers = new Headers(opts.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token);
      opts.headers = headers;
    }
    return original(input, opts);
  };
})();
