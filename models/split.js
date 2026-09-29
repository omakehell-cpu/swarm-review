'use strict';

// Moving a chapter boundary: one chapter becomes two, or two become one.
//
// Both used to be done by hand -- copy the second half into a new
// chapter, delete it from the first -- which works for the text and loses
// everything else: the notes on the second half stayed on a version of
// the first chapter whose words no longer contain them, and whoever had
// read the chapter found a "new" one waiting that they had read already.
//
// Nothing here rewrites history. Splitting publishes a new version of the
// first chapter and a first version of the second; merging publishes a new
// version of the first and archives the second, so the old shapes are all
// still there in the version history and the archive.

const { countWords } = require('../lib/markdown');
const { flatOf, relocate } = require('../lib/suggestions');
const { rebuildChapterAppearances } = require('./bible');
const { carryPendingNotes } = require('./comments');
const { db, getLatestVersion } = require('./shared');

const SCENE_BREAK = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

// Where a chapter can be cut: at the start of any line after the first,
// which is every paragraph, and every line of a chapter written with
// single line breaks. A cut mid-sentence is not offered -- a chapter
// boundary between two halves of a sentence is not one anybody wants, and
// cutting only at a line keeps the notes' arithmetic exact (see below).
/**
 * @param {string} content
 * @returns {{ at: number, text: string, isBreak: boolean }[]}
 */
function splitPoints(content) {
  const points = [];
  const text = String(content || '');
  let seenText = false;
  let lineStart = 0;
  while (lineStart <= text.length) {
    const nl = text.indexOf('\n', lineStart);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(lineStart, lineEnd);
    if (line.trim()) {
      if (seenText) points.push({ at: lineStart, text: line.trim(), isBreak: SCENE_BREAK.test(line) });
      seenText = true;
    }
    if (nl === -1) break;
    lineStart = nl + 1;
  }
  // A cut before the last scene break with nothing after it, or after
  // everything, leaves an empty chapter: not offered.
  return points.filter((p) => cutText(text, p.at).tail.trim());
}

// The two halves of a cut. A scene break at the cut is the boundary
// itself now -- a chapter does not open on a row of dashes.
function cutText(content, at) {
  const head = content.slice(0, at).replace(/\s+$/, '');
  let tail = content.slice(at).replace(/^\s+/, '');
  const first = tail.split('\n', 1)[0];
  if (SCENE_BREAK.test(first)) tail = tail.slice(first.length).replace(/^\s+/, '');
  return { head, tail };
}

const moveNote = () => db.prepare(`
  UPDATE comments SET version_id = @to, start_offset = @start, end_offset = @end,
    left_on = NULL, passage_changed_in = NULL
  WHERE id = @id
`);
const moveThread = () => db.prepare(`
  WITH RECURSIVE thread(id) AS (
    SELECT id FROM comments WHERE parent_id = @id
    UNION ALL SELECT c.id FROM comments c JOIN thread t ON c.parent_id = t.id
  )
  UPDATE comments SET version_id = @to WHERE id IN (SELECT id FROM thread)
`);
const pendingNotesOn = (versionId) => db.prepare(`
  SELECT id, start_offset, end_offset FROM comments
  WHERE version_id = ? AND parent_id IS NULL AND status = 'pending' AND deleted_at IS NULL
`).all(versionId);

// Keeping the notes on the words they were about. A note's offsets count
// the chapter's text with the markdown taken out, and that text is every
// block's words run together with nothing between them -- so when a cut
// falls between lines, the second half's text is exactly the end of the
// whole, and a note in it moves by a subtraction rather than a search.
// Where that does not hold (a cut inside a list, say) it falls back to
// finding the words, the way a note follows an edit.
function placeIn(wholeFlat, partFlat, partStart, note) {
  if (note.start_offset == null || note.end_offset == null) return null;
  if (partStart !== null) {
    if (note.start_offset < partStart) return null;
    return { start: note.start_offset - partStart, end: note.end_offset - partStart };
  }
  return relocate(wholeFlat, partFlat, note.start_offset, note.end_offset);
}

// The same after-commit upkeep a new chapter gets: who is in it is a cache,
// and failing to rebuild it must never undo the split.
function refresh(chapterId) {
  try { rebuildChapterAppearances(chapterId); } catch (err) { /* rebuilt on the next edit */ }
}

/**
 * Cuts a chapter in two at `at` (an offset from splitPoints), making the
 * second half a new chapter straight after it, by the same author, with
 * the same point of view, strand, stage and date.
 * @param {{ chapterId: number, at: number, title: string }} args
 * @returns {{ error?: string, first?: any, second?: any, moved?: number }}
 */
