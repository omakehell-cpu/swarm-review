'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { parseBody, redirect, sendHtml } = require('../lib/util');
const models = require('../models');
const views = require('../views');
const { sendError } = require('./shared');

// The same rule as dating a chapter on the timeline: its writer, or the
// story's owner, who arranges the story.
function loadChapter(res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter || chapter.archived_at) { sendError(res, 404, 'Chapter not found', user); return null; }
  if (chapter.author_id !== user.id && chapter.story_author_id !== user.id) {
    sendError(res, 403, 'Only the chapter author or the story owner can pin moments in it.', user);
    return null;
  }
  return chapter;
}

async function handleMomentsPage(req, res, user, chapterId, query) {
  const chapter = loadChapter(res, user, chapterId);
  if (!chapter) return;
  sendHtml(res, 200, views.chapterMomentsPage({
    user, chapter, moments: models.chapterMoments(chapterId),
    whens: models.listStoryWhens(chapter.story_id), notice: (query.get('notice') || '').slice(0, 300),
  }));
}

async function handleSaveMoments(req, res, user, chapterId) {
  const chapter = loadChapter(res, user, chapterId);
  if (!chapter) return;
  const body = await parseBody(req);
  const list = (name) => [].concat(body[name] === undefined ? [] : body[name]);
  const anchors = list('anchor');
  const offsets = list('offset');
  const whens = list('when');
  const days = list('day');
  const rows = anchors.map((anchor, i) => ({ anchor: String(anchor), offset: Number(offsets[i]) || 0, when: whens[i], day: days[i] }));
  const n = models.saveChapterMoments(chapterId, rows, { userId: user.id, removeLost: list('removeLost').map(Number) });
  const notice = n ? `${n} ${n === 1 ? 'pin' : 'pins'} in this chapter.` : 'No pins in this chapter.';
  redirect(res, `/chapters/${chapterId}/moments?notice=${encodeURIComponent(notice)}`);
}

/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['GET', /^\/chapters\/(\d+)\/moments$/, (c) => handleMomentsPage(c.req, c.res, c.user, Number(c.m[1]), c.url.searchParams)],
  ['POST', /^\/chapters\/(\d+)\/moments$/, (c) => handleSaveMoments(c.req, c.res, c.user, Number(c.m[1]))],
];

module.exports = { handleMomentsPage, handleSaveMoments, routes };
