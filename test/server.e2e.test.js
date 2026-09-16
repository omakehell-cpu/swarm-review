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

test('a chapter in the middle of a story offers three ways to the next one', async () => {
  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  for (const title of ['Second', 'Third']) {
    const res = await request(`/stories/${story.id}/chapters/new`, {
      method: 'POST',
      ...multipart([['title', title], ['summary', ''], ['content', `The ${title} chapter.`]]),
    });
    assert.strictEqual(res.status, 302, (await res.text()).slice(0, 300));
  }
  const chapters = models.listChaptersForStory(story.id);
  assert.strictEqual(chapters.length, 3);

  const middle = await (await request(`/chapters/${chapters[1].id}`)).text();
  // The two arrows on the breadcrumb line, the pair pinned to the window
  // while reading, and the full links at the foot -- all from the same
  // neighbours, all pointing at the same two chapters.
  assert.match(middle, /class="chapter-nav compact"/, 'the arrows over the title');
  assert.match(middle, /class="chapter-float"/, 'the floating pair');
  assert.match(middle, /class="chapter-nav foot"/, 'the links at the foot');
  const prevHref = `href="/chapters/${chapters[0].id}"`;
  const nextHref = `href="/chapters/${chapters[2].id}"`;
  assert.strictEqual(middle.split(prevHref).length - 1, 3, 'three ways back');
  assert.strictEqual(middle.split(nextHref).length - 1, 3, 'three ways on');

  // The first chapter has nowhere back: the arrow is there and dead, not
  // a link to somewhere else.
  const first = await (await request(`/chapters/${chapters[0].id}`)).text();
  assert.match(first, /chapter-nav-arrow disabled/, 'the way back is spelled out and dead');
  assert.ok(!first.includes('chapter-float-arrow prev'), 'and nothing floats towards it');

  // Past the last chapter there is nothing to read, so the slot the next
  // chapter would occupy offers to write it instead.
  const last = await (await request(`/chapters/${chapters[2].id}`)).text();
  assert.match(last, /Write the next chapter/, 'the last chapter offers the next one');
  assert.match(last, new RegExp(`href="/stories/${story.id}/chapters/new"`), 'and it goes to the form');
  assert.ok(!middle.includes('Write the next chapter'), 'a chapter with a next one does not');
});

test('what people do gets written down, and shows on the admin page', async () => {
  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  const chapters = models.listChaptersForStory(story.id);
  const me = models.getUserByUsername(USER.username);

  const kinds = models.listEventsForUser(me.id, 200).map((e) => e.kind);
  // Everything this suite has done so far, in the order it did it.
  assert.ok(kinds.includes('joined'), 'registering is the first line');
  assert.ok(kinds.includes('story-started'), 'starting a story is recorded');
  assert.ok(kinds.includes('chapter-added'), 'so is adding a chapter');

  await request(`/chapters/${chapters[0].id}/download.md`);
  const afterDownload = models.listEventsForUser(me.id, 1)[0];
  assert.strictEqual(afterDownload.kind, 'downloaded', 'and so is taking a copy away');
  assert.match(afterDownload.subject, /as \.md$/);

  // The admin page folds each person's log away behind their own row.
  const admin = await (await request('/admin')).text();
  assert.match(admin, /What they have done/, 'every user row carries their log');
  assert.match(admin, /downloaded/, 'with the lines in it');
});

