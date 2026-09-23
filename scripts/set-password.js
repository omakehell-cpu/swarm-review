#!/usr/bin/env node
// scripts/set-password.js -- give an account a new password from the
// machine the site runs on. For when the one admin is the one locked out,
// and there is nobody left to make a reset link.
//
//   node scripts/set-password.js <username>
//
// It asks for the password twice, without showing it, so it never lands in
// the shell's history. It also unlocks the account and signs it out
// everywhere else (as changing a password on the site does). Run it from
// the site's folder; the server can stay running.
'use strict';

const username = String(process.argv[2] || '').trim().toLowerCase();
if (!username) {
  console.error('Usage: node scripts/set-password.js <username>');
  process.exit(2);
}

// Reads a line without echoing it. Keystrokes typed (or piped) ahead of
// the question are kept, so two answers arriving together both count.
let pending = '';
let waiting = null;
function feed(text) {
  for (const ch of text) {
    if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); }
    if (ch === '\u007f' || ch === '\b') pending = pending.slice(0, -1);
    else pending += ch;
  }
  flush();
}
function flush() {
  if (!waiting) return;
  const m = /\r\n|\r|\n/.exec(pending);
  if (!m) return;
  const line = pending.slice(0, m.index);
  pending = pending.slice(m.index + m[0].length);
  const resolve = waiting;
  waiting = null;
  process.stdout.write('\n');
  resolve(line);
}
let listening = false;
function ask(question) {
  process.stdout.write(question);
  if (!listening) {
    listening = true;
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.on('data', (buf) => feed(buf.toString('utf8')));
    process.stdin.on('end', () => { if (waiting) { pending += '\n'; flush(); } });
    process.stdin.resume();
  }
  return new Promise((resolve) => { waiting = resolve; flush(); });
}

(async () => {
  const models = require('../models');
  const auth = require('../auth');
  const user = models.getUserByUsername(username);
  if (!user) {
    console.error(`There is no account called "${username}".`);
    process.exit(1);
  }
  const first = await ask(`New password for ${user.display_name} (@${user.username}): `);
  if (first.length < 8) {
    console.error('It must be at least 8 characters. Nothing was changed.');
    process.exit(1);
  }
  const second = await ask('The same again: ');
  if (first !== second) {
    console.error('The two did not match. Nothing was changed.');
    process.exit(1);
  }
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  models.setOwnPassword(user.id, auth.hashPassword(first));
  models.adminUnlockAccount(user.id);
  console.log(`Done. @${user.username} can sign in with the new password${user.is_admin ? ' (an admin account)' : ''}; any other sign-ins were ended.`);
  process.exit(0);
})();
