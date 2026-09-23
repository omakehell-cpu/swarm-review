// The review loop, against the real server: kinds of note, a suggested
// rewrite put into the text with one click, notes that follow the chapter
// to its next version, and asking somebody to read.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart, multipartWithFile } = require('./helpers/app');

let app;
let models;
let ana;   // writes the chapter
let luis;  // reads it
let chapterId;

const PASSWORD = 'a long enough password';
const TEXT = [
  'The station had been dying for twelve years, and nobody said so out loud.',
  '',
  'Kessler came up the service spine at 04:20, boots ringing on grating that had lasted three.',
  '',
  'She had been *aboard* the **Kestrel Anchorage** for four hundred days.',
].join('\n');

const latest = () => models.getLatestVersion(chapterId);
const flat = () => require('../lib/suggestions').flatOf(latest().content);
const noteOn = async (client, quote, fields) => {
  const text = flat();
  const start = text.indexOf(quote);
  assert.ok(start >= 0, `"${quote}" is in the chapter`);
  return client.request(`/chapters/${chapterId}/comments`, {
    method: 'POST',
    ...form([
      ['versionId', String(latest().id)], ['start', String(start)], ['end', String(start + quote.length)],
      ['quoted', quote], ...fields,
    ]),
  });
};
const notesOn = (versionId) => models.listCommentsForVersion(versionId).filter((c) => c.parent_id == null);

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

  await ana.request('/stories/new', {
    method: 'POST',
    ...multipart([['storyTitle', 'Anchorage'], ['chapterTitle', 'The long watch'], ['content', TEXT]]),
  });
  chapterId = models.listChaptersForStory(models.listStories()[0].id)[0].id;
});

test.after(() => app.stop());

test('a note can say what kind of note it is', async () => {
  const res = await noteOn(luis, 'twelve years', [['kind', 'continuity'], ['body', 'Chapter three says eleven.']]);
  assert.strictEqual(res.status, 302);
  const note = notesOn(latest().id).find((c) => c.quoted_text === 'twelve years');
  assert.strictEqual(note.kind, 'continuity');
  assert.strictEqual(note.status, 'pending');
  const page = await (await ana.request(`/chapters/${chapterId}`)).text();
  assert.match(page, /kind-badge kind-continuity/);
});

test('praise needs no words and asks nothing of the author', async () => {
  const res = await noteOn(luis, 'nobody said so out loud', [['kind', 'praise'], ['body', '']]);
  assert.strictEqual(res.status, 302);
  const note = notesOn(latest().id).find((c) => c.kind === 'praise');
  assert.ok(note, 'the heart was kept');
  assert.strictEqual(note.status, 'accepted', 'it is not in the list of things to answer');
  const pending = models.inboxFor(models.getUserByUsername('ana').id).pending;
  assert.strictEqual(pending[0].pending, 1, 'only the continuity note is waiting');
});

test('an unknown kind is just a note', async () => {
  await noteOn(luis, 'Kessler came up', [['kind', 'nonsense'], ['body', 'Who is Kessler?']]);
  const note = notesOn(latest().id).find((c) => c.body === 'Who is Kessler?');
  assert.strictEqual(note.kind, '');
});

test('a rewrite left untouched is not a suggestion', async () => {
  await noteOn(luis, 'service spine', [['body', 'nice'], ['suggestSend', '1'], ['suggestion', 'service spine']]);
  const note = notesOn(latest().id).find((c) => c.body === 'nice');
  assert.strictEqual(note.suggestion, null);
});

