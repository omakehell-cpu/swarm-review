'use strict';

// The name you sign in with, and the name the group calls you, are two
// different names.
//
// They were one column, because at the start they were one thing: you
// registered as "luis" and that was your login, your page's address and
// what a note meant by "@luis". Which made the login name unchangeable in
// practice -- moving it would have taken every old mention and every old
// link with it, for everybody else's benefit as well as your own.
//
// So the credential came out into its own column. These tests are about
// the seam: that the new name signs you in, that the old one stops, and
// that nothing anybody else can see moved at all.
const test = require('node:test');
const assert = require('node:assert');
const { startApp, makeClient, form } = require('./helpers/app');

const LUIS = { username: 'luis', displayName: 'Luis Prado', password: 'correct horse battery' };
const ANA = { username: 'ana', displayName: 'Ana Vilar', password: 'a different long password' };

let app; let models; let luis; let ana;

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');
  luis = models.createUser({
    username: LUIS.username, displayName: LUIS.displayName,
    passwordHash: auth.hashPassword(LUIS.password), isAdmin: true,
  });
  ana = models.createUser({
    username: ANA.username, displayName: ANA.displayName,
    passwordHash: auth.hashPassword(ANA.password), isAdmin: false,
  });
});

test.after(() => app.stop());

// Whether this name and password get you in at all: a login that worked
// hands back a session cookie, and one that did not hands back a page.
const signedIn = async (name, password) => {
  const client = makeClient(app.base);
  const res = await client.request('/login', {
    method: 'POST', ...form([['username', name], ['password', password]]),
  });
  const cookie = res.headers.get('set-cookie');
  if (cookie) client.cookie = cookie.split(';')[0];
  return { ok: Boolean(cookie) && res.status === 302, status: res.status, client };
};

const change = (client, fields) => client.request('/account/sign-in-name', {
  method: 'POST', ...form(fields),
});

test('an account that has never been renamed signs in as it always did', async () => {
  const { ok } = await signedIn(LUIS.username, LUIS.password);
  assert.ok(ok, 'the backfill gave every existing account its own name back');
  assert.strictEqual(models.getUserById(luis.id).login_name, 'luis');
});

test('the name changes, and the next login wants the new one', async () => {
  const { client } = await signedIn(LUIS.username, LUIS.password);
  const res = await change(client, [['loginName', 'prado'], ['currentPassword', LUIS.password]]);
  assert.strictEqual(res.status, 302);

  assert.ok((await signedIn('prado', LUIS.password)).ok, 'the new name works');
  assert.strictEqual((await signedIn('luis', LUIS.password)).status, 401, 'the old one does not');
  // And the session that did it is still a session: this is not a password.
  const stillIn = await client.request('/account');
  assert.strictEqual(stillIn.status, 200);
});

test('nothing the group can see moved', async () => {
  // The handle, the page, the mentions: all still "luis".
  const person = models.getUserById(luis.id);
  assert.strictEqual(person.username, 'luis', 'the handle is untouched');
  assert.strictEqual(person.display_name, LUIS.displayName);

  const client = makeClient(app.base);
  await client.login(ANA.username, ANA.password);
  const page = await client.request('/users/luis');
  assert.strictEqual(page.status, 200, 'the page is still at the address it was');
  assert.match(await page.text(), /@luis/, 'and still says @luis on it');
  // A note written before the rename still names the same person.
  assert.strictEqual(models.getUserByUsername('luis').id, luis.id);
});

test('the password is the point of the password field', async () => {
  const { client } = await signedIn('prado', LUIS.password);
  const res = await change(client, [['loginName', 'kessler'], ['currentPassword', 'not the password']]);
  assert.strictEqual(res.status, 401);
  assert.match(await res.text(), /Password is incorrect/);
  assert.strictEqual(models.getUserById(luis.id).login_name, 'prado', 'and nothing changed');
});

test('a name somebody else is already using is refused, either way round', async () => {
  const { client } = await signedIn('prado', LUIS.password);

  // Ana's handle -- which is also her sign-in name, since she never changed it.
  let res = await change(client, [['loginName', 'ana'], ['currentPassword', LUIS.password]]);
  assert.strictEqual(res.status, 409);
  assert.match(await res.text(), /Somebody else is already that/);

  // And her handle would still be refused if she signed in as something
  // else: two people cannot both answer to one name in a group of five.
  models.setLoginName(ana.id, 'vilar');
  res = await change(client, [['loginName', 'ana'], ['currentPassword', LUIS.password]]);
  assert.strictEqual(res.status, 409);
  assert.strictEqual(models.getUserById(luis.id).login_name, 'prado');
});

test('the rules are the same rules registration has', async () => {
  const { client } = await signedIn('prado', LUIS.password);
  const refused = async (name, expected) => {
    const res = await change(client, [['loginName', name], ['currentPassword', LUIS.password]]);
    assert.strictEqual(res.status, 400, `${name} should be refused`);
    assert.match(await res.text(), expected);
    assert.strictEqual(models.getUserById(luis.id).login_name, 'prado');
  };
  await refused('ab', /3-30 characters/);
  await refused('a name with spaces', /3-30 characters/);
  await refused('luis@home', /3-30 characters/);
  await refused('sol-somebody', /reserved/);
  await refused('deleted-user', /reserved/);
  await refused('prado', /already the name you sign in with/);
});

test('a name freed by a rename can be taken by the next person', async () => {
  // "luis" is nobody's sign-in name now -- it is only a handle, and it is
  // his own. He can take it back.
  const { client } = await signedIn('prado', LUIS.password);
  const res = await change(client, [['loginName', 'luis'], ['currentPassword', LUIS.password]]);
  assert.strictEqual(res.status, 302);
  assert.ok((await signedIn('luis', LUIS.password)).ok);
});

test('an imported author is a name, not an account', async () => {
  // Placeholders are left without a sign-in name at all, so nothing can
  // be typed into a login box to become one.
  const author = models.findOrCreateImportedAuthor({ name: 'Zen Master', authorSlug: 'zen-master' });
  assert.strictEqual(author.login_name, null);
  assert.strictEqual((await signedIn(author.username, 'anything at all')).status, 401);
});

test('a sign-in name with no handle on it is still taken', () => {
  // Ana signs in as "vilar" (set two tests ago) and nobody's page is at
  // /users/vilar. Registration asks this question before it hands the
  // name to whoever asked for it next.
  assert.ok(models.loginNameTaken('vilar', 0), 'taken, even with no handle on it');
  assert.ok(!models.loginNameTaken('vilar', ana.id), 'except by the person it belongs to');
});
