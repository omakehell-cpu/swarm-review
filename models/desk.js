'use strict';

const { countWords } = require('../lib/markdown');
const { db } = require('./shared');

// ---------- the writing desk: scene notes and snapshots ----------
//
// Both belong to the chapter's author and to nobody else; the routes check
// that, these do not.

const listSceneNotes = (chapterId) =>
  db.prepare('SELECT position, body, updated_at FROM scene_notes WHERE chapter_id = ? ORDER BY position').all(chapterId);

// An empty note is no note: it is deleted rather than kept as a blank row.
function saveSceneNote(chapterId, position, body) {
  const text = String(body || '').slice(0, 4000);
  const pos = Math.max(1, Math.min(999, Math.round(Number(position)) || 1));
  if (!text.trim()) {
    db.prepare('DELETE FROM scene_notes WHERE chapter_id = ? AND position = ?').run(chapterId, pos);
    return null;
  }
  db.prepare(`
    INSERT INTO scene_notes (chapter_id, position, body, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT (chapter_id, position) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at
  `).run(chapterId, pos, text);
  return { position: pos, body: text };
}

const MAX_SNAPSHOTS = 60;

const listSnapshots = (chapterId) => db.prepare(`
  SELECT id, name, word_count, created_at FROM chapter_snapshots WHERE chapter_id = ? ORDER BY id DESC
`).all(chapterId);

const getSnapshot = (id) => db.prepare('SELECT * FROM chapter_snapshots WHERE id = ?').get(id) || null;

// Kept to a generous number per chapter; past it, the oldest go first.
function createSnapshot({ chapterId, userId, name, content }) {
  const text = String(content || '');
  const label = String(name || '').trim().slice(0, 120) || 'Snapshot';
  const info = db.prepare(`
    INSERT INTO chapter_snapshots (chapter_id, user_id, name, content, word_count) VALUES (?, ?, ?, ?, ?)
  `).run(chapterId, userId, label, text, countWords(text));
  db.prepare(`
    DELETE FROM chapter_snapshots WHERE chapter_id = ? AND id NOT IN (
      SELECT id FROM chapter_snapshots WHERE chapter_id = ? ORDER BY id DESC LIMIT ?
    )
  `).run(chapterId, chapterId, MAX_SNAPSHOTS);
  return getSnapshot(Number(info.lastInsertRowid));
}

function deleteSnapshot(id) {
  db.prepare('DELETE FROM chapter_snapshots WHERE id = ?').run(id);
}

module.exports = { createSnapshot, deleteSnapshot, getSnapshot, listSceneNotes, listSnapshots, saveSceneNote };
