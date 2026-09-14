// Coauthors, against the real server.
//
// The rule being tested is deliberately narrow, and the narrowness is the
// point: a coauthor can add chapters to somebody else's story and edit the
// chapters they wrote themselves. They cannot rewrite a chapter somebody
// else wrote, and they cannot touch the story itself. Most of the
// assertions here are about what a coauthor *can't* do, because that is
// the half that quietly stops being true when permissions get refactored.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart } = require('./helpers/app');

let app;
let models;
let owner;    // writes the story
let helper;   // gets added as a coauthor
let stranger; // neither
let otherAdmin; // an admin who is not the owner
let storyId;
let ownersChapterId;

const PASSWORD = 'a long enough password';

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');

  const invite = models.getActiveInviteCode();
  owner = makeClient(app.base);
  // The first registered account is the admin; registration signs it in.
  await owner.request('/register', {
    method: 'POST',
    ...form([['username', 'owner'], ['displayName', 'Ana'], ['password', PASSWORD], ['inviteCode', invite.code]]),
  });
  await owner.login('owner', PASSWORD);

  // The rest are made directly: the app hands out one invite code at a
  // time, and this test is not about the invite flow.
  for (const [username, displayName, isAdmin] of [
    ['helper', 'Luis', false],
    ['stranger', 'Marta', false],
    ['boss', 'Sergio', true],
  ]) {
    models.createUser({ username, displayName, passwordHash: auth.hashPassword(PASSWORD), isAdmin });
  }
  helper = makeClient(app.base);
  stranger = makeClient(app.base);
  otherAdmin = makeClient(app.base);
  await helper.login('helper', PASSWORD);
  await stranger.login('stranger', PASSWORD);
  await otherAdmin.login('boss', PASSWORD);

  await owner.request('/stories/new', {
    method: 'POST',
    ...multipart([
      ['storyTitle', 'The Kestrel Anchorage'],
      ['storyDescription', 'A shared story.'],
      ['chapterTitle', 'Chapter One'],
      ['chapterSummary', ''],
      ['content', "Ana's own opening paragraph."],
    ]),
  });
  const story = models.listStories().find((s) => s.title === 'The Kestrel Anchorage');
  storyId = story.id;
  ownersChapterId = models.listChaptersForStory(storyId)[0].id;
});

test.after(() => app.stop());

test('before being added, somebody else cannot add a chapter', async () => {
  const res = await helper.request(`/stories/${storyId}/chapters/new`);
  assert.strictEqual(res.status, 403);
});

test('only the story owner can add a coauthor', async () => {
  const helperId = models.getUserByUsername('helper').id;

  const refused = await stranger.request(`/stories/${storyId}/authors`, {
    method: 'POST', ...form([['userId', String(helperId)]]),
  });
  assert.strictEqual(refused.status, 403);
  assert.strictEqual(models.listStoryCoauthors(storyId).length, 0);

  const added = await owner.request(`/stories/${storyId}/authors`, {
    method: 'POST', ...form([['userId', String(helperId)]]),
  });
  assert.strictEqual(added.status, 302);
  assert.deepStrictEqual(models.listStoryCoauthors(storyId).map((c) => c.display_name), ['Luis']);
});

test('being an admin is not a key to everyone else\'s story', async () => {
  // Admins run the site: they hand out invites, unlock accounts and reset
  // passwords. Writing in somebody else's story is not on that list.
  assert.strictEqual(models.getUserByUsername('boss').is_admin, 1);

  const add = await otherAdmin.request(`/stories/${storyId}/chapters/new`);
  assert.strictEqual(add.status, 403);

  const helperId = models.getUserByUsername('helper').id;
  const invite = await otherAdmin.request(`/stories/${storyId}/authors/${helperId}/remove`, {
    method: 'POST', ...form([]),
  });
  assert.strictEqual(invite.status, 403);
  assert.strictEqual(models.listStoryCoauthors(storyId).length, 1, 'the coauthor is still there');
});

test('a coauthor can add a chapter', async () => {
  const page = await helper.request(`/stories/${storyId}/chapters/new`);
  assert.strictEqual(page.status, 200);

  const res = await helper.request(`/stories/${storyId}/chapters/new`, {
    method: 'POST',
    ...multipart([
      ['title', "Luis's chapter"],
      ['summary', ''],
      ['content', 'The anchorage looked different from the water.'],
    ]),
  });
  assert.strictEqual(res.status, 302, (await res.text()).slice(0, 300));

  const chapter = models.listChaptersForStory(storyId).find((c) => c.title === "Luis's chapter");
  assert.ok(chapter, 'the chapter exists');
  assert.strictEqual(chapter.author_id, models.getUserByUsername('helper').id, 'and it is theirs');
});

