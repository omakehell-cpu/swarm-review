'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { parseMarkdown, renderPlainText, renderHighlighted, flattenText } = require('../lib/markdown');
const { markdownToDocxBuffer } = require('../lib/docx');
const { noteAsWordText, readWordComments } = require('../lib/word-comments');
const { parseBody, parseMultipartBody, sendHtml, sendJson, redirect } = require('../lib/util');
const models = require('../models');
const views = require('../views');
const wiki = require('../lib/wiki');
const castLinks = require('../lib/cast-links');
const diff = require('../lib/diff');
const { besideCast } = require('./bible');
const { UPLOAD_LIMIT_BYTES, extractUploadedText, logEvent, sendError, sendFragment, slugForFilename, storyVocabulary } = require('./shared');
// A summary edited where it sits, on the outline. The same right as
// editing the chapter: its own author, or the story's.
async function handleChapterSummary(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  const wantsJson = (req.headers.accept || '').includes('application/json');
  if (!chapter) {
    return wantsJson ? sendJson(res, 404, { error: 'Chapter not found' }) : sendError(res, 404, 'Chapter not found', user);
  }
  if (chapter.author_id !== user.id && chapter.story_author_id !== user.id) {
    const message = 'Only the chapter author or the story author can change this.';
    return wantsJson ? sendJson(res, 403, { error: message }) : sendError(res, 403, message, user);
  }
  const body = await parseBody(req);
  const summary = String(body.summary || '').trim().slice(0, 1000);
  models.updateChapter({ chapterId, title: chapter.title, summary });
  if (wantsJson) return sendJson(res, 200, { summary });
  redirect(res, `/stories/${chapter.story_id}/outline?notice=${encodeURIComponent('Summary saved.')}`);
}

// ---------- help and the changelog (see lib/docs.js) ----------

async function handleArchivedChaptersForStory(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  const chapters = models.listChaptersForStory(storyId, { onlyArchived: true });
  sendHtml(res, 200, views.archivedChaptersPage({ user, story, chapters }));
}

async function handleArchiveChapter(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  if (chapter.author_id !== user.id) return sendError(res, 403, 'Only the chapter author can archive it.', user);
  models.archiveChapter(chapterId);
  logEvent(user, 'chapter-archived', { subject: chapter.title, href: `/stories/${chapter.story_id}`, storyId: chapter.story_id });
  redirect(res, `/stories/${chapter.story_id}`);
}

async function handleUnarchiveChapter(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  if (chapter.author_id !== user.id) return sendError(res, 403, 'Only the chapter author can unarchive it.', user);
  models.unarchiveChapter(chapterId);
  logEvent(user, 'chapter-restored', { subject: chapter.title, href: `/chapters/${chapterId}`, storyId: chapter.story_id, chapterId });
  redirect(res, `/stories/${chapter.story_id}/archived-chapters`);
}

async function handleDeleteChapter(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  if (chapter.author_id !== user.id) return sendError(res, 403, 'Only the chapter author can delete it.', user);
  if (!chapter.archived_at) return sendError(res, 400, 'Archive the chapter before deleting it forever.', user);
  const storyId = chapter.story_id;
  models.deleteChapterForever(chapterId);
  logEvent(user, 'chapter-deleted', { subject: chapter.title, href: `/stories/${storyId}`, storyId });
  redirect(res, `/stories/${storyId}/archived-chapters`);
}

async function handleNewChapterPage(req, res, user, storyId, query) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (!models.canWriteInStory(story, user)) return sendError(res, 403, "Only the story's authors can add chapters.", user);
  const chapters = models.listChaptersForStory(storyId);
  const slot = query && query.get('plan') ? models.getPlanSlot(Number(query.get('plan'))) : null;
  if (slot && slot.story_id === storyId && slot.draft_by && slot.draft_by !== user.id) {
    return sendError(res, 409, `${models.getUserById(slot.draft_by).display_name} is already writing this planned chapter. Their draft is theirs until they publish it.`, user);
  }
  sendHtml(res, 200, views.newChapterPage({
    user, story, chapters, values: slot && slot.story_id === storyId ? planValues(slot) : {}, vocabulary: storyVocabulary(storyId),
    castList: besideCast(story, user), notice: query ? (query.get('notice') || '').slice(0, 200) : '',
  }));
}

