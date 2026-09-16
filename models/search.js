'use strict';

const { db } = require('./shared');
const { toMatchQuery, HIT_OPEN, HIT_CLOSE } = require('../lib/search-query');

// Search runs against one FTS5 index covering everything (see db.js),
// rather than a LIKE scan per table. The speed was never the argument --
// a scan of this archive costs under a millisecond -- but three things a
// LIKE cannot do at any size are: match words rather than substrings, so
// "art" stops finding "start"; take a phrase or a prefix the way a reader
// writes one; and order by how well a row matched instead of
// alphabetically, which is what makes a long page of results worth
// reading.
//
// Each kind is asked for separately so a chapter whose *title* matches
// ranks as a chapter rather than being lost among passages, which is the
// distinction the results page is built around.

const SNIPPET = (column) => `snippet(search_index, ${column}, '${HIT_OPEN}', '${HIT_CLOSE}', '…', 14)`;

/**
 * Refs of one kind, best first. The FTS table knows nothing about who may
 * see what, so it answers with ids and the caller's own query does the
 * joining and the filtering -- there is no path here that skips the rules
 * on the tables themselves.
 */
function matches(kind, match, limit) {
  // Both columns: the hit is as often in a name as in the prose, and a
  // result whose mark is nowhere on it reads like an accident.
  return db.prepare(`
    SELECT ref, ${SNIPPET(0)} AS title_snippet, ${SNIPPET(1)} AS snippet, rank
      FROM search_index
     WHERE search_index MATCH @match AND kind = @kind
     ORDER BY rank
     LIMIT @limit
  `).all({ match, kind, limit });
}

// Keeps the order the index gave, which is the whole point of using it.
function inRankOrder(hits, rows, key = 'id') {
  const byId = new Map(rows.map((r) => [r[key], r]));
  const marked = (text) => String(text || '').includes(HIT_OPEN);
  return hits
    .map((h) => (byId.has(h.ref)
      ? {
        ...byId.get(h.ref),
        snippet: h.snippet,
        // Only when the mark is actually in it; otherwise the view uses
        // the plain title it already has.
        titleSnippet: marked(h.title_snippet) ? h.title_snippet : null,
      }
      : null))
    .filter(Boolean);
}

function pick(sql, ids, params = {}) {
  if (!ids.length) return [];
  return db.prepare(sql.replace('@ids', ids.join(','))).all(params);
}

function searchStories(match, limit) {
  const hits = matches('story', match, limit);
  return inRankOrder(hits, pick(`
    SELECT s.id, s.title, s.description, u.display_name AS author_name
      FROM stories s JOIN users u ON u.id = s.author_id
     WHERE s.id IN (@ids) AND s.archived_at IS NULL
  `, hits.map((h) => h.ref)));
}

function searchChapters(match, limit) {
  const hits = matches('chapter', match, limit);
  return inRankOrder(hits, pick(`
    SELECT c.id, c.title, c.summary, c.chapter_number, c.story_id, s.title AS story_title
      FROM chapters c JOIN stories s ON s.id = c.story_id
     WHERE c.id IN (@ids) AND c.archived_at IS NULL AND s.archived_at IS NULL
  `, hits.map((h) => h.ref)));
}

// The prose. Only the current version of each chapter is in the index, so
// one real hit cannot come back once per draft the chapter has been
// through.
function searchChapterText(match, limit) {
  const hits = matches('passage', match, limit);
  return inRankOrder(hits, pick(`
    SELECT c.id, c.title, c.chapter_number, c.story_id, s.title AS story_title
      FROM chapters c JOIN stories s ON s.id = c.story_id
     WHERE c.id IN (@ids) AND c.archived_at IS NULL AND s.archived_at IS NULL
  `, hits.map((h) => h.ref)));
}

function searchGlossary(match, limit) {
  const hits = matches('glossary', match, limit);
  return inRankOrder(hits, pick(`
    SELECT id, title, title AS slug, summary FROM wiki_pages WHERE id IN (@ids)
  `, hits.map((h) => h.ref)));
}

// A private bible is private here too. The index does not know that, so
// the join does: an entry only comes back if the story is open or the
// person asking writes in it.
function searchBible(match, limit, userId) {
  const hits = matches('entity', match, limit);
  return inRankOrder(hits, pick(`
    SELECT e.id, e.name, e.kind, e.summary, e.story_id, s.title AS story_title,
      (SELECT GROUP_CONCAT(a.alias, ', ') FROM story_entity_aliases a WHERE a.entity_id = e.id) AS alias_list
      FROM story_entities e JOIN stories s ON s.id = e.story_id
     WHERE e.id IN (@ids) AND s.archived_at IS NULL
       AND (
         s.bible_private = 0 OR s.author_id = @userId
         OR EXISTS (SELECT 1 FROM story_authors sa WHERE sa.story_id = s.id AND sa.user_id = @userId)
       )
  `, hits.map((h) => h.ref), { userId: userId || 0 }));
}

function searchEverything(query, { limit = 20, userId = 0 } = {}) {
  const clean = String(query || '').trim();
  if (clean.length < 2) return null;
  const match = toMatchQuery(clean);
  // Two characters of punctuation is not a search. Same answer as a query
  // that is too short, because it is the same situation.
  if (!match) return null;
  return {
    query: clean,
    stories: searchStories(match, limit),
    chapters: searchChapters(match, limit),
    passages: searchChapterText(match, limit),
    glossary: searchGlossary(match, limit),
    bible: searchBible(match, limit, userId),
  };
}

module.exports = {
  searchBible,
  searchChapterText,
  searchChapters,
  searchEverything,
  searchGlossary,
  searchStories,
};
