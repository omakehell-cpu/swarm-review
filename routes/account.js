'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { parseBody, sendHtml, redirect } = require('../lib/util');
const auth = require('../auth');
const models = require('../models');
const views = require('../views');
const { NAME_PATTERN, isReservedName, logEvent, login, siteOrigin, tagIdsFromBody } = require('./shared');
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

// The name you type into the login box, which is nobody else's business.
//
// It used to be the same field as the @name on your page, so it could not
// move without taking every old mention and every old link with it. They
// are two columns now (see db.js), and this changes only the one the
// login reads: your page keeps its address and "@luis" in a note written
// last year still means you.
//
// The password is asked for because this is the half of the credential
// that is not secret, and somebody who walks past an unlocked screen
// should not be able to change what its owner has to type tomorrow.
async function handleAccountLoginNameSubmit(req, res, user) {
  const body = await parseBody(req);
  const loginName = (body.loginName || '').trim().toLowerCase();
  const again = (message, status) => sendHtml(res, status, views.accountPage({
    user, error: message, errorIn: 'login-name',
    groups: models.listTagsGrouped(),
    hiddenTagIds: models.listUserHiddenTagIds(user.id),
    streak: models.writingStreak(user.id, user.daily_goal),
    origin: siteOrigin(req),
  }));

  if (!auth.verifyPassword(body.currentPassword || '', user.password_hash)) {
    return again('Password is incorrect, so nothing was changed.', 401);
  }
  if (loginName === (user.login_name || user.username)) {
    return again('That is already the name you sign in with.', 400);
  }
  if (!NAME_PATTERN.test(loginName)) {
    return again('A sign-in name is 3-30 characters: letters, numbers, _ and - only.', 400);
  }
  if (isReservedName(loginName)) {
    return again('That name is reserved.', 400);
  }
  if (models.loginNameTaken(loginName, user.id)) {
    return again('Somebody else is already that, either to sign in or on their page.', 409);
  }

  models.setLoginName(user.id, loginName);
  // No value in the log: an admin has a reason to know the account was
  // renamed, and no reason to be told what to type into its login box.
  logEvent(user, 'login-name-changed');
  redirect(res, '/account?notice=Sign-in name changed. Use it the next time you log in -- everything else, including your page and how the group sees you, is exactly where it was.#sign-in');
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
  ['POST', '/account/sign-in-name', (c) => handleAccountLoginNameSubmit(c.req, c.res, c.user)],
  ['POST', '/account/reading', (c) => handleAccountReadingSubmit(c.req, c.res, c.user)],
  ['POST', '/account/goal', (c) => handleAccountGoalSubmit(c.req, c.res, c.user)],
  ['POST', /^\/account\/feed\/(new|off)$/, (c) => handleAccountFeedSubmit(c.req, c.res, c.user, c.m[1])],
];

module.exports = {
  handleAccountFeedSubmit,
  handleAccountLoginNameSubmit,
  handleAccountGoalSubmit,
  handleAccountNameSubmit,
  handleAccountPage,
  handleAccountPasswordSubmit,
  handleHiddenTagsSubmit,
  routes,
};
