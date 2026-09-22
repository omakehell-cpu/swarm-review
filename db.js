// db.js -- persistence layer built entirely on Node's built-in `node:sqlite`
// module, so the app has zero external dependencies (no `npm install`
// needed). Requires Node.js >= 22.5.0.
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

// SWARM_DB_PATH exists so the test suite can run the real schema, the real
// migrations and the real seed data against a throwaway file in a temp
// directory. Nothing in production sets it, and the default below is the
// only path the app itself ever uses.
const DB_PATH = process.env.SWARM_DB_PATH || path.join(__dirname, 'data', 'swarm-review.sqlite');

// A test that reaches this file without a path of its own is about to
// open the real archive and write to it. That is not a hypothetical: a
// test file required a library at the top that pulled this one in before
// its own setup ran, and the suite emptied the live glossary.
//
// node --test sets NODE_TEST_CONTEXT in every test process, and the
// helper that hands a test its own database sets SWARM_DB_PATH before
// anything requires this file. One of the two is always true in a test;
// neither is ever true in the running app.
if (process.env.NODE_TEST_CONTEXT && !process.env.SWARM_DB_PATH) {
  throw new Error(
    'This test is about to open the real database. Put '
    + "require('./helpers/tmpdb').useTempDatabase() at the very top of the "
    + 'file, above every other require -- db.js reads its path once, when '
    + 'it loads, and anything that requires it first decides for you.'
  );
}

const DATA_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
// The cast is for the type-checker only (see types.d.ts): node:sqlite
// types every column as string | number | bigint | null | Uint8Array, and
// this app's rows are known shapes its own schema fixes.
/** @type {LooseDatabase} */
const db = /** @type {any} */ (new DatabaseSync(DB_PATH));

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

-- Story tags, in the spirit of StoriesOnline's codes: a closed vocabulary
-- an admin curates (see the Tags section on /admin), which authors pick
-- from rather than typing their own, so the same idea doesn't end up
-- spelled three different ways across three stories. tag_group is only
-- for presentation -- it's what the picker and the tag index group by.
CREATE TABLE IF NOT EXISTS tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  tag_group   TEXT NOT NULL DEFAULT 'Other',
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tags_group ON tags(tag_group);

