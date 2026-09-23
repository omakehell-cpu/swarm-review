'use strict';

// Reactions: what happened to a reader at a paragraph, in one tap and no
// words. A note says what the reader thinks; a reaction says where they
// were lost, bored, unconvinced or hooked -- which is the thing an author
// can least find out for themselves, and a reader is least likely to
// bother writing down.
//
// They belong to a version, like notes, and to a paragraph by its place
// in that version. Only the author sees them added up (the heat map on
// the chapter page); a reader sees their own, and nobody else's, so one
// reader's "lost me" does not tell the next where to be lost.

const { db } = require('./shared');

const REACTION_KINDS = ['hooked', 'lost', 'slow', 'unconvinced'];

/** @param {{ versionId: number, userId: number, paragraph: number, kind: string, on: boolean }} r */
function setReaction({ versionId, userId, paragraph, kind, on }) {
  if (!REACTION_KINDS.includes(kind) || !(paragraph >= 1)) return false;
  if (on) {
    db.prepare(`INSERT OR IGNORE INTO paragraph_reactions (version_id, user_id, paragraph, kind)
      VALUES (?, ?, ?, ?)`).run(versionId, userId, Math.floor(paragraph), kind);
  } else {
    db.prepare(`DELETE FROM paragraph_reactions WHERE version_id = ? AND user_id = ? AND paragraph = ? AND kind = ?`)
      .run(versionId, userId, Math.floor(paragraph), kind);
  }
  return true;
}

/** One reader's own, as { paragraph: [kinds] }. */
function myReactions(versionId, userId) {
  const out = {};
  for (const r of db.prepare(`SELECT paragraph, kind FROM paragraph_reactions
    WHERE version_id = ? AND user_id = ? ORDER BY paragraph`).all(versionId, userId)) {
    (out[r.paragraph] = out[r.paragraph] || []).push(r.kind);
  }
  return out;
}

/**
 * Everybody's, added up, for the author: per paragraph, how many of each,
 * and how many different readers reacted anywhere in the version.
 */
function reactionMap(versionId) {
  const byParagraph = {};
  for (const r of db.prepare(`SELECT paragraph, kind, COUNT(*) AS n FROM paragraph_reactions
    WHERE version_id = ? GROUP BY paragraph, kind`).all(versionId)) {
    (byParagraph[r.paragraph] = byParagraph[r.paragraph] || {})[r.kind] = r.n;
  }
  const readers = db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM paragraph_reactions WHERE version_id = ?').get(versionId).n;
  return { readers, byParagraph };
}

module.exports = { REACTION_KINDS, myReactions, reactionMap, setReaction };
