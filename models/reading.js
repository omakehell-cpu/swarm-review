'use strict';

const { db } = require('./shared');
const { reviewQueueFor } = require('./reviews');
// An author posting a chapter and hearing nothing back cannot tell the
// difference between "nobody has looked at it" and "three people read it
// and had nothing to say". Those are opposite problems and the app used
// to be silent about both.

// Recorded when the page loads, and kept at the newest version somebody
// has seen -- so revising a chapter does not wipe the fact that people
// read the earlier draft, but the story page can still say who has seen
// the version that is up now.
// Returns true the first time this person opens this chapter, so the
// caller can put that in the log once instead of on every visit: "read
// it" is news, "looked at it again" is not.
function markChapterRead(chapterId, userId, versionNumber) {
  const before = db.prepare('SELECT 1 FROM chapter_reads WHERE chapter_id = ? AND user_id = ?').get(chapterId, userId);
  db.prepare(`
    INSERT INTO chapter_reads (chapter_id, user_id, version_number)
    VALUES (@chapterId, @userId, @versionNumber)
    ON CONFLICT (chapter_id, user_id) DO UPDATE SET
      version_number = MAX(version_number, @versionNumber),
      read_at = datetime('now')
  `).run({ chapterId, userId, versionNumber });
  return !before;
}

// ---------- where somebody stopped ----------

/** @param {number} userId @param {number} chapterId @param {number} paragraph @param {number} total */
function saveReadingPlace(userId, chapterId, paragraph, total) {
  // The top of the chapter, or its last screen, is not a place to come back to.
  if (!(paragraph > 1) || !(total > 0) || paragraph >= total) {
    db.prepare('DELETE FROM reading_places WHERE user_id = ? AND chapter_id = ?').run(userId, chapterId);
    return;
  }
  db.prepare(`
    INSERT INTO reading_places (user_id, chapter_id, paragraph, total) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, chapter_id) DO UPDATE SET paragraph = excluded.paragraph, total = excluded.total, at = datetime('now')
  `).run(userId, chapterId, Math.floor(paragraph), Math.floor(total));
}

/** @param {number} userId @param {number} chapterId */
function readingPlace(userId, chapterId) {
  return db.prepare('SELECT paragraph, total, at FROM reading_places WHERE user_id = ? AND chapter_id = ?').get(userId, chapterId) || null;
}

function listChapterReaders(chapterId) {
  return db.prepare(`
    SELECT u.id, u.display_name, r.read_at, r.version_number
    FROM chapter_reads r JOIN users u ON u.id = r.user_id
    WHERE r.chapter_id = ?
    ORDER BY r.read_at
  `).all(chapterId);
}


// One query for a story's whole chapter list.
function readersForChapters(chapterIds) {
  const byChapter = new Map(chapterIds.map((id) => [Number(id), []]));
  if (!chapterIds.length) return byChapter;
  const rows = db.prepare(`
    SELECT r.chapter_id, r.version_number, u.id, u.display_name
    FROM chapter_reads r JOIN users u ON u.id = r.user_id
    WHERE r.chapter_id IN (${chapterIds.map(() => '?').join(',')})
    ORDER BY r.read_at
  `).all(...chapterIds);
  for (const row of rows) {
    const list = byChapter.get(Number(row.chapter_id));
    if (list) list.push({ id: row.id, display_name: row.display_name, version_number: row.version_number });
  }
  return byChapter;
}

// ---------- what's waiting for you ----------

// The story index answers "what is here". This answers "what is here for
// me", which for a group that exists to correct each other's drafts is
// the question you actually arrive with.
//
// Two different kinds of thing, deliberately kept apart. Pending comments
// on your own chapters are *outstanding*: they sit there until you accept
// or reject them, and reloading the page does not make them go away. The
// other two are *news*, and use the same "since your last visit" mark the
// New badges already use -- which means reloading does clear them. Mixing
// the two would make the durable list look dismissable.

const LATEST_VERSION = `v.version_number = (
  SELECT MAX(v9.version_number) FROM chapter_versions v9 WHERE v9.chapter_id = v.chapter_id
)`;

function pendingOnMyChapters(userId) {
  return db.prepare(`
    SELECT c.id AS chapter_id, c.title AS chapter_title, c.chapter_number,
           s.id AS story_id, s.title AS story_title,
           COUNT(*) AS pending, MAX(cm.created_at) AS latest_at
    FROM comments cm
    JOIN chapter_versions v ON v.id = cm.version_id
    JOIN chapters c ON c.id = v.chapter_id
    JOIN stories s ON s.id = c.story_id
    WHERE c.author_id = @userId
      AND c.archived_at IS NULL AND s.archived_at IS NULL
      AND ${LATEST_VERSION}
      AND cm.status = 'pending' AND cm.parent_id IS NULL AND cm.deleted_at IS NULL
    GROUP BY c.id
    ORDER BY latest_at DESC
  `).all({ userId });
}

