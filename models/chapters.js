'use strict';

const { countWords } = require('../lib/markdown');
const { CHAPTER_STAGES } = require('../lib/story-state');
const { rebuildChapterAppearances } = require('./bible');
const { carryPendingNotes } = require('./comments');
const { cleanDay, cleanLabel, db, getLatestVersion } = require('./shared');
const { getStoryById } = require('./stories');
/**
 * @param {number} storyId
 * @param {{ since?: string|null, onlyArchived?: boolean }} [options]
 */
function listChaptersForStory(storyId, { since, onlyArchived = false } = {}) {
  return db.prepare(`
    SELECT c.*, u.display_name AS author_name,
      (SELECT MAX(version_number) FROM chapter_versions v WHERE v.chapter_id = c.id) AS latest_version,
      (SELECT COUNT(*) FROM chapter_versions v WHERE v.chapter_id = c.id) AS version_count,
      (SELECT v.word_count FROM chapter_versions v WHERE v.chapter_id = c.id
        ORDER BY v.version_number DESC LIMIT 1) AS word_count,
      (SELECT COUNT(*) FROM comments cm
         JOIN chapter_versions v2 ON v2.id = cm.version_id
         WHERE v2.chapter_id = c.id AND v2.version_number = (
           SELECT MAX(version_number) FROM chapter_versions v3 WHERE v3.chapter_id = c.id
         ) AND cm.status = 'pending' AND cm.parent_id IS NULL AND cm.deleted_at IS NULL) AS pending_comments,
      ${since ? `(c.created_at > @since)` : '0'} AS is_new,
      ${since ? `(
        SELECT EXISTS(
          SELECT 1 FROM comments cm2
          JOIN chapter_versions v4 ON v4.id = cm2.version_id
          WHERE v4.chapter_id = c.id AND cm2.deleted_at IS NULL AND cm2.created_at > @since
        )
      )` : '0'} AS has_new_comments
    FROM chapters c
    JOIN users u ON u.id = c.author_id
    WHERE c.story_id = @storyId AND c.archived_at IS ${onlyArchived ? 'NOT NULL' : 'NULL'}
    ORDER BY c.chapter_number ASC
  `).all(since ? { storyId, since } : { storyId });
}


// Where this chapter sits in its story's reading order, and what's either
// side of it -- for the prev/next links on the chapter page. Archived
// chapters are skipped, so the sequence a reader walks is the same one
// the story page lists. A chapter that is itself archived isn't in that
// sequence at all: it gets neighbours of null and no position, rather
// than pretending to be somewhere in the run.
function getChapterNeighbours(chapter) {
  const siblings = db.prepare(
    'SELECT id, chapter_number, title FROM chapters WHERE story_id = ? AND archived_at IS NULL ORDER BY chapter_number ASC'
  ).all(chapter.story_id);
  const index = siblings.findIndex((c) => c.id === chapter.id);
  return {
    total: siblings.length,
    position: index === -1 ? null : index + 1,
    prev: index > 0 ? siblings[index - 1] : null,
    next: index !== -1 && index < siblings.length - 1 ? siblings[index + 1] : null,
  };
}

const getChapterById = (id) =>
  db.prepare(`
    SELECT c.*, u.display_name AS author_name, u.username AS author_username,
           s.title AS story_title, s.author_id AS story_author_id,
           s.cover_filename AS story_cover_filename, s.cover_focus_x AS story_cover_focus_x, s.cover_focus_y AS story_cover_focus_y
    FROM chapters c
    JOIN users u ON u.id = c.author_id
    JOIN stories s ON s.id = c.story_id
    WHERE c.id = ?
  `).get(id);


// A stage that is not one of the three is the default one: form values
// are user input, and the column is NOT NULL.
const chapterStage = (stage) => (CHAPTER_STAGES.includes(stage) ? stage : 'notes');

// An arc name is a name, not an essay, and an empty one means "this
// chapter does not open an arc".
const arcName = (title) => String(title || '').trim().slice(0, 80);


// Keeping the bible in step with the prose must never be the reason a
// chapter fails to save: the cache can always be rebuilt, the chapter
// cannot be retyped.
function refreshChapterAppearances(chapterId) {
  try { rebuildChapterAppearances(chapterId); } catch (err) { /* rebuilt on the next edit, or from the bible page */ }
}


