'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

// Bringing a StoriesOnline story in (admins, /admin/import), and a member
// claiming the imported author as themselves (/users/<author>/claim, then
// an admin says yes or no on /admin).
//
// An import is two steps. The upload is read and shown -- title, author,
// tags, and every chapter as it was cut, with its length and first line --
// and nothing is written until the admin has looked and pressed Import.
// Between the two the file waits in memory for an hour under a random key,
// which is all the second step needs to find it again.

const crypto = require('crypto');
const images = require('../lib/entity-images');
const { readSolEpub } = require('../lib/sol-import');
const { parseBody, parseMultipartBody, redirect, sendHtml } = require('../lib/util');
const models = require('../models');
const views = require('../views');
const { UPLOAD_LIMIT_BYTES, logEvent, sendError } = require('./shared');

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
    duplicate: models.findImportedStory(parsed.solId),
    tags: models.matchTags(parsed.tags),
  };
}

// The groups a new tag can go in: the ones the vocabulary has, less the
// queue proposals wait in.
const tagGroups = () => models.listTagsGrouped().map((g) => g.group).filter((g) => g !== 'Proposed');

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
  const storyId = models.importStory({ ...parsed, title, chapters }, {
    authorId: author.id, tagIds, coverImage,
  });
  if (chosen.added.length) {
    logEvent(user, 'tags-added', { subject: chosen.added.join(', '), href: '/admin#tags' });
  }
  WAITING.delete(key);
  logEvent(user, 'story-imported', { subject: `${title} by ${author.display_name}`, href: `/stories/${storyId}`, storyId });
  redirect(res, `/stories/${storyId}`);
}

// ---------- claiming an imported author ----------

async function handleClaim(req, res, user, username) {
  const author = models.getUserByUsername(String(username).toLowerCase());
  if (!author || !author.is_placeholder) return sendError(res, 404, 'No such imported author', user);
  if (author.claimed_by) return redirect(res, `/users/${encodeURIComponent(author.username)}`);
  if (user.is_placeholder) return sendError(res, 403, 'Not from this account.', user);
  const body = await parseBody(req);
  models.requestClaim(author.id, user.id, body.message);
  logEvent(user, 'author-claimed', { subject: author.display_name, href: `/users/${encodeURIComponent(author.username)}` });
  redirect(res, `/users/${encodeURIComponent(author.username)}?notice=${encodeURIComponent('Your claim is with the admins. Once one of them agrees, these stories move to your account.')}`);
}

async function handleClaimDecision(req, res, user, claimId, yes) {
  const claim = models.getClaim(claimId);
  if (!claim) return sendError(res, 404, 'No such claim', user);
  const author = models.getUserById(claim.placeholder_id);
  const member = models.getUserById(claim.user_id);
  if (yes) {
    const moved = models.approveClaim(claimId, user.id);
    const n = moved ? moved.stories : 0;
    return redirect(res, `/admin?notice=${encodeURIComponent(`${author.display_name} is ${member.display_name} now: ${n} ${n === 1 ? 'story' : 'stories'} moved to their account.`)}#claims`);
  }
  models.declineClaim(claimId, user.id);
  redirect(res, `/admin?notice=${encodeURIComponent(`Turned down ${member.display_name}'s claim to be ${author.display_name}.`)}#claims`);
}

/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['GET', '/admin/import', (c) => handleImportPage(c.req, c.res, c.user)],
  ['POST', '/admin/import', (c) => handleImportUpload(c.req, c.res, c.user)],
  ['POST', /^\/admin\/import\/([a-f0-9]{24})$/, (c) => handleImportConfirm(c.req, c.res, c.user, c.m[1])],
  ['POST', /^\/admin\/claims\/(\d+)\/approve$/, (c) => handleClaimDecision(c.req, c.res, c.user, Number(c.m[1]), true)],
  ['POST', /^\/admin\/claims\/(\d+)\/decline$/, (c) => handleClaimDecision(c.req, c.res, c.user, Number(c.m[1]), false)],
  ['POST', /^\/users\/([A-Za-z0-9_.-]+)\/claim$/, (c) => handleClaim(c.req, c.res, c.user, c.m[1])],
];

module.exports = { routes };
