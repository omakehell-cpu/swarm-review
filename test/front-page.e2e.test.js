// The front page, with a library in it: what the group writes first, the
// library a tab over, what you were reading, and what is new -- a story at
// a time, and never the chapters that came in with an import.
'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const { startApp, makeClient, form } = require('./helpers/app');
const { discoverPicks } = require('../lib/story-shelves');

const PASSWORD = 'a long enough password';
let app; let models; let ana; let luisId; let anaId; let ours;

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');
  ana = makeClient(app.base);
  await ana.request('/register', { method: 'POST', ...form([['username', 'ana'], ['displayName', 'Ana'], ['password', PASSWORD], ['inviteCode', models.getActiveInviteCode().code]]) });
  await ana.login('ana', PASSWORD);
  anaId = models.getUserByUsername('ana').id;
  models.createUser({ username: 'luis', displayName: 'Luis', passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  luisId = models.getUserByUsername('luis').id;
  // Written here, by Luis: three chapters.
  ours = models.createStoryWithFirstChapter({ title: 'Salt Road', description: 'Ours.', authorId: luisId, chapterTitle: 'One', chapterSummary: '', content: 'Words here.' });
  ours = ours.story.id;
  for (const t of ['Two', 'Three']) models.createChapter({ storyId: ours, title: t, summary: '', authorId: luisId, content: 'More words.' });
  // Imported: two chapters from years ago.
  const author = models.findOrCreateImportedAuthor({ name: 'Akarge', authorSlug: 'akarge' });
  models.importStory({
    title: 'Far Out', description: 'From elsewhere.', status: 'complete', series: 'The Swarm Cycle', storyUrl: 'https://storiesonline.net/s/1/far-out', solId: '1',
    published: '2010-01-01', chapters: [{ title: 'Chapter 1', markdown: 'Long ago.' }, { title: 'Chapter 2', markdown: 'Longer ago.' }],
  }, { authorId: author.id });
});
test.after(() => app && app.stop());

test('the page opens on what the group writes; the library is a tab over', async () => {
  const html = await (await ana.request('/')).text();
  assert.match(html, /aria-label="Where the stories were written"/);
  assert.match(html, /class="origin-tab current"[^>]*aria-current="page">Written here/);
  assert.match(html, /href="\/stories\/\d+[^"]*">Salt Road/);
  assert.ok(!/class="row-link" href="\/stories\/\d+[^"]*">Far Out/.test(html.split('id="library"')[1]), 'the library story is not in the group\'s list');
  const lib = await (await ana.request('/?origin=imported')).text();
  assert.match(lib.split('id="library"')[1], /class="row-link" href="\/stories\/\d+[^"]*">Far Out/);
  assert.match(lib, /From StoriesOnline<span class="origin-count">1</);
  const found = await (await ana.request('/?q=far')).text();
  assert.match(found.split('id="library"')[1], />Far Out</, 'a search with no tab looks everywhere');
  assert.match(html, /href="#library">Skip to the stories/);
});

test('new to read is a story at a time, and never an import', async () => {
  const html = await (await ana.request('/')).text();
  assert.match(html, /<strong>Salt Road<\/strong> &middot; 3 new chapters, from chapter 1/);
  assert.doesNotMatch(html.split('id="library"')[0], /Far Out<\/strong>/);
});

test('pick up where you left off: the chapter you stopped in, or the next one', async () => {
  const chapters = models.listChaptersForStory(ours);
  models.markChapterRead(chapters[0].id, anaId, 1);
  let html = await (await ana.request('/')).text();
  assert.match(html, /Pick up where you left off[\s\S]*href="\/chapters\/\d+">Salt Road[\s\S]*Chapter 2 of 3/);
  models.saveReadingPlace(anaId, chapters[1].id, 5, 10);
  html = await (await ana.request('/')).text();
  assert.match(html, /Chapter 2 of 3, 50% in/);
  for (const c of chapters) models.markChapterRead(c.id, anaId, 1);
  models.saveReadingPlace(anaId, chapters[1].id, 0, 10);
  html = await (await ana.request('/')).text();
  assert.doesNotMatch(html, /Pick up where you left off/, 'a story finished is not waiting');
});

test('something to read: from the library, unread, the same all day', () => {
  const stories = [
    { id: 1, source_url: 'x', author_id: 9, chapter_count: 2 },
    { id: 2, source_url: null, author_id: 9, chapter_count: 2 },
    { id: 3, source_url: 'x', author_id: 7, chapter_count: 2 },
    { id: 4, imported_at: '2026-01-01', author_id: 9, chapter_count: 1 },
  ];
  const picks = discoverPicks(stories, { userId: 7, readStoryIds: new Set([4]), day: '2026-09-26' });
  assert.deepStrictEqual(picks.map((s) => s.id), [1], 'not written here, not theirs, not begun');
  const many = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, source_url: 'x', author_id: 9, chapter_count: 1 }));
  const a = discoverPicks(many, { userId: 7, day: '2026-09-26' }).map((s) => s.id);
  assert.deepStrictEqual(discoverPicks(many, { userId: 7, day: '2026-09-26' }).map((s) => s.id), a, 'the same all day');
  assert.notDeepStrictEqual(discoverPicks(many, { userId: 7, day: '2026-09-27' }).map((s) => s.id), a, 'different tomorrow');
  assert.strictEqual(a.length, 4);
});
