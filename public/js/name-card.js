// Clicking a name while you are reading.
//
// A chapter's text has this story's cast and the wiki's names linked in it
// already (lib/cast-links.js). Following one meant leaving the chapter,
// reading a page, and coming back to find your place -- for a name you
// wanted one line about.
//
// So the link opens the same page, in the column that is already beside
// the text, and the card's heading is the way on to the page itself. The
// link is never touched: with this file missing, with JavaScript off, on a
// phone, or if the fetch fails, clicking a name goes to the entry exactly
// as it did before. Nothing here is a second copy of anything -- the card
// asks the server for the page that already exists.
(function () {
  'use strict';

  const card = /** @type {HTMLElement|null} */ (document.querySelector('[data-name-card]'));
  const text = document.getElementById('chapter-text');
  if (!card || !text) return;
  const body = card.querySelector('[data-name-card-body]');
  const onwards = Array.prototype.slice.call(card.querySelectorAll('[data-name-card-link]'));
  const closeButton = card.querySelector('[data-name-card-close]');
  if (!body) return;

  // One column means there is nowhere to put a card: the reader gets the
  // page, which on a phone is the right answer anyway. Checked at the
  // moment of the click rather than at load, because a window gets
  // resized and a phone gets turned sideways.
  const twoColumns = () => window.matchMedia('(min-width: 900px)').matches;

  const announcer = document.createElement('div');
  announcer.className = 'sr-only';
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('role', 'status');
  document.body.appendChild(announcer);
  function say(message) {
    announcer.textContent = '';
    window.setTimeout(() => { announcer.textContent = message; }, 50);
  }

  // Where the reader was when they opened it, so Escape and Close put them
  // back on the word they clicked rather than at the top of the document.
  let opener = null;

  function shut(moveFocus) {
    card.hidden = true;
    body.innerHTML = '';
    if (moveFocus && opener && document.contains(opener)) opener.focus();
    opener = null;
  }

  /** `/bible/12` -> `/bible/12/beside`, `/glossary/Akarge` -> the same. */
  function fragmentUrl(href) {
    const path = href.split('#')[0].split('?')[0];
    if (/^\/bible\/\d+$/.test(path)) return path + '/beside';
    if (/^\/glossary\/[^/]+$/.test(path)) return path + '/beside';
    return null;
  }

  async function open(link) {
    const href = link.getAttribute('href') || '';
    const src = fragmentUrl(href);
    if (!src) return false;

    for (const a of onwards) a.setAttribute('href', href);
    body.innerHTML = '<p class="muted">Looking that up&hellip;</p>';
    card.hidden = false;
    opener = link;
    card.focus();

    let res;
    try {
      res = await fetch(src, { headers: { accept: 'text/html' } });
      if (!res.ok) throw new Error(String(res.status));
      body.innerHTML = await res.text();
    } catch (err) {
      // The link is still a link. Hand it back rather than leaving the
      // reader looking at "Looking that up" for ever.
      shut(true);
      window.location.href = href;
      return true;
    }

    // The fragment's own heading is the title of the thing; making it the
    // link onwards means the card says once what it is about, and saying
    // it is how you get there.
    const heading = body.querySelector('h3');
    let name = '';
    if (heading) {
      name = heading.textContent.trim();
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.textContent = name;
      heading.textContent = '';
      heading.appendChild(anchor);
    }
    body.scrollTop = 0;
    // Where it came from matters to somebody who cannot see which column
    // it landed in: this story's own bible is not the shared glossary.
    const where = href.indexOf('/bible/') === 0 ? 'from the bible' : 'from the glossary';
    say(name
      ? `${name}, ${where}, beside the chapter. Press Escape to go back to the text.`
      : 'Opened beside the chapter. Press Escape to go back to the text.');
    return true;
  }

  text.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== undefined && event.button !== 0) return;
    const target = /** @type {Element|null} */ (event.target);
    const link = target && target.closest ? target.closest('a.wiki-link') : null;
    if (!link || !text.contains(link)) return;
    if (!twoColumns()) return;
    if (!fragmentUrl(link.getAttribute('href') || '')) return;
    // Only now: everything above is a reason to let the browser do what it
    // was going to do.
    event.preventDefault();
    open(link);
  });

  if (closeButton) closeButton.addEventListener('click', () => shut(true));

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || card.hidden) return;
    // Only if the reader is in the card or still on the name that opened
    // it; Escape elsewhere on the page belongs to whatever is there.
    const active = document.activeElement;
    if (card.contains(active) || active === opener) shut(true);
  });
}());
