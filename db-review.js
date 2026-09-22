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
};
