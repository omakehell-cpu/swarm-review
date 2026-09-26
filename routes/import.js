'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

// Bringing a StoriesOnline story in (admins, /admin/import), and a member
// claiming the imported author as themselves (/users/<author>/claim, then
// an admin says yes or no on /admin or /authors), or an admin giving an
// author's stories to the member they know it is (/authors).
//
// An import is two steps. The upload is read and shown -- title, author,
// tags, and every chapter as it was cut, with its length and first line --
// and nothing is written until the admin has looked and pressed Import.
// Between the two the file waits in memory for an hour under a random key,
// which is all the second step needs to find it again.

const crypto = require('crypto');
const images = require('../lib/entity-images');
const { readSolEpub } = require('../lib/sol-import');
const { parseBody, parseMultipartBody, redirect, sendHtml, sendJson } = require('../lib/util');
const models = require('../models');
const views = require('../views');
const { BATCH_UPLOAD_LIMIT_BYTES, UPLOAD_LIMIT_BYTES, logEvent, sendError } = require('./shared');

const WAITING = new Map();
const HOUR = 60 * 60 * 1000;
function keep(entry) {
  const now = Date.now();
  for (const [k, v] of WAITING) if (now - v.at > HOUR) WAITING.delete(k);
  const key = crypto.randomBytes(12).toString('hex');
  WAITING.set(key, { ...entry, at: now });
  return key;
}

function describe(parsed) {
  return {
    parsed,
    author: models.importedAuthorFor({ name: parsed.author, authorSlug: parsed.authorSlug }),
    duplicate: models.findImportedStory(parsed.solId, { title: parsed.title, name: parsed.author, authorSlug: parsed.authorSlug }),
    tags: models.matchTags(parsed.tags),
  };
}

// The groups a new tag can go in: the ones the vocabulary has, less the
// queue proposals wait in.
const tagGroups = () => models.listTagGroupNames();

async function handleImportPage(req, res, user) {
  sendHtml(res, 200, views.importPage({ user, authors: models.listImportedAuthors() }));
}

async function handleImportUpload(req, res, user) {
  const { files } = await parseMultipartBody(req, UPLOAD_LIMIT_BYTES);
  const file = files.epub;
  if (!file || !file.buffer || !file.buffer.length) {
    return sendHtml(res, 400, views.importPage({ user, authors: models.listImportedAuthors(), error: 'Choose an .epub file first.' }));
  }
  let parsed;
  try {
    parsed = await readSolEpub(file.buffer);
  } catch (err) {
    if (!err.userFacing) throw err;
    return sendHtml(res, 400, views.importPage({ user, authors: models.listImportedAuthors(), error: err.message }));
  }
  const key = keep({ parsed, filename: file.filename || '' });
  sendHtml(res, 200, views.importPreviewPage({
    user, key, filename: file.filename || '', groups: tagGroups(), ...describe(parsed),
  }));
}

async function handleImportConfirm(req, res, user, key) {
  const waiting = WAITING.get(key);
  if (!waiting) {
    return sendHtml(res, 410, views.importPage({ user, authors: models.listImportedAuthors(), error: 'That upload has expired (they wait an hour). Upload the file again.' }));
  }
  const body = await parseBody(req);
  const { parsed } = waiting;
  const { duplicate, tags } = describe(parsed);
  if (duplicate) return redirect(res, `/stories/${duplicate.id}`);
  // The chapter titles as the admin left them in the preview.
  const chapters = parsed.chapters.map((c, i) => ({
    ...c, title: String(body[`title${i}`] || c.title).trim().slice(0, 200) || c.title,
  }));
  const title = String(body.title || parsed.title).trim().slice(0, 200) || parsed.title;
  const author = models.findOrCreateImportedAuthor({ name: parsed.author, authorSlug: parsed.authorSlug, url: parsed.authorUrl });
  let coverImage = null;
  if (parsed.cover) {
    try { coverImage = images.saveImage({ buffer: parsed.cover.buffer }); } catch (err) { coverImage = null; }
  }
  // The tags the vocabulary did not have: added, used as a near spelling
  // the site already has, or left off, as the admin chose in the preview.
  const chosen = models.applyTagChoices(tags.suggestions, tags.suggestions.map((s, i) => ({
    action: String(body[`tag${i}`] || 'skip'), group: String(body[`group${i}`] || ''),
  })));
  const tagIds = [...new Set([...tags.matched.map((t) => t.id), ...chosen.ids])];
  // An author somebody has already been given: the story goes straight
  // to them, and still remembers whose name it came in under.
  const storyId = models.importStory({ ...parsed, title, chapters }, {
    authorId: author.claimed_by || author.id, importedAuthorId: author.id, tagIds, coverImage,
  });
  if (chosen.added.length) {
    logEvent(user, 'tags-added', { subject: chosen.added.join(', '), href: '/admin?open=tags#tag-vocabulary' });
  }
  WAITING.delete(key);
  logEvent(user, 'story-imported', { subject: `${title} by ${author.display_name}`, href: `/stories/${storyId}`, storyId });
  redirect(res, `/stories/${storyId}`);
}

