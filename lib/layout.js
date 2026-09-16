'use strict';

const { escapeHtml } = require('./util');
const docs = require('./docs');

// `current` is the nav entry to mark as the page you're on -- 'stories',
// 'new-story', 'glossary', 'help', 'admin' or 'account'. Passing nothing just
// leaves every link in its resting state (fine for pages that don't
// belong to any one section, like a single chapter).
/** @param {LayoutOptions} options */
function layout({ title, user, body, flash, wide, current }) {
  const navLink = (href, key, label) =>
    `<a href="${href}"${current === key ? ' class="current" aria-current="page"' : ''}>${label}</a>`;
  return `<!DOCTYPE html>
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
  <nav>
    ${user ? `
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
</main>
<script src="/js/timestamps.js"></script>
<script src="/js/theme-toggle.js" defer></script>
<script src="/js/confirm-forms.js" defer></script>
<script src="/js/reading.js" defer></script>
<script src="/js/margin-notes.js" defer></script>
<script src="/js/glossary-margin.js" defer></script>
    <script src="/js/glossary-filter.js" defer></script>
    <script src="/js/image-shrink.js" defer></script>
    <script src="/js/bible-form.js" defer></script>
    <script src="/js/bible-quick.js" defer></script>
    <script src="/js/draft-rescue.js" defer></script>
    <script src="/js/outline.js" defer></script>
</body>
</html>`;
}

module.exports = { layout };
