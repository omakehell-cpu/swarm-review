// lib/time.js -- renders SQLite timestamps (stored as UTC "YYYY-MM-DD
// HH:MM:SS" with no timezone marker) as a <time> element: a UTC fallback
// as the visible text (correct even without JS, and for any viewer's
// timezone at a glance) plus a machine-readable datetime attribute that
// public/js/timestamps.js upgrades to the viewer's local time / a relative
// "3h ago" once the page loads. Kept server-side rendering + a small
// client script rather than a timezone library, in line with the rest of
// this app's zero-dependency approach.
'use strict';

function parseSqliteUtc(sqliteTs) {
  if (!sqliteTs) return null;
  const iso = sqliteTs.includes('T') ? sqliteTs : sqliteTs.replace(' ', 'T');
  const withZone = iso.endsWith('Z') ? iso : `${iso}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(sqliteTs) {
  const d = parseSqliteUtc(sqliteTs);
  return d ? d.toISOString() : '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function humanUtc(sqliteTs) {
  const d = parseSqliteUtc(sqliteTs);
  if (!d) return '';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

function timeHtml(sqliteTs, className) {
  if (!sqliteTs) return '';
  const iso = toIso(sqliteTs);
  if (!iso) return '';
  const cls = className ? ` ${className}` : '';
  return `<time class="ts${cls}" datetime="${iso}">${humanUtc(sqliteTs)}</time>`;
}

// True if `sqliteTs` is strictly after `sinceSqliteTs` -- used to decide
// whether to show a "New" badge relative to a user's last_seen_at.
function isAfter(sqliteTs, sinceSqliteTs) {
  const a = parseSqliteUtc(sqliteTs);
  const b = parseSqliteUtc(sinceSqliteTs);
  if (!a || !b) return false;
  return a.getTime() > b.getTime();
}

module.exports = { parseSqliteUtc, toIso, humanUtc, timeHtml, isAfter };
