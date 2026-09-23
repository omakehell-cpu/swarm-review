'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { parseMarkdown, renderHighlighted } = require('../lib/markdown');
const { parseBody, parseMultipartBody, sendHtml, sendJson, redirect } = require('../lib/util');
const fs = require('fs');
const models = require('../models');
const views = require('../views');
const storyBible = require('../lib/story-bible');
const entityImages = require('../lib/entity-images');
const { UPLOAD_LIMIT_BYTES, logEvent, sendError, sendFragment } = require('./shared');
// Reading is open to everybody who can read the story; writing is the same
// right as adding a chapter -- the owner and the coauthors -- so a reviewer
// cannot quietly rewrite who somebody is.

function bibleGuard(res, user, storyId, { write = false } = {}) {
  const story = models.getStoryById(storyId);
  if (!story) { sendError(res, 404, 'Story not found', user); return null; }
  if (write && !models.canWriteInStory(story, user)) {
    sendError(res, 403, "Only the story's authors can change its bible.", user);
    return null;
  }
  // A private bible is not a 404 -- pretending it does not exist would be
  // a lie about a button its story page does not show anyway.
  if (!models.canReadBible(story, user)) {
    sendError(res, 403, "This story's bible is private to the people who write it.", user);
    return null;
  }
  return story;
}

// The entry, its story, and whether this person may change it -- the three
// things every /bible/:id route needs before it can do anything.
function entityGuard(res, user, entityId, { write = false } = {}) {
  const entity = models.getStoryEntity(entityId);
  if (!entity) { sendError(res, 404, 'Not in this bible', user); return null; }
  const story = models.getStoryById(entity.story_id);
  if (!story) { sendError(res, 404, 'Story not found', user); return null; }
  const canWrite = models.canWriteInStory(story, user);
  if (write && !canWrite) {
    sendError(res, 403, "Only the story's authors can change its bible.", user);
    return null;
  }
  if (!models.canReadBible(story, user)) {
    sendError(res, 403, "This story's bible is private to the people who write it.", user);
    return null;
  }
  return { entity, story, canWrite };
}

async function handleBibleIndex(req, res, user, storyId, query) {
  const story = bibleGuard(res, user, storyId);
  if (!story) return;
  const kind = (query.get('kind') || '').trim();
  const q = (query.get('q') || '').trim().toLowerCase();
  const sort = Object.prototype.hasOwnProperty.call(models.ENTITY_SORTS, query.get('sort') || '')
    ? String(query.get('sort')) : 'name';
  const { counts, total } = models.storyBibleCounts(storyId);
  let entities = models.listStoryEntities(storyId, { kind: kind || undefined, sort });
  // The filter box does this in the page without a round trip; this is the
  // same filter for a browser with no JavaScript, and for a shared link.
  if (q) {
    entities = entities.filter((e) => `${e.name} ${e.summary} ${e.alias_list || ''}`.toLowerCase().includes(q));
  }
  sendHtml(res, 200, views.bibleIndexPage({
    user, story, entities, counts, total, kind, sort,
    canWrite: models.canWriteInStory(story, user),
    isOwner: story.author_id === user.id,
    conflicts: models.storyBibleNameConflicts(storyId),
    covers: models.coverImagesFor(storyId),
    notice: query.get('notice') || '',
  }));
}

async function handleNewEntityPage(req, res, user, storyId) {
  const story = bibleGuard(res, user, storyId, { write: true });
  if (!story) return;
  sendHtml(res, 200, views.entityFormPage({ user, story, ...entityFormExtras(storyId, null) }));
}

function entityFieldsFromBody(body) {
  return {
    kind: body.kind,
    name: body.name,
    summary: body.summary,
    description: body.description,
    secret: body.secret,
    status: body.status,
    role: body.role,
    aliases: storyBible.parseAliases(body.aliases || '', body.name || ''),
    // Template slots and free extras post the same pair of inputs, so
    // there is one code path and one set of rules for both.
    fields: storyBible.parseFields(body.fieldLabel, body.fieldValue),
    storyWhen: body.storyWhen,
    storyDay: body.storyDay,
  };
}

