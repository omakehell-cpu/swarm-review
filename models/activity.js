'use strict';

const { db } = require('./shared');
const { canReadBible } = require('./coauthors');

// ---------- what the group has been doing ----------
//
// The front page used to be a list of stories, which says what exists and
// nothing about whether anybody is here. A writing group runs on the sense
// that other people are at it too: that Luis read your chapter last night,
// that Ana has three notes on hers. The log already knew all of it
// (see recordEvent); this is the part of it worth showing each other.
//
// Only the things people do *for the group* -- writing, reading, noting,
// answering. Signing in, downloading, admin work and the like stay in the
// log for whoever runs the site. A private bible stays private here too.

const SHOWN = {
  'story-started': 'started a new story',
  'chapter-added': 'posted',
  'chapter-revised': 'revised',
  'chapter-read': 'read',
  'comment-added': 'left a note on',
  'suggestion-added': 'suggested a rewrite in',
  'praise-added': 'loved a passage in',
  'comment-replied': 'replied on',
  'comment-accepted': 'took a note on',
  'suggestion-applied': 'put a suggested rewrite into',
  'review-requested': 'asked for a read of',
  'review-done': 'finished reading',
  'bible-entry-added': 'added to the glossary:',
  joined: 'joined the group',
};

/**
 * @param {Row} viewer
 * @param {{ limit?: number }} [options]
 */
function groupActivity(viewer, { limit = 12 } = {}) {
  const kinds = Object.keys(SHOWN);
  const rows = db.prepare(`
    SELECT e.id, e.kind, e.subject, e.href, e.story_id, e.chapter_id, e.created_at, e.user_id,
           u.display_name, u.username,
           s.bible_private, s.author_id AS story_author_id, s.archived_at AS story_archived,
           c.archived_at AS chapter_archived
    FROM events e
    JOIN users u ON u.id = e.user_id
    LEFT JOIN stories s ON s.id = e.story_id
    LEFT JOIN chapters c ON c.id = e.chapter_id
    WHERE e.kind IN (${kinds.map(() => '?').join(',')})
    ORDER BY e.id DESC
    LIMIT 300
  `).all(...kinds);

  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (row.story_archived || row.chapter_archived) continue;
    if (row.kind.startsWith('bible-') && row.story_id
      && !canReadBible({ id: row.story_id, bible_private: row.bible_private, author_id: row.story_author_id }, viewer)) continue;
    // Five notes on one chapter in one sitting is one thing that
    // happened, not five: kept once, at its latest, with a count.
    const day = String(row.created_at).slice(0, 10);
    const key = `${row.user_id}|${row.kind}|${row.chapter_id || row.subject}|${day}`;
    if (seen.has(key)) {
      const first = out.find((o) => o.key === key);
      if (first) first.times += 1;
      continue;
    }
    seen.add(key);
    out.push({ ...row, key, verb: SHOWN[row.kind], times: 1 });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- the welcome card ----------
//
// Three things make somebody a member of a writing group rather than an
// account on a website: they have read somebody's chapter, they have
// said something about it, and they have put something of their own up.
// The card on the front page walks a newcomer through those three, ticks
// them off as they happen, and goes away by itself when all three have --
// or the moment its reader says they do not need it.
function welcomeState(user) {
  const one = (sql, ...params) => db.prepare(sql).get(...params).n;
  const row = db.prepare('SELECT welcome_dismissed_at FROM users WHERE id = ?').get(user.id) || {};
  const read = one('SELECT COUNT(*) AS n FROM chapter_reads WHERE user_id = ?', user.id) > 0;
  const noted = one('SELECT COUNT(*) AS n FROM comments WHERE author_id = ? AND deleted_at IS NULL', user.id) > 0;
  const wrote = one('SELECT COUNT(*) AS n FROM chapters WHERE author_id = ?', user.id) > 0;
  // Somewhere to start: the newest chapter by somebody else.
  const tryThis = db.prepare(`
    SELECT c.id, c.title, c.chapter_number, s.title AS story_title, u.display_name AS author_name
    FROM chapters c JOIN stories s ON s.id = c.story_id JOIN users u ON u.id = c.author_id
    WHERE c.author_id <> ? AND c.archived_at IS NULL AND s.archived_at IS NULL
    ORDER BY c.created_at DESC LIMIT 1
  `).get(user.id) || null;
  const done = read && noted && wrote;
  return { show: !row.welcome_dismissed_at && !done, read, noted, wrote, tryThis };
}

function dismissWelcome(userId) {
  db.prepare("UPDATE users SET welcome_dismissed_at = datetime('now') WHERE id = ?").run(userId);
}

module.exports = { dismissWelcome, groupActivity, welcomeState };
