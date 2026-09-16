'use strict';

const { countWords } = require('../lib/markdown');

const db = require('../db');

const auth = require('../auth');

const bible = require('../lib/story-bible');

const entityImages = require('../lib/entity-images');

const castLinks = require('../lib/cast-links');

const DELETED_USER_USERNAME = 'deleted-user';

// Versions written before chapter_versions.word_count existed have no
// count. Filling them in needs the markdown parser, which db.js has no
// business importing, so it happens here, once, on the first load after
// the column is added.
{
  const missing = db.prepare('SELECT id, content FROM chapter_versions WHERE word_count IS NULL').all();
  if (missing.length) {
    const update = db.prepare('UPDATE chapter_versions SET word_count = ? WHERE id = ?');
    for (const row of missing) update.run(countWords(row.content), row.id);
  }
}

// ---------- users ----------

const getLatestVersion = (chapterId) =>
  db.prepare(
    'SELECT * FROM chapter_versions WHERE chapter_id = ? ORDER BY version_number DESC LIMIT 1'
  ).get(chapterId);

// Both fields are free text, and both offer back what this story has used
// before. A vocabulary that settles by reuse beats one that has to be
// configured before the first chapter is written -- the same bargain the
// bible's custom fields strike.
const POV_MAX = 80;

const cleanLabel = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, POV_MAX);


// A day on the story's own scale. Empty means nobody has said, which is
// not day zero: a chapter with no date has to stay undated rather than
// being dragged to the front of the timeline.
function cleanDay(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

module.exports = {
  DELETED_USER_USERNAME,
  POV_MAX,
  auth,
  bible,
  castLinks,
  cleanDay,
  cleanLabel,
  db,
  entityImages,
  getLatestVersion,
};
