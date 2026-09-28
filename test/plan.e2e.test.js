// The plan of a story, against the real server: chapters planned before
// they are written, arcs nested inside arcs, and the old arc_title on a
// chapter kept in step with all of it.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart } = require('./helpers/app');

let app;
let models;
let ana;
let luis;
let storyId;
const PASSWORD = 'a long enough password';

const chapters = () => models.listChaptersForStory(storyId);
const plan = () => models.storyPlan(storyId);
const order = () => plan().items.map((i) => (i.type === 'chapter' ? i.title : `(${i.title})`));
const slotId = (title) => plan().items.find((i) => i.type === 'slot' && i.title === title).id;
const key = (title) => plan().items.find((i) => i.title === title).key;
const newChapter = (title, fields = []) => ana.request(`/stories/${storyId}/chapters/new`, {
  method: 'POST', ...multipart([['title', title], ['summary', ''], ['content', `${title}, written.`], ...fields]),
});

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
  await ana.request('/stories/new', { method: 'POST', ...multipart([['storyTitle', 'Siege'], ['chapterTitle', 'Arrival'], ['content', 'They arrived.']]) });
  storyId = models.listStories()[0].id;
  await newChapter('The walls');
});
test.after(() => app.stop());

test('the plan is for the people who write the story', async () => {
  assert.strictEqual((await luis.request(`/stories/${storyId}/plan`)).status, 403);
  const refused = await luis.request(`/stories/${storyId}/plan/slots`, { method: 'POST', ...form([['title', 'Sneaky'], ['notes', ''], ['afterRef', '']]) });
  assert.strictEqual(refused.status, 403);
  const story = await (await ana.request(`/stories/${storyId}`)).text();
  assert.match(story, new RegExp(`href="/stories/${storyId}/plan"`), 'the writer finds it on the story page');
  const readerStory = await (await luis.request(`/stories/${storyId}`)).text();
  assert.ok(!readerStory.includes(`/stories/${storyId}/plan`), 'a reader does not');
});

test('chapters can be planned anywhere in the running order, and moved', async () => {
  const [arrival, walls] = chapters();
  await ana.request(`/stories/${storyId}/plan/slots`, { method: 'POST', ...form([['title', 'The breach'], ['notes', 'The east wall goes.\n\nKessler is on it.'], ['afterRef', `c${walls.id}`]]) });
  await ana.request(`/stories/${storyId}/plan/slots`, { method: 'POST', ...form([['title', 'Aftermath'], ['notes', ''], ['afterRef', `p${slotId('The breach')}`]]) });
  await ana.request(`/stories/${storyId}/plan/slots`, { method: 'POST', ...form([['title', 'Before it all'], ['notes', ''], ['afterRef', '']]) });
  await ana.request(`/stories/${storyId}/plan/slots`, { method: 'POST', ...form([['title', 'The council'], ['notes', ''], ['afterRef', `c${arrival.id}`]]) });
  assert.deepStrictEqual(order(), ['(Before it all)', 'Arrival', '(The council)', 'The walls', '(The breach)', '(Aftermath)']);

  // Past another planned chapter it swaps; past a written one it moves across it.
  await ana.request(`/plan/slots/${slotId('Aftermath')}/move`, { method: 'POST', ...form([['direction', 'up']]) });
  assert.deepStrictEqual(order().slice(-2), ['(Aftermath)', '(The breach)']);
  await ana.request(`/plan/slots/${slotId('The council')}/move`, { method: 'POST', ...form([['direction', 'down']]) });
  assert.deepStrictEqual(order(), ['(Before it all)', 'Arrival', 'The walls', '(The council)', '(Aftermath)', '(The breach)']);
  await ana.request(`/plan/slots/${slotId('The council')}/move`, { method: 'POST', ...form([['direction', 'up']]) });
  await ana.request(`/plan/slots/${slotId('Aftermath')}/move`, { method: 'POST', ...form([['direction', 'down']]) });
  assert.deepStrictEqual(order(), ['(Before it all)', 'Arrival', '(The council)', 'The walls', '(The breach)', '(Aftermath)']);

  const page = await (await ana.request(`/stories/${storyId}/plan`)).text();
  assert.match(page, /The east wall goes\./);
  assert.match(page, /Write it/);
  // Nobody reading the story sees a planned chapter anywhere.
  assert.ok(!(await (await luis.request(`/stories/${storyId}`)).text()).includes('The breach'));
});

