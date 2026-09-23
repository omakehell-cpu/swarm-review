'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { parseBody, sendHtml, redirect } = require('../lib/util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const auth = require('../auth');
const models = require('../models');
const views = require('../views');
const wiki = require('../lib/wiki');
const backups = require('../lib/backup');
const { SECURE_COOKIES, logEvent, sendError } = require('./shared');
async function handleAdminPage(req, res, user, query) {
  const users = models.listUsersForAdmin();
  const activeInviteCode = models.getActiveInviteCode();
  const inviteCodeHistory = models.listInviteCodes();
  const pendingNamedInvites = models.listPendingNamedInvites();
  const pendingResetLinks = models.listPendingPasswordResetTokens();
  const wikiSyncState = models.getWikiSyncState();
  const notice = query.get('notice') || null;
  // The log is per person and folded away, so the last 30 of each is
  // plenty: the whole point is "what has this one been up to", not a
  // site-wide audit trail to page through.
  const usersWithLog = users.map((u) => ({
    ...u,
    events: models.listEventsForUser(u.id, 30),
    event_count: models.countEventsForUser(u.id),
  }));
  sendHtml(res, 200, views.adminPage({
    user, users: usersWithLog, activeInviteCode, inviteCodeHistory, pendingNamedInvites, pendingResetLinks, wikiSyncState, notice,
    backups: { list: backups.listBackups(), dir: backups.backupDir(), keep: backups.KEEP },
    tagGroups: models.listTagsGrouped(),
    proposedTags: models.listProposedTags(),
  }));
}

async function handleAdminGenerateInviteCode(req, res, user) {
  models.generateNewInviteCode(user.id);
  logEvent(user, 'invite-made');
  redirect(res, '/admin?notice=New invite code generated. The old one no longer works.');
}

async function handleAdminCloseRegistration(req, res, user) {
  models.closeRegistration();
  logEvent(user, 'registration-closed');
  redirect(res, '/admin?notice=Registration closed. No invite code will work until you generate a new one.');
}

async function handleAdminSetPassword(req, res, user, targetUserId) {
  const target = models.getUserById(targetUserId);
  if (!target || target.username === models.DELETED_USER_USERNAME) return sendError(res, 404, 'User not found', user);
  const body = await parseBody(req);
  const password = body.password || '';
  if (password.length < 8) {
    return redirect(res, '/admin?notice=Password must be at least 8 characters long -- not changed.');
  }
  models.adminSetPassword(targetUserId, auth.hashPassword(password));
  logEvent(user, 'password-set-for', { subject: target.display_name, href: `/users/${target.username}` });
  redirect(res, `/admin?notice=Password changed for ${encodeURIComponent(target.display_name)}.`);
}

async function handleAdminLockUser(req, res, user, targetUserId) {
  const target = models.getUserById(targetUserId);
  if (!target || target.username === models.DELETED_USER_USERNAME) return sendError(res, 404, 'User not found', user);
  if (target.id === user.id) return sendError(res, 400, "You can't lock your own account.", user);
  models.adminLockAccount(targetUserId);
  logEvent(user, 'account-locked', { subject: target.display_name, href: `/users/${target.username}` });
  redirect(res, `/admin?notice=${encodeURIComponent(target.display_name)}'s account is now locked.`);
}

async function handleAdminUnlockUser(req, res, user, targetUserId) {
  const target = models.getUserById(targetUserId);
  if (!target || target.username === models.DELETED_USER_USERNAME) return sendError(res, 404, 'User not found', user);
  models.adminUnlockAccount(targetUserId);
  logEvent(user, 'account-unlocked', { subject: target.display_name, href: `/users/${target.username}` });
  redirect(res, `/admin?notice=${encodeURIComponent(target.display_name)}'s account is reactivated.`);
}

async function handleAdminDeleteUser(req, res, user, targetUserId) {
  const target = models.getUserById(targetUserId);
  if (!target || target.username === models.DELETED_USER_USERNAME) return sendError(res, 404, 'User not found', user);
  if (target.id === user.id) return sendError(res, 400, "You can't delete your own account.", user);
  if (target.is_admin) {
    const remainingAdmins = models.listUsersForAdmin().filter((u) => u.is_admin && u.id !== target.id);
    if (remainingAdmins.length === 0) {
      return redirect(res, '/admin?notice=Can\'t delete the only remaining admin account.');
    }
  }
  models.adminDeleteUser(targetUserId);
  redirect(res, `/admin?notice=${encodeURIComponent(target.display_name)}'s account was deleted. Their stories, chapters, and comments were kept, credited to "Deleted user".`);
}

