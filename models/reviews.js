'use strict';

const { DELETED_USER_USERNAME, db } = require('./shared');

// ---------- asking somebody to read ----------
//
// The app always knew who had opened a chapter. What it could not do was
// the thing a writing group actually runs on: an author turning to one
// person and saying "would you read this -- and does the jump in time
// work?". Without a way to ask, a new chapter was a thing posted into a
// room, and a room answers when it feels like it.
//
// A request is between two people about one chapter. Asking the same
// person again (a new draft, a new question) reopens the one request
// rather than piling up a second; the reader closes it themselves when
// they are done, with a line for the author if they want one.

/**
 * @param {{ chapterId: number, reviewerIds: number[], requestedBy: number, question?: string, versionNumber: number }} fields
 * @returns {number[]} the ids actually asked (self and unknown ids dropped)
 */
function requestReview({ chapterId, reviewerIds, requestedBy, question = '', versionNumber }) {
  const valid = new Set(listPeopleToAsk(requestedBy).map((p) => p.id));
  const ids = [...new Set((reviewerIds || []).map(Number))].filter((id) => valid.has(id));
  const upsert = db.prepare(`
    INSERT INTO review_requests (chapter_id, reviewer_id, requested_by, question, version_number)
    VALUES (@chapterId, @reviewerId, @requestedBy, @question, @versionNumber)
    ON CONFLICT (chapter_id, reviewer_id) DO UPDATE SET
      requested_by = excluded.requested_by, question = excluded.question,
      version_number = excluded.version_number, created_at = datetime('now'),
      done_at = NULL, done_note = ''
  `);
  const q = String(question || '').trim().slice(0, 1000);
  for (const reviewerId of ids) upsert.run({ chapterId, reviewerId, requestedBy, question: q, versionNumber });
  return ids;
}

const listReviewRequestsForChapter = (chapterId) => db.prepare(`
  SELECT r.*, u.display_name AS reviewer_name, u.username AS reviewer_username,
    (SELECT COUNT(*) FROM comments cm JOIN chapter_versions v ON v.id = cm.version_id
      WHERE v.chapter_id = r.chapter_id AND cm.author_id = r.reviewer_id
        AND cm.deleted_at IS NULL AND cm.created_at >= r.created_at) AS notes_since
  FROM review_requests r JOIN users u ON u.id = r.reviewer_id
  WHERE r.chapter_id = ?
  ORDER BY r.done_at IS NOT NULL, u.display_name COLLATE NOCASE
`).all(chapterId);

const getReviewRequest = (id) => db.prepare('SELECT * FROM review_requests WHERE id = ?').get(id) || null;

const getOpenReviewRequest = (chapterId, reviewerId) => db.prepare(`
  SELECT r.*, u.display_name AS requested_by_name
  FROM review_requests r LEFT JOIN users u ON u.id = r.requested_by
  WHERE r.chapter_id = ? AND r.reviewer_id = ? AND r.done_at IS NULL
`).get(chapterId, reviewerId) || null;

function markReviewDone(id, note = '') {
  db.prepare("UPDATE review_requests SET done_at = datetime('now'), done_note = ? WHERE id = ?")
    .run(String(note || '').trim().slice(0, 1000), id);
  return getReviewRequest(id);
}

function withdrawReviewRequest(id) {
  db.prepare('DELETE FROM review_requests WHERE id = ?').run(id);
}

// What people have asked this reader for, oldest first -- a queue, and
// the one that has waited longest is the one to do next.
const reviewQueueFor = (userId) => db.prepare(`
  SELECT r.id, r.question, r.created_at, r.version_number,
         c.id AS chapter_id, c.title AS chapter_title, c.chapter_number,
         s.id AS story_id, s.title AS story_title,
         u.display_name AS requested_by_name,
         (SELECT v.word_count FROM chapter_versions v WHERE v.chapter_id = c.id
           ORDER BY v.version_number DESC LIMIT 1) AS word_count
  FROM review_requests r
  JOIN chapters c ON c.id = r.chapter_id
  JOIN stories s ON s.id = c.story_id
  LEFT JOIN users u ON u.id = r.requested_by
  WHERE r.reviewer_id = ? AND r.done_at IS NULL
    AND c.archived_at IS NULL AND s.archived_at IS NULL
  ORDER BY r.created_at ASC
`).all(userId);

// Everybody who could be asked: the rest of the group, minus the
// placeholder that deleted accounts are credited to and anybody locked out.
const listPeopleToAsk = (userId) => db.prepare(`
  SELECT id, display_name, username FROM users
  WHERE id <> ? AND username <> ? AND locked_at IS NULL
  ORDER BY display_name COLLATE NOCASE
`).all(userId, DELETED_USER_USERNAME);

module.exports = {
  getOpenReviewRequest,
  getReviewRequest,
  listPeopleToAsk,
  listReviewRequestsForChapter,
  markReviewDone,
  requestReview,
  reviewQueueFor,
  withdrawReviewRequest,
};
