'use strict';

// The plan of a story: its arcs, nested, and the chapters it has planned
// but not written. See db-plan.js for the shape of the two tables.
//
// The one idea everything here rests on is the running order: every
// chapter still in the story, in reading order, with the planned chapters
// sitting between them where they were put. An arc is a stretch of that
// order, so it can start on a chapter nobody has written yet, and it moves
// with its chapters when they are dragged about on the outline.

const { db } = require('./shared');

const TEXT_MAX = 4000;
const wordCount = (text) => (String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
const cleanTitle = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 80);
const cleanText = (v) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, TEXT_MAX);

// ---------- the running order ----------

/**
 * Every chapter still in the story and every planned one, in the order
 * the story will be read. A planned chapter sits after the chapter it was
 * put after -- archived or not, since an archived chapter keeps its number
 * -- and planned chapters after the same chapter go in their own order.
 * @param {number} storyId
 */
function planItems(storyId) {
  const all = db.prepare(`
    SELECT c.id, c.chapter_number, c.title, c.summary, c.stage, c.pov, c.author_id, c.archived_at, c.plan_notes,
           (SELECT v.word_count FROM chapter_versions v WHERE v.chapter_id = c.id ORDER BY v.version_number DESC LIMIT 1) AS word_count
      FROM chapters c WHERE c.story_id = ?
  `).all(storyId);
  const numberOf = new Map(all.map((c) => [c.id, c.chapter_number]));
  const slots = db.prepare(`
    SELECT s.*, u.display_name AS draft_by_name FROM story_plan_slots s LEFT JOIN users u ON u.id = s.draft_by
    WHERE s.story_id = ?
  `).all(storyId);
  /** @type {any[]} */
  const items = [
    ...all.filter((c) => !c.archived_at).map((c) => ({
      key: `c${c.id}`, type: 'chapter', id: c.id, title: c.title, summary: c.summary, number: c.chapter_number,
      stage: c.stage, pov: c.pov, authorId: c.author_id, words: c.word_count || 0, planNotes: c.plan_notes || '', sort: [c.chapter_number, 0, 0, 0],
    })),
    ...slots.map((s) => ({
      key: `p${s.id}`, type: 'slot', id: s.id, title: s.title, notes: s.notes, afterChapterId: s.after_chapter_id,
      draftBy: s.draft_content ? s.draft_by : null, draftByName: s.draft_by_name || '', draftWords: wordCount(s.draft_content), draftAt: s.draft_updated_at,
      position: s.position, sort: [numberOf.get(s.after_chapter_id) ?? 0, 1, s.position, s.id],
    })),
  ];
  items.sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1] || a.sort[2] - b.sort[2] || a.sort[3] - b.sort[3]);
  items.forEach((item, i) => { item.index = i; });
  // Where a chapter that is no longer in the running order would have
  // been, so an arc that starts on an archived chapter still has a place.
  const ghostAt = (id) => {
    const n = numberOf.get(id);
    if (n === undefined) return null;
    const i = items.findIndex((item) => item.sort[0] > n || (item.sort[0] === n && item.sort[1] > 0));
    return i === -1 ? items.length - 1 : i;
  };
  const index = new Map(items.map((item) => [item.key, item.index]));
  const indexOf = (ref) => {
    if (!ref) return null;
    if (index.has(ref)) return index.get(ref);
    const m = /^c(\d+)$/.exec(ref);
    return m ? ghostAt(Number(m[1])) : null;
  };
  return { items, indexOf, isLive: (ref) => index.has(ref) };
}

// ---------- the arcs, resolved against it ----------

/**
 * The story's arcs as a tree, each with the stretch of the running order
 * it covers and anything wrong with it said in words. A top-level arc runs
 * until the next one starts, as an arc always has here; a smaller arc runs
 * to its own end, or to the end of the arc it is in.
 * @param {number} storyId
 */
