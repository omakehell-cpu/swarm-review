'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { parseMarkdown, renderPlainText } = require('../lib/markdown');
const { markdownToDocxBuffer } = require('../lib/docx');
const { compileStory } = require('../lib/compile');
const typeset = require('../lib/typeset');
const { renderPdf } = require('../lib/pdf');
const { renderEpub } = require('../lib/epub');
const { parseBody, parseMultipartBody, sendHtml, sendJson, redirect } = require('../lib/util');
const models = require('../models');
const views = require('../views');
const { UPLOAD_LIMIT_BYTES, extractUploadedText, logEvent, proposedTagIdsFromBody, sendError, slugForFilename, tagIdsFromBody } = require('./shared');
async function handleEditStoryPage(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (story.author_id !== user.id) return sendError(res, 403, 'Only the story author can edit its details.', user);
  sendHtml(res, 200, views.editStoryPage({
    user,
    story,
    groups: models.listTagsGrouped(),
    selectedTagIds: models.getStoryTags(storyId).map((t) => t.id),
  }));
}

async function handleEditStorySubmit(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (story.author_id !== user.id) return sendError(res, 403, 'Only the story author can edit its details.', user);

  const body = await parseBody(req);
  const title = (body.title || '').trim();
  const description = (body.description || '').trim();
  const synopsis = (body.synopsis || '').trim();
  const status = body.status;
  const tagIds = [...tagIdsFromBody(body), ...proposedTagIdsFromBody(body, user)];
  if (!title) {
    return sendHtml(res, 400, views.editStoryPage({
      user, story, groups: models.listTagsGrouped(), selectedTagIds: tagIds,
      error: 'A story needs a title.',
      values: { title, description, synopsis },
    }));
  }
  models.updateStoryDetails(storyId, { title, description, synopsis, status });
  models.setStoryWordGoal(storyId, body.wordGoal);
  models.setStoryTags(storyId, tagIds);
  logEvent(user, 'story-edited', { subject: title, href: `/stories/${storyId}`, storyId });
  if (status && status !== story.status) {
    logEvent(user, 'status-changed', { subject: `${title}: ${status}`, href: `/stories/${storyId}`, storyId });
  }
  redirect(res, `/stories/${storyId}`);
}

// ---------- admin: the tag vocabulary ----------

// Everything downloadable here was a single chapter, which is the unit the
// app works in and the wrong unit for showing somebody a novel.
async function handleCompile(req, res, user, storyId, format, query) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  const chapters = models.chaptersForCompile(storyId);
  if (!chapters.length) return sendError(res, 404, 'This story has no chapters to compile.', user);

  const options = {
    // Off by default: a synopsis is a note to the group, not the front of
    // the book, and the person compiling says when it belongs there.
    synopsis: query.get('synopsis') === '1',
    numbers: query.get('numbers') !== '0',
    frontMatter: query.get('cover') !== '0',
    layout: typeset.layoutName(query.get('layout')),
  };

  logEvent(user, 'downloaded', {
    subject: `${story.title}, the whole story as .${format}`, href: `/stories/${storyId}`, storyId,
  });

  const filename = `${slugForFilename(story.title)}.${format}`;
  const disposition = `attachment; filename="${filename}"`;

  // The two that are laid out rather than written out. Both read the same
  // typeset document, so they agree about what a scene break is and where
  // a chapter starts -- which they did not when each one re-parsed a
  // string of markdown and guessed.
  if (format === 'pdf' || format === 'epub') {
    const doc = typeset.typesetStory(story, chapters, options);
    const body = format === 'pdf' ? await renderPdf(doc) : renderEpub(doc);
    res.writeHead(200, {
      'Content-Type': format === 'pdf' ? 'application/pdf' : 'application/epub+zip',
      'Content-Disposition': disposition,
      'Content-Length': body.length,
    });
    return res.end(body);
  }

  const markdown = compileStory(story, chapters, options);
  if (format === 'md') {
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': disposition });
    return res.end(markdown);
  }
  if (format === 'txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': disposition });
    return res.end(renderPlainText(parseMarkdown(markdown)));
  }
  const buffer = await markdownToDocxBuffer({ title: story.title, markdownSource: markdown });
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Disposition': disposition,
    'Content-Length': buffer.length,
  });
  return res.end(buffer);
}

async function handleAnalysis(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  const analysis = models.storyAnalysis(storyId);
  // A private bible does not show its cast here either.
  if (!models.canReadBible(story, user)) analysis.presence = [];
  sendHtml(res, 200, views.analysisPage({
    user, story, analysis, canWrite: models.canWriteInStory(story, user),
  }));
}

