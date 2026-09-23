// public/js/reading-place.js -- picking up where you stopped.
//
// While a chapter is read, the paragraph at the top of the screen is
// noted; when the page is left it is sent to the server (see
// POST /chapters/:id/place), so the place follows the reader between
// devices. Coming back, the page does not jump anywhere by itself -- that
// is disorienting -- but offers to: "You stopped at paragraph 14 of 30".
// Reaching the end clears it.
(function () {
  'use strict';
  const text = /** @type {HTMLElement|null} */ (document.getElementById('chapter-text'));
  if (!text || !text.dataset.chapterId) return;
  const chapterId = text.dataset.chapterId;
  const blocks = /** @type {HTMLElement[]} */ (Array.from(text.children));
  const total = blocks.length;
  if (total < 4) return;
  const meta = document.querySelector('meta[name="csrf-token"]');
  const token = meta ? meta.getAttribute('content') || '' : '';

  // ---- the offer -------------------------------------------------------
  const saved = Number(text.dataset.place || 0);
  if (saved > 1 && saved <= total && !location.hash) {
    const bar = document.createElement('div');
    bar.className = 'resume-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Where you stopped');
    const say = document.createElement('span');
    say.textContent = `You stopped at paragraph ${saved} of ${total}.`;
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn small';
    go.textContent = 'Go there';
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'linklike';
    no.textContent = 'Start from the top';
    bar.append(say, go, no);
    text.parentNode.insertBefore(bar, text);
    go.addEventListener('click', () => {
      const target = blocks[saved - 1];
      target.setAttribute('tabindex', '-1');
      target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      target.focus({ preventScroll: true });
      bar.remove();
    });
    no.addEventListener('click', () => { bar.remove(); text.focus(); });
  }

  // ---- noting it -------------------------------------------------------
  let current = 0;
  let sent = saved;
  function topmost() {
    // The first block whose bottom is below the top of the screen.
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].getBoundingClientRect().bottom > 80) return i + 1;
    }
    return total;
  }
  function atEnd() {
    return blocks[total - 1].getBoundingClientRect().top < window.innerHeight;
  }
  let pending = null;
  window.addEventListener('scroll', () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      current = atEnd() ? total : topmost();
    }, 250);
  }, { passive: true });

  function send(useBeacon) {
    if (!current || current === sent) return;
    const body = new URLSearchParams({ _csrf: token, paragraph: String(current), total: String(total) });
    const url = `/chapters/${chapterId}/place`;
    sent = current;
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body.toString()], { type: 'application/x-www-form-urlencoded' }));
      } else {
        fetch(url, { method: 'POST', body, credentials: 'same-origin', keepalive: true }).catch(() => { sent = 0; });
      }
    } catch (e) { sent = 0; }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(true); });
  window.addEventListener('pagehide', () => send(true));
  // And now and then while reading, for a phone that is simply put down.
  setInterval(() => send(false), 30000);
})();