// Writing a chapter from the plan: its working title, and whatever draft
// its writer has saved so far, with the plan's notes and the arcs it is in
// beside the text -- the notes are the scaffold, not the chapter's summary.
function planValues(slot) {
  return {
    planSlot: slot.id,
    title: slot.title,
    content: slot.draft_content || '',
    position: models.planSlotPosition(slot.id),
    plan: { notes: slot.notes, arcs: models.arcsOfPlanSlot(slot), draftSavedAt: slot.draft_content ? slot.draft_updated_at : null },
  };
}

async function handleNewChapterSubmit(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (!models.canWriteInStory(story, user)) return sendError(res, 403, "Only the story's authors can add chapters.", user);

  const existingChapters = models.listChaptersForStory(storyId);
  const { fields: body, files } = await parseMultipartBody(req, UPLOAD_LIMIT_BYTES);
  const title = (body.title || '').trim();
  const summary = (body.summary || '').trim();
  const stage = body.stage;
  const arcTitle = (body.arcTitle || '').trim();
  const pov = (body.pov || '').trim();
  const strand = (body.strand || '').trim();
  const storyWhen = (body.storyWhen || '').trim();
  const storyDay = body.storyDay;
  let content = (body.content || '').replace(/\r\n/g, '\n');
  const slot = body.planSlot ? models.getPlanSlot(Number(body.planSlot)) : null;
  const fromPlan = slot && slot.story_id === storyId && (!slot.draft_by || slot.draft_by === user.id) ? slot : null;
  const values = { title, summary, content, position: body.position, stage, arcTitle, pov, strand, storyWhen, storyDay, ...(fromPlan ? { planSlot: fromPlan.id, plan: planValues(fromPlan).plan } : {}) };

  try {
    const uploaded = await extractUploadedText(files.file);
    if (uploaded !== null) { content = uploaded; values.content = content; }
  } catch (err) {
    return sendHtml(res, 400, views.newChapterPage({ user, story, chapters: existingChapters, error: err.message, values, vocabulary: storyVocabulary(storyId) }));
  }

  if (!title) return sendHtml(res, 400, views.newChapterPage({ user, story, chapters: existingChapters, error: 'Missing title.', values, vocabulary: storyVocabulary(storyId) }));
  // "Save draft" on a planned chapter: kept on the plan, private to whoever
  // is writing it, and not a chapter until it is published.
  if (fromPlan && body.intent === 'draft') {
    models.savePlanDraft(fromPlan.id, { userId: user.id, title, content });
    return redirect(res, `/stories/${storyId}/chapters/new?plan=${fromPlan.id}&notice=${encodeURIComponent('Draft saved. Only you can see it until you publish it.')}`);
  }
  if (!content.trim()) return sendHtml(res, 400, views.newChapterPage({ user, story, chapters: existingChapters, error: 'The chapter is empty. Paste some text or upload a .md/.txt/.docx file.', values, vocabulary: storyVocabulary(storyId) }));

  // "position" picks an existing chapter to insert *before*; anything else
  // (including the default "end" option, or a tampered/stale value that no
  // longer matches a real chapter) falls back to appending at the end,
  // exactly like before this feature existed.
  // A planned chapter goes where the plan has it now, which may have moved
  // since the editor was opened.
  const position = fromPlan ? models.planSlotPosition(fromPlan.id) : body.position;
  const insertBeforeNumber = existingChapters.some((c) => String(c.chapter_number) === position)
    ? Number(position)
    : null;

  const chapter = insertBeforeNumber !== null
    ? models.insertChapterAt({ storyId, position: insertBeforeNumber, title, summary, authorId: user.id, content, stage, arcTitle, pov, strand, storyWhen, storyDay })
    : models.createChapter({ storyId, title, summary, authorId: user.id, content, stage, arcTitle, pov, strand, storyWhen, storyDay });
  // Written from the plan: the planned chapter is this one now.
  if (fromPlan) models.planSlotWritten(fromPlan.id, chapter);
  if (arcTitle) {
    logEvent(user, 'arc-started', { subject: arcTitle, href: `/stories/${storyId}`, storyId, chapterId: chapter.id });
  }
  logEvent(user, 'chapter-added', {
    subject: `${title} (${story.title})`, href: `/chapters/${chapter.id}`, storyId, chapterId: chapter.id,
  });
  redirect(res, `/chapters/${chapter.id}`);
}

