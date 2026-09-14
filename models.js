// models.js -- thin query helpers around the SQLite db.
'use strict';

const db = require('./db');
const auth = require('./auth');
const { countWords } = require('./lib/markdown');

const DELETED_USER_USERNAME = 'deleted-user';

// Versions written before chapter_versions.word_count existed have no
// count. Filling them in needs the markdown parser, which db.js has no
// business importing, so it happens here, once, on the first load after
// the column is added.
{
  const missing = db.prepare('SELECT id, content FROM chapter_versions WHERE word_count IS NULL').all();
  if (missing.length) {
    const update = db.prepare('UPDATE chapter_versions SET word_count = ? WHERE id = ?');
    for (const row of missing) update.run(countWords(row.content), row.id);
  }
}

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

// Bumping session_version alongside the password is what actually signs
// out every other open session for this account -- see db.js's comment on
// that column and server.js's getCurrentUser().
function adminSetPassword(userId, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?').run(passwordHash, userId);
}

// Same operation as adminSetPassword, kept as a separate name so call sites
// read clearly (a user changing their own password vs. an admin resetting
// someone else's).
function setOwnPassword(userId, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?').run(passwordHash, userId);
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

// ---------- password reset tokens (admin-generated, self-service from there) ----------
// An admin generates a single-use link for one specific user (see
// server.js's /admin/users/:id/reset-link and this file's
// db.js/password_reset_tokens); the user opens it and picks their own new
// password without the admin ever seeing or setting it.
function createPasswordResetToken(userId, createdBy) {
  let token;
  do {
    token = auth.generateResetToken();
  } while (db.prepare('SELECT 1 FROM password_reset_tokens WHERE token = ?').get(token));

  db.exec('BEGIN');
  try {
    // Replace any earlier pending (unused, unexpired or not) link for this
    // user instead of leaving multiple live links around for one account.
    db.prepare(
      "UPDATE password_reset_tokens SET expires_at = datetime('now') WHERE user_id = ? AND used_at IS NULL"
    ).run(userId);
    const expiresAt = new Date(Date.now() + auth.PASSWORD_RESET_TOKEN_MAX_AGE_MS).toISOString().replace('T', ' ').slice(0, 19);
    const info = db.prepare(
      'INSERT INTO password_reset_tokens (token, user_id, created_by, expires_at) VALUES (?, ?, ?, ?)'
    ).run(token, userId, createdBy, expiresAt);
    db.exec('COMMIT');
    return getPasswordResetTokenById(Number(info.lastInsertRowid));
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const getPasswordResetTokenById = (id) =>
  db.prepare(`
    SELECT prt.*, u.display_name AS user_display_name, u.username AS user_username
    FROM password_reset_tokens prt JOIN users u ON u.id = prt.user_id
    WHERE prt.id = ?
  `).get(id);

// Pending = generated, not used yet, not expired -- i.e. a link the admin
// has sent out that the user hasn't opened and completed yet.
function listPendingPasswordResetTokens() {
  return db.prepare(`
    SELECT prt.*, u.display_name AS user_display_name, u.username AS user_username
    FROM password_reset_tokens prt JOIN users u ON u.id = prt.user_id
    WHERE prt.used_at IS NULL AND prt.expires_at > datetime('now')
    ORDER BY prt.created_at DESC
  `).all();
}

// Cancels a pending link before the user opens it. A no-op (not an error)
// if it was already used or has already expired.
function revokePasswordResetToken(id) {
  db.prepare("UPDATE password_reset_tokens SET expires_at = datetime('now') WHERE id = ? AND used_at IS NULL").run(id);
}

// Valid = exists, not used yet, not expired -- used both to render the
// "pick a new password" form and to check again on submit (the few minutes
// in between are enough for it to have expired or been used elsewhere).
function getValidPasswordResetToken(token) {
  return db.prepare(`
    SELECT prt.*, u.display_name AS user_display_name, u.username AS user_username
    FROM password_reset_tokens prt JOIN users u ON u.id = prt.user_id
    WHERE prt.token = ? AND prt.used_at IS NULL AND prt.expires_at > datetime('now')
  `).get(token);
}

// Sets the user's new password (same session-invalidating effect as
// setOwnPassword/adminSetPassword) and marks the token used, atomically --
// a token must not be usable twice even if two requests race.
function consumePasswordResetToken(tokenId, userId, passwordHash) {
  db.exec('BEGIN');
  try {
    const info = db.prepare(
      "UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL"
    ).run(tokenId);
    if (info.changes === 0) throw new Error('This reset link has already been used.');
    db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?').run(passwordHash, userId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------- stories ----------
// `since`: optional SQLite timestamp string -- when given, each story gets
// a `has_new_chapters` flag for chapters published after it. `onlyArchived`
// switches from the normal "active stories" listing to the archived one.
// `tagIds` narrows the list to stories carrying ALL of them (a filter
// that widened as you added terms would be a strange thing to offer).
/** @param {{ since?: string|null, onlyArchived?: boolean, tagIds?: (number|string)[] }} [options] */
function listStories({ since, onlyArchived = false, tagIds = [] } = {}) {
  const wanted = (tagIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const tagFilter = wanted.length
    ? `AND (SELECT COUNT(DISTINCT st.tag_id) FROM story_tags st
            WHERE st.story_id = s.id AND st.tag_id IN (${wanted.join(',')})) = ${wanted.length}`
    : '';
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
      (
        SELECT COALESCE(SUM(v.word_count), 0) FROM chapters c3
        JOIN chapter_versions v ON v.chapter_id = c3.id
        WHERE c3.story_id = s.id AND c3.archived_at IS NULL
          AND v.version_number = (SELECT MAX(v5.version_number) FROM chapter_versions v5 WHERE v5.chapter_id = c3.id)
      ) AS word_count,
      ${since ? `(SELECT EXISTS(SELECT 1 FROM chapters ch3 WHERE ch3.story_id = s.id AND ch3.archived_at IS NULL AND ch3.created_at > @since))` : '0'} AS has_new_chapters
    FROM stories s
    JOIN users u ON u.id = s.author_id
    WHERE s.archived_at IS ${onlyArchived ? 'NOT NULL' : 'NULL'}
    ${tagFilter}
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
/**
 * @param {number} storyId
 * @param {{ since?: string|null, onlyArchived?: boolean }} [options]
 */
function listChaptersForStory(storyId, { since, onlyArchived = false } = {}) {
  return db.prepare(`
    SELECT c.*, u.display_name AS author_name,
      (SELECT MAX(version_number) FROM chapter_versions v WHERE v.chapter_id = c.id) AS latest_version,
      (SELECT COUNT(*) FROM chapter_versions v WHERE v.chapter_id = c.id) AS version_count,
      (SELECT v.word_count FROM chapter_versions v WHERE v.chapter_id = c.id
        ORDER BY v.version_number DESC LIMIT 1) AS word_count,
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

// Where this chapter sits in its story's reading order, and what's either
// side of it -- for the prev/next links on the chapter page. Archived
// chapters are skipped, so the sequence a reader walks is the same one
// the story page lists. A chapter that is itself archived isn't in that
// sequence at all: it gets neighbours of null and no position, rather
// than pretending to be somewhere in the run.
function getChapterNeighbours(chapter) {
  const siblings = db.prepare(
    'SELECT id, chapter_number, title FROM chapters WHERE story_id = ? AND archived_at IS NULL ORDER BY chapter_number ASC'
  ).all(chapter.story_id);
  const index = siblings.findIndex((c) => c.id === chapter.id);
  return {
    total: siblings.length,
    position: index === -1 ? null : index + 1,
    prev: index > 0 ? siblings[index - 1] : null,
    next: index !== -1 && index < siblings.length - 1 ? siblings[index + 1] : null,
  };
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

/** @param {{ storyId: number, title: string, summary?: string, authorId: number, content: string, changelog?: string }} fields */
function createChapter({ storyId, title, summary, authorId, content, changelog }) {
  const insertChapter = db.prepare(
    'INSERT INTO chapters (story_id, chapter_number, title, summary, author_id) VALUES (?, ?, ?, ?, ?)'
  );
  const insertVersion = db.prepare(
    'INSERT INTO chapter_versions (chapter_id, version_number, content, changelog, word_count) VALUES (?, 1, ?, ?, ?)'
  );
  const nextNumber = (db.prepare(
    'SELECT COALESCE(MAX(chapter_number), 0) AS n FROM chapters WHERE story_id = ?'
  ).get(storyId).n) + 1;

  db.exec('BEGIN');
  try {
    const info = insertChapter.run(storyId, nextNumber, title, summary || '', authorId);
    const chapterId = Number(info.lastInsertRowid);
    insertVersion.run(chapterId, content, changelog || 'Initial version', countWords(content));
    db.exec('COMMIT');
    return getChapterById(chapterId);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Inserts a brand-new chapter at a specific position instead of always
// appending at the end. `position` is the chapter_number the new chapter
// should take; every chapter at or after it -- archived ones included,
// since they still hold a slot under UNIQUE(story_id, chapter_number) --
// is shifted up by one, highest number first so no single UPDATE ever
// collides with another chapter's current number.
/** @param {{ storyId: number, position: number, title: string, summary?: string, authorId: number, content: string, changelog?: string }} fields */
function insertChapterAt({ storyId, position, title, summary, authorId, content, changelog }) {
  db.exec('BEGIN');
  try {
    const toShift = db.prepare(
      'SELECT id FROM chapters WHERE story_id = ? AND chapter_number >= ? ORDER BY chapter_number DESC'
    ).all(storyId, position);
    const bump = db.prepare('UPDATE chapters SET chapter_number = chapter_number + 1 WHERE id = ?');
    for (const row of toShift) bump.run(row.id);

    const info = db.prepare(
      'INSERT INTO chapters (story_id, chapter_number, title, summary, author_id) VALUES (?, ?, ?, ?, ?)'
    ).run(storyId, position, title, summary || '', authorId);
    const chapterId = Number(info.lastInsertRowid);
    db.prepare(
      'INSERT INTO chapter_versions (chapter_id, version_number, content, changelog, word_count) VALUES (?, 1, ?, ?, ?)'
    ).run(chapterId, content, changelog || 'Initial version', countWords(content));
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
        'INSERT INTO chapter_versions (chapter_id, version_number, content, changelog, word_count) VALUES (?, ?, ?, ?, ?)'
      ).run(chapterId, nextNumber, content, changelog || '', countWords(content));
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
      'INSERT INTO chapter_versions (chapter_id, version_number, content, changelog, word_count) VALUES (?, 1, ?, ?, ?)'
    ).run(chapterId, content, 'Initial version', countWords(content));

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

// Swaps a chapter with its nearest visible (non-archived) neighbor in the
// story's reading order -- a no-op if it's already first/last among visible
// chapters, or if the chapter itself is archived (nothing to reorder it
// against). Uses a temporary negative chapter_number -- guaranteed unique,
// since no real chapter_number is ever negative -- so the swap never trips
// the UNIQUE(story_id, chapter_number) constraint mid-transaction.
function moveChapter(chapterId, direction) {
  const chapter = getChapterById(chapterId);
  if (!chapter) return null;

  const siblings = db.prepare(
    'SELECT id, chapter_number FROM chapters WHERE story_id = ? AND archived_at IS NULL ORDER BY chapter_number ASC'
  ).all(chapter.story_id);
  const index = siblings.findIndex((c) => c.id === chapterId);
  if (index === -1) return chapter; // archived chapter -- nothing to reorder

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= siblings.length) return chapter; // already first/last

  const other = siblings[targetIndex];
  const thisNumber = siblings[index].chapter_number;

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE chapters SET chapter_number = ? WHERE id = ?').run(-chapterId, chapterId);
    db.prepare('UPDATE chapters SET chapter_number = ? WHERE id = ?').run(thisNumber, other.id);
    db.prepare('UPDATE chapters SET chapter_number = ? WHERE id = ?').run(other.chapter_number, chapterId);
    db.exec('COMMIT');
    return getChapterById(chapterId);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
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
    'INSERT INTO chapter_versions (chapter_id, version_number, content, changelog, word_count) VALUES (?, ?, ?, ?, ?)'
  ).run(chapterId, nextNumber, content, changelog || '', countWords(content));
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

// A comment is either anchored to a stretch of the text (the offsets and
// the quote) or a reply to another comment (parentId) -- never both, and
// the fields the other kind doesn't use are simply absent.
/** @param {{ versionId: number, authorId: number, body: string, startOffset?: number, endOffset?: number, quotedText?: string, parentId?: number|null }} fields */
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

// ---------- backup ----------
// A snapshot of the whole database as a single, self-contained file. The
// live database runs in WAL mode (see db.js): most recent writes sit in a
// separate -wal file, so a plain copy of just the .sqlite file can miss
// most of the data while the server is running. VACUUM INTO instead reads
// through the live connection (which already merges the base file and the
// WAL) and writes one complete, consistent file with no WAL/shm sidecars --
// safe to copy or move anywhere on its own. destPath must not already
// exist; SQLite refuses to overwrite a file with VACUUM INTO.
function backupDatabaseTo(destPath) {
  db.prepare('VACUUM INTO ?').run(destPath);
}

// ---------- per-story spelling exceptions ----------
// See db.js's story_dictionary_words table comment for what this is for.

function getStoryDictionary(storyId) {
  return db.prepare(
    'SELECT word FROM story_dictionary_words WHERE story_id = ? ORDER BY word COLLATE NOCASE'
  ).all(storyId).map((row) => row.word);
}

function listStoryDictionaryEntries(storyId) {
  return db.prepare(`
    SELECT sdw.*, u.display_name AS added_by_name
    FROM story_dictionary_words sdw LEFT JOIN users u ON u.id = sdw.added_by
    WHERE sdw.story_id = ?
    ORDER BY sdw.word COLLATE NOCASE
  `).all(storyId);
}

// Case-insensitive add: stored lowercased, and re-adding the same word
// (in any case) is a silent no-op rather than an error.
function addStoryDictionaryWord(storyId, word, addedBy) {
  const normalized = word.trim().toLowerCase();
  if (!normalized) return;
  db.prepare(
    'INSERT OR IGNORE INTO story_dictionary_words (story_id, word, added_by) VALUES (?, ?, ?)'
  ).run(storyId, normalized, addedBy);
}

function removeStoryDictionaryWord(storyId, id) {
  db.prepare('DELETE FROM story_dictionary_words WHERE story_id = ? AND id = ?').run(storyId, id);
}

// ---------- search ----------
// Plain LIKE rather than SQLite's full-text index: this is a writing group
// with a few hundred chapters, where a scan costs milliseconds, and an FTS
// table would need triggers keeping it in step with every edit, every new
// version and every wiki sync -- three more places to drift out of sync
// for a speed nobody would notice. Worth revisiting if the archive ever
// gets big enough to feel it.
const LIKE = (q) => `%${String(q).replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;

function searchStories(query, limit) {
  return db.prepare(`
    SELECT s.id, s.title, s.description, u.display_name AS author_name
    FROM stories s JOIN users u ON u.id = s.author_id
    WHERE s.archived_at IS NULL
      AND (s.title LIKE @q ESCAPE '\\' OR s.description LIKE @q ESCAPE '\\')
    ORDER BY s.title COLLATE NOCASE
    LIMIT @limit
  `).all({ q: LIKE(query), limit });
}

// Chapters matched on their own title/summary. Kept apart from the text
// search below so a chapter whose title matches ranks as a chapter hit
// rather than being lost among passages.
function searchChapters(query, limit) {
  return db.prepare(`
    SELECT c.id, c.title, c.summary, c.chapter_number, c.story_id, s.title AS story_title
    FROM chapters c JOIN stories s ON s.id = c.story_id
    WHERE c.archived_at IS NULL AND s.archived_at IS NULL
      AND (c.title LIKE @q ESCAPE '\\' OR c.summary LIKE @q ESCAPE '\\')
    ORDER BY s.title COLLATE NOCASE, c.chapter_number
    LIMIT @limit
  `).all({ q: LIKE(query), limit });
}

// The prose itself, searched only in each chapter's current version --
// searching every version would bury one real hit under a copy of it from
// every draft the chapter has been through.
function searchChapterText(query, limit) {
  return db.prepare(`
    SELECT c.id, c.title, c.chapter_number, c.story_id, s.title AS story_title,
           v.version_number, v.content
    FROM chapters c
    JOIN stories s ON s.id = c.story_id
    JOIN chapter_versions v ON v.chapter_id = c.id
    WHERE c.archived_at IS NULL AND s.archived_at IS NULL
      AND v.version_number = (SELECT MAX(v2.version_number) FROM chapter_versions v2 WHERE v2.chapter_id = c.id)
      AND v.content LIKE @q ESCAPE '\\'
    ORDER BY s.title COLLATE NOCASE, c.chapter_number
    LIMIT @limit
  `).all({ q: LIKE(query), limit });
}

function searchGlossary(query, limit) {
  return db.prepare(`
    SELECT title, slug_title AS slug, summary, content_html
    FROM (SELECT title, title AS slug_title, summary, content_html FROM wiki_pages)
    WHERE title LIKE @q ESCAPE '\\' OR summary LIKE @q ESCAPE '\\' OR content_html LIKE @q ESCAPE '\\'
    ORDER BY title COLLATE NOCASE
    LIMIT @limit
  `).all({ q: LIKE(query), limit });
}

function searchEverything(query, { limit = 20 } = {}) {
  const clean = String(query || '').trim();
  if (clean.length < 2) return null;
  return {
    query: clean,
    stories: searchStories(clean, limit),
    chapters: searchChapters(clean, limit),
    passages: searchChapterText(clean, limit),
    glossary: searchGlossary(clean, limit),
  };
}

// ---------- story tags (vocabulary curated on /admin, see db.js) ----------
function slugifyTag(name) {
  return String(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tag';
}

// Every tag, with how many live stories carry it -- the count is what
// makes the admin list honest about what deleting one would affect.
function listTags() {
  return db.prepare(`
    SELECT t.*, u.display_name AS proposed_by_name,
      (SELECT COUNT(*) FROM story_tags st JOIN stories s ON s.id = st.story_id
        WHERE st.tag_id = t.id AND s.archived_at IS NULL) AS story_count
    FROM tags t
    LEFT JOIN users u ON u.id = t.proposed_by
    ORDER BY t.tag_group COLLATE NOCASE, t.name COLLATE NOCASE
  `).all();
}

// The queue an admin works through on /admin.
function listProposedTags() {
  return listTags().filter((t) => t.status === 'proposed');
}

// An author proposing a tag from inside a story form. A name that already
// exists just resolves to that tag -- proposing "Space" when Space is
// already in the vocabulary should tag the story with Space, not create a
// second one, and must never knock an approved tag back into the queue.
function proposeTag({ name, userId }) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const existing = db.prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE').get(clean);
  if (existing) return existing;
  let slug = slugifyTag(clean);
  if (getTagBySlug(slug)) slug = `${slug}-${Date.now().toString(36)}`;
  const info = db.prepare(
    "INSERT INTO tags (name, slug, tag_group, description, status, proposed_by) VALUES (?, ?, 'Proposed', '', 'proposed', ?)"
  ).run(clean, slug, userId || null);
  return getTagById(Number(info.lastInsertRowid));
}

/**
 * @param {number} id
 * @param {{ name?: string, group?: string }} [edits]
 */
function approveTag(id, { name, group } = {}) {
  const tag = getTagById(id);
  if (!tag) return null;
  const clean = String(name || '').trim() || tag.name;
  const clash = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id <> ?').get(clean, id);
  db.prepare("UPDATE tags SET name = ?, tag_group = ?, status = 'approved', proposed_by = NULL WHERE id = ?")
    .run(clash ? tag.name : clean, String(group || '').trim() || 'Other', id);
  return getTagById(id);
}

// Folds one tag into another: every story on `fromId` gains `intoId`, and
// the old tag goes. This is what an admin reaches for when someone
// proposes "Sci-Fi" and "Science fiction" already exists -- the proposal
// isn't wrong, it's just already spelled another way, and the stories
// carrying it shouldn't lose the label.
function mergeTag(fromId, intoId) {
  const from = getTagById(fromId);
  const into = getTagById(intoId);
  if (!from || !into || from.id === into.id) return null;
  db.exec('BEGIN');
  try {
    db.prepare('INSERT OR IGNORE INTO story_tags (story_id, tag_id) SELECT story_id, ? FROM story_tags WHERE tag_id = ?')
      .run(into.id, from.id);
    db.prepare('INSERT OR IGNORE INTO user_hidden_tags (user_id, tag_id) SELECT user_id, ? FROM user_hidden_tags WHERE tag_id = ?')
      .run(into.id, from.id);
    db.prepare('DELETE FROM story_tags WHERE tag_id = ?').run(from.id);
    db.prepare('DELETE FROM user_hidden_tags WHERE tag_id = ?').run(from.id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(from.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return into;
}

// Groups come out in a deliberate reading order rather than alphabetically:
// this is the order an author fills the picker in -- what it is, then where
// it happens, then who's in it, then what to warn people about -- and the
// tag index reads better the same way. Anything an admin invents later
// sorts alphabetically after these.
const TAG_GROUP_ORDER = ['Genre', 'Setting', 'Swarm', 'Cast', 'Orientation', 'Pairings', 'Content notes', 'Length', 'Review status'];

function listTagsGrouped() {
  const groups = [];
  const byGroup = new Map();
  for (const tag of listTags()) {
    if (!byGroup.has(tag.tag_group)) {
      const entry = { group: tag.tag_group, tags: [] };
      byGroup.set(tag.tag_group, entry);
      groups.push(entry);
    }
    byGroup.get(tag.tag_group).tags.push(tag);
  }
  const rank = (name) => {
    const i = TAG_GROUP_ORDER.indexOf(name);
    return i === -1 ? TAG_GROUP_ORDER.length : i;
  };
  return groups.sort((a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group));
}

const getTagBySlug = (slug) => db.prepare('SELECT * FROM tags WHERE slug = ?').get(slug) || null;
const getTagById = (id) => db.prepare('SELECT * FROM tags WHERE id = ?').get(id) || null;

// Returns the existing tag when the name is already taken rather than
// throwing -- the admin form's "add" is meant to be idempotent.
function createTag({ name, group, description }) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const existing = db.prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE').get(clean);
  if (existing) return existing;
  let slug = slugifyTag(clean);
  if (getTagBySlug(slug)) slug = `${slug}-${Date.now().toString(36)}`;
  const info = db.prepare('INSERT INTO tags (name, slug, tag_group, description) VALUES (?, ?, ?, ?)')
    .run(clean, slug, String(group || 'Other').trim() || 'Other', String(description || '').trim());
  return getTagById(Number(info.lastInsertRowid));
}

// The slug deliberately does NOT follow a rename: it's in links people
// may already have shared, and a tag's identity is its row, not its name.
function updateTag(id, { name, group, description }) {
  const tag = getTagById(id);
  if (!tag) return null;
  const clean = String(name || '').trim() || tag.name;
  const clash = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id <> ?').get(clean, id);
  db.prepare('UPDATE tags SET name = ?, tag_group = ?, description = ? WHERE id = ?')
    .run(clash ? tag.name : clean, String(group || tag.tag_group).trim() || 'Other', String(description ?? tag.description), id);
  return getTagById(id);
}

function deleteTag(id) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM story_tags WHERE tag_id = ?').run(id);
    db.prepare('DELETE FROM user_hidden_tags WHERE tag_id = ?').run(id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getStoryTags(storyId) {
  return db.prepare(`
    SELECT t.* FROM tags t JOIN story_tags st ON st.tag_id = t.id
    WHERE st.story_id = ?
    ORDER BY t.tag_group COLLATE NOCASE, t.name COLLATE NOCASE
  `).all(storyId);
}

// One query for a whole page of stories rather than one per row.
function tagsForStories(storyIds) {
  const byStory = new Map(storyIds.map((id) => [id, []]));
  if (!storyIds.length) return byStory;
  const placeholders = storyIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT st.story_id, t.* FROM tags t JOIN story_tags st ON st.tag_id = t.id
    WHERE st.story_id IN (${placeholders})
    ORDER BY t.tag_group COLLATE NOCASE, t.name COLLATE NOCASE
  `).all(...storyIds);
  for (const row of rows) {
    if (byStory.has(row.story_id)) byStory.get(row.story_id).push(row);
  }
  return byStory;
}

function setStoryTags(storyId, tagIds) {
  const ids = Array.from(new Set((tagIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0)));
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM story_tags WHERE story_id = ?').run(storyId);
    const insert = db.prepare('INSERT OR IGNORE INTO story_tags (story_id, tag_id) VALUES (?, ?)');
    for (const id of ids) if (getTagById(id)) insert.run(storyId, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * @param {number} storyId
 * @param {{ title: string, description?: string, synopsis?: string }} details
 */
function updateStoryDetails(storyId, { title, description, synopsis }) {
  db.prepare('UPDATE stories SET title = ?, description = ?, synopsis = ? WHERE id = ?')
    .run(String(title).trim(), String(description || '').trim(), String(synopsis || '').trim(), storyId);
  return getStoryById(storyId);
}

// Everything the story page's header wants to say about the shape of the
// thing, in one query rather than five. Word counts come from each
// chapter's current version only -- adding up every draft would make a
// story look four times longer than it reads.
function getStoryStats(storyId) {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM chapters c WHERE c.story_id = @storyId AND c.archived_at IS NULL) AS chapters,
      (SELECT COUNT(*) FROM chapters c WHERE c.story_id = @storyId AND c.archived_at IS NOT NULL) AS archived_chapters,
      (SELECT COALESCE(SUM(v.word_count), 0) FROM chapters c
        JOIN chapter_versions v ON v.chapter_id = c.id
        WHERE c.story_id = @storyId AND c.archived_at IS NULL
          AND v.version_number = (SELECT MAX(v2.version_number) FROM chapter_versions v2 WHERE v2.chapter_id = c.id)
      ) AS words,
      (SELECT MAX(v.created_at) FROM chapters c
        JOIN chapter_versions v ON v.chapter_id = c.id
        WHERE c.story_id = @storyId AND c.archived_at IS NULL) AS last_written_at,
      (SELECT COUNT(*) FROM comments cm
        JOIN chapter_versions v ON v.id = cm.version_id
        JOIN chapters c ON c.id = v.chapter_id
        WHERE c.story_id = @storyId AND c.archived_at IS NULL
          AND cm.deleted_at IS NULL AND cm.parent_id IS NULL
          AND v.version_number = (SELECT MAX(v3.version_number) FROM chapter_versions v3 WHERE v3.chapter_id = c.id)
      ) AS comments,
      (SELECT COUNT(*) FROM comments cm
        JOIN chapter_versions v ON v.id = cm.version_id
        JOIN chapters c ON c.id = v.chapter_id
        WHERE c.story_id = @storyId AND c.archived_at IS NULL
          AND cm.status = 'pending' AND cm.deleted_at IS NULL AND cm.parent_id IS NULL
          AND v.version_number = (SELECT MAX(v4.version_number) FROM chapter_versions v4 WHERE v4.chapter_id = c.id)
      ) AS pending_comments
  `).get({ storyId });
  return row || { chapters: 0, archived_chapters: 0, words: 0, last_written_at: null, comments: 0, pending_comments: 0 };
}

// ---------- per-reader hidden tags (SOL's excluded codes) ----------
function listUserHiddenTagIds(userId) {
  return db.prepare('SELECT tag_id FROM user_hidden_tags WHERE user_id = ?').all(userId).map((r) => r.tag_id);
}

function setUserHiddenTags(userId, tagIds) {
  const ids = Array.from(new Set((tagIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0)));
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM user_hidden_tags WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT OR IGNORE INTO user_hidden_tags (user_id, tag_id) VALUES (?, ?)');
    for (const id of ids) if (getTagById(id)) insert.run(userId, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------- wiki index (see lib/wiki.js for the sync/fetch logic) ----------
function listWikiPages() {
  return db.prepare('SELECT title, title_lower, summary FROM wiki_pages').all();
}

// Replaces the whole table in one transaction -- simpler and safer than
// diffing against the previous set (a renamed/deleted wiki page just
// disappears cleanly, rather than needing its own cleanup pass).
function replaceWikiPages(pages) {
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM wiki_pages');
    const insert = db.prepare(
      'INSERT INTO wiki_pages (title, title_lower, summary, content_html) VALUES (?, ?, ?, ?)'
    );
    for (const p of pages) insert.run(p.title, p.title.toLowerCase(), p.summary || '', p.contentHtml || null);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------- glossary (the in-app read-only mirror of the wiki) ----------
// Deliberately excludes content_html -- this listing renders every page's
// title (and, for search, its summary), and some wikis run into the
// thousands of pages, so pulling every page's full HTML body just to list
// titles would be wasted work for both SQLite and the response.
function listWikiPagesForGlossary() {
  return db.prepare('SELECT title, title_lower, summary FROM wiki_pages ORDER BY title COLLATE NOCASE').all();
}

function getWikiPageByTitleLower(titleLower) {
  return db.prepare('SELECT title, title_lower, summary, content_html, fetched_at FROM wiki_pages WHERE title_lower = ?').get(titleLower) || null;
}

function getWikiSyncState() {
  return db.prepare('SELECT * FROM wiki_sync_state WHERE id = 1').get() || null;
}

/** @param {{ status: string, pageCount?: number, error?: string|null }} state */
function setWikiSyncState({ status, pageCount, error }) {
  db.prepare(`
    INSERT INTO wiki_sync_state (id, last_synced_at, last_status, page_count, last_error)
    VALUES (1, datetime('now'), ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_synced_at = datetime('now'), last_status = excluded.last_status,
      page_count = excluded.page_count, last_error = excluded.last_error
  `).run(status, pageCount || 0, error || null);
}

// ---------- who has read what ----------
// An author posting a chapter and hearing nothing back cannot tell the
// difference between "nobody has looked at it" and "three people read it
// and had nothing to say". Those are opposite problems and the app used
// to be silent about both.

// Recorded when the page loads, and kept at the newest version somebody
// has seen -- so revising a chapter does not wipe the fact that people
// read the earlier draft, but the story page can still say who has seen
// the version that is up now.
function markChapterRead(chapterId, userId, versionNumber) {
  db.prepare(`
    INSERT INTO chapter_reads (chapter_id, user_id, version_number)
    VALUES (@chapterId, @userId, @versionNumber)
    ON CONFLICT (chapter_id, user_id) DO UPDATE SET
      version_number = MAX(version_number, @versionNumber),
      read_at = datetime('now')
  `).run({ chapterId, userId, versionNumber });
}

function listChapterReaders(chapterId) {
  return db.prepare(`
    SELECT u.id, u.display_name, r.read_at, r.version_number
    FROM chapter_reads r JOIN users u ON u.id = r.user_id
    WHERE r.chapter_id = ?
    ORDER BY r.read_at
  `).all(chapterId);
}

// One query for a story's whole chapter list.
function readersForChapters(chapterIds) {
  const byChapter = new Map(chapterIds.map((id) => [Number(id), []]));
  if (!chapterIds.length) return byChapter;
  const rows = db.prepare(`
    SELECT r.chapter_id, r.version_number, u.id, u.display_name
    FROM chapter_reads r JOIN users u ON u.id = r.user_id
    WHERE r.chapter_id IN (${chapterIds.map(() => '?').join(',')})
    ORDER BY r.read_at
  `).all(...chapterIds);
  for (const row of rows) {
    const list = byChapter.get(Number(row.chapter_id));
    if (list) list.push({ id: row.id, display_name: row.display_name, version_number: row.version_number });
  }
  return byChapter;
}

// ---------- what's waiting for you ----------
// The story index answers "what is here". This answers "what is here for
// me", which for a group that exists to correct each other's drafts is
// the question you actually arrive with.
//
// Two different kinds of thing, deliberately kept apart. Pending comments
// on your own chapters are *outstanding*: they sit there until you accept
// or reject them, and reloading the page does not make them go away. The
// other two are *news*, and use the same "since your last visit" mark the
// New badges already use -- which means reloading does clear them. Mixing
// the two would make the durable list look dismissable.

const LATEST_VERSION = `v.version_number = (
  SELECT MAX(v9.version_number) FROM chapter_versions v9 WHERE v9.chapter_id = v.chapter_id
)`;

function pendingOnMyChapters(userId) {
  return db.prepare(`
    SELECT c.id AS chapter_id, c.title AS chapter_title, c.chapter_number,
           s.id AS story_id, s.title AS story_title,
           COUNT(*) AS pending, MAX(cm.created_at) AS latest_at
    FROM comments cm
    JOIN chapter_versions v ON v.id = cm.version_id
    JOIN chapters c ON c.id = v.chapter_id
    JOIN stories s ON s.id = c.story_id
    WHERE c.author_id = @userId
      AND c.archived_at IS NULL AND s.archived_at IS NULL
      AND ${LATEST_VERSION}
      AND cm.status = 'pending' AND cm.parent_id IS NULL AND cm.deleted_at IS NULL
    GROUP BY c.id
    ORDER BY latest_at DESC
  `).all({ userId });
}

function repliesToMe(userId, since, limit) {
  if (!since) return [];
  return db.prepare(`
    SELECT r.id, r.body, r.created_at, u.display_name AS author_name,
           c.id AS chapter_id, c.title AS chapter_title, c.chapter_number,
           s.title AS story_title
    FROM comments r
    JOIN comments parent ON parent.id = r.parent_id
    JOIN chapter_versions v ON v.id = r.version_id
    JOIN chapters c ON c.id = v.chapter_id
    JOIN stories s ON s.id = c.story_id
    JOIN users u ON u.id = r.author_id
    WHERE parent.author_id = @userId AND r.author_id <> @userId
      AND r.deleted_at IS NULL AND r.created_at > @since
      AND c.archived_at IS NULL AND s.archived_at IS NULL
    ORDER BY r.created_at DESC
    LIMIT @limit
  `).all({ userId, since, limit });
}

// Not "since your last visit" any more: what you have not opened. The old
// version cleared itself every time somebody loaded the index, which is
// the wrong behaviour for a list of things still to do -- reading the page
// is not the same as reading the chapter.
function chaptersNewToMe(userId, limit) {
  return db.prepare(`
    SELECT c.id, c.title, c.chapter_number, c.created_at,
           s.id AS story_id, s.title AS story_title, u.display_name AS author_name,
           (SELECT v.word_count FROM chapter_versions v WHERE v.chapter_id = c.id
             ORDER BY v.version_number DESC LIMIT 1) AS word_count
    FROM chapters c
    JOIN stories s ON s.id = c.story_id
    JOIN users u ON u.id = c.author_id
    WHERE c.author_id <> @userId
      AND c.archived_at IS NULL AND s.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM chapter_reads r WHERE r.chapter_id = c.id AND r.user_id = @userId
      )
    ORDER BY c.created_at DESC
    LIMIT @limit
  `).all({ userId, limit });
}

/**
 * @param {number} userId
 * @param {{ since?: string|null, limit?: number }} [options]
 */
function inboxFor(userId, { since = null, limit = 8 } = {}) {
  const pending = pendingOnMyChapters(userId);
  const replies = repliesToMe(userId, since, limit);
  const newChapters = chaptersNewToMe(userId, limit);
  return {
    pending,
    replies,
    newChapters,
    empty: !pending.length && !replies.length && !newChapters.length,
  };
}

// ---------- coauthors ----------
// A story's own author_id is its owner and is not repeated here: this
// table holds only the people the owner has added. Everywhere the app asks
// "can this person write in this story", it asks canWriteInStory below
// rather than comparing ids, so there is one place to change if the rule
// ever moves.

function listStoryCoauthors(storyId) {
  return db.prepare(`
    SELECT u.id, u.display_name, u.username, sa.added_at
    FROM story_authors sa JOIN users u ON u.id = sa.user_id
    WHERE sa.story_id = ?
    ORDER BY sa.added_at
  `).all(storyId);
}

// One query for a whole page of stories, so the index doesn't run a query
// per row.
function coauthorsForStories(storyIds) {
  const byStory = new Map(storyIds.map((id) => [Number(id), []]));
  if (!storyIds.length) return byStory;
  const placeholders = storyIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT sa.story_id, u.id, u.display_name
    FROM story_authors sa JOIN users u ON u.id = sa.user_id
    WHERE sa.story_id IN (${placeholders})
    ORDER BY sa.added_at
  `).all(...storyIds);
  for (const row of rows) {
    const list = byStory.get(Number(row.story_id));
    if (list) list.push({ id: row.id, display_name: row.display_name });
  }
  return byStory;
}

function isStoryCoauthor(storyId, userId) {
  return Boolean(db.prepare(
    'SELECT 1 FROM story_authors WHERE story_id = ? AND user_id = ?'
  ).get(storyId, userId));
}

/**
 * Can this person add chapters to this story, and use its dictionary?
 * True for the owner and for anyone the owner has added as a coauthor.
 * Editing a chapter is a separate question, answered by who wrote that
 * chapter -- being a coauthor does not grant it.
 * @param {Row} story
 * @param {Row} user
 */
function canWriteInStory(story, user) {
  if (!story || !user) return false;
  if (story.author_id === user.id) return true;
  return isStoryCoauthor(story.id, user.id);
}

// Returns the coauthor row, or null when there was nothing to do: the
// story's owner is already an author of it, a person can only be added
// once, and the placeholder that inherits a deleted account's work is not
// somebody who can be invited to write.
function addStoryCoauthor(storyId, userId, addedBy) {
  const story = db.prepare('SELECT id, author_id FROM stories WHERE id = ?').get(storyId);
  if (!story) return null;
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!user || user.username === DELETED_USER_USERNAME) return null;
  if (story.author_id === user.id) return null;
  if (isStoryCoauthor(storyId, user.id)) return null;
  db.prepare(
    'INSERT INTO story_authors (story_id, user_id, added_by) VALUES (?, ?, ?)'
  ).run(storyId, user.id, addedBy || null);
  return listStoryCoauthors(storyId).find((c) => c.id === user.id) || null;
}

// Removing a coauthor takes away what they can do from here on. The
// chapters they already wrote stay theirs -- they wrote them, their name is
// on them, and they can still edit them; this is a writing group, not a
// permissions system, and quietly reassigning somebody's prose because
// they left a story would be the wrong thing to do.
function removeStoryCoauthor(storyId, userId) {
  const info = db.prepare(
    'DELETE FROM story_authors WHERE story_id = ? AND user_id = ?'
  ).run(storyId, userId);
  return info.changes > 0;
}

// Everyone who could be added: not the owner, not already a coauthor, not
// the deleted-account placeholder.
function listAddableCoauthors(story) {
  return db.prepare(`
    SELECT id, display_name, username FROM users
    WHERE username != ?
      AND id != ?
      AND id NOT IN (SELECT user_id FROM story_authors WHERE story_id = ?)
    ORDER BY display_name COLLATE NOCASE
  `).all(DELETED_USER_USERNAME, story.author_id, story.id);
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
  createPasswordResetToken,
  listPendingPasswordResetTokens,
  revokePasswordResetToken,
  getValidPasswordResetToken,
  consumePasswordResetToken,
  listUsersForAdmin,
  getPlaceholderUserId,
  adminSetPassword,
  setOwnPassword,
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
  getChapterNeighbours,
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
  backupDatabaseTo,
  getStoryDictionary,
  listStoryDictionaryEntries,
  addStoryDictionaryWord,
  removeStoryDictionaryWord,
  insertChapterAt,
  moveChapter,
  listWikiPages,
  replaceWikiPages,
  getWikiSyncState,
  setWikiSyncState,
  listWikiPagesForGlossary,
  getWikiPageByTitleLower,
  listTags,
  listTagsGrouped,
  getTagBySlug,
  getTagById,
  createTag,
  updateTag,
  deleteTag,
  listProposedTags,
  proposeTag,
  approveTag,
  mergeTag,
  inboxFor,
  markChapterRead,
  listChapterReaders,
  readersForChapters,
  getStoryStats,
  listStoryCoauthors,
  coauthorsForStories,
  isStoryCoauthor,
  canWriteInStory,
  addStoryCoauthor,
  removeStoryCoauthor,
  listAddableCoauthors,
  getStoryTags,
  tagsForStories,
  setStoryTags,
  updateStoryDetails,
  listUserHiddenTagIds,
  setUserHiddenTags,
  searchEverything,
};
