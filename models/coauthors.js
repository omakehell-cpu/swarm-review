'use strict';

const { getUserById } = require('./people');
const { DELETED_USER_USERNAME, db } = require('./shared');
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


/**
 * Can this person read this story's bible? Everyone, unless its author has
 * made it private, in which case only the people who write the story --
 * admins included in nothing: being an admin is not a key to somebody
 * else's notebook any more than it is to their chapters.
 * @param {Row} story
 * @param {Row} user
 */
function canReadBible(story, user) {
  if (!story) return false;
  return !story.bible_private || canWriteInStory(story, user);
}

function setBiblePrivate(storyId, isPrivate) {
  db.prepare('UPDATE stories SET bible_private = ? WHERE id = ?').run(isPrivate ? 1 : 0, storyId);
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


// ---------- the log ----------

// One row per thing somebody did. Every call goes through here, and every
// call site passes the label and the link at the time it happens (see the
// note on the table in db.js). Nothing in here throws: a log that can fail
// a request is a log that will one day take the app down for the sake of
// remembering that somebody opened a chapter.
const insertEvent = db.prepare(`
  INSERT INTO events (user_id, kind, subject, href, story_id, chapter_id)
  VALUES (@userId, @kind, @subject, @href, @storyId, @chapterId)
`);

function recordEvent({ userId, kind, subject = '', href = null, storyId = null, chapterId = null }) {
  if (!userId || !kind) return null;
  try {
    return insertEvent.run({
      userId, kind, subject: String(subject).slice(0, 300), href, storyId, chapterId,
    });
  } catch (e) {
    return null;
  }
}

const listEventsForUser = (userId, limit = 50) =>
  db.prepare('SELECT * FROM events WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);

const countEventsForUser = (userId) =>
  db.prepare('SELECT COUNT(*) AS n FROM events WHERE user_id = ?').get(userId).n;

const listRecentEvents = (limit = 60) => db.prepare(`
  SELECT e.*, u.display_name, u.username
  FROM events e LEFT JOIN users u ON u.id = e.user_id
  ORDER BY e.id DESC LIMIT ?
`).all(limit);

// ---------- what somebody has done, in numbers ----------

// Words are counted from the current version of each chapter they wrote,
// not from every version they ever saved: the second reading would make a
// heavy reviser look ten times more productive than a careful one.
function userStats(userId) {
  const one = (sql, params = [userId]) => db.prepare(sql).get(...params);
  const words = one(`
    SELECT COALESCE(SUM(v.word_count), 0) AS n
    FROM chapters c
    JOIN chapter_versions v ON v.id = (
      SELECT id FROM chapter_versions WHERE chapter_id = c.id ORDER BY version_number DESC LIMIT 1
    )
    WHERE c.author_id = ? AND c.archived_at IS NULL
  `).n;
  return {
    words,
    chapters: one('SELECT COUNT(*) AS n FROM chapters WHERE author_id = ? AND archived_at IS NULL').n,
    // A version row records when it was saved but not by whom -- the
    // only people who can save one are the chapter's author and the
    // story's owner, so this counts the versions of their own chapters
    // and calls it theirs.
    versions: one(`
      SELECT COUNT(*) AS n FROM chapter_versions v
      JOIN chapters c ON c.id = v.chapter_id
      WHERE c.author_id = ? AND c.archived_at IS NULL
    `).n,
    storiesStarted: one('SELECT COUNT(*) AS n FROM stories WHERE author_id = ? AND archived_at IS NULL').n,
    commentsWritten: one('SELECT COUNT(*) AS n FROM comments WHERE author_id = ? AND deleted_at IS NULL').n,
    commentsReceived: one(`
      SELECT COUNT(*) AS n
      FROM comments cm
      JOIN chapter_versions v ON v.id = cm.version_id
      JOIN chapters c ON c.id = v.chapter_id
      WHERE c.author_id = ? AND cm.author_id != ? AND cm.deleted_at IS NULL
    `, [userId, userId]).n,
    chaptersRead: one('SELECT COUNT(*) AS n FROM chapter_reads WHERE user_id = ?').n,
  };
}


// Every story this person has a hand in: the ones they started and the
// ones they were invited into, with how much of each is theirs.
const listStoriesForUser = (userId) => db.prepare(`
  SELECT s.id, s.title, s.description, s.created_at, s.archived_at,
         s.author_id = @userId AS is_owner,
         (SELECT COUNT(*) FROM chapters c WHERE c.story_id = s.id AND c.archived_at IS NULL) AS chapters,
         (SELECT COUNT(*) FROM chapters c WHERE c.story_id = s.id AND c.archived_at IS NULL AND c.author_id = @userId) AS own_chapters
  FROM stories s
  WHERE s.archived_at IS NULL
    AND (s.author_id = @userId OR EXISTS (SELECT 1 FROM story_authors a WHERE a.story_id = s.id AND a.user_id = @userId))
  ORDER BY s.created_at DESC
`).all({ userId });

const listChaptersByUser = (userId, limit = 100) => db.prepare(`
  SELECT c.id, c.title, c.chapter_number, c.created_at, s.id AS story_id, s.title AS story_title,
         (SELECT v.word_count FROM chapter_versions v WHERE v.chapter_id = c.id ORDER BY v.version_number DESC LIMIT 1) AS word_count
  FROM chapters c JOIN stories s ON s.id = c.story_id
  WHERE c.author_id = ? AND c.archived_at IS NULL AND s.archived_at IS NULL
  ORDER BY c.created_at DESC
  LIMIT ?
`).all(userId, limit);

function setDisplayName(userId, displayName) {
  db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName, userId);
  return getUserById(userId);
}



// ---------- point of view, narrative strands, and what is being aimed at ----------

module.exports = {
  addStoryCoauthor,
  canReadBible,
  canWriteInStory,
  coauthorsForStories,
  countEventsForUser,
  insertEvent,
  isStoryCoauthor,
  listAddableCoauthors,
  listChaptersByUser,
  listEventsForUser,
  listRecentEvents,
  listStoriesForUser,
  listStoryCoauthors,
  recordEvent,
  removeStoryCoauthor,
  setBiblePrivate,
  setDisplayName,
  userStats,
};
