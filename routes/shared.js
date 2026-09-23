'use strict';

const { docxBufferToMarkdown } = require('../lib/docx');
const { parseCookies, sendHtml, setCookie } = require('../lib/util');
const auth = require('../auth');
const models = require('../models');
const views = require('../views');
const feeds = require('../lib/feed');

const PORT = Number(process.env.PORT) || 3000;
const SESSION_COOKIE = 'swarm_session';

const UPLOAD_LIMIT_BYTES = 15 * 1024 * 1024;

// When the app is only reachable over plain http:// (e.g. localhost during
// development), the session cookie must NOT be marked Secure -- browsers
// silently refuse to send Secure cookies over a non-HTTPS connection, which
// would make login appear to silently fail. Once the app is actually
// served over https:// (e.g. behind a Cloudflare Tunnel or a reverse proxy
// terminating TLS), set SECURE_COOKIES=1 in the environment/.env file to
// turn this on -- the browser then refuses to ever send the session cookie
// back over a plain http:// connection, which is what you want in
// production.
const SECURE_COOKIES = process.env.SECURE_COOKIES === '1' || process.env.SECURE_COOKIES === 'true';

// Every refusal and every dead link goes through here, so it arrives as a
// page with the site's own type and a way back rather than as a bare
// string in a blank window. `user` may be absent (nobody is signed in, or
// the handler never looked one up), and the layout copes.
function sendError(res, status, message, user) {
  sendHtml(res, status, views.errorPage({ user: user || null, status, message }));
}

// Turns an uploaded file (from a <input type="file"> field) into markdown
// source text, based on its extension. Returns null if there's no file to
// use (so callers fall back to the pasted-textarea value instead).
async function extractUploadedText(file) {
  if (!file || !file.buffer || !file.buffer.length) return null;
  const ext = (file.filename.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
  if (ext === 'docx') {
    try {
      return await docxBufferToMarkdown(file.buffer);
    } catch (err) {
      const wrapped = new Error(`Could not read "${file.filename}": ${err.message}`);
      wrapped.userFacing = true;
      throw wrapped;
    }
  }
  // .md, .txt, or anything else -- treat as plain UTF-8 text.
  return file.buffer.toString('utf8').replace(/\r\n/g, '\n');
}

// ---------------------------------------------------------------------
// static file serving (public/)
// ---------------------------------------------------------------------

function getCurrentUser(req) {
  const cookies = parseCookies(req);
  const payload = auth.verifySession(cookies[SESSION_COOKIE]);
  if (!payload || !payload.uid) return null;
  const user = models.getUserById(payload.uid);
  if (!user) return null;
  // The password changed (see models.js setOwnPassword/adminSetPassword)
  // since this particular token was issued -- treat it the same as an
  // expired session rather than trusting a token some other, now-stale
  // login handed out.
  if (payload.sv !== user.session_version) return null;
  user.csrf = auth.csrfToken(user);
  return user;
}

function login(res, user) {
  const token = auth.signSession({ uid: user.id, sv: user.session_version, exp: Date.now() + auth.SESSION_MAX_AGE_MS });
  setCookie(res, SESSION_COOKIE, token, { maxAgeMs: auth.SESSION_MAX_AGE_MS, secure: SECURE_COOKIES });
}

// ---------------------------------------------------------------------
// route handlers
// ---------------------------------------------------------------------

// A line in the log, and never more than a line: models.recordEvent
// swallows its own errors, so nothing anybody does here can be undone by
// the app failing to write down that they did it. Every call passes the
// label and the link as they are at that moment -- see the note on the
// events table in db.js for why they are not looked up later.
function logEvent(user, kind, opts = {}) {
  if (user) models.recordEvent({ userId: user.id, kind, ...opts });
}

// The origin this app is being reached at. A feed has to carry absolute
// URLs, and the app has no idea what it is called from the outside except
// by what the request says it is.
function siteOrigin(req) {
  const proto = SECURE_COOKIES ? 'https' : 'http';
  return `${proto}://${req.headers.host || `localhost:${PORT}`}`;
}

// No session, no cookie, no redirect to the login page: a feed reader gets
// either the feed or a flat 404. A wrong token is not told that it is a
// wrong token, because that is one bit more than it needs.
function handleFeed(req, res, token) {
  const user = models.getUserByFeedToken(token);
  if (!user || user.locked_at) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('No such feed\n');
  }
  const origin = siteOrigin(req);
  const selfUrl = `${origin}/feed/${token}.atom`;
  const items = models.feedItemsFor(user.id);
  const xml = feeds.buildAtom({
    origin,
    selfUrl,
    title: 'The Swarm Review',
    subtitle: `What is waiting on ${user.display_name}`,
    entries: items.map((item) => ({
      id: feeds.tagUri(req.headers.host, item.kind, item.key),
      title: item.title,
      url: `${origin}${item.url}`,
      updated: item.at,
      summary: feeds.excerpt(item.summary),
      authorName: item.author || '',
    })),
  });
  res.writeHead(200, {
    'content-type': 'application/atom+xml; charset=utf-8',
    // A private URL that a reader might be tempted to share with a
    // crawler. Say no on the way out.
    'x-robots-tag': 'noindex, nofollow',
    'cache-control': 'private, max-age=300',
  });
  return res.end(req.method === 'HEAD' ? '' : xml);
}

// Tag ids arrive from a form as either one value or many, depending on how
// many boxes were ticked -- parseBody hands back a string in the first
// case and an array in the second.
function tagIdsFromBody(body) {
  const raw = body.tagIds === undefined ? [] : [].concat(body.tagIds);
  return raw.map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

// The "can't find one?" field that rides along inside the story form --
// a comma-separated list, since a nested <form> isn't legal HTML and a
// separate page to propose a tag would mean leaving the story half-
// written. Each name becomes a proposed tag (or resolves to the existing
// one, if it turns out the vocabulary already had it).
function proposedTagIdsFromBody(body, user) {
  return String(body.proposeTags || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((name) => models.proposeTag({ name, userId: user.id }))
    .filter(Boolean)
    .map((tag) => tag.id);
}

// A fragment is not a page: no layout, no chrome, and marked so that a
// browser asked to open one directly does not treat it as one.
function sendFragment(res, html, title) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'x-frame-options': 'DENY',
    'x-beside-title': encodeURIComponent(title || ''),
  });
  res.end(html);
}

// What this story has called things before, for the fields that offer it
// back rather than making somebody remember.
const storyVocabulary = (storyId) => ({
  povs: models.listPovs(storyId),
  strands: models.listStrands(storyId),
  whens: models.listStoryWhens(storyId),
});

function slugForFilename(title) {
  const slug = String(title || 'chapter')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'chapter';
}
module.exports = {
  SECURE_COOKIES,
  SESSION_COOKIE,
  UPLOAD_LIMIT_BYTES,
  extractUploadedText,
  getCurrentUser,
  handleFeed,
  logEvent,
  login,
  proposedTagIdsFromBody,
  sendError,
  sendFragment,
  siteOrigin,
  slugForFilename,
  storyVocabulary,
  tagIdsFromBody,
};
