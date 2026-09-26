'use strict';

const { bible, castLinks, cleanDay, cleanLabel, db, entityImages, getLatestVersion } = require('./shared');
const { addStoryDictionaryWord, getStoryDictionary } = require('./upkeep');
// Per story, not per site: the glossary is the shared universe's public
// account of things, and this is one author's private account of their own
// cast. They can disagree, and both can be right.

const APPEARANCE_COUNT_SQL = `
  (SELECT COUNT(*) FROM story_entity_chapters sc
     JOIN chapters ch ON ch.id = sc.chapter_id
    WHERE sc.entity_id = e.id AND ch.archived_at IS NULL)`;

const ENTITY_COLUMNS = `
  e.*, u.display_name AS created_by_name,
  (SELECT GROUP_CONCAT(a.alias, ', ') FROM story_entity_aliases a WHERE a.entity_id = e.id) AS alias_list,
  ${APPEARANCE_COUNT_SQL} AS appearances,
  (SELECT MIN(ch.chapter_number) FROM story_entity_chapters sc
     JOIN chapters ch ON ch.id = sc.chapter_id
    WHERE sc.entity_id = e.id AND ch.archived_at IS NULL) AS first_chapter,
  (SELECT MAX(ch.chapter_number) FROM story_entity_chapters sc
     JOIN chapters ch ON ch.id = sc.chapter_id
    WHERE sc.entity_id = e.id AND ch.archived_at IS NULL) AS last_chapter,
  (SELECT COUNT(*) FROM story_entity_links l WHERE l.from_id = e.id OR l.to_id = e.id) AS link_count`;

const ENTITY_SORTS = {
  name: 'e.name COLLATE NOCASE',
  // Most-present first, and the ones nobody has named yet last -- that
  // list is also a to-do list.
  appearances: `${APPEARANCE_COUNT_SQL} DESC, e.name COLLATE NOCASE`,
  // Main cast, then supporting, then the rest. The empty role sorts last
  // rather than first, which is what CASE is for.
  role: `CASE e.role WHEN 'main' THEN 0 WHEN 'supporting' THEN 1 WHEN 'minor' THEN 2 ELSE 3 END, e.name COLLATE NOCASE`,
  recent: 'e.updated_at DESC, e.name COLLATE NOCASE',
};


/**
 * Everything in one story's bible.
 * @param {number} storyId
 * @param {{ kind?: string, sort?: string }} [opts]
 */
function listStoryEntities(storyId, { kind, sort } = {}) {
  flushStoryRescan(storyId);
  const order = ENTITY_SORTS[sort] || ENTITY_SORTS.name;
  return db.prepare(`
    SELECT ${ENTITY_COLUMNS}
    FROM story_entities e LEFT JOIN users u ON u.id = e.created_by
    WHERE e.story_id = @storyId ${kind ? 'AND e.kind = @kind' : ''}
    ORDER BY ${order}
  `).all(kind ? { storyId, kind } : { storyId });
}

/**
 * One entry, with its counts. `fresh: false` skips waiting for a rescan
 * that is due: what a save hands back does not need its counts to be
 * right this instant, and waiting would make every save a rescan again.
 * @param {number} entityId
 * @param {{ fresh?: boolean }} [opts]
 */
function getStoryEntity(entityId, { fresh = true } = {}) {
  const owner = fresh ? db.prepare('SELECT story_id FROM story_entities WHERE id = ?').get(entityId) : null;
  if (owner) flushStoryRescan(owner.story_id);
  return db.prepare(`
    SELECT ${ENTITY_COLUMNS}, s.title AS story_title
    FROM story_entities e
    LEFT JOIN users u ON u.id = e.created_by
    JOIN stories s ON s.id = e.story_id
    WHERE e.id = ?
  `).get(entityId) || null;
}

const getStoryEntityByName = (storyId, name) => db.prepare(
  'SELECT id FROM story_entities WHERE story_id = ? AND name_lower = ?'
).get(storyId, bible.nameKey(name)) || null;

const listEntityAliases = (entityId) => db.prepare(
  'SELECT alias FROM story_entity_aliases WHERE entity_id = ? ORDER BY alias COLLATE NOCASE'
).all(entityId).map((r) => r.alias);


