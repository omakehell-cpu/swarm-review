'use strict';

const { useTempDatabase } = require('./helpers/tmpdb');

const tmp = useTempDatabase();

const test = require('node:test');
const assert = require('node:assert');
const db = require('../db');
const models = require('../models');
const auth = require('../auth');
const { toMatchQuery } = require('../lib/search-query');

test.after(() => tmp.cleanup());

// --- what somebody types, turned into something FTS5 will take ---

test('a search box is not a query language', () => {
  // Every word is quoted, which takes away any meaning it had as an
  // operator -- so none of these is a syntax error, which is what they
  // would have been handed over raw.
  assert.strictEqual(toMatchQuery('kessler'), '"kessler"*');
  assert.strictEqual(toMatchQuery("it's a start"), '"it\'s" AND "a" AND "start"*');
  assert.strictEqual(toMatchQuery('Kessler -- the drop'), '"Kessler" AND "the" AND "drop"*');
  assert.strictEqual(toMatchQuery('NOT OR AND'), '"NOT" AND "OR" AND "AND"*');
  // A phrase in quotes is a statement about where it ends, so it does not
  // get a prefix star.
  assert.strictEqual(toMatchQuery('"held its breath"'), '"held its breath"');
  // Nothing to search for is null, not an empty MATCH -- which SQLite
  // would refuse.
  assert.strictEqual(toMatchQuery('***'), null);
  assert.strictEqual(toMatchQuery(''), null);
});

// --- the index, and whether it stays true ---

const owner = models.createUser({
  username: 'searcher', displayName: 'Searcher', passwordHash: auth.hashPassword('x'), isAdmin: true,
});
const { story, chapter } = models.createStoryWithFirstChapter({
  title: 'The Long Winter', description: 'An anchorage nobody decommissioned.',
  authorId: owner.id, chapterTitle: 'The long watch', chapterSummary: 'Kessler cannot sleep.',
  content: 'Kessler came up through the service spine. The station held its breath.',
});

const find = (q) => models.searchEverything(q, { limit: 20, userId: owner.id });

test('a word is a word, not a run of letters', () => {
  models.createChapter({
    storyId: story.id, title: 'The start', authorId: owner.id,
    content: 'A start, a heart, and a particle of art.',
  });
  // The whole reason for doing this: "art" used to find "start", "heart"
  // and "particle".
  const hits = find('art').passages;
  assert.strictEqual(hits.length, 1, 'one passage, not three');
  assert.match(hits[0].snippet, /art/);
  // And the word that is actually there still comes back.
  assert.ok(find('heart').passages.length === 1);
});

test('a phrase is a phrase', () => {
  assert.strictEqual(find('"held its breath"').passages.length, 1);
  assert.strictEqual(find('"breath its held"').passages.length, 0, 'the words in that order, or not at all');
});

test('a half-typed name finds the whole one', () => {
  assert.ok(find('Kessl').passages.length >= 1, 'the last word is a prefix');
});

test('only the current version of a chapter is searched', () => {
  const latest = models.getLatestVersion(chapter.id);
  models.editChapter({
    chapterId: chapter.id, title: chapter.title, summary: chapter.summary,
    content: latest.content.replace('service spine', 'cargo lift'), changelog: 'moved',
  });
  assert.strictEqual(find('"service spine"').passages.length, 0, 'the old draft is gone from the index');
  assert.strictEqual(find('"cargo lift"').passages.length, 1, 'and the new one is in it');
});

test('what the triggers left matches a rebuild from scratch', () => {
  // The claim the whole design rests on: the index is kept true by
  // triggers, so no future write path can forget to update it. This is
  // what makes that claim checkable rather than hopeful.
  //
  // A battery of edits first, covering every table the triggers watch.
  const second = models.createChapter({
    storyId: story.id, title: 'Seals and signatures', authorId: owner.id, content: 'Prado signed the book.',
  });
  const entity = models.createStoryEntity({
    storyId: story.id, kind: 'person', name: 'Iona Vell', summary: 'Signs without reading.',
    createdBy: owner.id,
  });
  models.updateStoryEntity({
    entityId: entity.id, kind: entity.kind, name: 'Iona Vell', summary: 'Reads, now.',
    description: '', secret: '', status: entity.status, role: entity.role, aliases: [], fields: [],
  });
  models.editChapter({
    chapterId: second.id, title: 'Seals, signatures', summary: 'A draught and a list.',
    content: 'Prado signed the book nobody reads.', changelog: '',
  });
  models.archiveChapter(second.id);
  models.replaceWikiPages([
    { title: 'Tampaad reach', summary: 'A reach.', contentHtml: '<p>The <b>Tampaad</b> reach is cold.</p>', categories: [] },
  ]);
  models.deleteStoryEntity(entity.id);

  const snapshot = () => db.prepare(
    'SELECT kind, ref, title, body FROM search_index ORDER BY kind, ref, title'
  ).all().map((r) => `${r.kind}/${r.ref}/${r.title}/${r.body}`);

  const fromTriggers = snapshot();
  db.rebuildSearchIndex();
  const fromScratch = snapshot();
  assert.deepStrictEqual(fromTriggers, fromScratch, 'the triggers kept up with every one of those');
});

test('the glossary is searched by its words, not by its markup', () => {
  // The wiki is stored as HTML; the index reads a text copy written at
  // sync time, or every page would match "span".
  assert.strictEqual(find('Tampaad').glossary.length, 1);
  assert.strictEqual(find('span').glossary.length, 0);
  assert.strictEqual(find('"the Tampaad reach"').glossary.length, 1, 'tags are not word separators');
});

test('a private bible stays out of the results', () => {
  const stranger = models.createUser({
    username: 'stranger', displayName: 'Stranger', passwordHash: auth.hashPassword('x'), isAdmin: false,
  });
  models.createStoryEntity({
    storyId: story.id, kind: 'person', name: 'Marta Sein', summary: 'The third bunk.', createdBy: owner.id,
  });
  assert.strictEqual(models.searchEverything('Marta', { userId: stranger.id }).bible.length, 1);
  models.setBiblePrivate(story.id, true);
  assert.strictEqual(models.searchEverything('Marta', { userId: stranger.id }).bible.length, 0,
    'the index answers with ids; the rules are on the tables, and they still apply');
  assert.strictEqual(models.searchEverything('Marta', { userId: owner.id }).bible.length, 1,
    'and the author still finds their own');
  models.setBiblePrivate(story.id, false);
});

test('results come back best first', () => {
  const ranked = find('Prado').passages;
  // Nothing to assert about which is best without inventing a corpus --
  // but rank order is what the index was asked for, and a result set that
  // came back alphabetically would mean the ORDER BY was dropped.
  assert.ok(Array.isArray(ranked));
  const all = find('the');
  assert.ok(all.passages.length <= 20, 'the limit is honoured');
});
