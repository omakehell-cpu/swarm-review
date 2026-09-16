// Writing a chapter on a phone.
//
// Everything the editor asks for besides the title and the text is
// already inside a <details> that is open by default, which is what a
// screen with room for it should show. This closes those on a screen
// without room, so the page is the thing you are writing plus a way to
// save it, and the rest is one line away.
//
// It runs once, on load. Somebody who opens a section and then turns
// their phone sideways keeps it open, because they asked for it.
(function () {
  'use strict';
  const narrow = window.matchMedia('(max-width: 720px)');
  if (!narrow.matches) return;
  for (const el of Array.from(document.querySelectorAll('[data-fold-on-phone]'))) {
    /** @type {HTMLDetailsElement} */ (el).open = false;
  }
}());
