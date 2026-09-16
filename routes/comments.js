'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { parseMarkdown, flattenLength } = require('../lib/markdown');
const { parseBody, redirect } = require('../lib/util');
const models = require('../models');
const views = require('../views');
const { logEvent, sendError } = require('./shared');
// One note, re-rendered, for a page that asked to change it in place
// instead of reloading.
//
// The same handler answers both: it does the same permission checks, the
// same writes and the same logging, and only the last line differs. A
// second code path for "the same thing, but with JavaScript" is how the
// two drift until one of them lets somebody do what the other does not.
function replyWithComment(req, res, user, commentId, announcement) {
  if (!wantsFragment(req)) return null;
  const comment = models.getCommentById(commentId);
  if (!comment) return sendError(res, 404, 'Comment not found', user);
  const version = models.getVersion(comment.version_id);
  const chapter = models.getChapterById(version.chapter_id);
  const all = models.listCommentsForVersion(comment.version_id);
  const replies = all.filter((c) => c.parent_id === comment.id);
  const html = views.renderComment(comment, {
    isChapterAuthor: chapter.author_id === user.id,
    currentUserId: user.id,
    replies,
  });
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    // What a screen reader should say once the swap has happened. A
    // header rather than markup, so the page decides where to put it.
    'x-announce': encodeURIComponent(announcement || ''),
    'x-frame-options': 'DENY',
  });
  res.end(html);
  return true;
}

const wantsFragment = (req) => String(req.headers['x-fragment'] || '') === 'comment';

async function handleCreateComment(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  const body = await parseBody(req);
  const versionId = Number(body.versionId);
  const version = models.getVersion(versionId);
  if (!version || version.chapter_id !== chapterId) return sendError(res, 400, 'Invalid version', user);

  const text = (body.body || '').trim();
  if (!text) return redirect(res, `/chapters/${chapterId}?v=${version.version_number}`);

  let start = null; let end = null; let quoted = null;
  if (body.start !== undefined && body.end !== undefined && body.start !== '' && body.end !== '') {
    start = Number(body.start);
    end = Number(body.end);
    quoted = (body.quoted || '').slice(0, 4000);
    const renderedLength = flattenLength(parseMarkdown(version.content));
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > renderedLength) {
      start = null; end = null; quoted = null; // fall back to a general comment rather than reject
    }
  }

  models.createComment({
    versionId, authorId: user.id, startOffset: start, endOffset: end, quotedText: quoted, body: text.slice(0, 4000),
  });
  logEvent(user, 'comment-added', {
    subject: chapter.title, href: `/chapters/${chapterId}?v=${version.version_number}`,
    storyId: chapter.story_id, chapterId,
  });
  redirect(res, `/chapters/${chapterId}?v=${version.version_number}`);
}

async function handleCommentReply(req, res, user, commentId) {
  const parent = models.getCommentById(commentId);
  if (!parent) return sendError(res, 404, 'Comment not found', user);
  const version = models.getVersion(parent.version_id);
  const body = await parseBody(req);
  const text = (body.body || '').trim();
  if (text) {
    models.createComment({
      versionId: parent.version_id, authorId: user.id, parentId: parent.id, body: text.slice(0, 2000),
    });
    const chapter = models.getChapterById(version.chapter_id);
    logEvent(user, 'comment-replied', {
      subject: chapter ? chapter.title : '', href: `/chapters/${version.chapter_id}?v=${version.version_number}`,
      storyId: chapter ? chapter.story_id : null, chapterId: version.chapter_id,
    });
  }
  if (replyWithComment(req, res, user, parent.id, 'Reply posted.')) return;
  redirect(res, `/chapters/${version.chapter_id}?v=${version.version_number}`);
}

