'use strict';

const { groupChaptersIntoArcs } = require('../lib/story-state');
const { db } = require('./shared');

/** Every point of view this story has used, commonest first. */
const listPovs = (storyId) => db.prepare(`
  SELECT pov AS value, COUNT(*) AS n FROM chapters
   WHERE story_id = ? AND archived_at IS NULL AND TRIM(pov) != ''
   GROUP BY pov COLLATE NOCASE ORDER BY n DESC, pov COLLATE NOCASE
`).all(storyId);

const listStrands = (storyId) => db.prepare(`
  SELECT strand AS value, COUNT(*) AS n FROM chapters
   WHERE story_id = ? AND archived_at IS NULL AND TRIM(strand) != ''
   GROUP BY strand COLLATE NOCASE ORDER BY n DESC, strand COLLATE NOCASE
`).all(storyId);

function setStoryWordGoal(storyId, goal) {
  const clean = Math.max(0, Math.min(10000000, Math.round(Number(goal) || 0)));
  db.prepare('UPDATE stories SET word_goal = ? WHERE id = ?').run(clean, storyId);
  return clean;
}

function setDailyGoal(userId, goal) {
  const clean = Math.max(0, Math.min(100000, Math.round(Number(goal) || 0)));
  db.prepare('UPDATE users SET daily_goal = ? WHERE id = ?').run(clean, userId);
  return clean;
}

// ---------- how much was written, and when ----------

// Derived, not stored. A version's contribution is what it added to the
// chapter it belongs to: its word count minus the one before it. A day
// spent cutting shows as a negative number, which is the truth about that
// day and not a bug.
//
// Attribution is by the chapter's author, and that is exact rather than
// approximate: only a chapter's own author can edit it, so every version
// of a chapter was written by the same person.
const DAY_DELTAS = `
  SELECT date(v.created_at) AS day,
         c.author_id AS author_id,
         c.story_id AS story_id,
         v.word_count - COALESCE(prev.word_count, 0) AS words
    FROM chapter_versions v
    JOIN chapters c ON c.id = v.chapter_id
    LEFT JOIN chapter_versions prev
      ON prev.chapter_id = v.chapter_id AND prev.version_number = v.version_number - 1
   WHERE c.archived_at IS NULL`;


/** Words added per day, newest last, for one story or one person. */
function wordsByDay({ storyId = null, userId = null, since = null } = {}) {
  // node:sqlite refuses a parameter the statement does not mention, so the
  // clause list and the parameter object are built together -- the same
  // rule editChapter's partial update follows.
  const clauses = [];
  const params = {};
  if (storyId) { clauses.push('story_id = @storyId'); params.storyId = storyId; }
  if (userId) { clauses.push('author_id = @userId'); params.userId = userId; }
  if (since) { clauses.push('day >= @since'); params.since = since; }
  return db.prepare(`
    SELECT day, SUM(words) AS words FROM (${DAY_DELTAS})
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    GROUP BY day ORDER BY day
  `).all(params);
}

const isoDay = (date) => date.toISOString().slice(0, 10);


/**
 * What one person has been writing lately: today, this week, and how many
 * days in a row they have hit their own goal.
 *
 * A streak needs a goal to be a streak. Without one this reports days
 * written rather than pretending the goal was one word -- a number nobody
 * set is not a target somebody met.
 */
function writingStreak(userId, goal, now = new Date()) {
  const rows = wordsByDay({ userId, since: isoDay(new Date(now.getTime() - 120 * 86400000)) });
  const byDay = new Map(rows.map((r) => [r.day, r.words]));
  const today = isoDay(now);
  const weekStart = isoDay(new Date(now.getTime() - 6 * 86400000));
  let week = 0;
  for (const [day, words] of byDay) if (day >= weekStart) week += words;

  let streak = 0;
  const met = (words) => (goal > 0 ? words >= goal : words > 0);
  for (let i = 0; i < 120; i += 1) {
    const day = isoDay(new Date(now.getTime() - i * 86400000));
    const words = byDay.get(day) || 0;
    // Today not being done yet does not break a streak; yesterday not
    // being done does.
    if (met(words)) streak += 1;
    else if (i > 0) break;
  }
  return { today: byDay.get(today) || 0, week, streak, goal, days: rows };
}


