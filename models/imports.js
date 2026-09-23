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

/** A story already imported from the same place. */
const findImportedStory = (sourceId) => (sourceId
  ? db.prepare('SELECT id, title FROM stories WHERE source_id = ?').get(String(sourceId)) || null
  : null);

/** The imported author this username would be, without making one. */
const importedAuthorFor = ({ name, authorSlug }) =>
  db.prepare('SELECT * FROM users WHERE username = ?').get(`sol-${slug(authorSlug || name)}`) || null;

/**
 * Writes an imported story: the story, its chapters as version 1 each,
 * dated as they were published, and its tags where the vocabulary has
 * them. One transaction: a half-imported story is worse than none.
 * @param {any} parsed  what lib/sol-import.js read
 * @param {{ authorId: number, tagIds?: number[], coverImage?: {filename: string, contentType: string}|null }} opts
 */
function importStory(parsed, { authorId, tagIds = [], coverImage = null }) {
  const when = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? `${d} 12:00:00` : null);
  const published = when(parsed.published);
  const updated = when(parsed.updated) || published;
  let storyId;
  const chapterIds = [];
  db.exec('BEGIN');
  try {
    const info = db.prepare(`
      INSERT INTO stories (title, description, author_id, status, series, source_url, source_id, imported_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), COALESCE(?, datetime('now')))
    `).run(parsed.title, parsed.description || '', authorId, parsed.status === 'complete' ? 'complete' : 'ongoing',
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
  return { matched, unmatched };
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

/**
 * Yes: everything the imported author holds becomes the member's, and the
 * author is marked as theirs. Every other claim on the same author is
 * answered no at the same time.
 * @returns {{ stories: number, chapters: number }|null}
 */
function approveClaim(claimId, adminId) {
  const claim = getClaim(claimId);
  if (!claim || claim.status !== 'pending') return null;
  let moved;
  db.exec('BEGIN');
  try {
    const stories = db.prepare('UPDATE stories SET author_id = ? WHERE author_id = ?').run(claim.user_id, claim.placeholder_id).changes;
    const chapters = db.prepare('UPDATE chapters SET author_id = ? WHERE author_id = ?').run(claim.user_id, claim.placeholder_id).changes;
    db.prepare('UPDATE users SET claimed_by = ? WHERE id = ?').run(claim.user_id, claim.placeholder_id);
    db.prepare("UPDATE author_claims SET status = 'approved', decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(adminId, claimId);
    db.prepare("UPDATE author_claims SET status = 'declined', decided_by = ?, decided_at = datetime('now') WHERE placeholder_id = ? AND status = 'pending'")
      .run(adminId, claim.placeholder_id);
    db.exec('COMMIT');
    moved = { stories, chapters };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return moved;
}

function declineClaim(claimId, adminId) {
  db.prepare("UPDATE author_claims SET status = 'declined', decided_by = ?, decided_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .run(adminId, claimId);
}

module.exports = {
  approveClaim,
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
};
