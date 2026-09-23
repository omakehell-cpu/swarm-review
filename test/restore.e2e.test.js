// Putting a backup back from the admin page. The one feature whose bug is
// "the wrong database is now live", so it is checked end to end.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart } = require('./helpers/app');

let app;
let admin;
const PASSWORD = 'a long enough password';

test.before(async () => {
  app = await startApp();
  const invite = app.models.getActiveInviteCode();
  admin = makeClient(app.base);
  await admin.request('/register', {
    method: 'POST', ...form([['username', 'boss'], ['displayName', 'Boss'], ['password', PASSWORD], ['inviteCode', invite.code]]),
  });
  await admin.login('boss', PASSWORD);
});

test.after(() => app.stop());

const newStory = (title, text) => admin.request('/stories/new', {
  method: 'POST', ...multipart([['storyTitle', title], ['chapterTitle', 'One'], ['content', text]]),
});

test('a copy can be put back, and what was there is kept first', async () => {
  await newStory('Before the copy', 'The anchorage was cold.');
  await admin.request('/admin/backup/now', { method: 'POST' });
  const backups = require('../lib/backup');
  const copy = backups.listBackups()[0];
  assert.ok(copy, 'a copy exists');

  await newStory('After the copy', 'Written later, lost on restore.');
  assert.strictEqual(app.models.listStories().length, 2);

  // Without typing RESTORE, nothing happens.
  const refused = await admin.request('/admin/backup/restore', { method: 'POST', ...form([['name', copy.name], ['confirm', 'yes']]) });
  assert.match(decodeURIComponent(refused.headers.get('location')), /Nothing was restored/);
  assert.strictEqual(app.models.listStories().length, 2);

  // A name that is not on the list is not a path to anywhere.
  const sneaky = await admin.request('/admin/backup/restore', { method: 'POST', ...form([['name', '../swarm-review.sqlite'], ['confirm', 'RESTORE']]) });
  assert.match(decodeURIComponent(sneaky.headers.get('location')), /no copy by that name/);

  // Wait a second so the safety copy gets a name of its own.
  await new Promise((r) => setTimeout(r, 1100));
  const done = await admin.request('/admin/backup/restore', { method: 'POST', ...form([['name', copy.name], ['confirm', 'restore']]) });
  assert.match(decodeURIComponent(done.headers.get('location')), /Restored/);
  const titles = app.models.listStories().map((s) => s.title);
  assert.deepStrictEqual(titles, ['Before the copy']);

  // Search was rebuilt from what came back.
  const found = await (await admin.request('/search?q=anchorage')).text();
  assert.match(found, /Before the copy/);
  const gone = await (await admin.request('/search?q=lost')).text();
  assert.doesNotMatch(gone, /After the copy/);

  // The site as it was a moment ago is the newest copy, so this is undoable.
  const safety = backups.listBackups()[0];
  assert.notStrictEqual(safety.name, copy.name);
  await new Promise((r) => setTimeout(r, 1100));
  await admin.request('/admin/backup/restore', { method: 'POST', ...form([['name', safety.name], ['confirm', 'RESTORE']]) });
  assert.strictEqual(app.models.listStories().length, 2);

  // Still signed in, still the admin: the session survived its own restore.
  assert.strictEqual((await admin.request('/admin')).status, 200);
});
