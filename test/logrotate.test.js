'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { rotateIfLarge, KEEP } = require('../lib/logrotate');

test('a large log is copied aside and cut back, keeping a few old copies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-log-'));
  const file = path.join(dir, 'server.log');
  // The server's own handle stays open across the rotation, as launchd's does.
  const fd = fs.openSync(file, 'a');
  fs.writeSync(fd, 'x'.repeat(200));
  assert.strictEqual(rotateIfLarge(file, 100), true);
  assert.strictEqual(fs.statSync(file).size, 0);
  assert.strictEqual(fs.readFileSync(`${file}.1`, 'utf8').length, 200);
  fs.writeSync(fd, 'after\n');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'after\n', 'the open handle writes at the start again');
  for (let i = 0; i < KEEP + 2; i++) {
    fs.writeSync(fd, 'y'.repeat(200));
    rotateIfLarge(file, 100);
  }
  assert.ok(fs.existsSync(`${file}.${KEEP}`));
  assert.ok(!fs.existsSync(`${file}.${KEEP + 1}`), 'older ones go');
  assert.strictEqual(rotateIfLarge(file, 100), false, 'a small log is left alone');
  fs.closeSync(fd);
});

test('no log, nothing to do', () => {
  assert.strictEqual(rotateIfLarge(path.join(os.tmpdir(), 'no-such-dir-xyz', 'server.log')), false);
});
