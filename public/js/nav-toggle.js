// public/js/nav-toggle.js -- the top bar on a phone.
//
// Seven links, a search box and an account in a bar four hundred pixels
// wide wrapped into three rows and took a third of the screen before the
// page began -- on the editor, that third came out of the text you were
// writing. On a narrow screen they fold behind one "Menu" button. The
// fold only exists when this script does (see the html.js rule in
// style.css), so with scripts off the bar is simply all there, as before.
(function () {
  'use strict';
  const button = document.getElementById('nav-toggle');
  const bar = button && button.closest('.topbar');
  if (!button || !bar) return;
  const set = (open) => {
    bar.classList.toggle('nav-open', open);
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.textContent = open ? 'Close' : 'Menu';
  };
  button.addEventListener('click', () => set(!bar.classList.contains('nav-open')));
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && bar.classList.contains('nav-open')) { set(false); button.focus(); }
  });
}());
