'use strict';

// The two pages of writing that are about the app rather than in it: the
// how-tos and the changelog.
//
// Both are markdown files in docs/, not rows in a table. They are
// versioned with the code, they deploy with it, and the moment to write
// down what changed is the moment the change is made -- which is the only
// moment anybody actually remembers. A table would have to be filled in
// afterwards, by somebody who chose to.
//
// Files are read from disk and cached until their modification time
// changes, so editing one shows up without a restart, and a page view
// costs a stat rather than a read.

const fs = require('fs');
const path = require('path');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const HELP_DIR = path.join(DOCS_DIR, 'help');
const CHANGELOG_PATH = path.join(DOCS_DIR, 'CHANGELOG.md');

// "changelog" is a page of its own inside Help, so no how-to may claim it.
const RESERVED_SLUGS = new Set(['changelog']);

// Files are named `10-story-bible.md`: the number orders them, the rest is
// the slug. Ordering by filename beats a separate manifest that can
// disagree with the directory.
const FILE_NAME = /^(\d+)[-_]([a-z0-9-]+)\.md$/;

/** @type {Map<string, {mtime: number|string, value: any}>} */
const cache = new Map();

function cached(key, file, build) {
  let mtime;
  try { mtime = fs.statSync(file).mtimeMs; } catch (err) { mtime = 0; }
  const hit = cache.get(key);
  if (hit && hit.mtime === mtime) return hit.value;
  const value = build();
  cache.set(key, { mtime, value });
  return value;
}

// The whole directory's freshness in one number, so the index does not
// need a cache entry per file.
function helpDirStamp() {
  try {
    const names = fs.readdirSync(HELP_DIR).sort();
    return names.map((n) => `${n}:${fs.statSync(path.join(HELP_DIR, n)).mtimeMs}`).join('|');
  } catch (err) {
    return '';
  }
}

// The title is the first `# heading`; the summary is the first paragraph
// after it. Both are just the top of the file, so there is no front matter
// to keep in step with the prose underneath it.
function readHead(markdown) {
  const lines = String(markdown || '').split('\n');
  let title = '';
  const summary = [];
  let i = 0;
  for (; i < lines.length; i += 1) {
    const m = /^#\s+(.+)$/.exec(lines[i]);
    if (m) { title = m[1].trim(); i += 1; break; }
  }
  for (; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) { if (summary.length) break; continue; }
    if (line.startsWith('#') || line.startsWith('@figure')) break;
    summary.push(line);
  }
  return { title, summary: summary.join(' ') };
}

/** Every how-to, in the order their filenames put them. */
function listHelpTopics() {
  const stamp = helpDirStamp();
  const hit = cache.get('help:index');
  if (hit && hit.mtime === stamp) return hit.value;
  let names;
  try { names = fs.readdirSync(HELP_DIR); } catch (err) { names = []; }
  const topics = names
    .map((name) => ({ name, match: FILE_NAME.exec(name) }))
    .filter((f) => f.match && !RESERVED_SLUGS.has(f.match[2]))
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]) || a.name.localeCompare(b.name))
    .map((f) => {
      const markdown = fs.readFileSync(path.join(HELP_DIR, f.name), 'utf8');
      const head = readHead(markdown);
      return { slug: f.match[2], title: head.title || f.match[2], summary: head.summary };
    });
  cache.set('help:index', { mtime: stamp, value: topics });
  return topics;
}

/**
 * One how-to by its slug. The slug is matched against the directory
 * listing rather than turned into a path, so nothing a reader types
 * reaches the filesystem.
 */
