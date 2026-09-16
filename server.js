'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL } = require('url');

// --- tiny built-in .env loader (no dependency on the "dotenv" package) ---
(function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    if (key && !(key in process.env)) process.env[key] = value;
  }
})();

const auth = require('./auth');
const models = require('./models');
const views = require('./views');
const { parseMarkdown, flattenLength, renderPlainText, renderHighlighted } = require('./lib/markdown');
const { markdownToDocxBuffer, docxBufferToMarkdown } = require('./lib/docx');
const wiki = require('./lib/wiki');
const taxonomy = require('./lib/glossary-taxonomy');
const storyBible = require('./lib/story-bible');
const entityImages = require('./lib/entity-images');
const castLinks = require('./lib/cast-links');
const docs = require('./lib/docs');
const backups = require('./lib/backup');
const diff = require('./lib/diff');
const {
  parseCookies, parseBody, parseMultipartBody, sendHtml, sendJson, redirect, setCookie, clearCookie,
} = require('./lib/util');

const PORT = Number(process.env.PORT) || 3000;
const SESSION_COOKIE = 'swarm_session';
const UPLOAD_LIMIT_BYTES = 15 * 1024 * 1024;

// When the app is only reachable over plain http:// (e.g. localhost during
// development), the session cookie must NOT be marked Secure -- browsers
// silently refuse to send Secure cookies over a non-HTTPS connection, which
// would make login appear to silently fail. Once the app is actually
// served over https:// (e.g. behind a Cloudflare Tunnel or a reverse proxy
// terminating TLS), set SECURE_COOKIES=1 in the environment/.env file to
// turn this on -- the browser then refuses to ever send the session cookie
// back over a plain http:// connection, which is what you want in
// production.
const SECURE_COOKIES = process.env.SECURE_COOKIES === '1' || process.env.SECURE_COOKIES === 'true';

// Every refusal and every dead link goes through here, so it arrives as a
// page with the site's own type and a way back rather than as a bare
// string in a blank window. `user` may be absent (nobody is signed in, or
// the handler never looked one up), and the layout copes.
function sendError(res, status, message, user) {
  sendHtml(res, status, views.errorPage({ user: user || null, status, message }));
}

