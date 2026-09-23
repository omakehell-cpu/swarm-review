// public/js/copy-invite.js -- the "Copy the invite" buttons on the admin
// page. Puts a ready-to-send message on the clipboard: a link that fills
// in the code by itself, the code again in case the link gets mangled,
// and for an invite made for one person, the username it only works with.
// The buttons are hidden in the HTML and shown here, so nobody without
// scripts sees a button that does nothing.
(function () {
  'use strict';

  const buttons = /** @type {HTMLButtonElement[]} */ (Array.from(document.querySelectorAll('[data-copy-invite]')));
  if (!buttons.length) return;

  // One polite live region, so a screen reader hears that it worked.
  const say = document.createElement('div');
  say.className = 'sr-only';
  say.setAttribute('role', 'status');
  document.body.appendChild(say);

  function message(code, username) {
    const link = new URL('/register', location.origin);
    link.searchParams.set('code', code);
    if (username) link.searchParams.set('username', username);
    const lines = [
      "You're invited to The Swarm Review, our writing group's site.",
      '',
      `Sign up here: ${link.href}`,
      `Invite code: ${code}`,
    ];
    if (username) lines.push(`Username: ${username} (the code only works with this name)`);
    lines.push('', 'The code works once, so keep it to yourself.');
    return lines.join('\n');
  }

  // The clipboard API needs a secure page; a plain-http copy of the site on
  // the local network is not one, so the old way is kept as a fallback.
  async function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('copy refused');
  }

  for (const button of buttons) {
    button.hidden = false;
    const label = button.textContent;
    button.addEventListener('click', async () => {
      const text = message(button.dataset.code || '', button.dataset.username || '');
      try {
        await copy(text);
        button.textContent = 'Copied';
        say.textContent = 'Invite copied. Paste it into a message.';
      } catch (err) {
        // Nothing reached the clipboard: show the text so it can be copied by hand.
        window.prompt('Copy this and send it:', text);
        return;
      }
      window.setTimeout(() => { button.textContent = label; say.textContent = ''; }, 2500);
    });
  }
})();