// Notes from a Word file: a reader who read the chapter in Word (perhaps
// downloaded with everybody's notes, see handleDownload) and commented
// there. Each Word comment becomes a note by whoever uploads the file, on
// the words it was on if those words are still in the current version,
// or on the chapter as a whole, quoting them, if not. Comments that are
// this site's own notes coming back (the download carries them) are left
// out, so nothing is said twice.
async function handleNotesFromWord(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  const { files } = await parseMultipartBody(req, UPLOAD_LIMIT_BYTES);
  const file = files.file;
  const back = (msg) => redirect(res, `/chapters/${chapterId}?notice=${encodeURIComponent(msg)}#notes`);
  if (!file || !file.buffer || !file.buffer.length) return back('Choose a Word file first.');
  if (!/\.docx$/i.test(file.filename || '')) return back('That is not a Word (.docx) file.');
  let found;
  try {
    found = await readWordComments(file.buffer);
  } catch (err) {
    return back('That file could not be read as a Word document.');
  }
  const version = models.getLatestVersion(chapterId);
  const existing = models.listCommentsForVersion(version.id);
  const ours = new Set(existing.filter((c) => c.parent_id == null).map((c) =>
    `${c.author_name}\u0000${noteAsWordText(c, existing.filter((r) => r.parent_id === c.id))}`.trim()));
  const flat = flattenText(parseMarkdown(version.content));
  let placed = 0;
  let loose = 0;
  for (const c of found) {
    if (ours.has(`${c.author}\u0000${c.text}`)) continue;
    const quoted = c.quoted.replace(/\s+/g, ' ').trim();
    const at = quoted ? flat.indexOf(quoted) : -1;
    const from = c.author && c.author !== user.display_name ? `(From ${c.author}, in Word) ` : '';
    if (at >= 0) {
      models.createComment({
        versionId: version.id, authorId: user.id, startOffset: at, endOffset: at + quoted.length,
        quotedText: quoted.slice(0, 1000), body: `${from}${c.text}`.slice(0, 4000),
      });
      placed += 1;
    } else {
      models.createComment({
        versionId: version.id, authorId: user.id,
        body: `${from}${quoted ? `On \u201c${quoted.slice(0, 200)}\u201d: ` : ''}${c.text}`.slice(0, 4000),
      });
      loose += 1;
    }
  }
  if (placed + loose) {
    logEvent(user, 'notes-from-word', { subject: chapter.title, href: `/chapters/${chapterId}`, storyId: chapter.story_id, chapterId });
  }
  const said = placed + loose === 0
    ? 'That file had no comments that are not already here.'
    : `${placed + loose} note${placed + loose === 1 ? '' : 's'} added from Word${loose ? `; ${loose} on the chapter as a whole, because their words are no longer in it` : ''}.`;
  return back(said);
}

// One reaction on one paragraph, switched on or off by a reader (see
// models/reactions.js and public/js/reactions.js). Not by the author: a
// writer's own "hooked" is not news.
async function handleReaction(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  if (chapter.author_id === user.id) return sendJson(res, 403, { error: 'Reactions are for readers.' });
  const body = await parseBody(req);
  const version = models.getVersion(Number(body.versionId));
  if (!version || version.chapter_id !== chapterId) return sendJson(res, 400, { error: 'No such version.' });
  const ok = models.setReaction({
    versionId: version.id, userId: user.id, paragraph: Number(body.paragraph), kind: String(body.kind || ''), on: body.on === '1',
  });
  return sendJson(res, ok ? 200 : 400, { ok });
}

// Where the reader has got to, sent by the page as they read and when
// they leave (see reading.js). Anybody who can read the chapter can keep
// their own place in it; nothing else is written.
async function handleReadingPlace(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  const body = await parseBody(req);
  models.saveReadingPlace(user.id, chapterId, Number(body.paragraph) || 0, Number(body.total) || 0);
  res.writeHead(204);
  res.end();
}

