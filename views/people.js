'use strict';

const { layout } = require('../lib/layout');
const { escapeHtml } = require('../lib/util');
const { timeHtml } = require('../lib/time');
const { entityKindLabel } = require('./bible');
const { emptyState, hiddenTagsSection, wordCount, writingBlock } = require('./shared');
// A window of text around the first occurrence, with the term marked.
// Works on plain text, so anything HTML (a glossary body) has to be
// flattened before it gets here.
function searchSnippet(text, query, { radius = 110 } = {}) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const at = source.toLowerCase().indexOf(query.toLowerCase());
  if (at === -1) return escapeHtml(source.slice(0, radius * 2)) + (source.length > radius * 2 ? '&hellip;' : '');
  const from = Math.max(0, at - radius);
  const to = Math.min(source.length, at + query.length + radius);
  // Don't cut a word in half at either end.
  const start = from === 0 ? 0 : source.indexOf(' ', from) + 1;
  const end = to === source.length ? source.length : source.lastIndexOf(' ', to);
  const before = source.slice(start, at);
  const match = source.slice(at, at + query.length);
  const after = source.slice(at + query.length, end);
  return `${start > 0 ? '&hellip;' : ''}${escapeHtml(before)}<mark class="search-hit">${escapeHtml(match)}</mark>${escapeHtml(after)}${end < source.length ? '&hellip;' : ''}`;
}

const stripTags = (html) => String(html || '').replace(/<[^>]*>/g, ' ');

