'use strict';

const { db } = require('./shared');
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
    SELECT s.*, u.display_name AS author_name, u.username AS author_username,
      (SELECT COUNT(*) FROM chapters c WHERE c.story_id = s.id AND c.archived_at IS NULL) AS chapter_count,
      (SELECT MAX(ch.created_at) FROM chapters ch WHERE ch.story_id = s.id AND ch.archived_at IS NULL) AS last_chapter_at,
      -- Not the same as the last chapter: a story being heavily revised
      -- is being written in, and storyState should not call it dormant.
      (SELECT MAX(v6.created_at) FROM chapters c6 JOIN chapter_versions v6 ON v6.chapter_id = c6.id
        WHERE c6.story_id = s.id AND c6.archived_at IS NULL) AS last_written_at,
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
      -- Who has been reading it, and how much has been said about it: the
      -- two numbers that say a story has an audience in the group.
      (SELECT COUNT(DISTINCT r.user_id) FROM chapter_reads r JOIN chapters c7 ON c7.id = r.chapter_id
        WHERE c7.story_id = s.id AND c7.archived_at IS NULL) AS reader_count,
      (SELECT COUNT(*) FROM comments cm8 JOIN chapter_versions v8 ON v8.id = cm8.version_id
        JOIN chapters c8 ON c8.id = v8.chapter_id
        WHERE c8.story_id = s.id AND cm8.parent_id IS NULL AND cm8.deleted_at IS NULL) AS note_count,
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
    SELECT s.*, u.display_name AS author_name, u.username AS author_username
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

module.exports = {
  archiveStory,
  createStory,
  deleteStoryForever,
  getStoryById,
  listStories,
  unarchiveStory,
};
