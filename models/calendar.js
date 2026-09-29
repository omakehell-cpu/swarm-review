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
    SELECT id, chapter_number, title, story_when, story_day, arc_title, pov, strand, summary, author_id,
           (SELECT word_count FROM chapter_versions v WHERE v.chapter_id = chapters.id ORDER BY version_number DESC LIMIT 1) AS words
      FROM chapters
     WHERE story_id = ? AND archived_at IS NULL
     ORDER BY chapter_number
  `).all(storyId);
  const entities = db.prepare(`
    SELECT id, name, kind, summary, story_when, story_day, story_day_end
      FROM story_entities
     WHERE story_id = ?
     ORDER BY name COLLATE NOCASE
  `).all(storyId);
  const byEntity = new Map(entities.map((e) => [e.id, e]));

  // What ties things together, so the timeline can draw it: the relations
  // written in the bible, and the chapters each entry is named in.
  const relations = db.prepare(`
    SELECT id, from_id, to_id, label, reverse_label FROM story_entity_links WHERE story_id = ?
  `).all(storyId);
  const toldIn = new Map();
  for (const row of db.prepare(`
    SELECT sc.entity_id, ch.id AS chapter_id, ch.chapter_number
      FROM story_entity_chapters sc JOIN chapters ch ON ch.id = sc.chapter_id
     WHERE ch.story_id = ? AND ch.archived_at IS NULL
     ORDER BY ch.chapter_number
  `).all(storyId)) {
    if (!toldIn.has(row.entity_id)) toldIn.set(row.entity_id, []);
    toldIn.get(row.entity_id).push({ id: row.chapter_id, number: row.chapter_number });
  }

  /** @type {any[]} */
  const placed = [];
  /** @type {any[]} */
  const undated = [];
  for (const c of chapters) {
    const item = {
      type: 'chapter',
      key: `c${c.id}`,
      id: c.id,
      day: c.story_day,
      end: null,
      when: c.story_when,
      title: `${c.chapter_number}. ${c.title}`,
      note: c.arc_title || '',
      url: `/chapters/${c.id}`,
      order: c.chapter_number,
      kind: 'chapter',
      name: c.title,
      pov: c.pov || '',
      strand: c.strand || '',
      summary: c.summary || '',
      words: c.words || 0,
      authorId: c.author_id,
    };
    (item.day === null || item.day === undefined ? undated : placed).push(item);
  }
  for (const e of entities) {
    const item = {
      type: 'entry', key: `e${e.id}`, id: e.id, day: e.story_day, end: e.story_day_end,
      when: e.story_when, title: e.name, note: e.summary || '', url: `/bible/${e.id}`, order: null, kind: e.kind,
      toldIn: toldIn.get(e.id) || [],
      related: relations
        .filter((r) => r.from_id === e.id || r.to_id === e.id)
        .map((r) => {
          const other = byEntity.get(r.from_id === e.id ? r.to_id : r.from_id);
          const label = r.from_id === e.id ? r.label : (r.reverse_label || r.label);
          return other ? { key: `e${other.id}`, id: other.id, name: other.name, kind: other.kind, label: label || 'related to' } : null;
        })
        .filter(Boolean),
    };
    if (e.story_day === null || e.story_day === undefined) {
      // An entry with a date written out but no number can be shown, and
      // so can an event with neither -- an event is something that
      // happens, so it is waiting for a day. Anything else undated is
      // just an entry, and does not belong on a timeline.
      if (String(e.story_when || '').trim() || e.kind === 'event') undated.push({ ...item, day: null });
      continue;
    }
    placed.push(item);
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

  // The lines between things on the timeline: a relation between two
  // dated entries, and an entry to the dated chapters that name it.
  const onLine = new Set(placed.map((i) => i.key));
  const links = [];
  for (const r of relations) {
    const a = `e${r.from_id}`;
    const b = `e${r.to_id}`;
    if (onLine.has(a) && onLine.has(b)) links.push({ from: a, to: b, label: r.label || 'related to', type: 'relation' });
  }
  for (const item of placed) {
    if (item.type !== 'entry') continue;
    for (const c of item.toldIn) {
      if (onLine.has(`c${c.id}`)) links.push({ from: item.key, to: `c${c.id}`, label: 'told in', type: 'told' });
    }
  }
  // Each chapter, the dated entries it names.
  for (const item of placed) {
    if (item.type !== 'chapter') continue;
    item.names = placed.filter((e) => e.type === 'entry' && e.toldIn.some((c) => c.id === item.id))
      .map((e) => ({ key: e.key, name: e.title, kind: e.kind }));
  }

  const last = placed.reduce((m, i) => Math.max(m, i.end || i.day), -Infinity);
  return {
    placed,
    undated,
    links,
    chapters: chapters.length,
    dated: placed.filter((i) => i.type === 'chapter').length,
    events: placed.filter((i) => i.kind === 'event').length,
    span: placed.length ? { from: placed[0].day, to: last } : null,
    outOfOrder: placed.filter((i) => i.outOfOrder).length,
  };
}

/**
 * Where one entry sits among the story's dated events: the event just
 * before it and the one just after, for the entry's own page.
 */
function timelineNeighbours(entityId) {
  const e = db.prepare('SELECT id, story_id, story_day FROM story_entities WHERE id = ?').get(entityId);
  if (!e || e.story_day === null || e.story_day === undefined) return null;
  const ask = (op, order) => db.prepare(`
    SELECT id, name, story_day, story_when FROM story_entities
     WHERE story_id = ? AND kind = 'event' AND id != ? AND story_day IS NOT NULL
       AND (story_day ${op} ? OR (story_day = ? AND id ${op} ?))
     ORDER BY story_day ${order}, id ${order} LIMIT 1
  `).get(e.story_id, e.id, e.story_day, e.story_day, e.id) || null;
  return { before: ask('<', 'DESC'), after: ask('>', 'ASC') };
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
  timelineNeighbours,
  clearFeedToken,
  createFeedToken,
  feedItemsFor,
  getUserByFeedToken,
  listStoryWhens,
  storyTimeline,
};