CREATE TABLE IF NOT EXISTS story_tags (
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (story_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_story_tags_tag ON story_tags(tag_id);

-- Coauthors. The story's own author_id stays what it always was: the
-- person whose story it is, who alone can edit its details, reorder it,
-- archive it or delete it. A row here adds someone who can write in it --
-- add chapters, and edit the chapters they wrote, the same rule the rest
-- of the app already uses for comments. Editing someone else's chapter is
-- deliberately not part of it.
CREATE TABLE IF NOT EXISTS story_authors (
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (story_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_story_authors_user ON story_authors(user_id);

-- Each reader's own "don't show me this" list, the equivalent of SOL's
-- excluded codes. Set from /account; a story carrying any of these is
-- folded away in that reader's story list (and only theirs).
CREATE TABLE IF NOT EXISTS user_hidden_tags (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, tag_id)
);

-- Small key/value scratchpad for the app's own bookkeeping -- currently
-- just which batches of seeded tags have been applied, so a later batch
-- can be added without re-adding (or resurrecting) the earlier ones.
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

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
// When this person last opened the changelog. Its own column on purpose:
// last_seen_at is what marks chapters as new, and reading about the app
// must not mark the writing as read.
ensureColumn('users', 'changelog_seen_at', 'TEXT');
// A story bible can be kept to the people who write the story. Some of
// what goes in one -- who is secretly whose father, who does not survive
// book two -- is not something an author wants their readers holding
// while they read. Off by default: the bible is a shared-workings tool
// first, and a private notebook when its author says so.
ensureColumn('stories', 'bible_private', 'INTEGER NOT NULL DEFAULT 0');
// Whose eyes a chapter is behind, and which thread of the story it
// belongs to. Free text with the story's own past answers offered back,
// the same bargain the bible's custom fields strike: a vocabulary that
// settles by being reused rather than by being configured first.
ensureColumn('chapters', 'pov', "TEXT NOT NULL DEFAULT ''");
ensureColumn('chapters', 'strand', "TEXT NOT NULL DEFAULT ''");
// What this story is aiming at, and what one person is aiming at in a
// day. Zero means nobody has said, which is not the same as zero words.
// Where something sits in the story's own calendar, which has nothing to
// do with the order the chapters are told in. `when` is what the story
// calls it and can be anything ("Day 412", "Third of Marrow, 1123"); `day`
// is the number that puts it on a line, on whatever scale the writer
// picks. Null means nobody has said, which is not the same as day zero.
ensureColumn('chapters', 'story_when', "TEXT NOT NULL DEFAULT ''");
ensureColumn('chapters', 'story_day', 'INTEGER');
ensureColumn('stories', 'word_goal', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'daily_goal', 'INTEGER NOT NULL DEFAULT 0');
// The secret in a person's feed URL. Null until they ask for one: a
// capability nobody has created is a capability nobody can leak.
ensureColumn('users', 'feed_token', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_feed_token ON users(feed_token) WHERE feed_token IS NOT NULL');
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

// Tags an author proposed while tagging a story, rather than picking from
// the curated list (see models.js proposeTag). They work like any other
// tag immediately -- the author isn't left waiting on an admin to be able
// to describe their own story -- but they're marked as proposed wherever
// they appear, and sit in a queue on /admin to be approved, renamed,
// merged into an existing tag, or thrown out.
ensureColumn('tags', 'status', "TEXT NOT NULL DEFAULT 'approved'");
ensureColumn('tags', 'proposed_by', 'INTEGER');

// The full rendered content of each wiki page (see lib/wiki.js's
// wikitextToHtml), for the in-app "Glossary" section -- kept separate from
// the short `summary` column above, which is all the inline auto-link
// tooltips need and is still built/used exactly as before. Nullable: an
// older sync that ran before this column existed simply has no glossary
// body yet for a given page until the next sync fills it in.
ensureColumn('wiki_pages', 'content_html', 'TEXT');

// Word counts are stored rather than computed per request: a story page
// lists every chapter, and counting words means parsing the markdown of
// each one. Backfilled once, below, for versions written before this
// column existed.
ensureColumn('chapter_versions', 'word_count', 'INTEGER');

// The blurb on the index (stories.description) sells the story in two
// lines. The synopsis is the other thing: what actually happens, for
// somebody coming back to chapter nine after a month away. It can carry
// spoilers, so the story page keeps it folded.
ensureColumn('stories', 'synopsis', "TEXT NOT NULL DEFAULT ''");

// Where a story is, said by whoever writes it: 'ongoing' | 'complete' |
// 'dropped'. There is deliberately no 'hiatus' value here -- a story is
// on hiatus when nobody has written in it for months, which is something
// the dates already know (see storyStatus in models.js). Storing it would
// mean it was wrong from the moment somebody posted a chapter, and
// somebody would have to remember to take it off.
ensureColumn('stories', 'status', "TEXT NOT NULL DEFAULT 'ongoing'");

// What a chapter is asking of its readers: 'draft' (still moving, don't
// line-edit it yet), 'notes' (the reason a chapter goes up in a workshop,
// so it is the default) or 'settled' (done with, no need to comment).
// A separate vocabulary from the story's on purpose -- "this chapter is
// dropped" would not mean anything.
ensureColumn('chapters', 'stage', "TEXT NOT NULL DEFAULT 'notes'");

// An arc, a book, a part: a stretch of chapters with a name. The name
// lives on the chapter that opens it, and the arc runs from there to
// whatever chapter opens the next one -- so there is no arc table to keep
// in step with the running order, no empty arcs, and no chapter that
// belongs to two of them. Empty on every chapter that does not start one.
ensureColumn('chapters', 'arc_title', "TEXT NOT NULL DEFAULT ''");

// Which of the wiki's own categories each mirrored page is filed under.
// A separate table rather than a column because a page is usually in
// several, and because the glossary's index counts and filters by them --
// both of which want a row per pairing. Rewritten wholesale by the same
// transaction that replaces the pages themselves (see replaceWikiPages),
// so it can never disagree with them.
db.exec(`
CREATE TABLE IF NOT EXISTS wiki_page_categories (
  title_lower TEXT NOT NULL,
  category    TEXT NOT NULL,
  PRIMARY KEY (title_lower, category)
);
CREATE INDEX IF NOT EXISTS idx_wiki_categories ON wiki_page_categories(category);
`);

// Who has opened which chapter. Recorded automatically when somebody loads
// a chapter page rather than by a button: the question an author actually
// has is "has anybody looked at this yet", and asking people to tick a box
// to answer it means the answer is missing exactly when nobody bothered.
// The author's own readings are not recorded -- "read by the person who
// wrote it" is noise.
db.exec(`
CREATE TABLE IF NOT EXISTS chapter_reads (
  chapter_id     INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  read_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chapter_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chapter_reads_user ON chapter_reads(user_id);
`);

// What people have done here, in the order they did it. Written as it
// happens rather than worked out afterwards from timestamps on other
// tables: most of it could be derived (a chapter row knows when it was
// created and by whom), but signing in, downloading a copy and syncing
// the wiki leave no other trace, and a log with holes in it is worse
// than no log -- you cannot tell "nobody did that" from "that is not
// recorded".
//
// subject and href are written at the time and never updated: a log
// entry should say what the thing was called when it happened, and a
// renamed chapter does not retroactively change what somebody did. The
// two foreign keys are only there for counting; they go null rather than
// taking the row with them when a story is deleted.
db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  href       TEXT,
  story_id   INTEGER REFERENCES stories(id) ON DELETE SET NULL,
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(id DESC);

-- ---------------------------------------------------------------------
-- The story bible: one per story, holding the people, places, groups,
-- things and events that story is made of.
-- ---------------------------------------------------------------------
-- Deliberately per-story and NOT the glossary. The glossary (wiki_pages)
-- is a read-only mirror of the shared-universe wiki: it is written by the
-- wiki, wiped and rewritten by every sync, and knows nothing about
-- anybody's chapters. A bible entry is the opposite on all three counts --
-- written here, kept here, and tied to the chapters of one story. A name
-- can honestly exist in both: the wiki's public account of a ship, and
-- what this author privately knows about it.
CREATE TABLE IF NOT EXISTS story_entities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id     INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'person',
  name         TEXT NOT NULL,
  name_lower   TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  secret       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT '',
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(story_id, name_lower)
);
CREATE INDEX IF NOT EXISTS idx_entities_story ON story_entities(story_id, kind, name_lower);

-- The other names a person is called by -- a rank, a nickname, a maiden
-- name, a ship's pennant number. They are what makes the appearance scan
-- honest: "the Old Man" is the same character as "Commodore Raye", and a
-- chapter that only ever uses one of them still counts as an appearance.
-- story_id is denormalised so the per-story matcher is one indexed read.
CREATE TABLE IF NOT EXISTS story_entity_aliases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id   INTEGER NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
  story_id    INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL,
  alias_lower TEXT NOT NULL,
  UNIQUE(entity_id, alias_lower)
);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_story ON story_entity_aliases(story_id);

-- A relation is stored once and read from both ends: "Kessler --sister
-- of--> Prado" is also "Prado --brother of--> Kessler", and storing it
-- twice is how the two halves end up disagreeing. reverse_label is what
-- the far end calls it; blank means the same word both ways ("married
-- to", "rival of").
CREATE TABLE IF NOT EXISTS story_entity_links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id      INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  from_id       INTEGER NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
  to_id         INTEGER NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
  label         TEXT NOT NULL DEFAULT '',
  reverse_label TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_entity_links_from ON story_entity_links(from_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_to ON story_entity_links(to_id);

-- Where each entry is named, worked out by scanning the current text of
-- every chapter (see lib/story-bible.js). A cache, not a source: every row
-- here can be thrown away and rebuilt from the chapters, and is, whenever
-- a chapter or a name changes. Caching it is what makes "who is in chapter
-- 12" and "which chapters is she in" one indexed read instead of a scan of
-- the whole story.
CREATE TABLE IF NOT EXISTS story_entity_appearances (
  entity_id   INTEGER NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
  chapter_id  INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  story_id    INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  mentions    INTEGER NOT NULL DEFAULT 0,
  first_name  TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (entity_id, chapter_id)
);
CREATE INDEX IF NOT EXISTS idx_entity_appearances_chapter ON story_entity_appearances(chapter_id);
CREATE INDEX IF NOT EXISTS idx_entity_appearances_story ON story_entity_appearances(story_id);

-- The scan is only as good as the prose: somebody present but never named
-- is missed, and a name that is also a common word is found too often. So
-- the author can overrule it either way, per chapter, and the override
-- survives every rebuild -- it is the one thing about appearances that is
-- a source rather than a cache.
CREATE TABLE IF NOT EXISTS story_entity_appearance_overrides (
  entity_id  INTEGER NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  state      TEXT NOT NULL,
  set_by     INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (entity_id, chapter_id)
);

-- The scan and the corrections, resolved once, in SQL, so that every
-- question about who is in what reads the same answer. Two places
-- implementing "cache minus excludes plus includes" is two places to get
-- it subtly different.
-- Custom fields, in two halves that answer two different needs.
--
-- The template is what every entry of one kind in this story should say:
-- every person has a Rank and a Home world, every ship a Class. Define it
-- once and the form asks for it every time, which is what makes a cast of
-- hundreds comparable instead of a hundred private habits.
CREATE TABLE IF NOT EXISTS story_field_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id    INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  label       TEXT NOT NULL,
  label_lower TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(story_id, kind, label_lower)
);
CREATE INDEX IF NOT EXISTS idx_field_templates ON story_field_templates(story_id, kind, position);

-- And what one entry actually says, template or not. A field whose label
-- matches the template fills that slot; anything else is an extra this
-- one entry needed. Storing both the same way means an entry keeps what
-- it says when the template changes its mind, and a field promoted into
-- the template does not have to be retyped into every entry.
CREATE TABLE IF NOT EXISTS story_entity_fields (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id   INTEGER NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
  story_id    INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  label_lower TEXT NOT NULL,
  value       TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(entity_id, label_lower)
);
CREATE INDEX IF NOT EXISTS idx_entity_fields ON story_entity_fields(entity_id, position);
CREATE INDEX IF NOT EXISTS idx_entity_fields_label ON story_entity_fields(story_id, label_lower);

-- Pictures of an entry: a portrait, a sketch, a deck plan. The bytes live
-- in data/entity-images/ (see lib/entity-images.js) and only the metadata
-- is here -- a database that swallows every photograph is a database that
-- takes a minute to copy. The lowest position is the one used as the
-- entry's face in listings.
CREATE TABLE IF NOT EXISTS story_entity_images (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id    INTEGER NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
  story_id     INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes        INTEGER NOT NULL DEFAULT 0,
  caption      TEXT NOT NULL DEFAULT '',
  position     INTEGER NOT NULL DEFAULT 0,
  uploaded_by  INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_entity_images ON story_entity_images(entity_id, position, id);

CREATE VIEW IF NOT EXISTS story_entity_chapters AS
  SELECT a.entity_id, a.chapter_id, a.story_id, a.mentions, a.first_name,
         CASE WHEN EXISTS (
           SELECT 1 FROM story_entity_appearance_overrides o
           WHERE o.entity_id = a.entity_id AND o.chapter_id = a.chapter_id AND o.state = 'include'
         ) THEN 'both' ELSE 'scan' END AS source
    FROM story_entity_appearances a
   WHERE NOT EXISTS (
     SELECT 1 FROM story_entity_appearance_overrides o
     WHERE o.entity_id = a.entity_id AND o.chapter_id = a.chapter_id AND o.state = 'exclude'
   )
  UNION ALL
  SELECT o.entity_id, o.chapter_id, c.story_id, 0, '', 'manual'
    FROM story_entity_appearance_overrides o
    JOIN chapters c ON c.id = o.chapter_id
   WHERE o.state = 'include'
     AND NOT EXISTS (
       SELECT 1 FROM story_entity_appearances a
       WHERE a.entity_id = o.entity_id AND a.chapter_id = o.chapter_id
     );
`);

// The same two on a bible entry, so a battle or a founding can sit on the
// timeline beside the chapters that tell it.
ensureColumn('story_entities', 'story_when', "TEXT NOT NULL DEFAULT ''");
ensureColumn('story_entities', 'story_day', 'INTEGER');

// Where in a picture the face is. A thumbnail is a square cut out of a
// picture that is rarely square, and the middle of the frame is a guess:
// these two percentages are the writer telling it which part to keep.
// 50/50 is the middle, which is where every picture starts.
ensureColumn('story_entity_images', 'focus_x', 'INTEGER NOT NULL DEFAULT 50');
ensureColumn('story_entity_images', 'focus_y', 'INTEGER NOT NULL DEFAULT 50');

// The review loop -- kinds of note, rewrites, notes that follow the text,
// asking for a read, drafts, the welcome card. Its own file (db-review.js)
// so this one stays under the length the structure test allows.
require('./db-review')(db, ensureColumn);


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

// Starting vocabulary for story tags, applied only to a database that has
// never had any (so an admin's later edits, including deletions, are never
// undone by a restart). It's a starting point to edit from on /admin, not
// a fixed list: this group writes in one shared universe, so the Swarm and
// Review groups especially are expected to grow local shorthand.
const SEED_TAGS = [
  ['Genre', [
    ['Science fiction', ''], ['Military', ''], ['Action', ''], ['Adventure', ''],
    ['Drama', ''], ['Romance', ''], ['Mystery', ''], ['Thriller', ''],
    ['Horror', ''], ['Humour', ''], ['Slice of life', ''], ['Tragedy', ''],
  ]],
  ['Setting', [
    ['Space', ''], ['Shipboard', ''], ['Planetside', ''], ['Earth', ''],
    ['Colony', ''], ['Post-apocalyptic', ''], ['Near future', ''], ['Far future', ''],
    ['Alternate history', ''], ['Time travel', ''], ['First contact', ''],
  ]],
  ['Swarm', [
    ['Confederacy', 'Told from inside the Confederacy.'],
    ["Sa'arm", 'The Swarm itself features directly.'],
    ['Volunteer', 'Follows a volunteer.'],
    ['Extraction', 'Covers an extraction.'],
    ['Earthbound', 'Stays on Earth.'],
  ]],
  ['Cast', [
    ['Ensemble', ''], ['Single POV', ''], ['Multiple POV', ''],
    ['Original characters', ''], ['Established characters', 'Uses characters from the shared canon.'],
  ]],
  ['Content notes', [
    ['Explicit sex', 'Adult sexual content, described on the page.'],
    ['Violence', ''],
    ['Graphic violence', ''],
    ['Major character death', ''],
    ['Dark themes', 'Abuse, trauma, or similarly heavy material.'],
    ['Strong language', ''],
    ['No sex', 'Nothing explicit at all.'],
  ]],
  ['Length', [
    ['Flash', 'Under 1,000 words.'], ['Short story', ''], ['Novelette', ''],
    ['Novella', ''], ['Novel', ''],
  ]],
  ['Review status', [
    ['Rough draft', 'Early, expect mess.'],
    ['Needs readers', 'Actively wants feedback.'],
    ['Line edits welcome', 'Past structure; wants sentence-level notes.'],
    ['Structure only', 'Please comment on the shape, not the prose.'],
    ['Nearly final', ''],
    ['Complete', ''],
    ['On hold', ''],
  ]],
];

function slugifyTag(name) {
  return String(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tag';
}

// A second batch, added after the first was already in use. The notation
// is StoriesOnline's: the "a" in Ma/Fa means adult, which is the whole
// point of it -- these describe grown-ups, and the teen variants of the
// same notation are deliberately not here.
const SEED_TAGS_V2 = [
  ['Orientation', [
    ['Heterosexual', ''],
    ['Homosexual', ''],
    ['Bisexual', ''],
    ['Transgender', ''],
  ]],
  ['Pairings', [
    ['Ma/Fa', 'One adult man and one adult woman.'],
    ['Ma/Ma', 'Two adult men.'],
    ['Fa/Fa', 'Two adult women.'],
    ['Mult', 'More than two people involved.'],
    ['Group', 'Group scenes.'],
    ['Harem', ''],
    ['Polyamory', 'More than one relationship at once, openly.'],
    ['Solo', 'No partner.'],
  ]],
];

// Seeding is versioned rather than "run once if the table is empty": each
// batch applies exactly once, so a later one can be shipped without
// re-adding -- or resurrecting -- tags an admin has since edited or
// deleted. Within a batch, a name that already exists is left alone.
function applyTagSeedBatch(batch) {
  const insert = db.prepare('INSERT INTO tags (name, slug, tag_group, description) VALUES (?, ?, ?, ?)');
  const exists = db.prepare('SELECT 1 FROM tags WHERE name = ? COLLATE NOCASE');
  const slugTaken = db.prepare('SELECT 1 FROM tags WHERE slug = ?');
  for (const [group, entries] of batch) {
    for (const [name, description] of entries) {
      if (exists.get(name)) continue;
      let slug = slugifyTag(name);
      if (slugTaken.get(slug)) slug = `${slug}-${group.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
      insert.run(name, slug, group, description);
    }
  }
}

const getMeta = (key) => (db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) || {}).value;
const setMeta = (key, value) => db.prepare(
  'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
).run(key, String(value));

const tagSeedVersion = Number(getMeta('tag_seed_version') || 0);
if (tagSeedVersion < 1) {
  // The first batch is a starting point for a database that has never had
  // any tags -- one that already has them chose them, and only needs the
  // marker set so this never runs again.
  const tagCount = db.prepare('SELECT COUNT(*) AS n FROM tags').get().n;
  if (tagCount === 0) applyTagSeedBatch(SEED_TAGS);
  setMeta('tag_seed_version', 1);
}
if (tagSeedVersion < 2) {
  applyTagSeedBatch(SEED_TAGS_V2);
  setMeta('tag_seed_version', 2);
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

// Everything the triggers would have written, written from scratch. Used
// once on an old database, and by test/search.test.js, which rebuilds
// after a battery of edits and asserts the result matches what the
// triggers left -- the check that keeps "a trigger cannot be forgotten"
// honest.
function rebuildSearchIndex() {
  db.exec('DELETE FROM search_index');
  db.exec(`
    INSERT INTO search_index (title, body, kind, ref, story_id)
      SELECT title, description, 'story', id, id FROM stories;
    INSERT INTO search_index (title, body, kind, ref, story_id)
      SELECT title, summary, 'chapter', id, story_id FROM chapters;
    INSERT INTO search_index (title, body, kind, ref, story_id)
      SELECT c.title, v.content, 'passage', c.id, c.story_id
        FROM chapters c JOIN chapter_versions v ON v.chapter_id = c.id
       WHERE v.version_number = (SELECT MAX(v2.version_number) FROM chapter_versions v2 WHERE v2.chapter_id = c.id);
    INSERT INTO search_index (title, body, kind, ref, story_id)
      SELECT name, summary || ' ' || description, 'entity', id, story_id FROM story_entities;
    INSERT INTO search_index (title, body, kind, ref, story_id)
      SELECT title, COALESCE(summary, '') || ' ' || COALESCE(content_text, ''), 'glossary', id, NULL FROM wiki_pages;
  `);
}

ensureColumn('wiki_pages', 'content_text', 'TEXT');
// Pages synced before the search index existed have HTML and no text.
// Filling it here rather than waiting for the next sync means the
// glossary is searchable the moment this version starts.
{
  const stale = db.prepare(
    'SELECT id, content_html FROM wiki_pages WHERE content_text IS NULL AND content_html IS NOT NULL'
  ).all();
  if (stale.length) {
    const { htmlToText } = require('./lib/util');
    const update = db.prepare('UPDATE wiki_pages SET content_text = ? WHERE id = ?');
    for (const row of stale) update.run(htmlToText(row.content_html), row.id);
  }
}

db.exec(`
-- ---------- the search index ----------
-- One FTS5 table for everything searchable, rather than a LIKE scan per
-- table. What it buys is not speed -- a scan of this archive costs under
-- a millisecond -- but three things a LIKE cannot do at any size:
--
--   * words, not substrings. "art" stops matching "start" and "heart",
--     which is the one that actually bites every day.
--   * phrases and prefixes, spelled the way a reader expects: "held its
--     breath", or anch*.
--   * order by how well a row matches instead of alphabetically, which is
--     what makes a long results page worth reading at all.
--
-- It is kept in step by triggers rather than by remembering to call
-- something from each write path. A trigger cannot be forgotten in a
-- feature written next year; a function call can. test/search.test.js
-- rebuilds the index from scratch after a battery of edits and asserts it
-- matches what the triggers left, which is what makes that claim checkable
-- rather than hopeful.
--
-- remove_diacritics 2 folds accents, so a search for "Tampaad" finds
-- "Tampáad" and a Spanish-speaking writer does not have to guess.
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  title,
  body,
  kind UNINDEXED,
  ref UNINDEXED,
  story_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Stories.
CREATE TRIGGER IF NOT EXISTS search_story_ai AFTER INSERT ON stories BEGIN
  INSERT INTO search_index (title, body, kind, ref, story_id)
  VALUES (new.title, new.description, 'story', new.id, new.id);
END;
CREATE TRIGGER IF NOT EXISTS search_story_au AFTER UPDATE ON stories BEGIN
  DELETE FROM search_index WHERE kind = 'story' AND ref = old.id;
  INSERT INTO search_index (title, body, kind, ref, story_id)
  VALUES (new.title, new.description, 'story', new.id, new.id);
END;
CREATE TRIGGER IF NOT EXISTS search_story_ad AFTER DELETE ON stories BEGIN
  DELETE FROM search_index WHERE story_id = old.id;
END;

-- Chapters: the title and summary here, the prose below.
CREATE TRIGGER IF NOT EXISTS search_chapter_ai AFTER INSERT ON chapters BEGIN
  INSERT INTO search_index (title, body, kind, ref, story_id)
  VALUES (new.title, new.summary, 'chapter', new.id, new.story_id);
END;
CREATE TRIGGER IF NOT EXISTS search_chapter_au AFTER UPDATE ON chapters BEGIN
  DELETE FROM search_index WHERE kind = 'chapter' AND ref = old.id;
  INSERT INTO search_index (title, body, kind, ref, story_id)
  VALUES (new.title, new.summary, 'chapter', new.id, new.story_id);
END;
CREATE TRIGGER IF NOT EXISTS search_chapter_ad AFTER DELETE ON chapters BEGIN
  DELETE FROM search_index WHERE kind IN ('chapter', 'passage') AND ref = old.id;
END;

-- The prose, and only the version that is current. Searching every
-- version would bury one real hit under a copy of it from every draft the
-- chapter has been through.
CREATE TRIGGER IF NOT EXISTS search_version_ai AFTER INSERT ON chapter_versions BEGIN
  DELETE FROM search_index WHERE kind = 'passage' AND ref = new.chapter_id;
  INSERT INTO search_index (title, body, kind, ref, story_id)
  SELECT c.title, new.content, 'passage', c.id, c.story_id FROM chapters c WHERE c.id = new.chapter_id;
END;
CREATE TRIGGER IF NOT EXISTS search_version_ad AFTER DELETE ON chapter_versions BEGIN
  DELETE FROM search_index WHERE kind = 'passage' AND ref = old.chapter_id;
  INSERT INTO search_index (title, body, kind, ref, story_id)
  SELECT c.title, v.content, 'passage', c.id, c.story_id
    FROM chapters c JOIN chapter_versions v ON v.chapter_id = c.id
   WHERE c.id = old.chapter_id
     AND v.version_number = (SELECT MAX(v2.version_number) FROM chapter_versions v2 WHERE v2.chapter_id = c.id);
END;

-- Bible entries, with their aliases and custom fields folded in, because
-- "the Old Man" is how the prose says it and how somebody will search.
CREATE TRIGGER IF NOT EXISTS search_entity_ai AFTER INSERT ON story_entities BEGIN
  INSERT INTO search_index (title, body, kind, ref, story_id)
  VALUES (new.name, new.summary || ' ' || new.description, 'entity', new.id, new.story_id);
END;
CREATE TRIGGER IF NOT EXISTS search_entity_au AFTER UPDATE ON story_entities BEGIN
  DELETE FROM search_index WHERE kind = 'entity' AND ref = old.id;
  INSERT INTO search_index (title, body, kind, ref, story_id)
  VALUES (new.name, new.summary || ' ' || new.description, 'entity', new.id, new.story_id);
END;
CREATE TRIGGER IF NOT EXISTS search_entity_ad AFTER DELETE ON story_entities BEGIN
  DELETE FROM search_index WHERE kind = 'entity' AND ref = old.id;
END;

-- The glossary. content_text is the wiki's HTML with the tags taken out,
-- written at sync time (lib/wiki.js): indexing the HTML itself would make
-- every page a match for "span".
CREATE TRIGGER IF NOT EXISTS search_wiki_ai AFTER INSERT ON wiki_pages BEGIN
  INSERT INTO search_index (title, body, kind, ref, story_id)
  VALUES (new.title, COALESCE(new.summary, '') || ' ' || COALESCE(new.content_text, ''), 'glossary', new.id, NULL);
END;
CREATE TRIGGER IF NOT EXISTS search_wiki_au AFTER UPDATE ON wiki_pages BEGIN
  DELETE FROM search_index WHERE kind = 'glossary' AND ref = old.id;
  INSERT INTO search_index (title, body, kind, ref, story_id)
  VALUES (new.title, COALESCE(new.summary, '') || ' ' || COALESCE(new.content_text, ''), 'glossary', new.id, NULL);
END;
CREATE TRIGGER IF NOT EXISTS search_wiki_ad AFTER DELETE ON wiki_pages BEGIN
  DELETE FROM search_index WHERE kind = 'glossary' AND ref = old.id;
END;
`);

// If the index is empty and there is anything to index, the triggers were
// added after the writing was. Fill it once; the triggers keep it from
// there. This also means a restart is a repair: an index that has somehow
// drifted can be dropped and will come back correct.
{
  const indexed = db.prepare('SELECT COUNT(*) AS n FROM search_index').get().n;
  const written = db.prepare('SELECT COUNT(*) AS n FROM chapters').get().n;
  if (!indexed && written) rebuildSearchIndex();
}

// The database itself, with the one maintenance function that belongs to
// the schema rather than to any query: see rebuildSearchIndex above.
db.rebuildSearchIndex = rebuildSearchIndex;
module.exports = db;
