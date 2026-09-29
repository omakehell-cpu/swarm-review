'use strict';

const { layout } = require('../lib/layout');
const { escapeHtml } = require('../lib/util');

// /authors: everybody whose stories were brought in from StoriesOnline,
// with the stories they came in with. Two ways for an author to become
// somebody here: the member says "this is me" and an admin agrees, or an
// admin who knows who it is gives the stories to them directly. Both are
// on this page, next to the name they are about.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const STATUS = { complete: 'complete', ongoing: 'ongoing', dropped: 'set aside' };

function storyList(a) {
  if (!a.stories.length) return '<p class="muted">No stories here any more.</p>';
  const chapters = a.stories.reduce((n, s) => n + (Number(s.chapters) || 0), 0);
  return `
    <details class="author-stories">
      <summary>${plural(a.stories.length, 'story', 'stories')} &middot; ${plural(chapters, 'chapter', 'chapters')}</summary>
      <ul class="plain-list">
        ${a.stories.map((s) => `
          <li><a href="/stories/${s.id}">${escapeHtml(s.title)}</a>
            <span class="muted">${plural(Number(s.chapters) || 0, 'chapter', 'chapters')}${s.status !== 'complete' ? ` &middot; ${escapeHtml(STATUS[s.status] || s.status)}` : ''}</span></li>`).join('')}
      </ul>
    </details>`;
}

function claimsBlock(a, user) {
  if (!a.claims.length) return '';
  if (!user.is_admin) {
    const mine = a.claims.find((c) => c.user_id === user.id);
    return mine ? '<p class="author-state">You have said this is you. An admin will look at it.</p>' : '';
  }
  return `
    <ul class="author-claims">
      ${a.claims.map((c) => `
        <li>
          <p><a href="/users/${encodeURIComponent(c.member_username)}">${escapeHtml(c.member_name)}</a> says this is them.</p>
          ${c.message ? `<p class="claim-message">&ldquo;${escapeHtml(c.message)}&rdquo;</p>` : ''}
          <div class="author-claim-actions">
            <form method="post" action="/admin/claims/${c.id}/approve" class="inline-form"
                  data-confirm="Move ${escapeHtml(plural(a.stories.length, 'story', 'stories'))} by ${escapeHtml(a.display_name)} to ${escapeHtml(c.member_name)}?">
              <input type="hidden" name="back" value="authors">
              <button class="btn small" type="submit">Yes, it is them</button>
            </form>
            <form method="post" action="/admin/claims/${c.id}/decline" class="inline-form">
              <input type="hidden" name="back" value="authors">
              <button class="btn ghost small" type="submit">No</button>
            </form>
          </div>
        </li>`).join('')}
    </ul>`;
}

function claimForm(a, user) {
  if (a.claims.some((c) => c.user_id === user.id)) return '';
  return `
    <details class="claim-form">
      <summary>This is me</summary>
      <form method="post" action="/users/${encodeURIComponent(a.username)}/claim">
        <input type="hidden" name="back" value="authors">
        <label>Anything that will help an admin see it is you (optional)
          <textarea name="message" rows="2" maxlength="1000" placeholder="e.g. I post there as ${escapeHtml(a.display_name)}."></textarea>
        </label>
        <button class="btn small" type="submit">Claim these stories</button>
      </form>
    </details>`;
}

function assignForm(a, members) {
  if (!members.length) return '';
  const id = `assign-${a.id}`;
  return `
    <form method="post" action="/admin/authors/${a.id}/assign" class="author-assign"
          data-confirm="Move every story by ${escapeHtml(a.display_name)} to the member you chose? It is what a claim does, without waiting for one.">
      <label for="${id}">Give to</label>
      <select name="member" id="${id}" required>
        <option value="">Choose a member</option>
        ${members.map((m) => `<option value="${escapeHtml(m.username)}">${escapeHtml(m.display_name)} (${escapeHtml(m.username)})</option>`).join('')}
      </select>
      <button class="btn ghost small" type="submit">Give</button>
    </form>`;
}

function authorCard(a, { user, members }) {
  const links = [
    a.source_url ? `<a href="${escapeHtml(a.source_url)}" target="_blank" rel="noopener noreferrer">On StoriesOnline</a>` : '',
    a.wiki ? `<a href="/wiki/${encodeURIComponent(a.wiki)}">In the wiki</a>` : '',
  ].filter(Boolean).join(' &middot; ');
  const claimed = Boolean(a.claimed_by);
  return `
    <li class="author-card${claimed ? ' is-claimed' : ''}" id="a-${escapeHtml(a.username)}"
        data-author-search="${escapeHtml(`${a.display_name} ${a.claimed_by_name || ''} ${a.stories.map((s) => s.title).join(' ')}`.toLowerCase())}">
      <div class="author-head">
        <h3><a href="/users/${encodeURIComponent(a.username)}">${escapeHtml(a.display_name)}</a></h3>
        ${claimed
    ? `<span class="author-state">Now <a href="/users/${encodeURIComponent(a.claimed_by_username)}">${escapeHtml(a.claimed_by_name)}</a></span>`
    : `<span class="author-state muted">${a.claims.length ? plural(a.claims.length, 'claim', 'claims') + ' waiting' : 'Not claimed'}</span>`}
      </div>
      ${links ? `<p class="author-links muted">${links}</p>` : ''}
      ${storyList(a)}
      ${claimed ? '' : `
        ${claimsBlock(a, user)}
        <div class="author-actions">
          ${user.is_admin ? '' : claimForm(a, user)}
          ${user.is_admin ? assignForm(a, members) : ''}
        </div>`}
    </li>`;
}

function authorsPage({ user, authors, members = [], notice = '' }) {
  const open = authors.filter((a) => !a.claimed_by);
  const done = authors.filter((a) => a.claimed_by);
  const stories = authors.reduce((n, a) => n + a.stories.length, 0);
  const waiting = authors.reduce((n, a) => n + a.claims.length, 0);
  const list = (items) => `<ul class="author-list">${items.map((a) => authorCard(a, { user, members })).join('')}</ul>`;
  return layout({
    title: 'Authors',
    user,
    flash: notice ? { type: 'info', message: notice } : null,
    body: `
      <div class="page-head">
        <div>
          <h1>Authors</h1>
          <p class="muted">Everybody whose stories were brought in from StoriesOnline, with the stories they came with.
          ${user.is_admin
    ? 'A member can say an author is them, and you say yes or no here; or, if you know who it is, give them the stories yourself.'
    : 'If one of them is you, say so: an admin will look, and the stories move to your account.'}</p>
        </div>
      </div>
      ${authors.length ? `
        <p class="outline-totals">
          <span>${plural(authors.length, 'author', 'authors')}</span>
          <span>${plural(stories, 'story', 'stories')}</span>
          <span>${open.length} not claimed yet</span>
          ${waiting ? `<span class="pending-total">${plural(waiting, 'claim', 'claims')} waiting</span>` : ''}
        </p>
        <div class="author-find">
          <label for="author-find" class="sr-only">Find an author or a story</label>
          <input type="search" id="author-find" placeholder="Find an author or a story" data-author-find autocomplete="off">
          <p class="muted" data-author-none hidden>Nobody by that name, and no story by that title.</p>
        </div>
        ${open.length ? `<section class="author-list-box"><h2 class="side-head">Waiting for their writer</h2>${list(open)}</section>` : ''}
        ${done.length ? `<section class="author-list-box"><h2 class="side-head">Here now</h2>${list(done)}</section>` : ''}`
    : '<p class="muted">No stories have been imported yet.</p>'}`,
  });
}

module.exports = { authorsPage };
