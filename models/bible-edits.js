'use strict';

// Changing a bible entry a piece at a time, and the parts of it that are
// about time: how somebody stands chapter by chapter, which chapters they
// are not in after all, and two entries that turn out to be one. The
// entry itself -- storing it, scanning for it -- is models/bible.js.

const { bible, castLinks, db } = require('./shared');
const {
  entitiesWithAliases, getStoryEntity, getStoryEntityByName, listEntityAliases, listEntityFields,
  queueStoryRescan, teachDictionary, updateStoryEntity,
} = require('./bible');

// ---------- changing one thing at a time ----------

const EDITABLE = ['name', 'summary', 'kind', 'role', 'status', 'aliases', 'any_case', 'match_parts'];

/**
 * One field of an entry, from wherever it is shown -- the entry's page,
 * the card beside a chapter. The same rules as the full form: a name must
 * be unique in the story, and a new name keeps the old one as an alias.
 * @param {number} entityId
 * @param {string} field
 * @param {any} value
 * @param {number} [userId]
 * @returns {{ entity?: any, error?: string }}
 */
function setEntityField(entityId, field, value, userId) {
  const entity = db.prepare('SELECT * FROM story_entities WHERE id = ?').get(entityId);
  if (!entity) return { error: 'Not in these story notes.' };
  if (!EDITABLE.includes(field)) return { error: 'That cannot be changed from here.' };
  const aliases = listEntityAliases(entityId);
  const base = {
    entityId, kind: entity.kind, name: entity.name, summary: entity.summary, description: entity.description,
    secret: entity.secret, status: entity.status, role: entity.role, aliases,
    fields: listEntityFields(entityId).map((f) => ({ label: String(f.label), value: String(f.value) })),
    userId, storyWhen: entity.story_when, storyDay: entity.story_day, storyDayEnd: entity.story_day_end,
  };
  if (field === 'any_case' || field === 'match_parts') {
    const on = value === true || value === 1 || value === '1' || value === 'on' || value === 'true';
    db.prepare(`UPDATE story_entities SET ${field} = ?, updated_at = datetime('now') WHERE id = ?`).run(on ? 1 : 0, entityId);
    castLinks.invalidate(entity.story_id);
    queueStoryRescan(entity.story_id);
    return { entity: getStoryEntity(entityId, { fresh: false }) };
  }
  if (field === 'name') {
    const clean = bible.cleanName(value);
    if (!clean) return { error: 'An entry needs a name.' };
    const clash = getStoryEntityByName(entity.story_id, clean);
    if (clash && clash.id !== entityId) return { error: `${clean} is already in the story notes.` };
    // An alias that is now the name is just the name.
    base.aliases = aliases.filter((a) => a.toLowerCase() !== clean.toLowerCase());
    base.name = clean;
  } else if (field === 'aliases') {
    base.aliases = bible.parseAliases(String(value || ''), entity.name);
  } else if (field === 'summary') {
    base.summary = String(value || '').trim().slice(0, 240);
  } else {
    base[field] = value;
  }
  return { entity: updateStoryEntity(base) };
}

function removeEntityAlias(entityId, alias) {
  const entity = db.prepare('SELECT id, story_id FROM story_entities WHERE id = ?').get(entityId);
  if (!entity) return;
  db.prepare('DELETE FROM story_entity_aliases WHERE entity_id = ? AND alias_lower = ?').run(entityId, bible.nameKey(alias));
  castLinks.invalidate(entity.story_id);
  queueStoryRescan(entity.story_id);
}

// ---------- "that is not them" ----------

/**
 * A word the scan found that is not this entry: an alias comes off, and a
 * part of the name ("Kessler") is put away for this entry only. The
 * entry's own name cannot be -- "not in this chapter" is the answer there.
 * @returns {{ removed?: 'alias'|'part', error?: string }}
 */
function blockEntityForm(entityId, form) {
  const entity = db.prepare('SELECT id, story_id, name_lower FROM story_entities WHERE id = ?').get(entityId);
  const key = bible.nameKey(form);
  if (!entity || !key) return { error: 'Which word?' };
  if (key === entity.name_lower) return { error: 'That is the name itself. Say it is not them in this chapter instead.' };
  const alias = db.prepare('SELECT 1 FROM story_entity_aliases WHERE entity_id = ? AND alias_lower = ?').get(entityId, key);
  if (alias) {
    removeEntityAlias(entityId, key);
    return { removed: 'alias' };
  }
  db.prepare('INSERT OR IGNORE INTO story_entity_blocked_forms (entity_id, story_id, form_lower) VALUES (?, ?, ?)')
    .run(entityId, entity.story_id, key);
  castLinks.invalidate(entity.story_id);
  queueStoryRescan(entity.story_id);
  return { removed: 'part' };
}

