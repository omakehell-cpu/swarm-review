'use strict';

const { layout } = require('../lib/layout');
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
      <p class="breadcrumb"><a href="/stories/${story.id}">&larr; ${escapeHtml(story.title)}</a></p>
      <div class="page-head">
        <div>
          <h1>Analysis</h1>
          <p class="muted">What <a href="/stories/${story.id}">${escapeHtml(story.title)}</a> is made of, counted. Nothing here is set by hand: it is the chapters, the story notes and the reviewers' notes, added up.</p>
        </div>
        ${storyViewSwitch(story, { canWrite })}
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
function storyViewSwitch(story, { canWrite = false } = {}) {
  return `
    <div class="page-head-actions">
      ${canWrite ? `<a class="btn ghost small" href="/stories/${story.id}/plan">Plan</a>` : ''}
      <a class="btn ghost small" href="/stories/${story.id}/outline">Outline</a>
      <a class="btn ghost small" href="/stories/${story.id}/analysis">Analysis</a>
      <a class="btn ghost small" href="/stories/${story.id}/timeline">Timeline</a>
    </div>`;
}


// The story's own calendar, which is not the order it is told in. Every
// row is something somebody gave a day to; the gaps between them are
// drawn from those days, and a chapter that happens before one told
// earlier is marked as told out of order -- because that is a flashback,
// which is a decision, not a mistake to correct.
const KIND_WORD = { person: 'Person', place: 'Place', group: 'Group', thing: 'Thing', event: 'Event' };

function dayText(item) {
  if (item.day === null || item.day === undefined) return '&mdash;';
  return item.end !== null && item.end !== undefined
    ? `${escapeHtml(String(item.day))}&ndash;${escapeHtml(String(item.end))}`
    : escapeHtml(String(item.day));
}

function timelineRow(item, { showGap }) {
  // The distance to the row above, in whatever the writer is counting.
  // No unit, because the app does not know whether these are days, years
  // or winters -- and the one thing worse than no unit is the wrong one.
  const gap = showGap && item.gap
    ? `<li class="tl-gap"><span>+${escapeHtml(String(item.gap))}</span></li>`
    : '';
  const anchor = (key, name, url) => `<a href="${key && showGap ? `#tl-${key}` : url}">${escapeHtml(name)}</a>`;
  const ties = [];
  if (item.type === 'entry') {
    if (item.related && item.related.length) {
      ties.push(`<span class="tl-ties">${item.related.map((r) => `<span class="tl-tie"><span class="tl-tie-label">${escapeHtml(r.label)}</span> ${anchor(r.key, r.name, `/bible/${r.id}`)}</span>`).join('')}</span>`);
    }
    if (item.toldIn && item.toldIn.length) {
      ties.push(`<span class="tl-ties"><span class="tl-tie-label">told in</span> ${item.toldIn.map((c) => `<a href="/chapters/${c.id}">ch. ${c.number}</a>`).join(', ')}</span>`);
    }
  } else if (item.names && item.names.length) {
    ties.push(`<span class="tl-ties"><span class="tl-tie-label">names</span> ${item.names.map((n) => anchor(n.key, n.name, '#')).join(', ')}</span>`);
  }
  return `${gap}
    <li class="tl-row tl-${item.type} tl-kind-${escapeHtml(item.kind || item.type)}${item.outOfOrder ? ' tl-back' : ''}" id="tl-${item.key}" data-tl-key="${item.key}">
      <span class="tl-day">${dayText(item)}</span>
      <span class="tl-what">
        <a href="${item.url}">${escapeHtml(item.title)}</a>
        ${item.type === 'entry' ? `<span class="tl-when">${escapeHtml(KIND_WORD[item.kind] || item.kind)}</span>` : ''}
        ${item.when ? `<span class="tl-when">${escapeHtml(item.when)}</span>` : ''}
        ${item.note ? `<span class="tl-note">${escapeHtml(item.note)}</span>` : ''}
        ${ties.join('')}
      </span>
      ${item.outOfOrder ? '<span class="tl-flag">Told out of order</span>' : '<span></span>'}
    </li>`;
}

