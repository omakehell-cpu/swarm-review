// The front page: three shelves, following a story (and being told about
// it), what you have read lately, and the advanced search.
'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const { startApp, makeClient, form } = require('./helpers/app');

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
  models.createUser({ username: 'luis', displayName: 'Luis Prado', passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  luisId = models.getUserByUsername('luis').id;
  ours = models.createStoryWithFirstChapter({ title: 'Salt Road', description: 'Ours.', authorId: luisId, chapterTitle: 'One', chapterSummary: '', content: 'The lighthouse keeper counted gulls.' }).story.id;
  for (const t of ['Two', 'Three']) models.createChapter({ storyId: ours, title: t, summary: '', authorId: luisId, content: 'More words.' });
  const author = models.findOrCreateImportedAuthor({ name: 'Akarge', authorSlug: 'akarge' });
  models.importStory({
    title: 'Far Out', description: 'From elsewhere.', status: 'complete', series: 'The Swarm Cycle', storyUrl: 'https://storiesonline.net/s/1/far-out', solId: '1',
    published: '2010-01-01', chapters: [{ title: 'Chapter 1', markdown: 'Long ago.' }, { title: 'Chapter 2', markdown: 'Longer ago.' }],
  }, { authorId: author.id });
  models.createStoryWithFirstChapter({ title: 'My Own', description: '', authorId: anaId, chapterTitle: 'Mine', chapterSummary: '', content: 'Mine.' });
});
test.after(() => app && app.stop());

test('three shelves, and nothing about where a story came from', async () => {
  const html = await (await ana.request('/')).text();
  assert.match(html, />Being written<span class="tag-chip-count">2</);
  assert.match(html, />Finished<span class="tag-chip-count">1</);
  assert.match(html, />All<span class="tag-chip-count">3</);
  assert.doesNotMatch(html, /StoriesOnline|Something to read|origin-tab/);
  assert.match(html, /href="#library">Skip to the stories/);
});

test('new to read is a story at a time, and never an import', async () => {
  const html = await (await ana.request('/')).text();
  assert.match(html, /<strong>Salt Road<\/strong> &middot; 3 new chapters, from chapter 1/);
  assert.doesNotMatch(html.split('id="library"')[0], /Far Out<\/strong>/);
});

test('write first: your stories being written, with the draft waiting in one', async () => {
  const html = await (await ana.request('/')).text();
  assert.match(html, /id="write-title"[^>]*>Write<[\s\S]*id="review-title"[^>]*>Review<[\s\S]*id="read-title"[^>]*>Read</, 'write, review, read, in that order');
  assert.match(html, /class="desk-title"><a href="\/stories\/\d+">My Own/);
  assert.doesNotMatch(html.split('id="write-title"')[1].split('id="review-title"')[0], /Salt Road/, 'only your own on your desk');
  const mine = models.listStories().find((x) => x.title === 'My Own');
  const chapter = models.listChaptersForStory(mine.id)[0];
  models.saveDraft({ chapterId: chapter.id, userId: anaId, title: 'Mine', content: 'Half a sentence' });
  const again = await (await ana.request('/')).text();
  assert.match(again, /Draft of chapter 1[\s\S]*href="\/chapters\/\d+\/edit">Continue the draft/);
});

test('recently read: other people\'s stories only, with where to pick up', async () => {
  const mine = models.listStories().find((s) => s.title === 'My Own');
  models.markChapterRead(models.listChaptersForStory(mine.id)[0].id, anaId, 1);
  let html = await (await ana.request('/')).text();
  assert.doesNotMatch(html, /Recently read/, 'reading your own story is not reading');
  const chapters = models.listChaptersForStory(ours);
  models.markChapterRead(chapters[0].id, anaId, 1);
  html = await (await ana.request('/')).text();
  assert.match(html, /Recently read[\s\S]*href="\/chapters\/\d+">Salt Road[\s\S]*next: chapter 2 of 3/);
  models.saveReadingPlace(anaId, chapters[1].id, 5, 10);
  assert.match(await (await ana.request('/')).text(), /chapter 2 of 3, 50% in/);
  for (const c of chapters) models.markChapterRead(c.id, anaId, 1);
  models.saveReadingPlace(anaId, chapters[1].id, 0, 10);
  assert.match(await (await ana.request('/')).text(), /Recently read[\s\S]*Salt Road[\s\S]*read to the end/);
});

