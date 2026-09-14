// Points db.js at a throwaway SQLite file before anything requires it, so a
// test run never touches data/swarm-review.sqlite. Call this at the very
// top of a test file -- above the requires that pull in db.js, directly or
// through models.js -- because db.js reads the path once, on load.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function useTempDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-review-test-'));
  const file = path.join(dir, 'test.sqlite');
  process.env.SWARM_DB_PATH = file;
  return {
    file,
    dir,
    cleanup() {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

module.exports = { useTempDatabase };