// ---------- the picture ----------
//
// Everything with a day, laid out left to right in three lanes: the
// chapters as they are told, the events, and everybody and everything
// else that has a date. Evenly spaced by moment, not drawn to scale: to
// scale, one busy afternoon disappears next to a ten-year silence, and the
// gaps are written out in the list underneath anyway. A thing that lasts
// is a bar from its first day to its last.
//
// The lines are what ties them: a relation written in the bible between
// two dated entries is always drawn; the chapters an entry is named in
// are drawn when you point at it (timeline-chart.js). One ink throughout:
// the lanes, the shapes and the labels say what is what, not a colour.
const LANES = [
  { id: 'chapter', label: 'Told', test: (i) => i.type === 'chapter' },
  { id: 'event', label: 'Events', test: (i) => i.type === 'entry' && i.kind === 'event' },
  { id: 'other', label: 'People, places, things', test: (i) => i.type === 'entry' && i.kind !== 'event' },
];
const AXIS_H = 34;
const LANE_HEAD = 22;
const ROW_H = 30;
const LANE_PAD = 10;

function timelineChart(timeline) {
  const { placed, links } = timeline;
  if (placed.length < 2) return '';
  const days = Array.from(new Set(placed.flatMap((i) => [i.day, i.end]).filter((d) => d !== null && d !== undefined)))
    .sort((a, b) => a - b);
  const slot = new Map(days.map((d, i) => [d, i]));
  const x = (day) => ((slot.get(day) + 0.5) / days.length) * 100;
  // What a label takes, as a share of a canvas at least 900 pixels wide
  // (the stylesheet holds it there and scrolls below that) -- near enough
  // to stop two labels landing on each other. A long title is cut short
  // on the line; the whole of it is in the list underneath.
  const MARK = 0.8;
  const short = (t) => (String(t).length > 34 ? `${String(t).slice(0, 32).trim()}…` : String(t));
  const labelShare = (text) => (String(text).length * 6.6 + 8) / 9;

  const pos = new Map();
  let top = AXIS_H;
  const lanes = [];
  for (const lane of LANES) {
    const items = placed.filter(lane.test).sort((a, b) => x(a.day) - x(b.day));
    if (!items.length) continue;
    const rowsEnd = [];
    const drawn = items.map((item) => {
      const from = x(item.day);
      const to = item.end !== null && item.end !== undefined ? x(item.end) : from;
      const label = item.type === 'chapter' ? (item.label || `${item.order}`) : short(item.title);
      // The label goes after the mark, unless that runs it off the right
      // edge -- then it goes before, so nothing is ever cut in half.
      const wide = labelShare(label);
      const before = to + MARK + wide > 99 && from - MARK - wide > 0;
      const left = before ? from - MARK - wide : from - MARK;
      const right = before ? to + MARK : to + MARK + wide;
      let row = rowsEnd.findIndex((end) => end <= left - 1);
      if (row < 0) { row = rowsEnd.length; rowsEnd.push(0); }
      rowsEnd[row] = right;
      const y = top + LANE_HEAD + row * ROW_H + ROW_H / 2;
      pos.set(item.key, { x: from, y });
      return { item, from, to, row, label, before };
    });
    const height = LANE_HEAD + rowsEnd.length * ROW_H + LANE_PAD;
    lanes.push({ lane, drawn, top, height });
    top += height;
  }
  const total = top;

  const tie = (a, b) => {
    const p = pos.get(a);
    const q = pos.get(b);
    if (!p || !q) return '';
    const x1 = p.x * 10; const x2 = q.x * 10;
    const mid = (p.y + q.y) / 2;
    return `M${x1.toFixed(1)},${p.y} C${x1.toFixed(1)},${mid} ${x2.toFixed(1)},${mid} ${x2.toFixed(1)},${q.y}`;
  };
  const connected = new Map();
  for (const l of links) {
    if (!connected.has(l.from)) connected.set(l.from, new Set());
    if (!connected.has(l.to)) connected.set(l.to, new Set());
    connected.get(l.from).add(l.to);
    connected.get(l.to).add(l.from);
  }
  const paths = links.map((l) => {
    const d = tie(l.from, l.to);
    return d ? `<path d="${d}" class="tl-line tl-line-${l.type}" data-a="${l.from}" data-b="${l.to}"><title>${escapeHtml(l.label)}</title></path>` : '';
  }).join('');

  const every = Math.max(1, Math.ceil(days.length / 14));
  const axis = days.map((d, i) => (i % every === 0 || i === days.length - 1
    ? `<span class="tl-tick" style="left:${x(d).toFixed(2)}%">${escapeHtml(String(d))}</span>` : '')).join('');

  const itemHtml = ({ item, from, to, row, label, before }, laneTop) => {
    const span = to > from;
    const tip = `${item.day === null ? '' : `Day ${item.day}${span ? `–${item.end}` : ''}`}${item.when ? ` · ${item.when}` : ''} · ${item.title}`;
    const keys = Array.from(connected.get(item.key) || []).join(' ');
    return `
      <a class="tl-item tl-item-${escapeHtml(item.type === 'chapter' ? 'chapter' : (item.kind === 'event' ? 'event' : 'other'))}${span ? ' is-span' : ''}${before ? ' is-flipped' : ''}"
         href="#tl-${item.key}" data-tl-key="${item.key}" data-tl-links="${escapeHtml(keys)}"
         style="left:${from.toFixed(2)}%;top:${laneTop + LANE_HEAD + row * ROW_H}px;${span ? `--span:${(to - from).toFixed(2)}cqw;` : ''}"
         title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">
        ${span ? '<span class="tl-bar" aria-hidden="true"></span>' : '<span class="tl-mark" aria-hidden="true"></span>'}
        <span class="tl-label">${escapeHtml(label)}</span>
      </a>`;
  };

  return `
    <figure class="tl-chart" aria-label="The timeline, drawn">
      <div class="tl-canvas" style="height:${total}px">
        <div class="tl-axis">${axis}</div>
        ${lanes.map((l) => `<div class="tl-lane tl-lane-${l.lane.id}" style="top:${l.top}px;height:${l.height}px"><span class="tl-lane-name">${escapeHtml(l.lane.label)}</span></div>`).join('')}
        <svg class="tl-lines" viewBox="0 0 1000 ${total}" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>
        ${lanes.map((l) => l.drawn.map((d) => itemHtml(d, l.top)).join('')).join('')}
      </div>
      <figcaption class="muted chart-note">Evenly spaced by moment, not drawn to scale: the gaps are written out in the list below. A bar lasts from its first day to its last. Point at anything to see what it is tied to; the lines are the relations written in the story notes, and the chapters that name it.</figcaption>
    </figure>`;
}

