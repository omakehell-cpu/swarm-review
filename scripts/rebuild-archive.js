// Rebuilds the archive into a fresh file, page by page rather than byte by
// byte: a new database made by the app's own schema, every row copied into
// it, and the search index built from the text at the end rather than
// carried across. A corrupt index or a corrupt page in a table that can be
// rebuilt from somewhere else does not survive the trip.
//
//   node scripts/rebuild-archive.js <repo> <source.sqlite> <target.sqlite> [backup.sqlite]
//
// The backup, if given, is where wiki_pages and wiki_page_categories come
// from -- the glossary is a copy of somebody else's wiki and the least
// valuable thing in the file, so it is taken from the known-good copy
// rather than from pages that may be damaged.
//
// **Stop the service first.** See docs/DATABASE.md: one writer, on the
// machine the file is on, or the next thing you get is this script again.
'use strict';
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const [root, src, dest, backup] = process.argv.slice(2);
if (!root || !src || !dest) throw new Error('usage: node scripts/rebuild-archive.js . <source> <target> [backup]');
if (fs.existsSync(dest)) throw new Error(dest + ' already exists');

// The app builds its own schema when it opens a file it has never seen.
process.env.SWARM_DB_PATH = dest;
const fresh = require(root + '/db.js');
fresh.exec('PRAGMA foreign_keys = OFF');

const source = new DatabaseSync(src, { readOnly: true });
const FTS = /^search_index(_|$)/;
const tables = fresh.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all().map((r) => r.name).filter((n) => !FTS.test(n));

const fromBackup = backup ? new Set(['wiki_pages', 'wiki_page_categories']) : new Set();
const bak = backup ? new DatabaseSync(backup, { readOnly: true }) : null;
const report = [];

for (const table of tables) {
  const cols = fresh.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const reader = fromBackup.has(table) ? bak : source;
  let rows = [];
  let note = fromBackup.has(table) ? 'from the backup' : '';
  try {
    const have = reader.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    const shared = cols.filter((c) => have.includes(c));
    if (!shared.length) { report.push([table, 0, 'no such table there']); continue; }
    rows = reader.prepare(`SELECT ${shared.map((c) => `"${c}"`).join(',')} FROM ${table}`).all();
    const insert = fresh.prepare(
      `INSERT OR REPLACE INTO ${table} (${shared.map((c) => `"${c}"`).join(',')}) VALUES (${shared.map(() => '?').join(',')})`
    );
    fresh.exec('BEGIN');
    for (const row of rows) insert.run(...shared.map((c) => (row[c] === undefined ? null : row[c])));
    fresh.exec('COMMIT');
  } catch (err) {
    try { fresh.exec('ROLLBACK'); } catch (e) { /* nothing open */ }
    note = 'FAILED: ' + err.message;
  }
  report.push([table, rows.length, note]);
}

fresh.exec('PRAGMA foreign_keys = ON');
const orphans = fresh.prepare('PRAGMA foreign_key_check').all();
fresh.rebuildSearchIndex();

console.log('table'.padEnd(28), 'rows');
for (const [t, n, note] of report) console.log(t.padEnd(28), String(n).padStart(6), note);
console.log('\nforeign key problems:', orphans.length, JSON.stringify(orphans.slice(0, 3)));
const check = fresh.prepare('PRAGMA integrity_check').all();
console.log('integrity:', JSON.stringify(check).slice(0, 300));
console.log('search index rows:', fresh.prepare('SELECT count(*) n FROM search_index').get().n);
