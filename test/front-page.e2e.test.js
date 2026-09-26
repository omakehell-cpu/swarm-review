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

test('recently read: other people\'s stories only, with where to pick up', async () => {
  const mine = models.listStories().find((s) => s.title === 'My Own');
  models.markChapterRead(models.listChaptersForStory(mine.id)[0].id, anaId, 1);
  let html = await (await ana.request('/')).text();
  assert.doesNotMatch(html, /Recently read/, 'reading your own story is not reading');
  const chapters = models.listChaptersForStory(ours);
  models.markChapterRead(chapters[0].id, anaId, 1);
  html = await (await ana.request('/')).text();
  assert.match(html, /Recently read[\s\S]*href="\/chapters\/\d+">Salt Road[\s\S]*Next: chapter 2 of 3/);
  models.saveReadingPlace(anaId, chapters[1].id, 5, 10);
  assert.match(await (await ana.request('/')).text(), /Chapter 2 of 3, 50% in/);
  for (const c of chapters) models.markChapterRead(c.id, anaId, 1);
  models.saveReadingPlace(anaId, chapters[1].id, 0, 10);
  assert.match(await (await ana.request('/')).text(), /Recently read[\s\S]*Salt Road[\s\S]*Read to the end/);
});

test('follow a story: the star, the count in the bar, and the list at the top', async () => {
  const page = await (await ana.request(`/stories/${ours}`)).text();
  assert.match(page, /action="\/stories\/\d+\/follow"[\s\S]*aria-pressed="false"[\s\S]*Follow</);
  const res = await ana.request(`/stories/${ours}/follow`, { method: 'POST', headers: { Accept: 'application/json' }, ...form([['follow', '1']]) });
  assert.deepStrictEqual(await res.json(), { following: true, followers: 1 });
  assert.match(await (await ana.request(`/stories/${ours}`)).text(), /aria-pressed="true"[\s\S]*Following/);

  let html = await (await ana.request('/')).text();
  assert.match(html, /Following<\/h2>[\s\S]*Salt Road[\s\S]*Up to date/);
  assert.doesNotMatch(html, /class="nav-count"/, 'nothing new yet');

  await new Promise((r) => setTimeout(r, 1100));
  models.createChapter({ storyId: ours, title: 'Four', summary: '', authorId: luisId, content: 'News.' });
  html = await (await ana.request('/')).text();
  assert.match(html, /class="nav-count" aria-hidden="true">1</);
  assert.match(html, /1 new chapter in stories you follow/);
  assert.match(html, /Following<\/h2>[\s\S]*<span class="inbox-count">1<\/span>[\s\S]*Salt Road[\s\S]*1 new chapter, from chapter 4/);
  assert.doesNotMatch(html.split('Following</h2>')[1].split('id="library"')[0], /New to read/, 'not said twice');

  const four = models.listChaptersForStory(ours).find((c) => c.title === 'Four');
  models.markChapterRead(four.id, anaId, 1);
  assert.doesNotMatch(await (await ana.request('/')).text(), /class="nav-count"/, 'read, so no longer news');

  await ana.request(`/stories/${ours}/follow`, { method: 'POST', ...form([['follow', '0'], ['back', '/']]) });
  assert.doesNotMatch(await (await ana.request('/')).text(), /Following<\/h2>/);
});

test('the advanced search: author, words in the text, length, following', async () => {
  const lib = (html) => html.split('id="library"')[1];
  const byAuthor = lib(await (await ana.request('/?shelf=all&author=prado')).text());
  assert.match(byAuthor, />Salt Road</);
  assert.doesNotMatch(byAuthor, />Far Out</);
  const inText = lib(await (await ana.request('/?shelf=all&text=lighthouse')).text());
  assert.match(inText, />Salt Road</);
  assert.doesNotMatch(inText, />My Own</);
  assert.match(inText, /In the text: &ldquo;lighthouse&rdquo;/);
  const short = lib(await (await ana.request('/?shelf=all&length=long')).text());
  assert.doesNotMatch(short, />Salt Road</);
  await ana.request(`/stories/${ours}/follow`, { method: 'POST', ...form([['follow', '1']]) });
  const followed = lib(await (await ana.request('/?shelf=all&following=1')).text());
  assert.match(followed, />Salt Road</);
  assert.doesNotMatch(followed, />Far Out</);
  assert.match(await (await ana.request('/')).text(), /Advanced search/);
});