async function handleChapterPage(req, res, user, chapterId, query) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);

  const versions = models.listVersions(chapterId); // desc by version_number
  if (!versions.length) return sendError(res, 404, 'This chapter has no versions', user);

  let currentVersion;
  const requestedV = query.get('v');
  if (requestedV) {
    currentVersion = models.getVersionByNumber(chapterId, Number(requestedV));
  }
  if (!currentVersion) currentVersion = versions[0]; // latest

  const comments = models.listCommentsForVersion(currentVersion.id);
  const isChapterAuthor = user.id === chapter.author_id;

  // Opening somebody else's chapter is what counts as reading it. Not the
  // author's own: "read by the person who wrote it" tells nobody anything.
  if (!isChapterAuthor && models.markChapterRead(chapterId, user.id, currentVersion.version_number)) {
    logEvent(user, 'chapter-read', {
      subject: chapter.title, href: `/chapters/${chapterId}`, storyId: chapter.story_id, chapterId,
    });
  }

  const story = models.getStoryById(chapter.story_id);
  const bibleVisible = models.canReadBible(story, user);
  // Straight back from "Apply change": say so once, in the column.
  const appliedId = Number(query.get('applied') || 0);
  const appliedNote = appliedId ? models.getCommentById(appliedId) : null;
  sendHtml(res, 200, views.chapterPage({
    user, chapter, versions, currentVersion, comments, isChapterAuthor,
    // Writing the next chapter is a story-level right, not a chapter-level
    // one: a coauthor can add chapters to a story whose other chapters
    // they cannot touch.
    canWrite: models.canWriteInStory(story, user),
    neighbours: models.getChapterNeighbours(chapter),
    readers: models.listChapterReaders(chapterId),
    // A private bible leaks through its chapter just as easily: the names
    // in the margin, the links in the prose, and what each one is. So when
    // it is private, a reader gets the chapter the way they did before any
    // of this existed.
    cast: bibleVisible ? models.listChapterEntities(chapterId) : [],
    // Somebody the author has said is not in this chapter is not linked
    // in it either: the word is theirs, the person is not.
    findMatches: bibleVisible
      ? castLinks.combinedMatcher(chapter.story_id, wiki.findWikiMatches, models.listChapterExclusions(chapterId))
      : wiki.findWikiMatches,
    missingNames: models.canWriteInStory(story, user) ? models.missingNamesInChapter(chapterId) : [],
    // Which arcs of the plan this chapter is in, for the people who write
    // it: the plan is theirs, and a smaller arc's name can be a spoiler.
    arcs: models.canWriteInStory(story, user) ? models.arcsOfChapter(chapter) : [],
    entities: bibleVisible ? models.listStoryEntities(chapter.story_id) : [],
    leftBehind: models.notesLeftBehind(chapterId),
    appliedFrom: appliedNote && appliedNote.suggestion != null ? appliedNote.author_name : null,
    // Only on the current version: a place in an old draft is not a place.
    place: currentVersion.id === versions[0].id ? models.readingPlace(user.id, chapterId) : null,
    mentionable: models.listMentionable().filter((p) => p.username !== user.username),
    notice: (query.get('notice') || '').slice(0, 300),
    // The star, for a reader: not on your own story.
    following: models.canWriteInStory(story, user) ? null : models.isFollowing(user.id, chapter.story_id),
    reactions: isChapterAuthor
      ? { mode: 'author', versionId: currentVersion.id, map: models.reactionMap(currentVersion.id) }
      : { mode: 'reader', versionId: currentVersion.id, mine: models.myReactions(currentVersion.id, user.id) },
    reviewHtml: views.reviewBlock({
      chapter, isChapterAuthor,
      requests: models.listReviewRequestsForChapter(chapterId),
      mine: models.getOpenReviewRequest(chapterId, user.id),
      people: isChapterAuthor ? models.listPeopleToAsk(user.id) : [],
    }),
  }));
}

