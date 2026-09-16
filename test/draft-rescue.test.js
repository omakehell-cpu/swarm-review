'use strict';

// Pressing Save must not be met with "Are you sure you want to leave this
// page? You may lose changes."
//
// The warning is worth having: somebody who closes the tab on top of an
// hour's writing should be asked. But pressing Save *is* leaving the page,
// on purpose, with the text already on its way to the server -- and a
// browser fires beforeunload for a form post exactly as it does for a
// closed tab, so the editor asked that question every single time anybody
// published anything.
//
// Driving this in a real browser is what found it and what proves the fix
// (dispatch beforeunload, read defaultPrevented: silent before typing,
// warns after typing, silent after Save). A browser is not available where
// this suite runs, so what is pinned here is the shape of the code that
// makes it true.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'draft-rescue.js'), 'utf8'
);

test('a save is a departure the page knows about', () => {
  const submit = source.slice(source.indexOf("form.addEventListener('submit'"));
  assert.match(submit.slice(0, 200), /saving = true/,
    'the submit handler records that this one is on purpose');
  const unload = source.slice(source.indexOf("addEventListener('beforeunload'"));
  const guard = unload.indexOf('if (saving) return;');
  const compare = unload.indexOf('text.value === original');
  assert.ok(guard > -1, 'and the warning stands down for it');
  assert.ok(guard < compare, 'before it does anything else');
});

test('coming back with the Back button re-arms the warning', () => {
  // A page restored from the history cache is not re-run, so the flag
  // would still be set and the next departure would go unquestioned.
  assert.match(source, /addEventListener\('pageshow'[\s\S]{0,80}saving = false/);
});

test('the draft is still kept on the way out', () => {
  // Whatever else changes here, the point of the file is that the text
  // survives a crash, a closed tab and a refused save.
  const unload = source.slice(source.indexOf("addEventListener('beforeunload'"));
  assert.match(unload, /keep\(\)/, 'the draft is written before the page goes');
  const submit = source.slice(source.indexOf("form.addEventListener('submit'"));
  assert.match(submit.slice(0, 200), /keep\(\)/, 'and before a save that may be refused');
});