test('arcs nest, answer their questions, and the top level is still the chapter\'s arc', async () => {
  const [arrival] = chapters();
  const res = await ana.request(`/stories/${storyId}/plan/arcs`, { method: 'POST', ...form([
    ['title', 'Book One'], ['parentId', ''], ['startRef', `c${arrival.id}`], ['endRef', ''],
    ['summary', 'The city is besieged.'], ['change_text', 'Kessler stops believing the walls will hold.'], ['purpose', ''],
  ]) });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(models.getChapterById(arrival.id).arc_title, 'Book One', 'the compiler and the chapter form still see it');
  const bookOne = plan().arcs.find((a) => a.title === 'Book One');

  await ana.request(`/stories/${storyId}/plan/arcs`, { method: 'POST', ...form([
    ['title', 'The breach'], ['parentId', String(bookOne.id)], ['startRef', key('The walls')], ['endRef', key('The breach')],
    ['summary', ''], ['change_text', ''], ['purpose', 'It is where the siege turns.'],
  ]) });
  const tree = plan().arcs;
  assert.strictEqual(tree.length, 1);
  assert.deepStrictEqual(tree[0].children.map((a) => a.title), ['The breach']);
  const inner = tree[0].children[0];
  assert.strictEqual(inner.label, 'Smaller arc');
  assert.strictEqual(inner.chapters, 1);
  assert.strictEqual(inner.planned, 1, 'it runs over a chapter nobody has written yet');
  assert.deepStrictEqual(inner.problems, []);

  const page = await (await ana.request(`/stories/${storyId}/plan`)).text();
  assert.match(page, /Kessler stops believing the walls will hold\./);
  assert.match(page, /Not said yet: why it matters to the whole story/, 'an unanswered question is asked, not left blank');

  // A top-level arc cannot start where another already does.
  const clash = await ana.request(`/stories/${storyId}/plan/arcs`, { method: 'POST', ...form([
    ['title', 'Also Book One'], ['parentId', ''], ['startRef', `c${arrival.id}`], ['endRef', ''],
  ]) });
  assert.strictEqual(clash.status, 400);
});

test('renaming or clearing the arc in the chapter form changes the plan too', async () => {
  const [arrival] = chapters();
  const { db } = require('../models/shared');
  db.prepare("UPDATE chapters SET arc_title = 'Book I' WHERE id = ?").run(arrival.id);
  assert.strictEqual(plan().arcs[0].title, 'Book I');
  assert.strictEqual(plan().arcs[0].summary, 'The city is besieged.', 'renamed, not replaced: what it said is kept');
});

test('writing a planned chapter puts it where it was planned, and the arcs follow it', async () => {
  const breach = slotId('The breach');
  const form1 = await (await ana.request(`/stories/${storyId}/chapters/new?plan=${breach}`)).text();
  assert.match(form1, /name="planSlot" value="\d+"/);
  assert.match(form1, /value="The breach"/, 'the working title is the title');
  assert.match(form1, /The east wall goes\./, 'and the notes are the summary');

  await newChapter('The breach', [['planSlot', String(breach)], ['position', 'end']]);
  assert.deepStrictEqual(order(), ['(Before it all)', 'Arrival', '(The council)', 'The walls', 'The breach', '(Aftermath)']);
  const inner = plan().arcs[0].children[0];
  assert.strictEqual(inner.chapters, 2);
  assert.strictEqual(inner.planned, 0);
  assert.ok(!models.getPlanSlot(breach), 'the planned chapter is a chapter now');

  // Written out of order: the council, which goes between two written chapters.
  await newChapter('The council', [['planSlot', String(slotId('The council'))], ['position', models.planSlotPosition(slotId('The council'))]]);
  assert.deepStrictEqual(chapters().map((c) => c.title), ['Arrival', 'The council', 'The walls', 'The breach']);
  const chapterPage = await (await ana.request(`/chapters/${chapters()[3].id}`)).text();
  assert.match(chapterPage, /In the plan<\/a>: Book I &rsaquo; The breach/);
});

test('an arc and a planned chapter can be taken out, and nothing written goes with them', async () => {
  const bookOne = plan().arcs[0];
  await ana.request(`/plan/slots/${slotId('Aftermath')}/delete`, { method: 'POST', ...form([]) });
  await ana.request(`/plan/arcs/${bookOne.id}/delete`, { method: 'POST', ...form([]) });
  const now = plan();
  assert.deepStrictEqual(now.arcs.map((a) => a.title), ['The breach'], 'the smaller arc moved up a level');
  assert.strictEqual(models.getChapterById(chapters()[0].id).arc_title, '', 'and the chapter no longer opens an arc');
  assert.strictEqual(chapters().length, 4);
  // With nothing before it to go into, The breach is top-level now, so it
  // is the heading of the chapter it starts on -- and it survives the next
  // look at the plan, which is where a heading with no chapter used to go.
  assert.strictEqual(models.getChapterById(chapters()[2].id).arc_title, 'The breach');
  assert.deepStrictEqual(plan().arcs.map((a) => a.title), ['The breach']);
  assert.strictEqual(plan().arcs[0].purpose, 'It is where the siege turns.');
});

test('a smaller arc in a deleted top-level arc goes into the arc before it', () => {
  const [arrival, council] = chapters();
  const one = models.addArc({ storyId, title: 'Part one', startRef: `c${arrival.id}` }).id;
  const two = models.addArc({ storyId, title: 'Part two', startRef: `c${council.id}` }).id;
  const inner = models.addArc({ storyId, title: 'A quiet stretch', parentId: two, startRef: `c${council.id}` }).id;
  assert.ok(one && two && inner, 'all three were made');
  models.deleteArc(two);
  assert.strictEqual(models.getArc(inner).parent_id, one);
  assert.strictEqual(models.getChapterById(council.id).arc_title, '', 'it is inside Part one, not a heading');
  assert.deepStrictEqual(plan().arcs.find((a) => a.id === one).children.map((a) => a.title), ['A quiet stretch']);
});
