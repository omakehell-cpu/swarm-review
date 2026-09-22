'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { parseBody, redirect } = require('../lib/util');
const models = require('../models');
const { logEvent, sendError } = require('./shared');

// Asking for a read. The chapter's own author does the asking: it is
// their chapter and their question. The people asked arrive as a row of
// checkboxes, so one form asks several readers the same thing.
async function handleRequestReview(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  if (chapter.author_id !== user.id) return sendError(res, 403, "Only the chapter's author can ask for a read.", user);
  const body = await parseBody(req);
  const raw = body.reviewer;
  const reviewerIds = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(Number);
  const latest = models.getLatestVersion(chapterId);
  const asked = models.requestReview({
    chapterId, reviewerIds, requestedBy: user.id,
    question: body.question || '', versionNumber: latest ? latest.version_number : 1,
  });
  if (asked.length) {
    const names = models.listPeopleToAsk(user.id).filter((p) => asked.includes(p.id)).map((p) => p.display_name);
    logEvent(user, 'review-requested', {
      subject: `${chapter.title} → ${names.join(', ')}`, href: `/chapters/${chapterId}`,
      storyId: chapter.story_id, chapterId,
    });
  }
  redirect(res, `/chapters/${chapterId}#review-requests`);
}

async function handleReviewDone(req, res, user, requestId) {
  const request = models.getReviewRequest(requestId);
  if (!request) return sendError(res, 404, 'No such request', user);
  if (request.reviewer_id !== user.id) return sendError(res, 403, 'Only the person who was asked can close this.', user);
  const body = await parseBody(req);
  if (!request.done_at) {
    models.markReviewDone(requestId, body.note || '');
    const chapter = models.getChapterById(request.chapter_id);
    logEvent(user, 'review-done', {
      subject: chapter ? chapter.title : '', href: `/chapters/${request.chapter_id}`,
      storyId: chapter ? chapter.story_id : null, chapterId: request.chapter_id,
    });
  }
  redirect(res, `/chapters/${request.chapter_id}`);
}

// Taking a request back: the author changed their mind, or asked the
// wrong person. No trace is kept -- nobody needs a record of a question
// that was not really asked.
async function handleReviewWithdraw(req, res, user, requestId) {
  const request = models.getReviewRequest(requestId);
  if (!request) return redirect(res, '/');
  const chapter = models.getChapterById(request.chapter_id);
  if (!chapter || chapter.author_id !== user.id) return sendError(res, 403, "Only the chapter's author can take a request back.", user);
  models.withdrawReviewRequest(requestId);
  redirect(res, `/chapters/${request.chapter_id}#review-requests`);
}

/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['POST', /^\/chapters\/(\d+)\/review-requests$/, (c) => handleRequestReview(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/review-requests\/(\d+)\/done$/, (c) => handleReviewDone(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/review-requests\/(\d+)\/withdraw$/, (c) => handleReviewWithdraw(c.req, c.res, c.user, Number(c.m[1]))],
];

module.exports = { handleRequestReview, handleReviewDone, handleReviewWithdraw, routes };
