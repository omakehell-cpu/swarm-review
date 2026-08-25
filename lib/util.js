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
    for (const [k, v] of params.entries()) out[k] = v;
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
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendJson(res, statusCode, obj) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
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

module.exports = {
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
