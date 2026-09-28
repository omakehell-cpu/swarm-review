// server.js -- the front door. It serves the static files, works out who
// is asking, decides whether they may be here at all, and hands the
// request to whichever routes/ file owns that address. Everything that
// answers a page lives in routes/; this file is the part that is the same
// for every one of them.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// --- tiny built-in .env loader (no dependency on the "dotenv" package) ---
(function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    if (key && !(key in process.env)) process.env[key] = value;
  }
})();

const models = require('./models');
const backups = require('./lib/backup');
const { redirect, clearCookie, readBody, sendJson } = require('./lib/util');
const { SESSION_COOKIE, getCurrentUser, handleFeed, sendError, UPLOAD_LIMIT_BYTES, BATCH_UPLOAD_LIMIT_BYTES } = require('./routes/shared');
const auth = require('./auth');
const { tokenFromRequest } = require('./lib/csrf');

// Every route in the app, in the order they are tried. Each file owns its
// own table, so adding a page means editing the file that page lives in,
// not a list somewhere else that has to be kept in step with it.
/**
 * What every route handler is given: the request, the response, who is
 * asking, the parsed URL and the regex groups from the path.
 * @typedef {{ req: any, res: any, user: any, url: URL, m: RegExpMatchArray|string[] }} RouteContext
 */
const ROUTES = [
  require('./routes/auth'),
  require('./routes/account'),
  require('./routes/admin'),
  require('./routes/import'),
  require('./routes/glossary'),
  require('./routes/help'),
  require('./routes/tags'),
  require('./routes/comments'),
  require('./routes/reviews'),
  require('./routes/covers'),
  require('./routes/desk'),
  require('./routes/bible'),
  require('./routes/split'),
  require('./routes/chapters'),
  require('./routes/stories'),
  require('./routes/people'),
].flatMap((mod) => mod.routes);

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.aff': 'text/plain; charset=utf-8',
  '.dic': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.html': 'text/html; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function tryServeStatic(req, res, pathname) {
  if (req.method !== 'GET') return false;
  const safeSuffix = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safeSuffix);
  if (!filePath.startsWith(PUBLIC_DIR)) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' };
  // The spellchecker's dictionary files (public/dictionary/en.aff, en.dic)
  // never change once downloaded -- worth letting the browser cache them
  // for a while instead of refetching on every visit to a writing page.
  // Everything else under public/ (css/js/html) is served with
  // Cache-Control: no-store, so neither the browser nor Cloudflare ever
  // hold on to a stale copy of this dynamic app.
  if (pathname.startsWith('/dictionary/')) headers['Cache-Control'] = 'public, max-age=86400';
  // The typefaces (public/fonts/) are immutable: a changed font ships
  // under a new filename, so this can be cached hard and forever. Without
  // this they'd be re-downloaded on every single page load, since the
  // default above is no-store -- several hundred KB each time.
  if (pathname.startsWith('/fonts/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// Set on every response, before any route-specific writeHead() runs --
// res.writeHead() merges in whatever was set here via setHeader(), so this
// applies uniformly to pages, static files, JSON, downloads, and 404s alike.
// The app never frames itself or anyone else, never loads scripts/styles/
// fonts/images from another origin, and has no external CDN, so these are
// tight without needing an allowlist.
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    // worker-src is spelled out rather than left to fall back through
    // child-src to default-src: the fallback chain has changed between
    // browser versions, and the writing checks run in a worker.
    "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
}

async function router(req, res) {
  setSecurityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  // The app's own furniture, reachable signed out: a phone asks for the
  // manifest and the icons without a cookie, the service worker must sit
  // at the root to look after the whole site, and the offline page is
  // what that worker shows when there is no network at all.
  if (pathname === '/manifest.webmanifest' || pathname === '/sw.js' || pathname === '/offline.html'
      || pathname.startsWith('/icons/')) {
    if (pathname === '/sw.js' && req.method === 'GET') res.setHeader('Service-Worker-Allowed', '/');
    if (tryServeStatic(req, res, pathname)) return;
  }

  if (pathname.startsWith('/css/') || pathname.startsWith('/js/')
      || pathname.startsWith('/dictionary/') || pathname.startsWith('/fonts/')) {
    if (tryServeStatic(req, res, pathname)) return;
  }

  // A person's private feed. Above the login check because a feed reader
  // has no session and never will: the secret in the URL is the whole
  // credential, which is why it is long, why it is only created on
  // request, and why rotating it is one button.
  {
    const feedMatch = pathname.match(/^\/feed\/([A-Za-z0-9_-]{16,128})\.atom$/);
    if (feedMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      return handleFeed(req, res, feedMatch[1]);
    }
  }

  let user = getCurrentUser(req);
  const PUBLIC_ROUTES = new Set(['/login', '/register']);
  // Reachable with or without a session (an admin-generated link, not tied
  // to whoever's currently logged in on this browser -- see
  // handleResetPasswordPage/Submit) -- unlike PUBLIC_ROUTES above, being
  // logged in doesn't redirect away from it either.
  const isResetPasswordRoute = pathname.startsWith('/reset-password/');

  // An admin can lock an account that already has a valid, unexpired
  // session cookie open somewhere -- re-checking the DB's locked_at on
  // every request (not just at login) is what makes "lock this account"
  // actually take effect immediately, rather than up to 30 days later.
  if (user && user.locked_at) {
    clearCookie(res, SESSION_COOKIE);
    user = null;
    if (!PUBLIC_ROUTES.has(pathname) && !isResetPasswordRoute) return redirect(res, '/login?locked=1');
  }

  if (!user && !PUBLIC_ROUTES.has(pathname) && !isResetPasswordRoute) {
    return redirect(res, '/login');
  }
  if (user && PUBLIC_ROUTES.has(pathname)) {
    return redirect(res, '/');
  }
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (!user.is_admin) return sendError(res, 403, 'Admin access only.', user);
  }

  // Anything that changes something, from somebody signed in, has to
  // carry the token only this site's own pages know (see lib/csrf.js and
  // auth.csrfToken). The cookie alone is not enough: another site can make
  // a browser send it, and SameSite=Lax was doing all of that work alone.
  if (user && req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      // A batch of stories for the importer can be a large .zip; that one
      // address, for admins, takes more (see routes/import.js).
      const limit = pathname === '/admin/import/batch' && user.is_admin ? BATCH_UPLOAD_LIMIT_BYTES : UPLOAD_LIMIT_BYTES;
      req.rawBody = await readBody(req, limit);
    } catch (err) {
      return sendError(res, err.statusCode || 400, 'That was too large to send.', user);
    }
    if (!auth.csrfMatches(user, tokenFromRequest(req, req.rawBody))) {
      return sendError(res, 403, 'This page was open too long, or came from somewhere else. Go back, reload it, and try again -- whatever you typed is still in the box.', user);
    }
  }
  // Scripts that need the token and have no page to read it from.
  if (user && req.method === 'GET' && pathname === '/csrf-token') {
    return sendJson(res, 200, { token: user.csrf });
  }

  // The screenshots in the how-tos. Below the login check rather than
  // beside the stylesheets: they are pictures of the inside of the app,
  // and everything else about the inside of the app needs a session.
  if (pathname.startsWith('/img/') && tryServeStatic(req, res, pathname)) return;

  try {
    for (const [method, matcher, run] of ROUTES) {
      if (req.method !== method) continue;
      const m = typeof matcher === 'string'
        ? (pathname === matcher ? [pathname] : null)
        : pathname.match(matcher);
      if (!m) continue;
      const out = await run({ req, res, user, url, m });
      // Anything posted may have changed a story: its glossary page follows.
      if (req.method === 'POST') models.scheduleStoryGlossaryRefresh();
      return out;
    }

    sendError(res, 404, 'There is no page at that address.', user);
  } catch (err) {
    console.error(err);
    sendError(res, 500, 'Something went wrong at our end. The error has been logged.', user);
  }
}

