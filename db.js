// db.js -- persistence layer built entirely on Node's built-in `node:sqlite`
// module, so the app has zero external dependencies (no `npm install`
// needed). Requires Node.js >= 22.5.0.
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'swarm-review.sqlite');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  author_id    INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at  TEXT
);

CREATE TABLE IF NOT EXISTS chapters (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id        INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  chapter_number  INTEGER NOT NULL,
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL DEFAULT '',
  author_id       INTEGER NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at     TEXT,
  UNIQUE(story_id, chapter_number)
);

CREATE TABLE IF NOT EXISTS chapter_versions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id      INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  content         TEXT NOT NULL,
  changelog       TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(chapter_id, version_number)
);

CREATE TABLE IF NOT EXISTS comments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id    INTEGER NOT NULL REFERENCES chapter_versions(id) ON DELETE CASCADE,
  author_id     INTEGER NOT NULL REFERENCES users(id),
  parent_id     INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  start_offset  INTEGER,
  end_offset    INTEGER,
  quoted_text   TEXT,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at   TEXT,
  resolved_by   INTEGER REFERENCES users(id),
  edited_at     TEXT,
  deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_chapters_story ON chapters(story_id);
CREATE INDEX IF NOT EXISTS idx_versions_chapter ON chapter_versions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_comments_version ON comments(version_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);

-- Per-story spelling exceptions: invented character/place names (or any
-- other word) the story's author has told the writing analyzer to stop
-- flagging as a possible misspelling (see models.js get/addStoryDictionaryWord
-- and the "Story dictionary" section on the story page). Scoped to one
-- story rather than the whole app, since a name that's normal in one
-- story is still worth flagging if it shows up as a likely typo elsewhere.
CREATE TABLE IF NOT EXISTS story_dictionary_words (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id    INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  word        TEXT NOT NULL,
  added_by    INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(story_id, word)
);
CREATE INDEX IF NOT EXISTS idx_story_dictionary_story ON story_dictionary_words(story_id);

-- Invite codes are single-use: at most one row is "active" at a time (the
-- one currently valid for registration). Generating a new one, or closing
-- registration entirely, deactivates whatever was active before. A used
-- code keeps used_at/used_by as a permanent record of who it let in.
CREATE TABLE IF NOT EXISTS invite_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  INTEGER REFERENCES users(id),
  used_at     TEXT,
  used_by     INTEGER REFERENCES users(id)
);

-- Self-service password reset, without needing email: an admin generates a
-- single-use link for a specific user (/admin, see models.js
-- createPasswordResetToken) and shares it with them by whatever channel is
-- convenient (chat, in person, ...). The user opens it and picks their own
-- new password themselves -- the admin never sees or sets it, unlike the
-- direct "set a new password" admin tool. Expires after 24h so an old,
-- unused link shared over some channel doesn't stay valid indefinitely.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token       TEXT NOT NULL UNIQUE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  INTEGER REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);

-- A cached, local copy of the shared-universe wiki's page titles + a short
-- plain-text summary of each (see lib/wiki.js), refreshed periodically
-- rather than queried live -- chapter text is scanned against this table
-- (not the wiki itself) to auto-link character/place/ship names, so
-- rendering a chapter never depends on the external wiki being up.
CREATE TABLE IF NOT EXISTS wiki_pages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL UNIQUE,
  title_lower TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_title_lower ON wiki_pages(title_lower);

