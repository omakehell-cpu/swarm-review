'use strict';

const { escapeHtml } = require('./util');
const docs = require('./docs');
const { addTokenToForms } = require('./csrf');

// A page loads the scripts it actually has something for, and nothing
// else. The pairing is not a list kept somewhere that has to be updated
// when a view changes: each entry is the mark its script looks for, read
// out of the page that was just rendered. A page without the mark cannot
// have the behaviour, so there is nothing for the script to do on it.
//
// theme-init is in the <head> on every page on purpose -- it sets the
// theme before anything is painted -- and timestamps, theme-toggle and
// confirm-forms are on every page because their marks are.
/** @type {Array<[string, RegExp]>} */
const PAGE_SCRIPTS = [
  ['timestamps', /<time class="ts/],
  ['theme-toggle', /id="theme-toggle"/],
  ['confirm-forms', /data-confirm=/],
  ['reading', /class="reading-pane|data-mode=/],
  ['story-filter', /id="story-find"/],
  ['mention-complete', /id="mention-people"/],
  ['editor-notes', /class="editor-notes"/],
  ['reactions', /id="reactions-data"/],
  ['reading-place', /id="chapter-text"[^>]*data-chapter-id=/],
  ['margin-notes', /class="chapter-body-grid"/],
  ['comment-actions', /id="comment-list"/],
  ['name-card', /data-name-card\b/],
  ['glossary-margin', /class="glossary-body"/],
  ['glossary-filter', /class="[^"]*glossary-row/],
  ['image-shrink', /data-shrink/],
  ['image-focus', /data-focus-picker=/],
  // The quote matters: entity-form is the form itself, entity-form-row is
  // a pair of fields the chapter editor also uses.
  ['bible-form', /class="[^"]*entity-form"/],
  ['bible-quick', /data-quick-entry/],
  ['missing-names', /class="missing-names"/],
  // Changing an entry where it is shown: on its page, and in the card a
  // name opens beside a chapter, which arrives later and is handled then.
  ['bible-inline', /data-inline-edit=|data-inline-form|data-name-card\b/],
  ['draft-rescue', /class="[^"]*chapter-form/],
  ['editor-tools', /data-editor-tools/],
  ['writing-frame', /id="writer-form"/],
  ['tag-search', /class="tag-picker"/],
  ['import-batch', /data-import-batch/],
  ['writing-desk', /data-desk\b/],
  ['nav-toggle', /id="nav-toggle"/],
  ['copy-invite', /data-copy-invite/],
  ['outline', /id="outline"/],
  ['beside', /data-beside\b/],
  ['phone-editor', /data-fold-on-phone/],
];

function scriptsFor(html) {
  return PAGE_SCRIPTS
    .filter(([, mark]) => mark.test(html))
    .map(([name]) => `<script src="/js/${name}.js" defer></script>`)
    .join('\n');
}

// The mark: an open book whose pages are half-cells of the swarm's
// hexagon, with the spine in the one red. currentColor for the ink, so it
// follows light and dark.
const LOGO = '<svg viewBox="0 0 48 48" width="26" height="26"><path d="M24 12L10 6 4 10v26l6 4 14 6z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><path d="M24 12l14-6 6 4v26l-6 4-14 6z" fill="currentColor" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><path class="brand-spine" d="M24 12v34" stroke="#d8231a" stroke-width="2.6"/><path d="M9.5 16l9 3.5M9.5 22l9 3.5M9.5 28l9 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

/** The first letter of a name, for the round badge in the bar. */
const initialOf = (name) => (String(name || '?').trim().match(/\p{L}|\p{N}/u) || ['?'])[0].toUpperCase();

// `current` is the nav entry to mark as the page you're on -- 'stories',
// 'new-story', 'glossary', 'help', 'admin' or 'account'. Passing nothing just
// leaves every link in its resting state (fine for pages that don't
// belong to any one section, like a single chapter).
/** @param {LayoutOptions} options */
// `skip` is where the skip link at the very top of the page goes. Every
// page skips to its content; a chapter skips straight to its first line.
function layout({ title, user, body, flash, wide, current, skip = { href: '#content', label: 'Skip to content' } }) {
  const navLink = (href, key, label) =>
    `<a href="${href}"${current === key ? ' class="current" aria-current="page"' : ''}>${label}</a>`;
  const menuLink = (href, key, label) =>
    `<a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Swarm Review</title>
<script src="/js/theme-init.js"></script>${user && user.csrf ? `
<meta name="csrf-token" content="${escapeHtml(user.csrf)}">
<script src="/js/csrf.js"></script>
<script src="/js/pwa.js" defer></script>` : ''}
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#111111">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="stylesheet" href="/css/style.css">
</head>
<body>
<a class="skip-link" href="${skip.href}">${escapeHtml(skip.label)}</a>
<header class="topbar">
  <a class="brand" href="/"><span class="brand-logo" aria-hidden="true">${LOGO}</span><span class="brand-name">Swarm Review</span></a>
  <nav id="site-nav" aria-label="Site">
    ${user ? `
      <button id="nav-toggle" class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
      <span class="topbar-places">
        ${navLink('/', 'stories', 'Stories')}
        ${navLink('/glossary', 'glossary', 'Glossary')}
        ${navLink('/help', 'help', `Help${docs.hasUnreadReleases(user) ? '<span class="nav-dot" aria-hidden="true"></span><span class="sr-only">(something new)</span>' : ''}`)}
      </span>
      <form class="topbar-search" method="get" action="/search" role="search">
        <input type="search" name="q" placeholder="Search" aria-label="Search stories, chapters and the glossary">
      </form>
      <a class="btn small topbar-write${current === 'new-story' ? ' current' : ''}" href="/stories/new"${current === 'new-story' ? ' aria-current="page"' : ''}><span aria-hidden="true">+</span> Write</a>
      <details class="user-menu">
        <summary aria-label="${escapeHtml(user.display_name)}: your page, account and more">
          <span class="user-avatar" aria-hidden="true">${escapeHtml(initialOf(user.display_name))}</span>
          <span class="user-name">${escapeHtml(user.display_name)}</span>
        </summary>
        <div class="user-menu-panel">
          <div class="user-menu-who">
            <span class="user-avatar" aria-hidden="true">${escapeHtml(initialOf(user.display_name))}</span>
            <span><strong>${escapeHtml(user.display_name)}</strong><span class="user-menu-handle">@${escapeHtml(user.username)}</span></span>
          </div>
          <div class="user-menu-group">
            ${menuLink(`/users/${encodeURIComponent(user.username)}`, 'profile', 'Your page')}
            ${menuLink('/account', 'account', 'Account settings')}
          </div>
          <div class="user-menu-group">
            ${menuLink('/tags', 'tags', 'Tags')}
            ${user.is_admin ? menuLink('/admin', 'admin', 'Admin') : ''}
          </div>
          <form action="/logout" method="post" class="user-menu-out"><button class="linklike" type="submit">Log out</button></form>
        </div>
      </details>
    ` : ''}
    <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Toggle theme"></button>
  </nav>
</header>
${flash ? `<div class="flash ${flash.type || 'info'}">${escapeHtml(flash.message)}</div>` : ''}
<main id="content" tabindex="-1" class="container${wide ? ' container-wide' : ''}">
${body}
</main>`;

  // Against the whole page, not just the body: the theme toggle and the
  // timestamps live in the topbar this function writes itself.
  return addTokenToForms(`${page}
${scriptsFor(page)}
</body>
</html>`, user && user.csrf);
}

module.exports = { layout };
