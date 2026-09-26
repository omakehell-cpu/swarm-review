// Tags grouped the way StoriesOnline groups them: its fourteen categories,
// then the group's own; old groups folded in; new tags filed where they go.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { categoryFor, SOL_CATEGORIES, TAG_GROUPS } = require('../lib/sol-tags');

test('a code goes where StoriesOnline files it', () => {
  assert.strictEqual(categoryFor('Ma/Fa'), 'Age/Gender');
  assert.strictEqual(categoryFor('Ma/ft'), 'Age/Gender', 'any x/y pairing');
  assert.strictEqual(categoryFor('Harem'), 'Groups');
  assert.strictEqual(categoryFor('Heterosexual'), 'Sexual Orientations');
  assert.strictEqual(categoryFor('Science Fiction'), 'Science Fiction');
  assert.strictEqual(categoryFor('Aliens'), 'Science Fiction');
  assert.strictEqual(categoryFor('Alien'), 'Science Fiction', 'singular or plural');
  assert.strictEqual(categoryFor('Humor'), 'Story Types');
  assert.strictEqual(categoryFor('Romance'), 'Story Types', 'a genre is a story type');
  assert.strictEqual(categoryFor('Something unheard of'), 'Other');
  assert.strictEqual(SOL_CATEGORIES.length, 14);
  assert.deepStrictEqual(TAG_GROUPS.slice(-4), ['Swarm', 'Cast', 'Length', 'Review status']);
});

test('the vocabulary follows the categories, and the old groups are folded in', async () => {
  const { startApp } = require('./helpers/app');
  const app = await startApp();
  try {
    const models = app.models;
    const names = models.listTagGroupNames();
    assert.deepStrictEqual(names.slice(0, 14), SOL_CATEGORIES, 'every category, empty ones too, in order');
    const grouped = models.listTagsGrouped().map((g) => g.group);
    for (const old of ['Pairings', 'Orientation', 'Genre', 'Setting', 'Content notes']) {
      assert.ok(!grouped.includes(old), `${old} is folded into the categories`);
    }
    const byName = (n) => models.listTags().find((t) => t.name === n);
    if (byName('Ma/Fa')) assert.strictEqual(byName('Ma/Fa').tag_group, 'Age/Gender');
    if (byName('Space')) assert.strictEqual(byName('Space').tag_group, 'Science Fiction');
    if (byName('Confederacy')) assert.strictEqual(byName('Confederacy').tag_group, 'Swarm', 'the group\'s own stay');
    const t = models.proposeTag({ name: 'Aliens', userId: null });
    assert.strictEqual(models.approveTag(t.id).tag_group, 'Science Fiction', 'approved with no group: filed where it goes');
  } finally {
    await app.stop();
  }
});