test('follow a story: the star, the count in the bar, and news in Review', async () => {
  const page = await (await ana.request(`/stories/${ours}`)).text();
  assert.match(page, /action="\/stories\/\d+\/follow"[\s\S]*aria-pressed="false"[\s\S]*Follow</);
  const res = await ana.request(`/stories/${ours}/follow`, { method: 'POST', headers: { Accept: 'application/json' }, ...form([['follow', '1']]) });
  assert.deepStrictEqual(await res.json(), { following: true, followers: 1 });
  assert.match(await (await ana.request(`/stories/${ours}`)).text(), /aria-pressed="true"[\s\S]*Following/);

  let html = await (await ana.request('/')).text();
  assert.match(html, /Following<\/h3>[\s\S]*Salt Road[\s\S]*up to date/);
  assert.doesNotMatch(html, /class="nav-count"/, 'nothing new yet');

  await new Promise((r) => setTimeout(r, 1100));
  models.createChapter({ storyId: ours, title: 'Four', summary: '', authorId: luisId, content: 'News.' });
  html = await (await ana.request('/')).text();
  assert.match(html, /class="nav-count" aria-hidden="true">1</);
  assert.match(html, /1 new chapter in stories you follow/);
  const review = html.split('id="review-title"')[1].split('id="read-title"')[0];
  assert.match(review, /New in what you follow[\s\S]*<span class="inbox-count">1<\/span>[\s\S]*Salt Road<\/strong> &middot; 1 new chapter, from chapter 4/);
  assert.doesNotMatch(review, /New in the group[\s\S]*Salt Road/, 'not said twice');

  const four = models.listChaptersForStory(ours).find((c) => c.title === 'Four');
  models.markChapterRead(four.id, anaId, 1);
  assert.doesNotMatch(await (await ana.request('/')).text(), /class="nav-count"/, 'read, so no longer news');

  await ana.request(`/stories/${ours}/follow`, { method: 'POST', ...form([['follow', '0'], ['back', '/']]) });
  assert.doesNotMatch(await (await ana.request('/')).text(), /Following<\/h3>/);
});

test('the advanced search, on its own page: author, words in the text, length, following', async () => {
  const res = (html) => html.split('id="results"')[1];
  const blank = await (await ana.request('/find')).text();
  assert.match(blank, /<h1>Advanced search<\/h1>/);
  assert.match(blank, /press Search/);
  const byAuthor = res(await (await ana.request('/find?author=prado')).text());
  assert.match(byAuthor, />Salt Road</);
  assert.doesNotMatch(byAuthor, />Far Out</);
  const inText = res(await (await ana.request('/find?text=lighthouse')).text());
  assert.match(inText, />Salt Road</);
  assert.doesNotMatch(inText, />My Own</);
  assert.match(inText, /In the text: &ldquo;lighthouse&rdquo;/);
  assert.doesNotMatch(res(await (await ana.request('/find?length=long')).text()), />Salt Road</);
  await ana.request(`/stories/${ours}/follow`, { method: 'POST', ...form([['follow', '1']]) });
  const followed = res(await (await ana.request('/find?following=1')).text());
  assert.match(followed, />Salt Road</);
  assert.doesNotMatch(followed, />Far Out</);
  assert.match(await (await ana.request('/search?q=salt')).text(), /href="\/find\?q=salt">Advanced search/);
});

test('an author\'s page: the numbers, the latest work, and the rest from the first', async () => {
  const html = await (await ana.request('/users/luis')).text();
  assert.match(html, /class="author-metric-value">1<\/span>\s*<span class="author-metric-label">story/);
  assert.match(html, /Latest work[\s\S]*Salt Road/);
  assert.match(html, /Words put up, month by month/);
  assert.match(html, /<summary>As a table<\/summary>/);
  const imported = await (await ana.request('/users/sol-akarge')).text();
  assert.match(imported, /Latest work[\s\S]*Far Out[\s\S]*Oct 2010|Latest work[\s\S]*Far Out/);
  assert.match(imported, /Imported from StoriesOnline/);
});