// Turns an uploaded file (from a <input type="file"> field) into markdown
// source text, based on its extension. Returns null if there's no file to
// use (so callers fall back to the pasted-textarea value instead).
async function extractUploadedText(file) {
  if (!file || !file.buffer || !file.buffer.length) return null;
  const ext = (file.filename.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
  if (ext === 'docx') {
    try {
      return await docxBufferToMarkdown(file.buffer);
    } catch (err) {
      const wrapped = new Error(`Could not read "${file.filename}": ${err.message}`);
      wrapped.userFacing = true;
      throw wrapped;
    }
  }
  // .md, .txt, or anything else -- treat as plain UTF-8 text.
  return file.buffer.toString('utf8').replace(/\r\n/g, '\n');
}

// ---------------------------------------------------------------------
// static file serving (public/)
// ---------------------------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.aff': 'text/plain; charset=utf-8',
  '.dic': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function tryServeStatic(req, res, pathname) {
  if (req.method !== 'GET') return false;
  const safeSuffix = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safeSuffix);
  if (!filePath.startsWith(PUBLIC_DIR)) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' };
  // The spellchecker's dictionary files (public/dictionary/en.aff, en.dic)
  // never change once downloaded -- worth letting the browser cache them
  // for a while instead of refetching on every visit to a writing page.
  // Everything else under public/ (css/js/html) is served with
  // Cache-Control: no-store, so neither the browser nor Cloudflare ever
  // hold on to a stale copy of this dynamic app.
  if (pathname.startsWith('/dictionary/')) headers['Cache-Control'] = 'public, max-age=86400';
  // The typefaces (public/fonts/) are immutable: a changed font ships
  // under a new filename, so this can be cached hard and forever. Without
  // this they'd be re-downloaded on every single page load, since the
  // default above is no-store -- several hundred KB each time.
  if (pathname.startsWith('/fonts/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// ---------------------------------------------------------------------
// auth helpers
// ---------------------------------------------------------------------
function getCurrentUser(req) {
  const cookies = parseCookies(req);
  const payload = auth.verifySession(cookies[SESSION_COOKIE]);
  if (!payload || !payload.uid) return null;
  const user = models.getUserById(payload.uid);
  if (!user) return null;
  // The password changed (see models.js setOwnPassword/adminSetPassword)
  // since this particular token was issued -- treat it the same as an
  // expired session rather than trusting a token some other, now-stale
  // login handed out.
  if (payload.sv !== user.session_version) return null;
  return user;
}

function login(res, user) {
  const token = auth.signSession({ uid: user.id, sv: user.session_version, exp: Date.now() + auth.SESSION_MAX_AGE_MS });
  setCookie(res, SESSION_COOKIE, token, { maxAgeMs: auth.SESSION_MAX_AGE_MS, secure: SECURE_COOKIES });
}

// ---------------------------------------------------------------------
// route handlers
// ---------------------------------------------------------------------

// A line in the log, and never more than a line: models.recordEvent
// swallows its own errors, so nothing anybody does here can be undone by
// the app failing to write down that they did it. Every call passes the
// label and the link as they are at that moment -- see the note on the
// events table in db.js for why they are not looked up later.
function logEvent(user, kind, opts = {}) {
  if (user) models.recordEvent({ userId: user.id, kind, ...opts });
}

async function handleLoginPage(req, res, query) {
  const error = query.get('locked') ? 'This account is locked. Ask an admin to reactivate it.' : null;
  const notice = query.get('notice') || null;
  sendHtml(res, 200, views.loginPage({ error, notice }));
}

async function handleLoginSubmit(req, res) {
  const body = await parseBody(req);
  // Registration stores the username lowercased (see handleRegisterSubmit),
  // so it has to be normalized the same way here -- otherwise someone who
  // types their username with uppercase letters would never find their
  // account when logging in.
  const username = (body.username || '').trim().toLowerCase();
  const user = models.getUserByUsername(username);

  // Second, explicit safeguard against the "deleted-user" placeholder ever
  // being used to log in, on top of its unusable random password hash.
  if (!user || user.username === models.DELETED_USER_USERNAME) {
    return sendHtml(res, 401, views.loginPage({ error: 'Incorrect username or password.' }));
  }

  if (user.locked_at) {
    return sendHtml(res, 403, views.loginPage({
      error: 'This account is locked. Ask an admin to reactivate it.',
    }));
  }

  if (!auth.verifyPassword(body.password || '', user.password_hash)) {
    const { attempts, locked } = models.recordFailedLogin(user.id);
    const remaining = auth.ACCOUNT_LOCKOUT_THRESHOLD - attempts;
    const error = locked
      ? 'Incorrect password. This account has been locked after 3 failed attempts -- ask an admin to reactivate it.'
      : `Incorrect username or password. ${remaining} attempt${remaining === 1 ? '' : 's'} left before this account is locked.`;
    return sendHtml(res, 401, views.loginPage({ error }));
  }

  models.resetFailedLogins(user.id);
  logEvent(user, 'signed-in');
  login(res, user);
  redirect(res, '/');
}

async function handleRegisterPage(req, res) {
  sendHtml(res, 200, views.registerPage({}));
}

async function handleRegisterSubmit(req, res) {
  const body = await parseBody(req);
  const username = (body.username || '').trim().toLowerCase();
  const displayName = (body.displayName || '').trim();
  const password = body.password || '';
  const inviteCode = (body.inviteCode || '').trim();
  const values = { username, displayName };

  const codeRow = models.validateInviteCode(inviteCode, username);
  if (!codeRow) {
    return sendHtml(res, 403, views.registerPage({
      error: 'That invite code is incorrect, already used, or registration is currently closed. Ask an admin for a new one.',
      values,
    }));
  }
  if (username === models.DELETED_USER_USERNAME) {
    return sendHtml(res, 400, views.registerPage({ error: 'That username is reserved.', values }));
  }
  if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
    return sendHtml(res, 400, views.registerPage({ error: 'Invalid username (3-30 characters, letters/numbers/_/-).', values }));
  }
  if (!displayName) {
    return sendHtml(res, 400, views.registerPage({ error: 'Missing display name.', values }));
  }
  if (password.length < 8) {
    return sendHtml(res, 400, views.registerPage({ error: 'Password must be at least 8 characters long.', values }));
  }
  if (models.getUserByUsername(username)) {
    return sendHtml(res, 409, views.registerPage({ error: 'That username is already taken.', values }));
  }

  const isFirstUser = models.userCount() === 0;
  const user = models.createUser({
    username,
    displayName,
    passwordHash: auth.hashPassword(password),
    isAdmin: isFirstUser,
  });
  models.markInviteCodeUsed(codeRow.id, user.id);
  logEvent(user, 'joined');
  login(res, user);
  redirect(res, '/');
}

async function handleLogout(req, res) {
  clearCookie(res, SESSION_COOKIE);
  redirect(res, '/login');
}

async function handleAccountPage(req, res, user, query) {
  const notice = query.get('notice') || null;
  sendHtml(res, 200, views.accountPage({
    user, notice,
    groups: models.listTagsGrouped(),
    hiddenTagIds: models.listUserHiddenTagIds(user.id),
  }));
}

async function handleAccountPasswordSubmit(req, res, user) {
  const body = await parseBody(req);
  const currentPassword = body.currentPassword || '';
  const newPassword = body.newPassword || '';
  const confirmPassword = body.confirmPassword || '';

  if (!auth.verifyPassword(currentPassword, user.password_hash)) {
    return sendHtml(res, 401, views.accountPage({ user, error: 'Current password is incorrect.' }));
  }
  if (newPassword.length < 8) {
    return sendHtml(res, 400, views.accountPage({ user, error: 'New password must be at least 8 characters long.' }));
  }
  if (newPassword !== confirmPassword) {
    return sendHtml(res, 400, views.accountPage({ user, error: 'New password and confirmation do not match.' }));
  }

  models.setOwnPassword(user.id, auth.hashPassword(newPassword));
  logEvent(user, 'password-changed');
  // Changing the password bumps session_version (see models.js), which
  // invalidates every session for this account -- including the one making
  // this very request. Issue a fresh cookie right away so the user lands on
  // a working, logged-in page instead of being bounced to /login mid-action.
  login(res, models.getUserById(user.id));
  redirect(res, '/account?notice=Password changed. You have been kept logged in here, but signed out everywhere else.');
}

// ---------------------------------------------------------------------
// admin panel
// ---------------------------------------------------------------------

// The name on everything they write. The sign-in name stays put: it is
// how the app knows them, it is in every session, and a group this size
// gains nothing from being able to change it except somebody locked out
// of their own account.
async function handleAccountNameSubmit(req, res, user) {
  const body = await parseBody(req);
  const displayName = (body.displayName || '').trim().slice(0, 60);
  if (!displayName) {
    return sendHtml(res, 400, views.accountPage({ user, error: 'A name cannot be empty.' }));
  }
  models.setDisplayName(user.id, displayName);
  logEvent(user, 'name-changed', { subject: displayName, href: `/users/${user.username}` });
  redirect(res, '/account?notice=Name changed. It shows on everything you have written, not just what you write next.');
}

async function handleProfilePage(req, res, user, username) {
  const person = models.getUserByUsername(String(username).toLowerCase());
  if (!person || person.username === models.DELETED_USER_USERNAME) {
    return sendError(res, 404, 'No such person', user);
  }
  sendHtml(res, 200, views.profilePage({
    user,
    person,
    stats: models.userStats(person.id),
    stories: models.listStoriesForUser(person.id),
    chapters: models.listChaptersByUser(person.id),
  }));
}

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

async function handleResetPasswordPage(req, res, token) {
  const resetToken = models.getValidPasswordResetToken(token);
  if (!resetToken) {
    return sendHtml(res, 400, views.resetPasswordExpiredPage());
  }
  sendHtml(res, 200, views.resetPasswordPage({ token, displayName: resetToken.user_display_name }));
}

async function handleResetPasswordSubmit(req, res, token) {
  const resetToken = models.getValidPasswordResetToken(token);
  if (!resetToken) {
    return sendHtml(res, 400, views.resetPasswordExpiredPage());
  }
  const body = await parseBody(req);
  const password = body.password || '';
  const confirm = body.confirm || '';
  if (password.length < 8) {
    return sendHtml(res, 400, views.resetPasswordPage({
      token, displayName: resetToken.user_display_name, error: 'Password must be at least 8 characters long.',
    }));
  }
  if (password !== confirm) {
    return sendHtml(res, 400, views.resetPasswordPage({
      token, displayName: resetToken.user_display_name, error: 'Passwords do not match.',
    }));
  }
  models.consumePasswordResetToken(resetToken.id, resetToken.user_id, auth.hashPassword(password));
  redirect(res, '/login?notice=Password changed. Log in with your new password.');
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

async function handleSearch(req, res, user, query) {
  const q = (query.get('q') || '').trim();
  sendHtml(res, 200, views.searchPage({ user, query: q, results: models.searchEverything(q, { userId: user.id }) }));
}

// ---------- story tags (vocabulary curated on /admin, see models.js) ----------
// Tag ids arrive from a form as either one value or many, depending on how
// many boxes were ticked -- parseBody hands back a string in the first
// case and an array in the second.
function tagIdsFromBody(body) {
  const raw = body.tagIds === undefined ? [] : [].concat(body.tagIds);
  return raw.map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

// The "can't find one?" field that rides along inside the story form --
// a comma-separated list, since a nested <form> isn't legal HTML and a
// separate page to propose a tag would mean leaving the story half-
// written. Each name becomes a proposed tag (or resolves to the existing
// one, if it turns out the vocabulary already had it).
function proposedTagIdsFromBody(body, user) {
  return String(body.proposeTags || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((name) => models.proposeTag({ name, userId: user.id }))
    .filter(Boolean)
    .map((tag) => tag.id);
}

async function handleTagsIndex(req, res, user) {
  sendHtml(res, 200, views.tagsIndexPage({ user, groups: models.listTagsGrouped() }));
}

async function handleTagPage(req, res, user, slug) {
  const tag = models.getTagBySlug(slug);
  if (!tag) return sendHtml(res, 404, views.tagNotFoundPage({ user, slug }));
  const stories = models.listStories({ tagIds: [tag.id] });
  const tagsByStory = models.tagsForStories(stories.map((s) => s.id));
  sendHtml(res, 200, views.tagPage({ user, tag, stories, tagsByStory }));
}

async function handleEditStoryPage(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (story.author_id !== user.id) return sendError(res, 403, 'Only the story author can edit its details.', user);
  sendHtml(res, 200, views.editStoryPage({
    user,
    story,
    groups: models.listTagsGrouped(),
    selectedTagIds: models.getStoryTags(storyId).map((t) => t.id),
  }));
}

async function handleEditStorySubmit(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (story.author_id !== user.id) return sendError(res, 403, 'Only the story author can edit its details.', user);

  const body = await parseBody(req);
  const title = (body.title || '').trim();
  const description = (body.description || '').trim();
  const synopsis = (body.synopsis || '').trim();
  const status = body.status;
  const tagIds = [...tagIdsFromBody(body), ...proposedTagIdsFromBody(body, user)];
  if (!title) {
    return sendHtml(res, 400, views.editStoryPage({
      user, story, groups: models.listTagsGrouped(), selectedTagIds: tagIds,
      error: 'A story needs a title.',
      values: { title, description, synopsis },
    }));
  }
  models.updateStoryDetails(storyId, { title, description, synopsis, status });
  models.setStoryTags(storyId, tagIds);
  logEvent(user, 'story-edited', { subject: title, href: `/stories/${storyId}`, storyId });
  if (status && status !== story.status) {
    logEvent(user, 'status-changed', { subject: `${title}: ${status}`, href: `/stories/${storyId}`, storyId });
  }
  redirect(res, `/stories/${storyId}`);
}

// ---------- admin: the tag vocabulary ----------
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
async function handleHiddenTagsSubmit(req, res, user) {
  const body = await parseBody(req);
  models.setUserHiddenTags(user.id, tagIdsFromBody(body));
  redirect(res, '/account?notice=Hidden tags saved.');
}

// ---------- glossary (a local, offline mirror of the shared-universe
// wiki -- see lib/wiki.js) ----------
async function handleGlossaryIndex(req, res, user, query) {
  const q = (query.get('q') || '').trim();
  const category = (query.get('category') || '').trim();
  const kind = (query.get('kind') || '').trim();
  const status = (query.get('status') || '').trim();
  const view = (query.get('view') || '').trim();
  const all = models.listWikiPagesForGlossary();
  const byPage = models.categoriesByPage();

  // No filter of any sort means the front page: three doors and a printed
  // directory, rather than dropping the reader into 691 rows.
  if (!q && !category && !kind && !status && view !== 'all') {
    return sendHtml(res, 200, views.glossaryDirectoryPage({
      user,
      totalPages: all.length,
      kinds: taxonomy.countKinds(all, byPage),
      families: taxonomy.groupIntoFamilies(models.listWikiCategories()),
    }));
  }

  const pages = taxonomy.selectPages(all, byPage, { kind, category, status, q });
  const heading = category || (kind && taxonomy.KIND_LABELS[kind])
    || (q ? `Search: ${q}` : 'Every page');
  // The state chips are counted before the state filter is applied, so
  // picking one does not make the others vanish from under the cursor.
  const beforeStatus = taxonomy.selectPages(all, byPage, { kind, category, q });
  sendHtml(res, 200, views.glossaryListPage({
    user, pages, byPage, heading, q, kind, category, status, view,
    statusCounts: taxonomy.statusCounts(beforeStatus, byPage),
    totalPages: all.length,
  }));
}

async function handleGlossaryPage(req, res, user, title) {
  const page = models.getWikiPageByTitleLower(title.toLowerCase());
  if (!page) return sendHtml(res, 404, views.glossaryNotFoundPage({ user, title }));
  // The summaries of everything this page links to, for the previews in
  // its margin. Read from the same local copy as the page itself -- the
  // glossary never reaches out to the wiki to render anything.
  const linked = (String(page.content_html || '').match(/<a href="\/glossary\/([^"]+)"/g) || [])
    .map((tag) => {
      const m = tag.match(/\/glossary\/([^"]+)/);
      try { return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; }
    })
    .filter(Boolean);
  sendHtml(res, 200, views.glossaryPage({
    user,
    page,
    summaries: models.summariesForTitles(linked),
    categories: models.categoriesByPage().get(page.title_lower) || [],
  }));
}

// ---------- help and the changelog (see lib/docs.js) ----------
async function handleHelpIndex(req, res, user) {
  sendHtml(res, 200, views.helpIndexPage({
    user,
    topics: docs.listHelpTopics(),
    releases: docs.listReleases(),
    unread: docs.hasUnreadReleases(user),
  }));
}

async function handleChangelog(req, res, user) {
  // What they had seen before this visit is what the marks are about, so
  // it is read first and the column moved on afterwards.
  const seenAt = user.changelog_seen_at || null;
  models.markChangelogSeen(user.id, docs.latestReleaseDate());
  sendHtml(res, 200, views.changelogPage({ user, releases: docs.listReleases(), seenAt }));
}

async function handleHelpTopic(req, res, user, slug) {
  const topic = docs.getHelpTopic(slug);
  if (!topic) return sendError(res, 404, 'No such how-to', user);
  sendHtml(res, 200, views.helpTopicPage({ user, topic, topics: docs.listHelpTopics() }));
}

// ---------- the story bible (per story: its people, places and things) ----------
// Reading is open to everybody who can read the story; writing is the same
// right as adding a chapter -- the owner and the coauthors -- so a reviewer
// cannot quietly rewrite who somebody is.

function bibleGuard(res, user, storyId, { write = false } = {}) {
  const story = models.getStoryById(storyId);
  if (!story) { sendError(res, 404, 'Story not found', user); return null; }
  if (write && !models.canWriteInStory(story, user)) {
    sendError(res, 403, "Only the story's authors can change its bible.", user);
    return null;
  }
  // A private bible is not a 404 -- pretending it does not exist would be
  // a lie about a button its story page does not show anyway.
  if (!models.canReadBible(story, user)) {
    sendError(res, 403, "This story's bible is private to the people who write it.", user);
    return null;
  }
  return story;
}

// The entry, its story, and whether this person may change it -- the three
// things every /bible/:id route needs before it can do anything.
function entityGuard(res, user, entityId, { write = false } = {}) {
  const entity = models.getStoryEntity(entityId);
  if (!entity) { sendError(res, 404, 'Not in this bible', user); return null; }
  const story = models.getStoryById(entity.story_id);
  if (!story) { sendError(res, 404, 'Story not found', user); return null; }
  const canWrite = models.canWriteInStory(story, user);
  if (write && !canWrite) {
    sendError(res, 403, "Only the story's authors can change its bible.", user);
    return null;
  }
  if (!models.canReadBible(story, user)) {
    sendError(res, 403, "This story's bible is private to the people who write it.", user);
    return null;
  }
  return { entity, story, canWrite };
}

async function handleBibleIndex(req, res, user, storyId, query) {
  const story = bibleGuard(res, user, storyId);
  if (!story) return;
  const kind = (query.get('kind') || '').trim();
  const q = (query.get('q') || '').trim().toLowerCase();
  const sort = Object.prototype.hasOwnProperty.call(models.ENTITY_SORTS, query.get('sort') || '')
    ? String(query.get('sort')) : 'name';
  const { counts, total } = models.storyBibleCounts(storyId);
  let entities = models.listStoryEntities(storyId, { kind: kind || undefined, sort });
  // The filter box does this in the page without a round trip; this is the
  // same filter for a browser with no JavaScript, and for a shared link.
  if (q) {
    entities = entities.filter((e) => `${e.name} ${e.summary} ${e.alias_list || ''}`.toLowerCase().includes(q));
  }
  sendHtml(res, 200, views.bibleIndexPage({
    user, story, entities, counts, total, kind, sort,
    canWrite: models.canWriteInStory(story, user),
    isOwner: story.author_id === user.id,
    conflicts: models.storyBibleNameConflicts(storyId),
    covers: models.coverImagesFor(storyId),
    notice: query.get('notice') || '',
  }));
}

async function handleNewEntityPage(req, res, user, storyId) {
  const story = bibleGuard(res, user, storyId, { write: true });
  if (!story) return;
  sendHtml(res, 200, views.entityFormPage({ user, story, ...entityFormExtras(storyId, null) }));
}

function entityFieldsFromBody(body) {
  return {
    kind: body.kind,
    name: body.name,
    summary: body.summary,
    description: body.description,
    secret: body.secret,
    status: body.status,
    role: body.role,
    aliases: storyBible.parseAliases(body.aliases || '', body.name || ''),
    // Template slots and free extras post the same pair of inputs, so
    // there is one code path and one set of rules for both.
    fields: storyBible.parseFields(body.fieldLabel, body.fieldValue),
  };
}

// Everything the entry form needs besides the entry itself.
function entityFormExtras(storyId, entity) {
  return {
    templates: models.fieldTemplatesByKind(storyId),
    usedLabels: models.listUsedFieldLabels(storyId),
    fields: entity ? models.listEntityFields(entity.id) : [],
  };
}

// One click from a name in the prose to an entry in the bible. The entry
// it makes is a stub -- the name and what kind of thing it is -- because
// the name was the part that was stopping anybody, and everything else can
// be written when there is something to write.
async function handleQuickEntity(req, res, user, storyId) {
  const story = bibleGuard(res, user, storyId, { write: true });
  if (!story) return;
  const body = await parseBody(req);
  const name = storyBible.cleanName(body.name);
  // Where the click came from: a chapter, the editor, the bible itself.
  // Only ever a path inside this app -- never whatever the form was told.
  const back = /^\/[A-Za-z0-9/_?=&.-]*$/.test(String(body.returnTo || ''))
    ? String(body.returnTo) : `/stories/${storyId}/bible`;
  const wantsJson = (req.headers.accept || '').includes('application/json');
  if (!name) {
    return wantsJson ? sendJson(res, 400, { error: 'An entry needs a name.' }) : redirect(res, back);
  }
  const existing = models.getStoryEntityByName(storyId, name);
  if (existing) {
    return wantsJson
      ? sendJson(res, 200, { id: existing.id, name, already: true })
      : redirect(res, `/bible/${existing.id}`);
  }
  const entity = models.createStoryEntity({
    storyId, name, kind: body.kind, summary: body.summary, createdBy: user.id,
  });
  if (!entity) {
    return wantsJson ? sendJson(res, 400, { error: 'That entry could not be created.' }) : redirect(res, back);
  }
  logEvent(user, 'bible-entry-added', { subject: `${entity.name} (${story.title})`, href: `/bible/${entity.id}`, storyId });
  if (wantsJson) return sendJson(res, 200, { id: entity.id, name: entity.name, kind: entity.kind });
  redirect(res, back);
}

// The same question the chapter page answers, asked about a draft that has
// not been saved: the editor posts what is in the textarea and gets back
// the names nothing accounts for. One implementation of what counts as a
// name, rather than a second one in JavaScript drifting away from it.
async function handleUnknownNames(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendJson(res, 404, { error: 'Story not found' });
  if (!models.canWriteInStory(story, user)) return sendJson(res, 403, { error: "Only the story's authors can see this." });
  const body = await parseBody(req);
  sendJson(res, 200, { names: models.missingNamesInText(storyId, String(body.text || '')) });
}

async function handleFieldTemplatePage(req, res, user, storyId) {
  const story = bibleGuard(res, user, storyId, { write: true });
  if (!story) return;
  sendHtml(res, 200, views.fieldTemplatePage({
    user, story, templates: models.fieldTemplatesByKind(storyId), notice: '',
  }));
}

async function handleFieldTemplateSubmit(req, res, user, storyId) {
  const story = bibleGuard(res, user, storyId, { write: true });
  if (!story) return;
  const body = await parseBody(req);
  for (const kind of storyBible.KINDS) {
    models.setFieldTemplate(storyId, kind, storyBible.parseFieldTemplate(body[kind] || ''));
  }
  sendHtml(res, 200, views.fieldTemplatePage({
    user, story, templates: models.fieldTemplatesByKind(storyId), notice: 'Saved.',
  }));
}

async function handleNewEntitySubmit(req, res, user, storyId) {
  const story = bibleGuard(res, user, storyId, { write: true });
  if (!story) return;
  const body = await parseBody(req);
  const fields = entityFieldsFromBody(body);
  if (!storyBible.cleanName(fields.name)) {
    return sendHtml(res, 400, views.entityFormPage({ user, story, ...entityFormExtras(storyId, null), error: 'An entry needs a name.' }));
  }
  // Two entries with one name would each claim the other's appearances, so
  // the uniqueness is the database's rule, not a nicety -- and this is the
  // sentence that explains it instead of a constraint error.
  if (models.getStoryEntityByName(storyId, fields.name)) {
    return sendHtml(res, 400, views.entityFormPage({
      user, story, ...entityFormExtras(storyId, null),
      error: `${storyBible.cleanName(fields.name)} is already in this bible.`,
    }));
  }
  const entity = models.createStoryEntity({ ...fields, storyId, createdBy: user.id });
  if (!entity) return sendError(res, 400, 'That entry could not be created.', user);
  logEvent(user, 'bible-entry-added', { subject: `${entity.name} (${story.title})`, href: `/bible/${entity.id}`, storyId });
  redirect(res, `/bible/${entity.id}`);
}

function renderEntity(res, user, entityId, error = '', status = 200) {
  const guard = entityGuard(res, user, entityId);
  if (!guard) return;
  const { entity, story, canWrite } = guard;
  sendHtml(res, status, views.entityPage({
    user, story, entity, canWrite, error,
    aliases: models.listEntityAliases(entityId),
    links: models.listStoryEntityLinks(entityId),
    appearances: models.listEntityAppearances(entityId),
    chapters: models.listChapterStubs(story.id),
    others: models.listStoryEntities(story.id).filter((e) => e.id !== entity.id),
    images: models.listEntityImages(entityId),
    fields: models.entityFieldsInOrder(entityId, story.id, entity.kind),
  }));
}

async function handleEntityPage(req, res, user, entityId) {
  renderEntity(res, user, entityId);
}

// ---------- pictures of a bible entry ----------
// The bytes live outside public/ and come back through this route, which
// means a picture of somebody's cast needs a session the same way the
// chapter they are in does.
async function handleEntityImage(req, res, user, imageId) {
  const image = models.getEntityImage(imageId);
  if (!image) return sendError(res, 404, 'No such image', user);
  // A picture is part of the bible it belongs to, and behind the same door.
  if (!models.canReadBible(models.getStoryById(image.entity_story_id), user)) {
    return sendError(res, 403, "This story's bible is private to the people who write it.", user);
  }
  const file = entityImages.imagePath(image.filename);
  if (!fs.existsSync(file)) return sendError(res, 404, 'That image is no longer on disk', user);
  res.writeHead(200, {
    'Content-Type': image.content_type,
    'Content-Length': fs.statSync(file).size,
    // The row is never rewritten in place -- a different picture is a
    // different row with a different id -- so this one can be cached hard.
    // Private, because it is behind a session.
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
}

async function handleAddEntityImage(req, res, user, entityId) {
  const guard = entityGuard(res, user, entityId, { write: true });
  if (!guard) return;
  const { entity, story } = guard;
  const { fields, files } = await parseMultipartBody(req, UPLOAD_LIMIT_BYTES);
  const existing = models.listEntityImages(entityId);
  if (existing.length >= entityImages.MAX_IMAGES_PER_ENTRY) {
    return renderEntity(res, user, entityId, `An entry holds up to ${entityImages.MAX_IMAGES_PER_ENTRY} pictures.`);
  }
  let saved;
  try {
    saved = entityImages.saveImage(files.image);
  } catch (err) {
    if (!err.userFacing) throw err;
    return renderEntity(res, user, entityId, err.message);
  }
  models.addEntityImage({
    entityId, storyId: story.id, caption: fields.caption, uploadedBy: user.id, ...saved,
  });
  logEvent(user, 'bible-image-added', { subject: `${entity.name} (${story.title})`, href: `/bible/${entityId}`, storyId: story.id });
  redirect(res, `/bible/${entityId}#pictures`);
}

async function handleEditEntityImage(req, res, user, entityId, imageId, action) {
  const guard = entityGuard(res, user, entityId, { write: true });
  if (!guard) return;
  const image = models.getEntityImage(imageId);
  // An image id from another entry's gallery is not this entry's to move.
  if (!image || image.entity_id !== entityId) return sendError(res, 404, 'No such image', user);
  if (action === 'delete') models.removeEntityImage(imageId);
  else if (action === 'up' || action === 'down') models.moveEntityImage(imageId, action);
  else {
    const body = await parseBody(req);
    models.setEntityImageCaption(imageId, body.caption);
  }
  redirect(res, `/bible/${entityId}#pictures`);
}

async function handleEditEntityPage(req, res, user, entityId) {
  const guard = entityGuard(res, user, entityId, { write: true });
  if (!guard) return;
  sendHtml(res, 200, views.entityFormPage({
    user, story: guard.story, entity: guard.entity, aliases: models.listEntityAliases(entityId),
    ...entityFormExtras(guard.story.id, guard.entity),
  }));
}

async function handleEditEntitySubmit(req, res, user, entityId) {
  const guard = entityGuard(res, user, entityId, { write: true });
  if (!guard) return;
  const { entity, story } = guard;
  const body = await parseBody(req);
  const fields = entityFieldsFromBody(body);
  const aliases = models.listEntityAliases(entityId);
  if (!storyBible.cleanName(fields.name)) {
    return sendHtml(res, 400, views.entityFormPage({
      user, story, entity, aliases, ...entityFormExtras(story.id, entity), error: 'An entry needs a name.',
    }));
  }
  const clash = models.getStoryEntityByName(story.id, fields.name);
  if (clash && clash.id !== entity.id) {
    return sendHtml(res, 400, views.entityFormPage({
      user, story, entity, aliases, ...entityFormExtras(story.id, entity),
      error: `${storyBible.cleanName(fields.name)} is already in this bible.`,
    }));
  }
  const saved = models.updateStoryEntity({ ...fields, entityId, userId: user.id });
  if (!saved) return sendError(res, 400, 'That entry could not be saved.', user);
  logEvent(user, 'bible-entry-edited', { subject: `${saved.name} (${story.title})`, href: `/bible/${saved.id}`, storyId: story.id });
  redirect(res, `/bible/${saved.id}`);
}

async function handleDeleteEntity(req, res, user, entityId) {
  const guard = entityGuard(res, user, entityId, { write: true });
  if (!guard) return;
  const { entity, story } = guard;
  models.deleteStoryEntity(entityId);
  logEvent(user, 'bible-entry-deleted', { subject: `${entity.name} (${story.title})`, href: `/stories/${story.id}/bible`, storyId: story.id });
  redirect(res, `/stories/${story.id}/bible?notice=${encodeURIComponent(`${entity.name} is no longer in the bible.`)}`);
}

async function handleAddEntityLink(req, res, user, entityId) {
  const guard = entityGuard(res, user, entityId, { write: true });
  if (!guard) return;
  const body = await parseBody(req);
  models.setStoryEntityLink({
    storyId: guard.story.id,
    fromId: entityId,
    toId: Number(body.to),
    label: body.label,
    reverseLabel: body.reverse_label,
  });
  redirect(res, `/bible/${entityId}`);
}

async function handleRemoveEntityLink(req, res, user, entityId, linkId) {
  const guard = entityGuard(res, user, entityId, { write: true });
  if (!guard) return;
  models.removeStoryEntityLink(linkId, guard.story.id);
  redirect(res, `/bible/${entityId}`);
}

// The ticked boxes are the whole answer: a chapter the author ticked that
// the scan did not find is an 'include', one they unticked that it did
// find is an 'exclude', and anything they left the way the scan had it
// keeps no override at all -- so a later rewrite of that chapter is still
// free to change its mind.
async function handleSetEntityAppearances(req, res, user, entityId) {
  const guard = entityGuard(res, user, entityId, { write: true });
  if (!guard) return;
  const body = await parseBody(req);
  const ticked = new Set([].concat(body.chapter || []).map(Number).filter(Boolean));
  const scanned = new Set(models.listEntityAppearances(entityId)
    .filter((a) => a.source !== 'manual')
    .map((a) => a.chapter_id));
  for (const chapter of models.listChapterStubs(guard.story.id)) {
    if (chapter.archived_at) continue;
    const wanted = ticked.has(chapter.id);
    const found = scanned.has(chapter.id);
    const state = wanted === found ? 'auto' : (wanted ? 'include' : 'exclude');
    models.setAppearanceOverride({ entityId, chapterId: chapter.id, state, userId: user.id });
  }
  redirect(res, `/bible/${entityId}`);
}

// Whose call it is: the owner's. A coauthor writes in the bible, but
// whether it is anybody else's business is the story's to say, and the
// story has one owner.
async function handleBiblePrivacy(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (story.author_id !== user.id) {
    return sendError(res, 403, "Only the story's owner can change who sees its bible.", user);
  }
  const body = await parseBody(req);
  const isPrivate = body.visibility === 'private';
  models.setBiblePrivate(storyId, isPrivate);
  logEvent(user, isPrivate ? 'bible-closed' : 'bible-opened', {
    subject: story.title, href: `/stories/${storyId}/bible`, storyId,
  });
  redirect(res, `/stories/${storyId}/bible?notice=${encodeURIComponent(isPrivate
    ? 'The bible is now private to the people who write this story.'
    : 'The bible is now readable by everyone who can read the story.')}`);
}

async function handleRescanBible(req, res, user, storyId) {
  const story = bibleGuard(res, user, storyId, { write: true });
  if (!story) return;
  const { rows } = models.rebuildStoryAppearances(storyId);
  redirect(res, `/stories/${storyId}/bible?notice=${encodeURIComponent(`Chapters rescanned -- ${rows} appearance${rows === 1 ? '' : 's'} found.`)}`);
}

async function handleStories(req, res, user, query) {
  const since = models.bumpLastSeen(user.id);
  // Two spellings on purpose: the filter form posts one `tag` per ticked
  // box, while a shared/bookmarked link is nicer as ?tags=a,b.
  const activeSlugs = [
    ...query.getAll('tag'),
    ...(query.get('tags') || '').split(','),
  ].map((s2) => s2.trim()).filter(Boolean);
  const activeTags = activeSlugs.map((slug) => models.getTagBySlug(slug)).filter(Boolean);
  const stories = models.listStories({ since, tagIds: activeTags.map((t) => t.id) });
  const tagsByStory = models.tagsForStories(stories.map((s2) => s2.id));
  const coauthorsByStory = models.coauthorsForStories(stories.map((s2) => s2.id));
  // A reader's hidden tags fold a story away rather than deleting it from
  // the list: they stay reachable behind a "show anyway" summary, since
  // hiding something outright makes an app feel broken when you know the
  // story exists but can't find it.
  const hiddenTagIds = new Set(models.listUserHiddenTagIds(user.id));
  const visible = [];
  const folded = [];
  for (const story of stories) {
    const tags = tagsByStory.get(story.id) || [];
    const hit = tags.filter((t) => hiddenTagIds.has(t.id));
    (hit.length ? folded : visible).push({ ...story, hiddenBy: hit });
  }
  sendHtml(res, 200, views.storiesPage({
    user, stories: visible, folded, since, tagsByStory, coauthorsByStory,
    activeTags, allGroups: models.listTagsGrouped(),
    inbox: models.inboxFor(user.id, { since }),
  }));
}

async function handleArchivedStories(req, res, user) {
  const stories = models.listStories({ onlyArchived: true });
  sendHtml(res, 200, views.archivedStoriesPage({ user, stories }));
}

async function handleArchiveStory(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (story.author_id !== user.id) return sendError(res, 403, 'Only the story author can archive it.', user);
  models.archiveStory(storyId);
  logEvent(user, 'story-archived', { subject: story.title, href: `/stories/${storyId}`, storyId });
  redirect(res, `/stories/${storyId}`);
}

async function handleUnarchiveStory(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (story.author_id !== user.id) return sendError(res, 403, 'Only the story author can unarchive it.', user);
  models.unarchiveStory(storyId);
  logEvent(user, 'story-restored', { subject: story.title, href: `/stories/${storyId}`, storyId });
  redirect(res, '/archived-stories');
}

async function handleDeleteStory(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (story.author_id !== user.id) return sendError(res, 403, 'Only the story author can delete it.', user);
  if (!story.archived_at) return sendError(res, 400, 'Archive the story before deleting it forever.', user);
  models.deleteStoryForever(storyId);
  logEvent(user, 'story-deleted', { subject: story.title });
  redirect(res, '/archived-stories');
}

async function handleNewStoryPage(req, res, user) {
  sendHtml(res, 200, views.newStoryPage({ user, values: {}, groups: models.listTagsGrouped(), selectedTagIds: [] }));
}

async function handleNewStorySubmit(req, res, user) {
  const { fields: body, files } = await parseMultipartBody(req, UPLOAD_LIMIT_BYTES);
  const storyTitle = (body.storyTitle || '').trim();
  const storyDescription = (body.storyDescription || '').trim();
  const chapterTitle = (body.chapterTitle || '').trim();
  const chapterSummary = (body.chapterSummary || '').trim();
  let content = (body.content || '').replace(/\r\n/g, '\n');
  const values = { storyTitle, storyDescription, chapterTitle, chapterSummary, content };
  const tagIds = [...tagIdsFromBody(body), ...proposedTagIdsFromBody(body, user)];
  const retry = (error) => sendHtml(res, 400, views.newStoryPage({
    user, error, values, groups: models.listTagsGrouped(), selectedTagIds: tagIds,
  }));

  try {
    const uploaded = await extractUploadedText(files.file);
    if (uploaded !== null) { content = uploaded; values.content = content; }
  } catch (err) {
    return retry(err.message);
  }

  if (!storyTitle) return retry('Missing story title.');
  if (!chapterTitle) return retry('Missing chapter title.');
  if (!content.trim()) return retry('The chapter is empty. Paste some text or upload a .md/.txt/.docx file.');

  const { story, chapter } = models.createStoryWithFirstChapter({
    title: storyTitle, description: storyDescription, authorId: user.id,
    chapterTitle, chapterSummary, content,
  });
  models.setStoryTags(story.id, tagIds);
  logEvent(user, 'story-started', { subject: story.title, href: `/stories/${story.id}`, storyId: story.id });
  redirect(res, `/chapters/${chapter.id}`);
}

async function handleStoryPage(req, res, user, storyId, query) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  const since = query.get('since') || null;
  const chapters = models.listChaptersForStory(storyId, { since });
  const readersByChapter = models.readersForChapters(chapters.map((c) => c.id));
  const isStoryAuthor = user.id === story.author_id;
  // A coauthor writes in the story but doesn't own it: they get the "Add
  // chapter" button and the dictionary, not "Edit details" or "Archive".
  const canWrite = models.canWriteInStory(story, user);
  const dictionary = canWrite ? models.listStoryDictionaryEntries(storyId) : [];
  sendHtml(res, 200, views.storyPage({
    user, story, chapters, isStoryAuthor, canWrite, dictionary,
    stats: models.getStoryStats(storyId),
    readersByChapter,
    tags: models.getStoryTags(storyId),
    bibleCount: models.storyBibleCounts(storyId).total,
    bibleVisible: models.canReadBible(story, user),
    coauthors: models.listStoryCoauthors(storyId),
    addableCoauthors: isStoryAuthor ? models.listAddableCoauthors(story) : [],
  }));
}

// ---------- per-story spelling exceptions (used by the writing analyzer) ----------

// JSON, fetched once by public/js/writing-analyzer.js when a writing page
// loads, so it knows which "unknown" words to treat as already-approved
// for this particular story.
async function handleGetStoryDictionary(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendJson(res, 404, { error: 'Story not found' });
  if (!models.canWriteInStory(story, user)) return sendJson(res, 403, { error: 'Only the story\'s authors can see this.' });
  sendJson(res, 200, { words: models.getStoryDictionary(storyId) });
}

// Two ways in: the "Story dictionary" form on the story page (a normal
// HTML form submit, expects a redirect back) and the analyzer's "Add to
// dictionary" button on a spelling highlight (a fetch() call that expects
// a small JSON response instead) -- tell them apart by the Accept header
// the browser/script actually sent, rather than adding a second route.
async function handleAddStoryDictionaryWord(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  const wantsJson = (req.headers.accept || '').includes('application/json');
  if (!story) return wantsJson ? sendJson(res, 404, { error: 'Story not found' }) : sendError(res, 404, 'Story not found', user);
  if (!models.canWriteInStory(story, user)) {
    const message = "Only the story's authors can manage this.";
    return wantsJson ? sendJson(res, 403, { error: message }) : sendHtml(res, 403, message);
  }
  const body = await parseBody(req);
  const word = (body.word || '').trim();
  if (word) {
    models.addStoryDictionaryWord(storyId, word, user.id);
    logEvent(user, 'word-added', { subject: word, href: `/stories/${storyId}#dictionary`, storyId });
  }
  if (wantsJson) return sendJson(res, 200, { words: models.getStoryDictionary(storyId) });
  redirect(res, `/stories/${storyId}#dictionary`);
}

async function handleRemoveStoryDictionaryWord(req, res, user, storyId, entryId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (!models.canWriteInStory(story, user)) return sendError(res, 403, "Only the story's authors can manage this.", user);
  models.removeStoryDictionaryWord(storyId, entryId);
  logEvent(user, 'word-removed', { subject: story.title, href: `/stories/${storyId}#dictionary`, storyId });
  redirect(res, `/stories/${storyId}#dictionary`);
}

// ---------- coauthors ----------
// Only the owner hands out and takes back the right to write in their
// story. An admin is not exempt: admins run the site, they don't get a
// key to everyone's drafts.

async function handleAddCoauthor(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (story.author_id !== user.id) return sendError(res, 403, 'Only the story author can add coauthors.', user);
  const body = await parseBody(req);
  const userId = Number(body.userId);
  if (Number.isInteger(userId) && userId > 0) {
    models.addStoryCoauthor(storyId, userId, user.id);
    const added = models.getUserById(userId);
    logEvent(user, 'coauthor-added', {
      subject: added ? `${added.display_name} to ${story.title}` : story.title,
      href: `/stories/${storyId}#authors`, storyId,
    });
  }
  redirect(res, `/stories/${storyId}#authors`);
}

async function handleRemoveCoauthor(req, res, user, storyId, coauthorId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  // Somebody can also step back from a story they were added to, without
  // having to ask the owner to remove them.
  if (story.author_id !== user.id && coauthorId !== user.id) {
    return sendError(res, 403, 'Only the story author can remove a coauthor.', user);
  }
  const removed = models.getUserById(coauthorId);
  models.removeStoryCoauthor(storyId, coauthorId);
  logEvent(user, coauthorId === user.id ? 'coauthor-left' : 'coauthor-removed', {
    subject: coauthorId === user.id ? story.title : `${removed ? removed.display_name : 'somebody'} from ${story.title}`,
    href: `/stories/${storyId}`, storyId,
  });
  redirect(res, story.author_id === user.id ? `/stories/${storyId}#authors` : '/');
}

async function handleArchivedChaptersForStory(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  const chapters = models.listChaptersForStory(storyId, { onlyArchived: true });
  sendHtml(res, 200, views.archivedChaptersPage({ user, story, chapters }));
}

async function handleArchiveChapter(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  if (chapter.author_id !== user.id) return sendError(res, 403, 'Only the chapter author can archive it.', user);
  models.archiveChapter(chapterId);
  logEvent(user, 'chapter-archived', { subject: chapter.title, href: `/stories/${chapter.story_id}`, storyId: chapter.story_id });
  redirect(res, `/stories/${chapter.story_id}`);
}

async function handleUnarchiveChapter(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  if (chapter.author_id !== user.id) return sendError(res, 403, 'Only the chapter author can unarchive it.', user);
  models.unarchiveChapter(chapterId);
  logEvent(user, 'chapter-restored', { subject: chapter.title, href: `/chapters/${chapterId}`, storyId: chapter.story_id, chapterId });
  redirect(res, `/stories/${chapter.story_id}/archived-chapters`);
}

async function handleDeleteChapter(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  if (chapter.author_id !== user.id) return sendError(res, 403, 'Only the chapter author can delete it.', user);
  if (!chapter.archived_at) return sendError(res, 400, 'Archive the chapter before deleting it forever.', user);
  const storyId = chapter.story_id;
  models.deleteChapterForever(chapterId);
  logEvent(user, 'chapter-deleted', { subject: chapter.title, href: `/stories/${storyId}`, storyId });
  redirect(res, `/stories/${storyId}/archived-chapters`);
}

async function handleNewChapterPage(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (!models.canWriteInStory(story, user)) return sendError(res, 403, "Only the story's authors can add chapters.", user);
  const chapters = models.listChaptersForStory(storyId);
  sendHtml(res, 200, views.newChapterPage({ user, story, chapters, values: {} }));
}

async function handleNewChapterSubmit(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (!models.canWriteInStory(story, user)) return sendError(res, 403, "Only the story's authors can add chapters.", user);

  const existingChapters = models.listChaptersForStory(storyId);
  const { fields: body, files } = await parseMultipartBody(req, UPLOAD_LIMIT_BYTES);
  const title = (body.title || '').trim();
  const summary = (body.summary || '').trim();
  const stage = body.stage;
  const arcTitle = (body.arcTitle || '').trim();
  let content = (body.content || '').replace(/\r\n/g, '\n');
  const values = { title, summary, content, position: body.position, stage, arcTitle };

  try {
    const uploaded = await extractUploadedText(files.file);
    if (uploaded !== null) { content = uploaded; values.content = content; }
  } catch (err) {
    return sendHtml(res, 400, views.newChapterPage({ user, story, chapters: existingChapters, error: err.message, values }));
  }

  if (!title) return sendHtml(res, 400, views.newChapterPage({ user, story, chapters: existingChapters, error: 'Missing title.', values }));
  if (!content.trim()) return sendHtml(res, 400, views.newChapterPage({ user, story, chapters: existingChapters, error: 'The chapter is empty. Paste some text or upload a .md/.txt/.docx file.', values }));

  // "position" picks an existing chapter to insert *before*; anything else
  // (including the default "end" option, or a tampered/stale value that no
  // longer matches a real chapter) falls back to appending at the end,
  // exactly like before this feature existed.
  const insertBeforeNumber = existingChapters.some((c) => String(c.chapter_number) === body.position)
    ? Number(body.position)
    : null;

  const chapter = insertBeforeNumber !== null
    ? models.insertChapterAt({ storyId, position: insertBeforeNumber, title, summary, authorId: user.id, content, stage, arcTitle })
    : models.createChapter({ storyId, title, summary, authorId: user.id, content, stage, arcTitle });
  if (arcTitle) {
    logEvent(user, 'arc-started', { subject: arcTitle, href: `/stories/${storyId}`, storyId, chapterId: chapter.id });
  }
  logEvent(user, 'chapter-added', {
    subject: `${title} (${story.title})`, href: `/chapters/${chapter.id}`, storyId, chapterId: chapter.id,
  });
  redirect(res, `/chapters/${chapter.id}`);
}

async function handleChapterPage(req, res, user, chapterId, query) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);

  const versions = models.listVersions(chapterId); // desc by version_number
  if (!versions.length) return sendError(res, 404, 'This chapter has no versions', user);

  let currentVersion;
  const requestedV = query.get('v');
  if (requestedV) {
    currentVersion = models.getVersionByNumber(chapterId, Number(requestedV));
  }
  if (!currentVersion) currentVersion = versions[0]; // latest

  const comments = models.listCommentsForVersion(currentVersion.id);
  const isChapterAuthor = user.id === chapter.author_id;

  // Opening somebody else's chapter is what counts as reading it. Not the
  // author's own: "read by the person who wrote it" tells nobody anything.
  if (!isChapterAuthor && models.markChapterRead(chapterId, user.id, currentVersion.version_number)) {
    logEvent(user, 'chapter-read', {
      subject: chapter.title, href: `/chapters/${chapterId}`, storyId: chapter.story_id, chapterId,
    });
  }

  const story = models.getStoryById(chapter.story_id);
  const bibleVisible = models.canReadBible(story, user);
  sendHtml(res, 200, views.chapterPage({
    user, chapter, versions, currentVersion, comments, isChapterAuthor,
    // Writing the next chapter is a story-level right, not a chapter-level
    // one: a coauthor can add chapters to a story whose other chapters
    // they cannot touch.
    canWrite: models.canWriteInStory(story, user),
    neighbours: models.getChapterNeighbours(chapter),
    readers: models.listChapterReaders(chapterId),
    // A private bible leaks through its chapter just as easily: the names
    // in the margin, the links in the prose, and what each one is. So when
    // it is private, a reader gets the chapter the way they did before any
    // of this existed.
    cast: bibleVisible ? models.listChapterEntities(chapterId) : [],
    findMatches: bibleVisible
      ? castLinks.combinedMatcher(chapter.story_id, wiki.findWikiMatches)
      : wiki.findWikiMatches,
    missingNames: models.canWriteInStory(story, user) ? models.missingNamesInChapter(chapterId) : [],
  }));
}

async function handleChapterDiff(req, res, user, chapterId, query) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  const versions = models.listVersions(chapterId); // newest first
  if (versions.length < 2) {
    // Not a bad request: a chapter nobody has revised yet is the normal
    // state of a new chapter, and the page returned says so. 200 keeps it
    // out of the error logs and out of Cloudflare's 4xx handling.
    return sendHtml(res, 200, views.diffUnavailablePage({ user, chapter }));
  }

  // Default to the most recent pair, which is the comparison anyone
  // opening this page almost always wants.
  const pick = (param, fallback) => {
    const wanted = Number(query.get(param));
    return versions.find((v) => v.version_number === wanted) || fallback;
  };
  const toVersion = pick('to', versions[0]);
  const fromVersion = pick('from', versions.find((v) => v.version_number < toVersion.version_number) || versions[versions.length - 1]);

  // Compare the prose, not the source. Diffing the raw Markdown puts
  // "**Kestrel Anchorage**" and "> " on the page, which is not what the
  // author wrote or what a reader would see, and it reports a word as
  // changed when only its emphasis moved.
  const readable = (version) => renderPlainText(parseMarkdown(version.content), { quoteMarker: '' });
  const blocks = diff.diffVersions(readable(fromVersion), readable(toVersion));
  const summary = diff.summarizeDiff(blocks);
  sendHtml(res, 200, views.chapterDiffPage({
    user, chapter, versions, fromVersion, toVersion, blocks, summary,
    // The prose can be word for word the same while the source isn't --
    // somebody bolded a name, or fixed a link. Worth saying so rather than
    // showing an empty page that looks like the diff is broken.
    formattingOnly: summary.identical && fromVersion.content !== toVersion.content,
  }));
}

async function handleEditChapterPage(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  // Deliberately the chapter's author, not the story's: being a coauthor
  // lets you write your own chapters, not rewrite somebody else's.
  if (chapter.author_id !== user.id) return sendError(res, 403, 'Only the chapter author can edit it.', user);
  const latest = models.getLatestVersion(chapterId);
  // Existing comments are shown alongside the edit form purely as
  // reference while writing (see views.js's editChapterPage) -- they stay
  // anchored to this current latest version regardless of what happens to
  // the text from here.
  const comments = latest ? models.listCommentsForVersion(latest.id) : [];
  sendHtml(res, 200, views.editChapterPage({
    user, chapter, latestContent: latest ? latest.content : '', comments, values: {},
    canWrite: models.canWriteInStory(models.getStoryById(chapter.story_id), user),
    latestVersionNumber: latest ? latest.version_number : 0,
  }));
}

async function handleEditChapterSubmit(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  if (chapter.author_id !== user.id) return sendError(res, 403, 'Only the chapter author can edit it.', user);

  const { fields: body, files } = await parseMultipartBody(req, UPLOAD_LIMIT_BYTES);
  const title = (body.title || '').trim();
  const summary = (body.summary || '').trim();
  let content = (body.content || '').replace(/\r\n/g, '\n');
  const changelog = (body.changelog || '').trim();
  const stage = body.stage;
  const arcTitle = (body.arcTitle || '').trim();
  const values = { title, summary, content, changelog, stage, arcTitle };
  const latest = models.getLatestVersion(chapterId);
  // The version this editor was opened on. A form from before this field
  // existed, or one a script posted, sends nothing -- and an absent answer
  // is not a stale one, so it is let through rather than blocked.
  const baseVersion = Number(body.baseVersion || 0);

  try {
    const uploaded = await extractUploadedText(files.file);
    if (uploaded !== null) { content = uploaded; values.content = content; }
  } catch (err) {
    return sendHtml(res, 400, views.editChapterPage({ user, chapter, latestContent: latest ? latest.content : '', error: err.message, values, latestVersionNumber: baseVersion || (latest ? latest.version_number : 0) }));
  }

  if (!title) {
    return sendHtml(res, 400, views.editChapterPage({ user, chapter, latestContent: latest ? latest.content : '', error: 'Missing title.', values, latestVersionNumber: baseVersion || (latest ? latest.version_number : 0) }));
  }
  if (!content.trim()) {
    return sendHtml(res, 400, views.editChapterPage({
      user, chapter, latestContent: latest ? latest.content : '', values,
      error: 'The chapter text cannot be empty. Paste some text or upload a .md/.txt/.docx file.',
      latestVersionNumber: baseVersion || (latest ? latest.version_number : 0),
    }));
  }

  // Somebody else saved while this editor was open (or you did, in
  // another tab). Their work is in the database and yours is in your
  // hands, and writing yours over theirs without a word is the one thing
  // that must not happen. So: refuse once, show what arrived, and keep
  // every character of what was typed here. The hidden field moves on to
  // their version, so pressing save again is a decision rather than an
  // accident.
  const stale = baseVersion && latest && latest.version_number !== baseVersion
    && content.trim() !== String(latest.content || '').trim();
  if (stale) {
    return sendHtml(res, 409, views.editChapterPage({
      user, chapter, latestContent: latest.content, values,
      canWrite: models.canWriteInStory(models.getStoryById(chapter.story_id), user),
      conflict: {
        version: latest.version_number,
        at: latest.created_at,
        changelog: latest.changelog,
        content: latest.content,
      },
    }));
  }

  const { version } = models.editChapter({ chapterId, title, summary, content, changelog, stage, arcTitle });
  if (stage && stage !== chapter.stage) {
    logEvent(user, 'stage-changed', { subject: `${title}: ${stage}`, href: `/chapters/${chapterId}`, storyId: chapter.story_id, chapterId });
  }
  if (arcTitle !== (chapter.arc_title || '')) {
    logEvent(user, arcTitle ? 'arc-started' : 'arc-removed', {
      subject: arcTitle || chapter.arc_title, href: `/stories/${chapter.story_id}`, storyId: chapter.story_id, chapterId,
    });
  }
  // Saving without changing a word is an edit to the title or the
  // summary, not a new draft of the chapter -- the log says which.
  logEvent(user, version ? 'chapter-revised' : 'chapter-edited', {
    subject: version ? `${title} (v${version.version_number})` : title,
    href: `/chapters/${chapterId}`, storyId: chapter.story_id, chapterId,
  });
  redirect(res, version ? `/chapters/${chapterId}?v=${version.version_number}` : `/chapters/${chapterId}`);
}

async function handleMoveChapter(req, res, user, chapterId, direction) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  if (chapter.story_author_id !== user.id) return sendError(res, 403, 'Only the story author can reorder chapters.', user);
  models.moveChapter(chapterId, direction);
  logEvent(user, 'chapter-moved', { subject: chapter.title, href: `/chapters/${chapterId}`, storyId: chapter.story_id, chapterId });
  redirect(res, `/stories/${chapter.story_id}`);
}

function slugForFilename(title) {
  const slug = String(title || 'chapter')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'chapter';
}

async function handleDownload(req, res, user, chapterId, format, query) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  const versions = models.listVersions(chapterId);
  if (!versions.length) return sendError(res, 404, 'This chapter has no versions', user);

  let version;
  const requestedV = query.get('v');
  if (requestedV) version = models.getVersionByNumber(chapterId, Number(requestedV));
  if (!version) version = versions[0];

  logEvent(user, 'downloaded', {
    subject: `${chapter.title} as .${format}`, href: `/chapters/${chapterId}`, storyId: chapter.story_id, chapterId,
  });

  const filename = `${slugForFilename(chapter.title)}-v${version.version_number}.${format}`;
  const disposition = `attachment; filename="${filename}"`;

  if (format === 'md') {
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': disposition });
    return res.end(version.content);
  }
  if (format === 'txt') {
    const text = renderPlainText(parseMarkdown(version.content));
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': disposition });
    return res.end(text);
  }
  if (format === 'docx') {
    const buffer = await markdownToDocxBuffer({ title: chapter.title, markdownSource: version.content });
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': disposition,
      'Content-Length': buffer.length,
    });
    return res.end(buffer);
  }
  sendError(res, 400, 'Unsupported download format', user);
}

async function handleCreateComment(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  const body = await parseBody(req);
  const versionId = Number(body.versionId);
  const version = models.getVersion(versionId);
  if (!version || version.chapter_id !== chapterId) return sendError(res, 400, 'Invalid version', user);

  const text = (body.body || '').trim();
  if (!text) return redirect(res, `/chapters/${chapterId}?v=${version.version_number}`);

  let start = null; let end = null; let quoted = null;
  if (body.start !== undefined && body.end !== undefined && body.start !== '' && body.end !== '') {
    start = Number(body.start);
    end = Number(body.end);
    quoted = (body.quoted || '').slice(0, 4000);
    const renderedLength = flattenLength(parseMarkdown(version.content));
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > renderedLength) {
      start = null; end = null; quoted = null; // fall back to a general comment rather than reject
    }
  }

  models.createComment({
    versionId, authorId: user.id, startOffset: start, endOffset: end, quotedText: quoted, body: text.slice(0, 4000),
  });
  logEvent(user, 'comment-added', {
    subject: chapter.title, href: `/chapters/${chapterId}?v=${version.version_number}`,
    storyId: chapter.story_id, chapterId,
  });
  redirect(res, `/chapters/${chapterId}?v=${version.version_number}`);
}

async function handleCommentReply(req, res, user, commentId) {
  const parent = models.getCommentById(commentId);
  if (!parent) return sendError(res, 404, 'Comment not found', user);
  const version = models.getVersion(parent.version_id);
  const body = await parseBody(req);
  const text = (body.body || '').trim();
  if (text) {
    models.createComment({
      versionId: parent.version_id, authorId: user.id, parentId: parent.id, body: text.slice(0, 2000),
    });
    const chapter = models.getChapterById(version.chapter_id);
    logEvent(user, 'comment-replied', {
      subject: chapter ? chapter.title : '', href: `/chapters/${version.chapter_id}?v=${version.version_number}`,
      storyId: chapter ? chapter.story_id : null, chapterId: version.chapter_id,
    });
  }
  redirect(res, `/chapters/${version.chapter_id}?v=${version.version_number}`);
}

async function handleCommentStatus(req, res, user, commentId) {
  const comment = models.getCommentById(commentId);
  if (!comment) return sendError(res, 404, 'Comment not found', user);
  const version = models.getVersion(comment.version_id);
  const chapter = models.getChapterById(version.chapter_id);
  if (chapter.author_id !== user.id) return sendError(res, 403, "Only the chapter's author can resolve comments.", user);

  const body = await parseBody(req);
  const status = body.status === 'accepted' ? 'accepted' : body.status === 'rejected' ? 'rejected' : null;
  if (status) {
    models.setCommentStatus({ commentId, status, resolvedBy: user.id });
    logEvent(user, status === 'accepted' ? 'comment-accepted' : 'comment-rejected', {
      subject: chapter.title, href: `/chapters/${chapter.id}?v=${version.version_number}#comment-${commentId}`,
      storyId: chapter.story_id, chapterId: chapter.id,
    });
  }
  redirect(res, `/chapters/${chapter.id}?v=${version.version_number}`);
}

async function handleCommentEdit(req, res, user, commentId) {
  const comment = models.getCommentById(commentId);
  if (!comment) return sendError(res, 404, 'Comment not found', user);
  if (comment.author_id !== user.id) return sendError(res, 403, 'Only the comment author can edit it.', user);
  if (comment.deleted_at) return sendError(res, 400, 'This comment has been retracted.', user);
  const version = models.getVersion(comment.version_id);
  const body = await parseBody(req);
  const text = (body.body || '').trim();
  if (text) {
    models.editComment({ commentId, body: text.slice(0, 4000) });
    logEvent(user, 'comment-edited', { href: `/chapters/${version.chapter_id}#comment-${commentId}`, chapterId: version.chapter_id });
  }
  redirect(res, `/chapters/${version.chapter_id}?v=${version.version_number}#comment-${commentId}`);
}

async function handleCommentRetract(req, res, user, commentId) {
  const comment = models.getCommentById(commentId);
  if (!comment) return sendError(res, 404, 'Comment not found', user);
  if (comment.author_id !== user.id) return sendError(res, 403, 'Only the comment author can retract it.', user);
  const version = models.getVersion(comment.version_id);
  if (!comment.deleted_at) {
    models.retractComment(commentId);
    logEvent(user, 'comment-retracted', { href: `/chapters/${version.chapter_id}`, chapterId: version.chapter_id });
  }
  redirect(res, `/chapters/${version.chapter_id}?v=${version.version_number}`);
}

async function handleCommentReopen(req, res, user, commentId) {
  const comment = models.getCommentById(commentId);
  if (!comment) return sendError(res, 404, 'Comment not found', user);
  const version = models.getVersion(comment.version_id);
  const chapter = models.getChapterById(version.chapter_id);
  if (chapter.author_id !== user.id) return sendError(res, 403, "Only the chapter's author can reopen comments.", user);
  if (!comment.deleted_at && comment.status !== 'pending') {
    models.reopenComment(commentId);
    logEvent(user, 'comment-reopened', {
      subject: chapter.title, href: `/chapters/${chapter.id}#comment-${commentId}`,
      storyId: chapter.story_id, chapterId: chapter.id,
    });
  }
  redirect(res, `/chapters/${chapter.id}?v=${version.version_number}#comment-${commentId}`);
}

// ---------------------------------------------------------------------
// live markdown preview (writing analyzer's optional split view)
// ---------------------------------------------------------------------

// Renders arbitrary pasted/typed markdown to HTML using the exact same
// code that renders the real chapter page (renderHighlighted with an empty
// comment list), so the preview the writer sees while editing always
// matches what readers will actually see once it's published. Stateless --
// doesn't touch any story/chapter, so any logged-in user can call it.
async function handleMarkdownPreview(req, res, _user) {
  const body = await parseBody(req);
  const text = typeof body.text === 'string' ? body.text : '';
  const html = renderHighlighted(parseMarkdown(text), [], wiki.findWikiMatches);
  sendJson(res, 200, { html });
}

// ---------------------------------------------------------------------
// router
// ---------------------------------------------------------------------
// Set on every response, before any route-specific writeHead() runs --
// res.writeHead() merges in whatever was set here via setHeader(), so this
// applies uniformly to pages, static files, JSON, downloads, and 404s alike.
// The app never frames itself or anyone else, never loads scripts/styles/
// fonts/images from another origin, and has no external CDN, so these are
// tight without needing an allowlist.
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
}

