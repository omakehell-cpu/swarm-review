// The front page's shelves: being written, complete, set aside; a search
// that reaches every story; and pages.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { shelve, shelfOf, PAGE_SIZE } = require('../lib/story-shelves');

const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
const story = (id, over = {}) => ({
  id, title: `Story ${id}`, author_name: 'Ana', description: '', series: '', status: 'ongoing',
  created_at: now, last_chapter_at: now, source_url: null, ...over,
});

test('a story sits on the shelf its state says', () => {
  assert.strictEqual(shelfOf(story(1)), 'writing');
  assert.strictEqual(shelfOf(story(2, { status: 'complete' })), 'complete');
  assert.strictEqual(shelfOf(story(3, { status: 'dropped' })), 'dropped');
  assert.strictEqual(shelfOf(story(4, { last_chapter_at: '2020-01-01 00:00:00', created_at: '2020-01-01 00:00:00' })), 'writing', 'a quiet story is still being written');
});

test('the list opens on what is being written, and counts every shelf', () => {
  const all = [story(1), story(2, { status: 'complete' }), story(3, { status: 'complete' }), story(4, { status: 'dropped' })];
  const out = shelve(all, {});
  assert.strictEqual(out.shelf, 'writing');
  assert.deepStrictEqual(out.stories.map((s) => s.id), [1]);
  assert.deepStrictEqual(out.counts, { writing: 1, complete: 2, dropped: 1, all: 4 });
  assert.deepStrictEqual(shelve(all, { shelf: 'complete' }).stories.map((s) => s.id), [2, 3]);
});

test('a search reaches title, author, series and tags, without minding accents', () => {
  const all = [
    story(1, { title: 'Pickup Number Eighteen', series: 'The Swarm Cycle', author_name: 'Thinking Horndog', status: 'complete' }),
    story(2, { title: 'La noche de Émile' }),
    story(3, { title: 'Salt' }),
  ];
  const tagsByStory = new Map([[3, [{ name: 'Space opera' }]]]);
  assert.deepStrictEqual(shelve(all, { shelf: 'all', q: 'swarm cycle' }).stories.map((s) => s.id), [1]);
  assert.deepStrictEqual(shelve(all, { shelf: 'all', q: 'horndog' }).stories.map((s) => s.id), [1]);
  assert.deepStrictEqual(shelve(all, { q: 'emile' }).stories.map((s) => s.id), [2]);
  assert.deepStrictEqual(shelve(all, { q: 'space', tagsByStory }).stories.map((s) => s.id), [3]);
  const nothingHere = shelve(all, { q: 'pickup' });
  assert.strictEqual(nothingHere.total, 0, 'not being written');
  assert.strictEqual(nothingHere.counts.complete, 1, 'but the complete shelf has it');
});

test('where it was written, a series, and pages', () => {
  const many = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => story(i + 1, {
    source_url: i % 2 ? 'https://storiesonline.net/s/1' : null, series: i < 3 ? 'The Swarm Cycle' : '',
  }));
  assert.strictEqual(shelve(many, { origin: 'imported' }).total, Math.floor((PAGE_SIZE + 5) / 2));
  assert.strictEqual(shelve(many, { series: 'the swarm cycle' }).total, 3);
  assert.deepStrictEqual(shelve(many, {}).seriesList, [{ name: 'The Swarm Cycle', n: 3 }]);
  const two = shelve(many, { page: 2 });
  assert.strictEqual(two.pages, 2);
  assert.strictEqual(two.stories.length, 5);
  assert.strictEqual(shelve(many, { page: 99 }).page, 2, 'past the end is the last page');
});

test('the front page: shelves as links, a search form, and a list view', async () => {
  const { startApp, makeClient, form, multipart } = require('./helpers/app');
  const app = await startApp();
  try {
    const models = app.models;
    const ana = makeClient(app.base);
    await ana.request('/register', { method: 'POST', ...form([['username', 'ana'], ['displayName', 'Ana'], ['password', 'a long enough password'], ['inviteCode', models.getActiveInviteCode().code]]) });
    await ana.login('ana', 'a long enough password');
    for (const title of ['Still going', 'All done']) {
      await ana.request('/stories/new', { method: 'POST', ...multipart([['storyTitle', title], ['storyDescription', ''], ['chapterTitle', 'One'], ['chapterSummary', ''], ['content', 'Words.']]) });
    }
    const done = models.listStories().find((s) => s.title === 'All done');
    models.updateStoryDetails(done.id, { title: done.title, description: '', synopsis: '', status: 'complete' });

    const front = await (await ana.request('/')).text();
    assert.match(front, /aria-label="Which stories"/);
    const rowOf = (id) => `class="row-link" href="/stories/${id}`;
    const going = models.listStories().find((s) => s.title === 'Still going');
    assert.ok(front.includes(rowOf(going.id)));
    assert.ok(!front.includes(rowOf(done.id)), 'a finished story is on its own shelf');
    assert.match(front, /href="\/\?shelf=complete#library"[^>]*>Complete<span class="tag-chip-count">1</);
    assert.match(front, /<form method="get" action="\/" class="story-search" role="search">/);

    const complete = await (await ana.request('/?shelf=complete')).text();
    assert.ok(complete.includes(rowOf(done.id)));
    // Nothing being written matches, so the search shows every shelf.
    const found = await (await ana.request('/?q=done')).text();
    assert.ok(found.includes(rowOf(done.id)), 'found on the complete shelf, shown anyway');
    assert.match(found, /All, matching/);
    const stayed = await (await ana.request('/?shelf=writing&q=done')).text();
    assert.match(stayed, /On the other shelves: <a href="\/\?shelf=complete&amp;q=done#library">1 complete<\/a>/);
    const list = await (await ana.request('/?shelf=all&view=list')).text();
    assert.match(list, /class="story-lines"/);
  } finally {
    await app.stop();
  }
});