function splitChapter({ chapterId, at, title }) {
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId);
  if (!chapter || chapter.archived_at) return { error: 'There is no such chapter.' };
  const latest = getLatestVersion(chapterId);
  if (!latest) return { error: 'There is no such chapter.' };
  const newTitle = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!newTitle) return { error: 'The new chapter needs a title.' };
  const point = splitPoints(latest.content).find((p) => p.at === Number(at));
  if (!point) return { error: 'Pick where the new chapter starts.' };
  const { head, tail } = cutText(latest.content, point.at);
  if (!head.trim() || !tail.trim()) return { error: 'Both chapters need some text.' };

  const wholeFlat = flatOf(latest.content);
  const tailFlat = flatOf(tail);
  const tailStart = wholeFlat.endsWith(tailFlat) ? wholeFlat.length - tailFlat.length : null;
  const position = chapter.chapter_number + 1;
  let secondId;
  let moved = 0;

  db.exec('BEGIN');
  try {
    const insertVersion = db.prepare(
      'INSERT INTO chapter_versions (chapter_id, version_number, content, changelog, word_count) VALUES (?, ?, ?, ?, ?)'
    );
    const firstInfo = insertVersion.run(chapterId, latest.version_number + 1, head,
      `Split: from "${point.text.slice(0, 60)}" on is now chapter ${position}, ${newTitle}.`, countWords(head));
    const firstVersion = db.prepare('SELECT * FROM chapter_versions WHERE id = ?').get(Number(firstInfo.lastInsertRowid));

    // Make room, highest number first so no UPDATE collides with a
    // chapter still holding the number it is moving to.
    const bump = db.prepare('UPDATE chapters SET chapter_number = chapter_number + 1 WHERE id = ?');
    for (const row of db.prepare('SELECT id FROM chapters WHERE story_id = ? AND chapter_number >= ? ORDER BY chapter_number DESC').all(chapter.story_id, position)) {
      bump.run(row.id);
    }
    const info = db.prepare(`
      INSERT INTO chapters (story_id, chapter_number, title, summary, author_id, stage, arc_title, pov, strand, story_when, story_day)
      VALUES (?, ?, ?, '', ?, ?, '', ?, ?, ?, ?)
    `).run(chapter.story_id, position, newTitle, chapter.author_id, chapter.stage, chapter.pov, chapter.strand, chapter.story_when, chapter.story_day);
    secondId = Number(info.lastInsertRowid);
    const secondInfo = insertVersion.run(secondId, 1, tail, `Split from chapter ${chapter.chapter_number}, ${chapter.title}.`, countWords(tail));
    const secondVersionId = Number(secondInfo.lastInsertRowid);

    // The notes on the second half go with it; everything else follows
    // the first chapter's text as it would after any edit.
    const move = moveNote();
    const thread = moveThread();
    for (const note of pendingNotesOn(latest.id)) {
      const place = placeIn(wholeFlat, tailFlat, tailStart, note);
      if (!place) continue;
      move.run({ id: note.id, to: secondVersionId, start: place.start, end: place.end });
      thread.run({ id: note.id, to: secondVersionId });
      moved++;
    }
    carryPendingNotes(latest, firstVersion);

    // An arc that ended on this chapter ended at the end of its text, which
    // is the end of the new chapter now.
    db.prepare('UPDATE story_arcs SET end_ref = ? WHERE story_id = ? AND end_ref = ?').run(`c${secondId}`, chapter.story_id, `c${chapterId}`);
    // Chapters planned after this one come after the whole of it: after
    // the second half now.
    db.prepare('UPDATE story_plan_slots SET after_chapter_id = ? WHERE after_chapter_id = ?').run(secondId, chapterId);

    // Whoever had read the chapter has read both halves of it.
    db.prepare(`
      INSERT OR IGNORE INTO chapter_reads (chapter_id, user_id, version_number, read_at)
      SELECT ?, user_id, 1, read_at FROM chapter_reads WHERE chapter_id = ?
    `).run(secondId, chapterId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  refresh(chapterId);
  refresh(secondId);
  return {
    first: db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId),
    second: db.prepare('SELECT * FROM chapters WHERE id = ?').get(secondId),
    moved,
  };
}

/** How many notes on this version are still waiting, for the split page to say. */
const countPendingOnVersion = (versionId) => pendingNotesOn(versionId).length;

/** The chapter a merge would fold into this one: the next one still in the story. */
const nextChapterOf = (chapter) => db.prepare(`
  SELECT * FROM chapters WHERE story_id = ? AND chapter_number > ? AND archived_at IS NULL
  ORDER BY chapter_number LIMIT 1
`).get(chapter.story_id, chapter.chapter_number) || null;

/**
 * Folds the next chapter into this one: its text goes on the end, as a new
 * version, its waiting notes come with it, and the chapter itself is
 * archived -- out of the story, not deleted, with its history intact.
 * @param {{ chapterId: number }} args
 * @returns {{ error?: string, chapter?: any, merged?: any, moved?: number }}
 */
