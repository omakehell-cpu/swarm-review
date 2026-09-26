'use strict';

// Stories brought in from elsewhere (StoriesOnline, for now), and the
// authors who come with them.
//
// An imported author is a row in `users` with is_placeholder set: stories
// and chapters need somebody to belong to, and every page already knows
// how to show a user. But it is not a member. It has no password anybody
// could type, it cannot sign in, and every list of people in the app
// leaves it out. A member who is that author asks for it (a claim); an
// admin agrees; and every story and chapter the placeholder held moves to
// the member's account in one go.

const crypto = require('crypto');
const { countWords } = require('../lib/markdown');
const { db } = require('./shared');
const { rebuildChapterAppearances } = require('./bible');
const tags = require('./tags');

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'author';

/** The imported author for this name, made the first time it is seen. */
function findOrCreateImportedAuthor({ name, authorSlug, url }) {
  const username = `sol-${slug(authorSlug || name)}`;
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (existing) return existing;
  // Not a password: a string no password hashes to (no salt separator),
  // so verifyPassword can only ever say no.
  const info = db.prepare(`
    INSERT INTO users (username, display_name, password_hash, is_admin, is_placeholder, source_url)
    VALUES (?, ?, ?, 0, 1, ?)
  `).run(username, String(name || 'Unknown').slice(0, 80), `imported-${crypto.randomBytes(8).toString('hex')}`, url || null);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
}

/**
 * A story already imported: from the same place, or -- for an EPUB that
 * does not say where it came from -- under the same title by the same
 * imported author, which is as near as the file lets us get.
 * @param {string|null|undefined} sourceId
 * @param {{ title?: string, name?: string, authorSlug?: string }} [also]
 */
function findImportedStory(sourceId, also = {}) {
  if (sourceId) {
    const hit = db.prepare('SELECT id, title FROM stories WHERE source_id = ?').get(String(sourceId));
    if (hit) return hit;
  }
  if (!also.title) return null;
  return db.prepare(`
    SELECT s.id, s.title FROM stories s JOIN users u ON u.id = s.imported_author_id
    WHERE lower(s.title) = lower(?) AND u.username = ?
  `).get(String(also.title), `sol-${slug(also.authorSlug || also.name)}`) || null;
}

/** The imported author this username would be, without making one. */
const importedAuthorFor = ({ name, authorSlug }) => db.prepare(`
  SELECT u.*, c.display_name AS claimed_by_name FROM users u LEFT JOIN users c ON c.id = u.claimed_by
  WHERE u.username = ?`).get(`sol-${slug(authorSlug || name)}`) || null;

/**
 * Writes an imported story: the story, its chapters as version 1 each,
 * dated as they were published, and its tags where the vocabulary has
 * them. One transaction: a half-imported story is worse than none.
 * @param {any} parsed  what lib/sol-import.js read
 * @param {{ authorId: number, importedAuthorId?: number|null, tagIds?: number[], coverImage?: {filename: string, contentType: string}|null }} opts
 */
function importStory(parsed, { authorId, importedAuthorId = null, tagIds = [], coverImage = null }) {
  const when = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? `${d} 12:00:00` : null);
  const published = when(parsed.published);
  const updated = when(parsed.updated) || published;
  let storyId;
  const chapterIds = [];
  db.exec('BEGIN');
  try {
    const info = db.prepare(`
      INSERT INTO stories (title, description, author_id, imported_author_id, status, series, source_url, source_id, imported_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), COALESCE(?, datetime('now')))
    `).run(parsed.title, parsed.description || '', authorId, importedAuthorId || authorId, parsed.status === 'complete' ? 'complete' : 'ongoing',
      parsed.series || '', parsed.storyUrl || null, parsed.solId || null, published);
    storyId = Number(info.lastInsertRowid);
    const insertChapter = db.prepare(`
      INSERT INTO chapters (story_id, chapter_number, title, summary, author_id, created_at)
      VALUES (?, ?, ?, '', ?, COALESCE(?, datetime('now')))
    `);
    const insertVersion = db.prepare(`
      INSERT INTO chapter_versions (chapter_id, version_number, content, changelog, word_count, created_at)
      VALUES (?, 1, ?, ?, ?, COALESCE(?, datetime('now')))
    `);
    parsed.chapters.forEach((c, i) => {
      const at = i === parsed.chapters.length - 1 && parsed.chapters.length > 1 ? updated : published;
      const ch = insertChapter.run(storyId, i + 1, c.title, authorId, at);
      const chapterId = Number(ch.lastInsertRowid);
      insertVersion.run(chapterId, c.markdown, 'Imported from StoriesOnline', countWords(c.markdown), at);
      chapterIds.push(chapterId);
    });
    const tag = db.prepare('INSERT OR IGNORE INTO story_tags (story_id, tag_id) VALUES (?, ?)');
    for (const id of tagIds) tag.run(storyId, id);
    if (coverImage) {
      db.prepare('UPDATE stories SET cover_filename = ?, cover_type = ? WHERE id = ?')
        .run(coverImage.filename, coverImage.contentType, storyId);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  for (const id of chapterIds) rebuildChapterAppearances(id);
  return storyId;
}

/** The vocabulary's tags whose names the imported story's tags match. */
function matchTags(names) {
  const matched = [];
  const unmatched = [];
  const find = db.prepare("SELECT id, name FROM tags WHERE lower(name) = lower(?) AND COALESCE(status, 'approved') != 'proposed'");
  for (const name of names || []) {
    const row = find.get(String(name).trim());
    if (row) matched.push(row); else unmatched.push(name);
  }
  return { matched, unmatched, suggestions: suggestTags(unmatched) };
}

// ---------- tags the vocabulary does not have yet ----------

// Spelled the same once case, punctuation and a plural are set aside:
// "Sci-Fi" and "SciFi", "Aliens" and "Alien".
const tagKey = (name) => String(name).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '').replace(/s$/, '');

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const here = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = here;
    }
  }
  return row[b.length];
}

