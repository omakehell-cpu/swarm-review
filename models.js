// models.js -- thin query helpers around the SQLite db.
'use strict';

const db = require('./db');
const auth = require('./auth');

const DELETED_USER_USERNAME = 'deleted-user';

// ---------- users ----------
// Excludes the "deleted-user" placeholder (seeded by db.js at startup) so
// "is this the very first real registration" checks (see server.js) still
// work -- otherwise the placeholder's existence would make every install
// think a first user already registered, and nobody would become admin.
const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users WHERE username != ?').get(DELETED_USER_USERNAME).n;

const getUserByUsername = (username) =>
  db.prepare('SELECT * FROM users WHERE username = ?').get(username);

const getUserById = (id) =>
  db.prepare('SELECT * FROM users WHERE id = ?').get(id);

const listUsers = () =>
  db.prepare('SELECT id, username, display_name, is_admin FROM users ORDER BY display_name').all();

// ---------- admin: user management ----------
// Excludes the "deleted-user" placeholder -- it's an internal bookkeeping
// account, not a real member, and shouldn't show up (or be actionable) in
// the admin panel.
function listUsersForAdmin() {
  return db.prepare(`
    SELECT id, username, display_name, is_admin, created_at, last_seen_at,
           failed_login_attempts, locked_at, locked_reason
    FROM users
    WHERE username != ?
    ORDER BY created_at ASC
  `).all(DELETED_USER_USERNAME);
}

function getPlaceholderUserId() {
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(DELETED_USER_USERNAME);
  return row ? row.id : null;
}

function adminSetPassword(userId, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

// Permanent. The account itself is removed, but anything the user
// authored (stories, chapters, comments) is reassigned to the "Deleted
// user" placeholder rather than deleted with them, so the group doesn't
// lose chapters or discussion just because someone's account went away.
function adminDeleteUser(userId) {
  const placeholderId = getPlaceholderUserId();
  if (!placeholderId) throw new Error('The "deleted-user" placeholder account is missing; cannot safely delete a user.');
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE stories SET author_id = ? WHERE author_id = ?').run(placeholderId, userId);
    db.prepare('UPDATE chapters SET author_id = ? WHERE author_id = ?').run(placeholderId, userId);
    db.prepare('UPDATE comments SET author_id = ? WHERE author_id = ?').run(placeholderId, userId);
    db.prepare('UPDATE comments SET resolved_by = NULL WHERE resolved_by = ?').run(userId);
    db.prepare('UPDATE invite_codes SET created_by = NULL WHERE created_by = ?').run(userId);
    db.prepare('UPDATE invite_codes SET used_by = NULL WHERE used_by = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function createUser({ username, displayName, passwordHash, isAdmin }) {
  // last_seen_at is set explicitly (via the SQL-side datetime('now'), not a
  // bound value) rather than relying on the column's default, since a
  // database migrated by db.js's ensureColumn() has no such default -- see
  // the comment there.
  const stmt = db.prepare(
    "INSERT INTO users (username, display_name, password_hash, is_admin, last_seen_at) VALUES (?, ?, ?, ?, datetime('now'))"
  );
  const info = stmt.run(username, displayName, passwordHash, isAdmin ? 1 : 0);
  return getUserById(Number(info.lastInsertRowid));
}

// Returns the user's *previous* last_seen_at (for computing "what's new
// since you last checked" badges) and bumps it to now in the same call.
// SQLite's datetime('now') strings sort/compare correctly as plain text,
// so callers can pass this straight into a "created_at > ?" comparison
// without any date parsing.
function bumpLastSeen(userId) {
  const previous = db.prepare('SELECT last_seen_at FROM users WHERE id = ?').get(userId)?.last_seen_at || null;
  db.prepare("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?").run(userId);
  return previous;
}

// ---------- login lockout ----------
// After ACCOUNT_LOCKOUT_THRESHOLD (3) consecutive wrong passwords, the
// account is locked (locked_at set) and can't log in -- even with the
// right password -- until an admin reactivates it. A successful login
// resets the counter back to zero.
function recordFailedLogin(userId) {
  const row = db.prepare('SELECT failed_login_attempts FROM users WHERE id = ?').get(userId);
  const attempts = (row ? row.failed_login_attempts : 0) + 1;
  if (attempts >= auth.ACCOUNT_LOCKOUT_THRESHOLD) {
    db.prepare("UPDATE users SET failed_login_attempts = ?, locked_at = datetime('now'), locked_reason = 'failed_attempts' WHERE id = ?")
      .run(attempts, userId);
    return { attempts, locked: true };
  }
  db.prepare('UPDATE users SET failed_login_attempts = ? WHERE id = ?').run(attempts, userId);
  return { attempts, locked: false };
}

function resetFailedLogins(userId) {
  db.prepare('UPDATE users SET failed_login_attempts = 0 WHERE id = ?').run(userId);
}

function adminLockAccount(userId) {
  db.prepare("UPDATE users SET locked_at = datetime('now'), locked_reason = 'admin' WHERE id = ?").run(userId);
}

function adminUnlockAccount(userId) {
  db.prepare("UPDATE users SET locked_at = NULL, locked_reason = NULL, failed_login_attempts = 0 WHERE id = ?").run(userId);
}

// ---------- invite codes ----------
// Single-use: at most one row is active() at a time. Registering with a
// code only *validates* it here -- markInviteCodeUsed() is called
// separately, after the new user is actually created, so a code isn't
// burned on a registration attempt that fails for some other reason
// (username taken, weak password, etc).
function validateInviteCode(code, username) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) return null;
  const row = db.prepare(
    'SELECT * FROM invite_codes WHERE code = ? AND active = 1 AND used_at IS NULL'
  ).get(normalizedCode);
  if (!row) return null;
  // A named invite (see createNamedInviteCode) only works for the exact
  // username it was created for; a generic invite (username IS NULL, the
  // original behaviour) works for whoever registers with it first.
  if (row.username) {
    const normalizedUsername = String(username || '').trim().toLowerCase();
    if (row.username !== normalizedUsername) return null;
  }
  return row;
}

