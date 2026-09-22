'use strict';

const { db } = require('./shared');
const { flatOf, relocate } = require('../lib/suggestions');

// The kinds a note can be, in the order the picker offers them. '' is a
// plain note, which is what most of them are.
const COMMENT_KINDS = ['', 'typo', 'pacing', 'continuity', 'question', 'praise'];
const commentKind = (kind) => (COMMENT_KINDS.includes(kind) ? kind : '');

function listCommentsForVersion(versionId) {
  return db.prepare(`
    SELECT cm.*, u.display_name AS author_name, r.display_name AS resolved_by_name,
           e.name AS entity_name
    FROM comments cm
    JOIN users u ON u.id = cm.author_id
    LEFT JOIN users r ON r.id = cm.resolved_by
    LEFT JOIN story_entities e ON e.id = cm.entity_id
    WHERE cm.version_id = ?
    ORDER BY cm.start_offset IS NULL, cm.start_offset ASC, cm.created_at ASC
  `).all(versionId);
}


// A comment is either anchored to a stretch of the text (the offsets and
// the quote) or a reply to another comment (parentId) -- never both, and
// the fields the other kind doesn't use are simply absent.
//
// Praise is the one kind that asks nothing of the author, so it is born
// settled: it would otherwise sit in their "waiting on you" list as a
// thing to accept, which is a strange thing to have to do to a compliment.
/** @param {{ versionId: number, authorId: number, body: string, startOffset?: number, endOffset?: number, quotedText?: string, parentId?: number|null, kind?: string, suggestion?: string|null, entityId?: number|null }} fields */
function createComment({ versionId, authorId, startOffset, endOffset, quotedText, body, parentId, kind, suggestion, entityId }) {
  const k = parentId ? '' : commentKind(kind);
  const info = db.prepare(`
    INSERT INTO comments (version_id, author_id, parent_id, start_offset, end_offset, quoted_text, body,
                          kind, suggestion, entity_id, status, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId, authorId, parentId || null, startOffset ?? null, endOffset ?? null, quotedText || null, body,
    k, suggestion ?? null, entityId || null,
    k === 'praise' ? 'accepted' : 'pending',
    k === 'praise' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null
  );
  return getCommentById(Number(info.lastInsertRowid));
}

const getCommentById = (id) =>
  db.prepare(`
    SELECT cm.*, u.display_name AS author_name, e.name AS entity_name
    FROM comments cm JOIN users u ON u.id = cm.author_id
    LEFT JOIN story_entities e ON e.id = cm.entity_id
    WHERE cm.id = ?
  `).get(id);

// Accepted, and put into the text: the version it went into is kept so
// the card can say where to see it.
function markSuggestionApplied({ commentId, resolvedBy, versionNumber }) {
  db.prepare(`
    UPDATE comments SET status = 'accepted', resolved_at = datetime('now'), resolved_by = ?, applied_in = ?
    WHERE id = ?
  `).run(resolvedBy, versionNumber, commentId);
  return getCommentById(commentId);
}

// ---------- notes that follow the chapter ----------

// Called with every new version of a chapter, inside the transaction that
// makes it. A pending note used to stay on the version it was written
// against and the new one started empty -- which meant that fixing one
// comma cost the author every other note still waiting, and a reviewer's
// work went quiet the moment the author touched the text.
//
// Now a pending note moves with the text if the words it was about are
// still there, re-anchored to where they are now, replies and all. A note
// whose words are gone stays where it was and says so: it is either done
// with (the author rewrote the passage) or it needs a look, and in both
// cases pinning it to some other sentence would be worse than leaving it.
// Settled notes never move: they are the record of what was discussed.
function carryPendingNotes(oldVersion, newVersion) {
  if (!oldVersion || !newVersion || oldVersion.id === newVersion.id) return { moved: 0, left: 0 };
  const notes = db.prepare(`
    SELECT id, start_offset, end_offset FROM comments
    WHERE version_id = ? AND parent_id IS NULL AND status = 'pending' AND deleted_at IS NULL
  `).all(oldVersion.id);
  if (!notes.length) return { moved: 0, left: 0 };

  const oldFlat = flatOf(oldVersion.content);
  const newFlat = flatOf(newVersion.content);
  const move = db.prepare(`
    UPDATE comments SET version_id = @to, start_offset = @start, end_offset = @end,
      left_on = COALESCE(left_on, @from), passage_changed_in = NULL
    WHERE id = @id
  `);
  const leave = db.prepare('UPDATE comments SET passage_changed_in = ? WHERE id = ?');
  // Replies live on the same version as the note they answer; they go
  // wherever it goes, however deep the thread.
  const moveThread = db.prepare(`
    WITH RECURSIVE thread(id) AS (
      SELECT id FROM comments WHERE parent_id = @id
      UNION ALL SELECT c.id FROM comments c JOIN thread t ON c.parent_id = t.id
    )
    UPDATE comments SET version_id = @to WHERE id IN (SELECT id FROM thread)
  `);

  let moved = 0;
  let left = 0;
  for (const note of notes) {
    const general = note.start_offset == null || note.end_offset == null;
    const place = general ? null : relocate(oldFlat, newFlat, note.start_offset, note.end_offset);
    if (general || place) {
      move.run({
        id: note.id, to: newVersion.id, from: oldVersion.version_number,
        start: place ? place.start : null, end: place ? place.end : null,
      });
      moveThread.run({ id: note.id, to: newVersion.id });
      moved++;
    } else {
      leave.run(newVersion.version_number, note.id);
      left++;
    }
  }
  return { moved, left };
}

// Pending notes that did not follow the chapter to its current version
// because their passage changed. Shown on the current version as a
// pointer, so they are not simply lost behind the version dropdown.
function notesLeftBehind(chapterId) {
  return db.prepare(`
    SELECT cm.id, cm.body, cm.quoted_text, cm.passage_changed_in, v.version_number,
           u.display_name AS author_name
    FROM comments cm
    JOIN chapter_versions v ON v.id = cm.version_id
    JOIN users u ON u.id = cm.author_id
    WHERE v.chapter_id = ? AND cm.parent_id IS NULL AND cm.deleted_at IS NULL
      AND cm.status = 'pending' AND cm.passage_changed_in IS NOT NULL
      AND v.version_number < (SELECT MAX(v2.version_number) FROM chapter_versions v2 WHERE v2.chapter_id = v.chapter_id)
    ORDER BY v.version_number DESC, cm.start_offset
  `).all(chapterId);
}

function setCommentStatus({ commentId, status, resolvedBy }) {
  db.prepare(`
    UPDATE comments SET status = ?, resolved_at = datetime('now'), resolved_by = ?
    WHERE id = ?
  `).run(status, resolvedBy, commentId);
  return getCommentById(commentId);
}

function editComment({ commentId, body }) {
  db.prepare("UPDATE comments SET body = ?, edited_at = datetime('now') WHERE id = ?").run(body, commentId);
  return getCommentById(commentId);
}


// Soft delete: the row (and its replies, for thread continuity) stays, but
// the view layer renders it as "[comment retracted]" instead of the body.
function retractComment(commentId) {
  db.prepare("UPDATE comments SET deleted_at = datetime('now') WHERE id = ?").run(commentId);
}


// Chapter author changed their mind after accepting/rejecting -- back to
// pending, as if it hadn't been resolved yet.
function reopenComment(commentId) {
  db.prepare("UPDATE comments SET status = 'pending', resolved_at = NULL, resolved_by = NULL, applied_in = NULL WHERE id = ?").run(commentId);
  return getCommentById(commentId);
}

// ---------- backup ----------

module.exports = {
  COMMENT_KINDS,
  carryPendingNotes,
  commentKind,
  markSuggestionApplied,
  notesLeftBehind,
  createComment,
  editComment,
  getCommentById,
  listCommentsForVersion,
  reopenComment,
  retractComment,
  setCommentStatus,
};
