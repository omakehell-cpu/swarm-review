'use strict';

const { escapeHtml } = require('./util');

function layout({ title, user, body, flash, wide }) {
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
  <a class="brand" href="/">The Swarm · Review</a>
  <nav>
    ${user ? `
      <a href="/">Stories</a>
      <a href="/stories/new">New story</a>
      ${user.is_admin ? '<a href="/admin">Admin</a>' : ''}
      <a href="/account">Account</a>
      <span class="whoami">${escapeHtml(user.display_name)}</span>
      <form action="/logout" method="post" class="inline-form"><button class="linklike" type="submit">Log out</button></form>
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
</body>
</html>`;
}

module.exports = { layout };
