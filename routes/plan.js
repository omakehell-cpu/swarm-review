'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { parseBody, redirect, sendHtml } = require('../lib/util');
const models = require('../models');
const views = require('../views');
const { sendError } = require('./shared');

// The plan is the writers' own working space -- chapters that do not exist
// yet, arcs that say where the story is going -- so it is for the people
// who write the story, and nobody else sees it: a plan is a spoiler.
function loadStory(res, user, storyId) {
  const story = models.getStoryById(storyId);
  if (!story) { sendError(res, 404, 'Story not found', user); return null; }
  if (!models.canWriteInStory(story, user)) { sendError(res, 403, 'The plan is for the people who write this story.', user); return null; }
  return story;
}

const back = (res, storyId, notice, anchor = '') => redirect(res, `/stories/${storyId}/plan?notice=${encodeURIComponent(notice)}${anchor}`);

function renderPlan(res, user, story, status = 200, extra = {}) {
  sendHtml(res, status, views.planPage({
    user, story, plan: models.storyPlan(story.id), canWrite: true, ...extra,
  }));
}

async function handlePlan(req, res, user, storyId, query) {
  const story = loadStory(res, user, storyId);
  if (story) renderPlan(res, user, story, 200, { notice: (query.get('notice') || '').slice(0, 300) });
}

async function handleAddSlot(req, res, user, storyId) {
  const story = loadStory(res, user, storyId);
  if (!story) return;
  const body = await parseBody(req);
  const result = models.addPlanSlot({ storyId, title: body.title, notes: body.notes, afterRef: body.afterRef || '', userId: user.id });
  if (result.error) {
    return renderPlan(res, user, story, 400, { error: result.error, values: { slotTitle: body.title, slotNotes: body.notes, afterRef: body.afterRef } });
  }
  back(res, storyId, 'Planned.', `#plan-p${result.id}`);
}

// A whole outline pasted in: a planned chapter for each line.
async function handleAddOutline(req, res, user, storyId) {
  const story = loadStory(res, user, storyId);
  if (!story) return;
  const body = await parseBody(req);
  const result = models.addPlanSlots({ storyId, text: body.outline, afterRef: body.afterRef || '', userId: user.id });
  if (result.error) return renderPlan(res, user, story, 400, { error: result.error, values: { outline: body.outline } });
  const n = result.ids.length;
  back(res, storyId, `${n} chapter${n === 1 ? '' : 's'} planned.`, `#plan-p${result.ids[0]}`);
}

const arcFields = (body) => ({
  title: body.title, parentId: body.parentId ? Number(body.parentId) : null, startRef: body.startRef || '',
  endRef: body.endRef || '', summary: body.summary, change: body.change_text, purpose: body.purpose,
});
const arcValues = (body) => ({
  title: body.title, parentId: body.parentId, startRef: body.startRef, endRef: body.endRef,
  summary: body.summary, change_text: body.change_text, purpose: body.purpose,
});

async function handleAddArc(req, res, user, storyId) {
  const story = loadStory(res, user, storyId);
  if (!story) return;
  const body = await parseBody(req);
  const result = models.addArc({ storyId, ...arcFields(body) });
  if (result.error) return renderPlan(res, user, story, 400, { error: result.error, values: { arc: arcValues(body) } });
  back(res, storyId, 'Arc added.', `#arc-${result.id}`);
}

// An arc or a planned chapter by its own id, and the story it is in --
// which is what the permission is about.
function loadArc(res, user, arcId) {
  const arc = models.getArc(arcId);
  if (!arc) { sendError(res, 404, 'There is no such arc.', user); return null; }
  const story = loadStory(res, user, arc.story_id);
  return story ? { arc, story } : null;
}
function loadSlot(res, user, slotId) {
  const slot = models.getPlanSlot(slotId);
  if (!slot) { sendError(res, 404, 'There is no such planned chapter.', user); return null; }
  const story = loadStory(res, user, slot.story_id);
  if (!story) return null;
  // Somebody else's draft is theirs until they publish it: nobody else
  // renames it, moves it or throws it away.
  if (slot.draft_content && slot.draft_by && slot.draft_by !== user.id) {
    sendError(res, 409, 'Somebody else is writing this planned chapter. It is theirs until they publish it.', user);
    return null;
  }
  return { slot, story };
}

