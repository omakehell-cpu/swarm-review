// /authors: imported authors with their stories, and the two ways they
// become somebody here -- a claim an admin agrees to, or an admin giving
// the stories to a member directly.
'use strict';

process.env.NODE_ENV = 'test';

const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { startApp, makeClient, form } = require('./helpers/app');

const JSZip = require(require.resolve('jszip', { paths: [path.dirname(require.resolve('mammoth'))] }));
const PASSWORD = 'a long enough password';
const page = (title, body) => `<?xml version="1.0"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${body}</body></html>`;

async function solEpub({ id, title, author, slug }) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', `<package><metadata><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator></metadata>
    <manifest><item id="Info" href="info.xhtml" media-type="application/xhtml+xml" />
      <item id="c0" href="9000.xhtml" media-type="application/xhtml+xml" />
      <item id="Finish" href="finish.xhtml" media-type="application/xhtml+xml" /></manifest>
    <spine><itemref idref="Info" /><itemref idref="c0" /><itemref idref="Finish" /></spine></package>`);
  zip.file('OEBPS/info.xhtml', page(title, `<h1>${title}</h1><h2>by ${author}</h2><p><b>Status:</b> Complete</p>`));
  zip.file('OEBPS/9000.xhtml', page('Chapter 1', '<p>Once.</p>'));
  zip.file('OEBPS/finish.xhtml', page('Finish', `<p><a href="https://storiesonline.net/s/${id}/x">x</a></p>
    <p><a href="https://storiesonline.net/a/${slug}">${author}</a></p>`));
  return zip.generateAsync({ type: 'nodebuffer' });
}

let app; let models; let admin; let luis;
const importOne = async (opts) => {
  const { multipartWithFile } = require('./helpers/app');
  const res = await admin.request('/admin/import/batch', {
    method: 'POST', headers: { Accept: 'application/json' },
    ...multipartWithFile([['tags', 'skip']], { name: 'file', filename: `${opts.id}.epub`, body: await solEpub(opts) }),
  });
  return (await res.json()).results[0];
};

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');
  const invite = models.getActiveInviteCode();
  admin = makeClient(app.base);
  await admin.request('/register', { method: 'POST', ...form([['username', 'ana'], ['displayName', 'Ana'], ['password', PASSWORD], ['inviteCode', invite.code]]) });
  await admin.login('ana', PASSWORD);
  models.createUser({ username: 'luis', displayName: 'Luis', passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  models.createUser({ username: 'thinker55', displayName: 'Thinker', passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  luis = makeClient(app.base); await luis.login('luis', PASSWORD);
  await importOne({ id: 1, title: 'Pickup One', author: 'Thinking Horndog', slug: 'thinking-horndog' });
  await importOne({ id: 2, title: 'Pickup Two', author: 'Thinking Horndog', slug: 'thinking-horndog' });
  await importOne({ id: 3, title: 'Far Out', author: 'Akarge', slug: 'akarge' });
  await importOne({ id: 4, title: 'Farther Out', author: 'Akarge', slug: 'Akarge' });
});
test.after(() => app && app.stop());

test('every imported author, grouped, with the stories they came with', async () => {
  const html = await (await luis.request('/authors')).text();
  assert.match(html, /2 authors/, 'Akarge and akarge are one author');
  assert.match(html, /4 stories/);
  assert.match(html, /id="a-sol-thinking-horndog"[\s\S]*Pickup One[\s\S]*Pickup Two/);
  assert.match(html, /This is me/, 'a member can claim');
  assert.ok(!/Give to/.test(html), 'only an admin gives stories away');
  assert.match(html, /data-author-find/);
});

test('a claim from the page, answered on the page', async () => {
  const res = await luis.request('/users/sol-akarge/claim', { method: 'POST', ...form([['message', 'It is me.'], ['back', 'authors']]) });
  assert.match(res.headers.get('location'), /^\/authors\?notice=.*#a-sol-akarge$/);
  assert.match(await (await luis.request('/authors')).text(), /You have said this is you/);
  const seen = await (await admin.request('/authors')).text();
  assert.match(seen, /Luis<\/a> says this is them/);
  const claim = models.listPendingClaims()[0];
  const yes = await admin.request(`/admin/claims/${claim.id}/approve`, { method: 'POST', ...form([['back', 'authors']]) });
  assert.match(yes.headers.get('location'), /^\/authors\?notice=/);
  const luisId = models.getUserByUsername('luis').id;
  assert.ok(models.listStories().filter((s) => s.title.startsWith('Far')).every((s) => s.author_id === luisId));
  const after = await (await admin.request('/authors')).text();
  assert.match(after, /Here now[\s\S]*Akarge[\s\S]*Now <a href="\/users\/luis">Luis/, 'still listed, as whose they are now');
});

test('an admin gives an author to a member directly', async () => {
  assert.strictEqual((await luis.request('/admin/authors/1/assign', { method: 'POST', ...form([['member', 'luis']]) })).status, 403);
  const author = models.getUserByUsername('sol-thinking-horndog');
  assert.match(await (await admin.request('/authors')).text(), /Give to[\s\S]*Thinker \(thinker55\)/);
  const res = await admin.request(`/admin/authors/${author.id}/assign`, { method: 'POST', ...form([['member', 'thinker55']]) });
  assert.match(decodeURIComponent(res.headers.get('location')), /Thinking Horndog is Thinker now: 2 stories/);
  const thinker = models.getUserByUsername('thinker55');
  assert.ok(models.listStories().filter((s) => s.title.startsWith('Pickup')).every((s) => s.author_id === thinker.id));
  const twice = await admin.request(`/admin/authors/${author.id}/assign`, { method: 'POST', ...form([['member', 'luis']]) });
  assert.match(decodeURIComponent(twice.headers.get('location')), /already belongs to somebody/);
});

test('a story by an author somebody already has goes straight to them', async () => {
  const r = await importOne({ id: 5, title: 'Pickup Three', author: 'Thinking Horndog', slug: 'thinking-horndog' });
  assert.strictEqual(r.author, 'Thinking Horndog (Thinker)');
  const story = models.listStories().find((s) => s.title === 'Pickup Three');
  assert.strictEqual(story.author_id, models.getUserByUsername('thinker55').id);
  assert.match(await (await admin.request('/authors')).text(), /id="a-sol-thinking-horndog"[\s\S]*Pickup Three/, 'and is listed under the name it came with');
});

test('the wiki pages for a story and its writer are the ones linked, not doubled', async () => {
  models.replaceWikiPages([
    { title: 'Far Out (story)', summary: 'A story.', contentHtml: '<p>A story by Akarge.</p>', categories: ['Stories'] },
    { title: 'Pickup One!', summary: 'Another.', contentHtml: '<p>By Thinking Horndog.</p>', categories: ['Stories'] },
    { title: 'Thinking Horndog', summary: 'A writer.', contentHtml: '<p>Writes pickups.</p>', categories: ['Authors'] },
  ]);
  models.refreshStoryGlossary();
  const own = models.listWikiPagesForGlossary().map((p) => p.title);
  assert.ok(!own.includes('Far Out'), 'no second page for a story the wiki already has');
  assert.ok(!own.includes('Pickup One'), 'nor for one it spells with a mark more');
  assert.ok(own.includes('Farther Out'), 'a story the wiki lacks still gets its own');

  const far = models.listStories().find((s) => s.title === 'Far Out');
  assert.match(await (await luis.request(`/stories/${far.id}`)).text(), /href="\/wiki\/Far%20Out%20\(story\)">its page in the wiki/);
  const page = await (await luis.request('/wiki/Far%20Out%20(story)')).text();
  assert.match(page, new RegExp(`This story is here.*href="/stories/${far.id}"`, 's'));
  const writer = await (await luis.request('/wiki/Thinking%20Horndog')).text();
  assert.match(writer, /Their stories are here[\s\S]*3 stories by Thinking Horndog[\s\S]*who is <a href="\/users\/thinker55">Thinker/);
  assert.match(await (await admin.request('/authors')).text(), /id="a-sol-thinking-horndog"[\s\S]*href="\/wiki\/Thinking%20Horndog">In the wiki/);
});

test('a file that does not say where it came from is still not imported twice', async () => {
  const noSource = async () => {
    const buf = await solEpub({ id: 77, title: 'Nowhere Story', author: 'Akarge', slug: 'akarge' });
    const JSZipLocal = JSZip;
    const zip = await JSZipLocal.loadAsync(buf);
    zip.file('OEBPS/finish.xhtml', page('Finish', '<p>The End</p>'));
    return zip.generateAsync({ type: 'nodebuffer' });
  };
  const { multipartWithFile } = require('./helpers/app');
  const send = async () => (await (await admin.request('/admin/import/batch', {
    method: 'POST', headers: { Accept: 'application/json' },
    ...multipartWithFile([['tags', 'skip']], { name: 'file', filename: 'nowhere.epub', body: await noSource() }),
  })).json()).results[0].status;
  assert.strictEqual(await send(), 'imported');
  assert.strictEqual(await send(), 'duplicate');
});
