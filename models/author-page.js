'use strict';

// What somebody's page shows about their writing: every story they have a
// hand in, with its dates and its face; when they wrote, month by month
// (or year by year, for a long career); what their stories are about, by
// tag; and how far it has reached -- readers and followers.

const { db } = require('./shared');

const LATEST_WORDS = `(SELECT v.word_count FROM chapter_versions v WHERE v.chapter_id = c.id ORDER BY v.version_number DESC LIMIT 1)`;

/** Every story this person writes in, with what the page needs to show it. */
function authorWorks(userId) {
  const works = db.prepare(`
    SELECT s.id, s.title, s.description, s.status, s.series, s.created_at, s.cover_filename, s.cover_focus_x, s.cover_focus_y,
           s.author_id = @userId AS is_owner,
           (SELECT COUNT(*) FROM chapters c WHERE c.story_id = s.id AND c.archived_at IS NULL) AS chapter_count,
           (SELECT COUNT(*) FROM chapters c WHERE c.story_id = s.id AND c.archived_at IS NULL AND c.author_id = @userId) AS own_chapters,
           (SELECT COALESCE(SUM(${LATEST_WORDS}), 0) FROM chapters c WHERE c.story_id = s.id AND c.archived_at IS NULL) AS word_count,
           (SELECT MIN(c.created_at) FROM chapters c WHERE c.story_id = s.id AND c.archived_at IS NULL) AS first_chapter_at,
           (SELECT MAX(c.created_at) FROM chapters c WHERE c.story_id = s.id AND c.archived_at IS NULL) AS last_chapter_at,
           (SELECT COUNT(*) FROM story_follows f WHERE f.story_id = s.id) AS followers
    FROM stories s
    WHERE s.archived_at IS NULL
      AND (s.author_id = @userId OR EXISTS (SELECT 1 FROM story_authors a WHERE a.story_id = s.id AND a.user_id = @userId))
  `).all({ userId });
  const tags = db.prepare(`
    SELECT t.name FROM story_tags st JOIN tags t ON t.id = st.tag_id
    WHERE st.story_id = ? AND (t.status IS NULL OR t.status = 'approved') ORDER BY t.name COLLATE NOCASE
  `);
  return works.map((w) => ({ ...w, started_at: w.first_chapter_at || w.created_at, tags: tags.all(w.id).map((t) => t.name) }))
    .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
}

/**
 * Words put up, bucketed over the span of their writing: by month for up
 * to three years, by year for a longer career. Each chapter counts once,
 * on the day it first went up, at its current length.
 * @returns {{ unit: 'month'|'year', buckets: Array<{ key: string, label: string, words: number, chapters: number }> }}
 */
function authorOutput(userId) {
  const rows = db.prepare(`
    SELECT c.created_at, ${LATEST_WORDS} AS words
    FROM chapters c JOIN stories s ON s.id = c.story_id
    WHERE c.author_id = ? AND c.archived_at IS NULL AND s.archived_at IS NULL
    ORDER BY c.created_at
  `).all(userId);
  if (!rows.length) return { unit: 'month', buckets: [] };
  const first = new Date(`${String(rows[0].created_at).slice(0, 10)}T00:00:00Z`);
  const now = new Date();
  const lastRow = new Date(`${String(rows[rows.length - 1].created_at).slice(0, 10)}T00:00:00Z`);
  const end = lastRow > now ? lastRow : now;
  const months = (end.getUTCFullYear() - first.getUTCFullYear()) * 12 + end.getUTCMonth() - first.getUTCMonth() + 1;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const buckets = new Map();
  if (months > 36) {
    for (let y = first.getUTCFullYear(); y <= end.getUTCFullYear(); y += 1) buckets.set(String(y), { key: String(y), label: String(y), words: 0, chapters: 0 });
    for (const r of rows) {
      const b = buckets.get(String(r.created_at).slice(0, 4));
      if (b) { b.words += Number(r.words) || 0; b.chapters += 1; }
    }
    return { unit: 'year', buckets: [...buckets.values()] };
  }
  // At least a year on the axis, so one busy month is not the whole chart.
  const span = Math.max(12, months);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - span + 1, 1));
  for (let i = 0; i < span; i += 1) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    buckets.set(key, { key, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, words: 0, chapters: 0 });
  }
  for (const r of rows) {
    const b = buckets.get(String(r.created_at).slice(0, 7));
    if (b) { b.words += Number(r.words) || 0; b.chapters += 1; }
  }
  return { unit: 'month', buckets: [...buckets.values()] };
}

/** The tags their stories carry most, and on how many of them. */
function authorTags(userId, limit = 6) {
  return db.prepare(`
    SELECT t.name, t.slug, COUNT(DISTINCT s.id) AS n
    FROM stories s JOIN story_tags st ON st.story_id = s.id JOIN tags t ON t.id = st.tag_id
    WHERE s.archived_at IS NULL AND (t.status IS NULL OR t.status = 'approved')
      AND (s.author_id = @userId OR EXISTS (SELECT 1 FROM story_authors a WHERE a.story_id = s.id AND a.user_id = @userId))
    GROUP BY t.id ORDER BY n DESC, t.name COLLATE NOCASE LIMIT @limit
  `).all({ userId, limit });
}

/** How far it has gone: different people who have read their chapters, and who follow their stories. */
function authorReach(userId) {
  return {
    readers: db.prepare(`
      SELECT COUNT(DISTINCT r.user_id) AS n FROM chapter_reads r JOIN chapters c ON c.id = r.chapter_id
      WHERE c.author_id = ? AND r.user_id <> ?
    `).get(userId, userId).n,
    followers: db.prepare(`
      SELECT COUNT(DISTINCT f.user_id) AS n FROM story_follows f JOIN stories s ON s.id = f.story_id
      WHERE s.archived_at IS NULL AND f.user_id <> @userId
        AND (s.author_id = @userId OR EXISTS (SELECT 1 FROM story_authors a WHERE a.story_id = s.id AND a.user_id = @userId))
    `).get({ userId }).n,
  };
}

module.exports = { authorOutput, authorReach, authorTags, authorWorks };
