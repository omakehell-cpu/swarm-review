'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildAtom, escapeXml, excerpt, rfc3339, tagUri } = require('../lib/feed');

test('XML is escaped, including the two HTML gets away with', () => {
  assert.strictEqual(escapeXml('a & b'), 'a &amp; b');
  assert.strictEqual(escapeXml('<b>'), '&lt;b&gt;');
  // These two are the difference between XML and HTML escaping, and the
  // reason a feed built with an HTML escaper breaks on somebody's
  // apostrophe inside an attribute.
  assert.strictEqual(escapeXml(`it's "here"`), 'it&apos;s &quot;here&quot;');
  assert.strictEqual(escapeXml(null), '');
});

test("SQLite's naive timestamps are read as UTC, not as local time", () => {
  // No zone marker on the way in; a Z on the way out, and the same hour.
  assert.strictEqual(rfc3339('2026-09-16 05:28:00'), '2026-09-16T05:28:00Z');
  assert.strictEqual(rfc3339('2026-09-16T05:28:00Z'), '2026-09-16T05:28:00Z');
  // Nothing, or nonsense, still has to produce a valid date: a feed with
  // a broken <updated> is a feed no reader will accept.
  assert.match(rfc3339(null), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(rfc3339('not a date'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('an excerpt cuts on a word and says that it cut', () => {
  assert.strictEqual(excerpt('short enough'), 'short enough');
  const long = excerpt('word '.repeat(200), 40);
  assert.ok(long.length <= 40);
  assert.ok(long.endsWith('…'));
  assert.strictEqual(excerpt('line\n\nbreaks   collapse'), 'line breaks collapse');
});

test('an id names one row for ever, never a position in a list', () => {
  const a = tagUri('swarm.example:3000', 'reply', 'reply/12');
  assert.strictEqual(a, 'tag:swarm.example,2026:reply/reply/12');
  // The port is not part of an identity: the same app behind a different
  // port is the same app, and entries must not all come back unread.
  assert.strictEqual(tagUri('swarm.example:8080', 'reply', 'reply/12'), a);
});

test('the feed is well formed, and its updated stamp is the newest entry', () => {
  const xml = buildAtom({
    origin: 'http://swarm.example',
    selfUrl: 'http://swarm.example/feed/abc.atom',
    title: 'The Swarm Review',
    subtitle: 'What is waiting on Ana',
    entries: [
      { id: 'tag:a', title: 'Older', url: 'http://swarm.example/chapters/1', updated: '2026-09-10 10:00:00', summary: 'one' },
      { id: 'tag:b', title: 'Newer', url: 'http://swarm.example/chapters/2', updated: '2026-09-14 10:00:00', summary: 'two', authorName: 'Luis' },
    ],
  });
  assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>/);
  assert.match(xml, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  // Not "now": a feed that says it changed on every fetch tells a reader
  // nothing at all.
  assert.match(xml, /<updated>2026-09-14T10:00:00Z<\/updated>/);
  assert.strictEqual((xml.match(/<entry>/g) || []).length, 2);
  assert.match(xml, /<link rel="self" type="application\/atom\+xml" href="http:\/\/swarm\.example\/feed\/abc\.atom"\/>/);
  assert.match(xml, /<author><name>Luis<\/name><\/author>/);
  // Every tag that opens, closes.
  for (const tag of ['feed', 'title', 'updated', 'id', 'entry', 'summary']) {
    assert.strictEqual(
      (xml.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length,
      (xml.match(new RegExp(`</${tag}>`, 'g')) || []).length,
      `${tag} is balanced`
    );
  }
});

test('an empty feed is still a feed', () => {
  const xml = buildAtom({ origin: 'http://x.test', selfUrl: 'http://x.test/feed/a.atom', title: 'T', entries: [] });
  assert.ok(!xml.includes('<entry>'));
  assert.match(xml, /<updated>\d{4}-\d{2}-\d{2}T/);
});