function storyPlan(storyId) {
  reconcileArcTitles(storyId);
  const { items, indexOf, isLive } = planItems(storyId);
  const rows = db.prepare('SELECT * FROM story_arcs WHERE story_id = ? ORDER BY id').all(storyId);
  /** @type {Map<number, any>} */
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [], problems: [] }]));
  const roots = [];
  for (const arc of byId.values()) {
    const parent = arc.parent_id ? byId.get(arc.parent_id) : null;
    (parent ? parent.children : roots).push(arc);
    arc.start = indexOf(arc.start_ref);
    arc.end = arc.end_ref ? indexOf(arc.end_ref) : null;
    if (arc.start === null) arc.problems.push('It starts at a chapter that is no longer in the story.');
    else if (!isLive(arc.start_ref)) arc.problems.push('It starts at a chapter that has been archived.');
  }
  const last = items.length - 1;
  const byStart = (a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || a.id - b.id;

  function resolve(list, from, to, depth) {
    list.sort(byStart);
    list.forEach((arc, i) => {
      arc.depth = depth;
      if (depth === 0) {
        const next = list.slice(i + 1).find((a) => a.start !== null && a.start > arc.start);
        arc.end = next ? next.start - 1 : last;
      } else if (arc.end === null) {
        arc.end = to;
      } else if (arc.end < arc.start) {
        arc.problems.push('It ends before it starts.');
        arc.end = arc.start;
      }
      if (depth > 0 && arc.start !== null && (arc.start < from || arc.end > to)) {
        arc.problems.push('It runs outside the arc it is in.');
      }
      if (depth > 0 && i > 0) {
        const before = list[i - 1];
        if (before.start !== null && arc.start !== null && arc.start <= before.end) {
          arc.problems.push(`It overlaps ${before.title}.`);
        }
      }
      const kids = arc.children;
      const within = arc.start === null ? [] : items.slice(arc.start, arc.end + 1);
      arc.chapters = within.filter((i2) => i2.type === 'chapter').length;
      arc.planned = within.filter((i2) => i2.type === 'slot').length;
      arc.words = within.reduce((sum, i2) => sum + (i2.words || 0), 0);
      arc.label = depth === 0 ? 'Arc' : depth === 1 ? 'Smaller arc' : 'Thread';
      resolve(kids, arc.start ?? 0, arc.end ?? last, depth + 1);
    });
  }
  resolve(roots, 0, last, 0);
  return { items, arcs: roots, all: [...byId.values()] };
}

// ---------- keeping arc_title in step ----------