async function handleChapterDiff(req, res, user, chapterId, query) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  const versions = models.listVersions(chapterId); // newest first
  if (versions.length < 2) {
    // Not a bad request: a chapter nobody has revised yet is the normal
    // state of a new chapter, and the page returned says so. 200 keeps it
    // out of the error logs and out of Cloudflare's 4xx handling.
    return sendHtml(res, 200, views.diffUnavailablePage({ user, chapter }));
  }

  // Default to the most recent pair, which is the comparison anyone
  // opening this page almost always wants.
  const pick = (param, fallback) => {
    const wanted = Number(query.get(param));
    return versions.find((v) => v.version_number === wanted) || fallback;
  };
  const toVersion = pick('to', versions[0]);
  const fromVersion = pick('from', versions.find((v) => v.version_number < toVersion.version_number) || versions[versions.length - 1]);

  // Compare the prose, not the source. Diffing the raw Markdown puts
  // "**Kestrel Anchorage**" and "> " on the page, which is not what the
  // author wrote or what a reader would see, and it reports a word as
  // changed when only its emphasis moved.
  const readable = (version) => renderPlainText(parseMarkdown(version.content), { quoteMarker: '' });
  const blocks = diff.diffVersions(readable(fromVersion), readable(toVersion));
  const summary = diff.summarizeDiff(blocks);
  sendHtml(res, 200, views.chapterDiffPage({
    user, chapter, versions, fromVersion, toVersion, blocks, summary,
    // The prose can be word for word the same while the source isn't --
    // somebody bolded a name, or fixed a link. Worth saying so rather than
    // showing an empty page that looks like the diff is broken.
    formattingOnly: summary.identical && fromVersion.content !== toVersion.content,
  }));
}

async function handleEditChapterPage(req, res, user, chapterId, query) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  // Deliberately the chapter's author, not the story's: being a coauthor
  // lets you write your own chapters, not rewrite somebody else's.
  if (chapter.author_id !== user.id) return sendError(res, 403, 'Only the chapter author can edit it.', user);
  const latest = models.getLatestVersion(chapterId);
  // Existing comments are shown alongside the edit form purely as
  // reference while writing (see views.js's editChapterPage) -- they stay
  // anchored to this current latest version regardless of what happens to
  // the text from here.
  const comments = latest ? models.listCommentsForVersion(latest.id) : [];
  // An unpublished draft is opened instead of the published text: it is
  // the newer of the two, it is the author's own, and it is what they
  // were in the middle of. The page says so, and offers the way back.
  const draft = models.getDraft(chapterId, user.id);
  const liveDraft = draft && latest && (draft.content !== latest.content || draft.title !== chapter.title) ? draft : null;
  if (draft && !liveDraft) models.discardDraft(chapterId, user.id);
  const values = liveDraft ? { title: liveDraft.title || chapter.title, summary: liveDraft.summary, content: liveDraft.content } : {};
  sendHtml(res, 200, views.editChapterPage({
    user, chapter, latestContent: latest ? latest.content : '', comments, values,
    draft: liveDraft, justDrafted: query.get('drafted') === '1',
    desk: {
      chapterId,
      notes: models.listSceneNotes(chapterId),
      snapshots: models.listSnapshots(chapterId).map((sn) => ({ id: sn.id, name: sn.name, words: sn.word_count, at: sn.created_at })),
      today: models.writingStreak(user.id, user.daily_goal).today,
      goal: user.daily_goal || 0,
    },
    canWrite: models.canWriteInStory(models.getStoryById(chapter.story_id), user),
    latestVersionNumber: liveDraft ? liveDraft.base_version : (latest ? latest.version_number : 0),
    publishedVersionNumber: latest ? latest.version_number : 0,
    vocabulary: storyVocabulary(chapter.story_id),
    siblings: models.listChaptersForStory(chapter.story_id),
    castList: besideCast(models.getStoryById(chapter.story_id), user),
  }));
}

// The two fragments the panel loads. Each one is the page that already
// exists with the furniture taken off, behind the same guard as the page
// itself -- so there is nothing here that a plain link would not give.
function handleBesideChapter(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter || chapter.archived_at) return sendError(res, 404, 'Chapter not found', user);
  const latest = models.getLatestVersion(chapterId);
  const story = models.getStoryById(chapter.story_id);
  // The matcher is the third argument, not something applied to the AST
  // first -- and a closed bible is closed here too, so the names in the
  // prose stop linking the way they do on the chapter page itself.
  const bibleVisible = models.canReadBible(story, user);
  const html = renderHighlighted(
    parseMarkdown(latest ? latest.content : ''),
    [],
    bibleVisible ? castLinks.combinedMatcher(chapter.story_id, wiki.findWikiMatches, models.listChapterExclusions(chapterId)) : wiki.findWikiMatches
  );
  sendFragment(res, views.besideChapterFragment(chapter, html), story ? `${chapter.chapter_number}. ${chapter.title}` : chapter.title);
}