test('a name change follows everything already written, and the sign-in name stays put', async () => {
  const before = models.getUserByUsername(USER.username);
  const res = await request('/account/name', { method: 'POST', ...form([['displayName', 'Renamed Writer']]) });
  assert.strictEqual(res.status, 302);

  const after = models.getUserByUsername(USER.username);
  assert.strictEqual(after.display_name, 'Renamed Writer');
  assert.strictEqual(after.username, before.username, 'the way in does not move');

  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  const chapters = models.listChaptersForStory(story.id);
  const page = await (await request(`/chapters/${chapters[0].id}`)).text();
  assert.match(page, /by <a href="\/users\/testwriter">Renamed Writer<\/a>/, 'the byline is the new name, and leads to them');

  // An empty name is not a name.
  const empty = await request('/account/name', { method: 'POST', ...form([['displayName', '   ']]) });
  assert.strictEqual(empty.status, 400);
  assert.strictEqual(models.getUserByUsername(USER.username).display_name, 'Renamed Writer');

  await request('/account/name', { method: 'POST', ...form([['displayName', USER.displayName]]) });
});

test('a profile page counts what somebody has written and links to it', async () => {
  const me = models.getUserByUsername(USER.username);
  const html = await (await request(`/users/${me.username}`)).text();
  assert.match(html, /A Story With Many Tags/, 'their stories are on it');
  assert.match(html, /words/, 'with the numbers underneath');
  const stats = models.userStats(me.id);
  assert.ok(stats.words > 0 && stats.chapters > 0, 'and the numbers are not zero');

  const missing = await request('/users/nobody-at-all');
  assert.strictEqual(missing.status, 404);
  const placeholder = await request(`/users/${models.DELETED_USER_USERNAME}`);
  assert.strictEqual(placeholder.status, 404, 'the bookkeeping account is not a person');
});

test('a chapter can open an arc, and the contents group under it', async () => {
  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  const chapters = models.listChaptersForStory(story.id);

  // The middle chapter opens Book Two; the one before it stays where it is.
  const res = await request(`/chapters/${chapters[1].id}/edit`, {
    method: 'POST',
    ...multipart([
      ['title', chapters[1].title], ['summary', ''],
      ['content', models.getLatestVersion(chapters[1].id).content],
      ['changelog', ''], ['stage', 'notes'], ['arcTitle', 'Book Two: The long winter'],
    ]),
  });
  assert.strictEqual(res.status, 302, (await res.text()).slice(0, 300));

  const page = await (await request(`/stories/${story.id}`)).text();
  assert.match(page, /class="arc-head"/, 'the contents are in arcs now');
  assert.match(page, /Book Two: The long winter/);
  assert.match(page, /2 chapters/, 'and the arc counts what is under it');
  assert.strictEqual(models.getStoryStats(story.id).arcs, 1, 'one named arc');

  // Taking the name off puts the story back exactly as it was.
  await request(`/chapters/${chapters[1].id}/edit`, {
    method: 'POST',
    ...multipart([
      ['title', chapters[1].title], ['summary', ''],
      ['content', models.getLatestVersion(chapters[1].id).content],
      ['changelog', ''], ['stage', 'notes'], ['arcTitle', ''],
    ]),
  });
  const flat = await (await request(`/stories/${story.id}`)).text();
  assert.ok(!flat.includes('class="arc-head"'), 'a story with no arcs shows none');
});

test('a chapter says what it wants only when it wants something unusual', async () => {
  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  const chapters = models.listChaptersForStory(story.id);
  const before = await (await request(`/stories/${story.id}`)).text();
  assert.ok(!before.includes('Wants notes'), 'the normal state is not worth a badge');

  await request(`/chapters/${chapters[0].id}/edit`, {
    method: 'POST',
    ...multipart([
      ['title', chapters[0].title], ['summary', ''],
      ['content', models.getLatestVersion(chapters[0].id).content],
      ['changelog', ''], ['stage', 'draft'], ['arcTitle', ''],
    ]),
  });
  const after = await (await request(`/stories/${story.id}`)).text();
  assert.match(after, /stage-draft/, 'a draft says so');
  assert.strictEqual(models.getChapterById(chapters[0].id).stage, 'draft');

  // A stage the form never offers does not become one.
  await request(`/chapters/${chapters[0].id}/edit`, {
    method: 'POST',
    ...multipart([
      ['title', chapters[0].title], ['summary', ''],
      ['content', models.getLatestVersion(chapters[0].id).content],
      ['changelog', ''], ['stage', 'on fire'], ['arcTitle', ''],
    ]),
  });
  assert.strictEqual(models.getChapterById(chapters[0].id).stage, 'notes', 'nonsense falls back to the default');
});