// ---------- many at once ----------
//
// A shelf of EPUBs -- a hundred, three hundred -- imported without a
// preview each: the chapters are cut the same way, a story already here
// is skipped, and the tags the site does not have are handled one way for
// the whole batch, chosen up front. The page sends the files one at a
// time (import-batch.js) and lists each as it lands; a .zip of them is
// read here, and is also the way to send many with no script at all.

const TAG_MODES = ['propose', 'add', 'skip'];
const JSZip = require(require.resolve('jszip', { paths: [require('path').dirname(require.resolve('mammoth'))] }));

/**
 * One EPUB, imported as it is.
 * @param {Buffer} buffer @param {string} filename
 * @param {{ tagMode: string, user: any }} opts
 */
async function importOne(buffer, filename, { tagMode, user }) {
  let parsed;
  try {
    parsed = await readSolEpub(buffer);
  } catch (err) {
    if (!err.userFacing) throw err;
    return { file: filename, status: 'error', message: err.message };
  }
  const { duplicate, tags } = describe(parsed);
  if (duplicate) return { file: filename, status: 'duplicate', title: duplicate.title, storyId: duplicate.id };
  const author = models.findOrCreateImportedAuthor({ name: parsed.author, authorSlug: parsed.authorSlug, url: parsed.authorUrl });
  let coverImage = null;
  if (parsed.cover) {
    try { coverImage = images.saveImage({ buffer: parsed.cover.buffer }); } catch (err) { coverImage = null; }
  }
  // A near spelling the site already has is always used. The rest:
  // proposed (on the story, waiting in the admin's queue), added to the
  // vocabulary, or left off.
  const tagIds = tags.matched.map((t) => t.id);
  const proposed = [];
  for (const s of tags.suggestions) {
    if (s.similar) { tagIds.push(s.similar.id); continue; }
    if (tagMode === 'add') {
      const { ids } = models.applyTagChoices([s], [{ action: 'add', group: s.group }]);
      tagIds.push(...ids);
    } else if (tagMode === 'propose') {
      const tag = models.proposeTag({ name: s.name, userId: user.id });
      if (tag) { tagIds.push(tag.id); proposed.push(tag.name); }
    }
  }
  const owner = author.claimed_by ? models.getUserById(author.claimed_by) : null;
  const storyId = models.importStory(parsed, {
    authorId: owner ? owner.id : author.id, importedAuthorId: author.id, tagIds: [...new Set(tagIds)], coverImage,
  });
  logEvent(user, 'story-imported', { subject: `${parsed.title} by ${author.display_name}`, href: `/stories/${storyId}`, storyId });
  return {
    file: filename, status: 'imported', storyId, title: parsed.title,
    author: owner ? `${author.display_name} (${owner.display_name})` : author.display_name,
    chapters: parsed.chapters.length, proposed,
  };
}

