'use strict';

const { HIT_OPEN, HIT_CLOSE } = require('../lib/search-query');
const { layout } = require('../lib/layout');
const { escapeHtml } = require('../lib/util');
const { timeHtml } = require('../lib/time');
const { entityKindLabel } = require('./bible');
const { emptyState, hiddenTagsSection, writingBlock } = require('./shared');
// A window of text around the first occurrence, with the term marked.
// Works on plain text, so anything HTML (a glossary body) has to be
// flattened before it gets here.
// The index marks its own hits. It wrapped them in two control
// characters -- see lib/search-query.js -- which cannot occur in anybody's
// prose, so the whole snippet is escaped as text first and only then do
// exactly those two become markup. A chapter cannot smuggle a tag through
// this.
function searchSnippet(snippet) {
  const text = String(snippet || '');
  if (!text) return '';
  return escapeHtml(text)
    .split(HIT_OPEN).join('<mark class="search-hit">')
    .split(HIT_CLOSE).join('</mark>');
}

// The title, with the hit marked if that is where it was.
const searchTitle = (row, fallback) => (row.titleSnippet ? searchSnippet(row.titleSnippet) : escapeHtml(fallback));

function searchPage({ user, results, query }) {
  const box = `
    <form method="get" action="/search" class="search-page-form">
      <input type="search" name="q" value="${escapeHtml(query || '')}" placeholder="Search stories, chapters and the glossary" autofocus>
      <button class="btn" type="submit">Search</button>
      <a class="btn ghost" href="/find${query ? `?q=${encodeURIComponent(query)}` : ''}">Advanced search</a>
    </form>`;

  if (!results) {
    return layout({
      title: 'Search',
      user,
      current: 'search',
      body: `
        <div class="page-head"><h1>Search</h1></div>
        ${box}
        <p class="muted">${query ? 'Give it at least two characters.' : 'Looks through story titles and blurbs, chapter titles and summaries, the current text of every chapter, and the glossary.'}</p>`,
    });
  }

  const total = results.stories.length + results.chapters.length + results.passages.length
    + results.glossary.length + (results.bible ? results.bible.length : 0);

  const section = (title, items, render) => (items.length ? `
    <section class="search-group">
      <h2>${title} <span class="search-count">${items.length}</span></h2>
      <div class="search-results">${items.map(render).join('')}</div>
    </section>` : '');

  const body = total === 0
    ? emptyState({
      art: 'glass',
      title: `Nothing matches \u201c${results.query}\u201d`,
      body: 'Archived stories and chapters are not searched, and only each chapter\'s current version is \u2014 so a phrase that was edited out will not be found.',
      action: '<a class="btn ghost small" href="/">Back to the stories</a>',
    })
    : [
      section('Stories', results.stories, (s) => `
        <a class="search-result" href="/stories/${s.id}">
          <span class="search-result-title">${searchTitle(s, s.title)}</span>
          <span class="search-result-where">by ${escapeHtml(s.author_name)}</span>
          ${s.snippet ? `<span class="search-result-snippet">${searchSnippet(s.snippet)}</span>` : ''}
        </a>`),
      section('Chapters', results.chapters, (c) => `
        <a class="search-result" href="/chapters/${c.id}">
          <span class="search-result-title">Chapter ${c.chapter_number}: ${searchTitle(c, c.title)}</span>
          <span class="search-result-where">${escapeHtml(c.story_title)}</span>
          ${c.snippet ? `<span class="search-result-snippet">${searchSnippet(c.snippet)}</span>` : ''}
        </a>`),
      section('In the text', results.passages, (p) => `
        <a class="search-result" href="/chapters/${p.id}">
          <span class="search-result-title">${escapeHtml(p.story_title)} &middot; Chapter ${p.chapter_number}: ${escapeHtml(p.title)}</span>
          <span class="search-result-snippet prose">${searchSnippet(p.snippet)}</span>
        </a>`),
      section('Story notes', results.bible || [], (e) => `
        <a class="search-result" href="/bible/${e.id}">
          <span class="search-result-title">${searchTitle(e, e.name)} <span class="muted">&middot; ${escapeHtml(e.story_title)}</span></span>
          <span class="search-result-snippet">${escapeHtml(entityKindLabel(e.kind))}${e.alias_list ? ` &middot; also ${escapeHtml(e.alias_list)}` : ''}${e.snippet ? ` &mdash; ${searchSnippet(e.snippet)}` : ''}</span>
        </a>`),
      section('Glossary', results.glossary, (g) => `
        <a class="search-result" href="/glossary/${encodeURIComponent(g.title)}">
          <span class="search-result-title">${searchTitle(g, g.title)}</span>
          <span class="search-result-snippet">${g.snippet ? searchSnippet(g.snippet) : escapeHtml(g.summary || '')}</span>
        </a>`),
    ].join('');

  return layout({
    title: `Search: ${results.query}`,
    user,
    current: 'search',
    body: `
      <div class="page-head"><h1>Search</h1></div>
      ${box}
      <p class="muted search-summary">${total} result${total === 1 ? '' : 's'} for &ldquo;${escapeHtml(results.query)}&rdquo;.</p>
      ${body}`,
  });
}


