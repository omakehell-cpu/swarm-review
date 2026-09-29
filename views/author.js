'use strict';

// Somebody's page: who they are, and their writing shown as a body of
// work -- the newest thing first, large, then everything from the first
// story on, with its dates, its face and a line of what it is about; when
// they wrote, and what about; and how far it has reached. No reading
// history: what somebody has read is between them and whoever wrote it.

const { layout } = require('../lib/layout');
const { storyCover } = require('./story-nav');
const { escapeHtml } = require('../lib/util');
const { timeHtml } = require('../lib/time');
const { wordCount } = require('./shared');
const front = require('./front');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (d) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(d || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
};
function dateSpan(w) {
  const from = monthYear(w.started_at);
  const to = monthYear(w.last_chapter_at);
  return !to || to === from ? from : `${from} &ndash; ${to}`;
}
const compact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 10000) return `${Math.round(v / 1000)}k`;
  return v.toLocaleString('en-GB');
};

function cover(w, cls) {
  return storyCover(w, cls, { author: '' });
}

// ---------- the numbers ----------

function metrics(stats, reach, works) {
  const cell = (value, label, hint = '') => `
    <div class="author-metric"${hint ? ` title="${escapeHtml(hint)}"` : ''}>
      <span class="author-metric-value">${value}</span>
      <span class="author-metric-label">${label}</span>
    </div>`;
  const finished = works.filter((w) => w.status === 'complete').length;
  return `
    <div class="author-metrics" role="list">
      ${[
    cell(works.length, `stor${works.length === 1 ? 'y' : 'ies'}`, `${finished} finished`),
    cell(compact(stats.chapters), `chapter${stats.chapters === 1 ? '' : 's'}`),
    cell(compact(stats.words), 'words'),
    cell(compact(reach.readers), `reader${reach.readers === 1 ? '' : 's'}`, 'Different people who have read a chapter of theirs'),
    cell(compact(reach.followers), `follower${reach.followers === 1 ? '' : 's'}`, 'Different people following a story of theirs'),
    cell(compact(stats.commentsWritten), 'notes given'),
    cell(compact(stats.commentsReceived), 'notes received'),
  ].map((c) => c.replace('<div class="author-metric"', '<div role="listitem" class="author-metric"')).join('')}
    </div>`;
}

// ---------- when they wrote ----------

// One series, one ink: bars of words put up per month (or year), the
// biggest labelled, every bar named on hover, and the same numbers as a
// table underneath for anyone who would rather read them.
function outputChart(output) {
  const { buckets, unit } = output;
  if (!buckets.length || !buckets.some((b) => b.words)) return '';
  const W = 640; const H = 180; const top = 16; const bottom = 26;
  const max = Math.max(...buckets.map((b) => b.words));
  const step = W / buckets.length;
  const bar = Math.max(3, Math.min(28, step * 0.62));
  const y = (v) => top + (H - top - bottom) * (1 - v / max);
  const peak = buckets.findIndex((b) => b.words === max);
  const every = Math.max(1, Math.ceil(buckets.length / 8));
  const bars = buckets.map((b, i) => {
    const x = i * step + (step - bar) / 2;
    const h = b.words ? Math.max(2, H - bottom - y(b.words)) : 0;
    return `
      <g class="out-bar${i === peak ? ' is-peak' : ''}">
        <title>${escapeHtml(b.label)}: ${b.words.toLocaleString('en-GB')} words in ${b.chapters} chapter${b.chapters === 1 ? '' : 's'}</title>
        <rect class="out-hit" x="${(i * step).toFixed(1)}" y="${top}" width="${step.toFixed(1)}" height="${H - top - bottom}"></rect>
        ${h ? `<rect class="out-fill" x="${x.toFixed(1)}" y="${(H - bottom - h).toFixed(1)}" width="${bar.toFixed(1)}" height="${h.toFixed(1)}"></rect>` : ''}
        ${i % every === 0 || i === buckets.length - 1 ? `<text class="out-tick" x="${(i * step + step / 2).toFixed(1)}" y="${H - 8}">${escapeHtml(unit === 'year' ? b.label : b.label.replace(/ (\d{2})(\d{2})$/, " '$2"))}</text>` : ''}
        ${i === peak ? `<text class="out-peak" x="${(i * step + step / 2).toFixed(1)}" y="${(H - bottom - h - 5).toFixed(1)}">${compact(b.words)}</text>` : ''}
      </g>`;
  }).join('');
  return `
    <figure class="author-chart">
      <figcaption><h3>Words put up, ${unit === 'year' ? 'year' : 'month'} by ${unit === 'year' ? 'year' : 'month'}</h3></figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Words put up per ${unit}; the most was ${compact(max)} in ${escapeHtml(buckets[peak].label)}" class="out-svg">
        <line class="out-base" x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}"></line>
        ${bars}
      </svg>
      <details class="chart-table">
        <summary>As a table</summary>
        <table><thead><tr><th scope="col">${unit === 'year' ? 'Year' : 'Month'}</th><th scope="col">Words</th><th scope="col">Chapters</th></tr></thead>
        <tbody>${buckets.filter((b) => b.words).map((b) => `<tr><th scope="row">${escapeHtml(b.label)}</th><td>${b.words.toLocaleString('en-GB')}</td><td>${b.chapters}</td></tr>`).join('')}</tbody></table>
      </details>
    </figure>`;
}

