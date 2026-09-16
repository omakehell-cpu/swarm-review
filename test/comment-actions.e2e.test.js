'use strict';

// Answering a note in place. The point of the fragment path is that it is
// the same handler -- same permissions, same writes, same log -- with a
// different last line, so these tests check exactly that: what comes back
// differs, what happened does not.
const test = require('node:test');
const assert = require('node:assert');
const { startApp, makeClient, form } = require('./helpers/app');

const AUTHOR = { username: 'notesauthor', displayName: 'Notes Author', password: 'correct horse battery' };
const READER = { username: 'notesreader', displayName: 'Notes Reader', password: 'correct horse battery' };

let app; let models; let author; let reader;
let chapterId; let versionId; let commentId;

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');

  const a = models.createUser({ username: AUTHOR.username, displayName: AUTHOR.displayName, passwordHash: auth.hashPassword(AUTHOR.password), isAdmin: true });
  const r = models.createUser({ username: READER.username, displayName: READER.displayName, passwordHash: auth.hashPassword(READER.password), isAdmin: false });
  const made = models.createStoryWithFirstChapter({
    title: 'A Story With Notes', description: '', authorId: a.id,
    chapterTitle: 'One', chapterSummary: '', content: 'Kessler came up through the service spine.',
  });
  chapterId = made.chapter.id;
  versionId = models.getLatestVersion(chapterId).id;
  models.createComment({ versionId, authorId: r.id, startOffset: 0, endOffset: 7, quotedText: 'Kessler', body: 'Is this the same count?' });
  commentId = models.listCommentsForVersion(versionId)[0].id;

  author = makeClient(app.base);
  reader = makeClient(app.base);
  await author.login(AUTHOR.username, AUTHOR.password);
  await reader.login(READER.username, READER.password);
});

test.after(() => app.stop());

const fragment = (client, path, fields) => client.request(path, {
  method: 'POST', ...form(fields), headers: { 'x-fragment': 'comment' },
});

test('without the header, answering a note still redirects as it always did', async () => {
  const res = await author.request(`/comments/${commentId}/status`, { method: 'POST', ...form([['status', 'accepted']]) });
  assert.strictEqual(res.status, 302);
  assert.match(res.headers.get('location'), new RegExp(`/chapters/${chapterId}`));
  assert.strictEqual(models.getCommentById(commentId).status, 'accepted');
  await author.request(`/comments/${commentId}/reopen`, { method: 'POST', ...form([]) });
});

test('with it, the same route answers with the one note, re-rendered', async () => {
  const res = await fragment(author, `/comments/${commentId}/status`, [['status', 'accepted']]);
  assert.strictEqual(res.status, 200);
  const html = await res.text();

  // A fragment, not a page.
  assert.ok(!html.includes('<html'), 'no document');
  assert.ok(!html.includes('<nav'), 'no navigation');
  assert.match(html, new RegExp(`id="comment-${commentId}"`), 'the note it was asked about');
  assert.match(html, /status-accepted/, 'in its new state');

  // And what a screen reader should say, which the page has no way to
  // work out for itself once the markup has been swapped.
  assert.strictEqual(decodeURIComponent(res.headers.get('x-announce') || ''), 'Note accepted.');
  assert.strictEqual(models.getCommentById(commentId).status, 'accepted');
});

test('the rules are the same rules', async () => {
  // The reader did not write the chapter, so the reader cannot resolve
  // notes on it -- with or without the header. A second code path is
  // exactly how that stops being true.
  const refused = await fragment(reader, `/comments/${commentId}/status`, [['status', 'rejected']]);
  assert.strictEqual(refused.status, 403);
  assert.strictEqual(models.getCommentById(commentId).status, 'accepted', 'and nothing happened');
});

test('a reply comes back as the note it was a reply to', async () => {
  await author.request(`/comments/${commentId}/reopen`, { method: 'POST', ...form([]) });
  const res = await fragment(author, `/comments/${commentId}/reply`, [['body', 'Same count, yes.']]);
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  // The parent, because the parent is the block that grew.
  assert.match(html, new RegExp(`id="comment-${commentId}"`));
  assert.match(html, /Same count, yes\./, 'with the reply inside it');
  assert.strictEqual(decodeURIComponent(res.headers.get('x-announce') || ''), 'Reply posted.');
});

test('retracting and reopening say what happened', async () => {
  const mine = models.listCommentsForVersion(versionId).find((c) => c.parent_id === null);
  const retracted = await fragment(reader, `/comments/${mine.id}/retract`, []);
  assert.strictEqual(retracted.status, 200);
  assert.strictEqual(decodeURIComponent(retracted.headers.get('x-announce') || ''), 'Note retracted.');
  assert.match(await retracted.text(), /retracted/);
  assert.ok(models.getCommentById(mine.id).deleted_at, 'and it really is');
});

test('the chapter page carries the script that does this, and the keyboard path', async () => {
  const html = await (await author.request(`/chapters/${chapterId}`)).text();
  assert.match(html, /\/js\/comment-actions\.js/, 'the in-place answers');
  assert.match(html, /\/js\/app\.js/, 'and the selection commenting');
  // The offer to comment on a passage is a real button, not a hover
  // affordance -- which is what makes it reachable at all.
  assert.match(html, /<button id="selection-toast"[^>]*type="button"/);
});
