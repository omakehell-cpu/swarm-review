// db-review.js -- the schema for the review loop, run by db.js at start-up
// right after its own migrations. Everything here is additive: new
// nullable or defaulted columns and new tables, created only if missing.
'use strict';

/**
 * @param {any} db
 * @param {(table: string, column: string, definition: string) => void} ensureColumn
 */
module.exports = function applyReviewSchema(db, ensureColumn) {
  // ---------- the review loop ----------
  //
  // What kind of note this is, in one word: '' (just a note), 'typo',
  // 'pacing', 'continuity', 'question' or 'praise'. A label, not a
  // workflow -- every kind is answered the same way, except praise, which
  // asks nothing of the author and is settled the moment it is left.
  ensureColumn('comments', 'kind', "TEXT NOT NULL DEFAULT ''");
  // A rewrite of the quoted passage, offered instead of described. Null for
  // an ordinary note. Accepting it can put it into the text for the author
  // (see lib/suggestions.js); `applied_in` is the version that did.
  ensureColumn('comments', 'suggestion', 'TEXT');
  ensureColumn('comments', 'applied_in', 'INTEGER');
  // A continuity note can point at the bible entry it is about.
  ensureColumn('comments', 'entity_id', 'INTEGER');
  // A pending note follows the chapter to its next version when the words
  // it was about are still there (see carryPendingNotes). `left_on` is the
  // version number it was first written against, so the card can say so.
  // `passage_changed_in` is set instead when the words were gone: the note
  // stays behind on the version it was about, and the chapter page points
  // at it rather than pretending it applies to text that no longer exists.
  ensureColumn('comments', 'left_on', 'INTEGER');
  ensureColumn('comments', 'passage_changed_in', 'INTEGER');

  // "Would you read this?" -- one author asking one person, about one
  // chapter, with a question if they have one. Open until the reader says
  // they are done; asking again reopens it rather than adding a second row.
  db.exec(`
  CREATE TABLE IF NOT EXISTS review_requests (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id     INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    reviewer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    question       TEXT NOT NULL DEFAULT '',
    version_number INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    done_at        TEXT,
    done_note      TEXT NOT NULL DEFAULT '',
    UNIQUE(chapter_id, reviewer_id)
  );
  CREATE INDEX IF NOT EXISTS idx_review_requests_reviewer ON review_requests(reviewer_id, done_at);

  -- Work in progress on a chapter that has not been published as a
  -- version yet. One per chapter and person: saving a draft replaces the
  -- last one. Kept on the server so a draft started on a phone is there on
  -- the laptop, which the browser-only rescue copy cannot do.
  CREATE TABLE IF NOT EXISTS chapter_drafts (
    chapter_id    INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL DEFAULT '',
    summary       TEXT NOT NULL DEFAULT '',
    content       TEXT NOT NULL,
    base_version  INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (chapter_id, user_id)
  );
  `);

  // The welcome card on the front page, until its three steps are done or
  // its reader puts it away.
  ensureColumn('users', 'welcome_dismissed_at', 'TEXT');

  // A story's cover, if its author has uploaded one. The file sits with
  // the bible's pictures in data/entity-images (see lib/entity-images.js);
  // the focus is which part of it a cropped thumbnail keeps, in per cent.
  // No cover is a normal state, and the story is listed as text.
  ensureColumn('stories', 'cover_filename', 'TEXT');
  ensureColumn('stories', 'cover_type', 'TEXT');
  ensureColumn('stories', 'cover_focus_x', 'INTEGER NOT NULL DEFAULT 50');
  ensureColumn('stories', 'cover_focus_y', 'INTEGER NOT NULL DEFAULT 50');

  // Which of the three looks this person reads the site in: '' (the
  // default, clean), 'literary' or 'swarm'. A preference like the reading
  // size, except that it follows them to every device, so it is stored
  // here rather than in the browser. See lib/looks.js.
  ensureColumn('users', 'look', "TEXT NOT NULL DEFAULT ''"); // no longer read: the site has one look

  // How this person wants to read, when it matters more than taste: open
  // chapters in Read mode every time, and have no links in the prose at
  // all -- the glossary and bible names read as the words they are. Asked
  // for by a reader who listens to the site: "let nothing get between me
  // and my book".
  ensureColumn('users', 'read_first', 'INTEGER NOT NULL DEFAULT 0');
  // Which batch of What's new was newest when this person last saw it
  // (see unseenReleases in lib/docs.js).
  ensureColumn('users', 'changelog_seen_key', 'TEXT');
  ensureColumn('users', 'plain_names', 'INTEGER NOT NULL DEFAULT 0');
  // Authors brought in with an imported story (lib/sol-import.js): a row in
  // users so the story has somebody to belong to, but not a member -- no
  // password, no sign-in, left out of every list of people. `claimed_by`
  // is the member whose account their stories were moved to.
  ensureColumn('users', 'is_placeholder', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'source_url', 'TEXT');
  ensureColumn('users', 'claimed_by', 'INTEGER');
  // How this reader likes lists of stories to look: '' (with covers) or
  // 'list' (one line each). Chosen once, kept (views/front.js).
  ensureColumn('users', 'story_view', "TEXT NOT NULL DEFAULT ''");
  // Where an imported story came from, and the series it belongs to there.
  ensureColumn('stories', 'source_url', 'TEXT');
  ensureColumn('stories', 'source_id', 'TEXT');
  ensureColumn('stories', 'series', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('stories', 'imported_at', 'TEXT');
  // The imported author a story came in under, kept after it is claimed so
  // the authors page (/authors) can still say whose it was on StoriesOnline.
  ensureColumn('stories', 'imported_author_id', 'INTEGER');
  db.exec(`UPDATE stories SET imported_author_id = author_id
    WHERE imported_author_id IS NULL AND source_url IS NOT NULL
      AND author_id IN (SELECT id FROM users WHERE is_placeholder = 1)`);
  // Glossary pages made from a story written here (models/story-glossary.js)
  // rather than copied from the wiki. A wiki sync replaces only the rows
  // where this is empty.
  ensureColumn('wiki_pages', 'story_id', 'INTEGER');

  // The writing desk (see models/desk.js). A note the author keeps against
  // one scene of a chapter -- "this is where she lies to him" -- private to
  // them, and kept by the scene's position in the chapter. And snapshots:
  // a copy of the text in the editor, with a name, taken on purpose and
  // kept until thrown away. Neither is a version; nobody else sees them.
  db.exec(`
  CREATE TABLE IF NOT EXISTS scene_notes (
    chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (chapter_id, position)
  );
  CREATE TABLE IF NOT EXISTS chapter_snapshots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL DEFAULT '',
    content    TEXT NOT NULL,
    word_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_chapter ON chapter_snapshots(chapter_id, id DESC);
  `);

  // Where somebody stopped reading a chapter: the paragraph at the top of
  // their screen when they left, out of how many. On the server rather
  // than in the browser, so a chapter begun on the phone picks up on the
  // laptop. Cleared once they reach the end.
  db.exec(`
  CREATE TABLE IF NOT EXISTS paragraph_reactions (
    version_id INTEGER NOT NULL REFERENCES chapter_versions(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    paragraph  INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (version_id, user_id, paragraph, kind)
  );
  -- Stories somebody follows: a star on the story, and its new chapters
  -- are then called out to them -- on the front page, in the bar, in
  -- their feed -- until they have read them.
  CREATE TABLE IF NOT EXISTS story_follows (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    story_id   INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, story_id)
  );
  CREATE INDEX IF NOT EXISTS idx_story_follows_story ON story_follows(story_id);
  CREATE TABLE IF NOT EXISTS reading_places (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    paragraph  INTEGER NOT NULL,
    total      INTEGER NOT NULL,
    at         TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, chapter_id)
  );
  -- Capitalised words an author has said are not names ("Kestrel" the
  -- adjective, a sentence's first word the check keeps catching): the
  -- unknown-names list stops offering them, for this story only.
  -- Somebody who claims an imported author (see models/imports.js) is
  -- asking to have that author's stories put on their own account. An
  -- admin says yes or no; until then nothing moves.
  CREATE TABLE IF NOT EXISTS author_claims (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    placeholder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message        TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'pending',
    decided_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at     TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS story_not_names (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id   INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    name_lower TEXT NOT NULL,
    added_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (story_id, name_lower)
  );

  -- A word the scan found that is not this entry after all: a part of the
  -- name ("Kessler" when it is her brother) or an alias that turned out to
  -- mean somebody else. Never an entry's own name.
  CREATE TABLE IF NOT EXISTS story_entity_blocked_forms (
    entity_id  INTEGER NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
    story_id   INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    form_lower TEXT NOT NULL,
    PRIMARY KEY (entity_id, form_lower)
  );

  -- How an entry stands from a chapter on: dead from chapter 12. The entry's
  -- own status is how it stands at the start; each row here is a change,
  -- and a reader only ever sees the ones up to where they have read.
  CREATE TABLE IF NOT EXISTS story_entity_status_changes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id  INTEGER NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
    story_id   INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    status     TEXT NOT NULL,
    set_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (entity_id, chapter_id)
  );
  CREATE INDEX IF NOT EXISTS idx_status_changes_story ON story_entity_status_changes(story_id);
  `);
  // How the scan finds an entry: in any case, not only with a capital
  // ("Will" is not every "will"), and whether a person's name is also
  // found in parts ("Kessler" for Anna Kessler).
  ensureColumn('story_entities', 'any_case', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('story_entities', 'match_parts', 'INTEGER NOT NULL DEFAULT 1');
  // An entry can last: a siege from day 12 to day 40. The start is
  // story_day; this is the last day, and empty for a single moment.
  ensureColumn('story_entities', 'story_day_end', 'INTEGER');
  // The editor's writing checks, as somebody last set them -- which are
  // on, and whether dialogue is left alone -- so they follow the account
  // from one computer to the next. JSON; empty until first changed.
  ensureColumn('users', 'writing_settings', "TEXT NOT NULL DEFAULT ''");

  // The groups tags are filed under, in the order they are shown: the
  // fourteen categories StoriesOnline uses, then this group's own (see
  // lib/sol-tags.js). A group can exist with nothing in it yet. Filled,
  // and the old groups folded in, once, in db.js after the tag seeds.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tag_groups (
      name     TEXT PRIMARY KEY,
      position INTEGER NOT NULL DEFAULT 0
    );

    -- A person's character study (lib/character-study.js): one row per
    -- question answered. The writers' own notes, never shown to readers.
    CREATE TABLE IF NOT EXISTS story_entity_study (
      entity_id  INTEGER NOT NULL REFERENCES story_entities(id) ON DELETE CASCADE,
      question   TEXT NOT NULL,
      answer     TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (entity_id, question)
    );
  `);
};