function getHelpTopic(slug) {
  const wanted = String(slug || '');
  if (!/^[a-z0-9-]+$/.test(wanted) || RESERVED_SLUGS.has(wanted)) return null;
  let names;
  try { names = fs.readdirSync(HELP_DIR); } catch (err) { return null; }
  const file = names.find((name) => {
    const m = FILE_NAME.exec(name);
    return m && m[2] === wanted;
  });
  if (!file) return null;
  const full = path.join(HELP_DIR, file);
  return cached(`help:${wanted}`, full, () => {
    const markdown = fs.readFileSync(full, 'utf8');
    const head = readHead(markdown);
    // The page prints the title itself, so the body starts after it --
    // otherwise every how-to opens by saying its own name twice.
    const body = markdown.replace(/^[\s\S]*?^#\s+.*$\n?/m, '');
    return { slug: wanted, title: head.title || wanted, summary: head.summary, markdown, body };
  });
}

// A release is a `## 2026-09-15` heading and everything under it. Dates
// are ISO because they sort, and because the page renders them in the
// reader's own locale anyway.
const RELEASE_HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\s*(?:[-—]\s*(.*))?$/;

/** The changelog, newest first, cut into dated batches. */
function listReleases() {
  return cached('changelog', CHANGELOG_PATH, () => {
    let text;
    try { text = fs.readFileSync(CHANGELOG_PATH, 'utf8'); } catch (err) { return []; }
    const releases = [];
    let current = null;
    for (const line of text.split('\n')) {
      const m = RELEASE_HEADING.exec(line);
      if (m) {
        current = { date: m[1], heading: (m[2] || '').trim(), lines: [] };
        releases.push(current);
        continue;
      }
      if (current) current.lines.push(line);
    }
    return releases.map((r) => ({
      date: r.date, heading: r.heading, markdown: r.lines.join('\n').trim(),
    }));
  });
}

/** The date of the newest batch, or null when there is no changelog. */
function latestReleaseDate() {
  const releases = listReleases();
  return releases.length ? releases[0].date : null;
}

// A batch is known by its date and its title together: several can land
// on the same day, and the date alone would call the second one seen.
/** @param {{date: string, heading?: string}} release */
function releaseKey(release) {
  return `${release.date}|${release.heading || ''}`;
}

/** The newest batch's key, or null when there is no changelog. */
function latestReleaseKey() {
  const releases = listReleases();
  return releases.length ? releaseKey(releases[0]) : null;
}

/** Where a batch sits on the What's new page, for linking straight to it. */
/** @param {{date: string, heading?: string}} release */
function releaseAnchor(release) {
  const slug = String(release.heading || '').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `release-${release.date}${slug ? `-${slug}` : ''}`;
}

/**
 * The batches this person has not seen, newest first. What they last saw
 * is its own pair of columns: marking the changelog read must not also
 * mark every chapter read. The key says exactly which batch was newest
 * when they looked; the date is the fallback for somebody who last looked
 * before there were keys, or whose batch has since been retitled.
 * @param {{changelog_seen_at?: string|null, changelog_seen_key?: string|null}|null} user
 */
function unseenReleases(user) {
  if (!user) return [];
  const releases = listReleases();
  const key = user.changelog_seen_key;
  if (key) {
    const index = releases.findIndex((r) => releaseKey(r) === key);
    if (index >= 0) return releases.slice(0, index);
  }
  const seen = user.changelog_seen_at;
  // Never opened it: everything is new.
  if (!seen) return releases;
  // `seen` is a SQLite datetime ("2026-09-15 18:20:00"); comparing its
  // date half with an ISO date is a plain string comparison.
  const day = String(seen).slice(0, 10);
  return releases.filter((r) => r.date > day);
}

/** @param {{changelog_seen_at?: string|null, changelog_seen_key?: string|null}|null} user */
function hasUnreadReleases(user) {
  return unseenReleases(user).length > 0;
}

/**
 * The bold lead-ins of a batch's bullets -- "Skip links", "Nothing between
 * you and the book" -- which is what a batch is about in a few words.
 * Plain text: whatever else the markdown holds is dropped.
 */
function releaseHighlights(markdown, max = 4) {
  const out = [];
  for (const line of String(markdown || '').split('\n')) {
    const m = /^\s*[-*]\s+\*\*(.+?)\*\*/.exec(line);
    if (!m) continue;
    out.push(m[1].replace(/[*_`]/g, '').replace(/[.:,;\s]+$/, '').trim());
    if (out.length >= max) break;
  }
  return out.filter(Boolean);
}


// ---------- figures ----------
// A how-to wants screenshots, and markdown images are deliberately off in
// this app's parser: enabling them would let any chapter carry an <img>
// pointing anywhere, which is a request leaving this server on somebody
// else's behalf -- a tracking pixel in a novel. So a figure is its own
// line, in a syntax only these files use:
//
//   @figure bible-index.png | The bible front page, doors and all.
//
// The name is a filename and nothing else: no slashes, no scheme, no dots
// beyond the extension. It can only ever name a file this repository
// shipped in public/img/help/.
const FIGURE_LINE = /^@figure\s+([a-z0-9][a-z0-9-]*\.(?:png|jpg|webp))\s*(?:\|\s*(.*))?$/;

const FIGURE_URL_BASE = '/img/help/';

/**
 * Splits a how-to into the prose between its figures. The caller renders
 * the markdown pieces however it renders markdown, and the figures as
 * pictures -- which keeps the parser out of it entirely.
 * @param {string} markdown
 * @returns {({type: 'markdown', value: string}|{type: 'figure', src: string, caption: string})[]}
 */
function splitFigures(markdown) {
  const out = [];
  let buffer = [];
  const flush = () => {
    const value = buffer.join('\n').trim();
    if (value) out.push({ type: 'markdown', value });
    buffer = [];
  };
  for (const line of String(markdown || '').split('\n')) {
    const m = FIGURE_LINE.exec(line.trim());
    if (!m) { buffer.push(line); continue; }
    flush();
    out.push({ type: 'figure', src: `${FIGURE_URL_BASE}${m[1]}`, caption: (m[2] || '').trim() });
  }
  flush();
  return out;
}

module.exports = {
  FIGURE_URL_BASE,
  splitFigures,
  CHANGELOG_PATH,
  DOCS_DIR,
  HELP_DIR,
  getHelpTopic,
  hasUnreadReleases,
  latestReleaseDate,
  latestReleaseKey,
  releaseAnchor,
  releaseHighlights,
  releaseKey,
  unseenReleases,
  listHelpTopics,
  listReleases,
  readHead,
};