function mergeWithNext({ chapterId }) {
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId);
  if (!chapter || chapter.archived_at) return { error: 'There is no such chapter.' };
  const next = nextChapterOf(chapter);
  if (!next) return { error: 'This is the last chapter: there is nothing after it to merge.' };
  const latest = getLatestVersion(chapterId);
  const theirs = getLatestVersion(next.id);
  const combined = `${latest.content.replace(/\s+$/, '')}\n\n${theirs.content.replace(/^\s+/, '')}`;
  const combinedFlat = flatOf(combined);
  const nextFlat = flatOf(theirs.content);
  const shift = combinedFlat.endsWith(nextFlat) ? combinedFlat.length - nextFlat.length : null;
  let moved = 0;

  db.exec('BEGIN');
  try {
    const info = db.prepare(
      'INSERT INTO chapter_versions (chapter_id, version_number, content, changelog, word_count) VALUES (?, ?, ?, ?, ?)'
    ).run(chapterId, latest.version_number + 1, combined,
      `Merged: chapter ${next.chapter_number}, ${next.title}, is now the end of this one.`, countWords(combined));
    const version = db.prepare('SELECT * FROM chapter_versions WHERE id = ?').get(Number(info.lastInsertRowid));
    carryPendingNotes(latest, version);

    const move = moveNote();
    const thread = moveThread();
    for (const note of pendingNotesOn(theirs.id)) {
      const general = note.start_offset == null || note.end_offset == null;
      let place = null;
      if (!general) {
        place = shift !== null
          ? { start: note.start_offset + shift, end: note.end_offset + shift }
          : relocate(nextFlat, combinedFlat, note.start_offset, note.end_offset);
        if (!place) continue;
      }
      move.run({ id: note.id, to: version.id, start: place ? place.start : null, end: place ? place.end : null });
      thread.run({ id: note.id, to: version.id });
      moved++;
    }
    // An arc that opened on the merged chapter opens on the one after it
    // instead, if that one does not open an arc of its own -- otherwise the
    // chapters after the merge would quietly join the arc before it.
    if (next.arc_title) {
      const after = db.prepare(`
        SELECT id, arc_title FROM chapters WHERE story_id = ? AND chapter_number > ? AND archived_at IS NULL
        ORDER BY chapter_number LIMIT 1
      `).get(chapter.story_id, next.chapter_number);
      if (after && !after.arc_title) {
        db.prepare('UPDATE chapters SET arc_title = ? WHERE id = ?').run(next.arc_title, after.id);
        db.prepare('UPDATE story_arcs SET start_ref = ? WHERE story_id = ? AND start_ref = ? AND parent_id IS NULL').run(`c${after.id}`, chapter.story_id, `c${next.id}`);
      }
    }
    // Smaller arcs that started or ended on it start or end on the text
    // it is part of now.
    db.prepare('UPDATE story_arcs SET start_ref = ? WHERE story_id = ? AND start_ref = ? AND parent_id IS NOT NULL').run(`c${chapterId}`, chapter.story_id, `c${next.id}`);
    db.prepare('UPDATE story_arcs SET end_ref = ? WHERE story_id = ? AND end_ref = ?').run(`c${chapterId}`, chapter.story_id, `c${next.id}`);
    // Chapters planned after the one folded in come after this one now.
    db.prepare('UPDATE story_plan_slots SET after_chapter_id = ? WHERE after_chapter_id = ?').run(chapterId, next.id);
    // Archived, and moved out of the running order: its number goes past
    // the end and everything after it moves up one, so the story reads
    // 1, 2, 3 rather than 1, 3 with a hole where the merge was.
    const end = db.prepare('SELECT MAX(chapter_number) AS n FROM chapters WHERE story_id = ?').get(chapter.story_id).n + 1;
    db.prepare("UPDATE chapters SET archived_at = datetime('now'), chapter_number = ? WHERE id = ?").run(end, next.id);
    const close = db.prepare('UPDATE chapters SET chapter_number = chapter_number - 1 WHERE id = ?');
    for (const row of db.prepare('SELECT id FROM chapters WHERE story_id = ? AND chapter_number > ? AND chapter_number < ? ORDER BY chapter_number ASC').all(chapter.story_id, next.chapter_number, end)) {
      close.run(row.id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  refresh(chapterId);
  return {
    chapter: db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId),
    merged: db.prepare('SELECT * FROM chapters WHERE id = ?').get(next.id),
    moved,
  };
}

/**
 * A chapter just published with chapter breaks in it (lib/chapter-breaks.js):
 * cut at each, last first, so every earlier cut is still where it was and
 * each new chapter lands straight after the one before it.
 * @param {number} chapterId
 * @param {{ at: number, title: string }[]} cuts offsets in the published text
 * @param {string} fallbackTitle for a break with no title
 * @returns {{ error?: string, chapters: any[] }}
 */
function divideChapter(chapterId, cuts, fallbackTitle) {
  const made = [];
  for (let i = cuts.length - 1; i >= 0; i -= 1) {
    const title = cuts[i].title || `${fallbackTitle} (part ${i + 2})`;
    const result = splitChapter({ chapterId, at: cuts[i].at, title });
    if (result.error) return { error: result.error, chapters: made };
    made.unshift(result.second);
  }
  return { chapters: made };
}

module.exports = {
  countPendingOnVersion,
  divideChapter,
  mergeWithNext,
  nextChapterOf,
  splitChapter,
  splitPoints,
};
