'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { parseBody, sendHtml, redirect } = require('../lib/util');
const auth = require('../auth');
const models = require('../models');
const views = require('../views');
const { logEvent, login, siteOrigin, tagIdsFromBody } = require('./shared');
async function handleAccountPage(req, res, user, query) {
  const notice = query.get('notice') || null;
  sendHtml(res, 200, views.accountPage({
    user, notice,
    groups: models.listTagsGrouped(),
    hiddenTagIds: models.listUserHiddenTagIds(user.id),
    streak: models.writingStreak(user.id, user.daily_goal),
    origin: siteOrigin(req),
  }));
}

async function handleAccountGoalSubmit(req, res, user) {
  const body = await parseBody(req);
  const goal = models.setDailyGoal(user.id, body.dailyGoal);
  redirect(res, `/account?notice=${encodeURIComponent(goal
    ? `Aiming at ${goal} words a day.`
    : 'No daily goal. The count will just say which days you wrote.')}`);
}

async function handleAccountFeedSubmit(req, res, user, action) {
  if (action === 'off') {
    models.clearFeedToken(user.id);
    return redirect(res, '/account?notice=Feed turned off. The old link stops working now.');
  }
  const existed = Boolean(user.feed_token);
  models.createFeedToken(user.id);
  return redirect(res, `/account?notice=${encodeURIComponent(existed
    ? 'New feed link. The old one stops working now, so put the new one in your reader.'
    : 'Your feed link is ready. Paste it into whatever you read feeds in.')}`);
}

async function handleAccountPasswordSubmit(req, res, user) {
  const body = await parseBody(req);
  const currentPassword = body.currentPassword || '';
  const newPassword = body.newPassword || '';
  const confirmPassword = body.confirmPassword || '';

  if (!auth.verifyPassword(currentPassword, user.password_hash)) {
    return sendHtml(res, 401, views.accountPage({ user, error: 'Current password is incorrect.' }));
  }
  if (newPassword.length < 8) {
    return sendHtml(res, 400, views.accountPage({ user, error: 'New password must be at least 8 characters long.' }));
  }
  if (newPassword !== confirmPassword) {
    return sendHtml(res, 400, views.accountPage({ user, error: 'New password and confirmation do not match.' }));
  }

  models.setOwnPassword(user.id, auth.hashPassword(newPassword));
  logEvent(user, 'password-changed');
  // Changing the password bumps session_version (see models.js), which
  // invalidates every session for this account -- including the one making
  // this very request. Issue a fresh cookie right away so the user lands on
  // a working, logged-in page instead of being bounced to /login mid-action.
  login(res, models.getUserById(user.id));
  redirect(res, '/account?notice=Password changed. You have been kept logged in here, but signed out everywhere else.');
}

// ---------------------------------------------------------------------
// admin panel
// ---------------------------------------------------------------------

// The name on everything they write. The sign-in name stays put: it is
// how the app knows them, it is in every session, and a group this size
// gains nothing from being able to change it except somebody locked out
// of their own account.
async function handleAccountNameSubmit(req, res, user) {
  const body = await parseBody(req);
  const displayName = (body.displayName || '').trim().slice(0, 60);
  if (!displayName) {
    return sendHtml(res, 400, views.accountPage({ user, error: 'A name cannot be empty.' }));
  }
  models.setDisplayName(user.id, displayName);
  logEvent(user, 'name-changed', { subject: displayName, href: `/users/${user.username}` });
  redirect(res, '/account?notice=Name changed. It shows on everything you have written, not just what you write next.');
}

async function handleAccountReadingSubmit(req, res, user) {
  const body = await parseBody(req);
  models.setReadingPrefs(user.id, { readFirst: body.readFirst === '1', plainNames: body.plainNames === '1' });
  redirect(res, '/account?notice=Reading settings saved.#reading');
}

async function handleHiddenTagsSubmit(req, res, user) {
  const body = await parseBody(req);
  models.setUserHiddenTags(user.id, tagIdsFromBody(body));
  redirect(res, '/account?notice=Hidden tags saved.');
}

// ---------- glossary (a local, offline mirror of the shared-universe

// The routes this file answers. server.js walks the tables in order
// and hands the first match a context: the request, the response, who is
// asking, the parsed URL and the regex groups.
/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['GET', '/account', (c) => handleAccountPage(c.req, c.res, c.user, c.url.searchParams)],
  ['POST', '/account/password', (c) => handleAccountPasswordSubmit(c.req, c.res, c.user)],
  ['POST', '/account/hidden-tags', (c) => handleHiddenTagsSubmit(c.req, c.res, c.user)],
  ['POST', '/account/name', (c) => handleAccountNameSubmit(c.req, c.res, c.user)],
  ['POST', '/account/reading', (c) => handleAccountReadingSubmit(c.req, c.res, c.user)],
  ['POST', '/account/goal', (c) => handleAccountGoalSubmit(c.req, c.res, c.user)],
  ['POST', /^\/account\/feed\/(new|off)$/, (c) => handleAccountFeedSubmit(c.req, c.res, c.user, c.m[1])],
];

module.exports = {
  handleAccountFeedSubmit,
  handleAccountGoalSubmit,
  handleAccountNameSubmit,
  handleAccountPage,
  handleAccountPasswordSubmit,
  handleHiddenTagsSubmit,
  routes,
};