const server = http.createServer((req, res) => {
  router(req, res).catch((err) => {
    console.error(err);
    // No `user` here on purpose: this is the last line of defence, and
    // whatever threw may well be whatever was looking the user up.
    if (!res.headersSent) sendError(res, 500, 'Something went wrong at our end. The error has been logged.');
  });
});

// A copy of the database, daily, without anybody having to remember. Not
// started under test: a suite that spawns thirty servers does not want
// thirty backups of thirty throwaway databases.
if (process.env.NODE_ENV !== 'test') {
  backups.startBackups(models.backupDatabaseTo, (err) => console.error('backup failed:', err.message));
  // And server.log, which launchd writes and nothing else would trim.
  require('./lib/logrotate').startLogRotation((err) => console.error('log rotation failed:', err.message));
}

// Stories written before their glossary pages existed get them now.
try { models.refreshStoryGlossary(); } catch (err) { console.error('story glossary refresh failed:', err.message); }

server.listen(PORT, () => {
  console.log(`Swarm Review listening on http://localhost:${PORT}`);
  const activeCode = models.getActiveInviteCode();
  console.log(activeCode
    ? `Invite code for new account registration: ${activeCode.code}`
    : 'Registration is currently closed -- log in as an admin and generate a new invite code from /admin.');
});

// The wiki index (see lib/wiki.js) is synced ONLY when an admin clicks
// "Sync now" on /admin (see handleAdminSyncWiki above) -- deliberately no
// automatic background timer. Each sync now pulls every page's full
// content (not just a short summary), which is a much heavier set of
// requests against what is likely a small self-hosted wiki, so this is
// left entirely in a human's hands rather than risking the app hammering
// it on its own schedule.
