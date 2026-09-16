'use strict';

const { CHOOSABLE_STORY_STATES } = require('../lib/story-state');
const { db } = require('./shared');
const { getStoryById } = require('./stories');
function slugifyTag(name) {
  return String(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tag';
}


// Every tag, with how many live stories carry it -- the count is what
// makes the admin list honest about what deleting one would affect.
function listTags() {
  return db.prepare(`
    SELECT t.*, u.display_name AS proposed_by_name,
      (SELECT COUNT(*) FROM story_tags st JOIN stories s ON s.id = st.story_id
        WHERE st.tag_id = t.id AND s.archived_at IS NULL) AS story_count
    FROM tags t
    LEFT JOIN users u ON u.id = t.proposed_by
    ORDER BY t.tag_group COLLATE NOCASE, t.name COLLATE NOCASE
  `).all();
}


// The queue an admin works through on /admin.
function listProposedTags() {
  return listTags().filter((t) => t.status === 'proposed');
}


// An author proposing a tag from inside a story form. A name that already
// exists just resolves to that tag -- proposing "Space" when Space is
// already in the vocabulary should tag the story with Space, not create a
// second one, and must never knock an approved tag back into the queue.
function proposeTag({ name, userId }) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const existing = db.prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE').get(clean);
  if (existing) return existing;
  let slug = slugifyTag(clean);
  if (getTagBySlug(slug)) slug = `${slug}-${Date.now().toString(36)}`;
  const info = db.prepare(
    "INSERT INTO tags (name, slug, tag_group, description, status, proposed_by) VALUES (?, ?, 'Proposed', '', 'proposed', ?)"
  ).run(clean, slug, userId || null);
  return getTagById(Number(info.lastInsertRowid));
}


/**
 * @param {number} id
 * @param {{ name?: string, group?: string }} [edits]
 */
function approveTag(id, { name, group } = {}) {
  const tag = getTagById(id);
  if (!tag) return null;
  const clean = String(name || '').trim() || tag.name;
  const clash = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id <> ?').get(clean, id);
  db.prepare("UPDATE tags SET name = ?, tag_group = ?, status = 'approved', proposed_by = NULL WHERE id = ?")
    .run(clash ? tag.name : clean, String(group || '').trim() || 'Other', id);
  return getTagById(id);
}


