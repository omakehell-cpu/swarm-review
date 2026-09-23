'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { parseMarkdown, renderPlainText } = require('../lib/markdown');
const diff = require('../lib/diff');
const { parseBody, sendHtml, sendJson } = require('../lib/util');
const models = require('../models');
const views = require('../views');
const { sendError } = require('./shared');

// The writing desk: scene notes and snapshots, for the chapter's own
// author. Everything here answers the editor's scripts in JSON, except
// the comparison, which is a page.

function ownChapter(user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return { error: [404, 'Chapter not found'] };
  if (chapter.author_id !== user.id) return { error: [403, "Only the chapter's author keeps notes and snapshots on it."] };
  return { chapter };
}

const snapshotRow = (s) => ({ id: s.id, name: s.name, words: s.word_count, at: s.created_at });

async function handleSceneNote(req, res, user, chapterId) {
  const { error } = ownChapter(user, chapterId);
  if (error) return sendJson(res, error[0], { error: error[1] });
  const body = await parseBody(req);
  const saved = models.saveSceneNote(chapterId, body.position, body.body);
  sendJson(res, 200, { ok: true, note: saved });
}

async function handleCreateSnapshot(req, res, user, chapterId) {
  const { error } = ownChapter(user, chapterId);
  if (error) return sendJson(res, error[0], { error: error[1] });
  const body = await parseBody(req);
  const content = String(body.content || '').replace(/\r\n/g, '\n');
  if (!content.trim()) return sendJson(res, 400, { error: 'There is nothing in the editor to keep.' });
  models.createSnapshot({ chapterId, userId: user.id, name: body.name, content });
  sendJson(res, 200, { ok: true, snapshots: models.listSnapshots(chapterId).map(snapshotRow) });
}

function ownSnapshot(user, snapshotId) {
  const snapshot = models.getSnapshot(snapshotId);
  if (!snapshot) return { error: [404, 'No such snapshot'] };
  const { chapter, error } = ownChapter(user, snapshot.chapter_id);
  if (error) return { error };
  return { snapshot, chapter };
}

async function handleSnapshotJson(req, res, user, snapshotId) {
  const { snapshot, error } = ownSnapshot(user, snapshotId);
  if (error) return sendJson(res, error[0], { error: error[1] });
  sendJson(res, 200, { id: snapshot.id, name: snapshot.name, content: snapshot.content });
}

async function handleDeleteSnapshot(req, res, user, snapshotId) {
  const { snapshot, error } = ownSnapshot(user, snapshotId);
  if (error) return sendJson(res, error[0], { error: error[1] });
  models.deleteSnapshot(snapshotId);
  sendJson(res, 200, { ok: true, snapshots: models.listSnapshots(snapshot.chapter_id).map(snapshotRow) });
}

// What changed between a snapshot and the chapter as it is: the published
// version, or -- when there is one -- the author's draft, which is the
// comparison they almost always mean.
async function handleCompareSnapshot(req, res, user, snapshotId) {
  const { snapshot, chapter, error } = ownSnapshot(user, snapshotId);
  if (error) return sendError(res, error[0], error[1], user);
  const latest = models.getLatestVersion(chapter.id);
  const draft = models.getDraft(chapter.id, user.id);
  const against = draft
    ? { label: 'your unpublished draft', content: draft.content }
    : { label: `version ${latest ? latest.version_number : 1}, as published`, content: latest ? latest.content : '' };
  const readable = (text) => renderPlainText(parseMarkdown(text), { quoteMarker: '' });
  const blocks = diff.diffVersions(readable(snapshot.content), readable(against.content));
  sendHtml(res, 200, views.snapshotComparePage({
    user, chapter, snapshot, againstLabel: against.label, blocks, summary: diff.summarizeDiff(blocks),
  }));
}

/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['POST', /^\/chapters\/(\d+)\/scene-notes$/, (c) => handleSceneNote(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/chapters\/(\d+)\/snapshots$/, (c) => handleCreateSnapshot(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', /^\/snapshots\/(\d+)\.json$/, (c) => handleSnapshotJson(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/snapshots\/(\d+)\/delete$/, (c) => handleDeleteSnapshot(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', /^\/snapshots\/(\d+)\/compare$/, (c) => handleCompareSnapshot(c.req, c.res, c.user, Number(c.m[1]))],
];

module.exports = { handleCompareSnapshot, handleCreateSnapshot, handleDeleteSnapshot, handleSceneNote, handleSnapshotJson, routes };