// ---------- the log, in words ----------

// One sentence per kind, with the subject the event was written with
// dropped into it. Anything not listed falls back to its own kind with
// the dashes taken out, so a new kind recorded in server.js shows up as
// something readable on the day it is added rather than as nothing.
const EVENT_SENTENCES = {
  joined: () => 'joined the Swarm',
  'signed-in': () => 'signed in',
  'password-changed': () => 'changed their password',
  'login-name-changed': () => 'changed the name they sign in with',
  'name-changed': (s) => `changed their name to ${s}`,
  'story-started': (s) => `started ${s}`,
  'story-edited': (s) => `edited the details of ${s}`,
  'story-archived': (s) => `archived ${s}`,
  'story-restored': (s) => `took ${s} out of the archive`,
  'story-deleted': (s) => `deleted ${s} for good`,
  'coauthor-added': (s) => `added ${s}`,
  'coauthor-removed': (s) => `removed ${s}`,
  'coauthor-left': (s) => `stepped back from ${s}`,
  'chapter-added': (s) => `added ${s}`,
  'chapter-revised': (s) => `saved a new version of ${s}`,
  'chapter-edited': (s) => `edited the details of ${s}`,
  'chapter-archived': (s) => `archived ${s}`,
  'chapter-restored': (s) => `took ${s} out of the archive`,
  'chapter-deleted': (s) => `deleted ${s} for good`,
  'chapter-moved': (s) => `moved ${s} in the running order`,
  'chapter-read': (s) => `read ${s}`,
  downloaded: (s) => `downloaded ${s}`,
  'comment-added': (s) => `commented on ${s}`,
  'comment-replied': (s) => `replied on ${s}`,
  'comment-accepted': (s) => `accepted a note on ${s}`,
  'comment-rejected': (s) => `turned down a note on ${s}`,
  'comment-edited': () => 'edited a comment',
  'comment-retracted': () => 'retracted a comment',
  'comment-reopened': (s) => `reopened a note on ${s}`,
  'backup-taken': (s) => `took a backup (${s})`,
  'bible-closed': (s) => `made the story notes of ${s} private`,
  'bible-opened': (s) => `opened the story notes of ${s} to readers`,
  'bible-entry-added': (s) => `added ${s} to the story notes`,
  'bible-image-added': (s) => `added a picture to ${s}`,
  'bible-entry-edited': (s) => `rewrote ${s} in the story notes`,
  'bible-entry-deleted': (s) => `took ${s} out of the story notes`,
  'word-added': (s) => `taught the dictionary ${s}`,
  'word-removed': (s) => `took a word out of the dictionary of ${s}`,
  'invite-made': () => 'generated an invite code',
  'registration-closed': () => 'closed registration',
  'password-set-for': (s) => `set a new password for ${s}`,
  'account-locked': (s) => `locked ${s}`,
  'account-unlocked': (s) => `reactivated ${s}`,
  'reset-link-made': (s) => `made a password reset link for ${s}`,
  'backup-downloaded': () => 'downloaded a backup of everything',
  'wiki-synced': (s) => `synced the wiki (${s})`,
  'tag-created': (s) => `added the tag ${s}`,
  'tag-edited': (s) => `edited the tag ${s}`,
  'tag-approved': (s) => `approved the tag ${s}`,
  'tag-merged': (s) => `merged a tag into ${s}`,
  'tag-deleted': (s) => `deleted the tag ${s}`,
  'arc-started': (s) => `began an arc, ${s}`,
  'arc-removed': (s) => `took out the arc ${s}`,
  'stage-changed': (s) => `moved ${s}`,
  'status-changed': (s) => `moved ${s}`,
};