// Everything the entry form needs besides the entry itself.
function entityFormExtras(storyId, entity) {
  return {
    templates: models.fieldTemplatesByKind(storyId),
    usedLabels: models.listUsedFieldLabels(storyId),
    fields: entity ? models.listEntityFields(entity.id) : [],
    whens: models.listStoryWhens(storyId),
  };
}

// One click from a name in the prose to an entry in the bible. The entry
// it makes is a stub -- the name and what kind of thing it is -- because
// the name was the part that was stopping anybody, and everything else can
// be written when there is something to write.
async function handleQuickEntity(req, res, user, storyId) {
  const story = bibleGuard(res, user, storyId, { write: true });
  if (!story) return;
  const body = await parseBody(req);
  const name = storyBible.cleanName(body.name);
  // Where the click came from: a chapter, the editor, the bible itself.
  // Only ever a path inside this app -- never whatever the form was told.
  const back = /^\/[A-Za-z0-9/_?=&.-]*$/.test(String(body.returnTo || ''))
    ? String(body.returnTo) : `/stories/${storyId}/bible`;
  const wantsJson = (req.headers.accept || '').includes('application/json');
  if (!name) {
    return wantsJson ? sendJson(res, 400, { error: 'An entry needs a name.' }) : redirect(res, back);
  }
  const existing = models.getStoryEntityByName(storyId, name);
  if (existing) {
    return wantsJson
      ? sendJson(res, 200, { id: existing.id, name, already: true })
      : redirect(res, `/bible/${existing.id}`);
  }
  const entity = models.createStoryEntity({
    storyId, name, kind: body.kind, summary: body.summary, createdBy: user.id,
  });
  if (!entity) {
    return wantsJson ? sendJson(res, 400, { error: 'That entry could not be created.' }) : redirect(res, back);
  }
  logEvent(user, 'bible-entry-added', { subject: `${entity.name} (${story.title})`, href: `/bible/${entity.id}`, storyId });
  if (wantsJson) return sendJson(res, 200, { id: entity.id, name: entity.name, kind: entity.kind });
  redirect(res, back);
}

// The same question the chapter page answers, asked about a draft that has
// not been saved: the editor posts what is in the textarea and gets back
// the names nothing accounts for. One implementation of what counts as a
// name, rather than a second one in JavaScript drifting away from it.
// "Not a name": from the chapter page (a form, back where it came from),
// or from the editor's list of names in the draft (a fetch, JSON back).
async function handleNotName(req, res, user, storyId) {
  const story = bibleGuard(res, user, storyId, { write: true });
  if (!story) return;
  const body = await parseBody(req);
  const back = /^\/[A-Za-z0-9/_?=&.-]*$/.test(String(body.returnTo || ''))
    ? String(body.returnTo) : `/stories/${storyId}#not-names`;
  const wantsJson = (req.headers.accept || '').includes('application/json');
  const row = models.addNotName(storyId, body.name, user.id);
  if (wantsJson) return row ? sendJson(res, 200, { id: row.id, name: row.name }) : sendJson(res, 400, { error: 'Which word?' });
  redirect(res, back);
}

async function handleRemoveNotName(req, res, user, storyId, id) {
  const story = bibleGuard(res, user, storyId, { write: true });
  if (!story) return;
  models.removeNotName(storyId, id);
  redirect(res, `/stories/${storyId}#not-names`);
}

async function handleUnknownNames(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendJson(res, 404, { error: 'Story not found' });
  if (!models.canWriteInStory(story, user)) return sendJson(res, 403, { error: "Only the story's authors can see this." });
  const body = await parseBody(req);
  sendJson(res, 200, { names: models.missingNamesInText(storyId, String(body.text || '')) });
}

