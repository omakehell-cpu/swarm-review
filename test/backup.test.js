'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The backup rotation, without a database: takeBackup is handed whatever
// makes the copy, so the rules about when and how many can be tested on
// their own.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-backup-'));
process.env.SWARM_DB_PATH = path.join(dir, 'swarm-review.sqlite');
const backups = require('../lib/backup');

const fakeCopy = (dest) => fs.writeFileSync(dest, 'not really a database');

test('a copy lands in data/backups and is found again', () => {
  assert.strictEqual(backups.listBackups().length, 0);
  const made = backups.takeBackup(fakeCopy);
  assert.ok(fs.existsSync(made.path));
  assert.strictEqual(path.dirname(made.path), backups.backupDir());
  const listed = backups.listBackups();
  assert.strictEqual(listed.length, 1);
  assert.strictEqual(listed[0].name, made.name);
  assert.ok(listed[0].bytes > 0);
});

test('only the last few are kept, newest first', () => {
  // Named by hand, because a loop takes them all inside the same second.
  for (let i = 0; i < backups.KEEP + 6; i += 1) {
    const stamp = `2026-09-${String((i % 28) + 1).padStart(2, '0')}T0${i % 10}-00-00`;
    fs.writeFileSync(path.join(backups.backupDir(), `swarm-review-${stamp}.sqlite`), 'x');
  }
  backups.takeBackup(fakeCopy);
  const listed = backups.listBackups();
  assert.strictEqual(listed.length, backups.KEEP);
  const names = listed.map((b) => b.name);
  assert.deepStrictEqual(names, names.slice().sort().reverse(), 'newest first');
  // The one just taken is the newest, and survived its own prune.
  assert.ok(names[0].startsWith('swarm-review-20'));
});

test('anything that is not one of ours is left alone', () => {
  fs.writeFileSync(path.join(backups.backupDir(), 'notes.txt'), 'somebody put this here');
  fs.writeFileSync(path.join(backups.backupDir(), 'swarm-review-nonsense.sqlite'), 'x');
  backups.takeBackup(fakeCopy);
  assert.ok(fs.existsSync(path.join(backups.backupDir(), 'notes.txt')), 'a stray file is not pruned');
  assert.ok(fs.existsSync(path.join(backups.backupDir(), 'swarm-review-nonsense.sqlite')));
  assert.ok(backups.listBackups().every((b) => /T\d{2}-\d{2}-\d{2}\.sqlite$/.test(b.name)));
});

test('one is due when there is none, or the last is a day old', () => {
  const now = Date.now();
  assert.strictEqual(backups.isDue(null, now), true);
  assert.strictEqual(backups.isDue({ at: new Date(now - 1000).toISOString() }, now), false);
  assert.strictEqual(backups.isDue({ at: new Date(now - backups.EVERY_MS - 1).toISOString() }, now), true);
});

test('a copy that throws does not take the server with it', () => {
  // Clear the directory so one is actually due, or the timer has nothing
  // to try and the failure never happens.
  for (const b of backups.listBackups()) fs.unlinkSync(b.path);
  const angry = () => { throw new Error('disk is full'); };
  let caught = null;
  const timer = backups.startBackups(angry, (err) => { caught = err; });
  clearInterval(timer);
  assert.ok(caught, 'the failure was handed to the caller');
  assert.match(caught.message, /disk is full/);
  assert.strictEqual(backups.listBackups().length, 0, 'and left nothing half-written');
});
