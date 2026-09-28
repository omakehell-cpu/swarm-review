'use strict';

// Pins on the story's calendar inside a chapter: "from this paragraph on,
// it is Day 413, evening". The chapter's own date is where it starts; a
// pin says where it goes after that. See db-plan.js for the table and
// lib/moments.js for how a pin finds its paragraph again.

const { locateMark, paragraphsOf } = require('../lib/moments');
const { resolveDays } = require('./calendar');
const { cleanLabel, db, getLatestVersion } = require('./shared');

/**
 * A chapter's paragraphs, each with the pin on it if it has one, and the
 * pins whose paragraph can no longer be found.
 * @param {number} chapterId
 */
function chapterMoments(chapterId) {
  const latest = getLatestVersion(chapterId);
  const paragraphs = paragraphsOf(latest ? latest.content : '').map((p) => ({ ...p, mark: null }));
  const lost = [];
  for (const mark of db.prepare('SELECT * FROM story_time_marks WHERE chapter_id = ? ORDER BY id').all(chapterId)) {
    const p = locateMark(mark, paragraphs);
    if (p && !paragraphs[p.index].mark) paragraphs[p.index].mark = mark;
    else lost.push(mark);
  }
  return { paragraphs, lost };
}

/**
 * Saves the pins from the chapter's moments page: one row per paragraph,
 * in order, a pin where the row says when or what day it is, none where it
 * says nothing. A day can be counted from the row above ("+1", "-3"), the
 * first row counting from the chapter's own day. Pins whose paragraph has
 * gone are kept unless they are ticked to go.
 * @param {number} chapterId
 * @param {{ anchor: string, offset: number, when?: string, day?: any }[]} rows
 * @param {{ userId?: number, removeLost?: number[] }} [opts]
 * @returns {number} how many pins there are now
 */
function saveChapterMoments(chapterId, rows, { userId, removeLost = [] } = {}) {
  const chapter = db.prepare('SELECT id, story_id, story_day FROM chapters WHERE id = ?').get(chapterId);
  if (!chapter) return 0;
  const { paragraphs, lost } = chapterMoments(chapterId);
  const known = new Set(paragraphs.map((p) => p.anchor));
  const days = resolveDays([{ day: chapter.story_day }, ...rows]).slice(1);
  db.exec('BEGIN');
  try {
    // Every pin that is on a paragraph still there is rewritten from the
    // form, which has a row for every such paragraph.
    const lostIds = new Set(lost.map((m) => m.id));
    for (const m of db.prepare('SELECT id FROM story_time_marks WHERE chapter_id = ?').all(chapterId)) {
      if (!lostIds.has(m.id)) db.prepare('DELETE FROM story_time_marks WHERE id = ?').run(m.id);
    }
    for (const id of removeLost) {
      if (lostIds.has(Number(id))) db.prepare('DELETE FROM story_time_marks WHERE id = ?').run(Number(id));
    }
    const insert = db.prepare(`
      INSERT INTO story_time_marks (story_id, chapter_id, anchor_text, anchor_offset, story_when, story_day, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    rows.forEach((row, i) => {
      const when = cleanLabel(row.when);
      const day = days[i];
      if (!known.has(row.anchor) || (!when && day === null)) return;
      insert.run(chapter.story_id, chapterId, row.anchor, Number(row.offset) || 0, when, day, userId || null);
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return db.prepare('SELECT COUNT(*) AS n FROM story_time_marks WHERE chapter_id = ?').get(chapterId).n;
}

/**
 * Every pin in a story that can still be placed, in reading order: by
 * chapter, then by where in the chapter it is. For the timeline.
 * @param {number} storyId
 */
function storyMoments(storyId) {
  const out = [];
  const chapters = db.prepare(`
    SELECT DISTINCT c.id, c.chapter_number, c.title, c.author_id FROM chapters c
      JOIN story_time_marks m ON m.chapter_id = c.id
     WHERE c.story_id = ? AND c.archived_at IS NULL ORDER BY c.chapter_number
  `).all(storyId);
  for (const c of chapters) {
    const { paragraphs } = chapterMoments(c.id);
    const total = paragraphs.length;
    paragraphs.filter((p) => p.mark).forEach((p, k) => {
      out.push({ chapter: c, mark: p.mark, paragraph: p.index + 1, of: total, text: p.text, nth: k + 1 });
    });
  }
  return out;
}

module.exports = { chapterMoments, saveChapterMoments, storyMoments };
