'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { sendHtml } = require('../lib/util');
const { sendFragment } = require('./shared');
const wiki = require('../lib/wiki');
const models = require('../models');
const views = require('../views');
const taxonomy = require('../lib/glossary-taxonomy');

// wiki -- see lib/wiki.js) ----------
async function handleGlossaryIndex(req, res, user, query) {
  models.refreshStoryGlossary();
  const q = (query.get('q') || '').trim();
  const category = (query.get('category') || '').trim();
  const kind = (query.get('kind') || '').trim();
  const status = (query.get('status') || '').trim();
  const view = (query.get('view') || '').trim();
  const all = models.listWikiPagesForGlossary();
  const byPage = models.categoriesByPage();

  // No filter of any sort means the front page: three doors and a printed
  // directory, rather than dropping the reader into 691 rows.
  if (!q && !category && !kind && !status && view !== 'all') {
    return sendHtml(res, 200, views.glossaryDirectoryPage({
      user,
      totalPages: all.length,
      kinds: taxonomy.countKinds(all, byPage),
      families: taxonomy.groupIntoFamilies(models.listWikiCategories()),
    }));
  }

  const pages = taxonomy.selectPages(all, byPage, { kind, category, status, q });
  const heading = category || (kind && taxonomy.KIND_LABELS[kind])
    || (q ? `Search: ${q}` : 'Every page');
  // The state chips are counted before the state filter is applied, so
  // picking one does not make the others vanish from under the cursor.
  const beforeStatus = taxonomy.selectPages(all, byPage, { kind, category, q });
  sendHtml(res, 200, views.glossaryListPage({
    user, pages, byPage, heading, q, kind, category, status, view,
    letter: (query.get('letter') || '').trim().toUpperCase(),
    statusCounts: taxonomy.statusCounts(beforeStatus, byPage),
    totalPages: all.length,
  }));
}

async function handleGlossaryPage(req, res, user, title) {
  models.refreshStoryGlossary();
  const page = models.getWikiPageByTitleLower(title.toLowerCase());
  if (!page) return sendHtml(res, 404, views.glossaryNotFoundPage({ user, title }));
  // The summaries of everything this page links to, for the previews in
  // its margin. Read from the same local copy as the page itself -- the
  // glossary never reaches out to the wiki to render anything.
  const linked = (String(page.content_html || '').match(/<a href="\/glossary\/([^"]+)"/g) || [])
    .map((tag) => {
      const m = tag.match(/\/glossary\/([^"]+)/);
      try { return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; }
    })
    .filter(Boolean);
  sendHtml(res, 200, views.glossaryPage({
    user,
    page,
    summaries: models.summariesForTitles(linked),
    categories: models.categoriesByPage().get(page.title_lower) || [],
  }));
}

// The same page, with nothing around it, for the card beside a chapter.
// One page, one renderer: this is the page that already exists, asked for
// in a smaller shape.
function handleGlossaryBeside(req, res, user, title) {
  const page = models.getWikiPageByTitleLower(decodeURIComponent(title).toLowerCase());
  if (!page) return sendHtml(res, 404, views.glossaryNotFoundPage({ user, title }));
  sendFragment(res, views.besideGlossaryFragment(page, {
    lead: wiki.leadOf(page.content_html),
    categories: models.categoriesByPage().get(page.title_lower) || [],
  }), page.title);
}


// ---------- the whole story as one file (Scrivener's Compile) ----------

// The routes this file answers. server.js walks the tables in order
// and hands the first match a context: the request, the response, who is
// asking, the parsed URL and the regex groups.
/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['GET', '/glossary', (c) => handleGlossaryIndex(c.req, c.res, c.user, c.url.searchParams)],
  ['GET', /^\/glossary\/([^/]+)\/beside$/, (c) => handleGlossaryBeside(c.req, c.res, c.user, c.m[1])],
  ['GET', /^\/glossary\/([^/]+)$/, (c) => handleGlossaryPage(c.req, c.res, c.user, c.m[1])],
];

module.exports = {
  handleGlossaryBeside,
  handleGlossaryIndex,
  handleGlossaryPage,
  routes,
};