function searchPage({ user, results, query }) {
  const box = `
    <form method="get" action="/search" class="search-page-form">
      <input type="search" name="q" value="${escapeHtml(query || '')}" placeholder="Search stories, chapters and the glossary" autofocus>
      <button class="btn" type="submit">Search</button>
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
          <span class="search-result-title">${searchSnippet(s.title, results.query, { radius: 60 })}</span>
          <span class="search-result-where">by ${escapeHtml(s.author_name)}</span>
          ${s.description ? `<span class="search-result-snippet">${searchSnippet(s.description, results.query)}</span>` : ''}
        </a>`),
      section('Chapters', results.chapters, (c) => `
        <a class="search-result" href="/chapters/${c.id}">
          <span class="search-result-title">${searchSnippet(`Chapter ${c.chapter_number}: ${c.title}`, results.query, { radius: 60 })}</span>
          <span class="search-result-where">${escapeHtml(c.story_title)}</span>
          ${c.summary ? `<span class="search-result-snippet">${searchSnippet(c.summary, results.query)}</span>` : ''}
        </a>`),
      section('In the text', results.passages, (p) => `
        <a class="search-result" href="/chapters/${p.id}">
          <span class="search-result-title">${escapeHtml(p.story_title)} &middot; Chapter ${p.chapter_number}: ${escapeHtml(p.title)}</span>
          <span class="search-result-snippet prose">${searchSnippet(p.content, results.query)}</span>
        </a>`),
      section('Bibles', results.bible || [], (e) => `
        <a class="search-result" href="/bible/${e.id}">
          <span class="search-result-title">${searchSnippet(e.name, results.query, { radius: 60 })} <span class="muted">&middot; ${escapeHtml(e.story_title)}</span></span>
          <span class="search-result-snippet">${escapeHtml(entityKindLabel(e.kind))}${e.alias_list ? ` &middot; also ${escapeHtml(e.alias_list)}` : ''}${e.summary ? ` &mdash; ${searchSnippet(e.summary, results.query)}` : ''}</span>
        </a>`),
      section('Glossary', results.glossary, (g) => `
        <a class="search-result" href="/glossary/${encodeURIComponent(g.title)}">
          <span class="search-result-title">${searchSnippet(g.title, results.query, { radius: 60 })}</span>
          <span class="search-result-snippet">${searchSnippet(stripTags(g.content_html) || g.summary, results.query)}</span>
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
  'bible-closed': (s) => `made the bible of ${s} private`,
  'bible-opened': (s) => `opened the bible of ${s} to readers`,
  'bible-entry-added': (s) => `added ${s} to the bible`,
  'bible-image-added': (s) => `added a picture to ${s}`,
  'bible-entry-edited': (s) => `rewrote ${s} in the bible`,
  'bible-entry-deleted': (s) => `took ${s} out of the bible`,
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

// ---------- somebody's page ----------

// Everything the group can see about a member in one place: who they are,
// what they have written, and the numbers underneath it. No activity feed
// and no reading history -- what somebody has read is between them and
// the author whose chapter it was.
/** @param {{ user: Row, person: Row, stats: any, stories: any[], chapters: any[] }} props */
function profilePage({ user, person, stats, stories, chapters }) {
  const isSelf = person.id === user.id;
  const stat = (value, label) => `<div class="story-stat"><span class="story-stat-value">${value}</span><span class="story-stat-label">${label}</span></div>`;

  const storyRows = stories.length ? `<div class="chapter-list">${stories.map((s) => `
    <a class="chapter-row" href="/stories/${s.id}">
      <div class="chapter-row-main">
        <h3>${escapeHtml(s.title)}</h3>
        ${s.description ? `<p class="muted">${escapeHtml(s.description)}</p>` : ''}
      </div>
      <div class="chapter-row-meta">
        <span>${s.is_owner ? 'author' : 'coauthor'}</span>
        <span>${s.own_chapters} of ${s.chapters} chapter${s.chapters === 1 ? '' : 's'}</span>
      </div>
    </a>`).join('')}</div>` : `<p class="muted">${isSelf ? 'You have not started or been invited into a story yet.' : 'Nothing yet.'}</p>`;

  const chapterRows = chapters.length ? `<div class="chapter-list">${chapters.map((c) => `
    <a class="chapter-row" href="/chapters/${c.id}">
      <div class="chapter-row-main">
        <h3>${escapeHtml(c.title)}</h3>
        <p class="muted">${escapeHtml(c.story_title)}</p>
      </div>
      <div class="chapter-row-meta">
        ${c.word_count ? `<span>${wordCount(c.word_count)}</span>` : ''}
        ${timeHtml(c.created_at)}
      </div>
    </a>`).join('')}</div>` : `<p class="muted">${isSelf ? 'Nothing written yet.' : 'Nothing yet.'}</p>`;

  return layout({
    title: person.display_name,
    user,
    body: `
      <div class="page-head">
        <div>
          <h1>${escapeHtml(person.display_name)}</h1>
          <p class="muted byline">@${escapeHtml(person.username)} &middot; joined ${timeHtml(person.created_at)}${
  person.last_seen_at ? ` &middot; last seen ${timeHtml(person.last_seen_at)}` : ''
}</p>
        </div>
        ${isSelf ? '<div class="page-head-actions"><a class="btn ghost small" href="/account">Account</a></div>' : ''}
      </div>

      <div class="story-stats">
        ${stat(stats.words.toLocaleString('en-GB'), 'words')}
        ${stat(stats.chapters, `chapter${stats.chapters === 1 ? '' : 's'}`)}
        ${stat(stats.versions, `version${stats.versions === 1 ? '' : 's'}`)}
        ${stat(stats.storiesStarted, `stor${stats.storiesStarted === 1 ? 'y' : 'ies'} started`)}
        ${stat(stats.commentsWritten, 'notes given')}
        ${stat(stats.commentsReceived, 'notes taken')}
      </div>

      <section class="profile-section">
        <h2>Stories</h2>
        ${storyRows}
      </section>

      <section class="profile-section">
        <h2>Chapters</h2>
        ${chapterRows}
      </section>`,
  });
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


/** @param {{ user: Row, error?: string|null, notice?: string|null, groups?: any[], hiddenTagIds?: number[], streak?: any, origin?: string }} props */
function accountPage({ user, error, notice, groups = [], hiddenTagIds = [], streak = null, origin = '' }) {
  return layout({
    title: 'Account',
    user,
    current: 'account',
    flash: notice ? { type: 'info', message: notice } : null,
    body: `
      <h1>Account</h1>
      <div class="auth-card">
        <h2>Your name</h2>
        <p class="muted">The name on everything you write and every note you leave. Your sign-in name, <strong>@${escapeHtml(user.username)}</strong>, does not change -- it is what the app knows you by.</p>
        <form method="post" action="/account/name">
          <label>Name people see<input type="text" name="displayName" value="${escapeHtml(user.display_name)}" required maxlength="60"></label>
          <button class="btn" type="submit">Save name</button>
        </form>
        <p class="muted"><a href="/users/${escapeHtml(user.username)}">See your page as the group sees it &rarr;</a></p>
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
      <div class="auth-card">
        <h2>Change password</h2>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/account/password">
          <label>Current password<input type="password" name="currentPassword" required></label>
          <label>New password<input type="password" name="newPassword" required minlength="8"></label>
          <label>Confirm new password<input type="password" name="confirmPassword" required minlength="8"></label>
          <button class="btn" type="submit">Change password</button>
        </form>
        <p class="muted">Changing your password signs you out of any other device or browser where you're currently logged in.</p>
      </div>
      ${hiddenTagsSection(groups, hiddenTagIds)}`,
  });
}

// ---------- admin panel ----------

module.exports = {
  EVENT_SENTENCES,
  accountPage,
  eventLine,
  eventLog,
  feedBlock,
  profilePage,
  searchPage,
  searchSnippet,
  stripTags,
};
