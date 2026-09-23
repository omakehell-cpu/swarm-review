'use strict';

const { chaptersNewToMe, mentionsOf, pendingOnMyChapters, repliesToMe } = require('./reading');
const { reviewQueueFor } = require('./reviews');
const { auth, db } = require('./shared');
// The order chapters are told in and the order things happen in are two
// different orders, and the gap between them is where a long book with a
// lot of people in it goes wrong. This reads both and puts them side by
// side; it decides nothing.
//
// Nothing here is stored: it is the chapters and the bible entries that
// have been given a day, sorted. A story where nobody has dated anything
// gets an empty timeline and a sentence saying so, not an error.
function storyTimeline(storyId) {
  const chapters = db.prepare(`
    SELECT id, chapter_number, title, story_when, story_day, arc_title
      FROM chapters
     WHERE story_id = ? AND archived_at IS NULL
     ORDER BY chapter_number
  `).all(storyId);
  const entities = db.prepare(`
    SELECT id, name, kind, summary, story_when, story_day
      FROM story_entities
     WHERE story_id = ?
     ORDER BY name COLLATE NOCASE
  `).all(storyId);

  const placed = [];
  const undated = [];
  for (const c of chapters) {
    const item = {
      type: 'chapter',
      id: c.id,
      day: c.story_day,
      when: c.story_when,
      title: `${c.chapter_number}. ${c.title}`,
      note: c.arc_title || '',
      url: `/chapters/${c.id}`,
      order: c.chapter_number,
    };
    (item.day === null || item.day === undefined ? undated : placed).push(item);
  }
  for (const e of entities) {
    if (e.story_day === null || e.story_day === undefined) {
      // An entry with a date written out but no number can be shown; one
      // with neither is just an entry, and does not belong on a timeline.
      if (String(e.story_when || '').trim()) {
        undated.push({ type: 'entry', id: e.id, day: null, when: e.story_when, title: e.name, note: e.kind, url: `/bible/${e.id}`, order: null });
      }
      continue;
    }
    placed.push({
      type: 'entry', id: e.id, day: e.story_day, when: e.story_when,
      title: e.name, note: e.summary || e.kind, url: `/bible/${e.id}`, order: null,
    });
  }

  // Same day: chapters before entries, then by the order they are told
  // in, so a day with three chapters on it still reads forwards.
  placed.sort((a, b) => a.day - b.day
    || String(a.type).localeCompare(String(b.type))
    || (a.order || 0) - (b.order || 0));

  let previousDay = null;
  for (const item of placed) {
    item.gap = previousDay === null ? null : item.day - previousDay;
    previousDay = item.day;
  }

  // Told out of order is judged in reading order, not in this list's
  // order: a reader meets the chapters by number, and the jump happens at
  // the chapter that goes back -- which is the flashback itself, not the
  // chapter it flashes back from. It is a choice, so it is marked rather
  // than corrected.
  let highestDay = -Infinity;
  for (const item of placed.slice().sort((a, b) => (a.order || 0) - (b.order || 0))) {
    if (item.type !== 'chapter') continue;
    item.outOfOrder = item.day < highestDay;
    if (item.day > highestDay) highestDay = item.day;
  }

  return {
    placed,
    undated,
    chapters: chapters.length,
    dated: placed.filter((i) => i.type === 'chapter').length,
    span: placed.length ? { from: placed[0].day, to: placed[placed.length - 1].day } : null,
    outOfOrder: placed.filter((i) => i.outOfOrder).length,
  };
}


/** Every date label this story has used, so they settle into one shape. */
const listStoryWhens = (storyId) => db.prepare(`
  SELECT value, SUM(n) AS n FROM (
    SELECT story_when AS value, COUNT(*) AS n FROM chapters
     WHERE story_id = @storyId AND archived_at IS NULL AND TRIM(story_when) != ''
     GROUP BY story_when COLLATE NOCASE
    UNION ALL
    SELECT story_when AS value, COUNT(*) AS n FROM story_entities
     WHERE story_id = @storyId AND TRIM(story_when) != ''
     GROUP BY story_when COLLATE NOCASE
  ) GROUP BY value COLLATE NOCASE ORDER BY n DESC, value COLLATE NOCASE LIMIT 60
`).all({ storyId }).map((r) => r.value);