// Dating the whole story in one place: every chapter in reading order, then
// every entry that belongs on a timeline, each with the same two fields the
// chapter and entry forms have. A day can be counted from the row above
// ("+2"), which is how "the next morning" gets written down without doing
// the sum. A row this person may not change is shown, not offered.
function timelineDatesForm(story, timeline, user, whens) {
  const all = timeline.placed.concat(timeline.undated);
  const chapters = all.filter((i) => i.type === 'chapter' && i.kind !== 'mark').sort((a, b) => a.order - b.order);
  const entries = all.filter((i) => i.type === 'entry')
    .sort((a, b) => (a.day ?? Infinity) - (b.day ?? Infinity) || String(a.title).localeCompare(String(b.title)));
  if (!chapters.length && !entries.length) return '';
  const mayChapter = (c) => c.authorId === user.id || story.author_id === user.id;
  const val = (v) => (v === null || v === undefined ? '' : escapeHtml(String(v)));
  const row = (item, editable, withEnd) => {
    const name = escapeHtml(item.title);
    if (!editable) {
      return `<tr class="is-readonly"><th scope="row">${name}</th><td>${escapeHtml(item.when || '')}</td><td>${val(item.day)}</td>${withEnd ? `<td>${val(item.end)}</td>` : ''}</tr>`;
    }
    return `
      <tr>
        <th scope="row">${name}<input type="hidden" name="key" value="${item.key}">${withEnd ? '' : `<input type="hidden" name="end" value=""> <a class="tl-pins-link" href="/chapters/${item.id}/moments" aria-label="Pins inside ${name}">pins inside</a>`}</th>
        <td><input type="text" name="when" value="${escapeHtml(item.when || '')}" maxlength="80" list="known-whens" aria-label="When ${name} happens, in the story's words"></td>
        <td><input type="text" name="day" value="${val(item.day)}" inputmode="numeric" size="6" aria-label="Day number for ${name}, or +N from the row above"></td>
        ${withEnd
    ? `<td><input type="text" name="end" value="${val(item.end)}" inputmode="numeric" size="6" aria-label="Until day, for ${name}, if it lasts"></td>`
    : ''}
      </tr>`;
  };
  const table = (caption, items, editable, withEnd) => (items.length ? `
    <table class="timeline-dates">
      <caption>${caption}</caption>
      <thead><tr><th scope="col">What</th><th scope="col">When this happens</th><th scope="col">Day</th>${withEnd ? '<th scope="col">Until day</th>' : ''}</tr></thead>
      <tbody>${items.map((i) => row(i, editable(i), withEnd)).join('')}</tbody>
    </table>` : '');
  const nothingDated = !timeline.placed.length;
  return `
    <details class="chart chart-wide timeline-edit"${nothingDated ? ' open' : ''}>
      <summary><h2 class="side-head">Put things on the line</h2></summary>
      <form method="post" action="/stories/${story.id}/timeline">
        <p class="muted chart-note">The words are what the story calls the moment; the day is what puts it in order. Write a day as <strong>+2</strong> for two days after the row above, <strong>+0</strong> for the same day, or <strong>-10</strong> for ten days before -- a flashback. Leave it empty and nothing is assumed. Where the time moves inside a chapter, <strong>pins inside</strong> drops a pin on the paragraph where it does.</p>
        ${table('Chapters, in the order they are told', chapters, mayChapter, false)}
        ${table('Events and entries in the story notes', entries, () => true, true)}
        ${whens.length ? `<datalist id="known-whens">${whens.map((v) => `<option value="${escapeHtml(v)}"></option>`).join('')}</datalist>` : ''}
        <p><button class="btn" type="submit">Save the dates</button></p>
      </form>
    </details>`;
}