test('only the author can apply a suggestion, and applying it makes a new version with the rewrite in it', async () => {
  await noteOn(luis, 'boots ringing on grating', [['body', ''], ['suggestSend', '1'], ['suggestion', 'boots loud on grating']]);
  const before = latest();
  const note = notesOn(before.id).find((c) => c.suggestion === 'boots loud on grating');
  assert.ok(note);

  const refused = await luis.request(`/comments/${note.id}/apply`, { method: 'POST', ...form([]) });
  assert.strictEqual(refused.status, 403);
  assert.strictEqual(latest().id, before.id);

  const page = await (await ana.request(`/chapters/${chapterId}`)).text();
  assert.match(page, new RegExp(`/comments/${note.id}/apply`), 'the author is offered the button');
  assert.match(page, /<del>ringing <\/del><ins>loud <\/ins>/, 'and sees the one word that changes');

  const res = await ana.request(`/comments/${note.id}/apply`, { method: 'POST', ...form([]) });
  assert.strictEqual(res.status, 302);
  const after = latest();
  assert.strictEqual(after.version_number, before.version_number + 1);
  assert.match(after.content, /boots loud on grating that had lasted three/);
  assert.match(after.content, /\*aboard\* the \*\*Kestrel Anchorage\*\*/, 'the rest of the markdown is untouched');
  const applied = models.getCommentById(note.id);
  assert.strictEqual(applied.status, 'accepted');
  assert.strictEqual(applied.applied_in, after.version_number);
  assert.strictEqual(applied.version_id, before.id, 'the applied note stays on the version it rewrote');
});

test('pending notes follow the chapter to its new version, re-anchored', async () => {
  const now = latest();
  const moved = notesOn(now.id);
  const continuity = moved.find((c) => c.kind === 'continuity');
  assert.ok(continuity, 'the continuity note came along');
  assert.strictEqual(continuity.left_on, now.version_number - 1);
  assert.strictEqual(flat().slice(continuity.start_offset, continuity.end_offset), 'twelve years');
  assert.ok(moved.find((c) => c.body === 'Who is Kessler?'), 'so did the question');
  assert.ok(!moved.find((c) => c.kind === 'praise'), 'settled notes stay where they were');
});

test('a note whose passage is rewritten by the author stays behind, and says so', async () => {
  const edited = latest().content.replace('Kessler came up', 'Nadia came up');
  const res = await ana.request(`/chapters/${chapterId}/edit`, {
    method: 'POST',
    ...multipart([['title', 'The long watch'], ['content', edited], ['baseVersion', String(latest().version_number)]]),
  });
  assert.strictEqual(res.status, 302);
  const question = notesOn(latest().id).find((c) => c.body === 'Who is Kessler?');
  assert.strictEqual(question, undefined, 'it did not follow');
  const behind = models.notesLeftBehind(chapterId);
  assert.strictEqual(behind.length, 1);
  assert.strictEqual(behind[0].passage_changed_in, latest().version_number);
  const page = await (await ana.request(`/chapters/${chapterId}`)).text();
  assert.match(page, /One note is still waiting on an earlier version/);
  assert.ok(notesOn(latest().id).find((c) => c.kind === 'continuity'), 'the continuity note moved again');
});

test('a suggestion that would break the formatting is refused, and nothing changes', async () => {
  // "aboard the Kestrel" runs from inside one emphasis into another.
  await noteOn(luis, 'aboard the Kestrel', [['body', ''], ['suggestSend', '1'], ['suggestion', 'on the Kite']]);
  const note = notesOn(latest().id).find((c) => c.suggestion === 'on the Kite');
  const before = latest();
  const res = await ana.request(`/comments/${note.id}/apply`, { method: 'POST', ...form([]) });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(latest().id, before.id);
  assert.strictEqual(models.getCommentById(note.id).status, 'pending');
});

test('asking somebody to read puts it at the top of their front page until they say they are done', async () => {
  const luisId = models.getUserByUsername('luis').id;
  const refused = await luis.request(`/chapters/${chapterId}/review-requests`, {
    method: 'POST', ...form([['reviewer', String(luisId)]]),
  });
  assert.strictEqual(refused.status, 403, 'only the author asks');

  await ana.request(`/chapters/${chapterId}/review-requests`, {
    method: 'POST', ...form([['reviewer', String(luisId)], ['reviewer', '999'], ['question', 'Does the ending land?']]),
  });
  const queue = models.reviewQueueFor(luisId);
  assert.strictEqual(queue.length, 1);
  assert.strictEqual(queue[0].question, 'Does the ending land?');

  const home = await (await luis.request('/')).text();
  assert.match(home, /Asked to read by you/);
  assert.match(home, /Does the ending land\?/);
  const chapter = await (await luis.request(`/chapters/${chapterId}`)).text();
  assert.match(chapter, /Ana asked you to read this/);

  await luis.request(`/review-requests/${queue[0].id}/done`, { method: 'POST', ...form([['note', 'It does.']]) });
  assert.strictEqual(models.reviewQueueFor(luisId).length, 0);
  const authorView = await (await ana.request(`/chapters/${chapterId}`)).text();
  assert.match(authorView, /It does\./);
});

