'use strict';

const { layout } = require('../lib/layout');
const { storyBar } = require('./story-nav');
const { escapeHtml } = require('../lib/util');
const { chapterStageBadge, emptyState, goalBar, wordCount } = require('./shared');
// already had) ----------
// Every chart here is one series, so every chart is one colour: no ramp
// across bars, which would burn the only free channel re-saying the thing
// the bar length already says. The accent is kept for the one thing that
// means "somebody is waiting". And each chart is drawn out of a table, so
// the numbers are readable without seeing the picture and there is
// nothing to build a separate "table view" out of.
function barRows(rows, { unit = 'words', max = 0 } = {}) {
  const top = max || rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  return rows.map((row) => `
    <tr>
      <th scope="row">${row.href ? `<a href="${row.href}">${escapeHtml(row.label)}</a>` : escapeHtml(row.label)}${
  row.note ? `<span class="bar-note">${escapeHtml(row.note)}</span>` : ''}</th>
      <td class="bar-cell">
        <span class="bar${row.accent ? ' accent' : ''}" style="width: ${Math.max(1, Math.round((row.value / top) * 100))}%"></span>
      </td>
      <td class="bar-value">${row.display || (unit === 'words' ? wordCount(row.value) : row.value)}</td>
    </tr>`).join('');
}

function barChart(title, note, rows, opts = {}) {
  if (!rows.length) return '';
  // One bar is not a bar chart: a single value drawn full-width says only
  // that it is the biggest of itself. It is a figure, so it is written as
  // one.
  const body = rows.length === 1
    ? `<p class="chart-figure"><span class="chart-figure-value${rows[0].accent ? ' accent' : ''}">${
  rows[0].display || (opts.unit === 'words' ? wordCount(rows[0].value) : rows[0].value)}</span>
        <span class="muted">${opts.figureLead ? `${escapeHtml(opts.figureLead)} ` : ''}${rows[0].href ? `<a href="${rows[0].href}">${escapeHtml(rows[0].label)}</a>` : escapeHtml(rows[0].label)}</span></p>`
    : `<table class="bars"><tbody>${barRows(rows, opts)}</tbody></table>`;
  return `
    <section class="chart">
      <h2 class="side-head">${escapeHtml(title)}</h2>
      ${note ? `<p class="muted chart-note">${note}</p>` : ''}
      ${body}
    </section>`;
}


// Who is in what. A presence grid is the one place a scale earns its
// keep, because the cells are ordered by how much somebody is in a
// chapter -- so: one hue, four steps, a legend, and the exact count on
// every cell for anybody who cannot see the shade.
function presenceStep(mentions) {
  if (!mentions) return 0;
  if (mentions >= 12) return 4;
  if (mentions >= 5) return 3;
  if (mentions >= 2) return 2;
  return 1;
}

function presenceGrid(analysis, { limit = 24 } = {}) {
  const people = analysis.presence.slice(0, limit);
  if (!people.length || !analysis.chapters.length) return '';
  const head = analysis.chapters.map((c) =>
    `<th scope="col" title="Chapter ${c.chapter_number}: ${escapeHtml(c.title)}">${c.chapter_number}</th>`).join('');
  const rows = people.map((person) => `
    <tr>
      <th scope="row"><a href="/bible/${person.id}">${escapeHtml(person.name)}</a></th>
      ${analysis.chapters.map((c) => {
    const mentions = person.chapters.get(c.id) || 0;
    const step = presenceStep(mentions);
    const label = mentions
      ? `${person.name} is named ${mentions} time${mentions === 1 ? '' : 's'} in chapter ${c.chapter_number}`
      : `${person.name} is not named in chapter ${c.chapter_number}`;
    // The swatch is a span inside the cell rather than the cell itself: a
    // <td> stretches to the row, and a square that is only square when the
    // name beside it is short is not a square.
    return `<td class="cell-cell" title="${escapeHtml(label)}"><span class="cell step-${step}"></span><span class="sr-only">${mentions}</span></td>`;
  }).join('')}
      <td class="bar-value">${person.chapters.size}</td>
    </tr>`).join('');
  return `
    <section class="chart chart-wide">
      <h2 class="side-head">Who is in what</h2>
      <p class="muted chart-note">Read out of the chapters themselves, by name and alias. The last column is how many chapters each one is named in${
  analysis.presence.length > limit ? `, and this shows the ${limit} most present of ${analysis.presence.length}` : ''}.</p>
      <div class="grid-wrap">
        <table class="presence">
          <thead><tr><th scope="col"><span class="sr-only">Who</span></th>${head}<th scope="col">In</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="scale-legend">
        <span class="muted">Times named:</span>
        ${[1, 2, 3, 4].map((step) => `<span class="cell step-${step}"></span>`).join('')}
        <span class="muted">1 &rarr; 12 or more</span>
      </p>
    </section>`;
}