// Folds one tag into another: every story on `fromId` gains `intoId`, and
// the old tag goes. This is what an admin reaches for when someone
// proposes "Sci-Fi" and "Science fiction" already exists -- the proposal
// isn't wrong, it's just already spelled another way, and the stories
// carrying it shouldn't lose the label.
function mergeTag(fromId, intoId) {
  const from = getTagById(fromId);
  const into = getTagById(intoId);
  if (!from || !into || from.id === into.id) return null;
  db.exec('BEGIN');
  try {
    db.prepare('INSERT OR IGNORE INTO story_tags (story_id, tag_id) SELECT story_id, ? FROM story_tags WHERE tag_id = ?')
      .run(into.id, from.id);
    db.prepare('INSERT OR IGNORE INTO user_hidden_tags (user_id, tag_id) SELECT user_id, ? FROM user_hidden_tags WHERE tag_id = ?')
      .run(into.id, from.id);
    db.prepare('DELETE FROM story_tags WHERE tag_id = ?').run(from.id);
    db.prepare('DELETE FROM user_hidden_tags WHERE tag_id = ?').run(from.id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(from.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return into;
}


// Groups come out in a deliberate reading order rather than alphabetically:
// this is the order an author fills the picker in -- what it is, then where
// it happens, then who's in it, then what to warn people about -- and the
// tag index reads better the same way. Anything an admin invents later
// sorts alphabetically after these.
const TAG_GROUP_ORDER = ['Genre', 'Setting', 'Swarm', 'Cast', 'Orientation', 'Pairings', 'Content notes', 'Length', 'Review status'];

function listTagsGrouped() {
  const groups = [];
  const byGroup = new Map();
  for (const tag of listTags()) {
    if (!byGroup.has(tag.tag_group)) {
      const entry = { group: tag.tag_group, tags: [] };
      byGroup.set(tag.tag_group, entry);
      groups.push(entry);
    }
    byGroup.get(tag.tag_group).tags.push(tag);
  }
  const rank = (name) => {
    const i = TAG_GROUP_ORDER.indexOf(name);
    return i === -1 ? TAG_GROUP_ORDER.length : i;
  };
  return groups.sort((a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group));
}

const getTagBySlug = (slug) => db.prepare('SELECT * FROM tags WHERE slug = ?').get(slug) || null;

const getTagById = (id) => db.prepare('SELECT * FROM tags WHERE id = ?').get(id) || null;


// Returns the existing tag when the name is already taken rather than
// throwing -- the admin form's "add" is meant to be idempotent.
function createTag({ name, group, description }) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const existing = db.prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE').get(clean);
  if (existing) return existing;
  let slug = slugifyTag(clean);
  if (getTagBySlug(slug)) slug = `${slug}-${Date.now().toString(36)}`;
  const info = db.prepare('INSERT INTO tags (name, slug, tag_group, description) VALUES (?, ?, ?, ?)')
    .run(clean, slug, String(group || 'Other').trim() || 'Other', String(description || '').trim());
  return getTagById(Number(info.lastInsertRowid));
}


// The slug deliberately does NOT follow a rename: it's in links people
// may already have shared, and a tag's identity is its row, not its name.
function updateTag(id, { name, group, description }) {
  const tag = getTagById(id);
  if (!tag) return null;
  const clean = String(name || '').trim() || tag.name;
  const clash = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id <> ?').get(clean, id);
  db.prepare('UPDATE tags SET name = ?, tag_group = ?, description = ? WHERE id = ?')
    .run(clash ? tag.name : clean, String(group || tag.tag_group).trim() || 'Other', String(description ?? tag.description), id);
  return getTagById(id);
}

function deleteTag(id) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM story_tags WHERE tag_id = ?').run(id);
    db.prepare('DELETE FROM user_hidden_tags WHERE tag_id = ?').run(id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getStoryTags(storyId) {
  return db.prepare(`
    SELECT t.* FROM tags t JOIN story_tags st ON st.tag_id = t.id
    WHERE st.story_id = ?
    ORDER BY t.tag_group COLLATE NOCASE, t.name COLLATE NOCASE
  `).all(storyId);
}


// One query for a whole page of stories rather than one per row.
function tagsForStories(storyIds) {
  const byStory = new Map(storyIds.map((id) => [id, []]));
  if (!storyIds.length) return byStory;
  const placeholders = storyIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT st.story_id, t.* FROM tags t JOIN story_tags st ON st.tag_id = t.id
    WHERE st.story_id IN (${placeholders})
    ORDER BY t.tag_group COLLATE NOCASE, t.name COLLATE NOCASE
  `).all(...storyIds);
  for (const row of rows) {
    if (byStory.has(row.story_id)) byStory.get(row.story_id).push(row);
  }
  return byStory;
}

function setStoryTags(storyId, tagIds) {
  const ids = Array.from(new Set((tagIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0)));
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM story_tags WHERE story_id = ?').run(storyId);
    const insert = db.prepare('INSERT OR IGNORE INTO story_tags (story_id, tag_id) VALUES (?, ?)');
    for (const id of ids) if (getTagById(id)) insert.run(storyId, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}


/**
 * @param {number} storyId
 * @param {{ title: string, description?: string, synopsis?: string, status?: string }} details
 */
function updateStoryDetails(storyId, { title, description, synopsis, status }) {
  const state = CHOOSABLE_STORY_STATES.includes(status) ? status : null;
  db.prepare(`
    UPDATE stories SET title = ?, description = ?, synopsis = ?${state ? ', status = ?' : ''} WHERE id = ?
  `).run(...[
    String(title).trim(), String(description || '').trim(), String(synopsis || '').trim(),
    ...(state ? [state] : []), storyId,
  ]);
  return getStoryById(storyId);
}


// Everything the story page's header wants to say about the shape of the
// thing, in one query rather than five. Word counts come from each
// chapter's current version only -- adding up every draft would make a
// story look four times longer than it reads.
function getStoryStats(storyId) {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM chapters c WHERE c.story_id = @storyId AND c.archived_at IS NULL) AS chapters,
      (SELECT COUNT(*) FROM chapters c WHERE c.story_id = @storyId AND c.archived_at IS NULL
        AND TRIM(c.arc_title) != '') AS arcs,
      (SELECT COUNT(*) FROM chapters c WHERE c.story_id = @storyId AND c.archived_at IS NOT NULL) AS archived_chapters,
      (SELECT COALESCE(SUM(v.word_count), 0) FROM chapters c
        JOIN chapter_versions v ON v.chapter_id = c.id
        WHERE c.story_id = @storyId AND c.archived_at IS NULL
          AND v.version_number = (SELECT MAX(v2.version_number) FROM chapter_versions v2 WHERE v2.chapter_id = c.id)
      ) AS words,
      (SELECT MAX(v.created_at) FROM chapters c
        JOIN chapter_versions v ON v.chapter_id = c.id
        WHERE c.story_id = @storyId AND c.archived_at IS NULL) AS last_written_at,
      (SELECT COUNT(*) FROM comments cm
        JOIN chapter_versions v ON v.id = cm.version_id
        JOIN chapters c ON c.id = v.chapter_id
        WHERE c.story_id = @storyId AND c.archived_at IS NULL
          AND cm.deleted_at IS NULL AND cm.parent_id IS NULL
          AND v.version_number = (SELECT MAX(v3.version_number) FROM chapter_versions v3 WHERE v3.chapter_id = c.id)
      ) AS comments,
      (SELECT COUNT(*) FROM comments cm
        JOIN chapter_versions v ON v.id = cm.version_id
        JOIN chapters c ON c.id = v.chapter_id
        WHERE c.story_id = @storyId AND c.archived_at IS NULL
          AND cm.status = 'pending' AND cm.deleted_at IS NULL AND cm.parent_id IS NULL
          AND v.version_number = (SELECT MAX(v4.version_number) FROM chapter_versions v4 WHERE v4.chapter_id = c.id)
      ) AS pending_comments
  `).get({ storyId });
  return row || { chapters: 0, archived_chapters: 0, words: 0, last_written_at: null, comments: 0, pending_comments: 0 };
}

// ---------- per-reader hidden tags (SOL's excluded codes) ----------

function listUserHiddenTagIds(userId) {
  return db.prepare('SELECT tag_id FROM user_hidden_tags WHERE user_id = ?').all(userId).map((r) => r.tag_id);
}

function setUserHiddenTags(userId, tagIds) {
  const ids = Array.from(new Set((tagIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0)));
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM user_hidden_tags WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT OR IGNORE INTO user_hidden_tags (user_id, tag_id) VALUES (?, ?)');
    for (const id of ids) if (getTagById(id)) insert.run(userId, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------- wiki index (see lib/wiki.js for the sync/fetch logic) ----------

module.exports = {
  TAG_GROUP_ORDER,
  approveTag,
  createTag,
  deleteTag,
  getStoryStats,
  getStoryTags,
  getTagById,
  getTagBySlug,
  listProposedTags,
  listTags,
  listTagsGrouped,
  listUserHiddenTagIds,
  mergeTag,
  proposeTag,
  setStoryTags,
  setUserHiddenTags,
  slugifyTag,
  tagsForStories,
  updateStoryDetails,
  updateTag,
};
