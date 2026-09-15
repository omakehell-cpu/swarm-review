// The one rule in this app that nobody sets and nobody can forget to
// unset: a story is on hiatus when nobody has written in it for half a
// year. It is worth its own test precisely because it is derived -- there
// is no row anywhere to look at and say "well, that's what it says".
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { storyState, HIATUS_DAYS } = require('../lib/story-state');

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().replace('T', ' ').slice(0, 19);

test('a story written in recently is ongoing', () => {
  assert.strictEqual(storyState({ status: 'ongoing', last_written_at: daysAgo(3) }), 'ongoing');
  assert.strictEqual(storyState({ status: 'ongoing', last_written_at: daysAgo(HIATUS_DAYS - 1) }), 'ongoing');
});

test('half a year of silence is a hiatus, and nobody had to say so', () => {
  assert.strictEqual(storyState({ status: 'ongoing', last_written_at: daysAgo(HIATUS_DAYS + 1) }), 'hiatus');
  // A revision counts as writing in it, which is why the rule reads the
  // last version rather than the last chapter.
  assert.strictEqual(
    storyState({ status: 'ongoing', last_written_at: daysAgo(2), last_chapter_at: daysAgo(400) }),
    'ongoing'
  );
});

test('finished and abandoned stories are not paused -- they are over', () => {
  assert.strictEqual(storyState({ status: 'complete', last_written_at: daysAgo(900) }), 'complete');
  assert.strictEqual(storyState({ status: 'dropped', last_written_at: daysAgo(900) }), 'dropped');
});

test('a story nobody has written in at all is judged from the day it started', () => {
  assert.strictEqual(storyState({ status: 'ongoing', created_at: daysAgo(2) }), 'ongoing');
  assert.strictEqual(storyState({ status: 'ongoing', created_at: daysAgo(400) }), 'hiatus');
});

test('a status the app does not know is treated as ongoing, not as itself', () => {
  assert.strictEqual(storyState({ status: 'pending-vibes', last_written_at: daysAgo(1) }), 'ongoing');
  assert.strictEqual(storyState({ last_written_at: daysAgo(1) }), 'ongoing');
  assert.strictEqual(storyState(null), 'ongoing');
});