function markInviteCodeUsed(codeId, usedByUserId) {
  db.prepare("UPDATE invite_codes SET active = 0, used_at = datetime('now'), used_by = ? WHERE id = ?").run(usedByUserId, codeId);
}

function getActiveInviteCode() {
  return db.prepare(`
    SELECT ic.*, u.display_name AS created_by_name
    FROM invite_codes ic LEFT JOIN users u ON u.id = ic.created_by
    WHERE ic.active = 1 AND ic.username IS NULL ORDER BY ic.id DESC LIMIT 1
  `).get() || null;
}

function listInviteCodes() {
  return db.prepare(`
    SELECT ic.*, cu.display_name AS created_by_name, uu.display_name AS used_by_name
    FROM invite_codes ic
    LEFT JOIN users cu ON cu.id = ic.created_by
    LEFT JOIN users uu ON uu.id = ic.used_by
    ORDER BY ic.id DESC
  `).all();
}

// ---------- named (per-person) invite codes ----------
// Unlike the generic invite code above (one at a time, open to whoever
// registers first), a named invite is scoped to one specific username: an
// admin picks a username, gets a code back, and only that exact username
// can register with that code. Any number of named invites can be pending
// at once, independently of the generic code and of each other.
function createNamedInviteCode(username, createdBy) {
  const normalized = String(username || '').trim().toLowerCase();
  let code;
  do {
    code = auth.generateInviteCode();
  } while (db.prepare('SELECT 1 FROM invite_codes WHERE code = ?').get(code));

  db.exec('BEGIN');
  try {
    // Replace any earlier pending invite for the same username instead of
    // stacking up multiple live codes for one person.
    db.prepare(
      'UPDATE invite_codes SET active = 0 WHERE active = 1 AND used_at IS NULL AND username = ?'
    ).run(normalized);
    const info = db.prepare(
      'INSERT INTO invite_codes (code, active, created_by, username) VALUES (?, 1, ?, ?)'
    ).run(code, createdBy, normalized);
    db.exec('COMMIT');
    return getInviteCodeById(Number(info.lastInsertRowid));
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const getInviteCodeById = (id) =>
  db.prepare(`
    SELECT ic.*, u.display_name AS created_by_name
    FROM invite_codes ic LEFT JOIN users u ON u.id = ic.created_by
    WHERE ic.id = ?
  `).get(id);

// Pending = scoped to a username, still active, not used yet -- i.e. an
// invite the admin has sent out that nobody has registered with.
function listPendingNamedInvites() {
  return db.prepare(`
    SELECT ic.*, u.display_name AS created_by_name
    FROM invite_codes ic LEFT JOIN users u ON u.id = ic.created_by
    WHERE ic.username IS NOT NULL AND ic.active = 1 AND ic.used_at IS NULL
    ORDER BY ic.created_at DESC
  `).all();
}

// Cancels a pending named invite before anyone used it. A no-op (not an
// error) if it was already used or already revoked.
function revokeNamedInvite(id) {
  db.prepare('UPDATE invite_codes SET active = 0 WHERE id = ? AND used_at IS NULL').run(id);
}

// Deactivates whatever code was active and creates a fresh one -- the old
// one stops working immediately, even if nobody had used it yet.
function generateNewInviteCode(createdBy) {
  let code;
  do {
    code = auth.generateInviteCode();
  } while (db.prepare('SELECT 1 FROM invite_codes WHERE code = ?').get(code));

  db.exec('BEGIN');
  try {
    // Only the previous generic code is deactivated -- pending named
    // invites (see createNamedInviteCode) are managed independently and
    // are untouched by generating a new open code.
    db.prepare('UPDATE invite_codes SET active = 0 WHERE active = 1 AND username IS NULL').run();
    db.prepare('INSERT INTO invite_codes (code, active, created_by) VALUES (?, 1, ?)').run(code, createdBy);
    db.exec('COMMIT');
    return getActiveInviteCode();
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Deactivates whatever code was active without creating a new one --
// nobody can register until the admin generates a fresh code again.
function closeRegistration() {
  // Only closes the generic open code; pending named invites keep working,
  // since they were never covered by "open, whoever-registers-first"
  // registration in the first place.
  db.prepare('UPDATE invite_codes SET active = 0 WHERE active = 1 AND username IS NULL').run();
}

// ---------- stories ----------
// `since`: optional SQLite timestamp string -- when given, each story gets
// a `has_new_chapters` flag for chapters published after it. `onlyArchived`
// switches from the normal "active stories" listing to the archived one.
function listStories({ since, onlyArchived = false } = {}) {
  return db.prepare(`
    SELECT s.*, u.display_name AS author_name,
      (SELECT COUNT(*) FROM chapters c WHERE c.story_id = s.id AND c.archived_at IS NULL) AS chapter_count,
      (SELECT MAX(ch.created_at) FROM chapters ch WHERE ch.story_id = s.id AND ch.archived_at IS NULL) AS last_chapter_at,
      (
        SELECT COUNT(*) FROM comments cm
        JOIN chapter_versions v ON v.id = cm.version_id
        JOIN chapters c2 ON c2.id = v.chapter_id
        WHERE c2.story_id = s.id AND cm.status = 'pending' AND cm.parent_id IS NULL AND cm.deleted_at IS NULL
          AND v.version_number = (SELECT MAX(v3.version_number) FROM chapter_versions v3 WHERE v3.chapter_id = c2.id)
      ) AS pending_comments,
      ${since ? `(SELECT EXISTS(SELECT 1 FROM chapters ch3 WHERE ch3.story_id = s.id AND ch3.archived_at IS NULL AND ch3.created_at > @since))` : '0'} AS has_new_chapters
    FROM stories s
    JOIN users u ON u.id = s.author_id
    WHERE s.archived_at IS ${onlyArchived ? 'NOT NULL' : 'NULL'}
    ORDER BY COALESCE(last_chapter_at, s.created_at) DESC
  `).all(since ? { since } : {});
}

const getStoryById = (id) =>
  db.prepare(`
    SELECT s.*, u.display_name AS author_name
    FROM stories s JOIN users u ON u.id = s.author_id
    WHERE s.id = ?
  `).get(id);

function createStory({ title, description, authorId }) {
  const info = db.prepare(
    'INSERT INTO stories (title, description, author_id) VALUES (?, ?, ?)'
  ).run(title, description || '', authorId);
  return getStoryById(Number(info.lastInsertRowid));
}

function archiveStory(storyId) {
  db.prepare("UPDATE stories SET archived_at = datetime('now') WHERE id = ?").run(storyId);
}

function unarchiveStory(storyId) {
  db.prepare('UPDATE stories SET archived_at = NULL WHERE id = ?').run(storyId);
}

// Permanent, irreversible. Cascades to the story's chapters, versions, and
// comments. Callers should only allow this on a story that's already
// archived (see server.js) as a safety gate against one-click data loss.
function deleteStoryForever(storyId) {
  db.prepare('DELETE FROM stories WHERE id = ?').run(storyId);
}

// ---------- chapters ----------
function listChaptersForStory(storyId, { since, onlyArchived = false } = {}) {
  return db.prepare(`
    SELECT c.*, u.display_name AS author_name,
      (SELECT MAX(version_number) FROM chapter_versions v WHERE v.chapter_id = c.id) AS latest_version,
      (SELECT COUNT(*) FROM chapter_versions v WHERE v.chapter_id = c.id) AS version_count,
      (SELECT COUNT(*) FROM comments cm
         JOIN chapter_versions v2 ON v2.id = cm.version_id
         WHERE v2.chapter_id = c.id AND v2.version_number = (
           SELECT MAX(version_number) FROM chapter_versions v3 WHERE v3.chapter_id = c.id
         ) AND cm.status = 'pending' AND cm.parent_id IS NULL AND cm.deleted_at IS NULL) AS pending_comments,
      ${since ? `(c.created_at > @since)` : '0'} AS is_new,
      ${since ? `(
        SELECT EXISTS(
          SELECT 1 FROM comments cm2
          JOIN chapter_versions v4 ON v4.id = cm2.version_id
          WHERE v4.chapter_id = c.id AND cm2.deleted_at IS NULL AND cm2.created_at > @since
        )
      )` : '0'} AS has_new_comments
    FROM chapters c
    JOIN users u ON u.id = c.author_id
    WHERE c.story_id = @storyId AND c.archived_at IS ${onlyArchived ? 'NOT NULL' : 'NULL'}
    ORDER BY c.chapter_number ASC
  `).all(since ? { storyId, since } : { storyId });
}

const getChapterById = (id) =>
  db.prepare(`
    SELECT c.*, u.display_name AS author_name, u.username AS author_username,
           s.title AS story_title, s.author_id AS story_author_id
    FROM chapters c
    JOIN users u ON u.id = c.author_id
    JOIN stories s ON s.id = c.story_id
    WHERE c.id = ?
  `).get(id);

function createChapter({ storyId, title, summary, authorId, content, changelog }) {
  const insertChapter = db.prepare(
    'INSERT INTO chapters (story_id, chapter_number, title, summary, author_id) VALUES (?, ?, ?, ?, ?)'
  );
  const insertVersion = db.prepare(
    'INSERT INTO chapter_versions (chapter_id, version_number, content, changelog) VALUES (?, 1, ?, ?)'
  );
  const nextNumber = (db.prepare(
    'SELECT COALESCE(MAX(chapter_number), 0) AS n FROM chapters WHERE story_id = ?'
  ).get(storyId).n) + 1;

  db.exec('BEGIN');
  try {
    const info = insertChapter.run(storyId, nextNumber, title, summary || '', authorId);
    const chapterId = Number(info.lastInsertRowid);
    insertVersion.run(chapterId, content, changelog || 'Initial version');
    db.exec('COMMIT');
    return getChapterById(chapterId);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function updateChapter({ chapterId, title, summary }) {
  db.prepare('UPDATE chapters SET title = ?, summary = ? WHERE id = ?')
    .run(title, summary || '', chapterId);
  return getChapterById(chapterId);
}

// Edits a chapter "as a document": updates title/summary in place, and if
// the text itself changed, publishes it as a new version (rather than
// rewriting the current version's row) so any comments already anchored to
// the previous text keep pointing at the passage they were actually made
// about. If the text is unchanged, no new version is created.
function editChapter({ chapterId, title, summary, content, changelog }) {
  const latest = getLatestVersion(chapterId);
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE chapters SET title = ?, summary = ? WHERE id = ?')
      .run(title, summary || '', chapterId);

    let newVersion = null;
    if (!latest || latest.content !== content) {
      const nextNumber = (latest ? latest.version_number : 0) + 1;
      const info = db.prepare(
        'INSERT INTO chapter_versions (chapter_id, version_number, content, changelog) VALUES (?, ?, ?, ?)'
      ).run(chapterId, nextNumber, content, changelog || '');
      newVersion = getVersion(Number(info.lastInsertRowid));
    }

    db.exec('COMMIT');
    return { chapter: getChapterById(chapterId), version: newVersion };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Creates a brand-new story together with its first chapter, atomically.
function createStoryWithFirstChapter({ title, description, authorId, chapterTitle, chapterSummary, content }) {
  db.exec('BEGIN');
  try {
    const storyInfo = db.prepare(
      'INSERT INTO stories (title, description, author_id) VALUES (?, ?, ?)'
    ).run(title, description || '', authorId);
    const storyId = Number(storyInfo.lastInsertRowid);

    const chapterInfo = db.prepare(
      'INSERT INTO chapters (story_id, chapter_number, title, summary, author_id) VALUES (?, 1, ?, ?, ?)'
    ).run(storyId, chapterTitle, chapterSummary || '', authorId);
    const chapterId = Number(chapterInfo.lastInsertRowid);

    db.prepare(
      'INSERT INTO chapter_versions (chapter_id, version_number, content, changelog) VALUES (?, 1, ?, ?)'
    ).run(chapterId, content, 'Initial version');

    db.exec('COMMIT');
    return { story: getStoryById(storyId), chapter: getChapterById(chapterId) };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function archiveChapter(chapterId) {
  db.prepare("UPDATE chapters SET archived_at = datetime('now') WHERE id = ?").run(chapterId);
}

function unarchiveChapter(chapterId) {
  db.prepare('UPDATE chapters SET archived_at = NULL WHERE id = ?').run(chapterId);
}

// Permanent, irreversible. Cascades to the chapter's versions and comments.
// Callers should only allow this on a chapter that's already archived (see
// server.js) as a safety gate against one-click data loss.
function deleteChapterForever(chapterId) {
  db.prepare('DELETE FROM chapters WHERE id = ?').run(chapterId);
}

// ---------- versions ----------
const listVersions = (chapterId) =>
  db.prepare(
    'SELECT * FROM chapter_versions WHERE chapter_id = ? ORDER BY version_number DESC'
  ).all(chapterId);

const getVersion = (id) =>
  db.prepare('SELECT * FROM chapter_versions WHERE id = ?').get(id);

const getLatestVersion = (chapterId) =>
  db.prepare(
    'SELECT * FROM chapter_versions WHERE chapter_id = ? ORDER BY version_number DESC LIMIT 1'
  ).get(chapterId);

const getVersionByNumber = (chapterId, versionNumber) =>
  db.prepare(
    'SELECT * FROM chapter_versions WHERE chapter_id = ? AND version_number = ?'
  ).get(chapterId, versionNumber);

function addVersion({ chapterId, content, changelog }) {
  const max = db.prepare(
    'SELECT COALESCE(MAX(version_number), 0) AS n FROM chapter_versions WHERE chapter_id = ?'
  ).get(chapterId).n;
  const nextNumber = max + 1;
  const info = db.prepare(
    'INSERT INTO chapter_versions (chapter_id, version_number, content, changelog) VALUES (?, ?, ?, ?)'
  ).run(chapterId, nextNumber, content, changelog || '');
  return getVersion(Number(info.lastInsertRowid));
}

// ---------- comments ----------
function listCommentsForVersion(versionId) {
  return db.prepare(`
    SELECT cm.*, u.display_name AS author_name, r.display_name AS resolved_by_name
    FROM comments cm
    JOIN users u ON u.id = cm.author_id
    LEFT JOIN users r ON r.id = cm.resolved_by
    WHERE cm.version_id = ?
    ORDER BY cm.start_offset IS NULL, cm.start_offset ASC, cm.created_at ASC
  `).all(versionId);
}

function createComment({ versionId, authorId, startOffset, endOffset, quotedText, body, parentId }) {
  const info = db.prepare(`
    INSERT INTO comments (version_id, author_id, parent_id, start_offset, end_offset, quoted_text, body)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(versionId, authorId, parentId || null, startOffset ?? null, endOffset ?? null, quotedText || null, body);
  return getCommentById(Number(info.lastInsertRowid));
}

const getCommentById = (id) =>
  db.prepare(`
    SELECT cm.*, u.display_name AS author_name
    FROM comments cm JOIN users u ON u.id = cm.author_id
    WHERE cm.id = ?
  `).get(id);

function setCommentStatus({ commentId, status, resolvedBy }) {
  db.prepare(`
    UPDATE comments SET status = ?, resolved_at = datetime('now'), resolved_by = ?
    WHERE id = ?
  `).run(status, resolvedBy, commentId);
  return getCommentById(commentId);
}

function editComment({ commentId, body }) {
  db.prepare("UPDATE comments SET body = ?, edited_at = datetime('now') WHERE id = ?").run(body, commentId);
  return getCommentById(commentId);
}

// Soft delete: the row (and its replies, for thread continuity) stays, but
// the view layer renders it as "[comment retracted]" instead of the body.
function retractComment(commentId) {
  db.prepare("UPDATE comments SET deleted_at = datetime('now') WHERE id = ?").run(commentId);
}

// Chapter author changed their mind after accepting/rejecting -- back to
// pending, as if it hadn't been resolved yet.
function reopenComment(commentId) {
  db.prepare("UPDATE comments SET status = 'pending', resolved_at = NULL, resolved_by = NULL WHERE id = ?").run(commentId);
  return getCommentById(commentId);
}

module.exports = {
  userCount,
  getUserByUsername,
  getUserById,
  listUsers,
  createUser,
  bumpLastSeen,
  recordFailedLogin,
  resetFailedLogins,
  adminLockAccount,
  adminUnlockAccount,
  validateInviteCode,
  markInviteCodeUsed,
  getActiveInviteCode,
  listInviteCodes,
  generateNewInviteCode,
  closeRegistration,
  createNamedInviteCode,
  getInviteCodeById,
  listPendingNamedInvites,
  revokeNamedInvite,
  listUsersForAdmin,
  getPlaceholderUserId,
  adminSetPassword,
  adminDeleteUser,
  DELETED_USER_USERNAME,
  listStories,
  getStoryById,
  createStory,
  archiveStory,
  unarchiveStory,
  deleteStoryForever,
  listChaptersForStory,
  getChapterById,
  createChapter,
  updateChapter,
  editChapter,
  archiveChapter,
  unarchiveChapter,
  deleteChapterForever,
  createStoryWithFirstChapter,
  listVersions,
  getVersion,
  getLatestVersion,
  getVersionByNumber,
  addVersion,
  listCommentsForVersion,
  createComment,
  getCommentById,
  setCommentStatus,
  editComment,
  retractComment,
  reopenComment,
};
