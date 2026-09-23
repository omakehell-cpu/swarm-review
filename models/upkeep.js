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

// Puts the contents of a backup back into the live database, table by
// table, inside one transaction. The file is opened read-only first and
// checked: a copy that fails SQLite's own integrity check, or that is not
// this app's database at all, is refused before anything is touched.
//
// Tables are matched by name and columns by name, so an older copy that
// predates a column leaves it at its default, and a table the copy did not
// have yet comes back empty -- which is what the site looked like then.
// The search index is not copied: it is rebuilt from what was restored.
// Synchronous from start to end, so no request can write in the middle.
/** @param {string} sourcePath */
function restoreDatabaseFrom(sourcePath) {
  const { DatabaseSync } = require('node:sqlite');
  const check = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const ok = check.prepare('PRAGMA integrity_check').get();
    if (!ok || Object.values(ok)[0] !== 'ok') throw new Error('that copy is damaged');
    const hasUsers = check.prepare("SELECT 1 AS y FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
    if (!hasUsers) throw new Error('that file is not a copy of this site');
  } finally {
    check.close();
  }

  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'search_index%'`).all().map((r) => r.name);
  const q = (name) => `"${String(name).replace(/"/g, '""')}"`;
  const counts = {};
  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare('ATTACH DATABASE ? AS src').run(sourcePath);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const srcTables = new Set(db.prepare("SELECT name FROM src.sqlite_master WHERE type = 'table'").all().map((r) => r.name));
      for (const t of tables) {
        db.exec(`DELETE FROM main.${q(t)}`);
        if (!srcTables.has(t)) { counts[t] = 0; continue; }
        const mine = db.prepare(`PRAGMA main.table_info(${q(t)})`).all().map((c) => c.name);
        const theirs = new Set(db.prepare(`PRAGMA src.table_info(${q(t)})`).all().map((c) => c.name));
        const cols = mine.filter((c) => theirs.has(c)).map(q).join(', ');
        if (cols) db.exec(`INSERT INTO main.${q(t)} (${cols}) SELECT ${cols} FROM src.${q(t)}`);
        counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM main.${q(t)}`).get().n;
      }
      const mainHasSeq = db.prepare("SELECT 1 AS y FROM main.sqlite_master WHERE name = 'sqlite_sequence'").get();
      if (srcTables.has('sqlite_sequence') && mainHasSeq) {
        db.exec('DELETE FROM main.sqlite_sequence');
        db.exec('INSERT INTO main.sqlite_sequence (name, seq) SELECT name, seq FROM src.sqlite_sequence');
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } finally {
    db.exec('DETACH DATABASE src');
    db.exec('PRAGMA foreign_keys = ON');
  }
  db.rebuildSearchIndex();
  return counts;
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
  restoreDatabaseFrom,
  getStoryDictionary,
  listStoryDictionaryEntries,
  removeStoryDictionaryWord,
};