// Words added per week rather than per day: a novel written in evenings
// is mostly zeroes at a day's resolution, and a chart of zeroes says
// nothing anybody needed to know.
function weeksFrom(days) {
  const byWeek = new Map();
  for (const day of days) {
    const date = new Date(`${day.day}T00:00:00Z`);
    // Monday of that week, which is what a writing week means to a person.
    const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86400000);
    const key = monday.toISOString().slice(0, 10);
    byWeek.set(key, (byWeek.get(key) || 0) + day.words);
  }
  return Array.from(byWeek.entries()).map(([week, words]) => ({ week, words })).slice(-16);
}

function analysisPage({ user, story, analysis, canWrite = false }) {
  const chapters = analysis.chapters;
  const weeks = weeksFrom(analysis.days);
  const labelled = (rows) => rows.map((r) => ({
    label: r.unset ? 'Not said' : r.label,
    value: r.words,
    note: `${r.chapters} chapter${r.chapters === 1 ? '' : 's'}`,
  }));

  return layout({
    title: `Analysis &middot; ${story.title}`,
    user,
    wide: true,
    body: `
      ${storyBar(story, { current: 'analysis', canWrite, isOwner: story.author_id === user.id })}
      <div class="page-head">
        <div>
          <h1>Analysis</h1>
          <p class="muted">What <a href="/stories/${story.id}">${escapeHtml(story.title)}</a> is made of, counted. Nothing here is set by hand: it is the chapters, the glossary and the reviewers' notes, added up.</p>
        </div>
      </div>
      ${goalBar(analysis.words, story.word_goal)}
      <div class="chart-grid">
        ${barChart('Words per chapter', 'The length of each chapter as it stands.',
    chapters.map((c) => ({ label: `${c.chapter_number}. ${c.title}`, value: c.word_count || 0, href: `/chapters/${c.id}` })))}
        ${analysis.arcs.length > 1 ? barChart('Words per arc', 'How the weight falls across the books.', labelled(analysis.arcs)) : ''}
        ${barChart('Point of view', 'Whose eyes the story is told through, by weight rather than by chapter count.', labelled(analysis.povs))}
        ${analysis.strands.length > 1 ? barChart('Strands', 'How much of the story each thread carries.', labelled(analysis.strands)) : ''}
        ${weeks.length > 1 ? barChart('Written per week', 'Words added, week by week. A week spent cutting counts backwards, which is the truth about that week.',
    weeks.map((w) => ({ label: w.week, value: Math.max(0, w.words), display: `${w.words < 0 ? '-' : ''}${wordCount(Math.abs(w.words))}` }))) : ''}
        ${chapters.some((c) => c.pending_comments) ? barChart('Notes waiting', 'Unresolved notes, by chapter. This is the only thing on this page in red, because it is the only thing here that is waiting on somebody.',
    chapters.filter((c) => c.pending_comments).map((c) => ({
      label: `${c.chapter_number}. ${c.title}`, value: c.pending_comments, href: `/chapters/${c.id}`, accent: true,
      display: String(c.pending_comments),
    })), { unit: 'count', figureLead: 'waiting in' }) : ''}
      </div>
      ${presenceGrid(analysis)}
      ${canWrite && !analysis.povs.some((p) => !p.unset) ? `
        <p class="muted">No chapter says whose point of view it is yet. There is a field for it on the chapter editor, and it lands here and on the outline.</p>` : ''}`,
  });
}

// ---------- the outline ----------