/** The EPUBs inside a .zip, in name order, leaving out the Mac's shadow copies. */
async function epubsInZip(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter((n) => /\.epub$/i.test(n) && !zip.files[n].dir && !/(^|\/)__MACOSX\//.test(n) && !/(^|\/)\._/.test(n))
    .sort((a, b) => a.localeCompare(b));
  const out = [];
  for (const name of names) out.push({ name: name.split('/').pop(), buffer: await zip.files[name].async('nodebuffer') });
  return out;
}

async function handleImportBatch(req, res, user) {
  const wantsJson = (req.headers.accept || '').includes('application/json');
  const { fields, files } = await parseMultipartBody(req, BATCH_UPLOAD_LIMIT_BYTES);
  const tagMode = TAG_MODES.includes(fields.tags) ? fields.tags : 'propose';
  const file = files.file;
  const refuse = (message) => (wantsJson
    ? sendJson(res, 400, { results: [{ file: (file && file.filename) || '', status: 'error', message }] })
    : sendHtml(res, 400, views.importPage({ user, authors: models.listImportedAuthors(), error: message })));
  if (!file || !file.buffer || !file.buffer.length) return refuse('Choose EPUB files, or a .zip of them.');
  const name = file.filename || 'upload';
  let books;
  if (/\.zip$/i.test(name)) {
    try { books = await epubsInZip(file.buffer); } catch (err) { return refuse(`${name} is not a .zip that can be opened.`); }
    if (!books.length) return refuse(`There is no .epub inside ${name}.`);
  } else {
    books = [{ name, buffer: file.buffer }];
  }
  const results = [];
  for (const book of books) results.push(await importOne(book.buffer, book.name, { tagMode, user }));
  if (wantsJson) return sendJson(res, 200, { results });
  sendHtml(res, 200, views.importBatchPage({ user, results, tagMode }));
}

// ---------- claiming an imported author ----------

async function handleClaim(req, res, user, username) {
  const author = models.getUserByUsername(String(username).toLowerCase());
  if (!author || !author.is_placeholder) return sendError(res, 404, 'No such imported author', user);
  if (author.claimed_by) return redirect(res, `/users/${encodeURIComponent(author.username)}`);
  if (user.is_placeholder) return sendError(res, 403, 'Not from this account.', user);
  const body = await parseBody(req);
  models.requestClaim(author.id, user.id, body.message);
  logEvent(user, 'author-claimed', { subject: author.display_name, href: '/authors' });
  const said = 'Your claim is with the admins. Once one of them agrees, these stories move to your account.';
  redirect(res, body.back === 'authors'
    ? authorsUrl(author, said)
    : `/users/${encodeURIComponent(author.username)}?notice=${encodeURIComponent(said)}`);
}

// Back to the author's place on /authors, with a line saying what happened.
const authorsUrl = (author, notice) => `/authors?notice=${encodeURIComponent(notice)}#a-${encodeURIComponent(author.username)}`;

async function handleAuthorsPage(req, res, user, query) {
  sendHtml(res, 200, views.authorsPage({
    user,
    authors: models.importedAuthorsWithStories().map((a) => {
      // The wiki keeps a page for most of these writers, under the name
      // they write as; where it does, the card links to it.
      return { ...a, wiki: models.wikiPageForName(a.display_name) };
    }),
    members: user.is_admin ? models.listMentionable() : [],
    notice: (query.get('notice') || '').slice(0, 300),
  }));
}

// The other way in: an admin who knows who an author is gives them their
// stories directly, without a claim to wait for.
async function handleAssignAuthor(req, res, user, authorId) {
  const author = models.getUserById(authorId);
  if (!author || !author.is_placeholder) return sendError(res, 404, 'No such imported author', user);
  const body = await parseBody(req);
  const member = models.getUserByUsername(String(body.member || '').toLowerCase());
  if (!member || member.is_placeholder) {
    return redirect(res, authorsUrl(author, 'Choose who they are from the list first.'));
  }
  const moved = models.assignImportedAuthor(author.id, member.id, user.id);
  if (!moved) return redirect(res, authorsUrl(author, `${author.display_name} already belongs to somebody.`));
  logEvent(user, 'author-assigned', { subject: `${author.display_name} is ${member.display_name}`, href: '/authors' });
  const n = moved.stories;
  redirect(res, authorsUrl(author, `${author.display_name} is ${member.display_name} now: ${n} ${n === 1 ? 'story' : 'stories'} moved to their account.`));
}

async function handleClaimDecision(req, res, user, claimId, yes) {
  const claim = models.getClaim(claimId);
  if (!claim) return sendError(res, 404, 'No such claim', user);
  const author = models.getUserById(claim.placeholder_id);
  const member = models.getUserById(claim.user_id);
  const { back } = await parseBody(req);
  if (yes) {
    const moved = models.approveClaim(claimId, user.id);
    const n = moved ? moved.stories : 0;
    const said = `${author.display_name} is ${member.display_name} now: ${n} ${n === 1 ? 'story' : 'stories'} moved to their account.`;
    return redirect(res, back === 'authors' ? authorsUrl(author, said) : `/admin?notice=${encodeURIComponent(said)}#claims`);
  }
  models.declineClaim(claimId, user.id);
  const said = `Turned down ${member.display_name}'s claim to be ${author.display_name}.`;
  redirect(res, back === 'authors' ? authorsUrl(author, said) : `/admin?notice=${encodeURIComponent(said)}#claims`);
}

/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['GET', '/admin/import', (c) => handleImportPage(c.req, c.res, c.user)],
  ['POST', '/admin/import', (c) => handleImportUpload(c.req, c.res, c.user)],
  ['POST', '/admin/import/batch', (c) => handleImportBatch(c.req, c.res, c.user)],
  ['POST', /^\/admin\/import\/([a-f0-9]{24})$/, (c) => handleImportConfirm(c.req, c.res, c.user, c.m[1])],
  ['POST', /^\/admin\/claims\/(\d+)\/approve$/, (c) => handleClaimDecision(c.req, c.res, c.user, Number(c.m[1]), true)],
  ['POST', /^\/admin\/claims\/(\d+)\/decline$/, (c) => handleClaimDecision(c.req, c.res, c.user, Number(c.m[1]), false)],
  ['POST', /^\/users\/([A-Za-z0-9_.-]+)\/claim$/, (c) => handleClaim(c.req, c.res, c.user, c.m[1])],
  ['GET', '/authors', (c) => handleAuthorsPage(c.req, c.res, c.user, c.url.searchParams)],
  ['POST', /^\/admin\/authors\/(\d+)\/assign$/, (c) => handleAssignAuthor(c.req, c.res, c.user, Number(c.m[1]))],
];

module.exports = { epubsInZip, importOne, routes };