async function handleFieldTemplatePage(req, res, user, storyId) {
  const story = bibleGuard(res, user, storyId, { write: true });
  if (!story) return;
  sendHtml(res, 200, views.fieldTemplatePage({
    user, story, templates: models.fieldTemplatesByKind(storyId), notice: '',
  }));
}

async function handleFieldTemplateSubmit(req, res, user, storyId) {
  const story = bibleGuard(res, user, storyId, { write: true });
  if (!story) return;
  const body = await parseBody(req);
  for (const kind of storyBible.KINDS) {
    models.setFieldTemplate(storyId, kind, storyBible.parseFieldTemplate(body[kind] || ''));
  }
  sendHtml(res, 200, views.fieldTemplatePage({
    user, story, templates: models.fieldTemplatesByKind(storyId), notice: 'Saved.',
  }));
}

async function handleNewEntitySubmit(req, res, user, storyId) {
  const story = bibleGuard(res, user, storyId, { write: true });
  if (!story) return;
  const body = await parseBody(req);
  const fields = entityFieldsFromBody(body);
  if (!storyBible.cleanName(fields.name)) {
    return sendHtml(res, 400, views.entityFormPage({ user, story, ...entityFormExtras(storyId, null), error: 'An entry needs a name.' }));
  }
  // Two entries with one name would each claim the other's appearances, so
  // the uniqueness is the database's rule, not a nicety -- and this is the
  // sentence that explains it instead of a constraint error.
  if (models.getStoryEntityByName(storyId, fields.name)) {
    return sendHtml(res, 400, views.entityFormPage({
      user, story, ...entityFormExtras(storyId, null),
      error: `${storyBible.cleanName(fields.name)} is already in this bible.`,
    }));
  }
  const entity = models.createStoryEntity({ ...fields, storyId, createdBy: user.id });
  if (!entity) return sendError(res, 400, 'That entry could not be created.', user);
  logEvent(user, 'bible-entry-added', { subject: `${entity.name} (${story.title})`, href: `/bible/${entity.id}`, storyId });
  redirect(res, `/bible/${entity.id}`);
}

function renderEntity(res, user, entityId, error = '', status = 200) {
  const guard = entityGuard(res, user, entityId);
  if (!guard) return;
  const { entity, story, canWrite } = guard;
  sendHtml(res, status, views.entityPage({
    user, story, entity, canWrite, error,
    aliases: models.listEntityAliases(entityId),
    links: models.listStoryEntityLinks(entityId),
    appearances: models.listEntityAppearances(entityId),
    chapters: models.listChapterStubs(story.id),
    others: models.listStoryEntities(story.id).filter((e) => e.id !== entity.id),
    images: models.listEntityImages(entityId),
    fields: models.entityFieldsInOrder(entityId, story.id, entity.kind),
  }));
}

async function handleEntityPage(req, res, user, entityId) {
  renderEntity(res, user, entityId);
}

// ---------- pictures of a bible entry ----------

