'use strict';

// The three looks the site can wear. The same pages, the same markup and
// the same one stylesheet underneath; a look is a set of overrides in
// public/css/looks.css, switched on by a data-look attribute that the
// layout writes into <html> for whoever is signed in. Server-side, so the
// page is painted in the right look from its first frame, with no flash
// of the other one.
//
// The key is what is stored in users.look. '' is the default and writes
// no attribute at all, which is also what a signed-out page gets.
const LOOKS = [
  { key: '', name: 'Clean', blurb: 'Ink on white, one red. The site as it was designed: nothing between you and the text.' },
  { key: 'literary', name: 'Literary', blurb: 'A magazine on paper: serif headings, the stories as a shelf of covers, a drop capital at the start of each chapter.' },
  { key: 'swarm', name: 'The Swarm', blurb: 'The ship’s console: ruled, monospace, alert-red. A pale bridge by day and a dark one by night, with the moon button; at night the chapter is on a dark page too.' },
];

const KEYS = new Set(LOOKS.map((l) => l.key));

/** The look to paint for this person: a known key, or the default. */
const lookFor = (user) => (user && KEYS.has(user.look) ? user.look : '');

/** A submitted value, cleaned: anything unknown is the default. */
const cleanLook = (value) => (KEYS.has(String(value || '')) ? String(value || '') : '');

module.exports = { LOOKS, cleanLook, lookFor };
