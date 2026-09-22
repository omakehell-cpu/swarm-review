'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const fs = require('fs');
const images = require('../lib/entity-images');
const { parseBody, parseMultipartBody, redirect, sendHtml } = require('../lib/util');
const models = require('../models');
const views = require('../views');
const { UPLOAD_LIMIT_BYTES, logEvent, sendError } = require('./shared');

// A story's cover: uploaded, cropped and taken down from the story's
// details page, by the story's owner -- the same person who sets its title.
// Reading it needs a session, like everything else here, but nothing more:
// a cover is what the story shows the group, not part of a private bible.

function ownStory(res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) { sendError(res, 404, 'Story not found', user); return null; }
  if (story.author_id !== user.id) { sendError(res, 403, "Only the story's author can change its cover.", user); return null; }
  return story;
}

function againWithError(res, user, story, message) {
  sendHtml(res, 400, views.editStoryPage({
    user, story, groups: models.listTagsGrouped(),
    selectedTagIds: models.getStoryTags(story.id).map((t) => t.id),
    coverError: message,
  }));
}

async function handleCover(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story || !story.cover_filename) return sendError(res, 404, 'This story has no cover', user);
  const file = images.imagePath(story.cover_filename);
  if (!fs.existsSync(file)) return sendError(res, 404, 'That cover is no longer on disk', user);
  res.writeHead(200, {
    'Content-Type': story.cover_type || 'application/octet-stream',
    'Content-Length': fs.statSync(file).size,
    // Every page asks for it as ?v=<file name>, and a new cover is a new
    // file name, so the old address can be cached for as long as it likes.
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
}

async function handleUploadCover(req, res, user, storyId) {
  const story = ownStory(res, user, storyId);
  if (!story) return;
  const { files } = await parseMultipartBody(req, UPLOAD_LIMIT_BYTES);
  let saved;
  try {
    saved = images.saveImage(files.cover);
  } catch (err) {
    if (!err.userFacing) throw err;
    return againWithError(res, user, story, err.message);
  }
  const replaced = models.setStoryCover(storyId, saved);
  if (replaced) images.removeImage(replaced);
  logEvent(user, 'cover-set', { subject: story.title, href: `/stories/${storyId}`, storyId });
  redirect(res, `/stories/${storyId}/edit#cover`);
}

async function handleRemoveCover(req, res, user, storyId) {
  const story = ownStory(res, user, storyId);
  if (!story) return;
  const removed = models.clearStoryCover(storyId);
  if (removed) images.removeImage(removed);
  redirect(res, `/stories/${storyId}/edit#cover`);
}

async function handleCoverFocus(req, res, user, storyId) {
  const story = ownStory(res, user, storyId);
  if (!story) return;
  const body = await parseBody(req);
  models.setStoryCoverFocus(storyId, body.focusX, body.focusY);
  redirect(res, `/stories/${storyId}/edit#cover`);
}

/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['GET', /^\/stories\/(\d+)\/cover$/, (c) => handleCover(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/cover$/, (c) => handleUploadCover(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/cover\/remove$/, (c) => handleRemoveCover(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/cover\/focus$/, (c) => handleCoverFocus(c.req, c.res, c.user, Number(c.m[1]))],
];

module.exports = { handleCover, handleCoverFocus, handleRemoveCover, handleUploadCover, routes };
