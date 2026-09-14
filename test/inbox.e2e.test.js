// The "what's waiting for you" panel on the story index.
//
// Most of these are about what must NOT appear in it. An inbox that shows
// you somebody else's business is worse than no inbox, and the queries
// behind it join five tables, which is exactly where a missing condition
// hides.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart } = require('./helpers/app');

let app;
/** @type {any} */
let models;
let ana;    // writes the story
let luis;   // reviews it
let anaId;
let luisId;
let storyId;
let chapterId;
let versionId;

const PASSWORD = 'a long enough password';

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');

  const invite = models.getActiveInviteCode();
  ana = makeClient(app.base);
  await ana.request('/register', {
    method: 'POST',
    ...form([['username', 'ana'], ['displayName', 'Ana'], ['password', PASSWORD], ['inviteCode', invite.code]]),
  });
  await ana.login('ana', PASSWORD);
  models.createUser({ username: 'luis', displayName: 'Luis', passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  luis = makeClient(app.base);
  await luis.login('luis', PASSWORD);

  anaId = models.getUserByUsername('ana').id;
  luisId = models.getUserByUsername('luis').id;

  await ana.request('/stories/new', {
    method: 'POST',
    ...multipart([
      ['storyTitle', 'The Anchorage'],
      ['storyDescription', ''],
      ['chapterTitle', 'The long watch'],
      ['chapterSummary', ''],
      ['content', 'The station had been dying for eleven years.'],
    ]),
  });
  storyId = models.listStories().find((s) => s.title === 'The Anchorage').id;
  chapterId = models.listChaptersForStory(storyId)[0].id;
  versionId = models.getLatestVersion(chapterId).id;
});

test.after(() => app.stop());

test('an empty inbox renders nothing at all', () => {
  // Not an empty box saying "you are all caught up" -- that is furniture
  // on every visit forever.
  const inbox = models.inboxFor(anaId, { since: null });
  assert.ok(inbox.empty);
});

test('a comment on your chapter is waiting on you, and not on its author', () => {
  models.createComment({
    versionId, authorId: luisId, body: 'This line drags.',
    startOffset: 4, endOffset: 11, quotedText: 'station',
  });

  const hers = models.inboxFor(anaId, { since: null });
  assert.strictEqual(hers.pending.length, 1);
  assert.strictEqual(hers.pending[0].pending, 1);
  assert.strictEqual(hers.pending[0].chapter_id, chapterId);

  const his = models.inboxFor(luisId, { since: null });
  assert.strictEqual(his.pending.length, 0, "the reviewer's own comment is not work for him");
});

test('resolving it takes it off the list', () => {
  const comment = models.listCommentsForVersion(versionId).find((c) => c.status === 'pending');
  models.setCommentStatus({ commentId: comment.id, status: 'accepted', resolvedBy: anaId });
  assert.strictEqual(models.inboxFor(anaId, { since: null }).pending.length, 0);
});

test('a reply to your comment reaches you, and your own reply does not', () => {
  const mine = models.createComment({
    versionId, authorId: luisId, body: 'And here?',
    startOffset: 0, endOffset: 3, quotedText: 'The',
  });
  const since = '2000-01-01 00:00:00';

  models.createComment({ versionId, authorId: anaId, parentId: mine.id, body: 'Fixed, thank you.' });
  const his = models.inboxFor(luisId, { since });
  assert.strictEqual(his.replies.length, 1);
  assert.match(his.replies[0].body, /Fixed/);

  models.createComment({ versionId, authorId: luisId, parentId: mine.id, body: 'Talking to myself.' });
  assert.strictEqual(models.inboxFor(luisId, { since }).replies.length, 1, 'your own reply is not news to you');
});

test('a chapter somebody else added is new to read; your own is not', () => {
  const since = '2000-01-01 00:00:00';
  assert.strictEqual(models.inboxFor(anaId, { since }).newChapters.length, 0, 'Ana wrote the only chapter');

  const his = models.inboxFor(luisId, { since });
  assert.strictEqual(his.newChapters.length, 1);
  assert.strictEqual(his.newChapters[0].id, chapterId);
  assert.ok(his.newChapters[0].word_count > 0, 'it says how long it is');
});

test('nothing time-based shows up on a first-ever visit', () => {
  // since is null the first time an account loads the index, and
  // "everything since the beginning of time" would be a wall.
  const first = models.inboxFor(luisId, { since: null });
  assert.strictEqual(first.replies.length, 0);
  assert.strictEqual(first.newChapters.length, 0);
});

test('an archived story stops being anybody\'s business', () => {
  models.createComment({
    versionId, authorId: luisId, body: 'One more.',
    startOffset: 4, endOffset: 11, quotedText: 'station',
  });
  assert.strictEqual(models.inboxFor(anaId, { since: null }).pending.length, 1);

  models.archiveStory(storyId);
  assert.strictEqual(models.inboxFor(anaId, { since: null }).pending.length, 0);
  assert.strictEqual(models.inboxFor(luisId, { since: '2000-01-01 00:00:00' }).newChapters.length, 0);
  models.unarchiveStory(storyId);
});

test('the panel reaches the page, and disappears when there is nothing', async () => {
  const html = await (await ana.request('/')).text();
  assert.match(html, /Waiting on you/);
  assert.match(html, /comments? to accept or reject/);

  for (const c of models.listCommentsForVersion(versionId)) {
    if (c.parent_id == null && c.status === 'pending') {
      models.setCommentStatus({ commentId: c.id, status: 'rejected', resolvedBy: anaId });
    }
  }

  const after = await (await ana.request('/')).text();
  assert.ok(!after.includes('Waiting on you'), 'gone once nothing is outstanding');
});