async function handleAdminCreateNamedInvite(req, res, user) {
  const body = await parseBody(req);
  const username = (body.username || '').trim().toLowerCase();

  if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
    return redirect(res, '/admin?notice=Invalid username for the invite (3-30 characters, letters/numbers/_/-).');
  }
  if (username === models.DELETED_USER_USERNAME) {
    return redirect(res, '/admin?notice=That username is reserved.');
  }
  if (models.getUserByUsername(username)) {
    return redirect(res, `/admin?notice="${encodeURIComponent(username)}" already has an account.`);
  }

  const invite = models.createNamedInviteCode(username, user.id);
  redirect(res, `/admin?notice=Invite code for "${encodeURIComponent(invite.username)}": ${encodeURIComponent(invite.code)} -- share it only with that person.`);
}

async function handleAdminRevokeNamedInvite(req, res, user, inviteId) {
  const invite = models.getInviteCodeById(inviteId);
  if (!invite || !invite.username) return sendError(res, 404, 'Invite not found', user);
  models.revokeNamedInvite(inviteId);
  redirect(res, `/admin?notice=Invite for "${encodeURIComponent(invite.username)}" revoked.`);
}

async function handleAdminGenerateResetLink(req, res, user, targetUserId) {
  const target = models.getUserById(targetUserId);
  if (!target || target.username === models.DELETED_USER_USERNAME) return sendError(res, 404, 'User not found', user);
  const resetToken = models.createPasswordResetToken(targetUserId, user.id);
  logEvent(user, 'reset-link-made', { subject: target.display_name, href: `/users/${target.username}` });
  const proto = SECURE_COOKIES ? 'https' : 'http';
  const link = `${proto}://${req.headers.host}/reset-password/${resetToken.token}`;
  redirect(res, `/admin?notice=Reset link for ${encodeURIComponent(target.display_name)} (valid 24h, share it only with them): ${encodeURIComponent(link)}`);
}

async function handleAdminRevokeResetLink(req, res, user, tokenId) {
  models.revokePasswordResetToken(tokenId);
  redirect(res, '/admin?notice=Reset link revoked.');
}

async function handleAdminSyncWiki(req, res, user) {
  try {
    const { pageCount } = await wiki.syncWikiIndex();
    logEvent(user, 'wiki-synced', { subject: `${pageCount} pages`, href: '/glossary' });
    redirect(res, `/admin?notice=Wiki index synced: ${pageCount} pages.`);
  } catch (err) {
    redirect(res, `/admin?notice=Wiki sync failed: ${encodeURIComponent(err.message)}`);
  }
}

async function handleAdminBackupNow(req, res, user) {
  try {
    const made = backups.takeBackup(models.backupDatabaseTo);
    logEvent(user, 'backup-taken', { subject: made.name, href: '/admin' });
    redirect(res, `/admin?notice=${encodeURIComponent(`Copy taken: ${made.name}.`)}`);
  } catch (err) {
    redirect(res, `/admin?notice=${encodeURIComponent(`The copy failed: ${err.message}`)}`);
  }
}

// Putting a copy back. The dangerous button on this page, so: the copy is
// named by its file name and must be one of the listed ones (never a path
// from the form), the admin types RESTORE to mean it, and a fresh copy of
// the database as it stands is taken first -- so a restore is itself
// undoable from the same list.
async function handleAdminRestore(req, res, user) {
  const body = await parseBody(req);
  const name = String(body.name || '');
  const chosen = backups.listBackups().find((b) => b.name === name);
  if (!chosen) return redirect(res, `/admin?notice=${encodeURIComponent('There is no copy by that name.')}#backup`);
  if (String(body.confirm || '').trim().toUpperCase() !== 'RESTORE') {
    return redirect(res, `/admin?notice=${encodeURIComponent('Nothing was restored: type RESTORE in the box to confirm.')}#backup`);
  }
  let safety;
  try {
    safety = backups.takeBackup(models.backupDatabaseTo);
  } catch (err) {
    return redirect(res, `/admin?notice=${encodeURIComponent(`Nothing was restored: the safety copy failed (${err.message}).`)}#backup`);
  }
  try {
    models.restoreDatabaseFrom(chosen.path);
  } catch (err) {
    return redirect(res, `/admin?notice=${encodeURIComponent(`Nothing was restored: ${err.message}.`)}#backup`);
  }
  logEvent(user, 'backup-restored', { subject: chosen.name, href: '/admin' });
  redirect(res, `/admin?notice=${encodeURIComponent(`Restored ${chosen.name}. What was there before is saved as ${safety.name}, at the top of the list.`)}#backup`);
}