// A top-level arc that starts on a written chapter is also that chapter's
// arc_title, which is what the chapter form edits and the compiler reads.
// The chapter wins: whatever the form last said is true, and this makes
// the arcs say it too -- a new name makes an arc, a changed one renames
// it, an emptied one ends it.
function reconcileArcTitles(storyId) {
  const chapters = db.prepare('SELECT id, arc_title FROM chapters WHERE story_id = ? AND archived_at IS NULL').all(storyId);
  const tops = new Map(db.prepare("SELECT * FROM story_arcs WHERE story_id = ? AND parent_id IS NULL AND start_ref LIKE 'c%'").all(storyId)
    .map((a) => [a.start_ref, a]));
  for (const c of chapters) {
    const title = cleanTitle(c.arc_title);
    const arc = tops.get(`c${c.id}`);
    if (title && !arc) {
      db.prepare('INSERT INTO story_arcs (story_id, title, start_ref) VALUES (?, ?, ?)').run(storyId, title, `c${c.id}`);
    } else if (title && arc && arc.title !== title) {
      db.prepare("UPDATE story_arcs SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, arc.id);
    } else if (!title && arc) {
      removeArc(arc.id);
    }
  }
}

function setArcTitle(ref, title) {
  const m = /^c(\d+)$/.exec(ref || '');
  if (m) db.prepare('UPDATE chapters SET arc_title = ? WHERE id = ?').run(title, Number(m[1]));
}

// An arc goes, and the smaller arcs in it are kept -- they are still arcs,
// and deleting a container should not delete what somebody wrote inside
// it. Inside a bigger arc they go up into that one. At the top level, the
// arc before it now runs on over their chapters, so they go into that; if
// there is none, they become top-level arcs themselves, which means their
// chapters open them (or, where a top-level arc already starts on the same
// chapter, they go inside that one).
function removeArc(arcId) {
  const arc = db.prepare('SELECT * FROM story_arcs WHERE id = ?').get(arcId);
  if (!arc) return;
  if (arc.parent_id) {
    db.prepare('UPDATE story_arcs SET parent_id = ? WHERE parent_id = ?').run(arc.parent_id, arcId);
  } else {
    const { indexOf } = planItems(arc.story_id);
    const start = indexOf(arc.start_ref) ?? -1;
    const tops = db.prepare('SELECT * FROM story_arcs WHERE story_id = ? AND parent_id IS NULL AND id != ?').all(arc.story_id, arcId);
    const previous = tops
      .map((t) => ({ t, at: indexOf(t.start_ref) }))
      .filter((x) => x.at !== null && x.at <= start)
      .sort((a, b) => b.at - a.at)[0];
    const children = db.prepare('SELECT * FROM story_arcs WHERE parent_id = ?').all(arcId);
    for (const child of children) {
      const clash = previous ? null : tops.find((t) => t.start_ref === child.start_ref);
      const into = previous ? previous.t.id : clash ? clash.id : null;
      db.prepare('UPDATE story_arcs SET parent_id = ?, end_ref = CASE WHEN ? IS NULL THEN \'\' ELSE end_ref END WHERE id = ?').run(into, into, child.id);
      if (!into) {
        setArcTitle(child.start_ref, child.title);
        tops.push({ ...child, parent_id: null });
      }
    }
  }
  db.prepare('DELETE FROM story_arcs WHERE id = ?').run(arcId);
}

// ---------- arcs, changed from the plan page ----------

function validateArc(storyId, { title, startRef, endRef, parentId, arcId = null }) {
  if (!cleanTitle(title)) return 'An arc needs a name.';
  const { indexOf, isLive } = planItems(storyId);
  if (!isLive(startRef)) return 'Pick where the arc starts.';
  if (parentId) {
    const parent = db.prepare('SELECT id FROM story_arcs WHERE id = ? AND story_id = ?').get(parentId, storyId);
    if (!parent) return 'That arc is not in this story.';
    // An arc inside itself, or inside one of its own smaller arcs.
    for (let p = parentId; p; p = (db.prepare('SELECT parent_id FROM story_arcs WHERE id = ?').get(p) || {}).parent_id) {
      if (p === arcId) return 'An arc cannot go inside itself.';
    }
    if (endRef && !isLive(endRef)) return 'Pick where the arc ends.';
    if (endRef && indexOf(endRef) < indexOf(startRef)) return 'The arc ends before it starts.';
  } else {
    const clash = db.prepare('SELECT id, title FROM story_arcs WHERE story_id = ? AND parent_id IS NULL AND start_ref = ? AND id != ?')
      .get(storyId, startRef, arcId || 0);
    if (clash) return `${clash.title} already starts there. Put this one inside it, or start it somewhere else.`;
  }
  return null;
}

/**
 * @param {{ storyId: number, parentId?: number|null, title: string, summary?: string, change?: string, purpose?: string, startRef: string, endRef?: string }} a
 * @returns {{ error?: string, id?: number }}
 */
function addArc({ storyId, parentId = null, title, summary, change, purpose, startRef, endRef = '' }) {
  const parent = Number(parentId) || null;
  const error = validateArc(storyId, { title, startRef, endRef, parentId: parent });
  if (error) return { error };
  db.exec('BEGIN');
  try {
    const info = db.prepare(`
      INSERT INTO story_arcs (story_id, parent_id, title, summary, change_text, purpose, start_ref, end_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(storyId, parent, cleanTitle(title), cleanText(summary), cleanText(change), cleanText(purpose), startRef, parent ? (endRef || '') : '');
    if (!parent) setArcTitle(startRef, cleanTitle(title));
    db.exec('COMMIT');
    return { id: Number(info.lastInsertRowid) };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * @param {{ arcId: number, parentId?: number|null, title: string, summary?: string, change?: string, purpose?: string, startRef: string, endRef?: string }} a
 * @returns {{ error?: string }}
 */
function updateArc({ arcId, parentId = null, title, summary, change, purpose, startRef, endRef = '' }) {
  const arc = db.prepare('SELECT * FROM story_arcs WHERE id = ?').get(arcId);
  if (!arc) return { error: 'There is no such arc.' };
  const parent = Number(parentId) || null;
  const error = validateArc(arc.story_id, { title, startRef, endRef, parentId: parent, arcId });
  if (error) return { error };
  db.exec('BEGIN');
  try {
    // Whatever chapter this arc used to open, it no longer does; then the
    // one it opens now (if it is still a top-level arc) says so.
    if (!arc.parent_id) setArcTitle(arc.start_ref, '');
    db.prepare(`
      UPDATE story_arcs SET parent_id = ?, title = ?, summary = ?, change_text = ?, purpose = ?, start_ref = ?, end_ref = ?,
        updated_at = datetime('now') WHERE id = ?
    `).run(parent, cleanTitle(title), cleanText(summary), cleanText(change), cleanText(purpose), startRef, parent ? (endRef || '') : '', arcId);
    if (!parent) setArcTitle(startRef, cleanTitle(title));
    db.exec('COMMIT');
    return {};
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function deleteArc(arcId) {
  const arc = db.prepare('SELECT * FROM story_arcs WHERE id = ?').get(arcId);
  if (!arc) return;
  db.exec('BEGIN');
  try {
    if (!arc.parent_id) setArcTitle(arc.start_ref, '');
    removeArc(arcId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const getArc = (arcId) => db.prepare('SELECT * FROM story_arcs WHERE id = ?').get(arcId) || null;

// ---------- planned chapters ----------

const getPlanSlot = (slotId) => db.prepare('SELECT * FROM story_plan_slots WHERE id = ?').get(slotId) || null;

// Makes room for a planned chapter straight after `ref` -- the start of
// the story (''), a chapter, or another planned chapter -- and says where
// that is, as an anchor and a position.
function placeAfter(storyId, ref) {
  const slot = /^p(\d+)$/.exec(ref || '');
  const chapter = /^c(\d+)$/.exec(ref || '');
  let anchor = null;
  let position = 0;
  if (slot) {
    const s = getPlanSlot(Number(slot[1]));
    if (!s || s.story_id !== storyId) return null;
    anchor = s.after_chapter_id;
    position = s.position + 1;
  } else if (chapter) {
    const c = db.prepare('SELECT id FROM chapters WHERE id = ? AND story_id = ?').get(Number(chapter[1]), storyId);
    if (!c) return null;
    anchor = c.id;
  } else if (ref) {
    return null;
  }
  db.prepare(`UPDATE story_plan_slots SET position = position + 1
    WHERE story_id = ? AND after_chapter_id IS ? AND position >= ?`).run(storyId, anchor, position);
  return { anchor, position };
}

/**
 * @param {{ storyId: number, title: string, notes?: string, afterRef?: string, userId?: number }} a
 * @returns {{ error?: string, id?: number }}
 */
function addPlanSlot({ storyId, title, notes, afterRef = '', userId }) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!clean) return { error: 'A planned chapter needs a title, even a working one.' };
  db.exec('BEGIN');
  try {
    const at = placeAfter(storyId, afterRef);
    if (!at) { db.exec('ROLLBACK'); return { error: 'Pick where it goes.' }; }
    const info = db.prepare(`
      INSERT INTO story_plan_slots (story_id, after_chapter_id, position, title, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)
    `).run(storyId, at.anchor, at.position, clean, cleanText(notes), userId || null);
    db.exec('COMMIT');
    return { id: Number(info.lastInsertRowid) };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function updatePlanSlot({ slotId, title, notes }) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!clean) return { error: 'A planned chapter needs a title, even a working one.' };
  db.prepare('UPDATE story_plan_slots SET title = ?, notes = ? WHERE id = ?').run(clean, cleanText(notes), slotId);
  return {};
}

// A planned chapter taken out of the plan. An arc that started on it now
// starts on whatever came next, and one that ended on it ends on whatever
// came before -- the arc is still there, a chapter shorter.
function deletePlanSlot(slotId) {
  const slot = getPlanSlot(slotId);
  if (!slot) return;
  const { items } = planItems(slot.story_id);
  const at = items.findIndex((i) => i.key === `p${slotId}`);
  const after = items[at + 1];
  const before = items[at - 1];
  db.exec('BEGIN');
  try {
    for (const arc of db.prepare('SELECT * FROM story_arcs WHERE story_id = ? AND (start_ref = ? OR end_ref = ?)').all(slot.story_id, `p${slotId}`, `p${slotId}`)) {
      if (arc.start_ref === `p${slotId}`) {
        if (!after) { removeArc(arc.id); continue; }
        db.prepare('UPDATE story_arcs SET start_ref = ? WHERE id = ?').run(after.key, arc.id);
        if (!arc.parent_id) setArcTitle(after.key, arc.title);
      }
      if (arc.end_ref === `p${slotId}`) {
        db.prepare('UPDATE story_arcs SET end_ref = ? WHERE id = ?').run(before && before.key !== arc.start_ref ? before.key : '', arc.id);
      }
    }
    db.prepare('DELETE FROM story_plan_slots WHERE id = ?').run(slotId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// One step up or down the running order. Past another planned chapter it
// is a swap; past a written one it changes which chapter it comes after --
// the written chapters themselves are moved on the outline, not here.
function movePlanSlot(slotId, direction) {
  const slot = getPlanSlot(slotId);
  if (!slot) return;
  const { items } = planItems(slot.story_id);
  const at = items.findIndex((i) => i.key === `p${slotId}`);
  const other = items[direction === 'up' ? at - 1 : at + 1];
  if (!other) return;
  db.exec('BEGIN');
  try {
    if (other.type === 'slot') {
      db.prepare('UPDATE story_plan_slots SET after_chapter_id = ?, position = ? WHERE id = ?').run(other.afterChapterId, other.position, slotId);
      db.prepare('UPDATE story_plan_slots SET after_chapter_id = ?, position = ? WHERE id = ?').run(slot.after_chapter_id, slot.position, other.id);
    } else if (direction === 'up') {
      // Above the chapter it was after: now after whatever that chapter
      // itself came after, as the last of the planned ones there.
      const chapterBefore = items.slice(0, at - 1).reverse().find((i) => i.type === 'chapter');
      const anchor = chapterBefore ? chapterBefore.id : null;
      const max = db.prepare('SELECT MAX(position) AS n FROM story_plan_slots WHERE story_id = ? AND after_chapter_id IS ?').get(slot.story_id, anchor).n;
      db.prepare('UPDATE story_plan_slots SET after_chapter_id = ?, position = ? WHERE id = ?').run(anchor, (max ?? -1) + 1, slotId);
    } else {
      // Below the next chapter: the first of the planned ones after it.
      const min = db.prepare('SELECT MIN(position) AS n FROM story_plan_slots WHERE story_id = ? AND after_chapter_id IS ?').get(slot.story_id, other.id).n;
      db.prepare('UPDATE story_plan_slots SET after_chapter_id = ?, position = ? WHERE id = ?').run(other.id, (min ?? 1) - 1, slotId);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Where the chapter a planned slot becomes goes in the running order, as
 * the new-chapter form's "Position" wants it: before the first chapter
 * still in the story that comes after the slot, or at the end.
 */
function planSlotPosition(slotId) {
  const slot = getPlanSlot(slotId);
  if (!slot) return 'end';
  const anchor = slot.after_chapter_id
    ? (db.prepare('SELECT chapter_number FROM chapters WHERE id = ?').get(slot.after_chapter_id) || { chapter_number: 0 }).chapter_number
    : 0;
  const next = db.prepare('SELECT chapter_number FROM chapters WHERE story_id = ? AND archived_at IS NULL AND chapter_number > ? ORDER BY chapter_number LIMIT 1')
    .get(slot.story_id, anchor);
  return next ? String(next.chapter_number) : 'end';
}

/**
 * The planned chapter has been written: it is a chapter now. The planned
 * ones that came after it come after the chapter, and every arc that
 * started or ended on it starts or ends on the chapter.
 * @param {number} slotId
 * @param {{ id: number, story_id: number }} chapter
 */
function planSlotWritten(slotId, chapter) {
  const slot = getPlanSlot(slotId);
  if (!slot || slot.story_id !== chapter.story_id) return;
  const was = `p${slotId}`;
  const now = `c${chapter.id}`;
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE story_plan_slots SET after_chapter_id = ? WHERE story_id = ? AND after_chapter_id IS ? AND position > ?')
      .run(chapter.id, slot.story_id, slot.after_chapter_id, slot.position);
    const opens = db.prepare('SELECT title FROM story_arcs WHERE story_id = ? AND parent_id IS NULL AND start_ref = ?').get(slot.story_id, was);
    db.prepare('UPDATE story_arcs SET start_ref = ? WHERE story_id = ? AND start_ref = ?').run(now, slot.story_id, was);
    db.prepare('UPDATE story_arcs SET end_ref = ? WHERE story_id = ? AND end_ref = ?').run(now, slot.story_id, was);
    if (opens) setArcTitle(now, opens.title);
    // The plan's notes stay with the chapter, for its writers.
    if (slot.notes) db.prepare('UPDATE chapters SET plan_notes = ? WHERE id = ?').run(slot.notes, chapter.id);
    db.prepare('DELETE FROM story_plan_slots WHERE id = ?').run(slotId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * A planned chapter being written: the draft is kept on the slot and is
 * its writer's alone until it is published. Saving an empty text lets go
 * of it, so somebody else can write it.
 * @param {number} slotId
 * @param {{ userId: number, title?: string, content?: string }} draft
 */
function savePlanDraft(slotId, { userId, title, content }) {
  const text = String(content || '').replace(/\r\n/g, '\n');
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  db.prepare(`UPDATE story_plan_slots SET title = COALESCE(NULLIF(?, ''), title), draft_content = ?, draft_by = ?,
    draft_updated_at = CASE WHEN ? = '' THEN NULL ELSE datetime('now') END WHERE id = ?`)
    .run(clean, text.trim() ? text : '', text.trim() ? userId : null, text.trim(), slotId);
}

// "Plan several at once": an outline pasted in, one chapter a line, with
// the lines under a title that start with a dash, a star or a space taken
// as its notes -- the shape an outline already has in a notes app.
/**
 * @param {string} text
 * @returns {{ title: string, notes: string }[]}
 */
function parseOutline(text) {
  const out = [];
  for (const raw of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    const beat = /^(\s+|\s*[-*•]\s)/.test(raw);
    if (beat && out.length) {
      const line = raw.replace(/^\s*[-*•]?\s*/, '').trim();
      const last = out[out.length - 1];
      last.notes = last.notes ? `${last.notes}\n${line}` : line;
    } else {
      const title = raw.replace(/^\s*[-*•]?\s*/, '').replace(/^\d+[.)]\s+/, '').trim();
      if (title) out.push({ title, notes: '' });
    }
  }
  return out.slice(0, 100);
}

/**
 * Several planned chapters from a pasted outline, in order, after `afterRef`.
 * @returns {{ error?: string, ids?: number[] }}
 */
function addPlanSlots({ storyId, text, afterRef = '', userId }) {
  const planned = parseOutline(text);
  if (!planned.length) return { error: 'Paste an outline: one chapter a line.' };
  const ids = [];
  let ref = afterRef;
  for (const p of planned) {
    const made = addPlanSlot({ storyId, title: p.title, notes: p.notes, afterRef: ref, userId });
    if (made.error) return ids.length ? { ids } : made;
    ids.push(made.id);
    ref = `p${made.id}`;
  }
  return { ids };
}

/** The arcs a chapter is in, outermost first, for the chapter page. */
const arcsOfChapter = (chapter) => arcsAt(chapter.story_id, `c${chapter.id}`);

/** The same for a chapter that is only planned, for its editor. */
const arcsOfPlanSlot = (slot) => arcsAt(slot.story_id, `p${slot.id}`);

function arcsAt(storyId, key) {
  const plan = storyPlan(storyId);
  const at = plan.items.findIndex((i) => i.key === key);
  if (at === -1) return [];
  const out = [];
  let level = plan.arcs;
  for (;;) {
    const arc = level.find((a) => a.start !== null && a.start <= at && at <= a.end);
    if (!arc) break;
    out.push({ id: arc.id, title: arc.title, label: arc.label, summary: arc.summary, change: arc.change_text });
    level = arc.children;
  }
  return out;
}

module.exports = {
  addArc,
  addPlanSlot,
  addPlanSlots,
  arcsOfChapter,
  arcsOfPlanSlot,
  parseOutline,
  savePlanDraft,
  deleteArc,
  deletePlanSlot,
  getArc,
  getPlanSlot,
  movePlanSlot,
  planItems,
  planSlotPosition,
  planSlotWritten,
  reconcileArcTitles,
  storyPlan,
  updateArc,
  updatePlanSlot,
};