function unblockEntityForm(entityId, form) {
  const entity = db.prepare('SELECT id, story_id FROM story_entities WHERE id = ?').get(entityId);
  if (!entity) return;
  db.prepare('DELETE FROM story_entity_blocked_forms WHERE entity_id = ? AND form_lower = ?').run(entityId, bible.nameKey(form));
  castLinks.invalidate(entity.story_id);
  queueStoryRescan(entity.story_id);
}

/** The entries a chapter's author has said are not in it: not linked there either. */
const listChapterExclusions = (chapterId) => new Set(db.prepare(
  "SELECT entity_id FROM story_entity_appearance_overrides WHERE chapter_id = ? AND state = 'exclude'"
).all(chapterId).map((r) => Number(r.entity_id)));

/**
 * How the scan finds one entry, for its page: the names, the parts of the
 * name, and what was left out and why.
 */
function entityMatching(entityId) {
  const entity = db.prepare('SELECT story_id FROM story_entities WHERE id = ?').get(entityId);
  if (!entity) return null;
  const all = entitiesWithAliases(entity.story_id);
  const matcher = bible.buildMatcher(all);
  const info = matcher.forms.get(Number(entityId));
  if (!info) return null;
  const conflicts = matcher.conflicts
    .filter((c) => c.entityIds.includes(Number(entityId)))
    .map((c) => ({ name: c.name, others: c.entityIds.filter((id) => id !== Number(entityId)).map((id) => (all.find((e) => e.id === id) || { name: '?' }).name) }));
  const sharedWith = info.shared.map((part) => ({
    part,
    others: all.filter((e) => e.id !== Number(entityId) && (matcher.forms.get(e.id) || { shared: [] }).shared.includes(part)).map((e) => e.name),
  }));
  return { ...info, conflicts, sharedWith };
}

// ---------- how somebody stands, chapter by chapter ----------

/** The changes to one entry's status, in story order. */
const listStatusChanges = (entityId) => db.prepare(`
  SELECT sc.id, sc.status, sc.chapter_id, ch.chapter_number, ch.title AS chapter_title
    FROM story_entity_status_changes sc JOIN chapters ch ON ch.id = sc.chapter_id
   WHERE sc.entity_id = ? AND ch.archived_at IS NULL
   ORDER BY ch.chapter_number
`).all(entityId);

/** Every change in a story at once, by entry, for a listing of the cast. */
function statusChangesForStory(storyId) {
  const byEntity = new Map();
  for (const row of db.prepare(`
    SELECT sc.entity_id, sc.status, ch.chapter_number
      FROM story_entity_status_changes sc JOIN chapters ch ON ch.id = sc.chapter_id
     WHERE sc.story_id = ? AND ch.archived_at IS NULL
     ORDER BY ch.chapter_number
  `).all(storyId)) {
    if (!byEntity.has(row.entity_id)) byEntity.set(row.entity_id, []);
    byEntity.get(row.entity_id).push({ status: row.status, chapter_number: row.chapter_number });
  }
  return byEntity;
}

/**
 * Status from a chapter on, or -- with no chapter -- at the start.
 * @param {{ entityId: number, status: string, chapterId?: number|null, userId?: number }} change
 */
function setEntityStatus({ entityId, status, chapterId, userId }) {
  const entity = db.prepare('SELECT id, story_id FROM story_entities WHERE id = ?').get(entityId);
  if (!entity) return null;
  const clean = bible.entityStatus(status);
  if (!chapterId) {
    db.prepare("UPDATE story_entities SET status = ?, updated_at = datetime('now') WHERE id = ?").run(clean, entityId);
    return true;
  }
  const chapter = db.prepare('SELECT id FROM chapters WHERE id = ? AND story_id = ?').get(chapterId, entity.story_id);
  if (!chapter) return null;
  db.prepare(`
    INSERT INTO story_entity_status_changes (entity_id, story_id, chapter_id, status, set_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(entity_id, chapter_id) DO UPDATE SET status = excluded.status, set_by = excluded.set_by
  `).run(entityId, entity.story_id, chapterId, clean, userId || null);
  db.prepare("UPDATE story_entities SET updated_at = datetime('now') WHERE id = ?").run(entityId);
  return true;
}

function removeStatusChange(entityId, changeId) {
  db.prepare('DELETE FROM story_entity_status_changes WHERE id = ? AND entity_id = ?').run(changeId, entityId);
}

/**
 * How far into a story somebody has read: the furthest chapter they have
 * opened. 0 if none. The status a reader sees stops here.
 */
function readerPosition(storyId, userId) {
  const row = db.prepare(`
    SELECT MAX(ch.chapter_number) AS n FROM chapter_reads r JOIN chapters ch ON ch.id = r.chapter_id
     WHERE ch.story_id = ? AND r.user_id = ? AND ch.archived_at IS NULL
  `).get(storyId, userId);
  return (row && row.n) || 0;
}

// ---------- two entries that were one all along ----------