function timelinePage({ user, story, timeline, canWrite = false, whens = [], notice = '' }) {
  const { placed, undated } = timeline;
  const rows = placed.map((item) => timelineRow(item, { showGap: true })).join('');
  const nothing = !placed.length && !undated.length;

  return layout({
    title: `Timeline &middot; ${story.title}`,
    user,
    wide: true,
    body: `
      <p class="breadcrumb"><a href="/stories/${story.id}">&larr; ${escapeHtml(story.title)}</a></p>
      <div class="page-head">
        <div>
          <h1>Timeline</h1>
          <p class="muted">When things happen in <a href="/stories/${story.id}">${escapeHtml(story.title)}</a>, which is not the order they are told in. Nothing here is guessed: it is what has been given a day, and what the story notes tie together.</p>
        </div>
        ${storyViewSwitch(story, { canWrite })}
      </div>
      ${notice ? `<p class="flash info" role="status">${escapeHtml(notice)}</p>` : ''}
      ${canWrite ? timelineDatesForm(story, timeline, user, whens) : ''}
      ${nothing ? `
        <p class="muted">Nothing has a date yet. Chapters take one ${canWrite ? '<strong>above</strong>, or ' : ''}under <strong>Details</strong> in the editor, and entries in the story notes under <strong>When this happens</strong> -- a word for what the story calls the moment, a number to put it in line, and for an event that lasts, the day it ends. Date two things and this page starts working.</p>`
    : `
        <p class="outline-totals">
          <span>${timeline.dated} of ${timeline.chapters} chapter${timeline.chapters === 1 ? '' : 's'} dated</span>
          ${timeline.moments ? `<span>${timeline.moments} moment${timeline.moments === 1 ? '' : 's'} inside chapters</span>` : ''}
          ${timeline.events ? `<span>${timeline.events} event${timeline.events === 1 ? '' : 's'}</span>` : ''}
          ${timeline.span ? `<span>Day ${escapeHtml(String(timeline.span.from))} to ${escapeHtml(String(timeline.span.to))}</span>` : ''}
          ${timeline.outOfOrder ? `<span class="pending-total">${timeline.outOfOrder} told out of order</span>` : ''}
        </p>
        ${timelineChart(timeline)}
        ${placed.length ? `<h2 class="sr-only">Everything, in order</h2><ol class="timeline">${rows}</ol>` : ''}
        ${undated.length ? `
          <section class="chart chart-wide">
            <h2 class="side-head">Not on the line yet</h2>
            <p class="muted chart-note">These are events, or say when they happen, but have no day number to sort by${canWrite ? ' -- give them one under Put things on the line, above' : ''}.</p>
            <ol class="timeline timeline-loose">${undated.map((item) => timelineRow(item, { showGap: false })).join('')}</ol>
          </section>` : ''}`}`,
  });
}

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
      <p class="breadcrumb"><a href="/stories/${story.id}">&larr; ${escapeHtml(story.title)}</a></p>
      <div class="page-head">
        <div>
          <h1>Outline</h1>
          <p class="muted">Every chapter of <a href="/stories/${story.id}">${escapeHtml(story.title)}</a> on one line: what happens, who is in it, how long it is, and what is still waiting on somebody.${canOrder ? ' Drag a row to move a chapter.' : ''}</p>
        </div>
        ${storyViewSwitch(story, { canWrite })}
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
  storyViewSwitch,
  timelinePage,
  timelineRow,
  timelineChart,
  weeksFrom,
};
