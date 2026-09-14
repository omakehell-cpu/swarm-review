// Repeated form fields.
//
// This file exists because of a bug that shipped. The tag pickers post a
// group of same-named checkboxes -- <input name="tagIds" value="3">,
// <input name="tagIds" value="7">, and so on -- and both body parsers were
// assigning straight into an object, so eight ticked boxes arrived as one
// value. Nothing threw. The form submitted, the page redirected, the story
// saved, and exactly one tag stuck. Reading the parsers didn't reveal it;
// asserting a round trip did.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');

const { parseBody } = require('../lib/util');
const { parseMultipart } = require('../lib/multipart');

// A stand-in for an http.IncomingMessage carrying a form body.
function fakeRequest(body, contentType) {
  const stream = Readable.from([Buffer.from(body, 'utf8')]);
  return Object.assign(stream, { headers: { 'content-type': contentType } });
}

const urlencoded = (body) =>
  parseBody(fakeRequest(body, 'application/x-www-form-urlencoded'));

// Builds exactly what a browser sends for a multipart form.
function multipartBody(parts, boundary = 'xBoundary123') {
  let out = '';
  for (const [name, value] of parts) {
    out += `--${boundary}\r\n`;
    out += `Content-Disposition: form-data; name="${name}"\r\n\r\n`;
    out += `${value}\r\n`;
  }
  out += `--${boundary}--\r\n`;
  return {
    buffer: Buffer.from(out, 'utf8'),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

test('urlencoded: a field sent once is a string', async () => {
  const body = await urlencoded('title=Chapter+One');
  assert.strictEqual(body.title, 'Chapter One');
});

test('urlencoded: a field sent eight times keeps all eight, in order', async () => {
  const sent = ['1', '2', '3', '5', '8', '13', '21', '34'];
  const body = await urlencoded(sent.map((v) => `tagIds=${v}`).join('&'));
  assert.deepStrictEqual(body.tagIds, sent);
});

test('urlencoded: repeats mixed in among single fields do not disturb them', async () => {
  const body = await urlencoded('title=A&tagIds=1&description=B&tagIds=2&tagIds=3&proposeTags=x');
  assert.strictEqual(body.title, 'A');
  assert.strictEqual(body.description, 'B');
  assert.strictEqual(body.proposeTags, 'x');
  assert.deepStrictEqual(body.tagIds, ['1', '2', '3']);
});

test('multipart: a field sent once is a string', () => {
  const { buffer, contentType } = multipartBody([['title', 'Chapter One']]);
  const { fields } = parseMultipart(buffer, contentType);
  assert.strictEqual(fields.title, 'Chapter One');
});

test('multipart: a field sent eight times keeps all eight, in order', () => {
  const sent = ['1', '2', '3', '5', '8', '13', '21', '34'];
  const { buffer, contentType } = multipartBody(sent.map((v) => ['tagIds', v]));
  const { fields } = parseMultipart(buffer, contentType);
  assert.deepStrictEqual(fields.tagIds, sent);
});

test('multipart: a file part and a repeated text field coexist', () => {
  const boundary = 'zzz';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="tagIds"\r\n\r\n4\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="tagIds"\r\n\r\n9\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n` +
      'Content-Type: text/plain\r\n\r\nhello\r\n' +
      `--${boundary}--\r\n`,
      'utf8'
    ),
  ]);
  const { fields, files } = parseMultipart(body, `multipart/form-data; boundary=${boundary}`);
  assert.deepStrictEqual(fields.tagIds, ['4', '9']);
  assert.strictEqual(files.file.filename, 'a.txt');
  assert.strictEqual(files.file.buffer.toString('utf8'), 'hello');
});

test('multipart: a file input nobody chose a file for is not a file', () => {
  const boundary = 'q';
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename=""\r\n` +
    'Content-Type: application/octet-stream\r\n\r\n\r\n' +
    `--${boundary}--\r\n`,
    'utf8'
  );
  const { files } = parseMultipart(body, `multipart/form-data; boundary=${boundary}`);
  assert.deepStrictEqual(files, {});
});
