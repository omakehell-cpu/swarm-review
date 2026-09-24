'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { parseMarkdown, renderHighlighted } = require('../lib/markdown');
const { parseBody, parseMultipartBody, redirect, sendHtml, sendJson } = require('../lib/util');
const models = require('../models');
const shelves = require('../lib/story-shelves');
const docs = require('../lib/docs');
const views = require('../views');
const wiki = require('../lib/wiki');
const { UPLOAD_LIMIT_BYTES, extractUploadedText, sendError } = require('./shared');
async function handleProfilePage(req, res, user, username, query) {
  const person = models.getUserByUsername(String(username).toLowerCase());
  if (!person || person.username === models.DELETED_USER_USERNAME) {
    return sendError(res, 404, 'No such person', user);
  }
  // An imported author somebody has claimed is them now.
  if (person.is_placeholder && person.claimed_by) {
    const member = models.getUserById(person.claimed_by);
    if (member) return redirect(res, `/users/${encodeURIComponent(member.username)}`);
  }
  sendHtml(res, 200, views.profilePage({
    user,
    person,
    pendingClaim: person.is_placeholder ? models.pendingClaimBy(person.id, user.id) : null,
    notice: query ? (query.get('notice') || '').slice(0, 300) : '',
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
  // How the list is ordered: newest movement first (the default), A to Z,
  // or only the stories you write in. A plain GET parameter, so the
  // choice can be bookmarked and needs no script.
  const sort = ['title', 'mine'].includes(query.get('sort') || '') ? query.get('sort') : '';
  if (sort === 'title') stories.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
  const writesIn = (s2) => s2.author_id === user.id
    || (coauthorsByStory.get(s2.id) || []).some((c) => c.id === user.id);
  const hiddenTagIds = new Set(models.listUserHiddenTagIds(user.id));
  const visible = [];
  const folded = [];
  for (const story of stories) {
    if (sort === 'mine' && !writesIn(story)) continue;
    const tags = tagsByStory.get(story.id) || [];
    const hit = tags.filter((t) => hiddenTagIds.has(t.id));
    (hit.length ? folded : visible).push({ ...story, hiddenBy: hit });
  }
  // What changed on the site since they last looked, said once, here, and
  // then only under What's new until there is something newer. Somebody
  // still being welcomed has enough to read, so it is marked seen for them
  // without being shown; a filtered list is not the moment either.
  const welcome = models.welcomeState(user);
  let whatsNew = null;
  const unseen = activeTags.length ? [] : docs.unseenReleases(user);
  if (unseen.length) {
    if (!(welcome && welcome.show)) {
      whatsNew = {
        releases: unseen.slice(0, 3).map((r) => ({
          date: r.date, heading: r.heading, anchor: docs.releaseAnchor(r), highlights: docs.releaseHighlights(r.markdown),
        })),
        more: Math.max(0, unseen.length - 3),
      };
    }
    models.markChangelogSeen(user.id, docs.latestReleaseDate(), docs.latestReleaseKey());
    user = { ...user, changelog_seen_key: docs.latestReleaseKey() };
  }
  // Shelved: being written, complete or set aside, then searched, then
  // cut into pages (lib/story-shelves.js). The shelf the list opens on is
  // the stories still being written; a search counts every shelf.
  const shelfOptions = {
    shelf: query.get('shelf') || '', q: (query.get('q') || '').slice(0, 200), origin: query.get('origin') || '',
    series: query.get('series') || '', page: Number(query.get('page')) || 1, tagsByStory, coauthorsByStory,
  };
  let list = shelves.shelve(visible, shelfOptions);
  // A search that finds nothing on the shelf it started on, and something
  // elsewhere, shows everything it found rather than an empty shelf.
  if (!query.get('shelf') && list.q && !list.total && list.counts.all) {
    shelfOptions.shelf = 'all';
    list = shelves.shelve(visible, shelfOptions);
  }
  const view = query.get('view') === 'list' ? 'list' : '';
  const foldedHere = shelves.shelve(folded, { ...shelfOptions, page: 1 });
  sendHtml(res, 200, views.storiesPage({
    user, stories: list.stories, folded: folded.filter((s2) => foldedHere.stories.some((f) => f.id === s2.id)), since, tagsByStory, coauthorsByStory,
    list: { ...list, view },
    activeTags, allGroups: models.listTagsGrouped(), sort, totalStories: stories.length,
    inbox: models.inboxFor(user.id, { since }),
    activity: models.groupActivity(user),
    welcome, whatsNew,
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

// A file brought into the editor's box: its text, as Markdown, read the
// same way an upload is. Nothing is saved -- the editor puts it in the box.
async function handleMarkdownImport(req, res, _user) {
  const { files } = await parseMultipartBody(req, UPLOAD_LIMIT_BYTES);
  try {
    const text = await extractUploadedText(files.file);
    if (text === null) return sendJson(res, 400, { error: 'Choose a .md, .txt or .docx file.' });
    sendJson(res, 200, { text });
  } catch (err) {
    if (!err.userFacing) throw err;
    sendJson(res, 400, { error: err.message });
  }
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
  ['POST', '/markdown/import', (c) => handleMarkdownImport(c.req, c.res, c.user)],
  ['GET', '/search', (c) => handleSearch(c.req, c.res, c.user, c.url.searchParams)],
  ['GET', '/', (c) => handleStories(c.req, c.res, c.user, c.url.searchParams)],
  ['GET', '/activity', (c) => handleActivity(c.req, c.res, c.user)],
  ['POST', '/welcome/dismiss', (c) => handleDismissWelcome(c.req, c.res, c.user)],
  ['GET', /^\/users\/([A-Za-z0-9_.-]+)$/, (c) => handleProfilePage(c.req, c.res, c.user, c.m[1], c.url.searchParams)],
];

module.exports = {
  handleMarkdownPreview,
  handleProfilePage,
  handleSearch,
  handleStories,
  routes,
};