// A StoriesOnline code goes in the category StoriesOnline files it under
// (lib/sol-tags.js), which is how this site groups its tags too.
const guessTagGroup = (name) => require('../lib/sol-tags').categoryFor(name);

/**
 * For each tag the book has and the vocabulary does not: an existing tag
 * spelled nearly the same (to use instead), a proposal already waiting
 * under that name (to approve), and the group a new one would go in.
 * @param {string[]} names
 */
function suggestTags(names) {
  if (!names.length) return [];
  const all = db.prepare("SELECT id, name, tag_group, COALESCE(status, 'approved') AS status FROM tags").all();
  const approved = all.filter((t) => t.status !== 'proposed');
  return names.map((name) => {
    const key = tagKey(name);
    const proposed = all.find((t) => t.status === 'proposed' && t.name.toLowerCase() === String(name).toLowerCase()) || null;
    let similar = approved.find((t) => tagKey(t.name) === key) || null;
    if (!similar && key.length >= 6) {
      const near = approved
        .map((t) => ({ t, d: editDistance(key, tagKey(t.name)) }))
        .filter((x) => x.d <= 2 && tagKey(x.t.name).length >= 5)
        .sort((a, b) => a.d - b.d)[0];
      similar = near ? near.t : null;
    }
    return {
      name,
      similar: similar && { id: similar.id, name: similar.name },
      proposed: proposed && { id: proposed.id },
      group: similar ? similar.tag_group : guessTagGroup(name),
    };
  });
}

/**
 * What the admin chose for each missing tag, as tag ids to put on the
 * story: a new tag in the vocabulary, a waiting proposal approved, an
 * existing tag used instead, or nothing.
 * @param {Array<{ name: string, similar: {id:number}|null, proposed: {id:number}|null }>} suggestions
 * @param {Array<{ action: string, group: string }>} choices one per suggestion
 */
function applyTagChoices(suggestions, choices) {
  const ids = [];
  const added = [];
  suggestions.forEach((s, i) => {
    const choice = choices[i] || { action: 'skip', group: '' };
    const group = String(choice.group || '').trim().slice(0, 60) || guessTagGroup(s.name);
    if (choice.action === 'use' && s.similar) {
      ids.push(s.similar.id);
    } else if (choice.action === 'add') {
      const tag = s.proposed
        ? tags.approveTag(s.proposed.id, { name: s.name, group })
        : tags.createTag({ name: s.name, group, description: 'Brought in with a story from StoriesOnline.' });
      if (tag) { ids.push(tag.id); added.push(tag.name); }
    }
  });
  return { ids, added };
}

// ---------- the imported authors, and claiming them ----------