function eventLine(ev) {
  const subject = ev.subject
    ? (ev.href
      ? `<a href="${escapeHtml(ev.href)}">${escapeHtml(ev.subject)}</a>`
      : `<strong>${escapeHtml(ev.subject)}</strong>`)
    : '';
  const sentence = EVENT_SENTENCES[ev.kind]
    ? EVENT_SENTENCES[ev.kind](subject)
    : `${escapeHtml(ev.kind).replace(/-/g, ' ')}${subject ? ` ${subject}` : ''}`;
  return `<li class="log-line"><span class="log-when">${timeHtml(ev.created_at)}</span> <span class="log-what">${sentence}</span></li>`;
}

function eventLog(events) {
  if (!events.length) return '<p class="muted">Nothing recorded yet.</p>';
  return `<ol class="log-list">${events.map(eventLine).join('')}</ol>`;
}

// ---------- account settings ----------


// Being told that something is waiting, without this app ever reaching
// out to the network itself. The URL is the whole credential, so the page
// says so plainly rather than presenting it as a harmless link.
function feedBlock(user, origin) {
  if (!user.feed_token) {
    return `
      <p class="muted">Nothing is sent from here. A feed sits still until your reader comes and asks for it, which is why this is a feed and not an email.</p>
      <form method="post" action="/account/feed/new">
        <button class="btn" type="submit">Make me a feed link</button>
      </form>`;
  }
  const url = `${origin}/feed/${user.feed_token}.atom`;
  return `
    <p class="muted">Paste this into whatever you read feeds in. It updates when a note is waiting on one of your chapters, when somebody replies to a note of yours, and when a chapter you have not opened appears.</p>
    <p class="feed-url"><input type="text" class="feed-url-input" value="${escapeHtml(url)}" readonly aria-label="Your feed address" data-copy-target></p>
    <p class="hint"><strong>Anyone with this address can read it</strong>, without logging in. It is yours alone -- do not paste it anywhere public, and if it gets out, make a new one below.</p>
    <div class="figure-actions">
      <form method="post" action="/account/feed/new" class="inline-form" data-confirm="Make a new feed link? The old one stops working, and you will have to update your reader.">
        <button class="btn ghost small" type="submit">Make a new link</button>
      </form>
      <form method="post" action="/account/feed/off" class="inline-form" data-confirm="Turn the feed off? The link stops working straight away.">
        <button class="btn ghost small danger" type="submit">Turn it off</button>
      </form>
    </div>`;
}