// ---------- what a story is made of, counted ----------

// Everything here is a count over rows that already exist: no new table,
// nothing to keep in step. The page that draws it never computes anything
// of its own.
function storyAnalysis(storyId) {
  const chapters = db.prepare(`
    SELECT c.id, c.chapter_number, c.title, c.arc_title, c.pov, c.strand, c.stage,
      (SELECT v.word_count FROM chapter_versions v WHERE v.chapter_id = c.id
        ORDER BY v.version_number DESC LIMIT 1) AS word_count,
      (SELECT COUNT(*) FROM comments cm
         JOIN chapter_versions v2 ON v2.id = cm.version_id
        WHERE v2.chapter_id = c.id AND cm.status = 'pending'
          AND cm.parent_id IS NULL AND cm.deleted_at IS NULL
          AND v2.version_number = (SELECT MAX(v3.version_number) FROM chapter_versions v3 WHERE v3.chapter_id = c.id)
      ) AS pending_comments
    FROM chapters c
    WHERE c.story_id = ? AND c.archived_at IS NULL
    ORDER BY c.chapter_number
  `).all(storyId);

  // A distribution over a label: how many chapters, and how many words.
  // Chapters that never said are counted as their own row rather than
  // dropped, because "nobody has said" is usually the interesting number.
  const distribution = (field) => {
    const byLabel = new Map();
    for (const c of chapters) {
      const label = String(c[field] || '').trim();
      const key = label.toLowerCase() || 'unset';
      const row = byLabel.get(key) || { label, chapters: 0, words: 0, unset: !label };
      row.chapters += 1;
      row.words += c.word_count || 0;
      byLabel.set(key, row);
    }
    return Array.from(byLabel.values()).sort((a, b) => {
      if (a.unset !== b.unset) return a.unset ? 1 : -1;
      return b.words - a.words || a.label.localeCompare(b.label);
    });
  };

  const arcs = groupChaptersIntoArcs(chapters).map((group) => ({
    label: group.title,
    chapters: group.chapters.length,
    words: group.chapters.reduce((sum, c) => sum + (c.word_count || 0), 0),
    unset: !group.title,
  }));

  // Who is in what: the appearance cache, already resolved, turned into
  // one row per entry with a cell per chapter.
  const presenceRows = db.prepare(`
    SELECT e.id, e.name, e.kind, sc.chapter_id, sc.mentions
      FROM story_entity_chapters sc
      JOIN story_entities e ON e.id = sc.entity_id
     WHERE sc.story_id = ?
  `).all(storyId);
  const presence = new Map();
  for (const row of presenceRows) {
    if (!presence.has(row.id)) {
      presence.set(row.id, { id: row.id, name: row.name, kind: row.kind, chapters: new Map(), total: 0 });
    }
    const entry = presence.get(row.id);
    entry.chapters.set(row.chapter_id, row.mentions);
    entry.total += row.mentions;
  }

  return {
    chapters,
    words: chapters.reduce((sum, c) => sum + (c.word_count || 0), 0),
    arcs,
    povs: distribution('pov'),
    strands: distribution('strand'),
    presence: Array.from(presence.values())
      .sort((a, b) => b.chapters.size - a.chapters.size || b.total - a.total),
    days: wordsByDay({ storyId }),
  };
}

// ---------- the story bible (see lib/story-bible.js and db.js) ----------

module.exports = {
  DAY_DELTAS,
  isoDay,
  listPovs,
  listStrands,
  setDailyGoal,
  setStoryWordGoal,
  storyAnalysis,
  wordsByDay,
  writingStreak,
};
