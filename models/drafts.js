'use strict';

const { db } = require('./shared');

// ---------- drafts: writing that is not a version yet ----------
//
// Every save of the chapter editor used to publish a version. That is the
// right thing for "I have finished this pass" and the wrong thing for "I
// have to catch a train": it put half-sentences in the history, showed
// readers a chapter mid-rewrite, and -- before notes followed the text --
// cost the author their notes. A draft is the other kind of save. It is
// the author's alone, nobody else sees it, and it becomes a version only
// when they publish it.

/** @param {{ chapterId: number, userId: number, title?: string, summary?: string, content: string, baseVersion?: number }} fields */
function saveDraft({ chapterId, userId, title = '', summary = '', content, baseVersion = 0 }) {
  db.prepare(`
    INSERT INTO chapter_drafts (chapter_id, user_id, title, summary, content, base_version, updated_at)
    VALUES (@chapterId, @userId, @title, @summary, @content, @baseVersion, datetime('now'))
    ON CONFLICT (chapter_id, user_id) DO UPDATE SET
      title = excluded.title, summary = excluded.summary, content = excluded.content,
      base_version = excluded.base_version, updated_at = excluded.updated_at
  `).run({
    chapterId, userId,
    title: String(title || '').slice(0, 300),
    summary: String(summary || '').slice(0, 4000),
    content: String(content || ''),
    baseVersion: Number(baseVersion) || 0,
  });
  return getDraft(chapterId, userId);
}

const getDraft = (chapterId, userId) =>
  db.prepare('SELECT * FROM chapter_drafts WHERE chapter_id = ? AND user_id = ?').get(chapterId, userId) || null;

function discardDraft(chapterId, userId) {
  db.prepare('DELETE FROM chapter_drafts WHERE chapter_id = ? AND user_id = ?').run(chapterId, userId);
}

// For the author's own story page: which of their chapters have writing
// waiting to be published.
const draftChapterIds = (userId) => new Set(
  db.prepare('SELECT chapter_id FROM chapter_drafts WHERE user_id = ?').all(userId).map((r) => r.chapter_id)
);

module.exports = { discardDraft, draftChapterIds, getDraft, saveDraft };
