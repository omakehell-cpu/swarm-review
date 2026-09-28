// Clicking a name while you are reading.
//
// A chapter's text has this story's cast and the wiki's names linked in it
// already (lib/cast-links.js). Following one meant leaving the chapter,
// reading a page, and coming back to find your place -- for a name you
// wanted one line about.
//
// So the link opens the same page on a card that floats beside the text,
// and the card's heading is the way on to the page itself. The card sits
// over the page rather than in it: opening it moves nothing -- not the
// text, not the notes, not the place you were reading. The
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
  // Out of the notes column and onto the page itself, so that it is there
  // in Read (where that column is put away) and changes no layout at all.
  document.body.appendChild(card);
  const onwards = Array.prototype.slice.call(card.querySelectorAll('[data-name-card-link]'));
  const closeButton = card.querySelector('[data-name-card-close]');
  if (!body) return;

  // One column means there is no room beside the text: there the card
  // comes up from the bottom of the screen instead, over the lower part
  // of the page, and the chapter stays where it was. Checked at the
  // moment of the click rather than at load, because a window gets
  // resized and a phone gets turned sideways.
  const twoColumns = () => window.matchMedia('(min-width: 900px)').matches;
  const chapterId = text.getAttribute('data-chapter-id') || '';

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

  // Beside the text where there is room for it -- right of the column,
  // level with the top of the window -- and over the edge of it where
  // there is not.
  function place() {
    if (!twoColumns()) {
      card.classList.add('is-sheet');
      for (const prop of ['left', 'right', 'top', 'width', 'maxHeight']) card.style[prop] = '';
      return;
    }
    card.classList.remove('is-sheet');
    const box = text.getBoundingClientRect();
    const top = Math.max(16, Math.min(96, box.top));
    const room = window.innerWidth - box.right - 56;
    const width = Math.min(400, room);
    if (width >= 280) {
      card.style.left = `${Math.round(box.right + 32)}px`;
      card.style.right = '';
      card.style.width = `${Math.round(width)}px`;
    } else {
      card.style.left = '';
      card.style.right = '24px';
      card.style.width = `${Math.min(360, window.innerWidth - 48)}px`;
    }
    card.style.top = `${Math.round(top)}px`;
    card.style.maxHeight = `${Math.round(window.innerHeight - top - 24)}px`;
  }
  window.addEventListener('resize', () => { if (!card.hidden) place(); });

  function shut(moveFocus) {
    card.hidden = true;
    body.innerHTML = '';
    if (moveFocus && opener && document.contains(opener)) opener.focus();
    opener = null;
  }

  /**
   * `/bible/12` -> `/bible/12/beside`, `/glossary/Akarge` -> the same. A
   * bible entry is asked for as it stands in this chapter, and told the
   * word that was clicked, so the card can offer "that word is not them".
   */
  function fragmentUrl(href, word) {
    const path = href.split('#')[0].split('?')[0];
    if (/^\/bible\/\d+$/.test(path)) {
      const qs = new URLSearchParams();
      if (chapterId) qs.set('chapter', chapterId);
      if (word) qs.set('as', word);
      const tail = qs.toString();
      return `${path}/beside${tail ? `?${tail}` : ''}`;
    }
    if (/^\/glossary\/[^/]+$/.test(path)) return path + '/beside';
    return null;
  }

  async function open(link) {
    const href = link.getAttribute('href') || '';
    const src = fragmentUrl(href, (link.textContent || '').trim());
    if (!src) return false;

    for (const a of onwards) a.setAttribute('href', href);
    body.innerHTML = '<p class="muted">Looking that up&hellip;</p>';
    place();
    card.hidden = false;
    opener = link;
    // Focus without scrolling: the reader stays exactly where they were.
    card.focus({ preventScroll: true });

    let res;
    try {
      res = await fetch(src, { headers: { accept: 'text/html' } });
      if (!res.ok) throw new Error(String(res.status));
      body.innerHTML = await res.text();
    } catch (err) {
      // The link is still a link. Hand it back rather than leaving the
      // reader looking at "Looking that up" for ever.
      shut(false);
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
    card.scrollTop = 0;
    // Where it came from matters to somebody who cannot see which column
    // it landed in: this story's own bible is not the shared glossary.
    const where = href.indexOf('/bible/') === 0 ? 'from the story notes' : 'from the glossary';
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
    if (!fragmentUrl(link.getAttribute('href') || '', '')) return;
    // Only now: everything above is a reason to let the browser do what it
    // was going to do.
    event.preventDefault();
    open(link);
  });

  if (closeButton) closeButton.addEventListener('click', () => shut(true));

  // On a phone the sheet covers the bottom of the page; a tap on the text
  // above it puts it away, the way a sheet is expected to go.
  document.addEventListener('click', (event) => {
    if (card.hidden || !card.classList.contains('is-sheet')) return;
    const target = /** @type {Node|null} */ (event.target);
    if (target && !card.contains(target) && !(target instanceof Element && target.closest('a.wiki-link'))) shut(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || card.hidden) return;
    // Only if the reader is in the card or still on the name that opened
    // it; Escape elsewhere on the page belongs to whatever is there.
    const active = document.activeElement;
    if (card.contains(active) || active === opener) shut(true);
  });
}());
