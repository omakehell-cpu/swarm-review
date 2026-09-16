'use strict';

// Pages load the scripts they have something for. The pairing is a mark
// in the HTML rather than a list kept by hand, so these tests check the
// two ways that can still go wrong: a script nothing ever loads, and a
// page that grew a feature but not the script behind it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { layout } = require('../lib/layout');

const shipped = fs.readdirSync(path.join(ROOT, 'public', 'js')).filter((f) => f.endsWith('.js'));

test('every script the app ships can be reached by some page', () => {
  // Two honest ways to be loaded: the layout's table, or a view that
  // writes the tag itself (the editor's analyzer and its dictionary do
  // that, because only two pages want a hundred kilobytes of it).
  const layoutSource = fs.readFileSync(path.join(ROOT, 'lib', 'layout.js'), 'utf8');
  const viewSource = fs.readdirSync(path.join(ROOT, 'views'))
    .map((f) => fs.readFileSync(path.join(ROOT, 'views', f), 'utf8')).join('\n');
  for (const file of shipped) {
    const name = file.replace(/\.js$/, '');
    // theme-init is written straight into the <head>: it has to run
    // before the first paint, so it is neither deferred nor in the table.
    const inTable = layoutSource.includes(`'${name}'`) || layoutSource.includes(`/js/${file}`);
    const inAView = viewSource.includes(`/js/${file}`);
    assert.ok(inTable || inAView, `${file} is loaded by the layout or by a view -- otherwise nothing ever runs it`);
  }
});

test('a plain page carries almost nothing', () => {
  const html = layout({ title: 'T', user: { display_name: 'A', username: 'a' }, body: '<p>Nothing here.</p>' });
  const loaded = [...html.matchAll(/src="\/js\/([a-z-]+)\.js"/g)].map((m) => m[1]);
  // The toggle is in the topbar this layout writes, so it is always
  // there; everything else is earned.
  assert.deepStrictEqual(loaded.sort(), ['theme-init', 'theme-toggle']);
});

test('a page gets exactly the scripts its own markup asks for', () => {
  const user = { display_name: 'A', username: 'a' };
  /** @type {Array<[string, string[]]>} */
  const cases = [
    ['<div class="chapter-body-grid"><div class="reading-pane">x</div></div>', ['margin-notes', 'reading']],
    ['<table id="outline"><tbody data-reorder></tbody></table>', ['outline']],
    ['<form class="chapter-form"><textarea name="content"></textarea></form>', ['draft-rescue']],
    ['<a class="chapter-row glossary-row" href="#">x</a>', ['glossary-filter']],
    ['<details data-beside></details>', ['beside']],
    ['<input type="file" data-shrink>', ['image-shrink']],
    ['<form data-confirm="sure?"></form>', ['confirm-forms']],
    // The bible's form, and the pair of fields the chapter editor
    // borrows its class name from. Only the first wants the script.
    ['<form class="chapter-form entity-form"></form>', ['bible-form', 'draft-rescue']],
    ['<div class="entity-form-row"><label>POV</label></div>', []],
  ];
  for (const [body, expected] of cases) {
    const html = layout({ title: 'T', user, body });
    const loaded = [...html.matchAll(/src="\/js\/([a-z-]+)\.js"/g)].map((m) => m[1])
      .filter((n) => !['theme-init', 'theme-toggle'].includes(n));
    assert.deepStrictEqual(loaded.sort(), expected.sort(), body);
  }
});
