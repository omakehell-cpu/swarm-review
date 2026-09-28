'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { redirect, sendHtml } = require('../lib/util');
const models = require('../models');
const views = require('../views');
const docs = require('../lib/docs');
const { sendError } = require('./shared');
async function handleHelpIndex(req, res, user) {
  sendHtml(res, 200, views.helpIndexPage({
    user,
    topics: docs.listHelpTopics(),
    releases: docs.listReleases(),
    unread: docs.hasUnreadReleases(user),
  }));
}

async function handleChangelog(req, res, user) {
  // What they had seen before this visit is what the marks are about, so
  // it is read first and the column moved on afterwards.
  const unseen = new Set(docs.unseenReleases(user).map(docs.releaseKey));
  models.markChangelogSeen(user.id, docs.latestReleaseDate(), docs.latestReleaseKey());
  // The nav's dot is about this very page, so it goes now, not next time.
  const seenUser = { ...user, changelog_seen_key: docs.latestReleaseKey() };
  sendHtml(res, 200, views.changelogPage({ user: seenUser, releases: docs.listReleases(), unseen }));
}

// Pages that have been renamed, so an old link -- in a note, a bookmark,
// last month's changelog -- still lands on the page it meant.
const MOVED_TOPICS = {
  'story-bible': 'story-notes',
  'your-first-cast': 'your-first-characters',
};

async function handleHelpTopic(req, res, user, slug) {
  if (MOVED_TOPICS[slug]) return redirect(res, `/help/${MOVED_TOPICS[slug]}`);
  const topic = docs.getHelpTopic(slug);
  if (!topic) return sendError(res, 404, 'No such how-to', user);
  sendHtml(res, 200, views.helpTopicPage({ user, topic, topics: docs.listHelpTopics() }));
}

// ---------- the story bible (per story: its people, places and things) ----------

// The routes this file answers. server.js walks the tables in order
// and hands the first match a context: the request, the response, who is
// asking, the parsed URL and the regex groups.
/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['GET', '/help', (c) => handleHelpIndex(c.req, c.res, c.user)],
  ['GET', '/help/changelog', (c) => handleChangelog(c.req, c.res, c.user)],
  ['GET', /^\/help\/([a-z0-9-]+)$/, (c) => handleHelpTopic(c.req, c.res, c.user, c.m[1])],
];

module.exports = {
  handleChangelog,
  handleHelpIndex,
  handleHelpTopic,
  routes,
};
