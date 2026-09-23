'use strict';

const test = require('node:test');
const assert = require('node:assert');
const docs = require('../lib/docs');

// The how-tos and the changelog are files on disk rather than rows in a
// table, which trades one kind of mistake for another: nothing can be
// half-written, but a file can be named wrong and silently vanish. These
// tests are about the naming and the reading.

test('the how-tos are found, in the order their filenames put them', () => {
  const topics = docs.listHelpTopics();
  assert.ok(topics.length >= 5, 'the shipped how-tos are there');
  for (const topic of topics) {
    assert.match(topic.slug, /^[a-z0-9-]+$/);
    assert.ok(topic.title, `${topic.slug} has a title`);
    assert.ok(topic.summary, `${topic.slug} has a summary`);
  }
  // The numeric prefix orders them and is not part of the slug.
  assert.strictEqual(topics[0].slug, 'finding-your-way');
  assert.ok(topics.some((t) => t.slug === 'story-bible'));
});

test('a slug is matched against the directory, never turned into a path', () => {
  assert.ok(docs.getHelpTopic('story-bible'));
  for (const bad of ['../CHANGELOG', '../../package', 'Story-Bible', 'story bible', '', 'changelog']) {
    assert.strictEqual(docs.getHelpTopic(bad), null, `${bad} is refused`);
  }
});

test('the title and summary are the top of the file, not front matter', () => {
  const head = docs.readHead('# A title\n\nThe first paragraph,\nover two lines.\n\nThe second.\n\n## A heading\n');
  assert.strictEqual(head.title, 'A title');
  assert.strictEqual(head.summary, 'The first paragraph, over two lines.');
  // A file that never gets going says so rather than guessing.
  assert.deepStrictEqual(docs.readHead('no heading here'), { title: '', summary: '' });
});

test('the changelog comes back as dated batches, newest first', () => {
  const releases = docs.listReleases();
  assert.ok(releases.length >= 3);
  for (const release of releases) assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
  const dates = releases.map((r) => r.date);
  assert.deepStrictEqual(dates, dates.slice().sort().reverse(), 'newest first');
  assert.ok(releases[0].heading, 'a batch says what it was about');
  assert.ok(releases[0].markdown.includes('-'), 'and carries its own list');
});

test('what counts as unread is the newest batch against your own column', () => {
  const latest = docs.latestReleaseDate();
  assert.ok(latest);
  // Never opened it.
  assert.strictEqual(docs.hasUnreadReleases({ changelog_seen_at: null }), true);
  // Opened it after the last batch.
  assert.strictEqual(docs.hasUnreadReleases({ changelog_seen_at: '2099-01-01 00:00:00' }), false);
  // Opened it before.
  assert.strictEqual(docs.hasUnreadReleases({ changelog_seen_at: '2000-01-01 00:00:00' }), true);
  // Opened it the same day as the newest batch: nothing new.
  assert.strictEqual(docs.hasUnreadReleases({ changelog_seen_at: `${latest} 23:59:00` }), false);
  assert.strictEqual(docs.hasUnreadReleases(null), false);
});

// ---------- figures ----------
// Markdown images are off in this app's parser on purpose, so a how-to's
// screenshots come through a syntax only these files use. The rules it
// follows are the whole of its safety.

test('a figure names a file this repository shipped, and nothing else', () => {
  const parts = docs.splitFigures([
    'Before.',
    '@figure bible-index.png | A caption.',
    'After.',
  ].join('\n\n'));
  assert.deepStrictEqual(parts.map((p) => p.type), ['markdown', 'figure', 'markdown']);
  const figure = /** @type {{type: 'figure', src: string, caption: string}} */ (parts[1]);
  assert.strictEqual(figure.src, '/img/help/bible-index.png');
  assert.strictEqual(figure.caption, 'A caption.');

  // Anything that is not a plain filename is not a figure -- it stays as
  // the literal text somebody typed, which is visible and obvious, rather
  // than becoming a request leaving this server.
  for (const bad of [
    '@figure ../../etc/passwd',
    '@figure /img/help/a.png',
    '@figure https://example.com/pixel.png',
    '@figure a.png.svg',
    '@figure A.PNG',
    '@figure evil.png; rm -rf',
  ]) {
    const parts2 = docs.splitFigures(bad);
    assert.ok(!parts2.some((p) => p.type === 'figure'), `${bad} is not a figure`);
  }
});

test('every figure a shipped how-to asks for actually exists', () => {
  const fs2 = require('node:fs');
  const path2 = require('node:path');
  const root = path2.join(__dirname, '..', 'public', 'img', 'help');
  let used = 0;
  for (const topic of docs.listHelpTopics()) {
    const full = docs.getHelpTopic(topic.slug);
    for (const raw of docs.splitFigures(full.markdown)) {
      if (raw.type !== 'figure') continue;
      const part = /** @type {{type: 'figure', src: string, caption: string}} */ (raw);
      used += 1;
      const file = path2.join(root, part.src.replace(docs.FIGURE_URL_BASE, ''));
      assert.ok(fs2.existsSync(file), `${part.src} is on disk (used by ${topic.slug})`);
      assert.ok(part.caption, `${part.src} has a caption, for the alt text`);
    }
  }
  assert.ok(used >= 10, 'the how-tos are illustrated');
});

test('a figure line never gets mistaken for the summary', () => {
  const head = docs.readHead('# A title\n\n@figure a.png | A caption.\n\nThe real first paragraph.\n');
  assert.strictEqual(head.summary, '');
});

test('every link from one how-to to another goes somewhere', () => {
  const slugs = new Set(docs.listHelpTopics().map((t) => t.slug).concat(['changelog']));
  let links = 0;
  for (const topic of docs.listHelpTopics()) {
    const full = docs.getHelpTopic(topic.slug);
    for (const m of full.markdown.matchAll(/\]\(\/help\/([a-z0-9-]+)\)/g)) {
      links += 1;
      assert.ok(slugs.has(m[1]), `/help/${m[1]}, linked from ${topic.slug}, exists`);
    }
  }
  assert.ok(links >= 10, 'the how-tos point at each other');
});