function tagBars(tags, total) {
  if (!tags.length) return '';
  const max = Math.max(...tags.map((t) => t.n));
  return `
    <div class="author-tags">
      <h3>What their stories are about</h3>
      <ul class="tag-bars">
        ${tags.map((t) => `
          <li>
            <a href="/tags/${encodeURIComponent(t.slug)}">${escapeHtml(t.name)}</a>
            <span class="tag-bar" aria-hidden="true"><span style="width:${Math.round((t.n / max) * 100)}%"></span></span>
            <span class="tag-bar-n">${t.n}<span class="sr-only"> of ${total} stories</span></span>
          </li>`).join('')}
      </ul>
    </div>`;
}

// ---------- the work ----------

function featured(w, person) {
  const size = [`${w.chapter_count} chapter${w.chapter_count === 1 ? '' : 's'}`, w.word_count ? wordCount(w.word_count) : ''].filter(Boolean).join(' &middot; ');
  return `
    <article class="author-featured story-row">
      ${cover(w, 'author-featured-cover')}
      <div class="author-featured-body">
        <p class="author-kicker">Latest work</p>
        <h2 class="author-featured-title"><a class="row-link" href="/stories/${w.id}">${escapeHtml(w.title)}</a></h2>
        <p class="author-work-facts">${front.stateLabel(w)} <span>${dateSpan(w)}</span> <span>${size}</span>${w.is_owner ? '' : ` <span>with others; ${w.own_chapters} of the chapters are ${escapeHtml(person.display_name)}'s</span>`}</p>
        ${w.series ? `<p class="author-work-series">${escapeHtml(w.series)}</p>` : ''}
        ${w.description ? `<p class="author-featured-blurb">${escapeHtml(w.description)}</p>` : ''}
        ${w.tags.length ? `<p class="author-work-tags"><i class="sr-only">Tags: </i>${w.tags.slice(0, 5).map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</p>` : ''}
      </div>
    </article>`;
}

// Oldest first, with the year set in the margin where it changes: a body
// of work read the way it was written.
function worksTimeline(works) {
  if (!works.length) return '';
  let year = '';
  return `
    <ol class="works">
      ${works.map((w) => {
    const y = String(w.started_at || '').slice(0, 4);
    const mark = y !== year ? `<span class="works-year">${escapeHtml(y)}</span>` : '<span class="works-year" aria-hidden="true"></span>';
    year = y;
    return `
        <li class="works-item story-row">
          ${mark}
          ${cover(w, 'works-cover')}
          <div class="works-body">
            <h3 class="works-title"><a class="row-link" href="/stories/${w.id}">${escapeHtml(w.title)}</a></h3>
            <p class="author-work-facts">${front.stateLabel(w)} <span>${dateSpan(w)}</span> <span>${w.chapter_count} ch${w.word_count ? ` &middot; ${front.shortWords(w.word_count)}` : ''}</span>${w.followers ? ` <span>&#9733; ${w.followers}</span>` : ''}${w.is_owner ? '' : ' <span>coauthor</span>'}</p>
            ${w.description ? `<p class="works-blurb">${escapeHtml(w.description)}</p>` : ''}
          </div>
        </li>`;
  }).join('')}
    </ol>`;
}

/** @param {any} props */
function profilePage({ user, person, stats, works = [], output = { unit: 'month', buckets: [] }, tags = [], reach = { readers: 0, followers: 0 }, chapters = [], pendingClaim = null, notice = '' }) {
  const isSelf = person.id === user.id;
  const initial = (String(person.display_name || '?').match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  const latest = [...works].sort((a, b) => String(b.last_chapter_at || b.started_at).localeCompare(String(a.last_chapter_at || a.started_at)))[0];
  const rest = works.filter((w) => !latest || w.id !== latest.id);

  // An imported author: a name the stories came with, not a member. Who
  // they are elsewhere, and -- for a member who is them -- a way to say so.
  const imported = person.is_placeholder ? `
      <section class="imported-author">
        <p><strong>Imported author.</strong> These stories were brought in from StoriesOnline${person.source_url ? ` (<a href="${escapeHtml(person.source_url)}" target="_blank" rel="noopener noreferrer">their page there</a>)` : ''}. Nobody here has claimed them yet. <a href="/authors">Every imported author</a>.</p>
        ${pendingClaim
    ? '<p class="muted">You have said this is you. An admin will look at it; once they agree, these stories move to your account.</p>'
    : `<details class="claim-form">
            <summary>This is me</summary>
            <form method="post" action="/users/${encodeURIComponent(person.username)}/claim">
              <label>Anything that will help an admin see it is you (optional)
                <textarea name="message" rows="3" maxlength="1000" placeholder="e.g. I post there as ${escapeHtml(person.display_name)}; ask me anything about the stories."></textarea>
              </label>
              <button class="btn small" type="submit">Claim these stories</button>
            </form>
          </details>`}
      </section>` : '';

  const recentChapters = chapters.slice(0, 6);
  return layout({
    title: person.display_name,
    user,
    flash: notice ? { type: 'info', message: notice } : null,
    body: `
      <header class="author-head">
        <span class="author-avatar" aria-hidden="true">${escapeHtml(initial)}</span>
        <div class="author-who">
          <h1>${escapeHtml(person.display_name)}</h1>
          <p class="muted byline">${person.is_placeholder
    ? 'Imported from StoriesOnline'
    : `@${escapeHtml(person.username)} &middot; joined ${timeHtml(person.created_at)}${person.last_seen_at ? ` &middot; last seen ${timeHtml(person.last_seen_at)}` : ''}`}</p>
        </div>
        ${isSelf ? '<div class="page-head-actions"><a class="btn ghost small" href="/account">Account</a></div>' : ''}
      </header>
      ${imported}
      ${metrics(stats, reach, works)}

      ${latest ? featured(latest, person) : `<p class="muted author-nothing">${isSelf ? 'You have not started or been invited into a story yet. <a href="/stories/new">Start one</a>.' : 'Nothing written here yet.'}</p>`}

      ${outputChart(output) || tags.length ? `
        <div class="author-charts">
          ${outputChart(output)}
          ${tagBars(tags, works.length)}
        </div>` : ''}

      ${rest.length ? `
        <section class="profile-section">
          <h2 class="band-title">Everything${latest ? ' else' : ''}, from the first</h2>
          ${worksTimeline(rest)}
        </section>` : ''}

      ${recentChapters.length ? `
        <section class="profile-section">
          <h2 class="band-title">Latest chapters</h2>
          <ul class="author-chapters">
            ${recentChapters.map((c) => `
              <li><a href="/chapters/${c.id}">${escapeHtml(c.title)}</a>
                <span class="muted">${escapeHtml(c.story_title)} &middot; chapter ${c.chapter_number}${c.word_count ? ` &middot; ${front.shortWords(c.word_count)}` : ''} &middot; ${timeHtml(c.created_at)}</span></li>`).join('')}
          </ul>
        </section>` : ''}`,
  });
}

module.exports = { profilePage };
