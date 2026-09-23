'use strict';

// An Atom feed, built by hand, because the alternative is a dependency for
// three hundred bytes of angle brackets.
//
// Why a feed at all: this is a review site where a note can sit on your
// chapter for a week without anybody knowing. The honest ways to fix that
// are email, which would make this the only part of the app that reaches
// out to the network, and a feed, which sits still until somebody's reader
// comes and asks for it. This is the second one.

// Atom is XML, and XML is not HTML: an apostrophe inside an attribute
// matters, and a stray & is a parse error rather than a wrong-looking
// character. Everything that goes in goes through here.
function escapeXml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Readers keep what they have seen by id, so an id has to mean one thing
// for ever. These are built from what the row is and which row it is --
// never from a position in a list, which changes under you.
function tagUri(host, kind, id) {
  return `tag:${String(host || 'swarm-review').split(':')[0]},2026:${kind}/${id}`;
}

function rfc3339(value) {
  if (!value) return new Date(0).toISOString().replace(/\.\d{3}Z$/, 'Z');
  // SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker. Read
  // as-is it becomes local time, which puts every entry an hour or two out
  // twice a year.
  const text = String(value);
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return new Date(0).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** A plain-text summary, trimmed to something a reader can show in a list. */
function excerpt(text, limit = 300) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1).replace(/\s+\S*$/, '')}…`;
}

/**
 * @param {{ origin: string, selfUrl: string, title: string, subtitle?: string,
 *           updated?: string|null, authorName?: string,
 *           entries: Array<{ id: string, title: string, url: string, updated: string|null,
 *                            summary?: string, authorName?: string }> }} feed
 */
function buildAtom({ origin, selfUrl, title, subtitle = '', updated = null, authorName = '', entries = [] }) {
  const host = String(origin || '').replace(/^https?:\/\//, '');
  // The feed's own updated stamp is the newest thing in it. A feed that
  // says "now" every time it is fetched tells a reader nothing.
  const newest = updated || entries.reduce((max, e) => (e.updated && e.updated > max ? e.updated : max), '');
  const body = entries.map((entry) => `
  <entry>
    <id>${escapeXml(entry.id)}</id>
    <title>${escapeXml(entry.title)}</title>
    <link rel="alternate" type="text/html" href="${escapeXml(entry.url)}"/>
    <updated>${escapeXml(rfc3339(entry.updated))}</updated>${entry.authorName ? `
    <author><name>${escapeXml(entry.authorName)}</name></author>` : ''}
    <summary type="text">${escapeXml(entry.summary || entry.title)}</summary>
  </entry>`).join('');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${escapeXml(tagUri(host, 'feed', selfUrl.split('/').pop() || 'feed'))}</id>
  <title>${escapeXml(title)}</title>${subtitle ? `
  <subtitle>${escapeXml(subtitle)}</subtitle>` : ''}
  <updated>${escapeXml(rfc3339(newest))}</updated>
  <link rel="self" type="application/atom+xml" href="${escapeXml(selfUrl)}"/>
  <link rel="alternate" type="text/html" href="${escapeXml(origin)}/"/>${authorName ? `
  <author><name>${escapeXml(authorName)}</name></author>` : ''}
  <generator>Swarm Review</generator>${body}
</feed>
`;
}

module.exports = { buildAtom, escapeXml, excerpt, rfc3339, tagUri };