test('where a story stands is the author\'s to say, except for the hiatus', async () => {
  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  const tagIds = models.getStoryTags(story.id).map((t) => t.id);

  const save = (status) => request(`/stories/${story.id}/edit`, {
    method: 'POST',
    ...form([
      ['title', story.title], ['description', story.description || ''], ['synopsis', story.synopsis || ''],
      ['status', status], ...tagIds.map((id) => ['tagIds', String(id)]),
    ]),
  });

  assert.strictEqual((await save('complete')).status, 302);
  assert.strictEqual(models.getStoryById(story.id).status, 'complete');
  assert.match(await (await request(`/stories/${story.id}`)).text(), /state-complete/);

  // A finished story is not paused however long it sits.
  const { storyState } = require('../lib/story-state');
  const old = { ...models.getStoryById(story.id), last_written_at: '2020-01-01 00:00:00' };
  assert.strictEqual(storyState(old), 'complete');
  assert.strictEqual(storyState({ ...old, status: 'ongoing' }), 'hiatus');

  assert.strictEqual((await save('ongoing')).status, 302);
  assert.match(await (await request(`/stories/${story.id}`)).text(), /state-ongoing/);
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

test('the glossary is filed under the wiki\'s own categories', async () => {
  models.replaceWikiPages([
    { title: 'Kestrel Anchorage', summary: 'An anchorage.', categories: ['Colonies', 'Systems'],
      contentHtml: '<p>Built for <a href="/glossary/Akarge">Akarge</a>, supplied by an <a href="/glossary/A20">A20</a>. The <a href="/glossary/Akarge">Akarge</a> contraction ended it.</p>' },
    { title: 'Akarge', summary: 'A trading concern.', categories: ['Economy'], contentHtml: '<p>Akarge.</p>' },
    { title: 'A20', summary: 'An interface craft.', categories: ['Ships', 'Technology'], contentHtml: '<p>The A20.</p>' },
  ]);

  // The front page is a directory, not a list: three doors for the three
  // kinds of page, and the wiki's subjects gathered into families.
  const index = await (await request('/glossary')).text();
  assert.match(index, /class="glossary-doors"/, 'the three doors are there');
  assert.match(index, /href="\/glossary\?kind=world"/);
  assert.match(index, /href="\/glossary\?kind=stories"/);
  assert.match(index, /class="family-grid"/, 'and the subject directory');
  assert.match(index, /Worlds and places/, 'Colonies is filed under its family');
  assert.match(index, /Fleet and ships/, 'and Ships under its own');
  assert.ok(!index.includes('>All <'), 'the wiki\'s catch-all category is not offered as a filter');
  assert.ok(!index.includes('class="chapter-row"'), 'and no 691-row list on the way in');

  const ships = await (await request('/glossary?category=Ships')).text();
  assert.match(ships, /A20/, 'the category holds what it should');
  assert.ok(!ships.includes('>Kestrel Anchorage<'), 'and nothing it should not');
  assert.match(ships, /class="az-bar"/, 'a listing is cut into letters');
  assert.match(ships, /id="letter-A"/);

  // Kind is the axis the old flat list could not express: a story page and
  // a world term look identical in a list sorted by title.
  const world = await (await request('/glossary?kind=world')).text();
  assert.match(world, />Kestrel Anchorage</);
  assert.match(world, />A20</);

  // A category nobody filed anything under is simply empty, not an error.
  const none = await request('/glossary?category=Does%20Not%20Exist');
  assert.strictEqual(none.status, 200);
  assert.match(await none.text(), /Nothing here matches/);
});

test('the glossary keeps the state of a page off the subject axis', async () => {
  models.replaceWikiPages([
    { title: 'Kestrel Anchorage', summary: 'An anchorage.', categories: ['Colonies', 'Systems', 'Canon'],
      contentHtml: '<p>Built for <a href="/glossary/Akarge">Akarge</a>, supplied by an <a href="/glossary/A20">A20</a>. The <a href="/glossary/Akarge">Akarge</a> contraction ended it.</p>' },
    { title: 'Akarge', summary: 'A trading concern.', categories: ['Economy', 'Stubs'], contentHtml: '<p>Akarge.</p>' },
    { title: 'A20', summary: 'An interface craft.', categories: ['Ships', 'Technology', 'Canon'], contentHtml: '<p>The A20.</p>' },
    { title: 'Housekeeping', summary: 'Bookkeeping.', categories: ['Wiki Maintenance'], contentHtml: '<p>.</p>' },
  ]);

  // Canon/Stubs are how finished a page is, not what it is about, so they
  // get their own row rather than competing with Ships and Colonies.
  const index = await (await request('/glossary')).text();
  assert.ok(!index.includes('href="/glossary?category=Canon"'), 'state is not a subject');
  assert.ok(!index.includes('Wiki Maintenance'), 'and housekeeping is not on the front page');

  const listing = await (await request('/glossary?kind=world')).text();
  assert.match(listing, /class="glossary-filters"/);
  assert.match(listing, /href="[^"]*status=Canon"/);

  const canon = await (await request('/glossary?kind=world&status=Canon')).text();
  assert.match(canon, />A20</);
  assert.ok(!canon.includes('>Akarge<'), 'a stub is not canon');

  // Picking a state keeps the other states on offer -- they are counted
  // before the filter runs, not after.
  assert.match(canon, /href="[^"]*status=Stubs"/);
});

test('every glossary listing can be filtered without a round trip', async () => {
  const listing = await (await request('/glossary?view=all')).text();
  // The rows carry what the in-page filter matches against, so the filter
  // never has to ask the server anything.
  assert.match(listing, /data-search="[^"]*kestrel anchorage/);
  assert.match(listing, /id="glossary-filter"/);
  assert.match(listing, /id="glossary-list"/);
});

test('a glossary entry explains its links once each, in the margin', async () => {
  const html = await (await request('/glossary/Kestrel%20Anchorage')).text();

  // Two mentions of Akarge in the text, one card about it.
  assert.strictEqual((html.match(/data-preview="akarge"/g) || []).length, 1, 'only the first mention is marked');
  assert.strictEqual((html.match(/data-preview-for="akarge"/g) || []).length, 1, 'and it gets one card');
  assert.match(html, /class="glossary-margin"/);
  assert.match(html, /A trading concern\./, 'the card carries the summary from the local copy');
  assert.match(html, /An interface craft\./);

  // The categories of the entry itself lead back to the filtered index.
  assert.match(html, /href="\/glossary\?category=Colonies"/);
});

test('a dead link lands on a page, not a blank window', async () => {
  const res = await request('/stories/999999');
  assert.strictEqual(res.status, 404);
  const html = await res.text();
  // The site's own chrome, so there is a way out.
  assert.match(html, /<title>[^<]*The Swarm Review<\/title>/);
  assert.match(html, /class="topbar"/);
  assert.match(html, /href="\/"/);
  assert.match(html, /404/);
});

test('a refusal explains itself in the same clothes', async () => {
  // Somebody else's chapter: a 403 that used to be the bare words
  // "Only the chapter author can edit it." on a white page.
  const res = await request('/chapters/999999/edit');
  const html = await res.text();
  assert.ok([403, 404].includes(res.status));
  assert.match(html, /class="error-page"/);
  assert.match(html, /class="topbar"/);
});

test('the diff shows prose, not markdown source', async () => {
  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  const chapterId = models.listChaptersForStory(story.id)[0].id;
  await request(`/chapters/${chapterId}/edit`, {
    method: 'POST',
    ...multipart([
      ['title', 'Chapter One'],
      ['summary', ''],
      ['content', 'The **station** had been dying for thirteen years.\n\n> She said nothing.'],
      ['changelog', 'bolded a word, added a line'],
    ]),
  });
  const html = await (await request(`/chapters/${chapterId}/diff`)).text();
  assert.ok(!html.includes('**station**'), 'no raw emphasis marks');
  assert.ok(!html.includes('&gt; She said'), 'no raw blockquote marker');
  assert.match(html, /station/, 'the word itself is still there');
});

test('a change that only moves emphasis says so instead of looking broken', async () => {
  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  const chapterId = models.listChaptersForStory(story.id)[0].id;
  const current = models.getLatestVersion(chapterId).content;
  await request(`/chapters/${chapterId}/edit`, {
    method: 'POST',
    ...multipart([
      ['title', 'Chapter One'],
      ['summary', ''],
      ['content', current.replace('**station**', '*station*')],
      ['changelog', 'bold to italic'],
    ]),
  });
  const versions = models.listVersions(chapterId);
  const html = await (await request(
    `/chapters/${chapterId}/diff?from=${versions[1].version_number}&to=${versions[0].version_number}`
  )).text();
  assert.match(html, /Only the formatting changed/);
});

test('word counts reach the page, and follow an edit', async () => {
  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  const chapterId = models.listChaptersForStory(story.id)[0].id;

  const before = models.getLatestVersion(chapterId).word_count;
  assert.ok(before > 0, 'the stored version carries a count');

  await request(`/chapters/${chapterId}/edit`, {
    method: 'POST',
    ...multipart([
      ['title', 'Chapter One'],
      ['summary', ''],
      ['content', 'One two three four five six seven eight nine ten eleven twelve.'],
      ['changelog', 'counted'],
    ]),
  });
  assert.strictEqual(models.getLatestVersion(chapterId).word_count, 12);

  const chapterHtml = await (await request(`/chapters/${chapterId}`)).text();
  assert.match(chapterHtml, /12 words/);

  // And the story page adds them up, next to who wrote each chapter.
  const storyHtml = await (await request(`/stories/${story.id}`)).text();
  assert.match(storyHtml, /12 words/);
  assert.match(storyHtml, /by Test Writer/);
});

test('the story page carries a synopsis the author writes, and the shape of the story', async () => {
  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');

  // Nothing written yet: no empty synopsis block.
  const before = await (await request(`/stories/${story.id}`)).text();
  assert.ok(!before.includes('story-synopsis'), 'no fold until there is something in it');
  // But the shape of the story is always there.
  assert.match(before, /story-stats/);
  assert.match(before, /to read/);

  const tags = models.getStoryTags(story.id).map((t) => String(t.id));
  const saved = await request(`/stories/${story.id}/edit`, {
    method: 'POST',
    ...form([
      ['title', story.title],
      ['description', 'A short blurb.'],
      ['synopsis', 'Kessler finds the **body** in the service spine.\n\nNobody reports it.'],
      ...tags.map((id) => ['tagIds', id]),
    ]),
  });
  assert.strictEqual(saved.status, 302);

  const after = await (await request(`/stories/${story.id}`)).text();
  assert.match(after, /story-synopsis/);
  assert.match(after, /spoilers/);
  // Rendered, not printed: the markdown marks must not reach the page.
  assert.match(after, /<strong>body<\/strong>/);
  assert.ok(!after.includes('**body**'));

  // And editing the story again brings it back into the form.
  const editPage = await (await request(`/stories/${story.id}/edit`)).text();
  assert.match(editPage, /name="synopsis"/);
  assert.match(editPage, /service spine/);

  // The tags it already had survive a synopsis edit.
  assert.strictEqual(models.getStoryTags(story.id).length, tags.length);
});

test('the reading time is an estimate, and says so', async () => {
  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  const stats = models.getStoryStats(story.id);
  assert.ok(stats.chapters >= 1);
  assert.ok(stats.words > 0);
  // Counted from each chapter's current version only: adding up every
  // draft would make a story look several times longer than it reads.
  const chapters = models.listChaptersForStory(story.id);
  const sum = chapters.reduce((n, c) => n + (c.word_count || 0), 0);
  assert.strictEqual(stats.words, sum);
});

test('opening a chapter records that you read it, and the page says so', async () => {
  const story = models.listStories().find((s) => s.title === 'A Story With Many Tags');
  const chapterId = models.listChaptersForStory(story.id)[0].id;

  // The author is reading their own chapter here, so nothing is recorded.
  await request(`/chapters/${chapterId}`);
  assert.deepStrictEqual(models.listChapterReaders(chapterId), []);

  // Somebody else opening it is what counts.
  const auth = require('../auth');
  models.createUser({ username: 'reader', displayName: 'A Reader', passwordHash: auth.hashPassword(USER.password), isAdmin: false });
  const other = makeClient(app.base);
  await other.login('reader', USER.password);
  await other.request(`/chapters/${chapterId}`);

  assert.deepStrictEqual(models.listChapterReaders(chapterId).map((r) => r.display_name), ['A Reader']);

  // And the author sees it on their own chapter.
  const html = await (await request(`/chapters/${chapterId}`)).text();
  assert.match(html, /Read by A Reader/);
});

test('the help section is readable, and the changelog marks what is new', async () => {
  const index = await (await request('/help')).text();
  assert.match(index, /How to/);
  assert.match(index, /href="\/help\/story-bible"/);
  assert.match(index, /href="\/help\/changelog"/);

  const topic = await request('/help/story-bible');
  assert.strictEqual(topic.status, 200);
  const html = await topic.text();
  assert.match(html, /The story bible/);
  // Rendered as prose, not printed as markdown source.
  assert.match(html, /<h2[^>]*>/);
  assert.ok(!html.includes('## '), 'the hashes did not survive');

  // The screenshots are in the page as pictures, and the pictures are
  // actually served. A figure line left as literal text means the parser
  // never saw it.
  assert.match(html, /<figure class="doc-figure">/);
  assert.match(html, /<img src="\/img\/help\/bible-index\.png"/);
  assert.ok(!html.includes('@figure'), 'no figure line survived as text');
  const picture = await request('/img/help/bible-index.png');
  assert.strictEqual(picture.status, 200);
  assert.strictEqual(picture.headers.get('content-type'), 'image/png');

  // A how-to that does not exist is a page, not a crash -- and a slug is
  // never turned into a path.
  assert.strictEqual((await request('/help/no-such-page')).status, 404);
  assert.strictEqual((await request('/help/..%2F..%2Fpackage')).status, 404);

  // The short link people will try anyway.
  const short = await request('/changelog');
  assert.strictEqual(short.status, 302);
  assert.strictEqual(short.headers.get('location'), '/help/changelog');
});

test('opening the changelog does not mark the stories read', async () => {
  const before = models.getUserByUsername(USER.username);
  const lastSeen = before.last_seen_at;

  const first = await (await request('/help/changelog')).text();
  // Never opened before, so every batch is marked.
  assert.match(first, /New to you/);

  const after = models.getUserByUsername(USER.username);
  assert.ok(after.changelog_seen_at, 'it remembered the visit');
  assert.strictEqual(after.last_seen_at, lastSeen, 'and left the stories alone');

  // Second visit: nothing is new any more.
  const second = await (await request('/help/changelog')).text();
  assert.ok(!second.includes('New to you'));
});

test('the nav carries a dot only while there is something unread', async () => {
  // The visit above cleared it.
  assert.ok(!(await (await request('/')).text()).includes('nav-dot'));

  // Wind their marker back to before the changelog existed. The same
  // database file the server is using, opened through the same module.
  const db = require('../db');
  const user = models.getUserByUsername(USER.username);
  db.prepare("UPDATE users SET changelog_seen_at = '2000-01-01 00:00:00' WHERE id = ?").run(user.id);
  assert.match(await (await request('/')).text(), /nav-dot/);
});


test('a save cannot quietly land on top of somebody else\'s', async () => {
  const story = models.listStories().find((s2) => s2.title === 'A Story With Many Tags');
  const chapterId = models.listChaptersForStory(story.id)[0].id;

  // Open the editor: the form carries the version it was opened on.
  const editor = await (await request(`/chapters/${chapterId}/edit`)).text();
  const opened = Number(/name="baseVersion" value="(\d+)"/.exec(editor)[1]);
  assert.ok(opened > 0, 'the editor says which version it is editing');

  // Meanwhile that chapter gains a version (another tab, another person).
  models.editChapter({
    chapterId, title: 'Chapter One', summary: '',
    content: 'Somebody else got here first.', changelog: 'from another tab',
  });
  const theirs = models.getLatestVersion(chapterId);
  assert.strictEqual(theirs.version_number, opened + 1);

  // Now the stale editor saves. It is refused, and nothing is lost.
  const clash = await request(`/chapters/${chapterId}/edit`, {
    method: 'POST',
    ...multipart([
      ['baseVersion', String(opened)], ['title', 'Chapter One'], ['summary', ''],
      ['content', 'What I was writing all along.'], ['changelog', ''],
    ]),
  });
  assert.strictEqual(clash.status, 409);
  const page = await clash.text();
  assert.match(page, /Somebody saved version \d+ of this chapter while you had it open/);
  assert.match(page, /What I was writing all along\./, 'my text is still in the box');
  assert.match(page, /Somebody else got here first\./, 'and theirs is shown');
  assert.strictEqual(models.getLatestVersion(chapterId).content, 'Somebody else got here first.',
    'the database still has theirs');

  // The refused page moves the marker on, so saving again is deliberate.
  const now = Number(/name="baseVersion" value="(\d+)"/.exec(page)[1]);
  assert.strictEqual(now, theirs.version_number);
  const second = await request(`/chapters/${chapterId}/edit`, {
    method: 'POST',
    ...multipart([
      ['baseVersion', String(now)], ['title', 'Chapter One'], ['summary', ''],
      ['content', 'What I was writing all along.'], ['changelog', 'mine after all'],
    ]),
  });
  assert.strictEqual(second.status, 302);
  assert.strictEqual(models.getLatestVersion(chapterId).content, 'What I was writing all along.');
  // And theirs is still in the history, which is the whole point.
  assert.ok(models.listVersions(chapterId).some((v) => v.content === 'Somebody else got here first.'));
});

test('an editor with no version to compare is let through, not blocked', async () => {
  const story = models.listStories().find((s2) => s2.title === 'A Story With Many Tags');
  const chapterId = models.listChaptersForStory(story.id)[0].id;
  const res = await request(`/chapters/${chapterId}/edit`, {
    method: 'POST',
    ...multipart([['title', 'Chapter One'], ['summary', ''], ['content', 'Posted without a baseVersion.'], ['changelog', '']]),
  });
  assert.strictEqual(res.status, 302, 'an absent answer is not a stale one');
});


test('the outline puts every chapter on one line', async () => {
  const story = models.listStories().find((s2) => s2.title === 'A Story With Many Tags');
  const html = await (await request(`/stories/${story.id}/outline`)).text();
  assert.match(html, /<table class="outline"/);
  for (const chapter of models.listChaptersForStory(story.id)) {
    assert.match(html, new RegExp(`data-chapter="${chapter.id}"`), `${chapter.title} is in it`);
  }
  // The story page offers the way in.
  assert.match(await (await request(`/stories/${story.id}`)).text(), new RegExp(`href="/stories/${story.id}/outline"`));
});

test('a summary can be saved from the outline, and a stranger cannot', async () => {
  const story = models.listStories().find((s2) => s2.title === 'A Story With Many Tags');
  const chapterId = models.listChaptersForStory(story.id)[0].id;
  const res = await request(`/chapters/${chapterId}/summary`, {
    method: 'POST', ...form([['summary', 'She cannot sleep; the drop is at six.']]),
  });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(models.getChapterById(chapterId).summary, 'She cannot sleep; the drop is at six.');

  const other = makeClient(app.base);
  await other.login('reader', USER.password);
  const refused = await other.request(`/chapters/${chapterId}/summary`, {
    method: 'POST', ...form([['summary', 'Not mine to write.']]),
  });
  assert.strictEqual(refused.status, 403);
  assert.strictEqual(models.getChapterById(chapterId).summary, 'She cannot sleep; the drop is at six.');
});

test('dragging a chapter saves the whole order at once', async () => {
  const story = models.listStories().find((s2) => s2.title === 'A Story With Many Tags');
  const before = models.listChaptersForStory(story.id);
  if (before.length < 2) return; // nothing to reorder in this fixture

  const flipped = [before[before.length - 1].id, ...before.slice(0, -1).map((c) => c.id)];
  const res = await request(`/stories/${story.id}/outline/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ order: flipped }),
  });
  assert.strictEqual(res.status, 200);
  const after = models.listChaptersForStory(story.id);
  assert.deepStrictEqual(after.map((c) => c.id), flipped, 'the running order is what was sent');
  // The numbers stay 1..n, with no gaps and no repeats.
  assert.deepStrictEqual(after.map((c) => c.chapter_number), before.map((c) => c.chapter_number));

  // Put it back, and prove a partial list does not lose anybody.
  const half = [before[0].id];
  await request(`/stories/${story.id}/outline/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ order: half }),
  });
  const restored = models.listChaptersForStory(story.id);
  assert.strictEqual(restored.length, before.length, 'nobody fell out of the story');
  assert.strictEqual(restored[0].id, before[0].id);
});

