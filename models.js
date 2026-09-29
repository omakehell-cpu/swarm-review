'use strict';

// Everything the app asks of the database, by area. This file is the
// door: server.js asks for `models` and gets all of it, the way it always
// did. What changed is that the queries now live in files named after what
// they are about.
//
// Two modules exporting the same name would mean one of them silently
// winning, and the loser working everywhere except where it matters. So
// the merge is done by hand and a collision throws on startup.
const modules = [
  ['shared', require('./models/shared')],
  ['people', require('./models/people')],
  ['stories', require('./models/stories')],
  ['comments', require('./models/comments')],
  ['upkeep', require('./models/upkeep')],
  ['search', require('./models/search')],
  ['wiki', require('./models/wiki')],
  ['reading', require('./models/reading')],
  ['reviews', require('./models/reviews')],
  ['drafts', require('./models/drafts')],
  ['activity', require('./models/activity')],
  ['covers', require('./models/covers')],
  ['desk', require('./models/desk')],
  ['reactions', require('./models/reactions')],
  ['tags', require('./models/tags')],
  ['calendar', require('./models/calendar')],
  ['coauthors', require('./models/coauthors')],
  ['bible', require('./models/bible')],
  ['bibleEdits', require('./models/bible-edits')],
  ['characterStudy', require('./models/character-study')],
  ['chapters', require('./models/chapters')],
  ['writing', require('./models/writing')],
  ['imports', require('./models/imports')],
  ['storyGlossary', require('./models/story-glossary')],
  ['wikiLinks', require('./models/wiki-links')],
  ['front', require('./models/front')],
  ['follows', require('./models/follows')],
  ['authorPage', require('./models/author-page')],
];

const all = {};
for (const [name, mod] of modules) {
  for (const key of Object.keys(mod)) {
    if (key in all) throw new Error(`two models modules both export ${key} (${name} is the second)`);
    all[key] = mod[key];
  }
}

module.exports = all;
