// lib/util.js -- small helpers: HTML escaping, cookie parsing, body
// reading, response helpers. No external dependencies.
'use strict';

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Safely embeds a JSON value inside a <script type="application/json"> block:
// escapes "<" so the payload can never prematurely close the script tag.
function toScriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003C');
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function readBody(req, limitBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseBody(req) {
  const raw = await readBody(req);
  const contentType = req.headers['content-type'] || '';
  const text = raw.toString('utf8');
  if (contentType.includes('application/json')) {
    try { return text ? JSON.parse(text) : {}; } catch { return {}; }
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(text);
    const out = {};
    // A field that appears more than once comes back as an array, the way
    // a group of same-named checkboxes posts (the tag pickers, for one).
    // Assigning straight into the object instead would keep only the last
    // one, which looks exactly like "it saved, but only one of them".
    for (const [k, v] of params.entries()) {
      if (out[k] === undefined) out[k] = v;
      else if (Array.isArray(out[k])) out[k].push(v);
      else out[k] = [out[k], v];
    }
    return out;
  }
  return {};
}

// For <form enctype="multipart/form-data">, e.g. forms with a file upload.
// Returns { fields: {name: string}, files: {name: {filename, contentType, buffer}} }.
// Non-multipart requests fall back to parseBody's fields with no files, so
// callers can accept either a pasted-text field or an uploaded file the
// same way regardless of which the browser actually sent.
async function parseMultipartBody(req, limitBytes) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return { fields: await parseBody(req), files: {} };
  }
  const raw = await readBody(req, limitBytes);
  const { parseMultipart } = require('./multipart');
  return parseMultipart(raw, contentType);
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function sendJson(res, statusCode, obj) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push('SameSite=Lax');
  if (opts.maxAgeMs) parts.push(`Max-Age=${Math.floor(opts.maxAgeMs / 1000)}`);
  if (opts.secure) parts.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  const cookieStr = parts.join('; ');
  if (existing) {
    res.setHeader('Set-Cookie', Array.isArray(existing) ? [...existing, cookieStr] : [existing, cookieStr]);
  } else {
    res.setHeader('Set-Cookie', cookieStr);
  }
}

function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// HTML with the tags taken out, for the search index. Not a parser and
// not trying to be: it runs over the wiki's own rendered output, which
// this app generated itself (lib/wiki.js), so there is nothing adversarial
// in it -- and indexing the HTML raw would make every page a match for
// "span".
function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  htmlToText,
  escapeHtml,
  toScriptJson,
  parseCookies,
  readBody,
  parseBody,
  parseMultipartBody,
  sendHtml,
  sendJson,
  redirect,
  setCookie,
  clearCookie,
};