/**
 * Folds `fromId` into `intoId`: its name becomes an alias, and its
 * aliases, appearances, corrections, relations, pictures, details and
 * status changes go with it. What both of them say, the one kept says;
 * what only the other one says is added.
 */
function mergeStoryEntities(fromId, intoId, userId) {
  const from = db.prepare('SELECT * FROM story_entities WHERE id = ?').get(fromId);
  const into = db.prepare('SELECT * FROM story_entities WHERE id = ?').get(intoId);
  if (!from || !into || from.id === into.id || from.story_id !== into.story_id) return null;
  const storyId = into.story_id;
  db.exec('BEGIN');
  try {
    const addAlias = db.prepare('INSERT OR IGNORE INTO story_entity_aliases (entity_id, story_id, alias, alias_lower) VALUES (?, ?, ?, ?)');
    for (const alias of [from.name, ...listEntityAliases(fromId)]) {
      if (alias.toLowerCase() !== into.name_lower) addAlias.run(intoId, storyId, alias, alias.toLowerCase());
    }
    db.prepare(`INSERT OR IGNORE INTO story_entity_blocked_forms (entity_id, story_id, form_lower)
                SELECT ?, story_id, form_lower FROM story_entity_blocked_forms WHERE entity_id = ?`).run(intoId, fromId);
    db.prepare(`INSERT OR IGNORE INTO story_entity_appearance_overrides (entity_id, chapter_id, state, set_by)
                SELECT ?, chapter_id, state, set_by FROM story_entity_appearance_overrides WHERE entity_id = ?`).run(intoId, fromId);
    db.prepare(`INSERT OR IGNORE INTO story_entity_status_changes (entity_id, story_id, chapter_id, status, set_by)
                SELECT ?, story_id, chapter_id, status, set_by FROM story_entity_status_changes WHERE entity_id = ?`).run(intoId, fromId);
    // Relations: re-pointed, except one between the two (which is now
    // one entry and itself) and one the kept entry already has.
    for (const link of db.prepare('SELECT * FROM story_entity_links WHERE from_id = ? OR to_id = ?').all(fromId, fromId)) {
      const other = link.from_id === fromId ? link.to_id : link.from_id;
      const dup = db.prepare('SELECT 1 FROM story_entity_links WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)')
        .get(intoId, other, other, intoId);
      if (other === intoId || dup) {
        db.prepare('DELETE FROM story_entity_links WHERE id = ?').run(link.id);
      } else {
        db.prepare('UPDATE story_entity_links SET from_id = ?, to_id = ? WHERE id = ?')
          .run(link.from_id === fromId ? intoId : link.from_id, link.to_id === fromId ? intoId : link.to_id, link.id);
      }
    }
    const offset = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM story_entity_images WHERE entity_id = ?').get(intoId).n;
    db.prepare('UPDATE story_entity_images SET entity_id = ?, position = position + ? WHERE entity_id = ?').run(intoId, offset, fromId);
    const have = new Set(listEntityFields(intoId).map((f) => f.label.toLowerCase()));
    const nextField = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM story_entity_fields WHERE entity_id = ?').get(intoId).n;
    listEntityFields(fromId).filter((f) => !have.has(f.label.toLowerCase())).forEach((f, i) => {
      db.prepare('INSERT OR IGNORE INTO story_entity_fields (entity_id, story_id, label, label_lower, value, position) VALUES (?, ?, ?, ?, ?, ?)')
        .run(intoId, storyId, f.label, f.label.toLowerCase(), f.value, nextField + i);
    });
    const joined = (a, b) => {
      if (!String(b || '').trim()) return a || '';
      if (!String(a || '').trim()) return b;
      return `${a}\n\n---\n\n*From ${from.name}:*\n\n${b}`;
    };
    db.prepare(`UPDATE story_entities SET
        summary = ?, description = ?, secret = ?, role = ?, status = ?,
        story_when = COALESCE(NULLIF(story_when, ''), ?),
        story_day_end = CASE WHEN story_day IS NULL THEN ? ELSE story_day_end END,
        story_day = COALESCE(story_day, ?),
        updated_at = datetime('now') WHERE id = ?`).run(
      into.summary || from.summary, joined(into.description, from.description), joined(into.secret, from.secret),
      into.role || from.role, into.status || from.status, from.story_when || '', from.story_day_end, from.story_day, intoId
    );
    db.prepare('DELETE FROM story_entities WHERE id = ?').run(fromId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  teachDictionary(storyId, [from.name], userId);
  castLinks.invalidate(storyId);
  queueStoryRescan(storyId);
  return getStoryEntity(intoId, { fresh: false });
}

module.exports = {
  blockEntityForm,
  entityMatching,
  listChapterExclusions,
  listStatusChanges,
  mergeStoryEntities,
  readerPosition,
  removeEntityAlias,
  removeStatusChange,
  setEntityField,
  setEntityStatus,
  statusChangesForStory,
  unblockEntityForm,
};
