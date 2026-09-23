'use strict';

const { layout } = require('../lib/layout');
const { escapeHtml } = require('../lib/util');
const { parseMarkdown, renderHighlighted } = require('../lib/markdown');
const { docs } = require('./shared');
// Two pages of writing about the app rather than in it. They are markdown
// files in docs/, rendered with the same parser chapters use, so a how-to
// is written the way everything else here is written.

// A release is dated to the day, not to an instant, so it is written out
// plainly rather than through timeHtml -- there is no "3h ago" to be had
// from a date, and no clock reading to localise.
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function releaseDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return escapeHtml(String(iso || ''));
  return `${MONTH_NAMES[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}


// Prose and pictures alternate; the prose goes through the same renderer
// chapters use, and the pictures never touch it (see lib/docs.js for why).
function docBody(markdown) {
  const parts = docs.splitFigures(markdown).map((part) => (part.type === 'figure'
    ? `<figure class="doc-figure">
         <img src="${escapeHtml(part.src)}" alt="${escapeHtml(part.caption)}" loading="lazy">
         ${part.caption ? `<figcaption>${escapeHtml(part.caption)}</figcaption>` : ''}
       </figure>`
    : renderHighlighted(parseMarkdown(part.value), [], null))).join('');
  return `<div class="reading-pane doc-body">${parts}</div>`;
}

function helpIndexPage({ user, topics = [], releases = [], unread = false }) {
  const rows = topics.map((t) => `
    <a class="chapter-row" href="/help/${escapeHtml(t.slug)}">
      <div class="chapter-row-main">
        <h2 class="row-title">${escapeHtml(t.title)}</h2>
        ${t.summary ? `<p class="muted">${escapeHtml(t.summary)}</p>` : ''}
      </div>
    </a>`).join('');
  const latest = releases[0];
  return layout({
    title: 'Help',
    user,
    current: 'help',
    body: `
      <div class="page-head"><h1>How to</h1></div>
      <p class="muted">What each part of the site is for, and how to get it to do what you want. Nothing here is a manual you have to read: take the one page you need and close the rest.</p>
      <div class="chapter-list">${rows || '<p class="muted">No how-tos yet.</p>'}</div>
      ${latest ? `
        <a class="chapter-row changelog-row" href="/help/changelog">
          <div class="chapter-row-main">
            <h2 class="row-title">What's new ${unread ? '<span class="badge new">New</span>' : ''}</h2>
            <p class="muted">Every change to the site, newest first. Latest: ${escapeHtml(latest.heading || latest.date)}.</p>
          </div>
          <div class="chapter-row-meta"><span>${releaseDate(latest.date)}</span></div>
        </a>` : ''}`,
  });
}

function helpTopicPage({ user, topic, topics = [] }) {
  const index = topics.findIndex((t) => t.slug === topic.slug);
  const previous = index > 0 ? topics[index - 1] : null;
  const next = index >= 0 && index < topics.length - 1 ? topics[index + 1] : null;
  return layout({
    title: topic.title,
    user,
    current: 'help',
    body: `
      <p class="breadcrumb"><a href="/help">&larr; How to</a></p>
      <div class="page-head"><h1>${escapeHtml(topic.title)}</h1></div>
      ${docBody(topic.body || topic.markdown)}
      <nav class="doc-nav">
        ${previous ? `<a href="/help/${escapeHtml(previous.slug)}">&larr; ${escapeHtml(previous.title)}</a>` : '<span></span>'}
        ${next ? `<a href="/help/${escapeHtml(next.slug)}">${escapeHtml(next.title)} &rarr;</a>` : '<span></span>'}
      </nav>`,
  });
}


// Releases the reader has not seen are marked rather than hidden: the
// point of a changelog is that you can also read the ones you have.
function changelogPage({ user, releases = [], unseen = new Set() }) {
  const isNew = (release) => unseen.has(docs.releaseKey(release));
  const sections = releases.map((release) => `
    <section class="release${isNew(release) ? ' unseen' : ''}" id="${docs.releaseAnchor(release)}">
      <h2 class="release-head">
        <span class="release-date">${releaseDate(release.date)}</span>
        ${release.heading ? `<span class="release-title">${escapeHtml(release.heading)}</span>` : ''}
        ${isNew(release) ? '<span class="badge new">New to you</span>' : ''}
      </h2>
      ${docBody(release.markdown)}
    </section>`).join('');
  return layout({
    title: "What's new",
    user,
    current: 'whats-new',
    body: `
      <div class="page-head"><h1>What's new</h1></div>
      <p class="muted">Every change to the site, newest first, in plain language. Anything published since you last looked is marked. The dates are when the work was done -- if something here is missing on the site, it has not been restarted yet.</p>
      ${sections || '<p class="muted">Nothing recorded yet.</p>'}`,
  });
}

// ---------- archived stories ----------

module.exports = {
  MONTH_NAMES,
  changelogPage,
  docBody,
  helpIndexPage,
  helpTopicPage,
  releaseDate,
};
