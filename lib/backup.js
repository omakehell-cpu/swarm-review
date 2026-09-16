'use strict';

// Keeping a copy of the database without anybody having to remember.
//
// Everything this group has written lives in one SQLite file on one Mac.
// There was a button to download a copy of it, which is a backup only on
// the days somebody thinks to press it, and the days somebody thinks to
// press it are not the days the disk fails.
//
// So the server takes one itself, daily, into data/backups/, and keeps the
// last few. That is not an off-site backup and does not pretend to be:
// pointing a cloud folder or a second disk at data/backups/ is what makes
// it one, and the admin page says so.

const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;

// Often enough that a bad day costs a day, rarely enough that a 4MB file
// is not being copied on top of somebody's writing.
const EVERY_MS = DAY_MS;
const KEEP = 14;

// Checked every hour rather than slept for a day: a Mac mini that goes to
// sleep, or a service restarted at noon, would otherwise skip a turn.
const CHECK_EVERY_MS = 60 * 60 * 1000;

const NAME = /^swarm-review-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.sqlite$/;

function backupDir() {
  return path.join(
    path.dirname(process.env.SWARM_DB_PATH || path.join(__dirname, '..', 'data', 'swarm-review.sqlite')),
    'backups'
  );
}

/** The copies on disk, newest first. */
function listBackups() {
  const dir = backupDir();
  let names;
  try { names = fs.readdirSync(dir); } catch (err) { return []; }
  return names
    .filter((name) => NAME.test(name))
    .map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { name, path: full, bytes: stat.size, at: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

// Old copies go, but only once a new one is safely written -- a prune that
// runs first is a prune that can leave nothing at all.
function prune() {
  for (const old of listBackups().slice(KEEP)) {
    try { fs.unlinkSync(old.path); } catch (err) { /* it can go next time */ }
  }
}

/**
 * Takes one now. `copy` is models.backupDatabaseTo, passed in rather than
 * required, so this file has no opinion about the database.
 * @param {(dest: string) => void} copy
 */
function takeBackup(copy) {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(dir, `swarm-review-${stamp}.sqlite`);
  // VACUUM INTO writes a whole file or none, so a copy that appears is a
  // copy that is complete.
  copy(dest);
  prune();
  return { name: path.basename(dest), path: dest, bytes: fs.statSync(dest).size, at: new Date().toISOString() };
}

const isDue = (newest, now = Date.now()) => !newest || now - new Date(newest.at).getTime() >= EVERY_MS;

/**
 * Starts the timer. Takes one straight away if the last is older than a
 * day (or there is none), which is also what makes a fresh install have a
 * backup before it has a problem.
 * @param {(dest: string) => void} copy
 * @param {(err: Error) => void} [onError]
 */
function startBackups(copy, onError) {
  const tick = () => {
    try {
      if (isDue(listBackups()[0])) takeBackup(copy);
    } catch (err) {
      // A failed backup must never take the site down with it.
      if (onError) onError(/** @type {Error} */ (err));
    }
  };
  tick();
  const timer = setInterval(tick, CHECK_EVERY_MS);
  // Nothing should be held open by a backup timer at shutdown.
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { EVERY_MS, KEEP, backupDir, isDue, listBackups, startBackups, takeBackup };
