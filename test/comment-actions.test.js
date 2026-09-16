'use strict';

// The one thing about the in-place answers that no server test can catch:
// what the browser actually puts in the request. Accept and Reject are one
// form and two buttons, so the answer is the submitting button's own name
// and value -- and a FormData built from the form alone does not contain
// it. Posted that way, both buttons say nothing and the server, correctly,
// does nothing at all.
//
// This was a real bug, found by driving the page in a real browser and
// looking at what arrived. It is here so it stays found.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'comment-actions.js'), 'utf8'
);

test('the submitting button rides along with the form', () => {
  assert.match(source, /event\)\.submitter/, 'the submitter is read off the event');
  assert.match(source, /fields\.append\(submitter\.name, submitter\.value\)/,
    "and its name and value are put in the body, which is where the answer lives");
  // A fallback for a browser that does not give one, so a form with a
  // single button still posts what that button says.
  assert.match(source, /querySelector\('button\[type="submit"\]/);
});

test('a failure falls back to the form the page already had', () => {
  // Every control here is a real form posting to a real address. The
  // whole design rests on that still being true when the fetch does not
  // work, so the catch has to hand the browser back its own form.
  assert.match(source, /catch[\s\S]{0,400}form\.submit\(\)/);
});

test('focus is moved before the note is replaced', () => {
  // Replacing the element the keyboard is on drops focus to the top of
  // the document. For somebody listening that is the same as losing the
  // page, so the replacement is given somewhere to put focus first.
  const swap = source.slice(source.indexOf('const holder'));
  const setsTabindex = swap.indexOf("setAttribute('tabindex'");
  const replaces = swap.indexOf('replaceWith');
  const focuses = swap.indexOf('.focus(');
  assert.ok(setsTabindex > -1 && replaces > -1 && focuses > -1, 'all three happen');
  assert.ok(setsTabindex < replaces, 'the new note can take focus before it goes in');
  assert.ok(replaces < focuses, 'and focus lands on it once it is there');
});

test('what happened is announced, politely', () => {
  assert.match(source, /aria-live', 'polite'/);
  assert.match(source, /role', 'status'/);
});

test('the keyboard can reach the thing this app is for', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  // The offer used to appear on mouseup and nowhere else.
  assert.match(app, /addEventListener\('keyup'/, 'a selection made with the arrow keys is noticed');
  assert.match(app, /addEventListener\('keydown'/, 'and there is a key that opens the box');
  assert.match(app, /aria-live/, 'and the offer says itself out loud');
  // Never steal a letter somebody is typing.
  assert.match(app, /tag === 'INPUT' \|\| tag === 'TEXTAREA'/);
});