test('a coauthor can edit their own chapter', async () => {
  const chapter = models.listChaptersForStory(storyId).find((c) => c.title === "Luis's chapter");
  const res = await helper.request(`/chapters/${chapter.id}/edit`, {
    method: 'POST',
    ...multipart([
      ['title', "Luis's chapter"],
      ['summary', ''],
      ['content', 'The anchorage looked quite different from the water.'],
      ['changelog', 'a word'],
    ]),
  });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(models.listVersions(chapter.id).length, 2);
});

test('a coauthor cannot rewrite the chapter somebody else wrote', async () => {
  const page = await helper.request(`/chapters/${ownersChapterId}/edit`);
  assert.strictEqual(page.status, 403);

  const submit = await helper.request(`/chapters/${ownersChapterId}/edit`, {
    method: 'POST',
    ...multipart([['title', 'Hijacked'], ['summary', ''], ['content', 'Replaced.'], ['changelog', '']]),
  });
  assert.strictEqual(submit.status, 403);
  assert.strictEqual(models.getChapterById(ownersChapterId).title, 'Chapter One');
});

test('a coauthor cannot edit the story, reorder it, archive it or delete it', async () => {
  for (const [pathname, method] of [
    [`/stories/${storyId}/edit`, 'GET'],
    [`/stories/${storyId}/archive`, 'POST'],
    [`/stories/${storyId}/delete`, 'POST'],
  ]) {
    const res = await helper.request(pathname, { method, ...(method === 'POST' ? form([]) : {}) });
    assert.strictEqual(res.status, 403, `${method} ${pathname} returned ${res.status}`);
  }
  assert.ok(models.getStoryById(storyId), 'the story is still there');
});

test('a coauthor shares the story dictionary, a stranger does not', async () => {
  const added = await helper.request(`/stories/${storyId}/dictionary`, {
    method: 'POST', ...form([['word', 'Akarge']]),
  });
  assert.strictEqual(added.status, 302);
  // Stored lowercased: the analyzer matches case-insensitively.
  assert.ok(models.getStoryDictionary(storyId).includes('akarge'), JSON.stringify(models.getStoryDictionary(storyId)));

  const mine = await helper.request(`/stories/${storyId}/dictionary`, { headers: { accept: 'application/json' } });
  assert.strictEqual(mine.status, 200);

  const theirs = await stranger.request(`/stories/${storyId}/dictionary`, { headers: { accept: 'application/json' } });
  assert.strictEqual(theirs.status, 403);
});

test('the story page names its coauthors in the byline', async () => {
  const res = await owner.request(`/stories/${storyId}`);
  const html = await res.text();
  assert.match(html, /by Ana with Luis/);
});

test('the owner sees the add form; a coauthor sees the list without it', async () => {
  const mine = await owner.request(`/stories/${storyId}`);
  const ownerHtml = await mine.text();
  assert.match(ownerHtml, /Who can write in this story/);
  assert.match(ownerHtml, new RegExp(`action="/stories/${storyId}/authors"`));

  const theirs = await helper.request(`/stories/${storyId}`);
  const helperHtml = await theirs.text();
  assert.match(helperHtml, /Who can write in this story/);
  assert.ok(!helperHtml.includes(`action="/stories/${storyId}/authors"`), 'no add form for a coauthor');
  // But they can take themselves out.
  assert.match(helperHtml, /Step back/);
});

test('a coauthor can step back without asking', async () => {
  const helperId = models.getUserByUsername('helper').id;
  const res = await helper.request(`/stories/${storyId}/authors/${helperId}/remove`, { method: 'POST', ...form([]) });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(models.listStoryCoauthors(storyId).length, 0);
});

test('stepping back takes away the right to write, but not the chapter already written', async () => {
  const chapter = models.listChaptersForStory(storyId).find((c) => c.title === "Luis's chapter");
  assert.ok(chapter, 'the chapter they wrote is still in the story');
  assert.strictEqual(chapter.author_id, models.getUserByUsername('helper').id, 'and still theirs');

  // Still their chapter, so still theirs to edit.
  const edit = await helper.request(`/chapters/${chapter.id}/edit`);
  assert.strictEqual(edit.status, 200);

  // But no longer a coauthor, so no new chapters.
  const add = await helper.request(`/stories/${storyId}/chapters/new`);
  assert.strictEqual(add.status, 403);
});
