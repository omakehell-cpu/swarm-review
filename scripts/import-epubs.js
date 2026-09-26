#!/usr/bin/env node
// scripts/import-epubs.js -- bring a whole folder of StoriesOnline EPUBs
// (or a .zip of them) in from the machine the site runs on: the same thing
// as Many at once on /admin/import, without uploading hundreds of files
// through a browser.
//
//   node scripts/import-epubs.js <folder-or-zip> --as <admin> [--tags propose|add|skip]
//
// Every file goes through the same import as the page: stories already
// here are skipped, authors are made (or found, or are already somebody's)
// the same way, and tags the site lacks are proposed for the admins to
// approve unless --tags says otherwise. A backup is taken first, into the
// usual backups folder, so the whole run can be undone from Admin.
//
// Stop the server while it runs: two programs writing to one database is
// how a database gets hurt.
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const source = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const asUser = String(opt('as', '')).toLowerCase();
const tagMode = opt('tags', 'propose');
if (!source || !asUser || !['propose', 'add', 'skip'].includes(tagMode)) {
  console.error('Usage: node scripts/import-epubs.js <folder-or-zip> --as <admin> [--tags propose|add|skip]');
  process.exit(2);
}

(async () => {
  const models = require('../models');
  const backup = require('../lib/backup');
  const { epubsInZip, importOne } = require('../routes/import');

  const user = models.getUserByUsername(asUser);
  if (!user || !user.is_admin) {
    console.error(`${asUser} is not an admin here.`);
    process.exit(1);
  }

  /** @type {Array<{name: string, read: () => Promise<Buffer>}>} */
  let files;
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    files = fs.readdirSync(source).filter((f) => /\.epub$/i.test(f) && !f.startsWith('._')).sort()
      .map((f) => ({ name: f, read: async () => fs.readFileSync(path.join(source, f)) }));
  } else {
    files = (await epubsInZip(fs.readFileSync(source))).map((e) => ({ name: e.name, read: async () => e.buffer }));
  }
  if (!files.length) {
    console.error('No EPUBs there.');
    process.exit(1);
  }

  const taken = backup.takeBackup(models.backupDatabaseTo);
  console.log(`Backup first: ${taken.name}`);
  const counts = { imported: 0, duplicate: 0, error: 0 };
  for (const [i, f] of files.entries()) {
    const r = await importOne(await f.read(), f.name, { tagMode, user });
    counts[r.status] = (counts[r.status] || 0) + 1;
    const line = r.status === 'imported' ? `${r.title} -- ${r.author}, ${r.chapters} ch.`
      : r.status === 'duplicate' ? `already here: ${r.title}` : `could not be read: ${r.message}`;
    console.log(`${String(i + 1).padStart(4)}/${files.length}  ${r.status.padEnd(9)} ${f.name}  ${line}`);
  }
  const pages = models.refreshStoryGlossary();
  console.log(`\nDone: ${counts.imported} imported, ${counts.duplicate} already here, ${counts.error} could not be read.`);
  console.log(`Glossary: ${pages.added} story pages added (the rest are the wiki's own pages, linked).`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