async function handleCommentStatus(req, res, user, commentId) {
  const comment = models.getCommentById(commentId);
  if (!comment) return sendError(res, 404, 'Comment not found', user);
  const version = models.getVersion(comment.version_id);
  const chapter = models.getChapterById(version.chapter_id);
  if (chapter.author_id !== user.id) return sendError(res, 403, "Only the chapter's author can resolve comments.", user);

  const body = await parseBody(req);
  const status = body.status === 'accepted' ? 'accepted' : body.status === 'rejected' ? 'rejected' : null;
  if (status) {
    models.setCommentStatus({ commentId, status, resolvedBy: user.id });
    logEvent(user, status === 'accepted' ? 'comment-accepted' : 'comment-rejected', {
      subject: chapter.title, href: `/chapters/${chapter.id}?v=${version.version_number}#comment-${commentId}`,
      storyId: chapter.story_id, chapterId: chapter.id,
    });
  }
  if (replyWithComment(req, res, user, commentId, status === 'accepted' ? 'Note accepted.' : 'Note turned down.')) return;
  redirect(res, `/chapters/${chapter.id}?v=${version.version_number}`);
}

async function handleCommentEdit(req, res, user, commentId) {
  const comment = models.getCommentById(commentId);
  if (!comment) return sendError(res, 404, 'Comment not found', user);
  if (comment.author_id !== user.id) return sendError(res, 403, 'Only the comment author can edit it.', user);
  if (comment.deleted_at) return sendError(res, 400, 'This comment has been retracted.', user);
  const version = models.getVersion(comment.version_id);
  const body = await parseBody(req);
  const text = (body.body || '').trim();
  if (text) {
    models.editComment({ commentId, body: text.slice(0, 4000) });
    logEvent(user, 'comment-edited', { href: `/chapters/${version.chapter_id}#comment-${commentId}`, chapterId: version.chapter_id });
  }
  if (replyWithComment(req, res, user, commentId, 'Note saved.')) return;
  redirect(res, `/chapters/${version.chapter_id}?v=${version.version_number}#comment-${commentId}`);
}

async function handleCommentRetract(req, res, user, commentId) {
  const comment = models.getCommentById(commentId);
  if (!comment) return sendError(res, 404, 'Comment not found', user);
  if (comment.author_id !== user.id) return sendError(res, 403, 'Only the comment author can retract it.', user);
  const version = models.getVersion(comment.version_id);
  if (!comment.deleted_at) {
    models.retractComment(commentId);
    logEvent(user, 'comment-retracted', { href: `/chapters/${version.chapter_id}`, chapterId: version.chapter_id });
  }
  if (replyWithComment(req, res, user, commentId, 'Note retracted.')) return;
  redirect(res, `/chapters/${version.chapter_id}?v=${version.version_number}`);
}

async function handleCommentReopen(req, res, user, commentId) {
  const comment = models.getCommentById(commentId);
  if (!comment) return sendError(res, 404, 'Comment not found', user);
  const version = models.getVersion(comment.version_id);
  const chapter = models.getChapterById(version.chapter_id);
  if (chapter.author_id !== user.id) return sendError(res, 403, "Only the chapter's author can reopen comments.", user);
  if (!comment.deleted_at && comment.status !== 'pending') {
    models.reopenComment(commentId);
    logEvent(user, 'comment-reopened', {
      subject: chapter.title, href: `/chapters/${chapter.id}#comment-${commentId}`,
      storyId: chapter.story_id, chapterId: chapter.id,
    });
  }
  if (replyWithComment(req, res, user, commentId, 'Note reopened.')) return;
  redirect(res, `/chapters/${chapter.id}?v=${version.version_number}#comment-${commentId}`);
}

// ---------------------------------------------------------------------
// live markdown preview (writing analyzer's optional split view)
// ---------------------------------------------------------------------

// The routes this file answers. server.js walks the tables in order
// and hands the first match a context: the request, the response, who is
// asking, the parsed URL and the regex groups.
/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['POST', /^\/chapters\/(\d+)\/comments$/, (c) => handleCreateComment(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/comments\/(\d+)\/reply$/, (c) => handleCommentReply(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/comments\/(\d+)\/status$/, (c) => handleCommentStatus(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/comments\/(\d+)\/edit$/, (c) => handleCommentEdit(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/comments\/(\d+)\/retract$/, (c) => handleCommentRetract(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/comments\/(\d+)\/reopen$/, (c) => handleCommentReopen(c.req, c.res, c.user, Number(c.m[1]))],
];

module.exports = {
  handleCommentEdit,
  handleCommentReopen,
  handleCommentReply,
  handleCommentRetract,
  handleCommentStatus,
  handleCreateComment,
  routes,
};
