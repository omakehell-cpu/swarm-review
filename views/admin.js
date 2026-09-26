'use strict';

const { categoryFor } = require('../lib/sol-tags');
const { layout } = require('../lib/layout');
const { escapeHtml } = require('../lib/util');
const { timeHtml } = require('../lib/time');
const { eventLog } = require('./people');
const { wiki } = require('./shared');
// The whole invite as a message to paste into a chat or an email: where
// to go, the code, and for a named invite the username it is tied to. The
// page's own address is added in the browser (see copy-invite.js), so it
// is whatever address the admin is using.
function copyInviteButton(code, username = '') {
  return `<button type="button" class="btn small copy-invite" data-copy-invite data-code="${escapeHtml(code)}"${username ? ` data-username="${escapeHtml(username)}"` : ''} hidden>Copy the invite${username ? ` for @${escapeHtml(username)}` : ''}</button>`;
}

function inviteCodeCard(activeInviteCode) {
  if (!activeInviteCode) {
    return `
      <div class="invite-card closed">
        <p><strong>Registration is closed.</strong> No code will work until you generate a new one.</p>
        <form method="post" action="/admin/invite-code/generate" class="inline-form">
          <button class="btn small" type="submit">Generate a code</button>
        </form>
      </div>`;
  }
  return `
    <div class="invite-card">
      <p class="muted">Current invite code (single-use, not used yet):</p>
      <p class="invite-code">${escapeHtml(activeInviteCode.code)}</p>
      <p class="muted">Created ${timeHtml(activeInviteCode.created_at)}${activeInviteCode.created_by_name ? ` by ${escapeHtml(activeInviteCode.created_by_name)}` : ''}</p>
      <div class="row">
        ${copyInviteButton(activeInviteCode.code)}
        <form method="post" action="/admin/invite-code/generate" class="inline-form">
          <button class="btn small ghost" type="submit">Generate a new code</button>
        </form>
        <form method="post" action="/admin/invite-code/close" class="inline-form" data-confirm="Close registration? Nobody will be able to register until you generate a new code.">
          <button class="btn small ghost" type="submit">Close registration</button>
        </form>
      </div>
    </div>`;
}

function inviteCodeHistoryTable(history) {
  if (!history.length) return '';
  const rows = history.map((c) => {
    let statusText;
    if (c.used_at) statusText = `used by ${escapeHtml(c.used_by_name || 'someone since removed')}`;
    else if (c.active) statusText = 'active';
    else statusText = 'invalidated';
    return `
      <tr>
        <td>${escapeHtml(c.code)}</td>
        <td>${c.username ? `@${escapeHtml(c.username)}` : 'Anyone'}</td>
        <td>${timeHtml(c.created_at)}</td>
        <td>${statusText}</td>
      </tr>`;
  }).join('');
  return `
    <details class="invite-history">
      <summary>Invite code history (${history.length})</summary>
      <table class="admin-table">
        <thead><tr><th>Code</th><th>For</th><th>Created</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>`;
}

function namedInviteRow(inv) {
  return `
    <div class="admin-user-row">
      <div class="admin-user-main">
        <strong>@${escapeHtml(inv.username)}</strong>
        <p class="muted small-meta">Code: <span class="invite-code-inline">${escapeHtml(inv.code)}</span> &middot; created ${timeHtml(inv.created_at)}${inv.created_by_name ? ` by ${escapeHtml(inv.created_by_name)}` : ''}</p>
      </div>
      <div class="admin-user-actions">
        ${copyInviteButton(inv.code, inv.username)}
        <form method="post" action="/admin/invite-code/named/${inv.id}/revoke" class="inline-form" data-confirm="Revoke this invite? The code will stop working.">
          <button class="btn small ghost" type="submit">Revoke</button>
        </form>
      </div>
    </div>`;
}

function namedInviteSection(pendingNamedInvites) {
  const rows = pendingNamedInvites.length
    ? pendingNamedInvites.map(namedInviteRow).join('')
    : '<p class="muted">No pending invites.</p>';
  return `
    <section class="admin-section">
      <h2>Invite a specific person</h2>
      <p class="muted">Generates a code that only works to register with that exact username -- unlike the general code above, this doesn't affect the open code or anyone else's pending invite. Adding the same username again replaces their old code with a new one.</p>
      <form method="post" action="/admin/invite-code/named" class="named-invite-form">
        <input type="text" name="username" placeholder="username" required pattern="[a-zA-Z0-9_\\-]{3,30}">
        <button class="btn small" type="submit">Generate invite</button>
      </form>
      <div class="admin-user-list">${rows}</div>
    </section>`;
}