async function handleEditChapterSubmit(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  if (chapter.author_id !== user.id) return sendError(res, 403, 'Only the chapter author can edit it.', user);

  const { fields: body, files } = await parseMultipartBody(req, UPLOAD_LIMIT_BYTES);
  const title = (body.title || '').trim();
  const summary = (body.summary || '').trim();
  let content = (body.content || '').replace(/\r\n/g, '\n');
  const changelog = (body.changelog || '').trim();
  const stage = body.stage;
  const arcTitle = (body.arcTitle || '').trim();
  const pov = (body.pov || '').trim();
  const strand = (body.strand || '').trim();
  const storyWhen = (body.storyWhen || '').trim();
  const storyDay = body.storyDay;
  const values = { title, summary, content, changelog, stage, arcTitle, pov, strand, storyWhen, storyDay };
  const latest = models.getLatestVersion(chapterId);
  // The version this editor was opened on. A form from before this field
  // existed, or one a script posted, sends nothing -- and an absent answer
  // is not a stale one, so it is let through rather than blocked.
  const baseVersion = Number(body.baseVersion || 0);

  // "Upload and publish" is its own button, so pressing it with nothing
  // chosen is a question, not a save: without this the form would go
  // through as an ordinary save of a chapter nobody meant to save.
  const askedToUpload = body.upload === '1';
  const sameAgain = (message) => sendHtml(res, 400, views.editChapterPage({
    user, chapter, latestContent: latest ? latest.content : '', error: message, values,
    latestVersionNumber: baseVersion || (latest ? latest.version_number : 0),
    vocabulary: storyVocabulary(chapter.story_id),
  }));

  try {
    const uploaded = await extractUploadedText(files.file);
    if (uploaded !== null) { content = uploaded; values.content = content; }
    else if (askedToUpload) return sameAgain('Choose a .md, .txt or .docx file first -- nothing was uploaded, so nothing was saved.');
  } catch (err) {
    return sameAgain(err.message);
  }

  // "Save draft": kept for the author, not published. Nothing below this
  // point -- versions, notes following the text, the log -- happens.
  if (body.intent === 'draft') {
    if (content.trim()) {
      models.saveDraft({ chapterId, userId: user.id, title: title || chapter.title, summary, content, baseVersion: baseVersion || (latest ? latest.version_number : 0) });
    }
    return redirect(res, `/chapters/${chapterId}/edit?drafted=1`);
  }

  if (!title) {
    return sendHtml(res, 400, views.editChapterPage({ user, chapter, latestContent: latest ? latest.content : '', error: 'Missing title.', values, latestVersionNumber: baseVersion || (latest ? latest.version_number : 0) }));
  }
  if (!content.trim()) {
    return sendHtml(res, 400, views.editChapterPage({
      user, chapter, latestContent: latest ? latest.content : '', values,
      error: 'The chapter text cannot be empty. Paste some text or upload a .md/.txt/.docx file.',
      latestVersionNumber: baseVersion || (latest ? latest.version_number : 0),
      vocabulary: storyVocabulary(chapter.story_id),
    }));
  }

  // Somebody else saved while this editor was open (or you did, in
  // another tab). Their work is in the database and yours is in your
  // hands, and writing yours over theirs without a word is the one thing
  // that must not happen. So: refuse once, show what arrived, and keep
  // every character of what was typed here. The hidden field moves on to
  // their version, so pressing save again is a decision rather than an
  // accident.
  const stale = baseVersion && latest && latest.version_number !== baseVersion
    && content.trim() !== String(latest.content || '').trim();
  if (stale) {
    return sendHtml(res, 409, views.editChapterPage({
      user, chapter, latestContent: latest.content, values,
      canWrite: models.canWriteInStory(models.getStoryById(chapter.story_id), user),
      vocabulary: storyVocabulary(chapter.story_id),
      conflict: {
        version: latest.version_number,
        at: latest.created_at,
        changelog: latest.changelog,
        content: latest.content,
      },
    }));
  }

  const { version } = models.editChapter({ chapterId, title, summary, content, changelog, stage, arcTitle, pov, strand, storyWhen, storyDay });
  // Published: whatever draft there was is now the chapter.
  models.discardDraft(chapterId, user.id);
  if (stage && stage !== chapter.stage) {
    logEvent(user, 'stage-changed', { subject: `${title}: ${stage}`, href: `/chapters/${chapterId}`, storyId: chapter.story_id, chapterId });
  }
  if (arcTitle !== (chapter.arc_title || '')) {
    logEvent(user, arcTitle ? 'arc-started' : 'arc-removed', {
      subject: arcTitle || chapter.arc_title, href: `/stories/${chapter.story_id}`, storyId: chapter.story_id, chapterId,
    });
  }
  // Saving without changing a word is an edit to the title or the
  // summary, not a new draft of the chapter -- the log says which.
  logEvent(user, version ? 'chapter-revised' : 'chapter-edited', {
    subject: version ? `${title} (v${version.version_number})` : title,
    href: `/chapters/${chapterId}`, storyId: chapter.story_id, chapterId,
  });
  redirect(res, version ? `/chapters/${chapterId}?v=${version.version_number}` : `/chapters/${chapterId}`);
}

