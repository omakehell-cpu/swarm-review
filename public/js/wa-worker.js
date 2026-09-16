// The writing checks, run off the main thread.
//
// This does not reimplement anything. It loads writing-analyzer.js -- the
// same file the page loads -- inside a worker, where there is no DOM, so
// the half of that file that draws things never starts and the half that
// reads text is all that runs. The test suite already does exactly this
// with a vm sandbox (see test/writing-checks.test.js), which is how we
// know the analysis half stands on its own.
//
// Why bother: the checks and a real spellchecker over four thousand words
// is enough work to be felt between one keystroke and the next. It is the
// same work either way; this is about which thread does it.

// A worker's global is `self`. The analyzer looks for `window` and, at
// load time only, for a document and for localStorage. None of them are
// used by anything this file asks for.
self.window = self;
// Cast: these are the smallest shapes the analyzer touches at load time,
// not implementations of the real interfaces, and the checker is right
// that they are not.
self.document = /** @type {any} */ ({
  readyState: 'complete',
  addEventListener() {},
  createElement: () => ({ style: { setProperty() {} }, classList: { add() {} }, appendChild() {} }),
  createTextNode: (t) => ({ textContent: t }),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  body: { appendChild() {} },
  documentElement: { style: { setProperty() {} } },
});
self.localStorage = /** @type {any} */ ({ getItem: () => null, setItem() {} });
self.matchMedia = /** @type {any} */ (() => ({ matches: false, addEventListener() {} }));

importScripts('/js/nspell.bundle.js', '/js/writing-analyzer.js');

const wa = self.__writingAnalyzer;

// The dictionary is fetched once, here, rather than on the page: a
// 544KB parse is exactly the kind of thing the main thread should not be
// doing. Until it lands the other checks run without spelling, which is
// what the page did before this file existed.
const ready = wa.loadDictionary().catch(() => {});

self.onmessage = async (event) => {
  const { id, text, storyWords, settings, commentRanges } = event.data || {};
  try {
    await ready;
    const words = storyWords instanceof Set ? storyWords : new Set(storyWords || []);
    const result = wa.analyze(text, words, settings, commentRanges || null);
    // `id` goes back untouched: the page throws away anything that is not
    // the answer to its latest question.
    self.postMessage({ id, ok: true, html: result.html, ranges: result.ranges, stats: result.stats });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
