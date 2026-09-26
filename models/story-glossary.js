'use strict';

// A glossary page for every story written here.
//
// The glossary is a copy of the shared-universe wiki, and the wiki already
// keeps a page per story -- for the stories published out there. The ones
// being written in this group have none until somebody writes it by hand,
// so this module writes it for them: a page per story, made from the story
// itself (who wrote it, how far it has got, its chapters, who is in it),
// kept in the same table as the wiki's pages so the glossary lists,
// filters, searches and shows it like any other entry.
//
// They are marked by story_id and are never the wiki's to replace: a sync
// clears only the wiki's own pages. Where the wiki has a page of the same
// title, the wiki's page is the one the glossary keeps.

const { db } = require('./shared');
const { escapeHtml } = require('../lib/util');
const { titleKey, wikiPagesByKey } = require('./wiki-links');

// The categories a story page is filed under: Stories is the one the
// glossary's kinds are sorted by; In this group tells them from the wiki's.
const STORY_CATEGORIES = ['Stories', 'In this group'];
const STATUS_WORDS = { ongoing: 'Being written', complete: 'Finished', dropped: 'Set aside' };
const SUMMARY_CHARS = 220;
const MAX_PEOPLE = 40;

function shortSummary(description, byline) {
  const text = String(description || '').replace(/\s+/g, ' ').trim();
  if (!text) return `A story by ${byline}.`;
  if (text.length <= SUMMARY_CHARS) return text;
  const cut = text.slice(0, SUMMARY_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 60)).replace(/[,;:.\s]+$/, '')}…`;
}

const paragraphs = (text) => String(text || '').split(/\n\s*\n/)
  .map((p) => p.trim()).filter(Boolean)
  .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');

const personLink = (p) => `<a href="/users/${encodeURIComponent(p.username)}">${escapeHtml(p.display_name)}</a>`;

function listWords(items) {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Every story still being shown, as the glossary page it should have. */
function storyGlossaryPages() {
  const stories = db.prepare(`
    SELECT s.id, s.title, s.description, s.status, s.series, s.created_at, s.bible_private,
      s.source_url, u.display_name, u.username
    FROM stories s JOIN users u ON u.id = s.author_id
    WHERE s.archived_at IS NULL
    ORDER BY s.id
  `).all();
  const coauthors = db.prepare(`
    SELECT u.display_name, u.username FROM story_authors sa JOIN users u ON u.id = sa.user_id
    WHERE sa.story_id = ? ORDER BY sa.added_at
  `);
  const chapters = db.prepare(`
    SELECT c.id, c.title,
      (SELECT v.word_count FROM chapter_versions v WHERE v.chapter_id = c.id
        ORDER BY v.version_number DESC LIMIT 1) AS words
    FROM chapters c WHERE c.story_id = ? AND c.archived_at IS NULL
    ORDER BY c.chapter_number
  `);
  const tags = db.prepare(`
    SELECT t.name FROM tags t JOIN story_tags st ON st.tag_id = t.id
    WHERE st.story_id = ? ORDER BY t.name COLLATE NOCASE
  `);
  const people = db.prepare(`
    SELECT id, name, summary FROM story_entities
    WHERE story_id = ? AND kind = 'person' ORDER BY name COLLATE NOCASE LIMIT ${MAX_PEOPLE}
  `);

  return stories.map((s) => {
    const writers = [s, ...coauthors.all(s.id)];
    const byline = listWords(writers.map((w) => escapeHtml(w.display_name)));
    const chs = chapters.all(s.id);
    const words = chs.reduce((n, c) => n + (Number(c.words) || 0), 0);
    const tagNames = tags.all(s.id).map((t) => t.name);
    // A private bible stays private: its people are not listed here.
    const cast = s.bible_private ? [] : people.all(s.id);

    const facts = [
      `<li>Written by ${listWords(writers.map(personLink))}</li>`,
      `<li>${STATUS_WORDS[s.status] || STATUS_WORDS.ongoing}; ${chs.length} chapter${chs.length === 1 ? '' : 's'}, ${words.toLocaleString('en')} words</li>`,
      s.series ? `<li>Part of ${escapeHtml(s.series)}</li>` : '',
      tagNames.length ? `<li>Tagged ${tagNames.map((t) => escapeHtml(t)).join(', ')}</li>` : '',
      s.source_url ? `<li>First published on <a href="${escapeHtml(s.source_url)}" rel="noopener noreferrer">StoriesOnline</a></li>` : '',
    ].filter(Boolean).join('\n');

    const html = [
      `<p><em>${escapeHtml(s.title)}</em> is a story by ${byline}, ${s.source_url ? 'brought into this group from StoriesOnline' : 'written in this group'}. <a href="/stories/${s.id}">Read it here</a>.</p>`,
      paragraphs(s.description),
      `<h2>The story</h2>\n<ul>\n${facts}\n</ul>`,
      chs.length
        ? `<h2>Chapters</h2>\n<ol>\n${chs.map((c) => `<li><a href="/chapters/${c.id}">${escapeHtml(c.title)}</a></li>`).join('\n')}\n</ol>`
        : '',
      cast.length
        ? `<h2>Who is in it</h2>\n<ul>\n${cast.map((p) => `<li><a href="/bible/${p.id}">${escapeHtml(p.name)}</a>${p.summary ? ` &mdash; ${escapeHtml(p.summary)}` : ''}</li>`).join('\n')}\n</ul>`
        : '',
    ].filter(Boolean).join('\n');

    return {
      storyId: s.id,
      title: s.title,
      summary: shortSummary(s.description, writers.map((w) => w.display_name).join(', ')),
      contentHtml: html,
    };
  });
}

const textOf = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

/**
 * Brings the story pages in line with the stories: new stories get one,
 * changed ones are rewritten, archived and deleted ones lose theirs.
 * Writes nothing when nothing changed, so it is cheap to call often.
 * @returns {{ added: number, changed: number, removed: number }}
 */
function refreshStoryGlossary() {
  const wanted = storyGlossaryPages();
  const have = new Map(db.prepare(`
    SELECT id, story_id, title, summary, content_html FROM wiki_pages WHERE story_id IS NOT NULL
  `).all().map((r) => [Number(r.story_id), r]));
  // One page per title: the wiki's first, then the oldest story's. Titles
  // are compared by their letters and numbers (models/wiki-links.js), so
  // "A Perfect 10, Part 1" is the wiki's "A Perfect 10 Part 1", not a
  // second page beside it.
  const taken = new Set(wikiPagesByKey().keys());
  const keep = [];
  for (const page of wanted) {
    const key = titleKey(page.title);
    if (taken.has(key)) continue;
    taken.add(key);
    keep.push(page);
  }

  const counts = { added: 0, changed: 0, removed: 0 };
  const keepIds = new Set(keep.map((p) => p.storyId));
  const stale = [...have.values()].filter((r) => !keepIds.has(Number(r.story_id)));
  const filed = new Map();
  for (const r of db.prepare(`
    SELECT c.title_lower, c.category FROM wiki_page_categories c
    JOIN wiki_pages p ON p.title_lower = c.title_lower WHERE p.story_id IS NOT NULL ORDER BY c.category
  `).all()) filed.set(r.title_lower, [...(filed.get(r.title_lower) || []), r.category]);
  const expected = [...STORY_CATEGORIES].sort().join('|');
  const moved = keep.filter((p) => {
    const row = have.get(p.storyId);
    return !row || row.title !== p.title || row.summary !== p.summary || row.content_html !== p.contentHtml
      || (filed.get(row.title.toLowerCase()) || []).join('|') !== expected;
  });
  if (!stale.length && !moved.length) return counts;

  const remove = db.prepare('DELETE FROM wiki_pages WHERE id = ?');
  const uncategorise = db.prepare('DELETE FROM wiki_page_categories WHERE title_lower = ?');
  const insert = db.prepare(`
    INSERT INTO wiki_pages (title, title_lower, summary, content_html, content_text, story_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const file = db.prepare('INSERT OR IGNORE INTO wiki_page_categories (title_lower, category) VALUES (?, ?)');

  db.exec('BEGIN');
  try {
    for (const row of [...stale, ...moved.map((p) => have.get(p.storyId)).filter(Boolean)]) {
      remove.run(row.id);
      uncategorise.run(row.title.toLowerCase());
    }
    for (const p of moved) {
      const lower = p.title.toLowerCase();
      insert.run(p.title, lower, p.summary, p.contentHtml, textOf(p.contentHtml), p.storyId);
      for (const c of STORY_CATEGORIES) file.run(lower, c);
      counts[have.has(p.storyId) ? 'changed' : 'added'] += 1;
    }
    counts.removed = stale.length;
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return counts;
}

// After anything that might have changed a story. Coalesced, so a burst of
// saves is one refresh, and off the request, so nobody waits for it.
let pending = null;
function scheduleStoryGlossaryRefresh() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    try { refreshStoryGlossary(); } catch (err) { console.error('story glossary refresh failed:', err.message); }
  }, 300);
  if (pending.unref) pending.unref();
}

module.exports = {
  STORY_CATEGORIES,
  refreshStoryGlossary,
  scheduleStoryGlossaryRefresh,
  storyGlossaryPages,
};
