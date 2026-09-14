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

async function handleAdminPage(req, res, user, query) {
  const users = models.listUsersForAdmin();
  const activeInviteCode = models.getActiveInviteCode();
  const inviteCodeHistory = models.listInviteCodes();
  const pendingNamedInvites = models.listPendingNamedInvites();
  const pendingResetLinks = models.listPendingPasswordResetTokens();
  const wikiSyncState = models.getWikiSyncState();
  const notice = query.get('notice') || null;
  sendHtml(res, 200, views.adminPage({
    user, users, activeInviteCode, inviteCodeHistory, pendingNamedInvites, pendingResetLinks, wikiSyncState, notice,
    tagGroups: models.listTagsGrouped(),
    proposedTags: models.listProposedTags(),
  }));
}

async function handleAdminGenerateInviteCode(req, res, user) {
  models.generateNewInviteCode(user.id);
  redirect(res, '/admin?notice=New invite code generated. The old one no longer works.');
}

async function handleAdminCloseRegistration(req, res, _user) {
  models.closeRegistration();
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
  redirect(res, `/admin?notice=Password changed for ${encodeURIComponent(target.display_name)}.`);
}

async function handleAdminLockUser(req, res, user, targetUserId) {
  const target = models.getUserById(targetUserId);
  if (!target || target.username === models.DELETED_USER_USERNAME) return sendError(res, 404, 'User not found', user);
  if (target.id === user.id) return sendError(res, 400, "You can't lock your own account.", user);
  models.adminLockAccount(targetUserId);
  redirect(res, `/admin?notice=${encodeURIComponent(target.display_name)}'s account is now locked.`);
}

async function handleAdminUnlockUser(req, res, user, targetUserId) {
  const target = models.getUserById(targetUserId);
  if (!target || target.username === models.DELETED_USER_USERNAME) return sendError(res, 404, 'User not found', user);
  models.adminUnlockAccount(targetUserId);
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
  const proto = SECURE_COOKIES ? 'https' : 'http';
  const link = `${proto}://${req.headers.host}/reset-password/${resetToken.token}`;
  redirect(res, `/admin?notice=Reset link for ${encodeURIComponent(target.display_name)} (valid 24h, share it only with them): ${encodeURIComponent(link)}`);
}

async function handleAdminRevokeResetLink(req, res, user, tokenId) {
  models.revokePasswordResetToken(tokenId);
  redirect(res, '/admin?notice=Reset link revoked.');
}

