'use strict';

// Every story written here has a page in the glossary, made from the story
// and kept up with it -- and the wiki's sync never takes it away.

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form } = require('./helpers/app');

const PASSWORD = 'a long enough password';
let app;
let models;
let ana;

test.before(async () => {
  app = await startApp();
  models = app.models;
  const invite = models.getActiveInviteCode();
  ana = makeClient(app.base);
  await ana.request('/register', { method: 'POST', ...form([['username', 'ana'], ['displayName', 'Ana'], ['password', PASSWORD], ['inviteCode', invite.code]]) });
  await ana.login('ana', PASSWORD);
});
test.after(() => app && app.stop());

const glossary = async (title) => ana.request(`/glossary/${encodeURIComponent(title)}`);

test('a new story has a glossary page: who wrote it, its chapters and who is in it', async () => {
  const res = await ana.request('/stories/new', { method: 'POST', ...form([
    ['storyTitle', 'The Long Watch'], ['storyDescription', 'A picket ship waits at the edge of the system.'],
    ['chapterTitle', 'First Light'], ['content', 'The sensors were quiet.'],
  ]) });
  assert.strictEqual(res.status, 302);
  const story = models.listStories().find((s) => s.title === 'The Long Watch');
  models.createStoryEntity({ storyId: story.id, kind: 'person', name: 'Captain Ruiz', summary: 'Commands the picket.', createdBy: story.author_id });

  const page = await glossary('The Long Watch');
  assert.strictEqual(page.status, 200);
  const html = await page.text();
  assert.match(html, /Open the story/);
  assert.match(html, /A picket ship waits at the edge of the system\./);
  assert.match(html, /Written by <a href="\/users\/ana">Ana<\/a>/);
  assert.match(html, /<a href="\/chapters\/\d+">First Light<\/a>/);
  assert.match(html, /Captain Ruiz<\/a> &mdash; Commands the picket\./);

  const index = await (await ana.request('/glossary?kind=stories')).text();
  assert.match(index, /The Long Watch/, 'it is listed with the stories');
});

test('a story title is not a name: chapters do not link it', () => {
  models.refreshStoryGlossary();
  assert.ok(!models.listWikiPages().some((p) => p.title === 'The Long Watch'));
});

test('a wiki sync keeps story pages, and the wiki wins a shared title', async () => {
  models.replaceWikiPages([{ title: 'Picket Ship', summary: 'A small warship.', contentHtml: '<p>Small.</p>', categories: ['Ships'] }]);
  assert.ok(models.getWikiPageByTitleLower('picket ship'));
  assert.ok(models.getWikiPageByTitleLower('the long watch').story_id, 'the story page survives the sync');

  models.replaceWikiPages([{ title: 'The Long Watch', summary: 'The wiki page.', contentHtml: '<p>From the wiki.</p>', categories: ['Stories'] }]);
  models.refreshStoryGlossary();
  const shared = models.getWikiPageByTitleLower('the long watch');
  assert.strictEqual(shared.story_id, null, 'the wiki page is the one kept');
  assert.strictEqual(shared.summary, 'The wiki page.');

  models.replaceWikiPages([]);
  models.refreshStoryGlossary();
  assert.ok(models.getWikiPageByTitleLower('the long watch').story_id, 'and the story gets its page back when the wiki drops it');
});

test('the page follows the story: renamed, and gone when it is archived', async () => {
  const story = models.listStories().find((s) => s.title === 'The Long Watch');
  models.updateStoryDetails(story.id, { title: 'The Longest Watch', description: story.description, synopsis: '', status: 'complete' });
  models.refreshStoryGlossary();
  assert.strictEqual(models.getWikiPageByTitleLower('the long watch'), null);
  assert.match(models.getWikiPageByTitleLower('the longest watch').content_html, /Finished; 1 chapter/);

  models.archiveStory(story.id);
  models.refreshStoryGlossary();
  assert.strictEqual(models.getWikiPageByTitleLower('the longest watch'), null);
  assert.strictEqual((await glossary('The Longest Watch')).status, 404);
});