// The story's own calendar. A private bible keeps its entries off it, the
// same way it keeps its cast off the analysis: the chapters are still
// there, because chapter titles were never the private part.
async function handleTimeline(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  const timeline = models.storyTimeline(storyId);
  if (!models.canReadBible(story, user)) {
    timeline.placed = timeline.placed.filter((item) => item.type !== 'entry');
    timeline.undated = timeline.undated.filter((item) => item.type !== 'entry');
  }
  sendHtml(res, 200, views.timelinePage({
    user, story, timeline, canWrite: models.canWriteInStory(story, user),
  }));
}

// ---------- the outline (Scrivener's outliner, in this app's shape) ----------

async function handleOutline(req, res, user, storyId, query) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  const chapters = models.listChaptersForStory(storyId);
  sendHtml(res, 200, views.outlinePage({
    user, story, chapters,
    // Only the story's own author moves chapters around, the same rule the
    // up/down buttons have always had.
    canOrder: story.author_id === user.id,
    castByChapter: models.canReadBible(story, user) ? models.castByChapter(storyId) : new Map(),
    stats: models.getStoryStats(storyId),
    notice: query.get('notice') || '',
  }));
}

async function handleOutlineOrder(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendJson(res, 404, { error: 'Story not found' });
  if (story.author_id !== user.id) return sendJson(res, 403, { error: 'Only the story author can reorder chapters.' });
  const body = await parseBody(req);
  const order = [].concat(body.order || []).map(Number).filter(Boolean);
  if (!order.length) return sendJson(res, 400, { error: 'No order was sent.' });
  models.reorderChapters(storyId, order);
  logEvent(user, 'chapter-moved', { subject: story.title, href: `/stories/${storyId}/outline`, storyId });
  sendJson(res, 200, {
    order: models.listChaptersForStory(storyId).map((c) => ({ id: c.id, number: c.chapter_number })),
  });
}

async function handleArchivedStories(req, res, user) {
  const stories = models.listStories({ onlyArchived: true });
  sendHtml(res, 200, views.archivedStoriesPage({ user, stories }));
}

async function handleArchiveStory(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (story.author_id !== user.id) return sendError(res, 403, 'Only the story author can archive it.', user);
  models.archiveStory(storyId);
  logEvent(user, 'story-archived', { subject: story.title, href: `/stories/${storyId}`, storyId });
  redirect(res, `/stories/${storyId}`);
}

async function handleUnarchiveStory(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (story.author_id !== user.id) return sendError(res, 403, 'Only the story author can unarchive it.', user);
  models.unarchiveStory(storyId);
  logEvent(user, 'story-restored', { subject: story.title, href: `/stories/${storyId}`, storyId });
  redirect(res, '/archived-stories');
}

async function handleDeleteStory(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (story.author_id !== user.id) return sendError(res, 403, 'Only the story author can delete it.', user);
  if (!story.archived_at) return sendError(res, 400, 'Archive the story before deleting it forever.', user);
  models.deleteStoryForever(storyId);
  logEvent(user, 'story-deleted', { subject: story.title });
  redirect(res, '/archived-stories');
}

async function handleNewStoryPage(req, res, user) {
  sendHtml(res, 200, views.newStoryPage({ user, values: {}, groups: models.listTagsGrouped(), selectedTagIds: [] }));
}

async function handleNewStorySubmit(req, res, user) {
  const { fields: body, files } = await parseMultipartBody(req, UPLOAD_LIMIT_BYTES);
  const storyTitle = (body.storyTitle || '').trim();
  const storyDescription = (body.storyDescription || '').trim();
  const chapterTitle = (body.chapterTitle || '').trim();
  const chapterSummary = (body.chapterSummary || '').trim();
  let content = (body.content || '').replace(/\r\n/g, '\n');
  const values = { storyTitle, storyDescription, chapterTitle, chapterSummary, content };
  const tagIds = [...tagIdsFromBody(body), ...proposedTagIdsFromBody(body, user)];
  const retry = (error) => sendHtml(res, 400, views.newStoryPage({
    user, error, values, groups: models.listTagsGrouped(), selectedTagIds: tagIds,
  }));

  try {
    const uploaded = await extractUploadedText(files.file);
    if (uploaded !== null) { content = uploaded; values.content = content; }
  } catch (err) {
    return retry(err.message);
  }

  if (!storyTitle) return retry('Missing story title.');
  if (!chapterTitle) return retry('Missing chapter title.');
  if (!content.trim()) return retry('The chapter is empty. Paste some text or upload a .md/.txt/.docx file.');

  const { story, chapter } = models.createStoryWithFirstChapter({
    title: storyTitle, description: storyDescription, authorId: user.id,
    chapterTitle, chapterSummary, content,
  });
  models.setStoryTags(story.id, tagIds);
  logEvent(user, 'story-started', { subject: story.title, href: `/stories/${story.id}`, storyId: story.id });
  redirect(res, `/chapters/${chapter.id}`);
}