async function handleAdminSyncWiki(req, res, _user) {
  try {
    const { pageCount } = await wiki.syncWikiIndex();
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

async function handleAdminBackup(req, res, _user) {
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
  sendHtml(res, 200, views.searchPage({ user, query: q, results: models.searchEverything(q) }));
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
  const tagIds = [...tagIdsFromBody(body), ...proposedTagIdsFromBody(body, user)];
  if (!title) {
    return sendHtml(res, 400, views.editStoryPage({
      user, story, groups: models.listTagsGrouped(), selectedTagIds: tagIds,
      error: 'A story needs a title.',
      values: { title, description, synopsis },
    }));
  }
  models.updateStoryDetails(storyId, { title, description, synopsis });
  models.setStoryTags(storyId, tagIds);
  redirect(res, `/stories/${storyId}`);
}

// ---------- admin: the tag vocabulary ----------
async function handleAdminCreateTag(req, res, _user) {
  const body = await parseBody(req);
  models.createTag({ name: body.name, group: body.group, description: body.description });
  redirect(res, '/admin?notice=Tag added.#tags');
}

async function handleAdminUpdateTag(req, res, user, tagId) {
  const body = await parseBody(req);
  models.updateTag(tagId, { name: body.name, group: body.group, description: body.description });
  redirect(res, '/admin?notice=Tag updated.#tags');
}

async function handleAdminApproveTag(req, res, user, tagId) {
  const body = await parseBody(req);
  models.approveTag(tagId, { name: body.name, group: body.group });
  redirect(res, '/admin?notice=Tag approved.#tags');
}

async function handleAdminMergeTag(req, res, user, tagId) {
  const body = await parseBody(req);
  const into = models.mergeTag(tagId, Number(body.intoTagId));
  redirect(res, `/admin?notice=${encodeURIComponent(into ? `Merged into "${into.name}".` : 'Nothing to merge into.')}#tags`);
}

async function handleAdminDeleteTag(req, res, user, tagId) {
  const tag = models.getTagById(tagId);
  models.deleteTag(tagId);
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
  let pages = models.listWikiPagesForGlossary();
  if (q) {
    const needle = q.toLowerCase();
    pages = pages.filter((p) => p.title.toLowerCase().includes(needle) || p.summary.toLowerCase().includes(needle));
  }
  sendHtml(res, 200, views.glossaryIndexPage({ user, pages, q }));
}

async function handleGlossaryPage(req, res, user, title) {
  const page = models.getWikiPageByTitleLower(title.toLowerCase());
  if (!page) return sendHtml(res, 404, views.glossaryNotFoundPage({ user, title }));
  sendHtml(res, 200, views.glossaryPage({ user, page }));
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
  redirect(res, `/stories/${storyId}`);
}

async function handleUnarchiveStory(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (story.author_id !== user.id) return sendError(res, 403, 'Only the story author can unarchive it.', user);
  models.unarchiveStory(storyId);
  redirect(res, '/archived-stories');
}

async function handleDeleteStory(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (story.author_id !== user.id) return sendError(res, 403, 'Only the story author can delete it.', user);
  if (!story.archived_at) return sendError(res, 400, 'Archive the story before deleting it forever.', user);
  models.deleteStoryForever(storyId);
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
  if (word) models.addStoryDictionaryWord(storyId, word, user.id);
  if (wantsJson) return sendJson(res, 200, { words: models.getStoryDictionary(storyId) });
  redirect(res, `/stories/${storyId}#dictionary`);
}

async function handleRemoveStoryDictionaryWord(req, res, user, storyId, entryId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (!models.canWriteInStory(story, user)) return sendError(res, 403, "Only the story's authors can manage this.", user);
  models.removeStoryDictionaryWord(storyId, entryId);
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
  if (Number.isInteger(userId) && userId > 0) models.addStoryCoauthor(storyId, userId, user.id);
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
  models.removeStoryCoauthor(storyId, coauthorId);
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
  redirect(res, `/stories/${chapter.story_id}`);
}

async function handleUnarchiveChapter(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  if (chapter.author_id !== user.id) return sendError(res, 403, 'Only the chapter author can unarchive it.', user);
  models.unarchiveChapter(chapterId);
  redirect(res, `/stories/${chapter.story_id}/archived-chapters`);
}

async function handleDeleteChapter(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  if (chapter.author_id !== user.id) return sendError(res, 403, 'Only the chapter author can delete it.', user);
  if (!chapter.archived_at) return sendError(res, 400, 'Archive the chapter before deleting it forever.', user);
  const storyId = chapter.story_id;
  models.deleteChapterForever(chapterId);
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
  let content = (body.content || '').replace(/\r\n/g, '\n');
  const values = { title, summary, content, position: body.position };

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
    ? models.insertChapterAt({ storyId, position: insertBeforeNumber, title, summary, authorId: user.id, content })
    : models.createChapter({ storyId, title, summary, authorId: user.id, content });
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
  if (!isChapterAuthor) models.markChapterRead(chapterId, user.id, currentVersion.version_number);

  sendHtml(res, 200, views.chapterPage({
    user, chapter, versions, currentVersion, comments, isChapterAuthor,
    neighbours: models.getChapterNeighbours(chapter),
    readers: models.listChapterReaders(chapterId),
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
  const values = { title, summary, content, changelog };
  const latest = models.getLatestVersion(chapterId);

  try {
    const uploaded = await extractUploadedText(files.file);
    if (uploaded !== null) { content = uploaded; values.content = content; }
  } catch (err) {
    return sendHtml(res, 400, views.editChapterPage({ user, chapter, latestContent: latest ? latest.content : '', error: err.message, values }));
  }

  if (!title) {
    return sendHtml(res, 400, views.editChapterPage({ user, chapter, latestContent: latest ? latest.content : '', error: 'Missing title.', values }));
  }
  if (!content.trim()) {
    return sendHtml(res, 400, views.editChapterPage({ user, chapter, latestContent: latest ? latest.content : '', error: 'The chapter text cannot be empty. Paste some text or upload a .md/.txt/.docx file.', values }));
  }

  const { version } = models.editChapter({ chapterId, title, summary, content, changelog });
  redirect(res, version ? `/chapters/${chapterId}?v=${version.version_number}` : `/chapters/${chapterId}`);
}

async function handleMoveChapter(req, res, user, chapterId, direction) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  if (chapter.story_author_id !== user.id) return sendError(res, 403, 'Only the story author can reorder chapters.', user);
  models.moveChapter(chapterId, direction);
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
  if (status) models.setCommentStatus({ commentId, status, resolvedBy: user.id });
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
  if (text) models.editComment({ commentId, body: text.slice(0, 4000) });
  redirect(res, `/chapters/${version.chapter_id}?v=${version.version_number}#comment-${commentId}`);
}

async function handleCommentRetract(req, res, user, commentId) {
  const comment = models.getCommentById(commentId);
  if (!comment) return sendError(res, 404, 'Comment not found', user);
  if (comment.author_id !== user.id) return sendError(res, 403, 'Only the comment author can retract it.', user);
  const version = models.getVersion(comment.version_id);
  if (!comment.deleted_at) models.retractComment(commentId);
  redirect(res, `/chapters/${version.chapter_id}?v=${version.version_number}`);
}

async function handleCommentReopen(req, res, user, commentId) {
  const comment = models.getCommentById(commentId);
  if (!comment) return sendError(res, 404, 'Comment not found', user);
  const version = models.getVersion(comment.version_id);
  const chapter = models.getChapterById(version.chapter_id);
  if (chapter.author_id !== user.id) return sendError(res, 403, "Only the chapter's author can reopen comments.", user);
  if (!comment.deleted_at && comment.status !== 'pending') models.reopenComment(commentId);
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

    if (pathname === '/search' && req.method === 'GET') return handleSearch(req, res, user, url.searchParams);
    if (pathname === '/tags' && req.method === 'GET') return handleTagsIndex(req, res, user);
    if ((m = pathname.match(/^\/tags\/([^/]+)$/)) && req.method === 'GET') return handleTagPage(req, res, user, m[1]);

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
