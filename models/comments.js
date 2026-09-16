'use strict';

const { db } = require('./shared');
function listCommentsForVersion(versionId) {
  return db.prepare(`
    SELECT cm.*, u.display_name AS author_name, r.display_name AS resolved_by_name
    FROM comments cm
    JOIN users u ON u.id = cm.author_id
    LEFT JOIN users r ON r.id = cm.resolved_by
    WHERE cm.version_id = ?
    ORDER BY cm.start_offset IS NULL, cm.start_offset ASC, cm.created_at ASC
  `).all(versionId);
}


// A comment is either anchored to a stretch of the text (the offsets and
// the quote) or a reply to another comment (parentId) -- never both, and
// the fields the other kind doesn't use are simply absent.
/** @param {{ versionId: number, authorId: number, body: string, startOffset?: number, endOffset?: number, quotedText?: string, parentId?: number|null }} fields */
function createComment({ versionId, authorId, startOffset, endOffset, quotedText, body, parentId }) {
  const info = db.prepare(`
    INSERT INTO comments (version_id, author_id, parent_id, start_offset, end_offset, quoted_text, body)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(versionId, authorId, parentId || null, startOffset ?? null, endOffset ?? null, quotedText || null, body);
  return getCommentById(Number(info.lastInsertRowid));
}

const getCommentById = (id) =>
  db.prepare(`
    SELECT cm.*, u.display_name AS author_name
    FROM comments cm JOIN users u ON u.id = cm.author_id
    WHERE cm.id = ?
  `).get(id);

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
  db.prepare("UPDATE comments SET status = 'pending', resolved_at = NULL, resolved_by = NULL WHERE id = ?").run(commentId);
  return getCommentById(commentId);
}

// ---------- backup ----------

module.exports = {
  createComment,
  editComment,
  getCommentById,
  listCommentsForVersion,
  reopenComment,
  retractComment,
  setCommentStatus,
};