-- Single row (id is always 1) tracking the last sync attempt, shown on the
-- admin page -- whether it's ever run, when, how many pages, and whether
-- it succeeded, so a failed background sync (e.g. the wiki being
-- unreachable) is visible instead of silently going stale.
CREATE TABLE IF NOT EXISTS wiki_sync_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  last_synced_at  TEXT,
  last_status     TEXT,
  page_count      INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT
);
`);

// Guard against a *very* old database file from before "stories" existed:
// the `chapters` table would already exist without a `story_id` column,
// and that one can't be added automatically (it's NOT NULL with no
// sensible default for existing rows). Fail loudly with a clear fix
// instead of a confusing "no such column" error deep in a request
// handler. Every schema change *since* this one is handled by the
// lightweight migration below instead, so existing stories/chapters/
// comments are preserved rather than wiped.
const chapterColumns = db.prepare("PRAGMA table_info(chapters)").all().map((c) => c.name);
if (!chapterColumns.includes('story_id')) {
  throw new Error(
    'The database at data/swarm-review.sqlite is from an older version of this app ' +
    '(before chapters were grouped into stories) and is not compatible with this version. ' +
    'Stop the server, rename or delete the "data" folder next to server.js, and start it again ' +
    '-- a fresh database will be created automatically (with a new invite code).'
  );
}

// Lightweight migrations: add any column that's missing from a database
// created by an older version of this app. Safe to run every time the
// server starts -- each ALTER TABLE only fires if the column isn't there
// yet, and adding a nullable/defaulted column never touches existing rows'
// other data.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// These are all nullable with no default, which SQLite allows unconditionally
// (even on tables that already have rows -- existing rows just get NULL,
// which is exactly what "not archived / not edited / not deleted" means).
ensureColumn('stories', 'archived_at', 'TEXT');
ensureColumn('chapters', 'archived_at', 'TEXT');
ensureColumn('comments', 'edited_at', 'TEXT');
ensureColumn('comments', 'deleted_at', 'TEXT');

// users.last_seen_at is different: SQLite refuses a non-constant default
// (like datetime('now')) on ADD COLUMN once a table already has rows, so it
// can't be added the same way as the CREATE TABLE version above. Add it
// nullable instead and backfill existing users to "now". Because this
// migrated column ends up with no schema-level default (unlike a freshly
// created database's users table), models.js's createUser sets it
// explicitly on every insert rather than relying on one.
ensureColumn('users', 'last_seen_at', 'TEXT');
db.exec("UPDATE users SET last_seen_at = datetime('now') WHERE last_seen_at IS NULL");

// Login lockout tracking. failed_login_attempts uses a constant default
// (0), which -- unlike datetime('now') above -- SQLite allows unconditionally
// via ALTER TABLE even on a table with existing rows, so this one can be
// added the same simple way as the CREATE TABLE version would be.
ensureColumn('users', 'failed_login_attempts', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'locked_at', 'TEXT');
ensureColumn('users', 'locked_reason', 'TEXT'); // 'failed_attempts' | 'admin'

// Named invites: an invite code scoped to one specific username instead of
// being open to whoever registers first (see models.js createNamedInviteCode).
// Nullable with no default -- every existing row is a generic code, and
// NULL here means exactly that: valid for any username.
ensureColumn('invite_codes', 'username', 'TEXT');

// Bumped every time a password changes (self-service or admin-set, see
// models.js setOwnPassword/adminSetPassword). A session token records the
// session_version it was issued under (see server.js login()); if it no
// longer matches the user's current value, the token is treated as
// logged-out -- this is what makes changing a password actually sign out
// any other open session, instead of leaving old tokens valid until they
// expire on their own up to 30 days later.
ensureColumn('users', 'session_version', 'INTEGER NOT NULL DEFAULT 0');

// The full rendered content of each wiki page (see lib/wiki.js's
// wikitextToHtml), for the in-app "Glossary" section -- kept separate from
// the short `summary` column above, which is all the inline auto-link
// tooltips need and is still built/used exactly as before. Nullable: an
// older sync that ran before this column existed simply has no glossary
// body yet for a given page until the next sync fills it in.
ensureColumn('wiki_pages', 'content_html', 'TEXT');

// One-time migration: older versions of this app gated registration with a
// single static code stored in data/invite-code.txt (valid forever, for
// anyone). If that file exists and the new invite_codes table is still
// empty, seed it with that code so a code the admin may have already
// shared with someone keeps working -- but from here on it behaves like
// any other code: single-use, and replaced by generating a new one.
const inviteCodeCount = db.prepare('SELECT COUNT(*) AS n FROM invite_codes').get().n;
if (inviteCodeCount === 0) {
  const legacyPath = path.join(DATA_DIR, 'invite-code.txt');
  let seedCode = fs.existsSync(legacyPath) ? fs.readFileSync(legacyPath, 'utf8').trim() : '';
  if (!seedCode) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
    seedCode = Array.from({ length: 8 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  }
  db.prepare('INSERT INTO invite_codes (code, active) VALUES (?, 1)').run(seedCode);
}

// A permanent placeholder account that "deleted" users' authored content
// (stories/chapters/comments) is reassigned to when an admin deletes their
// account, so the writing itself isn't lost, but the departed member's real
// account and login no longer exist. The username is reserved -- normal
// registration rejects it -- and its password hash is a random value nobody
// knows; the login handler also refuses this username outright as a second,
// explicit safeguard.
const DELETED_USER_USERNAME = 'deleted-user';
const deletedUserRow = db.prepare('SELECT id FROM users WHERE username = ?').get(DELETED_USER_USERNAME);
if (!deletedUserRow) {
  const salt = crypto.randomBytes(16).toString('hex');
  const unusablePasswordHash = `${salt}:${crypto.randomBytes(64).toString('hex')}`;
  db.prepare(
    "INSERT INTO users (username, display_name, password_hash, is_admin, last_seen_at) VALUES (?, ?, ?, 0, datetime('now'))"
  ).run(DELETED_USER_USERNAME, 'Deleted user', unusablePasswordHash);
}

module.exports = db;