async function handleStoryPage(req, res, user, storyId, query) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  const since = query.get('since') || null;
  const chapters = models.listChaptersForStory(storyId, { since });
  const readersByChapter = models.readersForChapters(chapters.map((c) => c.id));
  const isStoryAuthor = user.id === story.author_id;
  // A coauthor writes in the story but doesn't own it: they get the "Add
  // chapter" button and the dictionary, not "Edit details" or "Archive".
  const canWrite = models.canWriteInStory(story, user);
  const dictionary = canWrite ? models.listStoryDictionaryEntries(storyId) : [];
  const notNames = canWrite ? models.listNotNames(storyId) : [];
  sendHtml(res, 200, views.storyPage({
    user, story, chapters, isStoryAuthor, canWrite, dictionary, notNames,
    following: models.isFollowing(user.id, storyId), followers: models.followerCount(storyId),
    stats: models.getStoryStats(storyId),
    readersByChapter,
    tags: models.getStoryTags(storyId),
    bibleCount: models.storyBibleCounts(storyId).total,
    bibleVisible: models.canReadBible(story, user),
    coauthors: models.listStoryCoauthors(storyId),
    addableCoauthors: isStoryAuthor ? models.listAddableCoauthors(story) : [],
    glossary: models.glossaryPageForStory(story),
  }));
}

// ---------- per-story spelling exceptions (used by the writing analyzer) ----------

// JSON, fetched once by public/js/writing-analyzer.js when a writing page
// loads, so it knows which "unknown" words to treat as already-approved
// for this particular story.
async function handleGetStoryDictionary(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendJson(res, 404, { error: 'Story not found' });
  if (!models.canWriteInStory(story, user)) return sendJson(res, 403, { error: 'Only the story\'s authors can see this.' });
  sendJson(res, 200, { words: models.getStoryDictionary(storyId) });
}

// Two ways in: the "Story dictionary" form on the story page (a normal
// HTML form submit, expects a redirect back) and the analyzer's "Add to
// dictionary" button on a spelling highlight (a fetch() call that expects
// a small JSON response instead) -- tell them apart by the Accept header
// the browser/script actually sent, rather than adding a second route.
async function handleAddStoryDictionaryWord(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  const wantsJson = (req.headers.accept || '').includes('application/json');
  if (!story) return wantsJson ? sendJson(res, 404, { error: 'Story not found' }) : sendError(res, 404, 'Story not found', user);
  if (!models.canWriteInStory(story, user)) {
    const message = "Only the story's authors can manage this.";
    return wantsJson ? sendJson(res, 403, { error: message }) : sendHtml(res, 403, message);
  }
  const body = await parseBody(req);
  const word = (body.word || '').trim();
  if (word) {
    models.addStoryDictionaryWord(storyId, word, user.id);
    logEvent(user, 'word-added', { subject: word, href: `/stories/${storyId}#dictionary`, storyId });
  }
  if (wantsJson) return sendJson(res, 200, { words: models.getStoryDictionary(storyId) });
  redirect(res, `/stories/${storyId}#dictionary`);
}

async function handleRemoveStoryDictionaryWord(req, res, user, storyId, entryId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (!models.canWriteInStory(story, user)) return sendError(res, 403, "Only the story's authors can manage this.", user);
  models.removeStoryDictionaryWord(storyId, entryId);
  logEvent(user, 'word-removed', { subject: story.title, href: `/stories/${storyId}#dictionary`, storyId });
  redirect(res, `/stories/${storyId}#dictionary`);
}

// ---------- coauthors ----------

// Only the owner hands out and takes back the right to write in their
// story. An admin is not exempt: admins run the site, they don't get a
// key to everyone's drafts.

async function handleAddCoauthor(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (story.author_id !== user.id) return sendError(res, 403, 'Only the story author can add coauthors.', user);
  const body = await parseBody(req);
  const userId = Number(body.userId);
  if (Number.isInteger(userId) && userId > 0) {
    models.addStoryCoauthor(storyId, userId, user.id);
    const added = models.getUserById(userId);
    logEvent(user, 'coauthor-added', {
      subject: added ? `${added.display_name} to ${story.title}` : story.title,
      href: `/stories/${storyId}#authors`, storyId,
    });
  }
  redirect(res, `/stories/${storyId}#authors`);
}