async function router(req, res) {
  setSecurityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/css/') || pathname.startsWith('/js/')
      || pathname.startsWith('/dictionary/') || pathname.startsWith('/fonts/')) {
    if (tryServeStatic(req, res, pathname)) return;
  }

  let user = getCurrentUser(req);
  const PUBLIC_ROUTES = new Set(['/login', '/register']);
  // Reachable with or without a session (an admin-generated link, not tied
  // to whoever's currently logged in on this browser -- see
  // handleResetPasswordPage/Submit) -- unlike PUBLIC_ROUTES above, being
  // logged in doesn't redirect away from it either.
  const isResetPasswordRoute = pathname.startsWith('/reset-password/');

  // An admin can lock an account that already has a valid, unexpired
  // session cookie open somewhere -- re-checking the DB's locked_at on
  // every request (not just at login) is what makes "lock this account"
  // actually take effect immediately, rather than up to 30 days later.
  if (user && user.locked_at) {
    clearCookie(res, SESSION_COOKIE);
    user = null;
    if (!PUBLIC_ROUTES.has(pathname) && !isResetPasswordRoute) return redirect(res, '/login?locked=1');
  }

  if (!user && !PUBLIC_ROUTES.has(pathname) && !isResetPasswordRoute) {
    return redirect(res, '/login');
  }
  if (user && PUBLIC_ROUTES.has(pathname)) {
    return redirect(res, '/');
  }
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (!user.is_admin) return sendError(res, 403, 'Admin access only.', user);
  }

  // The screenshots in the how-tos. Below the login check rather than
  // beside the stylesheets: they are pictures of the inside of the app,
  // and everything else about the inside of the app needs a session.
  if (pathname.startsWith('/img/') && tryServeStatic(req, res, pathname)) return;

  try {
    let m;
    if (pathname === '/login' && req.method === 'GET') return handleLoginPage(req, res, url.searchParams);
    if (pathname === '/login' && req.method === 'POST') return handleLoginSubmit(req, res);
    if (pathname === '/register' && req.method === 'GET') return handleRegisterPage(req, res);
    if (pathname === '/register' && req.method === 'POST') return handleRegisterSubmit(req, res);
    if ((m = pathname.match(/^\/reset-password\/([^/]+)$/)) && req.method === 'GET') {
      return handleResetPasswordPage(req, res, m[1]);
    }
    if ((m = pathname.match(/^\/reset-password\/([^/]+)$/)) && req.method === 'POST') {
      return handleResetPasswordSubmit(req, res, m[1]);
    }
    if (pathname === '/logout' && req.method === 'POST') return handleLogout(req, res);
    if (pathname === '/account' && req.method === 'GET') return handleAccountPage(req, res, user, url.searchParams);
    if (pathname === '/account/password' && req.method === 'POST') return handleAccountPasswordSubmit(req, res, user);
    if (pathname === '/account/hidden-tags' && req.method === 'POST') return handleHiddenTagsSubmit(req, res, user);
    if (pathname === '/account/name' && req.method === 'POST') return handleAccountNameSubmit(req, res, user);
    if ((m = pathname.match(/^\/users\/([A-Za-z0-9_.-]+)$/)) && req.method === 'GET') {
      return handleProfilePage(req, res, user, m[1]);
    }
    if (pathname === '/markdown/preview' && req.method === 'POST') return handleMarkdownPreview(req, res, user);

    if (pathname === '/admin' && req.method === 'GET') return handleAdminPage(req, res, user, url.searchParams);
    if (pathname === '/admin/invite-code/generate' && req.method === 'POST') return handleAdminGenerateInviteCode(req, res, user);
    if (pathname === '/admin/invite-code/close' && req.method === 'POST') return handleAdminCloseRegistration(req, res, user);
    if ((m = pathname.match(/^\/admin\/users\/(\d+)\/password$/)) && req.method === 'POST') {
      return handleAdminSetPassword(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/admin\/users\/(\d+)\/lock$/)) && req.method === 'POST') {
      return handleAdminLockUser(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/admin\/users\/(\d+)\/unlock$/)) && req.method === 'POST') {
      return handleAdminUnlockUser(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/admin\/users\/(\d+)\/delete$/)) && req.method === 'POST') {
      return handleAdminDeleteUser(req, res, user, Number(m[1]));
    }
    if (pathname === '/admin/invite-code/named' && req.method === 'POST') {
      return handleAdminCreateNamedInvite(req, res, user);
    }
    if ((m = pathname.match(/^\/admin\/invite-code\/named\/(\d+)\/revoke$/)) && req.method === 'POST') {
      return handleAdminRevokeNamedInvite(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/admin\/users\/(\d+)\/reset-link$/)) && req.method === 'POST') {
      return handleAdminGenerateResetLink(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/admin\/reset-link\/(\d+)\/revoke$/)) && req.method === 'POST') {
      return handleAdminRevokeResetLink(req, res, user, Number(m[1]));
    }
    if (pathname === '/admin/tags' && req.method === 'POST') return handleAdminCreateTag(req, res, user);
    if ((m = pathname.match(/^\/admin\/tags\/(\d+)$/)) && req.method === 'POST') {
      return handleAdminUpdateTag(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/admin\/tags\/(\d+)\/approve$/)) && req.method === 'POST') {
      return handleAdminApproveTag(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/admin\/tags\/(\d+)\/merge$/)) && req.method === 'POST') {
      return handleAdminMergeTag(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/admin\/tags\/(\d+)\/delete$/)) && req.method === 'POST') {
      return handleAdminDeleteTag(req, res, user, Number(m[1]));
    }
    if (pathname === '/admin/wiki/sync' && req.method === 'POST') return handleAdminSyncWiki(req, res, user);
    if (pathname === '/admin/backup' && req.method === 'GET') return handleAdminBackup(req, res, user);
    if (pathname === '/admin/backup/now' && req.method === 'POST') return handleAdminBackupNow(req, res, user);

    if (pathname === '/search' && req.method === 'GET') return handleSearch(req, res, user, url.searchParams);
    if (pathname === '/tags' && req.method === 'GET') return handleTagsIndex(req, res, user);
    if ((m = pathname.match(/^\/tags\/([^/]+)$/)) && req.method === 'GET') return handleTagPage(req, res, user, m[1]);

    if (pathname === '/help' && req.method === 'GET') return handleHelpIndex(req, res, user);
    if (pathname === '/help/changelog' && req.method === 'GET') return handleChangelog(req, res, user);
    // An older or shorter link people will try anyway.
    if (pathname === '/changelog' && req.method === 'GET') return redirect(res, '/help/changelog');
    if ((m = pathname.match(/^\/help\/([a-z0-9-]+)$/)) && req.method === 'GET') {
      return handleHelpTopic(req, res, user, m[1]);
    }
    if (pathname === '/glossary' && req.method === 'GET') return handleGlossaryIndex(req, res, user, url.searchParams);
    if ((m = pathname.match(/^\/glossary\/([^/]+)$/)) && req.method === 'GET') return handleGlossaryPage(req, res, user, m[1]);

    if (pathname === '/' && req.method === 'GET') return handleStories(req, res, user, url.searchParams);
    if (pathname === '/archived-stories' && req.method === 'GET') return handleArchivedStories(req, res, user);
    if (pathname === '/stories/new' && req.method === 'GET') return handleNewStoryPage(req, res, user);
    if (pathname === '/stories/new' && req.method === 'POST') return handleNewStorySubmit(req, res, user);

    if ((m = pathname.match(/^\/stories\/(\d+)$/)) && req.method === 'GET') {
      return handleStoryPage(req, res, user, Number(m[1]), url.searchParams);
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/edit$/)) && req.method === 'GET') {
      return handleEditStoryPage(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/edit$/)) && req.method === 'POST') {
      return handleEditStorySubmit(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/archive$/)) && req.method === 'POST') {
      return handleArchiveStory(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/unarchive$/)) && req.method === 'POST') {
      return handleUnarchiveStory(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/delete$/)) && req.method === 'POST') {
      return handleDeleteStory(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/archived-chapters$/)) && req.method === 'GET') {
      return handleArchivedChaptersForStory(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/authors$/)) && req.method === 'POST') {
      return handleAddCoauthor(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/authors\/(\d+)\/remove$/)) && req.method === 'POST') {
      return handleRemoveCoauthor(req, res, user, Number(m[1]), Number(m[2]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/bible$/)) && req.method === 'GET') {
      return handleBibleIndex(req, res, user, Number(m[1]), url.searchParams);
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/bible$/)) && req.method === 'POST') {
      return handleNewEntitySubmit(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/bible\/new$/)) && req.method === 'GET') {
      return handleNewEntityPage(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/bible\/quick$/)) && req.method === 'POST') {
      return handleQuickEntity(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/bible\/unknown-names$/)) && req.method === 'POST') {
      return handleUnknownNames(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/bible\/fields$/)) && req.method === 'GET') {
      return handleFieldTemplatePage(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/bible\/fields$/)) && req.method === 'POST') {
      return handleFieldTemplateSubmit(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/bible\/privacy$/)) && req.method === 'POST') {
      return handleBiblePrivacy(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/bible\/rescan$/)) && req.method === 'POST') {
      return handleRescanBible(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/bible\/(\d+)$/)) && req.method === 'GET') {
      return handleEntityPage(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/bible\/(\d+)$/)) && req.method === 'POST') {
      return handleEditEntitySubmit(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/bible\/(\d+)\/edit$/)) && req.method === 'GET') {
      return handleEditEntityPage(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/bible\/(\d+)\/delete$/)) && req.method === 'POST') {
      return handleDeleteEntity(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/bible\/(\d+)\/links$/)) && req.method === 'POST') {
      return handleAddEntityLink(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/bible\/(\d+)\/links\/(\d+)\/delete$/)) && req.method === 'POST') {
      return handleRemoveEntityLink(req, res, user, Number(m[1]), Number(m[2]));
    }
    if ((m = pathname.match(/^\/entity-images\/(\d+)$/)) && req.method === 'GET') {
      return handleEntityImage(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/bible\/(\d+)\/images$/)) && req.method === 'POST') {
      return handleAddEntityImage(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/bible\/(\d+)\/images\/(\d+)\/(delete|up|down|caption)$/)) && req.method === 'POST') {
      return handleEditEntityImage(req, res, user, Number(m[1]), Number(m[2]), m[3]);
    }
    if ((m = pathname.match(/^\/bible\/(\d+)\/appearances$/)) && req.method === 'POST') {
      return handleSetEntityAppearances(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/dictionary$/)) && req.method === 'GET') {
      return handleGetStoryDictionary(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/dictionary$/)) && req.method === 'POST') {
      return handleAddStoryDictionaryWord(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/dictionary\/(\d+)\/delete$/)) && req.method === 'POST') {
      return handleRemoveStoryDictionaryWord(req, res, user, Number(m[1]), Number(m[2]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/chapters\/new$/)) && req.method === 'GET') {
      return handleNewChapterPage(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/stories\/(\d+)\/chapters\/new$/)) && req.method === 'POST') {
      return handleNewChapterSubmit(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/chapters\/(\d+)$/)) && req.method === 'GET') {
      return handleChapterPage(req, res, user, Number(m[1]), url.searchParams);
    }
    // Old link some bookmarks might still point to -- send them to the edit page.
    if ((m = pathname.match(/^\/chapters\/(\d+)\/versions\/new$/)) && req.method === 'GET') {
      return redirect(res, `/chapters/${m[1]}/edit`);
    }
    if ((m = pathname.match(/^\/chapters\/(\d+)\/diff$/)) && req.method === 'GET') {
      return handleChapterDiff(req, res, user, Number(m[1]), url.searchParams);
    }
    if ((m = pathname.match(/^\/chapters\/(\d+)\/edit$/)) && req.method === 'GET') {
      return handleEditChapterPage(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/chapters\/(\d+)\/edit$/)) && req.method === 'POST') {
      return handleEditChapterSubmit(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/chapters\/(\d+)\/move-up$/)) && req.method === 'POST') {
      return handleMoveChapter(req, res, user, Number(m[1]), 'up');
    }
    if ((m = pathname.match(/^\/chapters\/(\d+)\/move-down$/)) && req.method === 'POST') {
      return handleMoveChapter(req, res, user, Number(m[1]), 'down');
    }
    if ((m = pathname.match(/^\/chapters\/(\d+)\/archive$/)) && req.method === 'POST') {
      return handleArchiveChapter(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/chapters\/(\d+)\/unarchive$/)) && req.method === 'POST') {
      return handleUnarchiveChapter(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/chapters\/(\d+)\/delete$/)) && req.method === 'POST') {
      return handleDeleteChapter(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/chapters\/(\d+)\/download\.(md|txt|docx)$/)) && req.method === 'GET') {
      return handleDownload(req, res, user, Number(m[1]), m[2], url.searchParams);
    }
    if ((m = pathname.match(/^\/chapters\/(\d+)\/comments$/)) && req.method === 'POST') {
      return handleCreateComment(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/comments\/(\d+)\/reply$/)) && req.method === 'POST') {
      return handleCommentReply(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/comments\/(\d+)\/status$/)) && req.method === 'POST') {
      return handleCommentStatus(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/comments\/(\d+)\/edit$/)) && req.method === 'POST') {
      return handleCommentEdit(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/comments\/(\d+)\/retract$/)) && req.method === 'POST') {
      return handleCommentRetract(req, res, user, Number(m[1]));
    }
    if ((m = pathname.match(/^\/comments\/(\d+)\/reopen$/)) && req.method === 'POST') {
      return handleCommentReopen(req, res, user, Number(m[1]));
    }

    sendError(res, 404, 'There is no page at that address.', user);
  } catch (err) {
    console.error(err);
    sendError(res, 500, 'Something went wrong at our end. The error has been logged.', user);
  }
}

