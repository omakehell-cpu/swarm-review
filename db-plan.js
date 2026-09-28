'use strict';

// The plan of a story: the arcs it is built from, nested, and the chapters
// that are planned but not written yet. Its own file, like db-review.js,
// so db.js stays under the length the structure test allows.
//
// An arc is a stretch of the story with a shape: something happens, and
// something is different at the end of it. Arcs nest -- a book holds arcs,
// an arc holds smaller ones -- and each says what it is and why it matters
// to the whole, which is the part a writer skips when the arc is only a
// name on a chapter.
//
// Where an arc starts and ends is a reference to a chapter ("c12") or to a
// planned chapter ("p3"), so an arc can be laid out before a word of it is
// written, and follows its chapters when they are reordered. A top-level
// arc runs until the next top-level arc starts, exactly as the old
// arc_title on a chapter did, and its title is still written there (see
// models/plan.js syncArcTitles) -- the compiler, the analysis and the
// chapter form all go on reading arc_title as they always have.
/** @param {any} db */
module.exports = function applyPlanSchema(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS story_arcs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id    INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    parent_id   INTEGER REFERENCES story_arcs(id) ON DELETE SET NULL,
    title       TEXT NOT NULL,
    summary     TEXT NOT NULL DEFAULT '',
    change_text TEXT NOT NULL DEFAULT '',
    purpose     TEXT NOT NULL DEFAULT '',
    start_ref   TEXT NOT NULL,
    end_ref     TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_story_arcs_story ON story_arcs(story_id);

  -- A chapter that is planned and not written: a title and the notes the
  -- writer has for it, sitting after a chapter (after_chapter_id; null is
  -- the very start) in the order given by position. It is not a chapter:
  -- no reader sees it, nothing counts it, and it becomes one only when
  -- somebody writes it.
  CREATE TABLE IF NOT EXISTS story_plan_slots (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id         INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    after_chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
    position         INTEGER NOT NULL DEFAULT 0,
    title            TEXT NOT NULL,
    notes            TEXT NOT NULL DEFAULT '',
    created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_story_plan_slots_story ON story_plan_slots(story_id);

  -- A pin on the story's calendar, dropped at a paragraph inside a
  -- chapter: "from here, it is Day 413, evening". A chapter that jumps a
  -- week halfway through, or flashes back for three paragraphs, is more
  -- than one moment, and the chapter's own date can only be one of them.
  --
  -- The paragraph is found by its opening words (anchor_text), not by its
  -- number or offset, so the pin stays on it through every edit that does
  -- not rewrite those words; anchor_offset is only a hint for which of two
  -- paragraphs opening the same way it meant.
  CREATE TABLE IF NOT EXISTS story_time_marks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id      INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    chapter_id    INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    anchor_text   TEXT NOT NULL,
    anchor_offset INTEGER NOT NULL DEFAULT 0,
    story_when    TEXT NOT NULL DEFAULT '',
    story_day     INTEGER,
    created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_story_time_marks_chapter ON story_time_marks(chapter_id);
  `);
};