function adminUserRow(u, { currentUserId }) {
  const isSelf = u.id === currentUserId;
  const locked = !!u.locked_at;
  const lockLabel = locked
    ? (u.locked_reason === 'failed_attempts' ? 'Locked (3 failed logins)' : 'Locked (by admin)')
    : '';
  return `
    <div class="admin-user-row ${locked ? 'locked' : ''}">
      <div class="admin-user-main">
        <strong>${escapeHtml(u.display_name)}</strong> <span class="muted">@${escapeHtml(u.username)}</span>
        ${u.is_admin ? '<span class="badge admin-badge">Admin</span>' : ''}
        ${locked ? `<span class="badge locked-badge">${lockLabel}</span>` : ''}
        <p class="muted small-meta">Joined ${timeHtml(u.created_at)} &middot; last seen ${timeHtml(u.last_seen_at)}${u.failed_login_attempts > 0 && !locked ? ` &middot; ${u.failed_login_attempts} recent failed login${u.failed_login_attempts === 1 ? '' : 's'}` : ''} &middot; <a href="/users/${escapeHtml(u.username)}">their page</a></p>
        <details class="user-log">
          <summary>What they have done${u.event_count ? ` (${u.event_count})` : ''}</summary>
          ${eventLog(u.events || [])}
          ${u.event_count > (u.events || []).length ? `<p class="muted small-meta">Showing the last ${(u.events || []).length} of ${u.event_count}.</p>` : ''}
        </details>
      </div>
      <div class="admin-user-actions">
        <details class="admin-inline-form">
          <summary>Change password</summary>
          <form method="post" action="/admin/users/${u.id}/password">
            <input type="password" name="password" placeholder="New password" required minlength="8">
            <button class="btn small" type="submit">Set password</button>
          </form>
        </details>
        <form method="post" action="/admin/users/${u.id}/reset-link" class="inline-form">
          <button class="btn small ghost" type="submit">Send reset link</button>
        </form>
        ${locked
          ? `<form method="post" action="/admin/users/${u.id}/unlock" class="inline-form">
               <button class="btn small ghost" type="submit">Reactivate</button>
             </form>`
          : (isSelf ? '' : `<form method="post" action="/admin/users/${u.id}/lock" class="inline-form">
               <button class="btn small ghost" type="submit">Lock account</button>
             </form>`)
        }
        ${isSelf ? '' : `
          <form method="post" action="/admin/users/${u.id}/delete" class="inline-form" data-confirm="Delete this account? Their stories/chapters/comments stay, credited to Deleted user. This cannot be undone.">
            <button class="btn small danger" type="submit">Delete account</button>
          </form>`}
      </div>
    </div>`;
}