async function handleArcPage(req, res, user, arcId) {
  const found = loadArc(res, user, arcId);
  if (found) sendHtml(res, 200, views.planArcPage({ user, ...found, plan: models.storyPlan(found.story.id) }));
}

async function handleEditArc(req, res, user, arcId) {
  const found = loadArc(res, user, arcId);
  if (!found) return;
  const body = await parseBody(req);
  const result = models.updateArc({ arcId, ...arcFields(body) });
  if (result.error) {
    return sendHtml(res, 400, views.planArcPage({ user, ...found, plan: models.storyPlan(found.story.id), error: result.error, values: arcValues(body) }));
  }
  back(res, found.story.id, 'Arc saved.', `#arc-${arcId}`);
}

async function handleDeleteArc(req, res, user, arcId) {
  const found = loadArc(res, user, arcId);
  if (!found) return;
  models.deleteArc(arcId);
  back(res, found.story.id, `${found.arc.title} is out of the plan.`);
}

async function handleSlotPage(req, res, user, slotId) {
  const found = loadSlot(res, user, slotId);
  if (found) sendHtml(res, 200, views.planSlotPage({ user, ...found }));
}

async function handleEditSlot(req, res, user, slotId) {
  const found = loadSlot(res, user, slotId);
  if (!found) return;
  const body = await parseBody(req);
  const result = models.updatePlanSlot({ slotId, title: body.title, notes: body.notes });
  if (result.error) return sendHtml(res, 400, views.planSlotPage({ user, ...found, error: result.error }));
  back(res, found.story.id, 'Saved.', `#plan-p${slotId}`);
}

async function handleDeleteSlot(req, res, user, slotId) {
  const found = loadSlot(res, user, slotId);
  if (!found) return;
  models.deletePlanSlot(slotId);
  back(res, found.story.id, `${found.slot.title} is out of the plan.`);
}

async function handleMoveSlot(req, res, user, slotId) {
  const found = loadSlot(res, user, slotId);
  if (!found) return;
  const body = await parseBody(req);
  models.movePlanSlot(slotId, body.direction === 'up' ? 'up' : 'down');
  back(res, found.story.id, 'Moved.', `#plan-p${slotId}`);
}

/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['GET', /^\/stories\/(\d+)\/plan$/, (c) => handlePlan(c.req, c.res, c.user, Number(c.m[1]), c.url.searchParams)],
  ['POST', /^\/stories\/(\d+)\/plan\/slots$/, (c) => handleAddSlot(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/plan\/outline$/, (c) => handleAddOutline(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/stories\/(\d+)\/plan\/arcs$/, (c) => handleAddArc(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', /^\/plan\/arcs\/(\d+)\/edit$/, (c) => handleArcPage(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/plan\/arcs\/(\d+)\/edit$/, (c) => handleEditArc(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/plan\/arcs\/(\d+)\/delete$/, (c) => handleDeleteArc(c.req, c.res, c.user, Number(c.m[1]))],
  ['GET', /^\/plan\/slots\/(\d+)\/edit$/, (c) => handleSlotPage(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/plan\/slots\/(\d+)\/edit$/, (c) => handleEditSlot(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/plan\/slots\/(\d+)\/delete$/, (c) => handleDeleteSlot(c.req, c.res, c.user, Number(c.m[1]))],
  ['POST', /^\/plan\/slots\/(\d+)\/move$/, (c) => handleMoveSlot(c.req, c.res, c.user, Number(c.m[1]))],
];

module.exports = {
  handleAddArc,
  handleAddOutline,
  handleAddSlot,
  handleArcPage,
  handleDeleteArc,
  handleDeleteSlot,
  handleEditArc,
  handleEditSlot,
  handleMoveSlot,
  handlePlan,
  handleSlotPage,
  routes,
};
