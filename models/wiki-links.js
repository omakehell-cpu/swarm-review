'use strict';

// Which wiki page is which story, and which is which imported author.
//
// The wiki keeps a page for most stories in the universe and for most of
// the people who write them, under a title that is nearly -- not always
// exactly -- the one on the story: "A Perfect 10 Part 1" for "A Perfect
// 10, Part 1", "Albion (story)" for "Albion". Two titles are the same page
// when they are the same letters and numbers: case, accents, punctuation
// and a trailing "(story)" do not count. Nothing looser than that, because
// "Mantrap" is not "Mantrap (Mousetrap 2)" just because one starts the
// other, and a wrong link is worse than none.

const { db } = require('./shared');

/** The part of a title that decides which page it is. */
function titleKey(title) {
  return String(title || '')
    .replace(/\s*\((?:story|novel|series)\)\s*$/i, '')
    .toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

/** The wiki's own pages, by key. The first title wins a tie. */
function wikiPagesByKey() {
  const map = new Map();
  for (const r of db.prepare('SELECT title FROM wiki_pages WHERE story_id IS NULL ORDER BY title').all()) {
    const key = titleKey(r.title);
    if (key && !map.has(key)) map.set(key, r.title);
  }
  return map;
}

/**
 * The glossary page for a story: the wiki's, when the wiki has one under
 * its title, or else the page made from the story itself.
 * @returns {{ title: string, fromWiki: boolean }|null}
 */
function glossaryPageForStory(story) {
  const wiki = wikiPagesByKey().get(titleKey(story.title));
  if (wiki) return { title: wiki, fromWiki: true };
  const own = db.prepare('SELECT title FROM wiki_pages WHERE story_id = ?').get(story.id);
  return own ? { title: own.title, fromWiki: false } : null;
}

/**
 * What in the group a wiki page is about: the stories under its title,
 * and the imported author who writes as its name.
 */
function groupThingsForWikiPage(page) {
  const key = titleKey(page.title);
  if (!key) return { stories: [], author: null };
  const stories = db.prepare(`
    SELECT s.id, s.title, u.display_name AS author_name, u.username AS author_username,
      (SELECT COUNT(*) FROM chapters c WHERE c.story_id = s.id AND c.archived_at IS NULL) AS chapters
    FROM stories s JOIN users u ON u.id = s.author_id
    WHERE s.archived_at IS NULL ORDER BY s.id
  `).all().filter((s) => titleKey(s.title) === key);
  const author = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.claimed_by, c.display_name AS claimed_by_name, c.username AS claimed_by_username,
      (SELECT COUNT(*) FROM stories s WHERE s.imported_author_id = u.id AND s.archived_at IS NULL) AS stories
    FROM users u LEFT JOIN users c ON c.id = u.claimed_by
    WHERE u.is_placeholder = 1
  `).all().find((u) => titleKey(u.display_name) === key) || null;
  return { stories, author };
}

/** The wiki page for an imported author's name, if the wiki has one. */
const wikiPageForName = (name) => wikiPagesByKey().get(titleKey(name)) || null;

module.exports = { glossaryPageForStory, groupThingsForWikiPage, titleKey, wikiPageForName, wikiPagesByKey };