// How many of each kind, so the bible's front page can be a directory
// rather than a list -- the same reason the glossary's is.
function storyBibleCounts(storyId) {
  const rows = db.prepare(
    'SELECT kind, COUNT(*) AS n FROM story_entities WHERE story_id = ? GROUP BY kind'
  ).all(storyId);
  const counts = Object.fromEntries(bible.KINDS.map((k) => [k, 0]));
  let total = 0;
  for (const row of rows) {
    if (counts[row.kind] === undefined) continue;
    counts[row.kind] = row.n;
    total += row.n;
  }
  return { counts, total };
}


// The names two entries both answer to. Nothing is scanned for them (see
// buildMatcher), so the bible says so out loud instead of quietly losing
// appearances.
function storyBibleNameConflicts(storyId) {
  const entities = entitiesWithAliases(storyId);
  return bible.buildMatcher(entities).conflicts.map((conflict) => ({
    name: conflict.name,
    entities: conflict.entityIds
      .map((id) => entities.find((e) => e.id === id))
      .filter(Boolean)
      .map((e) => ({ id: e.id, name: e.name })),
  }));
}


/**
 * Everything the scan needs to know about each entry: what it is called,
 * what kind it is (people are also found by the parts of their name), how
 * strictly, and the words it has been told are not it.
 * @returns {{id: number, name: string, kind: string, summary: string, any_case: number, match_parts: number, aliases: string[], blocked: string[]}[]}
 */
function entitiesWithAliases(storyId) {
  const entities = db.prepare(
    'SELECT id, name, kind, summary, any_case, match_parts FROM story_entities WHERE story_id = ?'
  ).all(storyId).map((e) => ({
    id: Number(e.id), name: String(e.name), kind: String(e.kind), summary: String(e.summary || ''),
    any_case: Number(e.any_case) || 0, match_parts: e.match_parts == null ? 1 : Number(e.match_parts),
    aliases: /** @type {string[]} */ ([]), blocked: /** @type {string[]} */ ([]),
  }));
  const byId = new Map(entities.map((e) => [e.id, e]));
  for (const row of db.prepare(
    'SELECT entity_id, alias FROM story_entity_aliases WHERE story_id = ?'
  ).all(storyId)) {
    const entity = byId.get(row.entity_id);
    if (entity) entity.aliases.push(row.alias);
  }
  for (const row of db.prepare(
    'SELECT entity_id, form_lower FROM story_entity_blocked_forms WHERE story_id = ?'
  ).all(storyId)) {
    const entity = byId.get(row.entity_id);
    if (entity) entity.blocked.push(row.form_lower);
  }
  return entities;
}

// ---------- rescanning, later and once ----------

// Every change to a name used to rescan the whole story there and then,
// on the request -- so writing down thirty names from a chapter was
// thirty full rescans. Now a change asks for one, a moment later, and a
// burst of changes is one rescan. Anything that reads appearances asks
// for a waiting rescan to happen first, so nothing ever reads a stale list.
//
// Under test the rescan happens at once: the suite reads the database from
// another process, which cannot ask this one to catch up.
const RESCAN_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 400;
const pendingRescans = new Map();
function queueStoryRescan(storyId) {
  const key = Number(storyId);
  if (!RESCAN_DELAY_MS) { rebuildStoryAppearances(key); return; }
  if (pendingRescans.has(key)) return;
  const timer = setTimeout(() => {
    pendingRescans.delete(key);
    try { rebuildStoryAppearances(key); } catch (err) { console.error('bible rescan failed:', err.message); }
  }, RESCAN_DELAY_MS);
  if (timer.unref) timer.unref();
  pendingRescans.set(key, timer);
}

function flushStoryRescan(storyId) {
  const key = Number(storyId);
  const timer = pendingRescans.get(key);
  if (!timer) return;
  clearTimeout(timer);
  pendingRescans.delete(key);
  rebuildStoryAppearances(key);
}

function writeAliases(entityId, storyId, aliases) {
  db.prepare('DELETE FROM story_entity_aliases WHERE entity_id = ?').run(entityId);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO story_entity_aliases (entity_id, story_id, alias, alias_lower) VALUES (?, ?, ?, ?)'
  );
  for (const alias of aliases) insert.run(entityId, storyId, alias, alias.toLowerCase());
}


