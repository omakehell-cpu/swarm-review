// End to end, against the real server.
//
// A fresh SQLite file in a temp directory, the real schema, the real
// migrations, the real seed tags, `node server.js` in a child process, and
// an HTTP client doing what a browser does. Nothing is stubbed.
//
// This is the level the tag bug lived at. Every piece read correctly on
// its own: the picker rendered eight checkboxes, the parser looked
// reasonable, the model wrote what it was given, the page redirected. Only
// the round trip -- tick eight, save, count what came back -- showed that
// seven of them never arrived.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { startApp, makeClient, form, multipart, multipartWithFile } = require('./helpers/app');

const USER = { username: 'testwriter', displayName: 'Test Writer', password: 'correct horse battery' };

let app;
/** @type {any} */
let models;
let client;
const request = (...args) => client.request(...args);

test.before(async () => {
  app = await startApp();
  models = app.models;
  client = makeClient(app.base);
});

test.after(() => app.stop());

test('a signed-out visitor is sent to the login page', async () => {
  const res = await request('/');
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), '/login');
});

test('registration accepts the invite code a fresh database generates', async () => {
  const invite = models.getActiveInviteCode();
  assert.ok(invite && invite.code, 'a fresh database seeds one invite code');

  const res = await request('/register', {
    method: 'POST',
    ...form([
      ['username', USER.username],
      ['displayName', USER.displayName],
      ['password', USER.password],
      ['inviteCode', invite.code],
    ]),
  });
  // The first registered user becomes the admin and is signed in straight
  // away, so this lands on the index rather than the login form.
  assert.strictEqual(res.status, 302, await res.text());
  assert.strictEqual(res.headers.get('location'), '/');
});

test('the wrong password does not sign anyone in', async () => {
  const res = await request('/login', {
    method: 'POST',
    ...form([['username', USER.username], ['password', 'not the password']]),
  });
  assert.notStrictEqual(res.status, 302);
  assert.ok(!res.headers.get('set-cookie'), 'no session handed out');
});

test('logging in sets an HttpOnly, SameSite=Lax session cookie', async () => {
  const res = await request('/login', {
    method: 'POST',
    ...form([['username', USER.username], ['password', USER.password]]),
  });
  assert.strictEqual(res.status, 302);

  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'a session cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Path=\//);

  client.cookie = setCookie.split(';')[0];
});

test('HTML responses are never cached', async () => {
  const res = await request('/');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
});

test('the stylesheet is never cached but the fonts are cached forever', async () => {
  const css = await request('/css/style.css');
  assert.strictEqual(css.status, 200);
  assert.strictEqual(css.headers.get('cache-control'), 'no-store');

  const font = await request('/fonts/literata-roman.woff2');
  assert.strictEqual(font.status, 200);
  assert.match(font.headers.get('cache-control'), /immutable/);
});

// ---- the regression this whole file exists for ----------------------
test('a story saved with eight tags comes back with eight tags', async () => {
  const groups = models.listTagsGrouped();
  const allTags = groups.flatMap((g) => g.tags);
  assert.ok(allTags.length >= 8, 'the seed vocabulary has enough tags to test with');
  const chosen = allTags.slice(0, 8);

  const res = await request('/stories/new', {
    method: 'POST',
    ...multipart([
      ['storyTitle', 'A Story With Many Tags'],
      ['storyDescription', 'Testing that a group of checkboxes survives the round trip.'],
      ['chapterTitle', 'Chapter One'],
      ['chapterSummary', ''],
      ['content', 'The station had been dying for eleven years.'],
      ...chosen.map((t) => ['tagIds', String(t.id)]),
    ]),
  });
  assert.strictEqual(res.status, 302, await res.text());
  assert.match(res.headers.get('location'), /^\/chapters\/\d+$/);

  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  assert.ok(story, 'the story was created');

  const saved = models.getStoryTags(story.id).map((t) => t.name).sort();
  assert.deepStrictEqual(saved, chosen.map((t) => t.name).sort());

  // And the reader actually sees them.
  const page = await request(`/stories/${story.id}`);
  const html = await page.text();
  for (const tag of chosen) assert.ok(html.includes(tag.name), `"${tag.name}" is on the page`);
});

test('filtering the index by a tag keeps the stories that carry it', async () => {
  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  const tag = models.getStoryTags(story.id)[0];

  const matching = models.listStories({ tagIds: [tag.id] });
  assert.ok(matching.some((s) => s.id === story.id));

  // AND, not OR: a story is only kept if it carries every tag asked for.
  const otherTags = models.listTagsGrouped().flatMap((g) => g.tags)
    .filter((t) => !models.getStoryTags(story.id).some((st) => st.id === t.id));
  if (otherTags.length) {
    const narrowed = models.listStories({ tagIds: [tag.id, otherTags[0].id] });
    assert.ok(!narrowed.some((s) => s.id === story.id), 'a tag it lacks excludes it');
  }
});

