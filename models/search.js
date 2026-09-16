'use strict';

const { db } = require('./shared');
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



// The bibles, in the site search. A cast of hundreds that only the bible
// page can find is a cast of hundreds nobody looks at.
function searchBible(query, limit, userId) {
  return db.prepare(`
    SELECT e.id, e.name, e.kind, e.summary, e.story_id, s.title AS story_title,
      (SELECT GROUP_CONCAT(a.alias, ', ') FROM story_entity_aliases a WHERE a.entity_id = e.id) AS alias_list
    FROM story_entities e JOIN stories s ON s.id = e.story_id
    WHERE s.archived_at IS NULL
      AND (
        s.bible_private = 0 OR s.author_id = @userId
        OR EXISTS (SELECT 1 FROM story_authors sa WHERE sa.story_id = s.id AND sa.user_id = @userId)
      )
      AND (
      e.name LIKE @q ESCAPE '\\' OR e.summary LIKE @q ESCAPE '\\' OR e.description LIKE @q ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM story_entity_aliases a WHERE a.entity_id = e.id AND a.alias LIKE @q ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM story_entity_fields f WHERE f.entity_id = e.id AND f.value LIKE @q ESCAPE '\\')
    )
    ORDER BY e.name COLLATE NOCASE
    LIMIT @limit
  `).all({ q: LIKE(query), limit, userId: userId || 0 });
}

function searchEverything(query, { limit = 20, userId = 0 } = {}) {
  const clean = String(query || '').trim();
  if (clean.length < 2) return null;
  return {
    query: clean,
    stories: searchStories(clean, limit),
    chapters: searchChapters(clean, limit),
    passages: searchChapterText(clean, limit),
    glossary: searchGlossary(clean, limit),
    bible: searchBible(clean, limit, userId),
  };
}

// ---------- story tags (vocabulary curated on /admin, see db.js) ----------

module.exports = {
  LIKE,
  searchBible,
  searchChapterText,
  searchChapters,
  searchEverything,
  searchGlossary,
  searchStories,
};
