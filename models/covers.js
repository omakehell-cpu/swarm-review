'use strict';

const { db } = require('./shared');

// ---------- story covers ----------
//
// One picture per story, chosen by its author. Setting a new one hands
// back the old file's name so the caller can take it off the disk; the
// database never points at a file that is not there, and the disk does
// not fill up with covers nobody can reach.

const clampPercent = (n) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 50;
};

/** @returns {string|null} the file this replaced, if any */
function setStoryCover(storyId, { filename, contentType }) {
  const before = db.prepare('SELECT cover_filename FROM stories WHERE id = ?').get(storyId);
  db.prepare(`
    UPDATE stories SET cover_filename = ?, cover_type = ?, cover_focus_x = 50, cover_focus_y = 50 WHERE id = ?
  `).run(filename, contentType, storyId);
  return before ? before.cover_filename : null;
}

/** @returns {string|null} the file that was the cover, if any */
function clearStoryCover(storyId) {
  const before = db.prepare('SELECT cover_filename FROM stories WHERE id = ?').get(storyId);
  db.prepare('UPDATE stories SET cover_filename = NULL, cover_type = NULL WHERE id = ?').run(storyId);
  return before ? before.cover_filename : null;
}

function setStoryCoverFocus(storyId, focusX, focusY) {
  db.prepare('UPDATE stories SET cover_focus_x = ?, cover_focus_y = ? WHERE id = ?')
    .run(clampPercent(focusX), clampPercent(focusY), storyId);
}

module.exports = { clearStoryCover, setStoryCover, setStoryCoverFocus };