// The editor's quiet save, every little while and when the tab is put
// away: a draft on the server, so it is there on the other device too.
// Answers in JSON, because nobody is looking at the answer.
async function handleSaveDraft(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendJson(res, 404, { error: 'Chapter not found' });
  if (chapter.author_id !== user.id) return sendJson(res, 403, { error: 'Only the chapter author can keep a draft of it.' });
  const body = await parseBody(req);
  const content = String(body.content || '').replace(/\r\n/g, '\n');
  if (!content.trim()) return sendJson(res, 400, { error: 'An empty draft is not kept.' });
  const latest = models.getLatestVersion(chapterId);
  if (latest && content === latest.content && (body.title || chapter.title) === chapter.title) {
    // Back to exactly what is published: there is no draft any more.
    models.discardDraft(chapterId, user.id);
    return sendJson(res, 200, { ok: true, draft: false });
  }
  const draft = models.saveDraft({
    chapterId, userId: user.id, title: (body.title || chapter.title).trim(), summary: body.summary || '',
    content, baseVersion: Number(body.baseVersion) || (latest ? latest.version_number : 0),
  });
  sendJson(res, 200, { ok: true, draft: true, at: draft.updated_at });
}

async function handleDiscardDraft(req, res, user, chapterId) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  if (chapter.author_id !== user.id) return sendError(res, 403, 'Only the chapter author can do that.', user);
  models.discardDraft(chapterId, user.id);
  redirect(res, `/chapters/${chapterId}/edit`);
}

async function handleMoveChapter(req, res, user, chapterId, direction) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  if (chapter.story_author_id !== user.id) return sendError(res, 403, 'Only the story author can reorder chapters.', user);
  models.moveChapter(chapterId, direction);
  logEvent(user, 'chapter-moved', { subject: chapter.title, href: `/chapters/${chapterId}`, storyId: chapter.story_id, chapterId });
  redirect(res, `/stories/${chapter.story_id}`);
}

async function handleDownload(req, res, user, chapterId, format, query) {
  const chapter = models.getChapterById(chapterId);
  if (!chapter) return sendError(res, 404, 'Chapter not found', user);
  const versions = models.listVersions(chapterId);
  if (!versions.length) return sendError(res, 404, 'This chapter has no versions', user);

  let version;
  const requestedV = query.get('v');
  if (requestedV) version = models.getVersionByNumber(chapterId, Number(requestedV));
  if (!version) version = versions[0];

  logEvent(user, 'downloaded', {
    subject: `${chapter.title} as .${format}`, href: `/chapters/${chapterId}`, storyId: chapter.story_id, chapterId,
  });

  const filename = `${slugForFilename(chapter.title)}-v${version.version_number}${query.get('notes') === '1' ? '-with-notes' : ''}.${format}`;
  const disposition = `attachment; filename="${filename}"`;

  if (format === 'md') {
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': disposition });
    return res.end(version.content);
  }
  if (format === 'txt') {
    const text = renderPlainText(parseMarkdown(version.content));
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': disposition });
    return res.end(text);
  }
  if (format === 'docx') {
    // With ?notes=1, the notes on this version come along as Word
    // comments, each on its own words, replies included.
    let notes = [];
    if (query.get('notes') === '1') {
      const all = models.listCommentsForVersion(version.id);
      notes = all.filter((c) => c.parent_id == null && !c.deleted_at).map((c) => ({
        start: c.start_offset, end: c.end_offset, author: c.author_name, date: c.created_at,
        text: noteAsWordText(c, all.filter((r) => r.parent_id === c.id)),
      }));
    }
    const buffer = await markdownToDocxBuffer({ title: chapter.title, markdownSource: version.content, notes });
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': disposition,
      'Content-Length': buffer.length,
    });
    return res.end(buffer);
  }
  sendError(res, 400, 'Unsupported download format', user);
}

