'use strict';

const { escapeHtml } = require('./util');
const docs = require('./docs');
const { lookFor } = require('./looks');
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
  ['draft-rescue', /class="[^"]*chapter-form/],
  ['md-serialize', /data-editor-tools/],
  ['editor-tools', /data-editor-tools/],
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
  const page = `<!DOCTYPE html>
<html lang="en"${lookFor(user) ? ` data-look="${lookFor(user)}"` : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · The Swarm Review</title>
<script src="/js/theme-init.js"></script>${user && user.csrf ? `
<meta name="csrf-token" content="${escapeHtml(user.csrf)}">
<script src="/js/csrf.js"></script>
<script src="/js/pwa.js" defer></script>` : ''}
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#111111">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="stylesheet" href="/css/style.css">
<link rel="stylesheet" href="/css/looks.css">
</head>
<body>
<a class="skip-link" href="${skip.href}">${escapeHtml(skip.label)}</a>
<header class="topbar">
  <a class="brand" href="/"><span class="brand-emblem" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="2.1" fill="currentColor"/><circle cx="12" cy="6.6" r="1.1" fill="currentColor"/><circle cx="16.7" cy="14.7" r="1.1" fill="currentColor"/><circle cx="7.3" cy="14.7" r="1.1" fill="currentColor"/></svg></span>The Swarm <span class="brand-mark">&#8212;</span> Review</a>
  <nav id="site-nav" aria-label="Site">
    ${user ? `
      <button id="nav-toggle" class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
      ${navLink('/', 'stories', 'Stories')}
      ${navLink('/stories/new', 'new-story', 'New story')}
      ${navLink('/tags', 'tags', 'Tags')}
      ${navLink('/glossary', 'glossary', 'Glossary')}
      ${navLink('/help', 'help', `Help${docs.hasUnreadReleases(user) ? '<span class="nav-dot" aria-hidden="true"></span><span class="sr-only">(something new)</span>' : ''}`)}
      ${user.is_admin ? navLink('/admin', 'admin', 'Admin') : ''}
      <form class="topbar-search" method="get" action="/search" role="search">
        <input type="search" name="q" placeholder="Search" aria-label="Search stories, chapters and the glossary">
      </form>
      <span class="topbar-account">
        ${navLink('/account', 'account', escapeHtml(user.display_name))}
        <form action="/logout" method="post" class="inline-form"><button class="linklike" type="submit">Log out</button></form>
      </span>
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
