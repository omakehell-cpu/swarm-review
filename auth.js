// auth.js -- password hashing (scrypt) and signed session cookies (HMAC),
// using only Node's built-in `crypto` module.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// --- session secret: from env, or generated once and persisted to disk ---
const SECRET_PATH = path.join(DATA_DIR, 'session.secret');
function loadOrCreateSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (fs.existsSync(SECRET_PATH)) return fs.readFileSync(SECRET_PATH, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
  return secret;
}
const SESSION_SECRET = loadOrCreateSecret();

// --- password hashing ---
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// --- session tokens: base64url(payload).base64url(hmac) ---
function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function signSession(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', SESSION_SECRET).update(body).digest());
  return `${body}.${sig}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = b64url(crypto.createHmac('sha256', SESSION_SECRET).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

// --- invite codes: gate registration so randoms can't self-sign-up if the
// server is ever reachable from outside the group. Unlike the old static
// code this app used to have, these are single-use and live in the
// invite_codes table (models.js) so the admin panel can generate a new one,
// see the current one, or close registration entirely. This is just the
// random-string generator; db.js seeds the first row (picking up any old
// data/invite-code.txt if present) and models.js manages rows after that.
function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return code;
}

const ACCOUNT_LOCKOUT_THRESHOLD = 3;

// Password reset tokens go in a URL (see server.js's /reset-password/:token
// and models.js's createPasswordResetToken) rather than being typed in by
// hand like an invite code, so this is long and base64url rather than a
// short human-friendly alphabet -- 32 random bytes, unguessable.
function generateResetToken() {
  return crypto.randomBytes(32).toString('base64url');
}

const PASSWORD_RESET_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

module.exports = {
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  SESSION_MAX_AGE_MS,
  generateInviteCode,
  ACCOUNT_LOCKOUT_THRESHOLD,
  generateResetToken,
  PASSWORD_RESET_TOKEN_MAX_AGE_MS,
};
