'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { parseBody, redirect, sendHtml } = require('../lib/util');
const models = require('../models');
const views = require('../views');
const { logEvent, sendError } = require('./shared');

// A chapter's boundary is its writer's to move, the same rule as editing
// its text: splitting rewrites the chapter, and merging rewrites it with
// the next one's words in it -- so both chapters have to be theirs.
function loadOwn(res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter || chapter.archived_at) { sendError(res, 404, 'Chapter not found', user); return null; }
  if (chapter.author_id !== user.id) { sendError(res, 403, 'Only the chapter author can split or merge it.', user); return null; }
  return chapter;
}

// Writing in the editor that is not published would be cut against the
// wrong text, or quietly dropped when the editor next loads.
function draftWaiting(chapterId, userId) {
  const draft = models.getDraft(chapterId, userId);
  if (!draft) return false;
  const latest = models.getLatestVersion(chapterId);
  return String(draft.content || '').trim() !== String((latest && latest.content) || '').trim();
}

function renderPage(res, user, chapter, status = 200, extra = {}) {
  const latest = models.getLatestVersion(chapter.id);
  const next = models.nextChapterOf(chapter);
  sendHtml(res, status, views.splitChapterPage({
    user,
    chapter,
    story: models.getStoryById(chapter.story_id),
    points: models.splitPoints(latest.content),
    next,
    canMerge: !!next && next.author_id === user.id,
    draftWaiting: draftWaiting(chapter.id, user.id),
    pendingNotes: models.countPendingOnVersion(latest.id),
    ...extra,
  }));
}

async function handleSplitPage(req, res, user, chapterId) {
  const chapter = loadOwn(res, user, chapterId);
  if (chapter) renderPage(res, user, chapter);
}

async function handleSplit(req, res, user, chapterId) {
  const chapter = loadOwn(res, user, chapterId);
  if (!chapter) return;
  const body = await parseBody(req);
  const values = { at: body.at, title: body.title };
  if (draftWaiting(chapterId, user.id)) {
    return renderPage(res, user, chapter, 409, { values, error: 'There is unpublished writing in the editor. Publish it or throw it away first.' });
  }
  const result = models.splitChapter({ chapterId, at: Number(body.at), title: body.title });
  if (result.error) return renderPage(res, user, chapter, 400, { values, error: result.error });
  logEvent(user, 'chapter-split', {
    subject: `${result.first.title} / ${result.second.title}`, href: `/chapters/${result.second.id}`,
    storyId: chapter.story_id, chapterId: result.second.id,
  });
  const notice = `Split. This is chapter ${result.second.chapter_number}, from where you cut${result.moved ? `, with the ${result.moved} note${result.moved === 1 ? '' : 's'} on it` : ''}. Chapter ${result.first.chapter_number} keeps the first half.`;
  redirect(res, `/chapters/${result.second.id}?notice=${encodeURIComponent(notice)}`);
}

async function handleMerge(req, res, user, chapterId) {
  const chapter = loadOwn(res, user, chapterId);
  if (!chapter) return;
  const next = models.nextChapterOf(chapter);
  if (!next) return renderPage(res, user, chapter, 400, { error: 'This is the last chapter: there is nothing after it to merge.' });
  if (next.author_id !== user.id) return sendError(res, 403, 'The next chapter was written by somebody else.', user);
  if (draftWaiting(chapterId, user.id) || draftWaiting(next.id, user.id)) {
    return renderPage(res, user, chapter, 409, { error: 'There is unpublished writing in the editor for one of these chapters. Publish it or throw it away first.' });
  }
  const result = models.mergeWithNext({ chapterId });
  if (result.error) return renderPage(res, user, chapter, 400, { error: result.error });
  logEvent(user, 'chapter-merged', {
    subject: `${result.merged.title} into ${result.chapter.title}`, href: `/chapters/${chapterId}`,
    storyId: chapter.story_id, chapterId,
  });
  const notice = `Merged: ${result.merged.title} is now the end of this chapter${result.moved ? `, with its ${result.moved} waiting note${result.moved === 1 ? '' : 's'}` : ''}. It is in the story's archived chapters if you want it back.`;
  redirect(res, `/chapters/${chapterId}?notice=${encodeURIComponent(notice)}`);
}

/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['GET', /^\/chapters\/(\d+)\/split$/, (c) => handleSplitPage(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/chapters\/(\d+)\/split$/, (c) => handleSplit(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/chapters\/(\d+)\/merge$/, (c) => handleMerge(c.req, c.res, c.user, Number(c.m[1]))],
];

module.exports = {
  handleMerge,
  handleSplit,
  handleSplitPage,
  routes,
};
