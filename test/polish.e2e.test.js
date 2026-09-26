// Small things that make the site easier to live in: your place in a
// chapter, ordering the front page, naming somebody in a note, and the
// site as an installable app.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart } = require('./helpers/app');

let app;
let models;
let ana;
let luis;
let chapterId;
const PASSWORD = 'a long enough password';

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');
  const invite = models.getActiveInviteCode();
  ana = makeClient(app.base);
  await ana.request('/register', {
    method: 'POST', ...form([['username', 'ana'], ['displayName', 'Ana Vilar'], ['password', PASSWORD], ['inviteCode', invite.code]]),
  });
  await ana.login('ana', PASSWORD);
  models.createUser({ username: 'luis', displayName: 'Luis Prado', passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  luis = makeClient(app.base);
  await luis.login('luis', PASSWORD);
  const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} of the watch.`).join('\n\n');
  await ana.request('/stories/new', { method: 'POST', ...multipart([['storyTitle', 'Zebra crossing'], ['chapterTitle', 'The long watch'], ['content', text]]) });
  for (const t of ['Anchorage', 'Middle', 'Quiet', 'Salt']) {
    await luis.request('/stories/new', { method: 'POST', ...multipart([['storyTitle', t], ['chapterTitle', 'One'], ['content', 'Words.']]) });
  }
  chapterId = models.listChaptersForStory(models.listStories().find((s) => s.title === 'Zebra crossing').id)[0].id;
});

test.after(() => app.stop());

test('the page remembers the paragraph you stopped at, and forgets it at the end', async () => {
  let page = await (await luis.request(`/chapters/${chapterId}`)).text();
  assert.doesNotMatch(page, /data-place=/);
  await luis.request(`/chapters/${chapterId}/place`, { method: 'POST', ...form([['paragraph', '7'], ['total', '12']]) });
  page = await (await luis.request(`/chapters/${chapterId}`)).text();
  assert.match(page, /data-place="7" data-place-of="12"/);
  assert.match(page, /src="\/js\/reading-place\.js"/);
  // Only yours: Ana has not been reading it.
  assert.doesNotMatch(await (await ana.request(`/chapters/${chapterId}`)).text(), /data-place=/);
  await luis.request(`/chapters/${chapterId}/place`, { method: 'POST', ...form([['paragraph', '12'], ['total', '12']]) });
  assert.doesNotMatch(await (await luis.request(`/chapters/${chapterId}`)).text(), /data-place=/);
});

test('the front page can be ordered, and narrowed to your own stories', async () => {
  const latest = await (await ana.request('/')).text();
  assert.match(latest, /href="\/find">Advanced search/);
  const az = (await (await ana.request('/?shelf=all&sort=title')).text()).split('id="library"')[1];
  assert.ok(az.indexOf('>Anchorage<') < az.indexOf('>Zebra crossing<'), 'A to Z');
  const mine = (await (await ana.request('/?shelf=all&sort=mine')).text()).split('id="library"')[1];
  assert.match(mine, /that you write in/);
  assert.match(mine, />Zebra crossing</);
  assert.doesNotMatch(mine, />Anchorage</);
});

test('naming somebody in a note puts it in their inbox, and links their page', async () => {
  // Ana's last visit to the front page is the line "since" is drawn from.
  await ana.request('/');
  await new Promise((r) => setTimeout(r, 1100));
  const version = models.getLatestVersion(chapterId);
  const other = models.listStories().find((s) => s.title === 'Salt');
  const otherVersion = models.getLatestVersion(models.listChaptersForStory(other.id)[0].id);
  models.createComment({ versionId: otherVersion.id, authorId: models.getUserByUsername('luis').id, body: 'Ask @ana about the salt, not @anabel.' });
  models.createComment({ versionId: version.id, authorId: models.getUserByUsername('luis').id, body: 'Nothing for @anabel here.' });
  const home = await (await ana.request('/')).text();
  assert.match(home, /Replies and mentions/);
  assert.match(home, /mentioned you:/);
  assert.doesNotMatch(home, /Nothing for @anabel/);
  const chapter = await (await ana.request(`/chapters/${models.listChaptersForStory(other.id)[0].id}`)).text();
  assert.match(chapter, /<a class="mention" href="\/users\/ana">@ana<\/a>/);
  assert.match(chapter, /id="mention-people"/);
});

test('the site can be installed, and its furniture needs no sign-in', async () => {
  const outsider = makeClient(app.base);
  const manifest = await outsider.request('/manifest.webmanifest');
  assert.strictEqual(manifest.status, 200);
  assert.match(manifest.headers.get('content-type'), /manifest\+json/);
  assert.strictEqual(JSON.parse(await manifest.text()).start_url, '/');
  const sw = await outsider.request('/sw.js');
  assert.strictEqual(sw.status, 200);
  assert.strictEqual(sw.headers.get('service-worker-allowed'), '/');
  assert.strictEqual((await outsider.request('/icons/icon-192.png')).status, 200);
  assert.strictEqual((await outsider.request('/offline.html')).status, 200);
  const page = await (await ana.request('/')).text();
  assert.match(page, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(page, /src="\/js\/pwa\.js"/);
});
