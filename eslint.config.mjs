// Lint rules for Swarm Review.
//
// The point of this file is narrow: catch the class of bug that ships
// silently. A typo in a variable name inside a rarely-taken branch of
// public/js/ doesn't crash the server, doesn't fail a page load, and
// doesn't show up until a writer hits that branch and the editor quietly
// stops working. `no-undef` catches exactly that, which is why the browser
// and server blocks below declare their globals separately instead of
// lumping everything together -- a server file reaching for `document`, or
// a browser file reaching for `require`, is a real mistake and should read
// as one.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'data/**',
      '_to_delete/**',
      // Throwaway renderings of the app's own pages, used to look at the
      // design; they are copies of files already linted where they live.
      '_review-snapshots/**',
      '.snap/**',
      // Vendored, minified, and not ours to fix.
      'public/js/nspell.bundle.js',
    ],
  },

  js.configs.recommended,

  {
    // Everything that runs under node: the server, lib/, the tests.
    files: ['*.js', 'lib/**/*.js', 'views/**/*.js', 'models/**/*.js', 'routes/**/*.js', 'test/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  {
    // The one file that runs in a worker rather than in the page: no
    // document, no window of its own, and importScripts instead of a
    // <script> tag.
    files: ['public/js/wa-worker.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.worker },
    },
  },

  {
    // Everything shipped to the browser. No bundler, no modules: these are
    // plain <script> files, each wrapped in its own IIFE.
    files: ['public/js/**/*.js'],
    ignores: ['public/js/wa-worker.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: {
      // Browser code ships to readers, so a stray debug line is a leak, not
      // a note to self. The two deliberate `console.error` calls in
      // writing-analyzer.js carry their own disable comments.
      'no-console': 'error',
    },
  },

  {
    rules: {
      // An unused argument named `_thing` is documentation -- it says what
      // the callback is handed even when this one ignores it. An unused
      // local, on the other hand, is usually a leftover from an edit that
      // didn't finish.
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        // `catch (err) {}` where the error is deliberately swallowed is a
        // real pattern here -- optional parsing, best-effort cleanup, the
        // analyzer refusing to take the editor down with it. Flagging all
        // twenty of them would drown the one unused *variable* that
        // actually means an edit stopped half-way.
        caughtErrors: 'none',
      }],
      // `catch {}` that swallows an error on purpose is a legitimate
      // pattern here (optional parsing, best-effort cleanup), so an empty
      // catch is allowed and an empty anything-else is not.
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-implicit-globals': 'error',
      'no-throw-literal': 'error',
    },
  },
];
