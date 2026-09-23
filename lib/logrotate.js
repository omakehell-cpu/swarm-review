'use strict';

// Keeping server.log from growing for ever.
//
// launchd opens the log and hands the server its file descriptor; the
// server never opens it itself. So the file cannot be renamed out from
// under it -- launchd would carry on writing into the renamed file. What
// works is copy-and-truncate: copy the log aside as server.log.1 (pushing
// the older copies down), then cut the live file back to nothing. The
// descriptor is opened for appending, so the next line lands at the
// start of the now-empty file rather than after a hole.
//
// Where the log is comes from SWARM_LOG_PATH, or server.log beside the
// app. No file there (a Docker install, a terminal session) means nothing
// to do.

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP = 3;
const CHECK_EVERY_MS = 60 * 60 * 1000;

function logPath() {
  return process.env.SWARM_LOG_PATH || path.join(__dirname, '..', 'server.log');
}

/**
 * Rotates if the log has outgrown MAX_BYTES. Returns true when it did.
 * @param {string} [file] @param {number} [maxBytes]
 */
function rotateIfLarge(file = logPath(), maxBytes = MAX_BYTES) {
  let size;
  try { size = fs.statSync(file).size; } catch (err) { return false; }
  if (size <= maxBytes) return false;
  for (let i = KEEP - 1; i >= 1; i--) {
    try { fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`); } catch (err) { /* no such copy yet */ }
  }
  fs.copyFileSync(file, `${file}.1`);
  fs.truncateSync(file, 0);
  try { fs.unlinkSync(`${file}.${KEEP + 1}`); } catch (err) { /* nothing that old */ }
  return true;
}

/** @param {(err: Error) => void} [onError] */
function startLogRotation(onError) {
  const tick = () => {
    try { rotateIfLarge(); } catch (err) { if (onError) onError(/** @type {Error} */ (err)); }
  };
  tick();
  const timer = setInterval(tick, CHECK_EVERY_MS);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { KEEP, MAX_BYTES, logPath, rotateIfLarge, startLogRotation };