function listImportedAuthors() {
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.source_url, u.claimed_by, c.display_name AS claimed_by_name,
           (SELECT COUNT(*) FROM stories s WHERE s.author_id = u.id) AS story_count
    FROM users u LEFT JOIN users c ON c.id = u.claimed_by
    WHERE u.is_placeholder = 1
    ORDER BY u.display_name COLLATE NOCASE
  `).all();
}

/** The claim this member has made on this author and not had answered. */
const pendingClaimBy = (placeholderId, userId) => db.prepare(
  "SELECT * FROM author_claims WHERE placeholder_id = ? AND user_id = ? AND status = 'pending'"
).get(placeholderId, userId) || null;

function requestClaim(placeholderId, userId, message) {
  const existing = pendingClaimBy(placeholderId, userId);
  if (existing) return existing;
  const info = db.prepare('INSERT INTO author_claims (placeholder_id, user_id, message) VALUES (?, ?, ?)')
    .run(placeholderId, userId, String(message || '').trim().slice(0, 1000));
  return db.prepare('SELECT * FROM author_claims WHERE id = ?').get(Number(info.lastInsertRowid));
}

function listPendingClaims() {
  return db.prepare(`
    SELECT c.*, p.display_name AS author_name, p.username AS author_username, p.source_url,
           u.display_name AS member_name, u.username AS member_username,
           (SELECT COUNT(*) FROM stories s WHERE s.author_id = p.id) AS story_count
    FROM author_claims c JOIN users p ON p.id = c.placeholder_id JOIN users u ON u.id = c.user_id
    WHERE c.status = 'pending'
    ORDER BY c.created_at
  `).all();
}

const getClaim = (id) => db.prepare('SELECT * FROM author_claims WHERE id = ?').get(id) || null;

// Everything the imported author holds becomes the member's, the author is
// marked as theirs, and any claim still waiting on it is answered no. The
// one step both ways share: a claim an admin agrees to, and an admin
// giving the stories to a member directly.
function moveImportedAuthor(placeholderId, userId, adminId) {
  const stories = db.prepare('UPDATE stories SET author_id = ? WHERE author_id = ?').run(userId, placeholderId).changes;
  const chapters = db.prepare('UPDATE chapters SET author_id = ? WHERE author_id = ?').run(userId, placeholderId).changes;
  db.prepare('UPDATE users SET claimed_by = ? WHERE id = ?').run(userId, placeholderId);
  db.prepare("UPDATE author_claims SET status = 'declined', decided_by = ?, decided_at = datetime('now') WHERE placeholder_id = ? AND status = 'pending'")
    .run(adminId, placeholderId);
  return { stories, chapters };
}

function inOneGo(run) {
  db.exec('BEGIN');
  try {
    const out = run();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Yes to a claim: the author's stories move to the member who made it.
 * @returns {{ stories: number, chapters: number }|null}
 */
function approveClaim(claimId, adminId) {
  const claim = getClaim(claimId);
  if (!claim || claim.status !== 'pending') return null;
  return inOneGo(() => {
    db.prepare("UPDATE author_claims SET status = 'approved', decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(adminId, claimId);
    return moveImportedAuthor(claim.placeholder_id, claim.user_id, adminId);
  });
}

/**
 * An admin who knows who an imported author is, giving them their stories
 * without waiting for a claim. Only an author nobody has yet, and only to
 * a member.
 * @returns {{ stories: number, chapters: number }|null}
 */
function assignImportedAuthor(placeholderId, userId, adminId) {
  const author = db.prepare('SELECT * FROM users WHERE id = ? AND is_placeholder = 1').get(placeholderId);
  const member = db.prepare('SELECT * FROM users WHERE id = ? AND is_placeholder = 0 AND locked_at IS NULL').get(userId);
  if (!author || author.claimed_by || !member) return null;
  return inOneGo(() => moveImportedAuthor(placeholderId, userId, adminId));
}

/**
 * Every imported author with the stories they came in with, for the
 * authors page: whoever has them now, and whether anybody is asking.
 */
function importedAuthorsWithStories() {
  const authors = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.source_url, u.claimed_by,
           c.display_name AS claimed_by_name, c.username AS claimed_by_username
    FROM users u LEFT JOIN users c ON c.id = u.claimed_by
    WHERE u.is_placeholder = 1
    ORDER BY u.display_name COLLATE NOCASE
  `).all();
  const stories = db.prepare(`
    SELECT s.id, s.title, s.status, s.imported_author_id,
      (SELECT COUNT(*) FROM chapters ch WHERE ch.story_id = s.id AND ch.archived_at IS NULL) AS chapters
    FROM stories s
    WHERE s.imported_author_id IS NOT NULL AND s.archived_at IS NULL
    ORDER BY s.title COLLATE NOCASE
  `).all();
  const claims = db.prepare(`
    SELECT a.id, a.placeholder_id, a.user_id, a.message, a.created_at, m.display_name AS member_name, m.username AS member_username
    FROM author_claims a JOIN users m ON m.id = a.user_id
    WHERE a.status = 'pending' ORDER BY a.created_at
  `).all();
  const claimsOf = new Map();
  for (const c of claims) {
    if (!claimsOf.has(c.placeholder_id)) claimsOf.set(c.placeholder_id, []);
    claimsOf.get(c.placeholder_id).push(c);
  }
  const byAuthor = new Map();
  for (const s of stories) {
    if (!byAuthor.has(s.imported_author_id)) byAuthor.set(s.imported_author_id, []);
    byAuthor.get(s.imported_author_id).push(s);
  }
  return authors.map((a) => ({ ...a, stories: byAuthor.get(a.id) || [], claims: claimsOf.get(a.id) || [] }));
}

function declineClaim(claimId, adminId) {
  db.prepare("UPDATE author_claims SET status = 'declined', decided_by = ?, decided_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .run(adminId, claimId);
}

module.exports = {
  applyTagChoices,
  approveClaim,
  assignImportedAuthor,
  importedAuthorsWithStories,
  declineClaim,
  findImportedStory,
  findOrCreateImportedAuthor,
  getClaim,
  importStory,
  importedAuthorFor,
  listImportedAuthors,
  listPendingClaims,
  matchTags,
  pendingClaimBy,
  requestClaim,
  suggestTags,
};