// ---------- the feed ----------

// The one way this app tells somebody that a note is waiting without
// reaching out to the network itself: a private Atom feed per person,
// behind an unguessable URL, which sits still until their reader asks.
//
// The token is created on request and not before -- a capability nobody
// has made is a capability nobody can leak -- and rotating it is one
// statement, which is what "somebody saw my screen" needs.

const getUserByFeedToken = (token) => (token
  ? db.prepare('SELECT * FROM users WHERE feed_token = ?').get(String(token)) || null
  : null);

function createFeedToken(userId) {
  const token = auth.generateResetToken();
  db.prepare('UPDATE users SET feed_token = ? WHERE id = ?').run(token, userId);
  return token;
}

function clearFeedToken(userId) {
  db.prepare('UPDATE users SET feed_token = NULL WHERE id = ?').run(userId);
}


// What goes in it. Three kinds of thing, each with an id that means the
// same row for ever, because a reader remembers what it has shown by id.
//
// Unlike the index, this does not use "since your last visit": a feed is
// read somewhere else entirely, and clearing it by loading a web page
// would make things vanish before they were seen. It is a window of days
// instead, which is what a reader expects.
function feedItemsFor(userId, { days = 30, limit = 40 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const items = [];

  for (const row of pendingOnMyChapters(userId)) {
    items.push({
      kind: 'waiting',
      // The newest note is part of the id on purpose: another note
      // arriving is a new thing to be told about, and the old entry stays
      // read rather than silently changing under the reader.
      key: `waiting/${row.chapter_id}-${row.latest_at}`,
      title: `${row.pending} note${row.pending === 1 ? '' : 's'} waiting on ${row.chapter_number}. ${row.chapter_title}`,
      summary: `In ${row.story_title}. Nothing happens to ${row.pending === 1 ? 'it' : 'them'} until you accept or turn ${row.pending === 1 ? 'it' : 'them'} down.`,
      url: `/chapters/${row.chapter_id}`,
      at: row.latest_at,
    });
  }

  // Being asked to read something is the most personal thing this feed
  // carries, and the one most worth being told about.
  for (const row of reviewQueueFor(userId)) {
    items.push({
      kind: 'asked',
      key: `asked/${row.id}-${row.created_at}`,
      title: `${row.requested_by_name || 'Somebody'} asked you to read ${row.chapter_number}. ${row.chapter_title}`,
      summary: row.question ? `\u201c${row.question}\u201d` : `In ${row.story_title}.`,
      url: `/chapters/${row.chapter_id}`,
      at: row.created_at,
      author: row.requested_by_name,
    });
  }

  for (const row of repliesToMe(userId, since, limit)) {
    items.push({
      kind: 'reply',
      key: `reply/${row.id}`,
      title: `${row.author_name} replied on ${row.chapter_number}. ${row.chapter_title}`,
      summary: row.body,
      url: `/chapters/${row.chapter_id}`,
      at: row.created_at,
      author: row.author_name,
    });
  }

  const replyIds = new Set(items.filter((i) => i.kind === 'reply').map((i) => i.key));
  for (const row of mentionsOf(userId, since, limit)) {
    if (replyIds.has(`reply/${row.id}`)) continue;
    items.push({
      kind: 'mention',
      key: `mention/${row.id}`,
      title: `${row.author_name} mentioned you on ${row.chapter_number}. ${row.chapter_title}`,
      summary: row.body,
      url: `/chapters/${row.chapter_id}#comment-${row.id}`,
      at: row.created_at,
      author: row.author_name,
    });
  }

  for (const row of chaptersNewToMe(userId, limit)) {
    if (row.created_at < since) continue;
    items.push({
      kind: 'chapter',
      key: `chapter/${row.id}`,
      title: `${row.story_title}: ${row.chapter_number}. ${row.title}`,
      summary: `${row.author_name} posted a chapter you have not opened${row.word_count ? `, ${row.word_count} words` : ''}.`,
      url: `/chapters/${row.id}`,
      at: row.created_at,
      author: row.author_name,
    });
  }

  items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return items.slice(0, limit);
}

// ---------- coauthors ----------

module.exports = {
  clearFeedToken,
  createFeedToken,
  feedItemsFor,
  getUserByFeedToken,
  listStoryWhens,
  storyTimeline,
};
