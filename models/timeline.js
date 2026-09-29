'use strict';

// The timeline's own writes: the story's eras, and the dates set from the
// timeline page itself rather than one chapter form at a time. What the
// timeline reads is in models/calendar.js (storyTimeline).

const { cleanDay, cleanLabel, db } = require('./shared');

// ---------- eras ----------

const ERA_TITLE_MAX = 80;
const cleanEraTitle = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, ERA_TITLE_MAX);

/** The story's eras, earliest first. */
const storyEras = (storyId) => db.prepare('SELECT * FROM story_eras WHERE story_id = ? ORDER BY from_day, id').all(storyId);

/** @returns {{ error?: string, id?: number }} */
function addEra({ storyId, title, fromDay }) {
  const name = cleanEraTitle(title);
  const day = cleanDay(fromDay);
  if (!name) return { error: 'An era needs a name.' };
  if (day === null) return { error: 'Say the day the era starts on.' };
  if (db.prepare('SELECT 1 FROM story_eras WHERE story_id = ? AND from_day = ?').get(storyId, day)) {
    return { error: `An era already starts on day ${day}.` };
  }
  const info = db.prepare('INSERT INTO story_eras (story_id, title, from_day) VALUES (?, ?, ?)').run(storyId, name, day);
  return { id: Number(info.lastInsertRowid) };
}

/** @returns {{ error?: string }} */
function updateEra({ eraId, title, fromDay }) {
  const era = getEra(eraId);
  if (!era) return { error: 'There is no such era.' };
  const name = cleanEraTitle(title);
  const day = cleanDay(fromDay);
  if (!name) return { error: 'An era needs a name.' };
  if (day === null) return { error: 'Say the day the era starts on.' };
  if (db.prepare('SELECT 1 FROM story_eras WHERE story_id = ? AND from_day = ? AND id != ?').get(era.story_id, day, eraId)) {
    return { error: `An era already starts on day ${day}.` };
  }
  db.prepare('UPDATE story_eras SET title = ?, from_day = ? WHERE id = ?').run(name, day, eraId);
  return {};
}

const getEra = (eraId) => db.prepare('SELECT * FROM story_eras WHERE id = ?').get(eraId) || null;
const deleteEra = (eraId) => db.prepare('DELETE FROM story_eras WHERE id = ?').run(eraId);

// ---------- dating the story from the timeline ----------

// A day can be written relative to the row above: "+2" is two days after
// whatever came before, "-10" ten days back, "+0" the same day. That is
// how a writer thinks -- "the next morning" -- and it saves the arithmetic
// on day 412. A relative day with nothing above it to count from stays
// empty: undated is not day zero.
/**
 * @param {{ day?: any }[]} rows in the order they were shown
 * @returns {(number|null)[]}
 */
function resolveDays(rows) {
  const out = [];
  let previous = null;
  for (const row of rows) {
    const text = String(row.day == null ? '' : row.day).trim();
    const rel = /^([+-])\s*(\d+)$/.exec(text);
    let day;
    if (rel) day = previous === null ? null : previous + (rel[1] === '+' ? 1 : -1) * Number(rel[2]);
    else day = cleanDay(text);
    out.push(day);
    if (day !== null) previous = day;
  }
  return out;
}

/**
 * Writes dates sent from the timeline. Each row names what it is ("c12" a
 * chapter, "e5" an entry); anything not in this story, or that this person
 * may not change, is passed over rather than trusted. Days are resolved
 * within each list (chapters, entries), in the order sent.
 * @param {number} storyId
 * @param {{ key: string, when?: string, day?: any, end?: any }[]} rows
 * @param {{ chapter: (c: any) => boolean, entry: (e: any) => boolean }} may
 * @returns {{ changed: number, days: Record<string, number|null> }}
 */
function setTimelineDates(storyId, rows, may) {
  const chapters = new Map(db.prepare('SELECT id, author_id, story_when, story_day FROM chapters WHERE story_id = ? AND archived_at IS NULL').all(storyId).map((c) => [c.id, c]));
  const entries = new Map(db.prepare('SELECT id, story_when, story_day, story_day_end FROM story_entities WHERE story_id = ?').all(storyId).map((e) => [e.id, e]));
  const resolved = new Map();
  for (const prefix of ['c', 'e']) {
    const list = rows.filter((r) => new RegExp(`^${prefix}\\d+$`).test(String(r.key)));
    resolveDays(list).forEach((day, i) => resolved.set(list[i], day));
  }
  const setChapter = db.prepare('UPDATE chapters SET story_when = ?, story_day = ? WHERE id = ?');
  const setEntry = db.prepare("UPDATE story_entities SET story_when = ?, story_day = ?, story_day_end = ?, updated_at = datetime('now') WHERE id = ?");
  const days = {};
  let changed = 0;
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      const key = String(row.key);
      const id = Number(key.slice(1));
      const when = cleanLabel(row.when);
      const day = resolved.has(row) ? resolved.get(row) : null;
      if (key[0] === 'c') {
        const c = chapters.get(id);
        if (!c || !may.chapter(c)) continue;
        days[key] = day;
        if (c.story_when === when && c.story_day === day) continue;
        setChapter.run(when, day, id);
        changed++;
      } else if (key[0] === 'e') {
        const e = entries.get(id);
        if (!e || !may.entry(e)) continue;
        const endDay = cleanDay(row.end);
        const end = day === null || endDay === null || endDay <= day ? null : endDay;
        days[key] = day;
        if (e.story_when === when && e.story_day === day && e.story_day_end === end) continue;
        setEntry.run(when, day, end, id);
        changed++;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { changed, days };
}

module.exports = { addEra, deleteEra, getEra, resolveDays, setTimelineDates, storyEras, updateEra };
