'use strict';

const { db } = require('./shared');
function listWikiPages() {
  return db.prepare('SELECT title, title_lower, summary FROM wiki_pages').all();
}


// Replaces the whole table in one transaction -- simpler and safer than
// diffing against the previous set (a renamed/deleted wiki page just
// disappears cleanly, rather than needing its own cleanup pass).
function replaceWikiPages(pages) {
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM wiki_pages');
    db.exec('DELETE FROM wiki_page_categories');
    const insert = db.prepare(
      'INSERT INTO wiki_pages (title, title_lower, summary, content_html) VALUES (?, ?, ?, ?)'
    );
    const file = db.prepare(
      'INSERT OR IGNORE INTO wiki_page_categories (title_lower, category) VALUES (?, ?)'
    );
    for (const p of pages) {
      const lower = p.title.toLowerCase();
      insert.run(p.title, lower, p.summary || '', p.contentHtml || null);
      for (const category of p.categories || []) file.run(lower, category);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}


// The wiki's categories, biggest first -- which is also roughly most
// useful first, and lets the glossary fold the long tail of two-page and
// bookkeeping categories behind one line instead of ranking them by hand.
const listWikiCategories = () => db.prepare(`
  SELECT c.category, COUNT(*) AS n
  FROM wiki_page_categories c
  JOIN wiki_pages p ON p.title_lower = c.title_lower
  GROUP BY c.category
  ORDER BY n DESC, c.category COLLATE NOCASE
`).all();


// Every page's categories in one query, so a listing of 691 pages does
// not make 691 more.
function categoriesByPage() {
  const rows = db.prepare(`
    SELECT title_lower, category FROM wiki_page_categories ORDER BY category COLLATE NOCASE
  `).all();
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.title_lower)) map.set(row.title_lower, []);
    map.get(row.title_lower).push(row.category);
  }
  return map;
}

const listWikiPagesInCategory = (category) => db.prepare(`
  SELECT p.title, p.title_lower, p.summary
  FROM wiki_pages p JOIN wiki_page_categories c ON c.title_lower = p.title_lower
  WHERE c.category = ?
  ORDER BY p.title COLLATE NOCASE
`).all(category);


// The summaries behind a set of links, for the previews a glossary entry
// shows in its margin. Titles come from hrefs this app wrote itself, but
// they are still parameterised -- a page title is content.
function summariesForTitles(titles) {
  const wanted = Array.from(new Set((titles || []).map((t) => String(t).toLowerCase()))).filter(Boolean);
  if (!wanted.length) return new Map();
  const rows = db.prepare(`
    SELECT title, title_lower, summary FROM wiki_pages
    WHERE title_lower IN (${wanted.map(() => '?').join(',')})
  `).all(...wanted);
  return new Map(rows.map((r) => [r.title_lower, { title: r.title, summary: r.summary }]));
}

// ---------- glossary (the in-app read-only mirror of the wiki) ----------

// Deliberately excludes content_html -- this listing renders every page's
// title (and, for search, its summary), and some wikis run into the
// thousands of pages, so pulling every page's full HTML body just to list
// titles would be wasted work for both SQLite and the response.
function listWikiPagesForGlossary() {
  return db.prepare('SELECT title, title_lower, summary FROM wiki_pages ORDER BY title COLLATE NOCASE').all();
}

function getWikiPageByTitleLower(titleLower) {
  return db.prepare('SELECT title, title_lower, summary, content_html, fetched_at FROM wiki_pages WHERE title_lower = ?').get(titleLower) || null;
}

function getWikiSyncState() {
  return db.prepare('SELECT * FROM wiki_sync_state WHERE id = 1').get() || null;
}


/** @param {{ status: string, pageCount?: number, error?: string|null }} state */
function setWikiSyncState({ status, pageCount, error }) {
  db.prepare(`
    INSERT INTO wiki_sync_state (id, last_synced_at, last_status, page_count, last_error)
    VALUES (1, datetime('now'), ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_synced_at = datetime('now'), last_status = excluded.last_status,
      page_count = excluded.page_count, last_error = excluded.last_error
  `).run(status, pageCount || 0, error || null);
}

// ---------- who has read what ----------

module.exports = {
  categoriesByPage,
  getWikiPageByTitleLower,
  getWikiSyncState,
  listWikiCategories,
  listWikiPages,
  listWikiPagesForGlossary,
  listWikiPagesInCategory,
  replaceWikiPages,
  setWikiSyncState,
  summariesForTitles,
};
