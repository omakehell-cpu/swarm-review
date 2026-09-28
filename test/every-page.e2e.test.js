'use strict';

// Every page in the app, opened once.
//
// Not a test of what any of them say -- the other files do that. This one
// asks the only question they cannot: does it answer at all. A route that
// calls a function by a name the model does not export looks perfectly
// fine in every unit test around it and throws the moment somebody opens
// the page.
//
// That is not hypothetical. This file was written after a smoke run found
// /bible/:id/beside doing exactly that: a handler written and tested for
// the path where it refuses, never once run down the path where it works.
const test = require('node:test');
const assert = require('node:assert');
const { startApp, makeClient, form } = require('./helpers/app');

const ME = { username: 'everypage', displayName: 'Every Page', password: 'correct horse battery' };

let app; let models; let client; let pages;

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');
  const me = models.createUser({
    username: ME.username, displayName: ME.displayName,
    passwordHash: auth.hashPassword(ME.password), isAdmin: true,
  });

  // Enough of a world that every page has something to show. A page that
  // only answers when it is empty is half-tested.
  const { story, chapter } = models.createStoryWithFirstChapter({
    title: 'Every Page', description: 'One of everything.', authorId: me.id,
    chapterTitle: 'The first', chapterSummary: 'Kessler cannot sleep.',
    content: 'Kessler came up through the service spine. Prado had left the hatch open.',
  });
  const second = models.createChapter({
    storyId: story.id, title: 'The second', authorId: me.id, content: 'The drop came down.',
  });
  models.editChapter({
    chapterId: second.id, title: 'The second', summary: 'A drop.',
    content: 'The drop came down slowly.', changelog: 'a word',
    pov: 'Kessler', strand: 'The anchorage', storyWhen: 'Day 2', storyDay: '2',
  });
  const one = models.createStoryEntity({
    storyId: story.id, kind: 'person', name: 'Kessler', summary: 'Four hundred days.',
    description: 'A long watch.', createdBy: me.id,
  });
  const two = models.createStoryEntity({
    storyId: story.id, kind: 'place', name: 'Kestrel Anchorage', summary: 'A reach.', createdBy: me.id,
  });
  // A relation, because that is the line that was broken.
  models.setStoryEntityLink({ storyId: story.id, fromId: one.id, toId: two.id, label: 'lives on' });
  models.replaceWikiPages([
    { title: 'Tampaad reach', summary: 'A reach.', contentHtml: '<p>Cold.</p>', categories: ['Places'] },
  ]);
  const version = models.getLatestVersion(chapter.id);
  models.createComment({
    versionId: version.id, authorId: me.id, startOffset: 0, endOffset: 7,
    quotedText: 'Kessler', body: 'A note.',
  });

  client = makeClient(app.base);
  await client.login(ME.username, ME.password);

  const wiki = models.listWikiPages()[0];
  pages = [
    '/', '/tags', '/glossary', '/glossary?view=all', '/glossary?kind=person',
    `/glossary/${encodeURIComponent(wiki.title)}`,
    `/glossary/${encodeURIComponent(wiki.title)}/beside`,
    '/help', '/help/changelog', '/help/reading-and-reviewing', '/help/writing-a-chapter',
    '/help/targets-and-analysis', '/help/story-notes', '/help/your-first-characters', '/help/glossary',
    '/help/tags-and-search', '/help/your-account', '/help/finding-your-way',
    '/help/writing-checks', '/help/screen-readers', '/help/keys', '/help/questions',
    '/account', '/admin', '/search?q=kessler', '/search?q=%22service+spine%22',
    '/stories/new', `/users/${ME.username}`,
    `/stories/${story.id}`, `/stories/${story.id}/edit`, `/stories/${story.id}/outline`,
    `/stories/${story.id}/analysis`, `/stories/${story.id}/timeline`,
    `/stories/${story.id}/bible`, `/stories/${story.id}/bible/new`, `/stories/${story.id}/bible/fields`,
    `/stories/${story.id}/chapters/new`, `/stories/${story.id}/download.md`, `/stories/${story.id}/download.txt`,
    `/chapters/${chapter.id}`, `/chapters/${chapter.id}/edit`, `/chapters/${chapter.id}/beside`, `/chapters/${chapter.id}/split`,
    `/chapters/${second.id}/diff`,
    `/bible/${one.id}`, `/bible/${one.id}/edit`, `/bible/${one.id}/beside`,
    `/bible/${two.id}`, `/bible/${two.id}/beside`,
  ];
});

test.after(() => app.stop());

test('every page in the app answers', async () => {
  const bad = [];
  for (const url of pages) {
    const res = await client.request(url);
    if (res.status >= 400) bad.push(`${res.status} ${url}`);
  }
  assert.deepStrictEqual(bad, [], 'these did not');
});

test('and none of them comes back empty', async () => {
  const thin = [];
  for (const url of pages) {
    const res = await client.request(url);
    const body = await res.text();
    // A page that answers 200 with nothing in it is a page that broke
    // quietly. Downloads and fragments are legitimately small.
    const floor = /download|beside/.test(url) ? 20 : 500;
    if (body.length < floor) thin.push(`${url} (${body.length} bytes)`);
  }
  assert.deepStrictEqual(thin, [], 'these came back suspiciously empty');
});

test('the feed answers too, which no session ever sees', async () => {
  await client.request('/account/feed/new', { method: 'POST', ...form([]) });
  const token = models.getUserByUsername(ME.username).feed_token;
  const res = await fetch(`${app.base}/feed/${token}.atom`);
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /<feed xmlns/);
});