// The routes this file answers. server.js walks the tables in order
// and hands the first match a context: the request, the response, who is
// asking, the parsed URL and the regex groups.
/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['GET', '/changelog', (c) => redirect(c.res, '/help/changelog')],
  ['GET', /^\/stories\/(\d+)\/archived-chapters$/, (c) => handleArchivedChaptersForStory(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', /^\/chapters\/(\d+)\/beside$/, (c) => handleBesideChapter(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/chapters\/(\d+)\/notes-from-word$/, (c) => handleNotesFromWord(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/chapters\/(\d+)\/react$/, (c) => handleReaction(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/chapters\/(\d+)\/place$/, (c) => handleReadingPlace(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/chapters\/(\d+)\/summary$/, (c) => handleChapterSummary(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', /^\/stories\/(\d+)\/chapters\/new$/, (c) => handleNewChapterPage(c.req, c.res, c.user, Number(c.m[1]), c.url.searchParams)],
  ['POST', /^\/stories\/(\d+)\/chapters\/new$/, (c) => handleNewChapterSubmit(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', /^\/chapters\/(\d+)$/, (c) => handleChapterPage(c.req, c.res, c.user, Number(c.m[1]), c.url.searchParams)],
  ['GET', /^\/chapters\/(\d+)\/versions\/new$/, (c) => redirect(c.res, `/chapters/${c.m[1]}/edit`)],
  ['GET', /^\/chapters\/(\d+)\/diff$/, (c) => handleChapterDiff(c.req, c.res, c.user, Number(c.m[1]), c.url.searchParams)],
  ['GET', /^\/chapters\/(\d+)\/edit$/, (c) => handleEditChapterPage(c.req, c.res, c.user, Number(c.m[1]), c.url.searchParams)],
  ['POST', /^\/chapters\/(\d+)\/edit$/, (c) => handleEditChapterSubmit(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/chapters\/(\d+)\/draft$/, (c) => handleSaveDraft(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/chapters\/(\d+)\/draft\/discard$/, (c) => handleDiscardDraft(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/chapters\/(\d+)\/move-up$/, (c) => handleMoveChapter(c.req, c.res, c.user, Number(c.m[1]), 'up')],
  ['POST', /^\/chapters\/(\d+)\/move-down$/, (c) => handleMoveChapter(c.req, c.res, c.user, Number(c.m[1]), 'down')],
  ['POST', /^\/chapters\/(\d+)\/archive$/, (c) => handleArchiveChapter(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/chapters\/(\d+)\/unarchive$/, (c) => handleUnarchiveChapter(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/chapters\/(\d+)\/delete$/, (c) => handleDeleteChapter(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', /^\/chapters\/(\d+)\/download\.(md|txt|docx)$/, (c) => handleDownload(c.req, c.res, c.user, Number(c.m[1]), c.m[2], c.url.searchParams)],
];

module.exports = {
  handleArchiveChapter,
  handleArchivedChaptersForStory,
  handleBesideChapter,
  handleChapterDiff,
  handleChapterPage,
  handleChapterSummary,
  handleDeleteChapter,
  handleDownload,
  handleEditChapterPage,
  handleEditChapterSubmit,
  handleMoveChapter,
  handleNewChapterPage,
  handleNewChapterSubmit,
  handleUnarchiveChapter,
  routes,
};
