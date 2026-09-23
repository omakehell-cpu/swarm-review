'use strict';

const { DELETED_USER_USERNAME, auth, db } = require('./shared');
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
// Everybody who can be named in a note, for the "@" suggestions.
function listMentionable() {
  return db.prepare(`SELECT username, display_name FROM users
    WHERE locked_at IS NULL ORDER BY display_name COLLATE NOCASE`).all();
}

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


// Reading the changelog is its own kind of "seen": bumpLastSeen above is
// what marks chapters as read, and opening the help section must not do
// that to somebody's story.
// `upTo` is the newest batch on the page they just looked at. Marking the
// visit with the clock alone would leave a batch dated later than the
// server's idea of today permanently unread -- and "I have read this page"
// means all of it, whatever its dates say.
// `key` names that newest batch exactly (see releaseKey in lib/docs.js),
// so a second batch on the same day still counts as new.
function markChangelogSeen(userId, upTo, key = null) {
  const floor = upTo && /^\d{4}-\d{2}-\d{2}$/.test(String(upTo)) ? `${upTo} 23:59:59` : null;
  db.prepare(`
    UPDATE users SET changelog_seen_at =
      CASE WHEN @floor IS NOT NULL AND @floor > datetime('now') THEN @floor ELSE datetime('now') END,
      changelog_seen_key = @key
    WHERE id = @userId
  `).run({ userId, floor, key: key || null });
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

function setReadingPrefs(userId, { readFirst, plainNames }) {
  db.prepare('UPDATE users SET read_first = ?, plain_names = ? WHERE id = ?').run(readFirst ? 1 : 0, plainNames ? 1 : 0, userId);
}

module.exports = {
  listMentionable,
  setReadingPrefs,
  adminDeleteUser,
  adminLockAccount,
  adminSetPassword,
  adminUnlockAccount,
  bumpLastSeen,
  closeRegistration,
  consumePasswordResetToken,
  createNamedInviteCode,
  createPasswordResetToken,
  createUser,
  generateNewInviteCode,
  getActiveInviteCode,
  getInviteCodeById,
  getPasswordResetTokenById,
  getPlaceholderUserId,
  getUserById,
  getUserByUsername,
  getValidPasswordResetToken,
  listInviteCodes,
  listPendingNamedInvites,
  listPendingPasswordResetTokens,
  listUsers,
  listUsersForAdmin,
  markChangelogSeen,
  markInviteCodeUsed,
  recordFailedLogin,
  resetFailedLogins,
  revokeNamedInvite,
  revokePasswordResetToken,
  setOwnPassword,
  userCount,
  validateInviteCode,
};