function adminPage({ user, users, claims = [], activeInviteCode, inviteCodeHistory, pendingNamedInvites, pendingResetLinks, wikiSyncState, notice, tagGroups = [], groupNames: allGroupNames = [], proposedTags = [], openTags = false, backups = { list: [], dir: '', keep: 0 } }) {
  const userRows = users.map((u) => adminUserRow(u, { currentUserId: user.id })).join('');
  return layout({
    title: 'Admin',
    user,
    current: 'admin',
    flash: notice ? { type: 'info', message: notice } : null,
    body: `
      <h1>Admin</h1>

      <section class="admin-section" id="claims">
        <h2>Imported stories</h2>
        <p class="muted">Stories brought in from StoriesOnline belong to an imported author until the writer claims them. <a href="/admin/import">Import a story</a> &middot; <a href="/authors">Every imported author, and their stories</a></p>
        ${claims.length ? `
          <h3 class="tag-admin-group">Claims waiting (${claims.length})</h3>
          <ul class="claim-list">
            ${claims.map((c) => `
              <li class="claim-row">
                <p><strong>${escapeHtml(c.member_name)}</strong> <span class="muted">@${escapeHtml(c.member_username)}</span> says they are
                  <a href="/users/${encodeURIComponent(c.author_username)}">${escapeHtml(c.author_name)}</a>
                  <span class="muted">(${c.story_count} stor${c.story_count === 1 ? 'y' : 'ies'})</span>${c.source_url ? ` &middot; <a href="${escapeHtml(c.source_url)}" target="_blank" rel="noopener noreferrer">their page on StoriesOnline</a>` : ''}</p>
                ${c.message ? `<p class="claim-message">&ldquo;${escapeHtml(c.message)}&rdquo;</p>` : ''}
                <div class="row">
                  <form method="post" action="/admin/claims/${c.id}/approve" class="inline-form"
                        data-confirm="Move every story by ${escapeHtml(c.author_name)} to ${escapeHtml(c.member_name)}'s account?">
                    <button class="btn small" type="submit">Yes, move the stories</button>
                  </form>
                  <form method="post" action="/admin/claims/${c.id}/decline" class="inline-form">
                    <button class="btn small ghost" type="submit">Turn down</button>
                  </form>
                </div>
              </li>`).join('')}
          </ul>` : '<p class="muted">No claims waiting.</p>'}
      </section>

      <section class="admin-section">
        <h2 id="backup">Backup</h2>
        <p class="muted">A complete, self-contained snapshot of the database -- every user, story, chapter, version, comment, and invite code -- as a single .sqlite file, safe to take while the server is running.</p>
        <p class="muted">The server now takes one every day by itself and keeps the last ${backups.keep}, in <code>${escapeHtml(backups.dir)}</code>. That protects against a mistake; it does not protect against this machine. Point a cloud folder or a second disk at that directory and it becomes a real backup.</p>
        ${backups.list.length ? `
          <ul class="backup-list">
            ${backups.list.slice(0, 5).map((b) => `
              <li><span>${escapeHtml(b.name)}</span> <span class="muted">${(b.bytes / 1048576).toFixed(1)} MB &middot; ${timeHtml(b.at.replace('T', ' ').slice(0, 19))}</span></li>`).join('')}
          </ul>
          ${backups.list.length > 5 ? `<p class="muted">${backups.list.length} in all.</p>` : ''}
          <details class="restore-backup">
            <summary>Put a copy back&hellip;</summary>
            <p class="muted">Everything written since that copy is replaced by what was there then. A copy of the site as it is now is taken first and put at the top of this list, so this can be undone the same way.</p>
            <form method="post" action="/admin/backup/restore" class="restore-form"
                  data-confirm="Replace everything on the site with the chosen copy? A copy of what is there now is kept first.">
              <label>Which copy
                <select name="name" required>
                  ${backups.list.map((b) => `<option value="${escapeHtml(b.name)}">${escapeHtml(b.at.replace('T', ' ').slice(0, 16))} &middot; ${(b.bytes / 1048576).toFixed(1)} MB</option>`).join('')}
                </select>
              </label>
              <label>Type RESTORE to confirm
                <input type="text" name="confirm" autocomplete="off" required pattern="[Rr][Ee][Ss][Tt][Oo][Rr][Ee]">
              </label>
              <button class="btn small" type="submit">Restore this copy</button>
            </form>
          </details>`
    : '<p class="muted">No automatic copy has been taken yet. One is taken when the server starts and every day after that.</p>'}
        <form method="post" action="/admin/backup/now" class="inline-form">
          <button class="btn ghost small" type="submit">Take one now</button>
        </form>
        <a class="btn ghost" href="/admin/backup">Download backup (.sqlite)</a>
      </section>

      <section class="admin-section">
        <h2>Registration</h2>
        ${inviteCodeCard(activeInviteCode)}
        ${inviteCodeHistoryTable(inviteCodeHistory)}
      </section>

      ${namedInviteSection(pendingNamedInvites)}

      ${resetLinksSection(pendingResetLinks)}

      ${wikiSyncSection(wikiSyncState)}

      <section class="admin-section">
        <h2>Users</h2>
        <div class="admin-user-list">${userRows}</div>
      </section>

      ${tagAdminSection(tagGroups, proposedTags, { open: openTags, allGroupNames })}`,
  });
}