async function handleAdminBackup(req, res, user) {
  logEvent(user, 'backup-downloaded');
  const tmpPath = path.join(os.tmpdir(), `swarm-review-backup-${Date.now()}-${process.pid}.sqlite`);
  try {
    models.backupDatabaseTo(tmpPath);
    const buffer = fs.readFileSync(tmpPath);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.sqlite3',
      'Content-Disposition': `attachment; filename="swarm-review-backup-${stamp}.sqlite"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

async function handleAdminCreateTag(req, res, user) {
  const body = await parseBody(req);
  models.createTag({ name: body.name, group: body.group, description: body.description });
  logEvent(user, 'tag-created', { subject: body.name, href: '/tags' });
  redirect(res, '/admin?notice=Tag added.#tags');
}

async function handleAdminUpdateTag(req, res, user, tagId) {
  const body = await parseBody(req);
  models.updateTag(tagId, { name: body.name, group: body.group, description: body.description });
  logEvent(user, 'tag-edited', { subject: body.name, href: '/tags' });
  redirect(res, '/admin?notice=Tag updated.#tags');
}

async function handleAdminApproveTag(req, res, user, tagId) {
  const body = await parseBody(req);
  models.approveTag(tagId, { name: body.name, group: body.group });
  logEvent(user, 'tag-approved', { subject: body.name, href: '/tags' });
  redirect(res, '/admin?notice=Tag approved.#tags');
}

async function handleAdminMergeTag(req, res, user, tagId) {
  const body = await parseBody(req);
  const into = models.mergeTag(tagId, Number(body.intoTagId));
  logEvent(user, 'tag-merged', { subject: into ? into.name : '', href: '/tags' });
  redirect(res, `/admin?notice=${encodeURIComponent(into ? `Merged into "${into.name}".` : 'Nothing to merge into.')}#tags`);
}

async function handleAdminDeleteTag(req, res, user, tagId) {
  const tag = models.getTagById(tagId);
  models.deleteTag(tagId);
  logEvent(user, 'tag-deleted', { subject: tag ? tag.name : '' });
  redirect(res, `/admin?notice=${encodeURIComponent(`Tag ${tag ? `"${tag.name}" ` : ''}deleted.`)}#tags`);
}

// ---------- account: tags this reader would rather not see ----------

// The routes this file answers. server.js walks the tables in order
// and hands the first match a context: the request, the response, who is
// asking, the parsed URL and the regex groups.
/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['GET', '/admin', (c) => handleAdminPage(c.req, c.res, c.user, c.url.searchParams)],
  ['POST', '/admin/invite-code/generate', (c) => handleAdminGenerateInviteCode(c.req, c.res, c.user)],
  ['POST', '/admin/invite-code/close', (c) => handleAdminCloseRegistration(c.req, c.res, c.user)],
  ['POST', '/admin/tags', (c) => handleAdminCreateTag(c.req, c.res, c.user)],
  ['POST', '/admin/wiki/sync', (c) => handleAdminSyncWiki(c.req, c.res, c.user)],
  ['GET', '/admin/backup', (c) => handleAdminBackup(c.req, c.res, c.user)],
  ['POST', '/admin/backup/now', (c) => handleAdminBackupNow(c.req, c.res, c.user)],
  ['POST', '/admin/backup/restore', (c) => handleAdminRestore(c.req, c.res, c.user)],
  ['POST', /^\/admin\/users\/(\d+)\/password$/, (c) => handleAdminSetPassword(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/admin\/users\/(\d+)\/lock$/, (c) => handleAdminLockUser(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/admin\/users\/(\d+)\/unlock$/, (c) => handleAdminUnlockUser(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/admin\/users\/(\d+)\/delete$/, (c) => handleAdminDeleteUser(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/admin\/invite-code\/named\/(\d+)\/revoke$/, (c) => handleAdminRevokeNamedInvite(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/admin\/users\/(\d+)\/reset-link$/, (c) => handleAdminGenerateResetLink(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/admin\/reset-link\/(\d+)\/revoke$/, (c) => handleAdminRevokeResetLink(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/admin\/tags\/(\d+)$/, (c) => handleAdminUpdateTag(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/admin\/tags\/(\d+)\/approve$/, (c) => handleAdminApproveTag(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/admin\/tags\/(\d+)\/merge$/, (c) => handleAdminMergeTag(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/admin\/tags\/(\d+)\/delete$/, (c) => handleAdminDeleteTag(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', '/admin/invite-code/named', (c) => handleAdminCreateNamedInvite(c.req, c.res, c.user)],
];

module.exports = {
  handleAdminApproveTag,
  handleAdminBackup,
  handleAdminBackupNow,
  handleAdminRestore,
  handleAdminCloseRegistration,
  handleAdminCreateNamedInvite,
  handleAdminCreateTag,
  handleAdminDeleteTag,
  handleAdminDeleteUser,
  handleAdminGenerateInviteCode,
  handleAdminGenerateResetLink,
  handleAdminLockUser,
  handleAdminMergeTag,
  handleAdminPage,
  handleAdminRevokeNamedInvite,
  handleAdminRevokeResetLink,
  handleAdminSetPassword,
  handleAdminSyncWiki,
  handleAdminUnlockUser,
  handleAdminUpdateTag,
  routes,
};