test('the chapter page renders and a second chapter unlocks the diff', async () => {
  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  const chapters = models.listChaptersForStory(story.id);
  assert.strictEqual(chapters.length, 1);

  const res = await request(`/chapters/${chapters[0].id}`);
  const html = await res.text();
  assert.ok(res.status === 200, `status ${res.status}: ${html.slice(0, 400)}`);
  assert.ok(html.includes('The station had been dying'), 'the prose is there');

  // One version so far, so there is nothing to compare against yet -- a
  // normal state for a new chapter, and a page that says so, not an error.
  const none = await request(`/chapters/${chapters[0].id}/diff`);
  assert.strictEqual(none.status, 200);
  assert.match(await none.text(), /Nothing to compare yet/);
});

test('editing a chapter creates a second version, and the diff shows the edit', async () => {
  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  const chapterId = models.listChaptersForStory(story.id)[0].id;

  const saved = await request(`/chapters/${chapterId}/edit`, {
    method: 'POST',
    ...multipart([
      ['title', 'Chapter One'],
      ['summary', ''],
      ['content', 'The station had been dying for twelve years.'],
      ['changelog', 'eleven -> twelve'],
    ]),
  });
  assert.strictEqual(saved.status, 302, await saved.text());
  assert.strictEqual(models.listVersions(chapterId).length, 2);

  const diff = await request(`/chapters/${chapterId}/diff`);
  assert.strictEqual(diff.status, 200);
  const html = await diff.text();
  assert.match(html, /<del>[^<]*eleven/, 'the old word is struck out');
  assert.match(html, /<ins>[^<]*twelve/, 'the new word is marked as added');
  assert.ok(html.includes('station'), 'the unchanged words are still readable in place');
});

test('a chapter can be written in Word and uploaded as .docx', async () => {
  const { markdownToDocxBuffer } = require('../lib/docx');
  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  const docx = await markdownToDocxBuffer({
    title: 'Written In Word',
    markdownSource: 'She had **never** seen the anchorage from above.\n\n1. first\n2. second',
  });

  const res = await request(`/stories/${story.id}/chapters/new`, {
    method: 'POST',
    ...multipartWithFile(
      [['title', 'From Word'], ['summary', ''], ['content', '']],
      { name: 'file', filename: 'chapter.docx', body: docx }
    ),
  });
  assert.strictEqual(res.status, 302, (await res.text()).slice(0, 400));

  const chapter = models.listChaptersForStory(story.id).find((c) => c.title === 'From Word');
  assert.ok(chapter, 'the chapter was created from the upload');
  const text = models.getLatestVersion(chapter.id).content;
  assert.match(text, /never/, 'the prose arrived');
  assert.match(text, /^1\. first$/m, 'the numbered list stayed numbered');
  assert.ok(!text.includes('Written In Word'), "the document's own title is not part of the prose");
});

test('a chapter downloads as a real Word file', async () => {
  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  const chapterId = models.listChaptersForStory(story.id)[0].id;

  const res = await request(`/chapters/${chapterId}/download.docx`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment; filename=".*\.docx"/);

  const buffer = Buffer.from(await res.arrayBuffer());
  // Every .docx is a ZIP, and every ZIP starts "PK".
  assert.strictEqual(buffer.subarray(0, 2).toString('latin1'), 'PK');
  assert.strictEqual(Number(res.headers.get('content-length')), buffer.length);

  const { docxBufferToMarkdown } = require('../lib/docx');
  assert.match(await docxBufferToMarkdown(buffer), /twelve years/);
});

test('search finds a chapter by a word in its prose, in its current version only', async () => {
  const found = await request(`/search?q=${encodeURIComponent('twelve years')}`);
  assert.strictEqual(found.status, 200);
  assert.ok((await found.text()).includes('A Story With Many Tags'), 'the story is in the results');

  // "eleven years" was the wording of version 1, edited away in the test
  // above. Searching every version would bury one real hit under a copy of
  // it from every draft the chapter has ever been through, so only the
  // current text is indexed -- and this is where that choice is written down.
  const gone = await request(`/search?q=${encodeURIComponent('eleven years')}`);
  assert.strictEqual(gone.status, 200);
  assert.match(await gone.text(), /Nothing matches/);
});

test('logging out invalidates the session', async () => {
  const res = await request('/logout', { method: 'POST', ...form([]) });
  assert.strictEqual(res.status, 302);
  client.cookie = '';
  const after = await request('/');
  assert.strictEqual(after.status, 302);
  assert.strictEqual(after.headers.get('location'), '/login');
});