// A name the author has written down is a name the spellchecker should
// stop underlining. Cheap to do here, and it is the thing everybody forgets
// to do by hand.
function teachDictionary(storyId, names, userId) {
  for (const name of names) {
    for (const word of String(name).split(/[^\p{L}\p{N}'’-]+/u)) {
      if (word.length >= 3 && /\p{L}/u.test(word)) addStoryDictionaryWord(storyId, word, userId);
    }
  }
}


// The last day of something that lasts: only with a first day, only after
// it, and nothing at all for a single moment.
function dayEnd(start, end) {
  const from = cleanDay(start);
  const to = cleanDay(end);
  return from === null || to === null || to <= from ? null : to;
}

/** @param {{ storyId: number, kind?: string, name: string, summary?: string, description?: string, secret?: string, status?: string, role?: string, aliases?: string[], fields?: {label: string, value: string}[], createdBy: number , storyWhen?: string, storyDay?: string|number|null, storyDayEnd?: string|number|null }} entry */
function createStoryEntity({ storyId, kind, name, summary, description, secret, status, role, aliases, fields, createdBy, storyWhen, storyDay, storyDayEnd }) {
  const clean = bible.cleanName(name);
  if (!clean) return null;
  const list = (aliases || []).map(bible.cleanName).filter(Boolean);
  let entityId;
  db.exec('BEGIN');
  try {
    const info = db.prepare(`
      INSERT INTO story_entities (story_id, kind, name, name_lower, summary, description, secret, status, role, created_by, story_when, story_day, story_day_end)
      VALUES (@storyId, @kind, @name, @nameLower, @summary, @description, @secret, @status, @role, @createdBy, @storyWhen, @storyDay, @storyDayEnd)
    `).run({
      storyId,
      kind: bible.entityKind(kind),
      name: clean,
      nameLower: clean.toLowerCase(),
      summary: String(summary || '').trim(),
      description: String(description || ''),
      secret: String(secret || ''),
      status: bible.entityStatus(status),
      role: bible.entityRole(role),
      createdBy: createdBy || null,
      storyWhen: cleanLabel(storyWhen),
      storyDay: cleanDay(storyDay),
      storyDayEnd: dayEnd(storyDay, storyDayEnd),
    });
    entityId = Number(info.lastInsertRowid);
    writeAliases(entityId, storyId, list);
    writeEntityFields(entityId, storyId, fields);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  // Same as the update below: after the commit there is nothing to roll
  // back, so these stay outside the try.
  teachDictionary(storyId, [clean, ...list], createdBy);
  castLinks.invalidate(storyId);
  queueStoryRescan(storyId);
  return getStoryEntity(entityId, { fresh: false });
}


/** @param {{ entityId: number, kind?: string, name: string, summary?: string, description?: string, secret?: string, status?: string, role?: string, aliases?: string[], fields?: {label: string, value: string}[], userId?: number , storyWhen?: string, storyDay?: string|number|null, storyDayEnd?: string|number|null }} entry */
function updateStoryEntity({ entityId, kind, name, summary, description, secret, status, role, aliases, fields, userId, storyWhen, storyDay, storyDayEnd }) {
  const current = db.prepare('SELECT id, story_id, name, name_lower FROM story_entities WHERE id = ?').get(entityId);
  if (!current) return null;
  const clean = bible.cleanName(name);
  if (!clean) return null;
  const list = (aliases || []).map(bible.cleanName).filter(Boolean);
  // A new name does not unsay the old one: the chapters already written
  // still call them that, so the old name stays on as an alias.
  if (clean.toLowerCase() !== current.name_lower && !list.some((a) => a.toLowerCase() === current.name_lower)) {
    list.push(current.name);
  }
  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE story_entities SET
        kind = @kind, name = @name, name_lower = @nameLower, summary = @summary,
        description = @description, secret = @secret, status = @status, role = @role,
        story_when = @storyWhen, story_day = @storyDay, story_day_end = @storyDayEnd,
        updated_at = datetime('now')
      WHERE id = @entityId
    `).run({
      entityId,
      kind: bible.entityKind(kind),
      name: clean,
      nameLower: clean.toLowerCase(),
      summary: String(summary || '').trim(),
      description: String(description || ''),
      secret: String(secret || ''),
      status: bible.entityStatus(status),
      role: bible.entityRole(role),
      storyWhen: cleanLabel(storyWhen),
      storyDay: cleanDay(storyDay),
      storyDayEnd: dayEnd(storyDay, storyDayEnd),
    });
    writeAliases(entityId, current.story_id, list);
    writeEntityFields(entityId, current.story_id, fields);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  // Outside the try on purpose. These run after the commit, so a failure
  // here has nothing to roll back -- and a ROLLBACK with no transaction
  // open throws a second error on top of the first, which is how a real
  // one goes missing.
  teachDictionary(current.story_id, [clean, ...list], userId);
  castLinks.invalidate(current.story_id);
  queueStoryRescan(current.story_id);
  return getStoryEntity(entityId, { fresh: false });
}


// Deleting an entry takes its aliases, its half of every relation and its
// appearances with it -- all four tables cascade from story_entities, so
// this is one statement and no orphans.
function deleteStoryEntity(entityId) {
  const row = db.prepare('SELECT id, story_id, name FROM story_entities WHERE id = ?').get(entityId);
  if (!row) return null;
  // The rows cascade; the files do not. Collect them before the row that
  // names them is gone.
  const files = listEntityImages(entityId).map((image) => image.filename);
  db.prepare('DELETE FROM story_entities WHERE id = ?').run(entityId);
  castLinks.invalidate(row.story_id);
  for (const filename of files) entityImages.removeImage(filename);
  return row;
}




// ---------- names the app already recognises ----------

// The bible's own names and aliases, the glossary's page titles, the
// story's spelling dictionary and the words its authors have said are not
// names, folded down -- everything a proper name found in a chapter might
// already be accounted for by.
function knownNamesFor(storyId) {
  const known = new Set();
  for (const row of db.prepare('SELECT name_lower FROM story_not_names WHERE story_id = ?').all(storyId)) known.add(row.name_lower);
  // Every form the scan finds an entry by -- names, aliases, the parts of
  // a person's name, and the parts two people share, which are known even
  // if they are nobody's in particular.
  const entities = entitiesWithAliases(storyId);
  for (const [, info] of bible.buildMatcher(entities).forms) {
    for (const n of info.names) known.add(n.toLowerCase());
    for (const n of info.parts) known.add(n.toLowerCase());
    for (const n of info.shared) known.add(n);
  }
  for (const word of getStoryDictionary(storyId)) known.add(String(word).toLowerCase());
  return known;
}

// The glossary's titles. Not "known": a character of yours can share a
// name with the wiki, so these are still offered, marked as the glossary's.
const glossaryTitles = () => new Set(
  db.prepare('SELECT title_lower FROM wiki_pages WHERE story_id IS NULL').all().map((r) => r.title_lower)
);


// ---------- another name for somebody already written down ----------

/** "Colonel Jack" is Jack: add it to his aliases. Returns the entry. */
function addEntityAlias(entityId, alias, userId) {
  const entity = db.prepare('SELECT id, story_id, name_lower FROM story_entities WHERE id = ?').get(entityId);
  const clean = bible.cleanName(alias);
  if (!entity || !clean) return null;
  if (clean.toLowerCase() !== entity.name_lower) {
    db.prepare(
      'INSERT OR IGNORE INTO story_entity_aliases (entity_id, story_id, alias, alias_lower) VALUES (?, ?, ?, ?)'
    ).run(entityId, entity.story_id, clean, clean.toLowerCase());
  }
  // A form it had been told was not it, it is again.
  db.prepare('DELETE FROM story_entity_blocked_forms WHERE entity_id = ? AND form_lower = ?').run(entityId, clean.toLowerCase());
  teachDictionary(entity.story_id, [clean], userId);
  castLinks.invalidate(entity.story_id);
  queueStoryRescan(entity.story_id);
  return getStoryEntity(entityId, { fresh: false });
}


// ---------- "not a name": a false alarm, put down once ----------

/** Stop offering this word as a name in this story. Returns the row. */
function addNotName(storyId, name, userId) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!clean) return null;
  db.prepare(
    'INSERT OR IGNORE INTO story_not_names (story_id, name, name_lower, added_by) VALUES (?, ?, ?, ?)'
  ).run(storyId, clean, clean.toLowerCase(), userId || null);
  return db.prepare('SELECT * FROM story_not_names WHERE story_id = ? AND name_lower = ?').get(storyId, clean.toLowerCase());
}

const listNotNames = (storyId) => db.prepare(
  'SELECT id, name FROM story_not_names WHERE story_id = ? ORDER BY name COLLATE NOCASE'
).all(storyId);

/** Offer it again. */
function removeNotName(storyId, id) {
  db.prepare('DELETE FROM story_not_names WHERE story_id = ? AND id = ?').run(storyId, id);
}


/**
 * Proper names in one chapter's current text that nothing accounts for.
 * A suggestion, never an action: the author clicks, or does not.
 */
function missingNamesInChapter(chapterId) {
  const chapter = db.prepare('SELECT id, story_id FROM chapters WHERE id = ?').get(chapterId);
  if (!chapter) return [];
  const version = getLatestVersion(chapterId);
  if (!version) return [];
  return bible.findProperNames(version.content, knownNamesFor(chapter.story_id), { glossary: glossaryTitles() });
}


/** The same question about text that has not been saved yet. */
const missingNamesInText = (storyId, text) => bible.findProperNames(text, knownNamesFor(storyId), { glossary: glossaryTitles() });

// ---------- custom fields: the story's template, and what each entry says ----------

const listFieldTemplate = (storyId, kind) => db.prepare(
  'SELECT label FROM story_field_templates WHERE story_id = ? AND kind = ? ORDER BY position, id'
).all(storyId, kind).map((r) => r.label);


/** The whole template, by kind, for the editor that sets it. */
function fieldTemplatesByKind(storyId) {
  const out = Object.fromEntries(bible.KINDS.map((k) => [k, []]));
  for (const row of db.prepare(
    'SELECT kind, label FROM story_field_templates WHERE story_id = ? ORDER BY kind, position, id'
  ).all(storyId)) {
    if (out[row.kind]) out[row.kind].push(row.label);
  }
  return out;
}


// The template is replaced wholesale rather than diffed: it is a short
// ordered list, and rewriting it is how a reordering is expressed. What
// entries already say is untouched -- a label dropped from the template
// becomes an extra on the entries that answered it, rather than deleting
// what somebody wrote.
function setFieldTemplate(storyId, kind, labels) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM story_field_templates WHERE story_id = ? AND kind = ?').run(storyId, bible.entityKind(kind));
    const insert = db.prepare(
      'INSERT OR IGNORE INTO story_field_templates (story_id, kind, label, label_lower, position) VALUES (?, ?, ?, ?, ?)'
    );
    labels.forEach((label, i) => insert.run(storyId, bible.entityKind(kind), label, label.toLowerCase(), i));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const listEntityFields = (entityId) => db.prepare(
  'SELECT label, value FROM story_entity_fields WHERE entity_id = ? ORDER BY position, id'
).all(entityId);


/**
 * What an entry says, in the order the template asks for it, then its own
 * extras. Empty template slots are left out: the entry page shows what is
 * known, and the form is where the blanks live.
 */
function entityFieldsInOrder(entityId, storyId, kind) {
  const template = listFieldTemplate(storyId, kind);
  const fields = listEntityFields(entityId);
  const byLabel = new Map(fields.map((f) => [f.label.toLowerCase(), f]));
  const ordered = [];
  for (const label of template) {
    const field = byLabel.get(label.toLowerCase());
    if (field) { ordered.push(field); byLabel.delete(label.toLowerCase()); }
  }
  for (const field of fields) if (byLabel.has(field.label.toLowerCase())) ordered.push(field);
  return ordered;
}

function writeEntityFields(entityId, storyId, fields) {
  db.prepare('DELETE FROM story_entity_fields WHERE entity_id = ?').run(entityId);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO story_entity_fields (entity_id, story_id, label, label_lower, value, position) VALUES (?, ?, ?, ?, ?, ?)'
  );
  (fields || []).forEach((field, i) => insert.run(entityId, storyId, field.label, field.label.toLowerCase(), field.value, i));
}


// Every label anybody in this story has used, commonest first -- the
// suggestions behind the label box, so "Rank" gets reused instead of
// reinvented as "Grade".
const listUsedFieldLabels = (storyId) => db.prepare(`
  SELECT label, COUNT(*) AS n FROM story_entity_fields WHERE story_id = ?
  GROUP BY label_lower ORDER BY n DESC, label COLLATE NOCASE LIMIT 60
`).all(storyId).map((r) => r.label);

// ---------- pictures of an entry (see lib/entity-images.js) ----------

const listEntityImages = (entityId) => db.prepare(
  'SELECT * FROM story_entity_images WHERE entity_id = ? ORDER BY position, id'
).all(entityId);

const getEntityImage = (imageId) => db.prepare(`
  SELECT i.*, e.story_id AS entity_story_id
  FROM story_entity_images i JOIN story_entities e ON e.id = i.entity_id
  WHERE i.id = ?
`).get(imageId) || null;


// The face of each entry in one query, so a listing of the whole cast does
// not ask the database once per row.
function coverImagesFor(storyId) {
  const rows = db.prepare(`
    SELECT i.entity_id, i.id, i.content_type, i.focus_x, i.focus_y
    FROM story_entity_images i
    WHERE i.story_id = ? AND i.position = (
      SELECT MIN(i2.position) FROM story_entity_images i2 WHERE i2.entity_id = i.entity_id
    )
    GROUP BY i.entity_id
  `).all(storyId);
  return new Map(rows.map((r) => [r.entity_id, { id: r.id, focusX: r.focus_x, focusY: r.focus_y }]));
}


/** @param {{ entityId: number, storyId: number, filename: string, contentType: string, bytes: number, caption?: string, uploadedBy?: number }} fields */
function addEntityImage({ entityId, storyId, filename, contentType, bytes, caption, uploadedBy }) {
  const next = db.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM story_entity_images WHERE entity_id = ?'
  ).get(entityId).n;
  const info = db.prepare(`
    INSERT INTO story_entity_images (entity_id, story_id, filename, content_type, bytes, caption, position, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(entityId, storyId, filename, contentType, bytes || 0, String(caption || '').trim().slice(0, 240), next, uploadedBy || null);
  return Number(info.lastInsertRowid);
}


// The crop point, as two percentages. Anything that is not a number, or
// is outside the picture, is not a correction -- it is a mistake, and the
// middle is a better answer than the edge.
function setEntityImageFocus(imageId, x, y) {
  const clamp = (value) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return 50;
    return Math.min(100, Math.max(0, n));
  };
  db.prepare('UPDATE story_entity_images SET focus_x = ?, focus_y = ? WHERE id = ?')
    .run(clamp(x), clamp(y), imageId);
}

function setEntityImageCaption(imageId, caption) {
  db.prepare('UPDATE story_entity_images SET caption = ? WHERE id = ?')
    .run(String(caption || '').trim().slice(0, 240), imageId);
}


// Moving one picture is a swap with its neighbour, and the positions are
// renumbered first so a gallery that has had things deleted out of it
// still has neighbours to swap with.
function moveEntityImage(imageId, direction) {
  const image = getEntityImage(imageId);
  if (!image) return;
  const all = listEntityImages(image.entity_id);
  const renumber = db.prepare('UPDATE story_entity_images SET position = ? WHERE id = ?');
  all.forEach((row, i) => renumber.run(i, row.id));
  const index = all.findIndex((row) => row.id === image.id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= all.length) return;
  renumber.run(target, all[index].id);
  renumber.run(index, all[target].id);
}


// The row goes, and so does the file: an orphaned picture on disk is
// invisible, permanent and somebody's face.
function removeEntityImage(imageId) {
  const image = getEntityImage(imageId);
  if (!image) return;
  db.prepare('DELETE FROM story_entity_images WHERE id = ?').run(imageId);
  entityImages.removeImage(image.filename);
}

// ---------- relations ----------

// Stored once, read from both ends. `label` is how the near end describes
// it and `reverse_label` how the far end does; leaving the reverse blank
// means the same word works both ways.
/** @param {{ storyId: number, fromId: number, toId: number, label?: string, reverseLabel?: string }} fields */
function setStoryEntityLink({ storyId, fromId, toId, label, reverseLabel }) {
  if (!fromId || !toId || fromId === toId) return null;
  const ends = db.prepare(
    `SELECT id FROM story_entities WHERE story_id = ? AND id IN (?, ?)`
  ).all(storyId, fromId, toId);
  if (ends.length !== 2) return null;
  // The pair is unique whichever way round it was typed, so re-linking two
  // entries edits the relation that already exists instead of growing a
  // mirror image of it that the two pages would then disagree about.
  const existing = db.prepare(
    'SELECT id, from_id FROM story_entity_links WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)'
  ).get(fromId, toId, toId, fromId);
  const near = String(label || '').trim().slice(0, 80);
  const far = String(reverseLabel || '').trim().slice(0, 80);
  if (existing) {
    const flipped = existing.from_id !== fromId;
    db.prepare('UPDATE story_entity_links SET label = ?, reverse_label = ? WHERE id = ?')
      .run(flipped ? far : near, flipped ? near : far, existing.id);
    return existing.id;
  }
  const info = db.prepare(
    'INSERT INTO story_entity_links (story_id, from_id, to_id, label, reverse_label) VALUES (?, ?, ?, ?, ?)'
  ).run(storyId, fromId, toId, near, far);
  return Number(info.lastInsertRowid);
}

function removeStoryEntityLink(linkId, storyId) {
  db.prepare('DELETE FROM story_entity_links WHERE id = ? AND story_id = ?').run(linkId, storyId);
}


/** Both halves of every relation this entry is an end of, already turned round. */
function listStoryEntityLinks(entityId) {
  return db.prepare(`
    SELECT l.id, l.label AS label, e.id AS other_id, e.name AS other_name, e.kind AS other_kind, e.summary AS other_summary
      FROM story_entity_links l JOIN story_entities e ON e.id = l.to_id
     WHERE l.from_id = @entityId
    UNION ALL
    SELECT l.id, l.reverse_label AS label, e.id AS other_id, e.name AS other_name, e.kind AS other_kind, e.summary AS other_summary
      FROM story_entity_links l JOIN story_entities e ON e.id = l.from_id
     WHERE l.to_id = @entityId
    ORDER BY other_name COLLATE NOCASE
  `).all({ entityId });
}

// ---------- appearances ----------

// Before reading appearances through a row of this table: any rescan its
// story is waiting for. Returns nothing, so it sits in front of a query.
function flushFor(table, id) {
  const row = db.prepare(`SELECT story_id FROM ${table === 'chapters' ? 'chapters' : 'story_entities'} WHERE id = ?`).get(id);
  if (row) flushStoryRescan(row.story_id);
  return null;
}

// The cache is rebuilt, never patched: a rebuild is one regex pass over
// the story's current text, and a patch is a chance to leave a stale row
// behind after a rename.
function rebuildStoryAppearances(storyId) {
  const entities = entitiesWithAliases(storyId);
  db.prepare('DELETE FROM story_entity_appearances WHERE story_id = ?').run(storyId);
  if (!entities.length) return { rows: 0 };
  const chapters = db.prepare(`
    SELECT c.id, v.content FROM chapters c
    JOIN chapter_versions v ON v.chapter_id = c.id
    WHERE c.story_id = ?
      AND v.version_number = (SELECT MAX(v2.version_number) FROM chapter_versions v2 WHERE v2.chapter_id = c.id)
  `).all(storyId);
  const { rows } = bible.scanStory(
    chapters.map((c) => ({ id: Number(c.id), content: String(c.content) })), entities
  );
  const insert = db.prepare(
    'INSERT OR REPLACE INTO story_entity_appearances (entity_id, chapter_id, story_id, mentions, first_name) VALUES (?, ?, ?, ?, ?)'
  );
  db.exec('BEGIN');
  try {
    for (const row of rows) insert.run(row.entityId, row.chapterId, storyId, row.mentions, row.firstName);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { rows: rows.length };
}


// One chapter changed, so only that chapter is rescanned. The whole-story
// rebuild is for when the names themselves move.
function rebuildChapterAppearances(chapterId) {
  const chapter = db.prepare('SELECT id, story_id FROM chapters WHERE id = ?').get(chapterId);
  if (!chapter) return;
  const entities = entitiesWithAliases(chapter.story_id);
  db.prepare('DELETE FROM story_entity_appearances WHERE chapter_id = ?').run(chapterId);
  if (!entities.length) return;
  const version = getLatestVersion(chapterId);
  if (!version) return;
  const { rows } = bible.scanStory([{ id: chapterId, content: version.content }], entities);
  const insert = db.prepare(
    'INSERT OR REPLACE INTO story_entity_appearances (entity_id, chapter_id, story_id, mentions, first_name) VALUES (?, ?, ?, ?, ?)'
  );
  for (const row of rows) insert.run(row.entityId, chapterId, chapter.story_id, row.mentions, row.firstName);
}


/** Which chapters one entry is in, scan and corrections already resolved. */
const listEntityAppearances = (entityId) => flushFor('story_entities', entityId) || db.prepare(`
  SELECT ch.id AS chapter_id, ch.chapter_number, ch.title, ch.archived_at,
         sc.mentions, sc.first_name, sc.source
    FROM story_entity_chapters sc
    JOIN chapters ch ON ch.id = sc.chapter_id
   WHERE sc.entity_id = ?
   ORDER BY ch.chapter_number
`).all(entityId);


/** Who is in one chapter -- the other way round the same view. */
const listChapterEntities = (chapterId) => flushFor('chapters', chapterId) || db.prepare(`
  SELECT e.id, e.name, e.kind, e.summary, sc.mentions, sc.source,
    (SELECT MIN(ch.chapter_number) FROM story_entity_chapters sc2
       JOIN chapters ch ON ch.id = sc2.chapter_id
      WHERE sc2.entity_id = e.id AND ch.archived_at IS NULL) AS first_chapter,
    (SELECT ch2.chapter_number FROM chapters ch2 WHERE ch2.id = sc.chapter_id) AS this_chapter
    FROM story_entity_chapters sc
    JOIN story_entities e ON e.id = sc.entity_id
   WHERE sc.chapter_id = ?
   ORDER BY sc.mentions DESC, e.name COLLATE NOCASE
`).all(chapterId);


/**
 * The author overruling the scan for one chapter. 'auto' clears the
 * override and lets the text speak again.
 * @param {{ entityId: number, chapterId: number, state: string, userId?: number }} fields
 */
function setAppearanceOverride({ entityId, chapterId, state, userId }) {
  if (state !== 'include' && state !== 'exclude') {
    db.prepare('DELETE FROM story_entity_appearance_overrides WHERE entity_id = ? AND chapter_id = ?')
      .run(entityId, chapterId);
    return;
  }
  db.prepare(`
    INSERT INTO story_entity_appearance_overrides (entity_id, chapter_id, state, set_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(entity_id, chapter_id) DO UPDATE SET state = excluded.state, set_by = excluded.set_by
  `).run(entityId, chapterId, state, userId || null);
}


/** Chapters of a story, for the appearance editor's list of everything. */
const listChapterStubs = (storyId) => db.prepare(
  'SELECT id, chapter_number, title, archived_at FROM chapters WHERE story_id = ? ORDER BY chapter_number'
).all(storyId);

module.exports = {
  flushStoryRescan,
  queueStoryRescan,
  APPEARANCE_COUNT_SQL,
  ENTITY_COLUMNS,
  ENTITY_SORTS,
  addEntityAlias,
  addEntityImage,
  addNotName,
  coverImagesFor,
  createStoryEntity,
  deleteStoryEntity,
  entitiesWithAliases,
  entityFieldsInOrder,
  fieldTemplatesByKind,
  getEntityImage,
  getStoryEntity,
  getStoryEntityByName,
  knownNamesFor,
  listChapterEntities,
  listChapterStubs,
  listEntityAliases,
  listEntityAppearances,
  listEntityFields,
  listEntityImages,
  listFieldTemplate,
  listNotNames,
  listStoryEntities,
  listStoryEntityLinks,
  listUsedFieldLabels,
  missingNamesInChapter,
  missingNamesInText,
  moveEntityImage,
  rebuildChapterAppearances,
  rebuildStoryAppearances,
  removeEntityImage,
  removeNotName,
  removeStoryEntityLink,
  setAppearanceOverride,
  setEntityImageCaption,
  setEntityImageFocus,
  setFieldTemplate,
  setStoryEntityLink,
  storyBibleCounts,
  storyBibleNameConflicts,
  teachDictionary,
  updateStoryEntity,
  writeAliases,
  writeEntityFields,
};
