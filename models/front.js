'use strict';

// The top of the front page: what this reader was in the middle of, and
// which stories they have begun at all (so "something to read" can leave
// those out).

const { db } = require('./shared');

/** Every story this reader has read a chapter of. */
function storiesReadBy(userId) {
  return new Set(db.prepare(`
    SELECT DISTINCT c.story_id AS id FROM chapter_reads r JOIN chapters c ON c.id = r.chapter_id WHERE r.user_id = ?
  `).all(userId).map((r) => Number(r.id)));
}

/**
 * The stories somebody has read lately, newest first, each with where to
 * pick it up: the chapter they stopped half-way through, or else the
 * first one they have not read -- or, when they have read it all, that
 * they have. Only other people's: what you wrote yourself is not
 * something you "read lately".
 * @returns {Array<{ story_id: number, story_title: string, author_name: string, cover_filename: string|null,
 *   finished: boolean, chapter_id: number, chapter_number: number, chapter_title: string, chapters: number, read: number, percent: number|null }>}
 */
function recentlyRead(userId, limit = 5) {
  const recent = db.prepare(`
    SELECT s.id AS story_id, s.title AS story_title, s.cover_filename, s.cover_focus_x, s.cover_focus_y,
           u.display_name AS author_name, MAX(r.read_at) AS last_at
    FROM chapter_reads r
    JOIN chapters c ON c.id = r.chapter_id
    JOIN stories s ON s.id = c.story_id
    JOIN users u ON u.id = s.author_id
    WHERE r.user_id = ? AND s.author_id <> ? AND s.archived_at IS NULL
    GROUP BY s.id ORDER BY last_at DESC LIMIT 12
  `).all(userId, userId);
  const chaptersOf = db.prepare(`
    SELECT c.id, c.chapter_number, c.title,
      EXISTS (SELECT 1 FROM chapter_reads r WHERE r.chapter_id = c.id AND r.user_id = ?) AS is_read,
      (SELECT p.paragraph * 100 / p.total FROM reading_places p WHERE p.chapter_id = c.id AND p.user_id = ?) AS percent,
      (SELECT p.at FROM reading_places p WHERE p.chapter_id = c.id AND p.user_id = ?) AS place_at
    FROM chapters c WHERE c.story_id = ? AND c.archived_at IS NULL ORDER BY c.chapter_number
  `);
  const out = [];
  for (const s of recent) {
    const chapters = chaptersOf.all(userId, userId, userId, s.story_id);
    const placed = chapters.filter((c) => c.place_at).sort((a, b) => String(b.place_at).localeCompare(String(a.place_at)))[0];
    if (!chapters.length) continue;
    const next = placed || chapters.find((c) => !c.is_read) || null;
    const last = chapters[chapters.length - 1];
    out.push({
      story_id: s.story_id,
      story_title: s.story_title,
      author_name: s.author_name,
      cover_filename: s.cover_filename,
      cover_focus_x: s.cover_focus_x,
      cover_focus_y: s.cover_focus_y,
      finished: !next,
      chapter_id: (next || last).id,
      chapter_number: (next || last).chapter_number,
      chapter_title: (next || last).title,
      chapters: chapters.length,
      read: chapters.filter((c) => c.is_read).length,
      percent: placed ? Math.max(1, Math.min(99, Number(placed.percent) || 0)) : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The inbox's new chapters, a story at a time: "Boldly Go, 3 new
 * chapters" is one thing to decide about, not three.
 * @param {any[]} chapters  inboxFor(...).newChapters, newest first
 */
function newChaptersByStory(chapters, limit = 6) {
  const byStory = new Map();
  for (const c of chapters) {
    if (!byStory.has(c.story_id)) {
      byStory.set(c.story_id, { story_id: c.story_id, story_title: c.story_title, author_name: c.author_name, latest: c.created_at, chapters: [] });
    }
    byStory.get(c.story_id).chapters.push(c);
  }
  return [...byStory.values()].slice(0, limit).map((g) => {
    const inOrder = [...g.chapters].sort((a, b) => a.chapter_number - b.chapter_number);
    return { ...g, first: inOrder[0], words: inOrder.reduce((n, c) => n + (Number(c.word_count) || 0), 0) };
  });
}

/**
 * What this writer has on the go, for the top of the front page: for each
 * story of theirs still being written, its latest chapter and any draft of
 * theirs waiting in it. `stories` is the front page's own list (so the
 * counts and words are the ones shown everywhere else).
 * @param {number} userId
 * @param {any[]} stories  their stories, already chosen
 */
function deskFor(userId, stories) {
  if (!stories.length) return [];
  const drafts = db.prepare(`
    SELECT c.story_id, c.id AS chapter_id, c.chapter_number, c.title, d.updated_at
    FROM chapter_drafts d JOIN chapters c ON c.id = d.chapter_id
    WHERE d.user_id = ? AND c.archived_at IS NULL
    ORDER BY d.updated_at DESC
  `).all(userId);
  const latest = db.prepare(`
    SELECT id, chapter_number, title, created_at FROM chapters
    WHERE story_id = ? AND archived_at IS NULL ORDER BY chapter_number DESC LIMIT 1
  `);
  return stories.map((s) => ({
    ...s,
    draft: drafts.find((d) => d.story_id === s.id) || null,
    latest: latest.get(s.id) || null,
  })).sort((a, b) => String((b.draft && b.draft.updated_at) || b.last_chapter_at || b.created_at)
    .localeCompare(String((a.draft && a.draft.updated_at) || a.last_chapter_at || a.created_at)));
}

/** How somebody likes the list of stories to look: '' (covers) or 'list'. */
const storyViewOf = (userId) => (db.prepare('SELECT story_view FROM users WHERE id = ?').get(userId) || {}).story_view || '';
function setStoryView(userId, view) {
  db.prepare('UPDATE users SET story_view = ? WHERE id = ?').run(view === 'list' ? 'list' : '', userId);
}

module.exports = { deskFor, newChaptersByStory, recentlyRead, setStoryView, storiesReadBy, storyViewOf };