test('a draft is kept for the author, is not a version, and becomes one only when published', async () => {
  const before = latest();
  const draftText = `${before.content}\n\nA paragraph still being written`;
  const refused = await luis.request(`/chapters/${chapterId}/draft`, { method: 'POST', ...form([['content', draftText]]) });
  assert.strictEqual(refused.status, 403, 'nobody else can keep a draft of it');

  const saved = await ana.request(`/chapters/${chapterId}/draft`, {
    method: 'POST', ...form([['content', draftText], ['title', 'The long watch'], ['baseVersion', String(before.version_number)]]),
  });
  assert.strictEqual(saved.status, 200);
  assert.strictEqual((await saved.json()).draft, true);
  assert.strictEqual(latest().id, before.id, 'no version was made');

  const editor = await (await ana.request(`/chapters/${chapterId}/edit`)).text();
  assert.match(editor, /This is your unpublished draft/);
  assert.match(editor, /A paragraph still being written/, 'the editor opens on the draft');
  const reader = await (await luis.request(`/chapters/${chapterId}`)).text();
  assert.doesNotMatch(reader, /A paragraph still being written/, 'readers still see the published text');

  // The "Save draft" button is the same form with a different intent.
  const button = await ana.request(`/chapters/${chapterId}/edit`, {
    method: 'POST',
    ...multipart([['title', 'The long watch'], ['content', `${draftText}, and more`], ['intent', 'draft'], ['baseVersion', String(before.version_number)]]),
  });
  assert.strictEqual(button.status, 302);
  assert.strictEqual(latest().id, before.id);

  const published = await ana.request(`/chapters/${chapterId}/edit`, {
    method: 'POST',
    ...multipart([['title', 'The long watch'], ['content', `${draftText}, and more`], ['intent', 'publish'], ['baseVersion', String(before.version_number)]]),
  });
  assert.strictEqual(published.status, 302);
  assert.strictEqual(latest().version_number, before.version_number + 1);
  assert.strictEqual(models.getDraft(chapterId, models.getUserByUsername('ana').id), null, 'the draft is gone once published');
});