// The bytes live outside public/ and come back through this route, which
// means a picture of somebody's cast needs a session the same way the
// chapter they are in does.
async function handleEntityImage(req, res, user, imageId) {
  const image = models.getEntityImage(imageId);
  if (!image) return sendError(res, 404, 'No such image', user);
  // A picture is part of the bible it belongs to, and behind the same door.
  if (!models.canReadBible(models.getStoryById(image.entity_story_id), user)) {
    return sendError(res, 403, "This story's bible is private to the people who write it.", user);
  }
  const file = entityImages.imagePath(image.filename);
  if (!fs.existsSync(file)) return sendError(res, 404, 'That image is no longer on disk', user);
  res.writeHead(200, {
    'Content-Type': image.content_type,
    'Content-Length': fs.statSync(file).size,
    // The row is never rewritten in place -- a different picture is a
    // different row with a different id -- so this one can be cached hard.
    // Private, because it is behind a session.
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
}

async function handleAddEntityImage(req, res, user, entityId) {
  const guard = entityGuard(res, user, entityId, { write: true });
  if (!guard) return;
  const { entity, story } = guard;
  const { fields, files } = await parseMultipartBody(req, UPLOAD_LIMIT_BYTES);
  const existing = models.listEntityImages(entityId);
  if (existing.length >= entityImages.MAX_IMAGES_PER_ENTRY) {
    return renderEntity(res, user, entityId, `An entry holds up to ${entityImages.MAX_IMAGES_PER_ENTRY} pictures.`);
  }
  let saved;
  try {
    saved = entityImages.saveImage(files.image);
  } catch (err) {
    if (!err.userFacing) throw err;
    return renderEntity(res, user, entityId, err.message);
  }
  models.addEntityImage({
    entityId, storyId: story.id, caption: fields.caption, uploadedBy: user.id, ...saved,
  });
  logEvent(user, 'bible-image-added', { subject: `${entity.name} (${story.title})`, href: `/bible/${entityId}`, storyId: story.id });
  redirect(res, `/bible/${entityId}#pictures`);
}

async function handleEditEntityImage(req, res, user, entityId, imageId, action) {
  const guard = entityGuard(res, user, entityId, { write: true });
  if (!guard) return;
  const image = models.getEntityImage(imageId);
  // An image id from another entry's gallery is not this entry's to move.
  if (!image || image.entity_id !== entityId) return sendError(res, 404, 'No such image', user);
  if (action === 'delete') models.removeEntityImage(imageId);
  else if (action === 'up' || action === 'down') models.moveEntityImage(imageId, action);
  else if (action === 'focus') {
    const body = await parseBody(req);
    models.setEntityImageFocus(imageId, body.focusX, body.focusY);
  } else {
    const body = await parseBody(req);
    models.setEntityImageCaption(imageId, body.caption);
  }
  redirect(res, `/bible/${entityId}#pictures`);
}

async function handleEditEntityPage(req, res, user, entityId) {
  const guard = entityGuard(res, user, entityId, { write: true });
  if (!guard) return;
  sendHtml(res, 200, views.entityFormPage({
    user, story: guard.story, entity: guard.entity, aliases: models.listEntityAliases(entityId),
    ...entityFormExtras(guard.story.id, guard.entity),
  }));
}

async function handleEditEntitySubmit(req, res, user, entityId) {
  const guard = entityGuard(res, user, entityId, { write: true });
  if (!guard) return;
  const { entity, story } = guard;
  const body = await parseBody(req);
  const fields = entityFieldsFromBody(body);
  const aliases = models.listEntityAliases(entityId);
  if (!storyBible.cleanName(fields.name)) {
    return sendHtml(res, 400, views.entityFormPage({
      user, story, entity, aliases, ...entityFormExtras(story.id, entity), error: 'An entry needs a name.',
    }));
  }
  const clash = models.getStoryEntityByName(story.id, fields.name);
  if (clash && clash.id !== entity.id) {
    return sendHtml(res, 400, views.entityFormPage({
      user, story, entity, aliases, ...entityFormExtras(story.id, entity),
      error: `${storyBible.cleanName(fields.name)} is already in this bible.`,
    }));
  }
  const saved = models.updateStoryEntity({ ...fields, entityId, userId: user.id });
  if (!saved) return sendError(res, 400, 'That entry could not be saved.', user);
  logEvent(user, 'bible-entry-edited', { subject: `${saved.name} (${story.title})`, href: `/bible/${saved.id}`, storyId: story.id });
  redirect(res, `/bible/${saved.id}`);
}

async function handleDeleteEntity(req, res, user, entityId) {
  const guard = entityGuard(res, user, entityId, { write: true });
  if (!guard) return;
  const { entity, story } = guard;
  models.deleteStoryEntity(entityId);
  logEvent(user, 'bible-entry-deleted', { subject: `${entity.name} (${story.title})`, href: `/stories/${story.id}/bible`, storyId: story.id });
  redirect(res, `/stories/${story.id}/bible?notice=${encodeURIComponent(`${entity.name} is no longer in the bible.`)}`);
}

async function handleAddEntityLink(req, res, user, entityId) {
  const guard = entityGuard(res, user, entityId, { write: true });
  if (!guard) return;
  const body = await parseBody(req);
  models.setStoryEntityLink({
    storyId: guard.story.id,
    fromId: entityId,
    toId: Number(body.to),
    label: body.label,
    reverseLabel: body.reverse_label,
  });
  redirect(res, `/bible/${entityId}`);
}

async function handleRemoveEntityLink(req, res, user, entityId, linkId) {
  const guard = entityGuard(res, user, entityId, { write: true });
  if (!guard) return;
  models.removeStoryEntityLink(linkId, guard.story.id);
  redirect(res, `/bible/${entityId}`);
}

// The ticked boxes are the whole answer: a chapter the author ticked that
// the scan did not find is an 'include', one they unticked that it did
// find is an 'exclude', and anything they left the way the scan had it
// keeps no override at all -- so a later rewrite of that chapter is still
// free to change its mind.
async function handleSetEntityAppearances(req, res, user, entityId) {
  const guard = entityGuard(res, user, entityId, { write: true });
  if (!guard) return;
  const body = await parseBody(req);
  const ticked = new Set([].concat(body.chapter || []).map(Number).filter(Boolean));
  const scanned = new Set(models.listEntityAppearances(entityId)
    .filter((a) => a.source !== 'manual')
    .map((a) => a.chapter_id));
  for (const chapter of models.listChapterStubs(guard.story.id)) {
    if (chapter.archived_at) continue;
    const wanted = ticked.has(chapter.id);
    const found = scanned.has(chapter.id);
    const state = wanted === found ? 'auto' : (wanted ? 'include' : 'exclude');
    models.setAppearanceOverride({ entityId, chapterId: chapter.id, state, userId: user.id });
  }
  redirect(res, `/bible/${entityId}`);
}

// Whose call it is: the owner's. A coauthor writes in the bible, but
// whether it is anybody else's business is the story's to say, and the
// story has one owner.
async function handleBiblePrivacy(req, res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) return sendError(res, 404, 'Story not found', user);
  if (story.author_id !== user.id) {
    return sendError(res, 403, "Only the story's owner can change who sees its bible.", user);
  }
  const body = await parseBody(req);
  const isPrivate = body.visibility === 'private';
  models.setBiblePrivate(storyId, isPrivate);
  logEvent(user, isPrivate ? 'bible-closed' : 'bible-opened', {
    subject: story.title, href: `/stories/${storyId}/bible`, storyId,
  });
  redirect(res, `/stories/${storyId}/bible?notice=${encodeURIComponent(isPrivate
    ? 'The bible is now private to the people who write this story.'
    : 'The bible is now readable by everyone who can read the story.')}`);
}

async function handleRescanBible(req, res, user, storyId) {
  const story = bibleGuard(res, user, storyId, { write: true });
  if (!story) return;
  const { rows } = models.rebuildStoryAppearances(storyId);
  redirect(res, `/stories/${storyId}/bible?notice=${encodeURIComponent(`Chapters rescanned -- ${rows} appearance${rows === 1 ? '' : 's'} found.`)}`);
}

// What the beside panel is allowed to offer. A bible somebody has closed
// is closed here too: the panel is a shortcut to pages, not a way round
// the rules on them.
function besideCast(story, user) {
  if (!story || !models.canReadBible(story, user)) return [];
  return models.listStoryEntities(story.id);
}

function handleBesideEntity(req, res, user, entityId) {
  const entity = models.getStoryEntity(entityId);
  if (!entity) return sendError(res, 404, 'Entry not found', user);
  const story = models.getStoryById(entity.story_id);
  if (!story || !models.canReadBible(story, user)) return sendError(res, 403, 'This bible is private.', user);
  const html = views.besideEntityFragment(entity, {
    aliases: models.listEntityAliases(entityId),
    links: models.listStoryEntityLinks(entityId),
    // The first picture is the portrait -- "make this the portrait" on
    // the entry is "move it to the front", so there is nothing else to
    // ask here.
    image: models.listEntityImages(entityId)[0] || null,
    // The spoiler section is folded on the entry's own page and is left
    // out here entirely: this is a thing to glance at while writing, and
    // a glance is exactly how you spoil yourself.
    description: entity.description ? renderHighlighted(parseMarkdown(entity.description), [], null) : '',
  });
  sendFragment(res, html, entity.name);
}

// The routes this file answers. server.js walks the tables in order
// and hands the first match a context: the request, the response, who is
// asking, the parsed URL and the regex groups.
/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['GET', /^\/bible\/(\d+)\/beside$/, (c) => handleBesideEntity(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', /^\/stories\/(\d+)\/bible$/, (c) => handleBibleIndex(c.req, c.res, c.user, Number(c.m[1]), c.url.searchParams)],
  ['POST', /^\/stories\/(\d+)\/bible$/, (c) => handleNewEntitySubmit(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', /^\/stories\/(\d+)\/bible\/new$/, (c) => handleNewEntityPage(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/bible\/quick$/, (c) => handleQuickEntity(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/bible\/not-names$/, (c) => handleNotName(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/bible\/not-names\/(\d+)\/delete$/, (c) => handleRemoveNotName(c.req, c.res, c.user, Number(c.m[1]), Number(c.m[2]))],
  ['POST', /^\/stories\/(\d+)\/bible\/unknown-names$/, (c) => handleUnknownNames(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', /^\/stories\/(\d+)\/bible\/fields$/, (c) => handleFieldTemplatePage(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/bible\/fields$/, (c) => handleFieldTemplateSubmit(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/bible\/privacy$/, (c) => handleBiblePrivacy(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/bible\/rescan$/, (c) => handleRescanBible(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', /^\/bible\/(\d+)$/, (c) => handleEntityPage(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/bible\/(\d+)$/, (c) => handleEditEntitySubmit(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', /^\/bible\/(\d+)\/edit$/, (c) => handleEditEntityPage(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/bible\/(\d+)\/delete$/, (c) => handleDeleteEntity(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/bible\/(\d+)\/links$/, (c) => handleAddEntityLink(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/bible\/(\d+)\/links\/(\d+)\/delete$/, (c) => handleRemoveEntityLink(c.req, c.res, c.user, Number(c.m[1]), Number(c.m[2]))],
  ['GET', /^\/entity-images\/(\d+)$/, (c) => handleEntityImage(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/bible\/(\d+)\/images$/, (c) => handleAddEntityImage(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/bible\/(\d+)\/images\/(\d+)\/(delete|up|down|caption|focus)$/, (c) => handleEditEntityImage(c.req, c.res, c.user, Number(c.m[1]), Number(c.m[2]), c.m[3])],
  ['POST', /^\/bible\/(\d+)\/appearances$/, (c) => handleSetEntityAppearances(c.req, c.res, c.user, Number(c.m[1]))],
];

module.exports = {
  besideCast,
  bibleGuard,
  entityFieldsFromBody,
  entityFormExtras,
  entityGuard,
  handleAddEntityImage,
  handleAddEntityLink,
  handleBesideEntity,
  handleBibleIndex,
  handleBiblePrivacy,
  handleDeleteEntity,
  handleEditEntityImage,
  handleEditEntityPage,
  handleEditEntitySubmit,
  handleEntityImage,
  handleEntityPage,
  handleFieldTemplatePage,
  handleFieldTemplateSubmit,
  handleNewEntityPage,
  handleNewEntitySubmit,
  handleQuickEntity,
  handleRemoveEntityLink,
  handleRescanBible,
  handleSetEntityAppearances,
  handleUnknownNames,
  renderEntity,
  routes,
};
