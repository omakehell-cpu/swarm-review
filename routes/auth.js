'use strict';

/** @typedef {import('../server').RouteContext} RouteContext */

const { parseBody, sendHtml, redirect, clearCookie } = require('../lib/util');
const auth = require('../auth');
const models = require('../models');
const views = require('../views');
const { SESSION_COOKIE, logEvent, login } = require('./shared');
async function handleLoginPage(req, res, query) {
  const error = query.get('locked') ? 'This account is locked. Ask an admin to reactivate it.' : null;
  const notice = query.get('notice') || null;
  sendHtml(res, 200, views.loginPage({ error, notice }));
}

async function handleLoginSubmit(req, res) {
  const body = await parseBody(req);
  // Registration stores the username lowercased (see handleRegisterSubmit),
  // so it has to be normalized the same way here -- otherwise someone who
  // types their username with uppercase letters would never find their
  // account when logging in.
  const username = (body.username || '').trim().toLowerCase();
  const user = models.getUserByUsername(username);

  // Second, explicit safeguard against the "deleted-user" placeholder ever
  // being used to log in, on top of its unusable random password hash.
  // Nor an imported author (models/imports.js): a name, not an account.
  if (!user || user.username === models.DELETED_USER_USERNAME || user.is_placeholder) {
    return sendHtml(res, 401, views.loginPage({ error: 'Incorrect username or password.' }));
  }

  if (user.locked_at) {
    return sendHtml(res, 403, views.loginPage({
      error: 'This account is locked. Ask an admin to reactivate it.',
    }));
  }

  if (!auth.verifyPassword(body.password || '', user.password_hash)) {
    const { attempts, locked } = models.recordFailedLogin(user.id);
    const remaining = auth.ACCOUNT_LOCKOUT_THRESHOLD - attempts;
    const error = locked
      ? 'Incorrect password. This account has been locked after 3 failed attempts -- ask an admin to reactivate it.'
      : `Incorrect username or password. ${remaining} attempt${remaining === 1 ? '' : 's'} left before this account is locked.`;
    return sendHtml(res, 401, views.loginPage({ error }));
  }

  models.resetFailedLogins(user.id);
  logEvent(user, 'signed-in');
  login(res, user);
  redirect(res, '/');
}

// An invite is sent as a link that fills in its own code (and, for an
// invite made for one person, their username), so the person on the
// other end has one thing to click and nothing to copy.
async function handleRegisterPage(req, res, query) {
  const clean = (value, max) => String(value || '').trim().slice(0, max);
  sendHtml(res, 200, views.registerPage({
    values: { username: clean(query && query.get('username'), 30), inviteCode: clean(query && query.get('code'), 64) },
  }));
}

async function handleRegisterSubmit(req, res) {
  const body = await parseBody(req);
  const username = (body.username || '').trim().toLowerCase();
  const displayName = (body.displayName || '').trim();
  const password = body.password || '';
  const inviteCode = (body.inviteCode || '').trim();
  const values = { username, displayName };

  const codeRow = models.validateInviteCode(inviteCode, username);
  if (!codeRow) {
    return sendHtml(res, 403, views.registerPage({
      error: 'That invite code is incorrect, already used, or registration is currently closed. Ask an admin for a new one.',
      values,
    }));
  }
  if (username === models.DELETED_USER_USERNAME || username.startsWith('sol-')) {
    return sendHtml(res, 400, views.registerPage({ error: 'That username is reserved.', values }));
  }
  if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
    return sendHtml(res, 400, views.registerPage({ error: 'Invalid username (3-30 characters, letters/numbers/_/-).', values }));
  }
  if (!displayName) {
    return sendHtml(res, 400, views.registerPage({ error: 'Missing display name.', values }));
  }
  if (password.length < 8) {
    return sendHtml(res, 400, views.registerPage({ error: 'Password must be at least 8 characters long.', values }));
  }
  if (models.getUserByUsername(username)) {
    return sendHtml(res, 409, views.registerPage({ error: 'That username is already taken.', values }));
  }

  const isFirstUser = models.userCount() === 0;
  const user = models.createUser({
    username,
    displayName,
    passwordHash: auth.hashPassword(password),
    isAdmin: isFirstUser,
  });
  models.markInviteCodeUsed(codeRow.id, user.id);
  logEvent(user, 'joined');
  login(res, user);
  redirect(res, '/');
}

async function handleLogout(req, res) {
  clearCookie(res, SESSION_COOKIE);
  redirect(res, '/login');
}

async function handleResetPasswordPage(req, res, token) {
  const resetToken = models.getValidPasswordResetToken(token);
  if (!resetToken) {
    return sendHtml(res, 400, views.resetPasswordExpiredPage());
  }
  sendHtml(res, 200, views.resetPasswordPage({ token, displayName: resetToken.user_display_name }));
}

async function handleResetPasswordSubmit(req, res, token) {
  const resetToken = models.getValidPasswordResetToken(token);
  if (!resetToken) {
    return sendHtml(res, 400, views.resetPasswordExpiredPage());
  }
  const body = await parseBody(req);
  const password = body.password || '';
  const confirm = body.confirm || '';
  if (password.length < 8) {
    return sendHtml(res, 400, views.resetPasswordPage({
      token, displayName: resetToken.user_display_name, error: 'Password must be at least 8 characters long.',
    }));
  }
  if (password !== confirm) {
    return sendHtml(res, 400, views.resetPasswordPage({
      token, displayName: resetToken.user_display_name, error: 'Passwords do not match.',
    }));
  }
  models.consumePasswordResetToken(resetToken.id, resetToken.user_id, auth.hashPassword(password));
  redirect(res, '/login?notice=Password changed. Log in with your new password.');
}

// The routes this file answers. server.js walks the tables in order
// and hands the first match a context: the request, the response, who is
// asking, the parsed URL and the regex groups.
/** @type {Array<[string, string|RegExp, (c: RouteContext) => any]>} */
const routes = [
  ['GET', '/login', (c) => handleLoginPage(c.req, c.res, c.url.searchParams)],
  ['POST', '/login', (c) => handleLoginSubmit(c.req, c.res)],
  ['GET', '/register', (c) => handleRegisterPage(c.req, c.res, c.url.searchParams)],
  ['POST', '/register', (c) => handleRegisterSubmit(c.req, c.res)],
  ['POST', '/logout', (c) => handleLogout(c.req, c.res)],
  ['GET', /^\/reset-password\/([^/]+)$/, (c) => handleResetPasswordPage(c.req, c.res, c.m[1])],
  ['POST', /^\/reset-password\/([^/]+)$/, (c) => handleResetPasswordSubmit(c.req, c.res, c.m[1])],
];

module.exports = {
  handleLoginPage,
  handleLoginSubmit,
  handleLogout,
  handleRegisterPage,
  handleRegisterSubmit,
  handleResetPasswordPage,
  handleResetPasswordSubmit,
  routes,
};
