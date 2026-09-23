// Starts the real server -- `node server.js`, in its own process, against a
// throwaway database -- and hands back a client that behaves like a
// browser except for following redirects, since the redirect is usually
// what's being asserted.
'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const { useTempDatabase } = require('./tmpdb');

const ROOT = path.join(__dirname, '..', '..');

async function startApp() {
  const tmp = useTempDatabase();
  const port = 3000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, SWARM_DB_PATH: tmp.file, PORT: String(port), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderr = [];
  child.stderr.on('data', (d) => stderr.push(String(d)));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start in 15s\n${stderr.join('')}`)), 15000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('listening')) { clearTimeout(timer); resolve(undefined); }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}\n${stderr.join('')}`));
    });
  });

  // Safe only now the child has created and migrated the file.
  const models = require('../../models');

  return {
    base,
    models,
    stop() {
      child.kill('SIGTERM');
      tmp.cleanup();
    },
  };
}

// One client is one signed-in browser: it keeps its own cookie, so two of
// them are two people.
function makeClient(base) {
  let cookie = '';
  // A browser gets the CSRF token from the page; a test gets it the way a
  // script with no page would, once per session cookie. A test can turn it
  // off (csrf: false) to check what happens without one.
  const tokens = new Map();
  async function tokenFor(currentCookie) {
    if (!currentCookie) return '';
    if (!tokens.has(currentCookie)) {
      const res = await fetch(`${base}/csrf-token`, { headers: { cookie: currentCookie }, redirect: 'manual' });
      tokens.set(currentCookie, res.ok ? (await res.json()).token : '');
    }
    return tokens.get(currentCookie);
  }
  /**
   * @param {string} pathname
   * @param {{ method?: string, body?: string|Uint8Array, contentType?: string, headers?: Record<string, string>, csrf?: boolean }} [options]
   */
  const request = async (pathname, { method = 'GET', body, contentType, headers = {}, csrf = true } = {}) => {
    const unsafe = method !== 'GET' && method !== 'HEAD';
    const token = unsafe && csrf ? await tokenFor(cookie) : '';
    return fetch(base + pathname, {
      method,
      redirect: 'manual',
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(contentType ? { 'content-type': contentType } : {}),
        ...(token ? { 'x-csrf-token': token } : {}),
        ...headers,
      },
      // Node's fetch takes a Buffer at runtime; its published types only
      // admit the web BodyInit union, which doesn't name ArrayBufferView.
      body: /** @type {any} */ (body),
    });
  };

  return {
    request,
    get cookie() { return cookie; },
    set cookie(value) { cookie = value; },
    async login(username, password) {
      const res = await request('/login', { method: 'POST', ...form([['username', username], ['password', password]]) });
      const setCookie = res.headers.get('set-cookie');
      if (!setCookie) throw new Error(`login failed for ${username} (status ${res.status})`);
      cookie = setCookie.split(';')[0];
      return res;
    },
  };
}

function form(fields) {
  const params = new URLSearchParams();
  for (const [k, v] of fields) params.append(k, v);
  return { body: params.toString(), contentType: 'application/x-www-form-urlencoded' };
}

function multipart(fields, boundary = 'swarmtest0987') {
  let out = '';
  for (const [name, value] of fields) {
    out += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  out += `--${boundary}--\r\n`;
  return { body: out, contentType: `multipart/form-data; boundary=${boundary}` };
}

// The same, with one binary file part -- what the browser sends when a
// writer picks a .docx instead of pasting the text.
function multipartWithFile(fields, file, boundary = 'swarmtest0987') {
  const head = fields
    .map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
    .join('');
  const fileHead =
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n` +
    'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n';
  return {
    body: Buffer.concat([
      Buffer.from(head + fileHead, 'utf8'),
      file.body,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
    ]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

module.exports = { startApp, makeClient, form, multipart, multipartWithFile };
