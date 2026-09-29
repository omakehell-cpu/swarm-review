'use strict';

// The answers to a person's character study (see lib/character-study.js),
// one row per question answered.

const study = require('../lib/character-study');
const { db } = require('./shared');

/** @returns {Record<string, string>} every question, answered or '' */
function getCharacterStudy(entityId) {
  const out = Object.fromEntries(study.KEYS.map((k) => [k, '']));
  for (const row of db.prepare('SELECT question, answer FROM story_entity_study WHERE entity_id = ?').all(entityId)) {
    if (row.question in out) out[row.question] = row.answer;
  }
  return out;
}

/** Writes what the form sent: an emptied answer is removed. */
function setCharacterStudy(entityId, answers) {
  const put = db.prepare(`
    INSERT INTO story_entity_study (entity_id, question, answer) VALUES (?, ?, ?)
    ON CONFLICT(entity_id, question) DO UPDATE SET answer = excluded.answer, updated_at = datetime('now')
  `);
  const drop = db.prepare('DELETE FROM story_entity_study WHERE entity_id = ? AND question = ?');
  for (const key of study.KEYS) {
    const answer = String((answers && answers[key]) || '');
    if (answer) put.run(entityId, key, answer); else drop.run(entityId, key);
  }
}

/**
 * The main characters of a story nobody has started a study for yet --
 * the nudge on the glossary page. Only main ones: asking about every
 * walk-on would be nagging.
 */
const mainCharactersWithoutStudy = (storyId) => db.prepare(`
  SELECT e.id, e.name FROM story_entities e
  WHERE e.story_id = ? AND e.kind = 'person' AND e.role = 'main'
    AND NOT EXISTS (SELECT 1 FROM story_entity_study s WHERE s.entity_id = e.id)
  ORDER BY e.name_lower
`).all(storyId);

module.exports = { getCharacterStudy, mainCharactersWithoutStudy, setCharacterStudy };
