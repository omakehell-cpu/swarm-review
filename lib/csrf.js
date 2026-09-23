// lib/csrf.js -- finding the CSRF token in a request, whatever shape it came in.
//
// Scripts send it as a header. Forms send it as a hidden field called
// _csrf, which lib/layout.js adds to every form that posts; a form can be
// url-encoded or multipart, and a page leaving can send a urlencoded
// beacon, which carries no headers at all.
'use strict';

/** @param {any} req @param {Buffer} raw */
function tokenFromRequest(req, raw) {
  const header = req.headers['x-csrf-token'];
  if (typeof header === 'string' && header) return header;
  const type = String(req.headers['content-type'] || '');
  if (!raw || !raw.length) return '';
  if (type.includes('application/x-www-form-urlencoded')) {
    return new URLSearchParams(raw.toString('utf8')).get('_csrf') || '';
  }
  if (type.includes('multipart/form-data')) {
    // Only the head of the body: the token field is written before any
    // file, because it is the first thing in the form.
    const head = raw.subarray(0, 64 * 1024).toString('latin1');
    const m = /name="_csrf"\r\n\r\n([^\r\n]*)\r\n/.exec(head);
    if (m) return m[1];
    const anywhere = /name="_csrf"\r\n\r\n([^\r\n]*)\r\n/.exec(raw.toString('latin1'));
    return anywhere ? anywhere[1] : '';
  }
  if (type.includes('application/json')) {
    try { const body = JSON.parse(raw.toString('utf8')); return (body && body._csrf) || ''; } catch { return ''; }
  }
  return '';
}

// Every form that posts gets the token as its first field. Done on the
// finished page rather than in each of forty templates, so a form added
// next month cannot forget it.
/** @param {string} html @param {string} token */
function addTokenToForms(html, token) {
  if (!token) return html;
  const field = `<input type="hidden" name="_csrf" value="${token}">`;
  return html.replace(/<form\b[^>]*\bmethod="post"[^>]*>/gi, (tag) => tag + field);
}

module.exports = { tokenFromRequest, addTokenToForms };
