'use strict';

// The card beside a chapter: the name you clicked, without leaving the
// page you were reading.
//
// Two halves, tested where each of them lives. The server half is a real
// request for the fragment the card shows. The browser half -- that a
// click fills the card instead of following the link, and that Escape
// gives the reader back the word they were on -- cannot run here, so what
// is pinned is the shape of the script that makes it true, and the rule
// the whole thing rests on: the link is never touched.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startApp, makeClient } = require('./helpers/app');

// Required inside the tests, not up here: lib/wiki pulls in the models,
// the models pull in db.js, and db.js decides which database it is the
// moment it loads. Above startApp that decision is "the real one" -- see
// the guard at the top of db.js, which now refuses rather than obeys.
/** @type {(html: string) => string} */
let leadOf;

const ME = { username: 'cardreader', displayName: 'Card Reader', password: 'correct horse battery' };

let app; let client; let ids;

test.before(async () => {
  app = await startApp();
  const models = app.models;
  const auth = require('../auth');
  const me = models.createUser({
    username: ME.username, displayName: ME.displayName,
    passwordHash: auth.hashPassword(ME.password), isAdmin: true,
  });
  const { story, chapter } = models.createStoryWithFirstChapter({
    title: 'Beside', description: 'x', authorId: me.id,
    chapterTitle: 'The long watch', chapterSummary: '',
    content: 'Kessler came up. The Tampaad reach was cold.',
  });
  const kessler = models.createStoryEntity({
    storyId: story.id, kind: 'person', name: 'Kessler', summary: 'Four hundred days.',
    description: 'A long watch, and a longer list.', createdBy: me.id,
  });
  models.replaceWikiPages([{
    title: 'Tampaad reach',
    summary: 'A reach out past the anchorage.',
    contentHtml: '<h2>Tampaad reach</h2><p>Cold, and a long way from anywhere.</p>'
      + '<h2>History</h2><p>Nobody has been there twice.</p>',
    categories: ['Places'],
  }]);
  client = makeClient(app.base);
  await client.login(ME.username, ME.password);
  ids = { story, chapter, kessler };
  ({ leadOf } = require('../lib/wiki'));
});

test.after(() => app.stop());

test('a glossary page comes back as a card', async () => {
  const res = await client.request('/glossary/Tampaad%20reach/beside');
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.match(html, /<h3>Tampaad reach<\/h3>/, 'the name is the heading, for the link onwards');
  assert.match(html, /A reach out past the anchorage/, 'the summary');
  assert.match(html, /Cold, and a long way from anywhere/, 'and the opening of the page');
  assert.ok(!/Nobody has been there twice/.test(html),
    'but not the whole page: the card is a glance, and the link is right there');
  assert.ok(!/<nav|topbar/.test(html), 'a fragment, not a page in a box');
  assert.strictEqual(decodeURIComponent(res.headers.get('x-beside-title') || ''), 'Tampaad reach');
});

test('a name nobody has heard of is a 404, not an empty card', async () => {
  const res = await client.request('/glossary/Nobody%20At%20All/beside');
  assert.strictEqual(res.status, 404);
});

test('a bible entry comes back in the same shape', async () => {
  const res = await client.request(`/bible/${ids.kessler.id}/beside`);
  assert.strictEqual(res.status, 200);
  const html = await res.text();
  assert.match(html, /<h3>Kessler<\/h3>/);
  assert.match(html, /Four hundred days/);
  assert.match(html, /A long watch/);
});

test('the chapter page carries the frame and the script', async () => {
  const html = await (await client.request(`/chapters/${ids.chapter.id}`)).text();
  assert.match(html, /data-name-card\b/, 'the empty frame is in the markup');
  assert.match(html, /name-card\.js/, 'and the page asks for the script that fills it');
  assert.match(html, /hidden/, 'the frame starts closed');
  // The point of the whole thing: the name in the text is a link to the
  // page, and stays one. Everything else is an improvement on top of it.
  assert.match(html, new RegExp(`<a class="wiki-link[^"]*" href="/bible/${ids.kessler.id}"`));
});

test('the lead stops where the page proper begins', () => {
  const html = '<h2>Title</h2><p>One.</p><p>Two.</p><h2>History</h2><p>Three.</p>';
  const lead = leadOf(html);
  assert.match(lead, /One\./);
  assert.match(lead, /Two\./);
  assert.ok(!/Three\./.test(lead), 'the next heading ends it');
  assert.ok(!/<h2/.test(lead), "and the page's own title is not repeated");
  assert.strictEqual(leadOf(''), '');
  assert.strictEqual(leadOf(null), '');
});

test('a long lead is cut, rather than becoming the page again', () => {
  const long = '<h2>T</h2>' + Array.from({ length: 40 }, (_, i) => `<p>${'word '.repeat(60)}${i}</p>`).join('');
  const lead = leadOf(long);
  assert.ok(lead.length < long.length / 4, `${lead.length} against ${long.length}`);
});

const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'name-card.js'), 'utf8');

test('the link is only ever intercepted, never replaced', () => {
  // With this file missing, JavaScript off, a phone, a modifier key held,
  // or a fetch that fails, clicking a name goes to the entry. That is not
  // a fallback bolted on afterwards -- it is what the markup does, and
  // this script is the only thing that ever stops it.
  assert.match(script, /metaKey \|\| event\.ctrlKey/, 'open-in-a-new-tab still opens a new tab');
  assert.match(script, /if \(!twoColumns\(\)\) return;/, 'one column follows the link');
  const preventIndex = script.indexOf('event.preventDefault()');
  const guards = script.slice(0, preventIndex);
  assert.match(guards, /fragmentUrl\(link\.getAttribute\('href'\)/,
    'a link with no card behind it is left alone');
  assert.match(script, /catch[\s\S]{0,300}window\.location\.href = href/,
    'and a failed lookup becomes the navigation it was going to be');
});

test('the reader gets their place back', () => {
  assert.match(script, /opener = link/, 'the card remembers the word that opened it');
  assert.match(script, /opener\.focus\(\)/, 'and puts the reader back on it');
  assert.match(script, /event\.key !== 'Escape'/, 'Escape closes it');
  assert.match(script, /aria-live/, 'and it says what happened, for somebody not looking');
});
