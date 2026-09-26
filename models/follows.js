'use strict';

// Following a story: a star on it, and from then on its new chapters are
// called out to the reader -- in the bar, at the top of the front page,
// and in their feed -- until they have read them. Nothing is sent
// anywhere; like the feed, this is here waiting when they come.
//
// "New" is a chapter somebody else put up after the reader started
// following, that they have not opened. The chapters that were already
// there are the story; they are not news.

const { db } = require('./shared');
const { toMatchQuery } = require('../lib/search-query');

function followStory(userId, storyId) {
  db.prepare('INSERT OR IGNORE INTO story_follows (user_id, story_id) VALUES (?, ?)').run(userId, storyId);
}

function unfollowStory(userId, storyId) {
  db.prepare('DELETE FROM story_follows WHERE user_id = ? AND story_id = ?').run(userId, storyId);
}

const isFollowing = (userId, storyId) => Boolean(
  db.prepare('SELECT 1 FROM story_follows WHERE user_id = ? AND story_id = ?').get(userId, storyId)
);

/** The ids of every story this reader follows. */
function followedStoryIds(userId) {
  return new Set(db.prepare('SELECT story_id FROM story_follows WHERE user_id = ?').all(userId).map((r) => Number(r.story_id)));
}

const followerCount = (storyId) => db.prepare('SELECT COUNT(*) AS n FROM story_follows WHERE story_id = ?').get(storyId).n;

const UNREAD_SINCE_FOLLOWING = `
  FROM chapters c
  WHERE c.story_id = f.story_id AND c.archived_at IS NULL
    AND c.author_id <> f.user_id
    AND c.created_at > f.created_at
    AND NOT EXISTS (SELECT 1 FROM chapter_reads r WHERE r.chapter_id = c.id AND r.user_id = f.user_id)`;

/**
 * The stories this reader follows, those with something new first: how
 * many chapters they have not read since they started following, and the
 * first of them.
 */
function followedStories(userId) {
  return db.prepare(`
    SELECT s.id, s.title, s.cover_filename, s.cover_focus_x, s.cover_focus_y, u.display_name AS author_name, f.created_at AS followed_at,
      (SELECT COUNT(*) ${UNREAD_SINCE_FOLLOWING}) AS fresh,
      (SELECT c.id ${UNREAD_SINCE_FOLLOWING} ORDER BY c.chapter_number LIMIT 1) AS first_fresh_id,
      (SELECT c.chapter_number ${UNREAD_SINCE_FOLLOWING} ORDER BY c.chapter_number LIMIT 1) AS first_fresh_number,
      (SELECT MAX(c.created_at) FROM chapters c WHERE c.story_id = s.id AND c.archived_at IS NULL) AS last_chapter_at
    FROM story_follows f
    JOIN stories s ON s.id = f.story_id
    JOIN users u ON u.id = s.author_id
    WHERE f.user_id = ? AND s.archived_at IS NULL
    ORDER BY fresh > 0 DESC, last_chapter_at DESC
  `).all(userId);
}

/** How many new chapters are waiting in the stories this reader follows. */
function followUpdatesCount(userId) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM story_follows f
    JOIN stories s ON s.id = f.story_id AND s.archived_at IS NULL
    JOIN chapters c ON c.story_id = f.story_id AND c.archived_at IS NULL
      AND c.author_id <> f.user_id AND c.created_at > f.created_at
    WHERE f.user_id = ?
      AND NOT EXISTS (SELECT 1 FROM chapter_reads r WHERE r.chapter_id = c.id AND r.user_id = f.user_id)
  `).get(userId).n;
}

/**
 * The stories whose own words have this in them -- in a chapter's text,
 * its title or summary, or the story's title and blurb -- for the
 * advanced search's "in the text". Null when there is nothing to search.
 */
function storiesWithText(raw) {
  const match = toMatchQuery(raw);
  if (!match) return null;
  return new Set(db.prepare(`
    SELECT DISTINCT story_id FROM search_index
    WHERE search_index MATCH ? AND kind IN ('story', 'chapter', 'passage')
  `).all(match).map((r) => Number(r.story_id)));
}

module.exports = {
  followStory, followUpdatesCount, followedStories, followedStoryIds, followerCount, isFollowing, storiesWithText, unfollowStory,
};
