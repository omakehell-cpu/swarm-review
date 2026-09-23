// The CSRF token: a form or script from this site carries it, anything
// else signed in is refused. See lib/csrf.js and auth.csrfToken.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart } = require('./helpers/app');

let app;
let ana;
const PASSWORD = 'a long enough password';

test.before(async () => {
  app = await startApp();
  const invite = app.models.getActiveInviteCode();
  ana = makeClient(app.base);
  await ana.request('/register', {
    method: 'POST', ...form([['username', 'ana'], ['displayName', 'Ana'], ['password', PASSWORD], ['inviteCode', invite.code]]),
  });
  await ana.login('ana', PASSWORD);
});

test.after(() => app.stop());

test('every form that posts carries the token, and the page says it for scripts', async () => {
  const html = await (await ana.request('/account')).text();
  const token = /<meta name="csrf-token" content="([^"]+)">/.exec(html)[1];
  const forms = html.match(/<form\b[^>]*method="post"[^>]*>/gi) || [];
  assert.ok(forms.length > 3);
  const fields = html.match(new RegExp(`<input type="hidden" name="_csrf" value="${token}">`, 'g')) || [];
  assert.strictEqual(fields.length, forms.length, 'one token per form');
  assert.match(html, /<script src="\/js\/csrf\.js"><\/script>/);
});

test('a post without the token changes nothing', async () => {
  const res = await ana.request('/account/name', { method: 'POST', csrf: false, ...form([['displayName', 'Hijacked']]) });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(app.models.getUserByUsername('ana').display_name, 'Ana');
});

test('the token is accepted as a form field, urlencoded or multipart', async () => {
  const { token } = await (await ana.request('/csrf-token')).json();
  const ok = await ana.request('/account/name', { method: 'POST', csrf: false, ...form([['_csrf', token], ['displayName', 'Ana V']]) });
  assert.strictEqual(ok.status, 302);
  assert.strictEqual(app.models.getUserByUsername('ana').display_name, 'Ana V');
  const up = await ana.request('/stories/new', {
    method: 'POST', csrf: false,
    ...multipart([['_csrf', token], ['storyTitle', 'Tokened'], ['chapterTitle', 'One'], ['content', 'Words.']]),
  });
  assert.strictEqual(up.status, 302);
  const wrong = await ana.request('/account/name', { method: 'POST', csrf: false, ...form([['_csrf', 'nope'], ['displayName', 'X']]) });
  assert.strictEqual(wrong.status, 403);
});

test('signing in and registering need no token: there is no session yet to steal', async () => {
  const other = makeClient(app.base);
  const res = await other.request('/login', { method: 'POST', csrf: false, ...form([['username', 'ana'], ['password', PASSWORD]]) });
  assert.strictEqual(res.status, 302);
});
