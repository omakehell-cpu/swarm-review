'use strict';

// Pictures for bible entries: a portrait, a sketch, a deck plan, a map.
//
// They live in data/entity-images/, beside the database rather than under
// public/. Anything under public/ is served to anybody who knows the URL,
// and a private story's cast is not that. So the bytes sit outside the
// document root and come back through a route that checks the session,
// and a backup of data/ has both halves of the thing.
//
// No image library is involved. Adding one would mean a native binary to
// compile and re-compile on every Node upgrade, in an app that has three
// dependencies. Instead the browser shrinks the picture before it is
// uploaded (public/js/image-shrink.js), which also means the 5MB original
// never crosses the network at all.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Four formats, recognised by what the bytes actually say rather than by
// the extension or the Content-Type, both of which are just the browser
// repeating what it was handed.
//
// SVG is deliberately absent, and it is not an oversight: an SVG is a
// document that can carry script, so serving one from this origin with the
// reader's session open would be a cross-site scripting hole with a
// picture frame around it.
const SIGNATURES = [
  { ext: '.png', type: 'image/png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: '.jpg', type: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.gif', type: 'image/gif', test: (b) => b.length > 6 && (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a') },
  { ext: '.webp', type: 'image/webp', test: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

const ACCEPT_ATTRIBUTE = 'image/png,image/jpeg,image/gif,image/webp';

// Generous, because it is the fallback for a browser with JavaScript off:
// with the shrinker running, a phone photo arrives at a couple of hundred
// kilobytes.
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_IMAGES_PER_ENTRY = 12;

const IMAGE_DIR = path.join(
  path.dirname(process.env.SWARM_DB_PATH || path.join(__dirname, '..', 'data', 'swarm-review.sqlite')),
  'entity-images'
);

function ensureDir() {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

/** What kind of image this is, or null if it is not one of the four. */
function identify(buffer) {
  if (!buffer || !buffer.length) return null;
  return SIGNATURES.find((s) => s.test(buffer)) || null;
}

/**
 * Writes one image and returns what the database row needs. Throws a
 * user-facing error for the two things a person can actually do wrong.
 * @param {{buffer: Buffer, filename?: string}} file
 */
function saveImage(file) {
  if (!file || !file.buffer || !file.buffer.length) {
    throw Object.assign(new Error('No image was uploaded.'), { userFacing: true });
  }
  if (file.buffer.length > MAX_IMAGE_BYTES) {
    throw Object.assign(
      new Error(`That image is ${Math.round(file.buffer.length / 1024 / 1024)}MB; the limit is ${MAX_IMAGE_BYTES / 1024 / 1024}MB.`),
      { userFacing: true }
    );
  }
  const kind = identify(file.buffer);
  if (!kind) {
    throw Object.assign(
      new Error('That is not a PNG, JPEG, GIF or WebP. (SVG is not accepted: it can carry script.)'),
      { userFacing: true }
    );
  }
  ensureDir();
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${kind.ext}`;
  fs.writeFileSync(path.join(IMAGE_DIR, name), file.buffer);
  return { filename: name, contentType: kind.type, bytes: file.buffer.length };
}

/** The path one stored image lives at -- never built from user input. */
function imagePath(filename) {
  const safe = path.basename(String(filename || ''));
  return path.join(IMAGE_DIR, safe);
}

// A file that is already gone is the state we wanted, so this never
// throws: an entry must be deletable even if its picture was tidied away
// from underneath the app.
function removeImage(filename) {
  try { fs.unlinkSync(imagePath(filename)); } catch (err) { /* already gone */ }
}

module.exports = {
  ACCEPT_ATTRIBUTE,
  IMAGE_DIR,
  MAX_IMAGES_PER_ENTRY,
  MAX_IMAGE_BYTES,
  identify,
  imagePath,
  removeImage,
  saveImage,
};
