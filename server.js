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
const { parseMarkdown, flattenLength, renderPlainText } = require('./lib/markdown');
const { markdownToDocxBuffer, docxBufferToMarkdown } = require('./lib/docx');
const {
  parseCookies, parseBody, parseMultipartBody, sendHtml, redirect, setCookie, clearCookie,
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

// Turns an uploaded file (from a <input type="file"> field) into markdown
// source text, based on its extension. Returns null if there's no file to
// use (so callers fall back to the pasted-textarea value instead).
function extractUploadedText(file) {
  if (!file || !file.buffer || !file.buffer.length) return null;
  const ext = (file.filename.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  if (ext === 'docx') {
    try {
      return docxBufferToMarkdown(file.buffer);
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
};

function tryServeStatic(req, res, pathname) {
  if (req.method !== 'GET') return false;
  const safeSuffix = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safeSuffix);
  if (!filePath.startsWith(PUBLIC_DIR)) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
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
  return models.getUserById(payload.uid) || null;
}

function login(res, user) {
  const token = auth.signSession({ uid: user.id, exp: Date.now() + auth.SESSION_MAX_AGE_MS });
  setCookie(res, SESSION_COOKIE, token, { maxAgeMs: auth.SESSION_MAX_AGE_MS, secure: SECURE_COOKIES });
}

// ---------------------------------------------------------------------
// route handlers
// ---------------------------------------------------------------------

async function handleLoginPage(req, res, query) {
  const error = query.get('locked') ? 'This account is locked. Ask an admin to reactivate it.' : null;
  sendHtml(res, 200, views.loginPage({ error }));
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

// ---------------------------------------------------------------------
// admin panel
// ---------------------------------------------------------------------

async function handleAdminPage(req, res, user, query) {
  const users = models.listUsersForAdmin();
  const activeInviteCode = models.getActiveInviteCode();
  const inviteCodeHistory = models.listInviteCodes();
  const pendingNamedInvites = models.listPendingNamedInvites();
  const notice = query.get('notice') || null;
  sendHtml(res, 200, views.adminPage({
    user, users, activeInviteCode, inviteCodeHistory, pendingNamedInvites, notice,
  }));
}

async function handleAdminGenerateInviteCode(req, res, user) {
  models.generateNewInviteCode(user.id);
  redirect(res, '/admin?notice=New invite code generated. The old one no longer works.');
}

async function handleAdminCloseRegistration(req, res, user) {
  models.closeRegistration();
  redirect(res, '/admin?notice=Registration closed. No invite code will work until you generate a new one.');
}

async function handleAdminSetPassword(req, res, user, targetUserId) {
  const target = models.getUserById(targetUserId);
  if (!target || target.username === models.DELETED_USER_USERNAME) return sendHtml(res, 404, 'User not found');
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
  if (!target || target.username === models.DELETED_USER_USERNAME) return sendHtml(res, 404, 'User not found');
  if (target.id === user.id) return sendHtml(res, 400, "You can't lock your own account.");
  models.adminLockAccount(targetUserId);
  redirect(res, `/admin?notice=${encodeURIComponent(target.display_name)}'s account is now locked.`);
}

async function handleAdminUnlockUser(req, res, user, targetUserId) {
  const target = models.getUserById(targetUserId);
  if (!target || target.username === models.DELETED_USER_USERNAME) return sendHtml(res, 404, 'User not found');
  models.adminUnlockAccount(targetUserId);
  redirect(res, `/admin?notice=${encodeURIComponent(target.display_name)}'s account is reactivated.`);
}

async function handleAdminDeleteUser(req, res, user, targetUserId) {
  const target = models.getUserById(targetUserId);
  if (!target || target.username === models.DELETED_USER_USERNAME) return sendHtml(res, 404, 'User not found');
  if (target.id === user.id) return sendHtml(res, 400, "You can't delete your own account.");
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
  if (!invite || !invite.username) return sendHtml(res, 404, 'Invite not found');
  models.revokeNamedInvite(inviteId);
  redirect(res, `/admin?notice=Invite for "${encodeURIComponent(invite.username)}" revoked.`);
}

async function handleAdminBackup(req, res, user) {
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

async function handleStories(req, res, user) {
  const since = models.bumpLastSeen(user.id);
  const stories = models.listStories({ since });
  sendHtml(res, 200, views.storiesPage({ user, stories, since }));
}

async function handleArchivedStories(req, res, user) {
  const stories = models.listStories({ onlyArchived: true });
  sendHtml(res, 200, views.archivedStoriesPage({ user, stories }));
}

async function handleArchiveStory(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendHtml(res, 404, 'Story not found');
  if (story.author_id !== user.id) return sendHtml(res, 403, 'Only the story author can archive it.');
  models.archiveStory(storyId);
  redirect(res, `/stories/${storyId}`);
}

async function handleUnarchiveStory(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendHtml(res, 404, 'Story not found');
  if (story.author_id !== user.id) return sendHtml(res, 403, 'Only the story author can unarchive it.');
  models.unarchiveStory(storyId);
  redirect(res, '/archived-stories');
}

async function handleDeleteStory(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendHtml(res, 404, 'Story not found');
  if (story.author_id !== user.id) return sendHtml(res, 403, 'Only the story author can delete it.');
  if (!story.archived_at) return sendHtml(res, 400, 'Archive the story before deleting it forever.');
  models.deleteStoryForever(storyId);
  redirect(res, '/archived-stories');
}

async function handleNewStoryPage(req, res, user) {
  sendHtml(res, 200, views.newStoryPage({ user, values: {} }));
}

async function handleNewStorySubmit(req, res, user) {
  const { fields: body, files } = await parseMultipartBody(req, UPLOAD_LIMIT_BYTES);
  const storyTitle = (body.storyTitle || '').trim();
  const storyDescription = (body.storyDescription || '').trim();
  const chapterTitle = (body.chapterTitle || '').trim();
  const chapterSummary = (body.chapterSummary || '').trim();
  let content = (body.content || '').replace(/\r\n/g, '\n');
  const values = { storyTitle, storyDescription, chapterTitle, chapterSummary, content };

  try {
    const uploaded = extractUploadedText(files.file);
    if (uploaded !== null) { content = uploaded; values.content = content; }
  } catch (err) {
    return sendHtml(res, 400, views.newStoryPage({ user, error: err.message, values }));
  }

  if (!storyTitle) return sendHtml(res, 400, views.newStoryPage({ user, error: 'Missing story title.', values }));
  if (!chapterTitle) return sendHtml(res, 400, views.newStoryPage({ user, error: 'Missing chapter title.', values }));
  if (!content.trim()) return sendHtml(res, 400, views.newStoryPage({ user, error: 'The chapter is empty. Paste some text or upload a .md/.txt/.docx file.', values }));

  const { chapter } = models.createStoryWithFirstChapter({
    title: storyTitle, description: storyDescription, authorId: user.id,
    chapterTitle, chapterSummary, content,
  });
  redirect(res, `/chapters/${chapter.id}`);
}

async function handleStoryPage(req, res, user, storyId, query) {
  const story = models.getStoryById(storyId);
  if (!story) return sendHtml(res, 404, 'Story not found');
  const since = query.get('since') || null;
  const chapters = models.listChaptersForStory(storyId, { since });
  const isStoryAuthor = user.id === story.author_id;
  sendHtml(res, 200, views.storyPage({ user, story, chapters, isStoryAuthor }));
}

async function handleArchivedChaptersForStory(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendHtml(res, 404, 'Story not found');
  const chapters = models.listChaptersForStory(storyId, { onlyArchived: true });
  sendHtml(res, 200, views.archivedChaptersPage({ user, story, chapters }));
}

async function handleArchiveChapter(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendHtml(res, 404, 'Chapter not found');
  if (chapter.author_id !== user.id) return sendHtml(res, 403, 'Only the chapter author can archive it.');
  models.archiveChapter(chapterId);
  redirect(res, `/stories/${chapter.story_id}`);
}

async function handleUnarchiveChapter(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendHtml(res, 404, 'Chapter not found');
  if (chapter.author_id !== user.id) return sendHtml(res, 403, 'Only the chapter author can unarchive it.');
  models.unarchiveChapter(chapterId);
  redirect(res, `/stories/${chapter.story_id}/archived-chapters`);
}

async function handleDeleteChapter(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendHtml(res, 404, 'Chapter not found');
  if (chapter.author_id !== user.id) return sendHtml(res, 403, 'Only the chapter author can delete it.');
  if (!chapter.archived_at) return sendHtml(res, 400, 'Archive the chapter before deleting it forever.');
  const storyId = chapter.story_id;
  models.deleteChapterForever(chapterId);
  redirect(res, `/stories/${storyId}/archived-chapters`);
}

async function handleNewChapterPage(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendHtml(res, 404, 'Story not found');
  if (story.author_id !== user.id) return sendHtml(res, 403, 'Only the story author can add chapters.');
  const chapters = models.listChaptersForStory(storyId);
  sendHtml(res, 200, views.newChapterPage({ user, story, chapters, values: {} }));
}

async function handleNewChapterSubmit(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendHtml(res, 404, 'Story not found');
  if (story.author_id !== user.id) return sendHtml(res, 403, 'Only the story author can add chapters.');

  const existingChapters = models.listChaptersForStory(storyId);
  const { fields: body, files } = await parseMultipartBody(req, UPLOAD_LIMIT_BYTES);
  const title = (body.title || '').trim();
  const summary = (body.summary || '').trim();
  let content = (body.content || '').replace(/\r\n/g, '\n');
  const values = { title, summary, content, position: body.position };

  try {
    const uploaded = extractUploadedText(files.file);
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
  if (!chapter) return sendHtml(res, 404, 'Chapter not found');

  const versions = models.listVersions(chapterId); // desc by version_number
  if (!versions.length) return sendHtml(res, 404, 'This chapter has no versions');

  let currentVersion;
  const requestedV = query.get('v');
  if (requestedV) {
    currentVersion = models.getVersionByNumber(chapterId, Number(requestedV));
  }
  if (!currentVersion) currentVersion = versions[0]; // latest

  const comments = models.listCommentsForVersion(currentVersion.id);
  const isChapterAuthor = user.id === chapter.author_id;

  sendHtml(res, 200, views.chapterPage({
    user, chapter, versions, currentVersion, comments, isChapterAuthor,
  }));
}

async function handleEditChapterPage(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendHtml(res, 404, 'Chapter not found');
  if (chapter.author_id !== user.id) return sendHtml(res, 403, 'Only the chapter author can edit it.');
  const latest = models.getLatestVersion(chapterId);
  sendHtml(res, 200, views.editChapterPage({ user, chapter, latestContent: latest ? latest.content : '', values: {} }));
}

async function handleEditChapterSubmit(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendHtml(res, 404, 'Chapter not found');
  if (chapter.author_id !== user.id) return sendHtml(res, 403, 'Only the chapter author can edit it.');

  const { fields: body, files } = await parseMultipartBody(req, UPLOAD_LIMIT_BYTES);
  const title = (body.title || '').trim();
  const summary = (body.summary || '').trim();
  let content = (body.content || '').replace(/\r\n/g, '\n');
  const changelog = (body.changelog || '').trim();
  const values = { title, summary, content, changelog };
  const latest = models.getLatestVersion(chapterId);

  try {
    const uploaded = extractUploadedText(files.file);
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
  if (!chapter) return sendHtml(res, 404, 'Chapter not found');
  if (chapter.story_author_id !== user.id) return sendHtml(res, 403, 'Only the story author can reorder chapters.');
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
  if (!chapter) return sendHtml(res, 404, 'Chapter not found');
  const versions = models.listVersions(chapterId);
  if (!versions.length) return sendHtml(res, 404, 'This chapter has no versions');

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
    const buffer = markdownToDocxBuffer({ title: chapter.title, markdownSource: version.content });
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': disposition,
      'Content-Length': buffer.length,
    });
    return res.end(buffer);
  }
  sendHtml(res, 400, 'Unsupported download format');
}

async function handleCreateComment(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendHtml(res, 404, 'Chapter not found');
  const body = await parseBody(req);
  const versionId = Number(body.versionId);
  const version = models.getVersion(versionId);
  if (!version || version.chapter_id !== chapterId) return sendHtml(res, 400, 'Invalid version');

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
  if (!parent) return sendHtml(res, 404, 'Comment not found');
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
  if (!comment) return sendHtml(res, 404, 'Comment not found');
  const version = models.getVersion(comment.version_id);
  const chapter = models.getChapterById(version.chapter_id);
  if (chapter.author_id !== user.id) return sendHtml(res, 403, "Only the chapter's author can resolve comments.");

  const body = await parseBody(req);
  const status = body.status === 'accepted' ? 'accepted' : body.status === 'rejected' ? 'rejected' : null;
  if (status) models.setCommentStatus({ commentId, status, resolvedBy: user.id });
  redirect(res, `/chapters/${chapter.id}?v=${version.version_number}`);
}

async function handleCommentEdit(req, res, user, commentId) {
  const comment = models.getCommentById(commentId);
  if (!comment) return sendHtml(res, 404, 'Comment not found');
  if (comment.author_id !== user.id) return sendHtml(res, 403, 'Only the comment author can edit it.');
  if (comment.deleted_at) return sendHtml(res, 400, 'This comment has been retracted.');
  const version = models.getVersion(comment.version_id);
  const body = await parseBody(req);
  const text = (body.body || '').trim();
  if (text) models.editComment({ commentId, body: text.slice(0, 4000) });
  redirect(res, `/chapters/${version.chapter_id}?v=${version.version_number}#comment-${commentId}`);
}

async function handleCommentRetract(req, res, user, commentId) {
  const comment = models.getCommentById(commentId);
  if (!comment) return sendHtml(res, 404, 'Comment not found');
  if (comment.author_id !== user.id) return sendHtml(res, 403, 'Only the comment author can retract it.');
  const version = models.getVersion(comment.version_id);
  if (!comment.deleted_at) models.retractComment(commentId);
  redirect(res, `/chapters/${version.chapter_id}?v=${version.version_number}`);
}

async function handleCommentReopen(req, res, user, commentId) {
  const comment = models.getCommentById(commentId);
  if (!comment) return sendHtml(res, 404, 'Comment not found');
  const version = models.getVersion(comment.version_id);
  const chapter = models.getChapterById(version.chapter_id);
  if (chapter.author_id !== user.id) return sendHtml(res, 403, "Only the chapter's author can reopen comments.");
  if (!comment.deleted_at && comment.status !== 'pending') models.reopenComment(commentId);
  redirect(res, `/chapters/${chapter.id}?v=${version.version_number}#comment-${commentId}`);
}

// ---------------------------------------------------------------------
// router
// ---------------------------------------------------------------------
async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/css/') || pathname.startsWith('/js/')) {
    if (tryServeStatic(req, res, pathname)) return;
  }

  let user = getCurrentUser(req);
  const PUBLIC_ROUTES = new Set(['/login', '/register']);

  // An admin can lock an account that already has a valid, unexpired
  // session cookie open somewhere -- re-checking the DB's locked_at on
  // every request (not just at login) is what makes "lock this account"
  // actually take effect immediately, rather than up to 30 days later.
  if (user && user.locked_at) {
    clearCookie(res, SESSION_COOKIE);
    user = null;
    if (!PUBLIC_ROUTES.has(pathname)) return redirect(res, '/login?locked=1');
  }

  if (!user && !PUBLIC_ROUTES.has(pathname)) {
    return redirect(res, '/login');
  }
  if (user && PUBLIC_ROUTES.has(pathname)) {
    return redirect(res, '/');
  }
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (!user.is_admin) return sendHtml(res, 403, 'Admin access only.');
  }

  try {
    let m;
    if (pathname === '/login' && req.method === 'GET') return handleLoginPage(req, res, url.searchParams);
    if (pathname === '/login' && req.method === 'POST') return handleLoginSubmit(req, res);
    if (pathname === '/register' && req.method === 'GET') return handleRegisterPage(req, res);
    if (pathname === '/register' && req.method === 'POST') return handleRegisterSubmit(req, res);
    if (pathname === '/logout' && req.method === 'POST') return handleLogout(req, res);

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
    if (pathname === '/admin/backup' && req.method === 'GET') return handleAdminBackup(req, res, user);

    if (pathname === '/' && req.method === 'GET') return handleStories(req, res, user);
    if (pathname === '/archived-stories' && req.method === 'GET') return handleArchivedStories(req, res, user);
    if (pathname === '/stories/new' && req.method === 'GET') return handleNewStoryPage(req, res, user);
    if (pathname === '/stories/new' && req.method === 'POST') return handleNewStorySubmit(req, res, user);

    if ((m = pathname.match(/^\/stories\/(\d+)$/)) && req.method === 'GET') {
      return handleStoryPage(req, res, user, Number(m[1]), url.searchParams);
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

    sendHtml(res, 404, 'Page not found');
  } catch (err) {
    console.error(err);
    sendHtml(res, 500, 'Internal server error');
  }
}

const server = http.createServer((req, res) => {
  router(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) sendHtml(res, 500, 'Internal server error');
  });
});

server.listen(PORT, () => {
  console.log(`Swarm Review listening on http://localhost:${PORT}`);
  const activeCode = models.getActiveInviteCode();
  console.log(activeCode
    ? `Invite code for new account registration: ${activeCode.code}`
    : 'Registration is currently closed -- log in as an admin and generate a new invite code from /admin.');
});
