'use strict';

// Auto-linking the story's own cast in its chapter text, the way the
// shared wiki's names are already auto-linked to the glossary.
//
// The asymmetry this removes: the app underlined names from somebody
// else's wiki and left your own characters -- the ones it knows the exact
// position of, because it scanned for them -- as plain words.
//
// Where the two collide the cast wins. A name that is both a wiki page and
// an entry in this story's bible means the author has written their own
// account of it, and their own account is the one their reader should get.

const storyBible = require('./story-bible');

// One compiled matcher per story, thrown away whenever that story's names
// change. Without it every chapter view would recompile a regex with one
// alternative per character, which for a cast of hundreds is real work to
// repeat on every page load.
const cache = new Map();

function invalidate(storyId) {
  if (storyId == null) cache.clear();
  else cache.delete(Number(storyId));
}

function matcherFor(storyId) {
  const key = Number(storyId);
  if (cache.has(key)) return cache.get(key);
  // Required here rather than at the top: models requires this module to
  // invalidate the cache, and a lazy require keeps that from being a cycle.
  const models = require('../models');
  const entities = models.listStoryEntities(storyId).map((e) => ({
    id: e.id,
    name: e.name,
    aliases: e.alias_list ? e.alias_list.split(', ') : [],
    summary: e.summary,
    kind: e.kind,
  }));
  const matcher = storyBible.buildMatcher(entities);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const built = { matcher, byId };
  cache.set(key, built);
  return built;
}

/** Where this story's cast is named in one piece of text. */
function findCastMatches(storyId, text) {
  const { matcher, byId } = matcherFor(storyId);
  const out = [];
  if (!matcher.regex) return out;
  matcher.regex.lastIndex = 0;
  let m;
  while ((m = matcher.regex.exec(text))) {
    const id = matcher.byLower.get(m[0].toLowerCase());
    const entity = id == null ? null : byId.get(id);
    if (!entity) continue;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      title: entity.name,
      summary: entity.summary || storyBible.KIND_LABELS[entity.kind] || '',
      url: `/bible/${entity.id}`,
      cast: true,
    });
  }
  return out;
}

/**
 * The matcher a chapter is rendered with: this story's cast, plus every
 * wiki name that does not sit on top of one of them.
 * @param {number} storyId
 * @param {((text: string) => any[])|null} findWikiMatches
 */
function combinedMatcher(storyId, findWikiMatches) {
  return (text) => {
    const cast = findCastMatches(storyId, text);
    if (!findWikiMatches) return cast;
    const wiki = findWikiMatches(text)
      .filter((w) => !cast.some((c) => w.start < c.end && c.start < w.end));
    return cast.concat(wiki).sort((a, b) => a.start - b.start);
  };
}

module.exports = { combinedMatcher, findCastMatches, invalidate, matcherFor };