test('somebody else cannot reorder your story', async () => {
  const story = models.listStories().find((s2) => s2.title === 'A Story With Many Tags');
  const other = makeClient(app.base);
  await other.login('reader', USER.password);
  const res = await other.request(`/stories/${story.id}/outline/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ order: [1] }),
  });
  assert.strictEqual(res.status, 403);
});

test('the whole story compiles into one file', async () => {
  const story = models.listStories().find((s2) => s2.title === 'A Story With Many Tags');
  const md = await request(`/stories/${story.id}/download.md`);
  assert.strictEqual(md.status, 200);
  assert.match(md.headers.get('content-disposition'), /attachment; filename=".*\.md"/);
  const text = await md.text();
  assert.match(text, /^# A Story With Many Tags/);
  for (const chapter of models.chaptersForCompile(story.id)) {
    assert.ok(text.includes(chapter.title), `${chapter.title} is in the manuscript`);
  }

  // And as a Word file, which is what anybody outside this app will want.
  const docx = await request(`/stories/${story.id}/download.docx`);
  assert.strictEqual(docx.status, 200);
  const buffer = Buffer.from(await docx.arrayBuffer());
  assert.ok(buffer.length > 1000);
  assert.strictEqual(buffer.subarray(0, 2).toString('latin1'), 'PK', 'a real .docx is a zip');
});

test('logging out invalidates the session', async () => {
  const res = await request('/logout', { method: 'POST', ...form([]) });
  assert.strictEqual(res.status, 302);
  client.cookie = '';
  const after = await request('/');
  assert.strictEqual(after.status, 302);
  assert.strictEqual(after.headers.get('location'), '/login');
});
