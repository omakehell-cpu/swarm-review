// lib/multipart.js -- a small, dependency-free multipart/form-data parser.
// Handles exactly what browser <form enctype="multipart/form-data"> submits:
// text fields and file fields. No streaming/large-file cleverness -- the
// whole body is buffered (same limit as the rest of this app's forms),
// which is fine for pasted chapter text and single small file uploads.
'use strict';

// Splits a Buffer on every occurrence of a separator Buffer, returning the
// pieces *between* separators (i.e. what Buffer.split would do if it existed).
function splitBuffer(buf, sep) {
  const parts = [];
  let start = 0;
  let idx;
  while ((idx = buf.indexOf(sep, start)) !== -1) {
    parts.push(buf.slice(start, idx));
    start = idx + sep.length;
  }
  parts.push(buf.slice(start));
  return parts;
}

function parseHeaders(headerBlock) {
  const headers = {};
  for (const line of headerBlock.toString('utf8').split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return headers;
}

function parseContentDisposition(value) {
  const out = {};
  if (!value) return out;
  for (const part of value.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) { out[trimmed] = true; continue; }
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

// Returns { fields: { name: string }, files: { name: { filename, contentType, buffer } } }
function parseMultipart(bodyBuffer, contentType) {
  const fields = {};
  const files = {};
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!boundaryMatch) return { fields, files };
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);

  const rawParts = splitBuffer(bodyBuffer, boundary);
  for (const rawPart of rawParts) {
    // Each real part starts with \r\n after the boundary and the closing
    // part ends with "--\r\n" (or "--"); strip a leading CRLF and skip
    // anything that isn't a real header/body part.
    let part = rawPart;
    if (part.slice(0, 2).toString() === '\r\n') part = part.slice(2);
    if (part.length === 0 || part.slice(0, 2).toString() === '--') continue;

    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = parseHeaders(part.slice(0, headerEnd));
    let body = part.slice(headerEnd + 4);
    // Trailing CRLF before the next boundary.
    if (body.slice(-2).toString() === '\r\n') body = body.slice(0, -2);

    const disposition = parseContentDisposition(headers['content-disposition']);
    if (!disposition.name) continue;

    if (disposition.filename !== undefined) {
      if (disposition.filename === '') continue; // empty file input, nothing chosen
      files[disposition.name] = {
        filename: disposition.filename,
        contentType: headers['content-type'] || 'application/octet-stream',
        buffer: body,
      };
    } else {
      // Same as parseBody in lib/util.js: repeated names (a group of
      // checkboxes) collect into an array rather than overwriting.
      const value = body.toString('utf8');
      const name = disposition.name;
      if (fields[name] === undefined) fields[name] = value;
      else if (Array.isArray(fields[name])) fields[name].push(value);
      else fields[name] = [fields[name], value];
    }
  }

  return { fields, files };
}

module.exports = { parseMultipart };