async function handleRemoveCoauthor(req, res, user, storyId, coauthorId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  // Somebody can also step back from a story they were added to, without
  // having to ask the owner to remove them.
  if (story.author_id !== user.id && coauthorId !== user.id) {
    return sendError(res, 403, 'Only the story author can remove a coauthor.', user);
  }
  const removed = models.getUserById(coauthorId);
  models.removeStoryCoauthor(storyId, coauthorId);
  logEvent(user, coauthorId === user.id ? 'coauthor-left' : 'coauthor-removed', {
    subject: coauthorId === user.id ? story.title : `${removed ? removed.display_name : 'somebody'} from ${story.title}`,
    href: `/stories/${storyId}`, storyId,
  });
  redirect(res, story.author_id === user.id ? `/stories/${storyId}#authors` : '/');
}

// The routes this file answers. server.js walks the tables in order
// and hands the first match a context: the request, the response, who is
// asking, the parsed URL and the regex groups.

// ---------- following a story ----------

// The star on a story. A form, so it works with nothing switched on; with
// a script (public/js/follow.js) it answers in JSON and the page stays put.
async function handleFollow(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  const wantsJson = (req.headers.accept || '').includes('application/json');
  if (!story) return wantsJson ? sendJson(res, 404, { error: 'Story not found' }) : sendError(res, 404, 'Story not found', user);
  const body = await parseBody(req);
  const on = String(body.follow) === '1';
  if (on) models.followStory(user.id, storyId);
  else models.unfollowStory(user.id, storyId);
  if (wantsJson) return sendJson(res, 200, { following: on, followers: models.followerCount(storyId) });
  const back = String(body.back || '');
  redirect(res, back.startsWith('/') && !back.startsWith('//') ? back : `/stories/${storyId}`);
}

/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['POST', /^\/stories\/(\d+)\/follow$/, (c) => handleFollow(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', '/archived-stories', (c) => handleArchivedStories(c.req, c.res, c.user)],
  ['GET', '/stories/new', (c) => handleNewStoryPage(c.req, c.res, c.user)],
  ['POST', '/stories/new', (c) => handleNewStorySubmit(c.req, c.res, c.user)],
  ['GET', /^\/stories\/(\d+)$/, (c) => handleStoryPage(c.req, c.res, c.user, Number(c.m[1]), c.url.searchParams)],
  ['GET', /^\/stories\/(\d+)\/edit$/, (c) => handleEditStoryPage(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/edit$/, (c) => handleEditStorySubmit(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/archive$/, (c) => handleArchiveStory(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/unarchive$/, (c) => handleUnarchiveStory(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/delete$/, (c) => handleDeleteStory(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/authors$/, (c) => handleAddCoauthor(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/authors\/(\d+)\/remove$/, (c) => handleRemoveCoauthor(c.req, c.res, c.user, Number(c.m[1]), Number(c.m[2]))],
  ['GET', /^\/stories\/(\d+)\/download\.(md|txt|docx|pdf|epub)$/, (c) => handleCompile(c.req, c.res, c.user, Number(c.m[1]), c.m[2], c.url.searchParams)],
  ['GET', /^\/stories\/(\d+)\/analysis$/, (c) => handleAnalysis(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', /^\/stories\/(\d+)\/timeline$/, (c) => handleTimeline(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', /^\/stories\/(\d+)\/outline$/, (c) => handleOutline(c.req, c.res, c.user, Number(c.m[1]), c.url.searchParams)],
  ['POST', /^\/stories\/(\d+)\/outline\/order$/, (c) => handleOutlineOrder(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', /^\/stories\/(\d+)\/dictionary$/, (c) => handleGetStoryDictionary(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/dictionary$/, (c) => handleAddStoryDictionaryWord(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/dictionary\/(\d+)\/delete$/, (c) => handleRemoveStoryDictionaryWord(c.req, c.res, c.user, Number(c.m[1]), Number(c.m[2]))],
];

module.exports = {
  handleAddCoauthor,
  handleAddStoryDictionaryWord,
  handleAnalysis,
  handleArchiveStory,
  handleArchivedStories,
  handleCompile,
  handleDeleteStory,
  handleEditStoryPage,
  handleEditStorySubmit,
  handleGetStoryDictionary,
  handleNewStoryPage,
  handleNewStorySubmit,
  handleOutline,
  handleOutlineOrder,
  handleRemoveCoauthor,
  handleRemoveStoryDictionaryWord,
  handleStoryPage,
  handleTimeline,
  handleUnarchiveStory,
  routes,
};
