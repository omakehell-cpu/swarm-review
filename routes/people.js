'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { parseMarkdown, renderHighlighted } = require('../lib/markdown');
const { parseBody, redirect, sendHtml, sendJson } = require('../lib/util');
const models = require('../models');
const views = require('../views');
const wiki = require('../lib/wiki');
const { sendError } = require('./shared');
async function handleProfilePage(req, res, user, username) {
  const person = models.getUserByUsername(String(username).toLowerCase());
  if (!person || person.username === models.DELETED_USER_USERNAME) {
    return sendError(res, 404, 'No such person', user);
  }
  sendHtml(res, 200, views.profilePage({
    user,
    person,
    stats: models.userStats(person.id),
    stories: models.listStoriesForUser(person.id),
    chapters: models.listChaptersByUser(person.id),
  }));
}

async function handleSearch(req, res, user, query) {
  const q = (query.get('q') || '').trim();
  sendHtml(res, 200, views.searchPage({ user, query: q, results: models.searchEverything(q, { userId: user.id }) }));
}

// ---------- story tags (vocabulary curated on /admin, see models.js) ----------

async function handleStories(req, res, user, query) {
  const since = models.bumpLastSeen(user.id);
  // Two spellings on purpose: the filter form posts one `tag` per ticked
  // box, while a shared/bookmarked link is nicer as ?tags=a,b.
  const activeSlugs = [
    ...query.getAll('tag'),
    ...(query.get('tags') || '').split(','),
  ].map((s2) => s2.trim()).filter(Boolean);
  const activeTags = activeSlugs.map((slug) => models.getTagBySlug(slug)).filter(Boolean);
  const stories = models.listStories({ since, tagIds: activeTags.map((t) => t.id) });
  const tagsByStory = models.tagsForStories(stories.map((s2) => s2.id));
  const coauthorsByStory = models.coauthorsForStories(stories.map((s2) => s2.id));
  // A reader's hidden tags fold a story away rather than deleting it from
  // the list: they stay reachable behind a "show anyway" summary, since
  // hiding something outright makes an app feel broken when you know the
  // story exists but can't find it.
  const hiddenTagIds = new Set(models.listUserHiddenTagIds(user.id));
  const visible = [];
  const folded = [];
  for (const story of stories) {
    const tags = tagsByStory.get(story.id) || [];
    const hit = tags.filter((t) => hiddenTagIds.has(t.id));
    (hit.length ? folded : visible).push({ ...story, hiddenBy: hit });
  }
  sendHtml(res, 200, views.storiesPage({
    user, stories: visible, folded, since, tagsByStory, coauthorsByStory,
    activeTags, allGroups: models.listTagsGrouped(),
    inbox: models.inboxFor(user.id, { since }),
    activity: models.groupActivity(user),
    welcome: models.welcomeState(user),
  }));
}

async function handleActivity(req, res, user) {
  sendHtml(res, 200, views.activityPage({ user, activity: models.groupActivity(user, { limit: 80 }) }));
}

async function handleDismissWelcome(req, res, user) {
  models.dismissWelcome(user.id);
  redirect(res, '/');
}

// Renders arbitrary pasted/typed markdown to HTML using the exact same
// code that renders the real chapter page (renderHighlighted with an empty
// comment list), so the preview the writer sees while editing always
// matches what readers will actually see once it's published. Stateless --
// doesn't touch any story/chapter, so any logged-in user can call it.
async function handleMarkdownPreview(req, res, _user) {
  const body = await parseBody(req);
  const text = typeof body.text === 'string' ? body.text : '';
  // `plain` is the visual editor asking: it needs the text exactly as
  // written, and a glossary link it did not put there would come back to
  // it as a link the author never wrote.
  const html = renderHighlighted(parseMarkdown(text), [], body.plain ? null : wiki.findWikiMatches);
  sendJson(res, 200, { html });
}

// ---------------------------------------------------------------------
// router
// ---------------------------------------------------------------------

// The routes this file answers. server.js walks the tables in order
// and hands the first match a context: the request, the response, who is
// asking, the parsed URL and the regex groups.
/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['POST', '/markdown/preview', (c) => handleMarkdownPreview(c.req, c.res, c.user)],
  ['GET', '/search', (c) => handleSearch(c.req, c.res, c.user, c.url.searchParams)],
  ['GET', '/', (c) => handleStories(c.req, c.res, c.user, c.url.searchParams)],
  ['GET', '/activity', (c) => handleActivity(c.req, c.res, c.user)],
  ['POST', '/welcome/dismiss', (c) => handleDismissWelcome(c.req, c.res, c.user)],
  ['GET', /^\/users\/([A-Za-z0-9_.-]+)$/, (c) => handleProfilePage(c.req, c.res, c.user, c.m[1])],
];

module.exports = {
  handleMarkdownPreview,
  handleProfilePage,
  handleSearch,
  handleStories,
  routes,
};
