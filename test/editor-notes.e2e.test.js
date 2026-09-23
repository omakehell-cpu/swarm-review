// Answering notes beside the editor (views/writing.js editorNote and
// public/js/editor-notes.js): the markup the script works from.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart } = require('./helpers/app');

let app;
let models;
let ana;
let chapterId;
const PASSWORD = 'a long enough password';

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');
  const invite = models.getActiveInviteCode();
  ana = makeClient(app.base);
  await ana.request('/register', {
    method: 'POST', ...form([['username', 'ana'], ['displayName', 'Ana'], ['password', PASSWORD], ['inviteCode', invite.code]]),
  });
  await ana.login('ana', PASSWORD);
  models.createUser({ username: 'luis', displayName: 'Luis', passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  await ana.request('/stories/new', {
    method: 'POST', ...multipart([['storyTitle', 'Anchorage'], ['chapterTitle', 'One'], ['content', 'Boots ringing on grating. The drop is at six.']]),
  });
  chapterId = models.listChaptersForStory(models.listStories()[0].id)[0].id;
  const version = models.getLatestVersion(chapterId);
  const luis = models.getUserByUsername('luis').id;
  models.createComment({ versionId: version.id, authorId: luis, startOffset: 0, endOffset: 14, quotedText: 'Boots ringing', body: 'Echo.', suggestion: 'Boots loud' });
  models.createComment({ versionId: version.id, authorId: luis, startOffset: 26, endOffset: 45, quotedText: 'The drop is at six.', body: 'What drop?', kind: 'question' });
});

test.after(() => app.stop());

test('the notes beside the editor can be answered there', async () => {
  const html = await (await ana.request(`/chapters/${chapterId}/edit`)).text();
  assert.match(html, /class="editor-notes"[^>]*data-pending="2"/);
  assert.match(html, /2 pending/);
  assert.match(html, /data-comment-id="\d+" data-status="pending" data-quoted="Boots ringing" data-suggestion="Boots loud"/);
  assert.match(html, /class="btn tiny note-use" hidden>Put it in the text</);
  assert.match(html, /action="\/comments\/\d+\/status" class="inline-form note-answer"/);
  assert.match(html, /src="\/js\/editor-notes\.js"/);
});

test('an answered note offers to reopen instead', async () => {
  const note = models.listCommentsForVersion(models.getLatestVersion(chapterId).id).find((c) => c.kind === 'question');
  const res = await ana.request(`/comments/${note.id}/status`, { method: 'POST', ...form([['status', 'accepted']]) });
  assert.ok(res.status === 302 || res.status === 200);
  const html = await (await ana.request(`/chapters/${chapterId}/edit`)).text();
  assert.match(html, /1 pending/);
  assert.match(html, new RegExp(`action="/comments/${note.id}/reopen"`));
});