const server = http.createServer((req, res) => {
  router(req, res).catch((err) => {
    console.error(err);
    // No `user` here on purpose: this is the last line of defence, and
    // whatever threw may well be whatever was looking the user up.
    if (!res.headersSent) sendError(res, 500, 'Something went wrong at our end. The error has been logged.');
  });
});

// A copy of the database, daily, without anybody having to remember. Not
// started under test: a suite that spawns thirty servers does not want
// thirty backups of thirty throwaway databases.
if (process.env.NODE_ENV !== 'test') {
  backups.startBackups(models.backupDatabaseTo, (err) => console.error('backup failed:', err.message));
}

server.listen(PORT, () => {
  console.log(`Swarm Review listening on http://localhost:${PORT}`);
  const activeCode = models.getActiveInviteCode();
  console.log(activeCode
    ? `Invite code for new account registration: ${activeCode.code}`
    : 'Registration is currently closed -- log in as an admin and generate a new invite code from /admin.');
});

// The wiki index (see lib/wiki.js) is synced ONLY when an admin clicks
// "Sync now" on /admin (see handleAdminSyncWiki above) -- deliberately no
// automatic background timer. Each sync now pulls every page's full
// content (not just a short summary), which is a much heavier set of
// requests against what is likely a small self-hosted wiki, so this is
// left entirely in a human's hands rather than risking the app hammering
// it on its own schedule.