function repliesToMe(userId, since, limit) {
  if (!since) return [];
  return db.prepare(`
    SELECT r.id, r.body, r.created_at, u.display_name AS author_name,
           c.id AS chapter_id, c.title AS chapter_title, c.chapter_number,
           s.title AS story_title
    FROM comments r
    JOIN comments parent ON parent.id = r.parent_id
    JOIN chapter_versions v ON v.id = r.version_id
    JOIN chapters c ON c.id = v.chapter_id
    JOIN stories s ON s.id = c.story_id
    JOIN users u ON u.id = r.author_id
    WHERE parent.author_id = @userId AND r.author_id <> @userId
      AND r.deleted_at IS NULL AND r.created_at > @since
      AND c.archived_at IS NULL AND s.archived_at IS NULL
    ORDER BY r.created_at DESC
    LIMIT @limit
  `).all({ userId, since, limit });
}


// Notes and replies that name somebody: "@luis, is this the same Kessler?"
// Matched by the username, which is the one name that never changes and
// has no spaces. LIKE narrows it in SQL; the pattern decides, so "@luisa"
// is not a mention of "luis".
/** @returns {any[]} */
function mentionsOf(userId, since, limit) {
  if (!since) return [];
  const me = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  if (!me) return [];
  const rows = db.prepare(`
    SELECT r.id, r.body, r.created_at, r.parent_id, u.display_name AS author_name,
           c.id AS chapter_id, c.title AS chapter_title, c.chapter_number,
           s.title AS story_title
    FROM comments r
    JOIN chapter_versions v ON v.id = r.version_id
    JOIN chapters c ON c.id = v.chapter_id
    JOIN stories s ON s.id = c.story_id
    JOIN users u ON u.id = r.author_id
    WHERE r.body LIKE @pattern AND r.author_id <> @userId
      AND r.deleted_at IS NULL AND r.created_at > @since
      AND c.archived_at IS NULL AND s.archived_at IS NULL
    ORDER BY r.created_at DESC
    LIMIT @limit
  `).all({ userId, since, limit: limit * 3, pattern: `%@${me.username}%` });
  const re = new RegExp(`(^|[^\\w@])@${me.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i');
  return rows.filter((r) => re.test(String(r.body || ''))).slice(0, limit)
    .map((r) => /** @type {any} */ (Object.assign({}, r, { mention: true })));
}

// Not "since your last visit" any more: what you have not opened. The old
// version cleared itself every time somebody loaded the index, which is
// the wrong behaviour for a list of things still to do -- reading the page
// is not the same as reading the chapter.
function chaptersNewToMe(userId, limit) {
  return db.prepare(`
    SELECT c.id, c.title, c.chapter_number, c.created_at,
           s.id AS story_id, s.title AS story_title, u.display_name AS author_name,
           (SELECT v.word_count FROM chapter_versions v WHERE v.chapter_id = c.id
             ORDER BY v.version_number DESC LIMIT 1) AS word_count
    FROM chapters c
    JOIN stories s ON s.id = c.story_id
    JOIN users u ON u.id = c.author_id
    WHERE c.author_id <> @userId
      AND c.archived_at IS NULL AND s.archived_at IS NULL
      -- A chapter that came in with an imported story is not news: it was
      -- written years ago, somewhere else. One added after the import is.
      AND (s.imported_at IS NULL OR c.created_at > s.imported_at)
      AND NOT EXISTS (
        SELECT 1 FROM chapter_reads r WHERE r.chapter_id = c.id AND r.user_id = @userId
      )
    ORDER BY c.created_at DESC
    LIMIT @limit
  `).all({ userId, limit });
}


/**
 * @param {number} userId
 * @param {{ since?: string|null, limit?: number }} [options]
 */
function inboxFor(userId, { since = null, limit = 8 } = {}) {
  const pending = pendingOnMyChapters(userId);
  // A reply that also names you is one thing, not two.
  const direct = repliesToMe(userId, since, limit);
  const seen = new Set(direct.map((r) => r.id));
  const replies = direct.concat(mentionsOf(userId, since, limit).filter((m) => !seen.has(m.id)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
  const asked = reviewQueueFor(userId);
  // A chapter somebody asked you to read is already at the top of the
  // list; saying it again under "new to read" is the same thing twice.
  const askedIds = new Set(asked.map((r) => r.chapter_id));
  const newChapters = chaptersNewToMe(userId, limit).filter((c) => !askedIds.has(c.id));
  return {
    asked,
    pending,
    replies,
    newChapters,
    empty: !asked.length && !pending.length && !replies.length && !newChapters.length,
  };
}

// ---------- the story's own calendar ----------

module.exports = {
  LATEST_VERSION,
  chaptersNewToMe,
  inboxFor,
  listChapterReaders,
  markChapterRead,
  mentionsOf,
  readingPlace,
  saveReadingPlace,
  pendingOnMyChapters,
  readersForChapters,
  repliesToMe,
};
