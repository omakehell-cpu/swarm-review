'use strict';

// The worker is not a second copy of the checks -- it loads the same file
// the page loads, in a place with no DOM. That claim is the whole design,
// so it is worth a test: this evaluates wa-worker.js the way a browser
// would, with importScripts pointed at the real files, and asks it the
// same question the page asks.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.join(__dirname, '..', 'public', 'js');
const read = (name) => fs.readFileSync(path.join(JS_DIR, name), 'utf8');

function startWorker() {
  const sandbox = { console };
  /** @type {any} */ (sandbox).self = sandbox;
  // No network in here, so the dictionary never arrives and spelling
  // stays off -- exactly as it does in a browser before the fetch lands.
  /** @type {any} */ (sandbox).fetch = () => Promise.resolve({ ok: false, text: () => Promise.resolve('') });
  /** @type {any} */ (sandbox).importScripts = (...urls) => {
    for (const url of urls) vm.runInContext(read(path.basename(url)), sandbox, { filename: url });
  };
  const sent = [];
  /** @type {any} */ (sandbox).postMessage = (msg) => sent.push(msg);
  vm.createContext(sandbox);
  vm.runInContext(read('wa-worker.js'), sandbox, { filename: 'wa-worker.js' });
  return {
    sandbox,
    sent,
    async ask(data) {
      await /** @type {any} */ (sandbox).onmessage({ data });
      return sent[sent.length - 1];
    },
  };
}

const ALL_CHECKS = (worker) => {
  const settings = {};
  for (const id of worker.sandbox.self.__writingAnalyzer.CHECK_ORDER) settings[id] = true;
  return settings;
};

test('the worker loads the analyzer and answers with what it found', async () => {
  const worker = startWorker();
  const text = 'The door was opened by Kessler. He walked very quietly to the hatch.';
  const reply = await worker.ask({ id: 7, text, storyWords: [], settings: ALL_CHECKS(worker) });

  assert.strictEqual(reply.ok, true);
  // The id comes back untouched: it is how the page throws away the
  // answer to a question it has already moved on from.
  assert.strictEqual(reply.id, 7);
  assert.ok(reply.html.length > 0, 'the overlay markup');
  assert.ok(Array.isArray(reply.ranges), 'the marks');
  assert.strictEqual(reply.stats.passive, 1, 'the passive it was given');
  assert.strictEqual(reply.stats.adverb, 1, 'and the propped-up verb');
});

test('the worker and the page agree, because they are the same code', async () => {
  const worker = startWorker();
  const text = 'It was decided by the committee. She smiled happily and was seen by nobody at all.';
  const settings = ALL_CHECKS(worker);
  const reply = await worker.ask({ id: 1, text, storyWords: [], settings });

  // The in-page path, called directly through the same seam.
  const here = worker.sandbox.self.__writingAnalyzer.analyze(text, new Set(), settings, null);
  assert.strictEqual(reply.html, here.html);
  assert.deepStrictEqual(Array.from(reply.ranges), Array.from(here.ranges));
  assert.deepStrictEqual({ ...reply.stats }, { ...here.stats });
});

test('the story dictionary survives the trip as a list', async () => {
  // A Set does not always cross a postMessage boundary intact, so the
  // page sends an array and the worker builds the Set back.
  const worker = startWorker();
  const text = 'Kessler walked to the Akarge hatch.';
  const settings = ALL_CHECKS(worker);
  const reply = await worker.ask({ id: 2, text, storyWords: ['Kessler', 'Akarge'], settings });
  assert.strictEqual(reply.ok, true);
  assert.ok(!reply.ranges.some((r) => r.kind === 'spell'), 'no invented name is marked as a misspelling');
});

test('a question the analyzer cannot answer comes back as a failure, not a silence', async () => {
  const worker = startWorker();
  // settings is read by analyze(); null text is what a broken caller sends.
  const reply = await worker.ask({ id: 3, text: null, storyWords: [], settings: null });
  assert.strictEqual(reply.id, 3);
  // Either it coped or it reported -- what it must not do is answer
  // nothing at all, because the page is waiting on that id.
  assert.ok(reply.ok === true || typeof reply.error === 'string');
});
