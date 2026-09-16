'use strict';

// Every page in the app, by area. This file is the door: server.js asks
// for `views` and gets all of them, the way it always did. What changed is
// that the pages now live in files named after what they are, instead of
// in one file of three and a half thousand lines.
//
// Two modules exporting the same name would mean one of them silently
// winning, and the loser working everywhere except where it matters. So
// the merge is done by hand and a collision throws on startup.
const modules = [
  ['shared', require('./views/shared')],
  ['auth', require('./views/auth')],
  ['glossary', require('./views/glossary')],
  ['help', require('./views/help')],
  ['bible', require('./views/bible')],
  ['stories', require('./views/stories')],
  ['story', require('./views/story')],
  ['analysis', require('./views/analysis')],
  ['writing', require('./views/writing')],
  ['chapter', require('./views/chapter')],
  ['people', require('./views/people')],
  ['admin', require('./views/admin')],
];

const all = {};
for (const [name, mod] of modules) {
  for (const key of Object.keys(mod)) {
    if (key in all) throw new Error(`two views modules both export ${key} (${name} is the second)`);
    all[key] = mod[key];
  }
}

module.exports = all;