// Scrivener's outliner, in the shape this app already has: every chapter
// on one line, with the things you actually sort a draft by. The chapter
// page is for reading one; this is for seeing the shape of all of them.
//
// Drag to reorder, and edit a summary where it sits. Without JavaScript
// the up/down buttons and a plain save button do both, which is why they
// are in the markup rather than drawn by a script.
function outlineRow(chapter, { cast = [], canOrder = false, index = 0, total = 0 }) {
  const stage = chapterStageBadge(chapter);
  return `
    <tr class="outline-row" draggable="${canOrder ? 'true' : 'false'}" data-chapter="${chapter.id}">
      <td class="outline-handle">
        ${canOrder ? '<span class="grip" aria-hidden="true">&#8942;&#8942;</span>' : ''}
        <span class="outline-number">${chapter.chapter_number}</span>
      </td>
      <td class="outline-title">
        <a href="/chapters/${chapter.id}">${escapeHtml(chapter.title)}</a>
        ${chapter.arc_title ? `<span class="outline-arc">${escapeHtml(chapter.arc_title)}</span>` : ''}
        ${stage}
      </td>
      <td class="outline-summary">
        <form method="post" action="/chapters/${chapter.id}/summary" class="summary-form">
          <textarea name="summary" rows="2" placeholder="What happens here">${escapeHtml(chapter.summary || '')}</textarea>
          <button class="btn ghost tiny" type="submit">Save</button>
        </form>
      </td>
      <td class="outline-pov">${chapter.pov ? escapeHtml(chapter.pov) : '<span class="muted">&mdash;</span>'}</td>
      <td class="outline-strand">${chapter.strand ? escapeHtml(chapter.strand) : '<span class="muted">&mdash;</span>'}</td>
      <td class="outline-cast">${cast.length
    ? `${cast.slice(0, 4).map((n) => escapeHtml(n)).join(', ')}${cast.length > 4 ? ` +${cast.length - 4}` : ''}`
    : '<span class="muted">&mdash;</span>'}</td>
      <td class="outline-words">${chapter.word_count ? wordCount(chapter.word_count) : '&mdash;'}</td>
      <td class="outline-notes">${chapter.pending_comments
    ? `<a href="/chapters/${chapter.id}">${chapter.pending_comments}</a>`
    : '<span class="muted">&mdash;</span>'}</td>
      <td class="outline-move">
        ${canOrder ? `
          <form method="post" action="/chapters/${chapter.id}/move-up" class="inline-form">
            <button class="btn ghost tiny" type="submit" ${index === 0 ? 'disabled' : ''} aria-label="Move up">&uarr;</button>
          </form>
          <form method="post" action="/chapters/${chapter.id}/move-down" class="inline-form">
            <button class="btn ghost tiny" type="submit" ${index === total - 1 ? 'disabled' : ''} aria-label="Move down">&darr;</button>
          </form>` : ''}
      </td>
    </tr>`;
}


// The ways of looking at a story: the plan (for the people writing it),
// the list, the count, and the calendar. One switch, so adding a fourth does not
// mean finding three copies of it.


function outlinePage({ user, story, chapters = [], castByChapter = new Map(), canOrder = false, canWrite = false, stats = null, notice = '' }) {
  const rows = chapters.map((c, i) => outlineRow(c, {
    cast: castByChapter.get(c.id) || [], canOrder, index: i, total: chapters.length,
  })).join('');
  const words = chapters.reduce((sum, c) => sum + (c.word_count || 0), 0);
  const pending = chapters.reduce((sum, c) => sum + (c.pending_comments || 0), 0);
  const noSummary = chapters.filter((c) => !String(c.summary || '').trim()).length;

  return layout({
    title: `Outline &middot; ${story.title}`,
    user,
    wide: true,
    body: `
      ${storyBar(story, { current: 'outline', canWrite, isOwner: story.author_id === user.id })}
      <div class="page-head">
        <div>
          <h1>Outline</h1>
          <p class="muted">Every chapter of <a href="/stories/${story.id}">${escapeHtml(story.title)}</a> on one line: what happens, who is in it, how long it is, and what is still waiting on somebody.${canOrder ? ' Drag a row to move a chapter.' : ''}</p>
        </div>
      </div>
      ${notice ? `<p class="flash info">${escapeHtml(notice)}</p>` : ''}
      <p class="outline-totals">
        <span>${chapters.length} chapter${chapters.length === 1 ? '' : 's'}</span>
        <span>${wordCount(words)}</span>
        ${stats && stats.arcs ? `<span>${stats.arcs} arc${stats.arcs === 1 ? '' : 's'}</span>` : ''}
        ${pending ? `<span class="pending-total">${pending} note${pending === 1 ? '' : 's'} waiting</span>` : ''}
        ${noSummary ? `<span class="muted">${noSummary} without a summary</span>` : ''}
      </p>
      ${chapters.length ? `
        <div class="outline-wrap" role="region" aria-label="Outline table, scrolls sideways on a narrow screen" tabindex="0">
          <table class="outline" id="outline">
            <thead>
              <tr>
                <th scope="col"><span class="sr-only">Order</span>#</th>
                <th scope="col">Chapter</th>
                <th scope="col">What happens</th>
                <th scope="col">POV</th>
                <th scope="col">Strand</th>
                <th scope="col">Who is in it</th>
                <th scope="col">Words</th>
                <th scope="col">Notes</th>
                <th scope="col"><span class="sr-only">Move</span></th>
              </tr>
            </thead>
            <tbody data-reorder="${canOrder ? `/stories/${story.id}/outline/order` : ''}">${rows}</tbody>
          </table>
        </div>
        <p class="outline-status" data-outline-status hidden></p>`
    : emptyState({
      art: 'sheets',
      title: 'Nothing to outline yet',
      body: 'Every chapter of this story has been archived, or it has none.',
      action: `<a class="btn ghost small" href="/stories/${story.id}">Back to the story</a>`,
    })}`,
  });
}

// ---------- help and the changelog (see lib/docs.js) ----------

module.exports = {
  analysisPage,
  barChart,
  barRows,
  outlinePage,
  outlineRow,
  presenceGrid,
  presenceStep,
  weeksFrom,
};
