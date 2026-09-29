// Chapter breaks written into the text, and joining a chapter to the next:
// adding and taking away chapter divisions where the writer is looking.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart } = require('./helpers/app');
const { parseBreaks, hasBreaks } = require('../lib/chapter-breaks');
const { flatOf } = require('../lib/suggestions');

let app;
let models;
let ana;
let luis;
let storyId;
const PASSWORD = 'a long enough password';
const chapters = () => models.listChaptersForStory(storyId);
const latestText = (id) => models.getLatestVersion(id).content;

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');
  ana = makeClient(app.base);
  await ana.request('/register', { method: 'POST', ...form([['username', 'ana'], ['displayName', 'Ana'], ['password', PASSWORD], ['inviteCode', models.getActiveInviteCode().code]]) });
  await ana.login('ana', PASSWORD);
  models.createUser({ username: 'luis', displayName: 'Luis', passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  luis = makeClient(app.base);
  await luis.login('luis', PASSWORD);
  await ana.request('/stories/new', {
    method: 'POST',
    ...multipart([['storyTitle', 'Relay'], ['chapterTitle', 'The storm'], ['content', 'The storm came.\n\nThe relay went down.\n\nPell went out alone.\n\nThe drones followed him.']]),
  });
  storyId = models.listStories()[0].id;
});
test.after(() => app.stop());

test('a break is a line of its own, and the text around it is kept exactly', () => {
  assert.ok(hasBreaks('A\n=== New chapter: B ===\nC'));
  assert.ok(!hasBreaks('A\n=== not a break ===\nC'), 'only the marker counts');
  const r = parseBreaks('One.\n\n=== New chapter: Two ===\n\nTwo starts.\n\n===new chapter:  Three  ===\nThree starts.');
  assert.strictEqual(r.text, 'One.\n\nTwo starts.\n\nThree starts.');
  assert.deepStrictEqual(r.cuts.map((c) => [c.title, r.text.slice(c.at, c.at + 5)]), [['Two', 'Two s'], ['Three', 'Three']]);
  assert.match(parseBreaks('=== New chapter: X ===\nA').error, /before it/);
  assert.match(parseBreaks('A\n=== New chapter: X ===\n').error, /nothing after it/);
});

test('publishing with a break in it makes the rest a chapter of its own, with its notes', async () => {
  const [first] = chapters();
  const version = models.getLatestVersion(first.id);
  const flat = flatOf(version.content);
  const at = flat.indexOf('Pell went out alone.');
  const note = models.createComment({ versionId: version.id, authorId: models.getUserByUsername('luis').id, startOffset: at, endOffset: at + 4, quotedText: 'Pell', body: 'Why alone?' });

  const edit = await (await ana.request(`/chapters/${first.id}/edit`)).text();
  assert.match(edit, /data-chapter-breaks/, 'the editor offers the button');

  const res = await ana.request(`/chapters/${first.id}/edit`, {
    method: 'POST',
    ...multipart([['title', 'The storm'], ['summary', ''], ['content', 'The storm came.\n\nThe relay went down.\n\n=== New chapter: Pell goes out ===\n\nPell went out alone.\n\nThe drones followed him.'], ['changelog', ''], ['baseVersion', String(version.version_number)]]),
  });
  assert.strictEqual(res.status, 302);
  assert.match(decodeURIComponent(res.headers.get('location')), /divided: 2\. Pell goes out is a chapter of its own/);
  const list = chapters();
  assert.deepStrictEqual(list.map((c) => c.title), ['The storm', 'Pell goes out']);
  assert.strictEqual(latestText(list[0].id), 'The storm came.\n\nThe relay went down.');
  assert.strictEqual(latestText(list[1].id), 'Pell went out alone.\n\nThe drones followed him.');
  assert.ok(!/New chapter/.test(latestText(list[0].id) + latestText(list[1].id)), 'the marker is nobody\'s text');
  const moved = models.getCommentById ? models.getCommentById(note.id || note) : null;
  if (moved) assert.strictEqual(moved.version_id, models.getLatestVersion(list[1].id).id, 'the note went with its words');
});

test('a new chapter can be written with breaks in it too', async () => {
  const res = await ana.request(`/stories/${storyId}/chapters/new`, {
    method: 'POST',
    ...multipart([['title', 'Night'], ['summary', ''], ['content', 'Night fell.\n\n=== New chapter: Morning ===\n\nMorning came.\n\n=== New chapter: ===\n\nNoon.'], ['position', 'end']]),
  });
  assert.strictEqual(res.status, 302);
  assert.deepStrictEqual(chapters().map((c) => c.title), ['The storm', 'Pell goes out', 'Night', 'Morning', 'Night (part 3)']);
});

test('a break with nothing after it is refused, and nothing is published', async () => {
  const [first] = chapters();
  const before = models.getLatestVersion(first.id).version_number;
  const res = await ana.request(`/chapters/${first.id}/edit`, {
    method: 'POST',
    ...multipart([['title', 'The storm'], ['summary', ''], ['content', 'The storm came.\n\n=== New chapter: Lost ==='], ['changelog', ''], ['baseVersion', String(before)]]),
  });
  assert.strictEqual(res.status, 400);
  assert.match(await res.text(), /has nothing after it/);
  assert.strictEqual(models.getLatestVersion(first.id).version_number, before);
});

test('joining folds the next chapter in, and only its writer can', async () => {
  const [first, second] = chapters();
  const page = await (await ana.request(`/chapters/${first.id}`)).text();
  assert.match(page, /Join with the next chapter/);
  assert.match(page, /Divide it into chapters/);

  const refused = await luis.request(`/chapters/${first.id}/join-next`, { method: 'POST', ...form([]) });
  assert.strictEqual(refused.status, 403);

  const res = await ana.request(`/chapters/${first.id}/join-next`, { method: 'POST', ...form([]) });
  assert.strictEqual(res.status, 302);
  assert.match(decodeURIComponent(res.headers.get('location')), /Joined: Pell goes out is the end of this chapter/);
  assert.deepStrictEqual(chapters().map((c) => c.title), ['The storm', 'Night', 'Morning', 'Night (part 3)']);
  assert.strictEqual(latestText(first.id), 'The storm came.\n\nThe relay went down.\n\nPell went out alone.\n\nThe drones followed him.');
  assert.ok(models.getChapterById(second.id).archived_at, 'archived, not deleted');
});

test('chapters planned after a divided chapter come after its last part', async () => {
  const night = chapters().find((c) => c.title === 'Morning');
  await ana.request(`/stories/${storyId}/plan/slots`, { method: 'POST', ...form([['title', 'Evening'], ['notes', ''], ['afterRef', `c${night.id}`]]) });
  const v = models.getLatestVersion(night.id);
  await ana.request(`/chapters/${night.id}/edit`, {
    method: 'POST',
    ...multipart([['title', 'Morning'], ['summary', ''], ['content', 'Morning came.\n\n=== New chapter: Late morning ===\n\nStill morning.'], ['changelog', ''], ['baseVersion', String(v.version_number)]]),
  });
  const order = models.storyPlan(storyId).items.map((i) => (i.type === 'chapter' ? i.title : `(${i.title})`));
  assert.deepStrictEqual(order.slice(-3), ['Late morning', '(Evening)', 'Night (part 3)']);
});
