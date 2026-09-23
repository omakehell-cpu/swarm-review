// What a screen reader is given, against the real server. The automated
// half of the accessibility work (contrast, names, landmarks) is checked
// by scripts/a11y-audit.js in a browser; this is the part that lives in
// the HTML itself and must not quietly go away.
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
    method: 'POST', ...form([['username', 'ana'], ['displayName', 'Ana'], ['password', PASSWORD], ['inviteCode', invite.code]]),
  });
  await ana.login('ana', PASSWORD);
  models.createUser({ username: 'luis', displayName: 'Luis', passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  luis = makeClient(app.base);
  await luis.login('luis', PASSWORD);
  await ana.request('/stories/new', {
    method: 'POST',
    ...multipart([['storyTitle', 'Anchorage'], ['chapterTitle', 'The long watch'],
      ['content', 'Kessler came up the spine.\n\n---\n\nLater, in the galley, nobody spoke.']]),
  });
  const story = models.listStories()[0];
  chapterId = models.listChaptersForStory(story.id)[0].id;
  // A bible entry, so there is a name in the prose to be a link.
  models.createStoryEntity({ storyId: story.id, name: 'Kessler', kind: 'person', createdBy: models.getUserByUsername('ana').id });
});

test.after(() => app.stop());

test('every page starts with a way past the navigation, and a chapter skips to its first line', async () => {
  const home = await (await luis.request('/')).text();
  assert.match(home, /<a class="skip-link" href="#content">Skip to content<\/a>/);
  assert.match(home, /<main id="content"/);
  const chapter = await (await luis.request(`/chapters/${chapterId}`)).text();
  assert.match(chapter, /href="#chapter-text">Skip to the chapter</);
  assert.match(chapter, /<article class="reading-pane" aria-labelledby="chapter-title">/);
});

test('a scene break is said, not just drawn', async () => {
  const chapter = await (await luis.request(`/chapters/${chapterId}`)).text();
  assert.match(chapter, /<hr aria-label="Scene break">/);
});

test('each note has a heading that says whose it is, what kind, and what it is about', async () => {
  const version = models.getLatestVersion(chapterId);
  await luis.request(`/chapters/${chapterId}/comments`, {
    method: 'POST',
    ...form([['versionId', String(version.id)], ['start', '0'], ['end', '7'], ['quoted', 'Kessler'], ['kind', 'question'], ['body', 'Who?']]),
  });
  const chapter = await (await ana.request(`/chapters/${chapterId}`)).text();
  assert.match(chapter, /<h3 class="sr-only">Note by Luis, question, pending, on “Kessler”/);
  assert.match(chapter, /class="note-goto" href="#passage-\d+">Go to the passage</);
});

test('the two chapter navigations are told apart', async () => {
  const chapter = await (await luis.request(`/chapters/${chapterId}`)).text();
  assert.doesNotMatch(chapter, /aria-label="Chapters"/);
});

test('a reader can ask for chapters with no links in the prose, opening in Read mode', async () => {
  const before = await (await luis.request(`/chapters/${chapterId}`)).text();
  assert.match(before, /class="wiki-link[^"]*"[^>]*>Kessler</, 'the name is a link by default');
  await luis.request('/account/reading', { method: 'POST', ...form([['readFirst', '1'], ['plainNames', '1']]) });
  const after = await (await luis.request(`/chapters/${chapterId}`)).text();
  assert.doesNotMatch(after, /class="wiki-link/, 'and plain words once asked');
  assert.match(after, /data-read-first="1"/);
  const account = await (await luis.request('/account')).text();
  assert.match(account, /name="plainNames" value="1" checked/);
  assert.match((await (await ana.request(`/chapters/${chapterId}`)).text()), /class="wiki-link/, 'only for the person who asked');
});

test('a wide table scrolls in its own box, which the keyboard can reach', async () => {
  const story = models.listStories()[0];
  const outline = await (await ana.request(`/stories/${story.id}/outline`)).text();
  assert.match(outline, /<div class="outline-wrap" role="region" aria-label="[^"]+" tabindex="0">/);
  const { wikitextToHtml } = require('../lib/wiki');
  const html = wikitextToHtml('{|\n|+ Ranks\n! Rank !! Pay\n|-\n| One || Two\n|}');
  assert.match(html, /<div class="wiki-table-wrap" role="region" tabindex="0" aria-label="Ranks">/);
});