test('the front page shows what the group has been doing, and welcomes a newcomer until they are in', async () => {
  const home = await (await luis.request('/')).text();
  assert.match(home, /All activity/, 'the front page carries a short strip, with a way to the rest');
  assert.strictEqual((home.match(/class="activity-item/g) || []).length, 3, 'and only the last three');
  const page = await (await luis.request('/activity')).text();
  assert.match(page, /Lately in the group/);
  assert.match(page, /left a note on/);
  // Luis has read and noted, but not written anything of his own.
  assert.match(home, /Welcome to the group/);
  await luis.request('/welcome/dismiss', { method: 'POST', ...form([]) });
  assert.doesNotMatch(await (await luis.request('/')).text(), /Welcome to the group/);
});

test('a private bible stays out of the activity of people who cannot open it', () => {
  const luisRow = models.getUserByUsername('luis');
  const story = models.listStories()[0];
  models.recordEvent({ userId: models.getUserByUsername('ana').id, kind: 'bible-entry-added', subject: 'The secret twin', storyId: story.id });
  models.setBiblePrivate(story.id, true);
  assert.ok(!models.groupActivity(luisRow).some((a) => a.subject === 'The secret twin'));
  assert.ok(models.groupActivity(models.getUserByUsername('ana')).some((a) => a.subject === 'The secret twin'));
  models.setBiblePrivate(story.id, false);
});

test('a story has a cover only if its author uploads one, and it can be cropped and taken off', async () => {
  const story = models.listStories()[0];
  const home = async () => (await luis.request('/')).text();
  assert.doesNotMatch(await home(), /class="story-cover"/, 'no cover, no picture and no stand-in');

  // The smallest real PNG there is: one transparent pixel.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const upload = (client, body) => client.request(`/stories/${story.id}/cover`, {
    method: 'POST',
    ...multipartWithFile([], { name: 'cover', filename: 'cover.png', body }),
  });
  assert.strictEqual((await upload(luis, png)).status, 403, 'only the author');
  assert.strictEqual((await upload(ana, Buffer.from('<svg></svg>'))).status, 400, 'only real pictures');
  assert.strictEqual((await upload(ana, png)).status, 302);

  const withCover = models.getStoryById(story.id);
  assert.ok(withCover.cover_filename);
  assert.match(await home(), new RegExp(`/stories/${story.id}/cover\\?v=`));
  const img = await luis.request(`/stories/${story.id}/cover?v=${withCover.cover_filename}`);
  assert.strictEqual(img.status, 200);
  assert.strictEqual(img.headers.get('content-type'), 'image/png');

  await ana.request(`/stories/${story.id}/cover/focus`, { method: 'POST', ...form([['focusX', '20'], ['focusY', '140']]) });
  const cropped = models.getStoryById(story.id);
  assert.deepStrictEqual([cropped.cover_focus_x, cropped.cover_focus_y], [20, 100], 'kept inside the picture');

  await ana.request(`/stories/${story.id}/cover/remove`, { method: 'POST', ...form([]) });
  assert.strictEqual(models.getStoryById(story.id).cover_filename, null);
  assert.doesNotMatch(await home(), /class="story-cover"/);
});

test('the site has one look, and nobody is painted in an old one', async () => {
  const html = await (await luis.request('/')).text();
  assert.match(html, /<html lang="en">/);
  assert.ok(!html.includes('looks.css'));
  assert.strictEqual((await luis.request('/account/look', { method: 'POST', ...form([['look', 'swarm']]) })).status, 404);
});

test('the writing desk: scene notes and snapshots belong to the chapter author alone', async () => {
  const note = (client, body) => client.request(`/chapters/${chapterId}/scene-notes`, { method: 'POST', ...form([['position', '2'], ['body', body]]) });
  assert.strictEqual((await note(luis, 'mine now')).status, 403);
  assert.strictEqual((await note(ana, 'Where she lies to him.')).status, 200);
  assert.deepStrictEqual(models.listSceneNotes(chapterId).map((n) => [n.position, n.body]), [[2, 'Where she lies to him.']]);
  await note(ana, '   ');
  assert.strictEqual(models.listSceneNotes(chapterId).length, 0, 'an emptied note is gone');

  const snap = (client, name) => client.request(`/chapters/${chapterId}/snapshots`, {
    method: 'POST', ...form([['name', name], ['content', 'An older draft, word for word different.']]),
  });
  assert.strictEqual((await snap(luis, 'nope')).status, 403);
  const made = await (await snap(ana, 'Before the big cut')).json();
  assert.strictEqual(made.snapshots[0].name, 'Before the big cut');
  const id = made.snapshots[0].id;
  assert.strictEqual((await luis.request(`/snapshots/${id}.json`)).status, 403);
  const back = await (await ana.request(`/snapshots/${id}.json`)).json();
  assert.strictEqual(back.content, 'An older draft, word for word different.');
  const compare = await ana.request(`/snapshots/${id}/compare`);
  assert.strictEqual(compare.status, 200);
  assert.match(await compare.text(), /Before the big cut/);
  const gone = await (await ana.request(`/snapshots/${id}/delete`, { method: 'POST', ...form([]) })).json();
  assert.strictEqual(gone.snapshots.length, 0);

  const editor = await (await ana.request(`/chapters/${chapterId}/edit`)).text();
  assert.match(editor, /id="desk-data"/);
  assert.match(editor, /writing-desk\.js/);
});

test('the visual editor gets the text without glossary links it never wrote', async () => {
  const render = async (plain) => (await (await ana.request('/markdown/preview', {
    method: 'POST', ...form([['text', 'Plain *text*.'], ...(plain ? [['plain', '1']] : [])]),
  })).json()).html;
  assert.strictEqual(await render(true), '<p>Plain <em>text</em>.</p>');
});

test('the story page opens on a title page with a way to start reading', async () => {
  const story = models.listStories()[0];
  const page = await (await luis.request(`/stories/${story.id}`)).text();
  assert.match(page, /class="title-page/);
  assert.match(page, /Continue with chapter|Start reading|Read it again/);
  assert.match(page, /class="toc-heading">Contents/);
});
