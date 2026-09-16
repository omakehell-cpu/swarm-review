'use strict';

const { db } = require('./shared');
// A snapshot of the whole database as a single, self-contained file. The
// live database runs in WAL mode (see db.js): most recent writes sit in a
// separate -wal file, so a plain copy of just the .sqlite file can miss
// most of the data while the server is running. VACUUM INTO instead reads
// through the live connection (which already merges the base file and the
// WAL) and writes one complete, consistent file with no WAL/shm sidecars --
// safe to copy or move anywhere on its own. destPath must not already
// exist; SQLite refuses to overwrite a file with VACUUM INTO.
function backupDatabaseTo(destPath) {
  db.prepare('VACUUM INTO ?').run(destPath);
}

// ---------- per-story spelling exceptions ----------

// See db.js's story_dictionary_words table comment for what this is for.

function getStoryDictionary(storyId) {
  return db.prepare(
    'SELECT word FROM story_dictionary_words WHERE story_id = ? ORDER BY word COLLATE NOCASE'
  ).all(storyId).map((row) => row.word);
}

function listStoryDictionaryEntries(storyId) {
  return db.prepare(`
    SELECT sdw.*, u.display_name AS added_by_name
    FROM story_dictionary_words sdw LEFT JOIN users u ON u.id = sdw.added_by
    WHERE sdw.story_id = ?
    ORDER BY sdw.word COLLATE NOCASE
  `).all(storyId);
}


// Case-insensitive add: stored lowercased, and re-adding the same word
// (in any case) is a silent no-op rather than an error.
function addStoryDictionaryWord(storyId, word, addedBy) {
  const normalized = word.trim().toLowerCase();
  if (!normalized) return;
  db.prepare(
    'INSERT OR IGNORE INTO story_dictionary_words (story_id, word, added_by) VALUES (?, ?, ?)'
  // node:sqlite refuses undefined outright, so a caller that does not
  // know who is asking says so in the one way the column accepts.
  ).run(storyId, normalized, addedBy === undefined ? null : addedBy);
}

function removeStoryDictionaryWord(storyId, id) {
  db.prepare('DELETE FROM story_dictionary_words WHERE story_id = ? AND id = ?').run(storyId, id);
}

// ---------- search ----------

module.exports = {
  addStoryDictionaryWord,
  backupDatabaseTo,
  getStoryDictionary,
  listStoryDictionaryEntries,
  removeStoryDictionaryWord,
};
