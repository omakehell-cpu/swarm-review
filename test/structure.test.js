'use strict';

// The barrels are the app's door: server.js still asks for `views` and
// `models` and gets what it always got. These tests are what makes the
// split safe to repeat -- they fail the moment a name goes missing or two
// modules start fighting over one.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

for (const area of ['views', 'models']) {
  test(`${area} is one door onto many files`, () => {
    const barrel = require(path.join(ROOT, `${area}.js`));
    const files = fs.readdirSync(path.join(ROOT, area)).filter((f) => f.endsWith('.js'));
    assert.ok(files.length >= 10, `${area}/ has been split up`);

    // Every name any module exports comes out of the door.
    for (const file of files) {
      const mod = require(path.join(ROOT, area, file));
      for (const key of Object.keys(mod)) {
        assert.ok(key in barrel, `${area}/${file} exports ${key}, and the barrel passes it on`);
      }
    }
  });

  test(`no two ${area} modules export the same name`, () => {
    const seen = new Map();
    for (const file of fs.readdirSync(path.join(ROOT, area)).filter((f) => f.endsWith('.js'))) {
      for (const key of Object.keys(require(path.join(ROOT, area, file)))) {
        assert.ok(!seen.has(key), `${key} is exported by ${file} and by ${seen.get(key)}`);
        seen.set(key, file);
      }
    }
  });

  test(`${area}/shared depends on nobody in ${area}/`, () => {
    // Shared is the bottom of the pile. The moment it reaches back up,
    // every module in the directory is in a circle with it.
    const text = fs.readFileSync(path.join(ROOT, area, 'shared.js'), 'utf8');
    assert.ok(!/require\('\.\/[a-z]/.test(text), `${area}/shared.js requires no sibling`);
  });
}

// A ratchet, not a law: a thousand lines is the size at which this
// codebase stopped being searchable by eye. The three below are the ones
// still over it, each with a reason. Taking one off this list is progress;
// adding one needs an argument.
const ALLOWED_LONG = {
  'public/js/writing-analyzer.js': 'the editor, next to be taken apart',
  'test/server.e2e.test.js': 'a test file grows with the app, which is the point of it',
};

test('every route in the app is reachable from the table server.js walks', () => {
  const files = fs.readdirSync(path.join(ROOT, 'routes')).filter((f) => f.endsWith('.js'));
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  let total = 0;
  for (const file of files) {
    const mod = require(path.join(ROOT, 'routes', file));
    if (!mod.routes) continue;
    total += mod.routes.length;
    // A table nothing walks is a set of pages nobody can reach.
    assert.ok(server.includes(`require('./routes/${file.replace(/\.js$/, '')}')`),
      `server.js walks routes/${file}`);
    for (const [method, matcher, run] of mod.routes) {
      assert.match(method, /^(GET|POST|HEAD|PUT|DELETE)$/, `${file}: ${method} is a method`);
      assert.ok(typeof matcher === 'string' || matcher instanceof RegExp, `${file}: ${matcher} matches a path`);
      assert.strictEqual(typeof run, 'function', `${file}: ${matcher} has something to run`);
    }
  }
  assert.ok(total > 100, `all ${total} routes are in a table`);
});

test('no two routes claim the same address and method', () => {
  const seen = new Map();
  for (const file of fs.readdirSync(path.join(ROOT, 'routes')).filter((f) => f.endsWith('.js'))) {
    const mod = require(path.join(ROOT, 'routes', file));
    for (const [method, matcher] of mod.routes || []) {
      const key = `${method} ${String(matcher)}`;
      // The first match wins, so a duplicate is a page that silently
      // never runs.
      assert.ok(!seen.has(key), `${key} is claimed by ${file} and by ${seen.get(key)}`);
      seen.set(key, file);
    }
  }
});

test('no file in the app is longer than a thousand lines', () => {
  const skip = new Set(['nspell.bundle.js']);
  const tooLong = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'data', '_to_delete', '.snap'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js') || skip.has(entry.name)) continue;
      const n = fs.readFileSync(full, 'utf8').split('\n').length;
      if (n > 1000) tooLong.push(`${path.relative(ROOT, full)} (${n})`);
    }
  };
  walk(ROOT);
  const unexpected = tooLong.filter((f) => !ALLOWED_LONG[f.replace(/ \(\d+\)$/, '')]);
  assert.deepStrictEqual(unexpected, [], 'a new file has grown past a thousand lines');

  // And the list does not rot: a file that has been split is taken off it.
  const names = new Set(tooLong.map((f) => f.replace(/ \(\d+\)$/, '')));
  for (const name of Object.keys(ALLOWED_LONG)) {
    assert.ok(names.has(name), `${name} is under a thousand lines now -- take it off the list`);
  }
});
