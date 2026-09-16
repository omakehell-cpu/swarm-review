'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { sendHtml } = require('../lib/util');
const models = require('../models');
const views = require('../views');

async function handleTagsIndex(req, res, user) {
  sendHtml(res, 200, views.tagsIndexPage({ user, groups: models.listTagsGrouped() }));
}

async function handleTagPage(req, res, user, slug) {
  const tag = models.getTagBySlug(slug);
  if (!tag) return sendHtml(res, 404, views.tagNotFoundPage({ user, slug }));
  const stories = models.listStories({ tagIds: [tag.id] });
  const tagsByStory = models.tagsForStories(stories.map((s) => s.id));
  sendHtml(res, 200, views.tagPage({ user, tag, stories, tagsByStory }));
}

// The routes this file answers. server.js walks the tables in order
// and hands the first match a context: the request, the response, who is
// asking, the parsed URL and the regex groups.
/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['GET', '/tags', (c) => handleTagsIndex(c.req, c.res, c.user)],
  ['GET', /^\/tags\/([^/]+)$/, (c) => handleTagPage(c.req, c.res, c.user, c.m[1])],
];

module.exports = {
  handleTagPage,
  handleTagsIndex,
  routes,
};
