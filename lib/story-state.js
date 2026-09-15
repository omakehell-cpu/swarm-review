// lib/story-state.js -- where a story is, in one word.
//
// Three of the four words are a decision somebody made and are stored on
// the story: ongoing, complete, dropped. The fourth is not a decision and
// is not stored: a story is on hiatus when nobody has written in it for
// half a year, which the dates already know. Storing that one would make
// it wrong the moment somebody posted a chapter, and would leave a person
// having to remember to take it off -- exactly the kind of state that
// ends up lying to everybody who reads it.
//
// Finished and abandoned stories never go on hiatus. They are not paused;
// they are over.
'use strict';

const HIATUS_DAYS = 183;

const STORY_STATES = {
  ongoing: { label: 'Ongoing', hint: 'Being written.' },
  hiatus: { label: 'On hiatus', hint: 'Nothing new in six months.' },
  complete: { label: 'Complete', hint: 'Finished. Nothing more is coming.' },
  dropped: { label: 'Dropped', hint: 'The author has stopped work on it.' },
};

// The three a person can choose, in the order they appear in the form.
const CHOOSABLE_STORY_STATES = ['ongoing', 'complete', 'dropped'];

/** SQLite writes 'YYYY-MM-DD HH:MM:SS' in UTC and no timezone marker. */
function parseSqliteDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * @param {{ status?: string, last_written_at?: string|null, last_chapter_at?: string|null, created_at?: string }} story
 * @param {Date} [now]
 */
function storyState(story, now = new Date()) {
  if (!story) return 'ongoing';
  const declared = CHOOSABLE_STORY_STATES.includes(story.status) ? story.status : 'ongoing';
  if (declared !== 'ongoing') return declared;
  const last = parseSqliteDate(story.last_written_at || story.last_chapter_at || story.created_at);
  if (!last) return 'ongoing';
  const days = (now.getTime() - last.getTime()) / 86400000;
  return days >= HIATUS_DAYS ? 'hiatus' : 'ongoing';
}

// What a chapter is asking of the people reading it. A separate, shorter
// vocabulary from the story's: "this chapter is dropped" would not mean
// anything, and a chapter that wants notes inside a finished story is a
// perfectly ordinary thing.
//
// 'notes' is the default because it is why a chapter goes up in a
// workshop at all -- which means the label is worth showing only when it
// says something else. Fifteen rows all saying "wants notes" is not
// information.
const CHAPTER_STAGES = ['draft', 'notes', 'settled'];
const DEFAULT_CHAPTER_STAGE = 'notes';

const CHAPTER_STAGE_META = {
  draft: { label: 'Draft', hint: "Still moving -- read it, but don't line-edit it yet." },
  notes: { label: 'Wants notes', hint: 'Open for comments. This is the normal state of a chapter here.' },
  settled: { label: 'Settled', hint: 'Done with. No need to comment on it.' },
};

module.exports = {
  storyState,
  STORY_STATES,
  CHOOSABLE_STORY_STATES,
  HIATUS_DAYS,
  CHAPTER_STAGES,
  DEFAULT_CHAPTER_STAGE,
  CHAPTER_STAGE_META,
};