/** @param {{ storyId: number, title: string, summary?: string, authorId: number, content: string, changelog?: string, stage?: string, arcTitle?: string, pov?: string, strand?: string , storyWhen?: string, storyDay?: string|number|null }} fields */
function createChapter({ storyId, title, summary, authorId, content, changelog, stage, arcTitle, pov, strand, storyWhen, storyDay }) {
  const insertChapter = db.prepare(
    'INSERT INTO chapters (story_id, chapter_number, title, summary, author_id, stage, arc_title, pov, strand, story_when, story_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertVersion = db.prepare(
    'INSERT INTO chapter_versions (chapter_id, version_number, content, changelog, word_count) VALUES (?, 1, ?, ?, ?)'
  );
  const nextNumber = (db.prepare(
    'SELECT COALESCE(MAX(chapter_number), 0) AS n FROM chapters WHERE story_id = ?'
  ).get(storyId).n) + 1;

  db.exec('BEGIN');
  try {
    const info = insertChapter.run(storyId, nextNumber, title, summary || '', authorId, chapterStage(stage), arcName(arcTitle), cleanLabel(pov), cleanLabel(strand), cleanLabel(storyWhen), cleanDay(storyDay));
    const chapterId = Number(info.lastInsertRowid);
    insertVersion.run(chapterId, content, changelog || 'Initial version', countWords(content));
    db.exec('COMMIT');
    refreshChapterAppearances(chapterId);
    return getChapterById(chapterId);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}


// Inserts a brand-new chapter at a specific position instead of always
// appending at the end. `position` is the chapter_number the new chapter
// should take; every chapter at or after it -- archived ones included,
// since they still hold a slot under UNIQUE(story_id, chapter_number) --
// is shifted up by one, highest number first so no single UPDATE ever
// collides with another chapter's current number.
/** @param {{ storyId: number, position: number, title: string, summary?: string, authorId: number, content: string, changelog?: string, stage?: string, arcTitle?: string, pov?: string, strand?: string , storyWhen?: string, storyDay?: string|number|null }} fields */
function insertChapterAt({ storyId, position, title, summary, authorId, content, changelog, stage, arcTitle, pov, strand, storyWhen, storyDay }) {
  db.exec('BEGIN');
  try {
    const toShift = db.prepare(
      'SELECT id FROM chapters WHERE story_id = ? AND chapter_number >= ? ORDER BY chapter_number DESC'
    ).all(storyId, position);
    const bump = db.prepare('UPDATE chapters SET chapter_number = chapter_number + 1 WHERE id = ?');
    for (const row of toShift) bump.run(row.id);

    const info = db.prepare(
      'INSERT INTO chapters (story_id, chapter_number, title, summary, author_id, stage, arc_title, pov, strand, story_when, story_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(storyId, position, title, summary || '', authorId, chapterStage(stage), arcName(arcTitle), cleanLabel(pov), cleanLabel(strand), cleanLabel(storyWhen), cleanDay(storyDay));
    const chapterId = Number(info.lastInsertRowid);
    db.prepare(
      'INSERT INTO chapter_versions (chapter_id, version_number, content, changelog, word_count) VALUES (?, 1, ?, ?, ?)'
    ).run(chapterId, content, changelog || 'Initial version', countWords(content));
    db.exec('COMMIT');
    refreshChapterAppearances(chapterId);
    return getChapterById(chapterId);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function updateChapter({ chapterId, title, summary }) {
  db.prepare('UPDATE chapters SET title = ?, summary = ? WHERE id = ?')
    .run(title, summary || '', chapterId);
  return getChapterById(chapterId);
}


/**
 * @param {{ chapterId: number, title: string, summary?: string, content: string,
 *   changelog?: string, stage?: string, arcTitle?: string, pov?: string, strand?: string , storyWhen?: string, storyDay?: string|number|null }} fields
 */
// Edits a chapter "as a document": updates title/summary in place, and if
// the text itself changed, publishes it as a new version (rather than
// rewriting the current version's row) so any comments already anchored to
// the previous text keep pointing at the passage they were actually made
// about. If the text is unchanged, no new version is created.
function editChapter({ chapterId, title, summary, content, changelog, stage, arcTitle, pov, strand, storyWhen, storyDay }) {
  const latest = getLatestVersion(chapterId);
  db.exec('BEGIN');
  try {
    // stage and arcTitle are only written when the caller says something
    // about them. Every form that edits a chapter sends both, but a caller
    // that does not -- a script, a future import -- should not silently
    // knock a chapter out of its arc by not mentioning it.
    const sets = ['title = @title', 'summary = @summary'];
    const params = { title, summary: summary || '', chapterId };
    // node:sqlite refuses a parameter the statement does not mention, so
    // the object and the SET list are built together.
    if (stage !== undefined) { sets.push('stage = @stage'); params.stage = chapterStage(stage); }
    if (arcTitle !== undefined) { sets.push('arc_title = @arcTitle'); params.arcTitle = arcName(arcTitle); }
    if (pov !== undefined) { sets.push('pov = @pov'); params.pov = cleanLabel(pov); }
    if (strand !== undefined) { sets.push('strand = @strand'); params.strand = cleanLabel(strand); }
    if (storyWhen !== undefined) { sets.push('story_when = @storyWhen'); params.storyWhen = cleanLabel(storyWhen); }
    if (storyDay !== undefined) { sets.push('story_day = @storyDay'); params.storyDay = cleanDay(storyDay); }
    db.prepare(`UPDATE chapters SET ${sets.join(', ')} WHERE id = @chapterId`).run(params);

    let newVersion = null;
    if (!latest || latest.content !== content) {
      const nextNumber = (latest ? latest.version_number : 0) + 1;
      const info = db.prepare(
        'INSERT INTO chapter_versions (chapter_id, version_number, content, changelog, word_count) VALUES (?, ?, ?, ?, ?)'
      ).run(chapterId, nextNumber, content, changelog || '', countWords(content));
      newVersion = getVersion(Number(info.lastInsertRowid));
      // In the same transaction: a version that exists without its notes
      // having followed it is a state nobody should ever load.
      if (latest) carryPendingNotes(latest, newVersion);
    }

    db.exec('COMMIT');
    if (newVersion) refreshChapterAppearances(chapterId);
    return { chapter: getChapterById(chapterId), version: newVersion };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}


// Creates a brand-new story together with its first chapter, atomically.
function createStoryWithFirstChapter({ title, description, authorId, chapterTitle, chapterSummary, content }) {
  db.exec('BEGIN');
  try {
    const storyInfo = db.prepare(
      'INSERT INTO stories (title, description, author_id) VALUES (?, ?, ?)'
    ).run(title, description || '', authorId);
    const storyId = Number(storyInfo.lastInsertRowid);

    const chapterInfo = db.prepare(
      'INSERT INTO chapters (story_id, chapter_number, title, summary, author_id) VALUES (?, 1, ?, ?, ?)'
    ).run(storyId, chapterTitle, chapterSummary || '', authorId);
    const chapterId = Number(chapterInfo.lastInsertRowid);

    db.prepare(
      'INSERT INTO chapter_versions (chapter_id, version_number, content, changelog, word_count) VALUES (?, 1, ?, ?, ?)'
    ).run(chapterId, content, 'Initial version', countWords(content));

    db.exec('COMMIT');
    return { story: getStoryById(storyId), chapter: getChapterById(chapterId) };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function archiveChapter(chapterId) {
  db.prepare("UPDATE chapters SET archived_at = datetime('now') WHERE id = ?").run(chapterId);
}

function unarchiveChapter(chapterId) {
  db.prepare('UPDATE chapters SET archived_at = NULL WHERE id = ?').run(chapterId);
}


// Swaps a chapter with its nearest visible (non-archived) neighbor in the
// story's reading order -- a no-op if it's already first/last among visible
// chapters, or if the chapter itself is archived (nothing to reorder it
// against). Uses a temporary negative chapter_number -- guaranteed unique,
// since no real chapter_number is ever negative -- so the swap never trips
// the UNIQUE(story_id, chapter_number) constraint mid-transaction.

/**
 * Puts the chapters of a story in the given order, in one go -- what a
 * drag across a table means, as against the one-step swap of moveChapter.
 *
 * Only the numbers the non-archived chapters already hold are reused, so
 * an archived chapter keeps its slot and UNIQUE(story_id, chapter_number)
 * is never in danger. Everything is parked on a negative number first,
 * because the numbers being handed out are the numbers currently in use.
 * @param {number} storyId
 * @param {number[]} orderedIds
 */
function reorderChapters(storyId, orderedIds) {
  const siblings = db.prepare(
    'SELECT id, chapter_number FROM chapters WHERE story_id = ? AND archived_at IS NULL ORDER BY chapter_number ASC'
  ).all(storyId);
  if (!siblings.length) return [];
  const known = new Set(siblings.map((c) => c.id));
  const wanted = [];
  const seen = new Set();
  for (const raw of orderedIds || []) {
    const id = Number(raw);
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    wanted.push(id);
  }
  // A chapter the caller did not mention keeps its place at the end rather
  // than losing its number: a partial list should not be able to delete an
  // ordering.
  for (const c of siblings) if (!seen.has(c.id)) wanted.push(c.id);

  const slots = siblings.map((c) => c.chapter_number);
  const set = db.prepare('UPDATE chapters SET chapter_number = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const id of wanted) set.run(-id, id);
    wanted.forEach((id, i) => set.run(slots[i], id));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return wanted;
}


/** Who is in each chapter of a story, in one query rather than one each. */

/**
 * Every chapter of a story with its current text, in running order --
 * what compiling a manuscript needs, in one query rather than one per
 * chapter. Archived chapters are left out: they are not in the book.
 */
const chaptersForCompile = (storyId) => db.prepare(`
  SELECT c.id, c.chapter_number, c.title, c.summary, c.arc_title, v.content
    FROM chapters c
    JOIN chapter_versions v ON v.chapter_id = c.id
   WHERE c.story_id = ? AND c.archived_at IS NULL
     AND v.version_number = (SELECT MAX(v2.version_number) FROM chapter_versions v2 WHERE v2.chapter_id = c.id)
   ORDER BY c.chapter_number
`).all(storyId);

function castByChapter(storyId) {
  const rows = db.prepare(`
    SELECT sc.chapter_id, e.name, e.kind, sc.mentions
      FROM story_entity_chapters sc
      JOIN story_entities e ON e.id = sc.entity_id
     WHERE sc.story_id = ?
     ORDER BY sc.mentions DESC, e.name COLLATE NOCASE
  `).all(storyId);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.chapter_id)) map.set(row.chapter_id, []);
    map.get(row.chapter_id).push(row.name);
  }
  return map;
}

function moveChapter(chapterId, direction) {
  const chapter = getChapterById(chapterId);
  if (!chapter) return null;

  const siblings = db.prepare(
    'SELECT id, chapter_number FROM chapters WHERE story_id = ? AND archived_at IS NULL ORDER BY chapter_number ASC'
  ).all(chapter.story_id);
  const index = siblings.findIndex((c) => c.id === chapterId);
  if (index === -1) return chapter; // archived chapter -- nothing to reorder

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= siblings.length) return chapter; // already first/last

  const other = siblings[targetIndex];
  const thisNumber = siblings[index].chapter_number;

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE chapters SET chapter_number = ? WHERE id = ?').run(-chapterId, chapterId);
    db.prepare('UPDATE chapters SET chapter_number = ? WHERE id = ?').run(thisNumber, other.id);
    db.prepare('UPDATE chapters SET chapter_number = ? WHERE id = ?').run(other.chapter_number, chapterId);
    db.exec('COMMIT');
    return getChapterById(chapterId);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}


// Permanent, irreversible. Cascades to the chapter's versions and comments.
// Callers should only allow this on a chapter that's already archived (see
// server.js) as a safety gate against one-click data loss.
function deleteChapterForever(chapterId) {
  db.prepare('DELETE FROM chapters WHERE id = ?').run(chapterId);
}

// ---------- versions ----------

const listVersions = (chapterId) =>
  db.prepare(
    'SELECT * FROM chapter_versions WHERE chapter_id = ? ORDER BY version_number DESC'
  ).all(chapterId);

const getVersion = (id) =>
  db.prepare('SELECT * FROM chapter_versions WHERE id = ?').get(id);

const getVersionByNumber = (chapterId, versionNumber) =>
  db.prepare(
    'SELECT * FROM chapter_versions WHERE chapter_id = ? AND version_number = ?'
  ).get(chapterId, versionNumber);

function addVersion({ chapterId, content, changelog }) {
  const previous = getLatestVersion(chapterId);
  const nextNumber = (previous ? previous.version_number : 0) + 1;
  db.exec('BEGIN');
  let version;
  try {
    const info = db.prepare(
      'INSERT INTO chapter_versions (chapter_id, version_number, content, changelog, word_count) VALUES (?, ?, ?, ?, ?)'
    ).run(chapterId, nextNumber, content, changelog || '', countWords(content));
    version = getVersion(Number(info.lastInsertRowid));
    if (previous) carryPendingNotes(previous, version);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  refreshChapterAppearances(chapterId);
  return version;
}

// ---------- comments ----------

module.exports = {
  addVersion,
  arcName,
  archiveChapter,
  castByChapter,
  chapterStage,
  chaptersForCompile,
  createChapter,
  createStoryWithFirstChapter,
  deleteChapterForever,
  editChapter,
  getChapterById,
  getChapterNeighbours,
  getVersion,
  getVersionByNumber,
  insertChapterAt,
  listChaptersForStory,
  listVersions,
  moveChapter,
  refreshChapterAppearances,
  reorderChapters,
  unarchiveChapter,
  updateChapter,
};