// The tag vocabulary, managed in one place: authors only ever pick from
// this list, so this is where "Sci-Fi" and "Science fiction" get stopped
// from both existing.
// Tags authors proposed while writing. Each row offers the three things
// an admin actually wants to do with a proposal: take it as it stands
// (possibly renaming and filing it under a real group first), fold it
// into a tag that already says the same thing, or throw it out.
function proposedTagsSection(proposedTags, tagGroups, allGroupNames = []) {
  if (!proposedTags.length) {
    return `
    <div class="proposed-queue is-empty" id="tag-queue">
      <h3 class="tag-admin-group">Waiting for approval</h3>
      <p class="muted">Nothing waiting. Tags an author proposes while tagging a story appear here.</p>
    </div>`;
  }
  const approved = tagGroups.flatMap((g) => g.tags.filter((t) => t.status !== 'proposed').map((t) => ({ ...t, group: g.group })));
  const groupNames = allGroupNames.length ? allGroupNames : Array.from(new Set(tagGroups.map((g) => g.group))).filter((n) => n !== 'Proposed');

  return `
    <div class="proposed-queue" id="tag-queue">
      <h3 class="tag-admin-group">Waiting for approval (${proposedTags.length})</h3>
      <p class="muted">These are already on the stories they were proposed for and marked as proposed wherever they show. Approving one files it in the vocabulary properly; merging moves its stories onto a tag that already exists and drops the duplicate.</p>
      ${proposedTags.map((t) => `
        <div class="proposed-row">
          <div class="proposed-row-head">
            <strong>${escapeHtml(t.name)}</strong>
            <span class="muted">${t.proposed_by_name ? `proposed by ${escapeHtml(t.proposed_by_name)}` : 'proposed'} &middot; ${t.story_count} stor${t.story_count === 1 ? 'y' : 'ies'}</span>
          </div>
          <div class="proposed-row-actions">
            <form method="post" action="/admin/tags/${t.id}/approve" class="proposed-form">
              <input type="text" name="name" value="${escapeHtml(t.name)}" aria-label="Name to approve it under">
              <select name="group" aria-label="Group">
                ${groupNames.map((n) => `<option value="${escapeHtml(n)}"${n === categoryFor(t.name) ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}
              </select>
              <button class="btn small" type="submit">Approve</button>
            </form>
            <form method="post" action="/admin/tags/${t.id}/merge" class="proposed-form">
              <select name="intoTagId" aria-label="Merge into">
                ${approved.map((a) => `<option value="${a.id}">${escapeHtml(a.group)}: ${escapeHtml(a.name)}</option>`).join('')}
              </select>
              <button class="btn ghost small" type="submit">Merge into</button>
            </form>
            <form method="post" action="/admin/tags/${t.id}/delete" class="proposed-form">
              <button class="btn danger small" type="submit"
                data-confirm="Throw out the proposed tag &quot;${escapeHtml(t.name)}&quot;?${t.story_count ? ` It will be taken off ${t.story_count} stor${t.story_count === 1 ? 'y' : 'ies'}.` : ''}">Reject</button>
            </form>
          </div>
        </div>`).join('')}
    </div>`;
}

// The vocabulary, and the proposals waiting to join it. The proposals are
// the part that needs doing, so they stay in view; the vocabulary is
// reference -- dozens of rows -- and stays folded until it is wanted
// (or until a change to it brings the admin back here).
/**
 * @param {Array<{ group: string, tags: any[] }>} tagGroups
 * @param {any[]} [proposedTags]
 * @param {{ open?: boolean, allGroupNames?: string[] }} [options]
 */
function tagAdminSection(tagGroups, proposedTags = [], { open = false, allGroupNames = [] } = {}) {
  const vocabulary = tagGroups
    .map((g) => ({ ...g, tags: g.tags.filter((t) => t.status !== 'proposed') }))
    .filter((g) => g.tags.length);
  const tagCount = vocabulary.reduce((n, g) => n + g.tags.length, 0);
  const groupNames = allGroupNames.length ? allGroupNames : Array.from(new Set(vocabulary.map((g) => g.group)));
  const rows = vocabulary.map((g) => `
    <h4 class="tag-admin-group">${escapeHtml(g.group)} <span class="tag-admin-count">${g.tags.length}</span></h4>
    <div class="tag-admin-list">${g.tags.map((t) => `
      <form method="post" action="/admin/tags/${t.id}" class="tag-admin-row">
        <input type="text" name="name" value="${escapeHtml(t.name)}" aria-label="Tag name">
        <input type="text" name="group" value="${escapeHtml(t.tag_group)}" list="tag-groups" aria-label="Group">
        <input type="text" name="description" value="${escapeHtml(t.description || '')}" placeholder="What it means (optional)" aria-label="Description">
        <span class="tag-admin-count">${t.story_count} stor${t.story_count === 1 ? 'y' : 'ies'}</span>
        <button class="btn ghost small" type="submit">Save</button>
        <button class="btn danger small" type="submit" formaction="/admin/tags/${t.id}/delete"
          data-confirm="Delete the tag &quot;${escapeHtml(t.name)}&quot;?${t.story_count ? ` It is on ${t.story_count} stor${t.story_count === 1 ? 'y' : 'ies'}, and will be taken off ${t.story_count === 1 ? 'it' : 'them'}.` : ''}">Delete</button>
      </form>`).join('')}</div>`).join('');

  return `
    <section class="admin-section" id="tags">
      <h2>Tags</h2>
      <p class="muted">The vocabulary authors pick from when they tag a story (see the <a href="/tags">tag index</a>). Renaming one updates it everywhere at once; its link keeps working, since a tag is identified by its own row rather than by its name.</p>
      ${proposedTagsSection(proposedTags, tagGroups, allGroupNames)}
      <details class="tag-vocabulary" id="tag-vocabulary"${open ? ' open' : ''}>
        <summary>The vocabulary <span class="tag-admin-count">${tagCount} tag${tagCount === 1 ? '' : 's'} in ${vocabulary.length} group${vocabulary.length === 1 ? '' : 's'}</span></summary>
        <datalist id="tag-groups">${groupNames.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('')}</datalist>
        <form method="post" action="/admin/tags" class="tag-admin-new">
          <input type="text" name="name" placeholder="New tag" required aria-label="New tag name">
          <input type="text" name="group" placeholder="Group" list="tag-groups" aria-label="Group">
          <input type="text" name="description" placeholder="What it means (optional)" aria-label="Description">
          <button class="btn small" type="submit">Add tag</button>
        </form>
        ${vocabulary.length ? rows : '<p class="muted">No tags yet.</p>'}
      </details>
    </section>`;
}

function wikiSyncSection(state) {
  const statusLine = !state || !state.last_synced_at
    ? '<p class="muted">Never synced yet.</p>'
    : `<p class="muted">Last synced ${timeHtml(state.last_synced_at)} &middot; ${state.page_count} pages${
        state.last_status === 'error' ? ` &middot; <span class="error">failed: ${escapeHtml(state.last_error || 'unknown error')}</span>` : ''
      }</p>`;
  return `
    <section class="admin-section" id="wiki">
      <h2>Wiki linking</h2>
      <p class="muted">Character/place/ship names recognized from <a href="${escapeHtml(wiki.WIKI_BASE_URL)}" target="_blank" rel="noopener noreferrer">the shared-universe wiki</a> get auto-linked in chapter text, with a hover preview of the wiki page's summary -- readers can turn this off from the "Wiki links" toggle on the chapter page. The same local copy also powers the <a href="/glossary">Glossary</a> section, a full offline mirror of the wiki's pages. Nothing here refreshes automatically -- click "Sync wiki now" below whenever the wiki has changed.</p>
      ${statusLine}
      <form method="post" action="/admin/wiki/sync" class="inline-form">
        <button class="btn ghost small" type="submit">Sync wiki now</button>
      </form>
    </section>`;
}

function resetLinksSection(pendingResetLinks) {
  if (!pendingResetLinks.length) return '';
  const rows = pendingResetLinks.map((t) => `
    <div class="admin-user-row">
      <div class="admin-user-main">
        <strong>${escapeHtml(t.user_display_name)}</strong> <span class="muted">@${escapeHtml(t.user_username)}</span>
        <p class="muted small-meta">Requested ${timeHtml(t.created_at)} &middot; expires ${timeHtml(t.expires_at)}</p>
      </div>
      <div class="admin-user-actions">
        <form method="post" action="/admin/reset-link/${t.id}/revoke" class="inline-form">
          <button class="btn small ghost" type="submit">Revoke</button>
        </form>
      </div>
    </div>`).join('');
  return `
    <section class="admin-section">
      <h2>Pending password reset links</h2>
      <p class="muted">Generated from a user's "Send reset link" button below. Each link is single-use and expires after 24 hours.</p>
      <div class="admin-user-list">${rows}</div>
    </section>`;
}

module.exports = {
  adminPage,
  adminUserRow,
  copyInviteButton,
  inviteCodeCard,
  inviteCodeHistoryTable,
  namedInviteRow,
  namedInviteSection,
  proposedTagsSection,
  resetLinksSection,
  tagAdminSection,
  wikiSyncSection,
};
