'use strict';

const { escapeHtml } = require('./util');
const docs = require('./docs');

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
  ['editor-tools', /data-editor-tools/],
  ['nav-toggle', /id="nav-toggle"/],
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
function layout({ title, user, body, flash, wide, current }) {
  const navLink = (href, key, label) =>
    `<a href="${href}"${current === key ? ' class="current" aria-current="page"' : ''}>${label}</a>`;
  const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · The Swarm Review</title>
<script src="/js/theme-init.js"></script>
<link rel="stylesheet" href="/css/style.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">The Swarm <span class="brand-mark">&#8212;</span> Review</a>
  <nav id="site-nav">
    ${user ? `
      <button id="nav-toggle" class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
      ${navLink('/', 'stories', 'Stories')}
      ${navLink('/stories/new', 'new-story', 'New story')}
      ${navLink('/tags', 'tags', 'Tags')}
      ${navLink('/glossary', 'glossary', 'Glossary')}
      ${navLink('/help', 'help', `Help${docs.hasUnreadReleases(user) ? '<span class="nav-dot" aria-label="Something new"></span>' : ''}`)}
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
<main class="container${wide ? ' container-wide' : ''}">
${body}
</main>`;

  // Against the whole page, not just the body: the theme toggle and the
  // timestamps live in the topbar this function writes itself.
  return `${page}
${scriptsFor(page)}
</body>
</html>`;
}

module.exports = { layout };