/** @param {{ user: Row, error?: string|null, errorIn?: 'password'|'login-name', notice?: string|null, groups?: any[], hiddenTagIds?: number[], streak?: any, origin?: string }} props */
function accountPage({ user, error, errorIn = 'password', notice, groups = [], hiddenTagIds = [], streak = null, origin = '' }) {
  return layout({
    title: 'Account',
    user,
    current: 'account',
    flash: notice ? { type: 'info', message: notice } : null,
    body: `
      <div class="account-page">
      <h1>Account</h1>
      <div class="auth-card">
        <h2>Your name</h2>
        <p class="muted">The name on everything you write and every note you leave. Your handle, <strong>@${escapeHtml(user.username)}</strong>, is a different thing and does not change: it is the address of your page and what a note means when it says &ldquo;@${escapeHtml(user.username)}&rdquo;.</p>
        <form method="post" action="/account/name">
          <label>Name people see<input type="text" name="displayName" value="${escapeHtml(user.display_name)}" required maxlength="60"></label>
          <button class="btn" type="submit">Save name</button>
        </form>
        <p class="muted"><a href="/users/${escapeHtml(user.username)}">See your page as the group sees it &rarr;</a></p>
      </div>
      <div class="auth-card" id="reading">
        <h2>Reading chapters</h2>
        <form method="post" action="/account/reading" class="reading-form">
          <label class="check-line"><input type="checkbox" name="readFirst" value="1"${user.read_first ? ' checked' : ''}>
            <span>Open every chapter in Read mode <span class="muted">&mdash; just the story; switch to Review when you want the notes</span></span></label>
          <label class="check-line"><input type="checkbox" name="plainNames" value="1"${user.plain_names ? ' checked' : ''}>
            <span>No links in the prose <span class="muted">&mdash; names from the story notes and the glossary read as plain words, not as links</span></span></label>
          <button class="btn" type="submit">Save</button>
        </form>
      </div>
      <div class="auth-card">
        <h2>Writing</h2>
        <p class="muted">A number to aim at on the days you write. It is yours alone: nobody else sees it, and nothing nags you about it.</p>
        ${writingBlock(streak, { own: true })}
        <form method="post" action="/account/goal">
          <label>Words a day<input type="number" name="dailyGoal" value="${user.daily_goal || ''}" min="0" step="50" placeholder="e.g. 500"></label>
          <button class="btn" type="submit">Save goal</button>
        </form>
        <p class="muted">Leave it empty and the count just says which days you wrote.</p>
      </div>
      <div class="auth-card">
        <h2>Being told there is something waiting</h2>
        ${feedBlock(user, origin)}
      </div>
      <div class="auth-card" id="sign-in">
        <h2>The name you sign in with</h2>
        <p class="muted">Only yours: it is what you type into the login box and nothing else. Changing it leaves your page, your handle and every note that ever named you exactly where they are.</p>
        ${error && errorIn === 'login-name' ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/account/sign-in-name">
          <label>Sign-in name<input type="text" name="loginName" value="${escapeHtml(user.login_name || user.username)}" required minlength="3" maxlength="30" pattern="[A-Za-z0-9_-]+" autocomplete="username"></label>
          <label>Your password<input type="password" name="currentPassword" required autocomplete="current-password"></label>
          <button class="btn" type="submit">Change sign-in name</button>
        </form>
        <p class="muted">3 to 30 characters: letters, numbers, <code>_</code> and <code>-</code>. You stay signed in here; it is the next login that wants the new one.</p>
      </div>
      <div class="auth-card">
        <h2>Change password</h2>
        ${error && errorIn === 'password' ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/account/password">
          <label>Current password<input type="password" name="currentPassword" required></label>
          <label>New password<input type="password" name="newPassword" required minlength="8"></label>
          <label>Confirm new password<input type="password" name="confirmPassword" required minlength="8"></label>
          <button class="btn" type="submit">Change password</button>
        </form>
        <p class="muted">Changing your password signs you out of any other device or browser where you're currently logged in.</p>
      </div>
      ${hiddenTagsSection(groups, hiddenTagIds)}      </div>
    `,
  });
}

// ---------- admin panel ----------

module.exports = {
  EVENT_SENTENCES,
  accountPage,
  eventLine,
  eventLog,
  feedBlock,
  searchPage,
  searchSnippet,
};
