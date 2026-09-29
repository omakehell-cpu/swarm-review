'use strict';

// The story's timeline, three ways of looking at one set of dates:
//
// - Grid: the chapters as columns, a row for each point of view and one
//   for the story's events. Read "as told" it is the book in order; read
//   "as it happens" the columns re-sort by day, and every jump in time is
//   in the headers -- how Plottr and its kind let a writer plan.
// - Chronicle: everything that has a day, read downwards, moment by moment,
//   in eras -- the way World Anvil and Novel Factory tell a history. What
//   lasts is said where it starts and noted while it is still going.
// - Dates: the whole story dated in one table, for the people who write it.
//
// Nothing here is guessed: it is what has been given a day.

const { layout } = require('../lib/layout');
const { storyBar } = require('./story-nav');
const { escapeHtml } = require('../lib/util');

const KIND_WORD = { person: 'Person', place: 'Place', group: 'Group', thing: 'Thing', event: 'Event' };
const has = (v) => v !== null && v !== undefined;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const later = (n) => (n === 0 ? 'The same day' : n > 0 ? `${plural(n, 'day', 'days')} later` : `${plural(-n, 'day', 'days')} earlier`);

// ---------- shared ----------

function chaptersOf(timeline) {
  return [...timeline.placed, ...timeline.undated].filter((i) => i.type === 'chapter').sort((a, b) => a.order - b.order);
}

// How far back each chapter goes, in reading order: the jump is at the
// chapter that goes back (the flashback), measured from the latest day
// told before it.
function jumpsBack(chapters) {
  const out = new Map();
  let latest = null;
  for (const c of chapters) {
    if (!has(c.day)) continue;
    if (latest !== null && c.day < latest) out.set(c.key, latest - c.day);
    if (latest === null || c.day > latest) latest = c.day;
  }
  return out;
}

const eraFor = (eras, day) => (has(day) ? eras.filter((e) => e.from_day <= day).pop() || null : null);

// ---------- the grid ----------

function lanesOf(chapters) {
  const seen = [];
  for (const c of chapters) if (c.pov && !seen.includes(c.pov)) seen.push(c.pov);
  const lanes = seen.map((pov) => ({ key: pov, label: pov }));
  if (!lanes.length) return [{ key: '*', label: 'Chapters' }];
  if (chapters.some((c) => !c.pov)) lanes.push({ key: '', label: 'No point of view' });
  return lanes;
}

function dayHead(c) {
  if (!has(c.day)) return '<span class="tg-day is-undated">Not dated</span>';
  return `<span class="tg-day">Day ${escapeHtml(String(c.day))}</span>`;
}

function gridView({ timeline, eras, order, story, canWrite }) {
  const chapters = chaptersOf(timeline);
  if (!chapters.length) return '<p class="muted">No chapters yet.</p>';
  const back = jumpsBack(chapters);
  const cols = order === 'happens'
    ? [...chapters.filter((c) => has(c.day)).sort((a, b) => a.day - b.day || a.order - b.order), ...chapters.filter((c) => !has(c.day))]
    : chapters;
  const lanes = lanesOf(chapters);
  const events = timeline.placed.filter((i) => i.type === 'entry' && i.kind === 'event');

  // The row of eras over the columns, as it happens: one cell across the
  // columns an era covers.
  let eraRow = '';
  if (order === 'happens' && eras.length) {
    const cells = [];
    for (const c of cols) {
      const era = eraFor(eras, c.day);
      const last = cells[cells.length - 1];
      const id = era ? era.id : null;
      if (last && last.id === id) last.span += 1; else cells.push({ id, title: era ? era.title : '', span: 1 });
    }
    eraRow = `<tr class="tg-eras"><td></td>${cells.map((e) => (e.title ? `<th scope="colgroup" colspan="${e.span}">${escapeHtml(e.title)}</th>` : `<td colspan="${e.span}"></td>`)).join('')}</tr>`;
  }

  let previous = null;
  const heads = cols.map((c) => {
    let note = '';
    if (order === 'happens') {
      if (has(c.day) && previous !== null) note = `<span class="tg-gap">${c.day === previous ? 'same day' : `+${c.day - previous}`}</span>`;
      if (has(c.day)) previous = c.day;
    } else if (back.has(c.key)) {
      note = `<span class="tg-back" title="A flashback: it happens before what was told before it">&#8630; ${plural(back.get(c.key), 'day', 'days')} back</span>`;
    }
    return `
      <th scope="col" class="tg-head${back.has(c.key) ? ' is-back' : ''}">
        <span class="tg-num">${c.order}</span>
        ${dayHead(c)}
        ${c.when ? `<span class="tg-when">${escapeHtml(c.when)}</span>` : ''}
        ${note}
      </th>`;
  }).join('');

  const eventRow = events.length ? `
    <tr class="tg-lane tg-events">
      <th scope="row">Events</th>
      ${cols.map((c) => {
    const on = has(c.day) ? events.filter((e) => e.day <= c.day && (has(e.end) ? e.end : e.day) >= c.day) : [];
    return `<td>${on.map((e) => `<a class="tg-event${has(e.end) ? ' lasts' : ''}" href="${e.url}">${escapeHtml(e.title)}${has(e.end) ? `<span class="tg-event-day">day ${c.day - e.day + 1} of ${e.end - e.day + 1}</span>` : ''}</a>`).join('')}</td>`;
  }).join('')}
    </tr>` : '';

  const laneRows = lanes.map((lane) => `
    <tr class="tg-lane">
      <th scope="row">${escapeHtml(lane.label)}</th>
      ${cols.map((c) => {
    const mine = lane.key === '*' || (c.pov || '') === lane.key;
    if (!mine) return '<td></td>';
    return `<td><a class="tg-card${back.has(c.key) ? ' is-back' : ''}${has(c.day) ? '' : ' is-undated'}" href="${c.url}">
          <span class="tg-title">${escapeHtml(c.name)}</span>
          ${c.summary ? `<span class="tg-sum">${escapeHtml(c.summary)}</span>` : ''}
          <span class="tg-meta">${plural(c.words, 'word', 'words')}${c.strand ? ` &middot; ${escapeHtml(c.strand)}` : ''}</span>
        </a>${canWrite && !has(c.day) ? `<a class="tg-date-it" href="/stories/${story.id}/timeline?view=dates#row-${c.key}">Date it</a>` : ''}</td>`;
  }).join('')}
    </tr>`).join('');

  return `
    <nav class="tl-order" aria-label="Order of the columns">
      <a class="btn small${order === 'told' ? '' : ' ghost'}" href="/stories/${story.id}/timeline?view=grid&amp;order=told"${order === 'told' ? ' aria-current="page"' : ''}>As it is told</a>
      <a class="btn small${order === 'happens' ? '' : ' ghost'}" href="/stories/${story.id}/timeline?view=grid&amp;order=happens"${order === 'happens' ? ' aria-current="page"' : ''}>As it happens</a>
      <span class="muted tl-order-note">${order === 'told'
    ? 'The chapters in the order they are read. A chapter that goes back in time is marked where it jumps.'
    : 'The same chapters in the order they happen, with the time between them. Chapter numbers out of step are the story jumping.'} An event shows on the days a chapter is set; the chronicle has every one.</span>
    </nav>
    <div class="tg-wrap" role="region" aria-label="The chapters by point of view; scrolls sideways" tabindex="0">
      <table class="tg">
        <caption class="sr-only">Chapters of ${escapeHtml(story.title)} ${order === 'told' ? 'in the order they are told' : 'in the order they happen'}, one row for each point of view</caption>
        <thead>${eraRow}<tr><td class="tg-corner"></td>${heads}</tr></thead>
        <tbody>${eventRow}${laneRows}</tbody>
      </table>
    </div>`;
}

// ---------- the chronicle ----------

function chronicleView({ timeline, eras, story, canWrite }) {
  const chapters = chaptersOf(timeline);
  const back = jumpsBack(chapters);
  const toldBefore = new Map();
  let lastTold = null;
  for (const c of chapters) {
    if (back.has(c.key) && lastTold) toldBefore.set(c.key, lastTold);
    if (has(c.day)) lastTold = c;
  }
  const moments = new Map();
  const at = (day) => {
    if (!moments.has(day)) moments.set(day, { day, whens: [], chapters: [], starts: [], others: [], ongoing: [] });
    return moments.get(day);
  };
  for (const item of timeline.placed) {
    const m = at(item.day);
    if (item.when && !m.whens.includes(item.when)) m.whens.push(item.when);
    if (item.type === 'chapter') m.chapters.push(item);
    else if (item.kind === 'event') m.starts.push(item);
    else m.others.push(item);
  }
  const days = Array.from(moments.keys()).sort((a, b) => a - b);
  for (const e of timeline.placed.filter((i) => i.type === 'entry' && has(i.end))) {
    for (const d of days) if (d > e.day && d <= e.end) moments.get(d).ongoing.push({ e, n: d - e.day + 1, of: e.end - e.day + 1 });
  }
  if (!days.length) {
    return `<p class="muted tl-empty">Nothing has a day yet.${canWrite ? ` <a href="/stories/${story.id}/timeline?view=dates">Date the story</a> -- a number for each chapter, or "+1" for the day after the one before -- and it is told here moment by moment.` : ''}</p>`;
  }

  const momentHtml = (m) => `
    <li class="chron-moment" id="day-${m.day}">
      <div class="chron-day"><span class="chron-day-word">Day</span><span class="chron-day-num">${escapeHtml(String(m.day))}</span></div>
      <div class="chron-body">
        ${m.whens.length ? `<h3 class="chron-when">${m.whens.map((w) => escapeHtml(w)).join(' &middot; ')}</h3>` : ''}
        <ul class="chron-items">
          ${m.chapters.map((c) => `
            <li class="chron-chapter${back.has(c.key) ? ' is-back' : ''}">
              <a href="${c.url}"><span class="chron-num">Chapter ${c.order}</span> ${escapeHtml(c.name)}</a>
              ${c.pov ? `<span class="chron-pov">${escapeHtml(c.pov)}</span>` : ''}
              ${back.has(c.key) ? `<span class="chron-flag">Flashback &middot; told after chapter ${toldBefore.get(c.key).order}</span>` : ''}
              ${c.summary ? `<p class="chron-sum">${escapeHtml(c.summary)}</p>` : ''}
            </li>`).join('')}
          ${m.starts.map((e) => `
            <li class="chron-event"><span class="chron-kind">Event</span> <a href="${e.url}">${escapeHtml(e.title)}</a>
              ${has(e.end) ? `<span class="chron-lasts">lasts ${plural(e.end - e.day + 1, 'day', 'days')}, to day ${e.end}</span>` : ''}
              ${e.note ? `<p class="chron-sum">${escapeHtml(e.note)}</p>` : ''}</li>`).join('')}
          ${m.others.map((e) => `
            <li class="chron-entry"><span class="chron-kind">${escapeHtml(KIND_WORD[e.kind] || e.kind)}</span> <a href="${e.url}">${escapeHtml(e.title)}</a>
              ${e.note ? `<span class="muted">${escapeHtml(e.note)}</span>` : ''}</li>`).join('')}
          ${m.ongoing.map(({ e, n, of }) => `
            <li class="chron-ongoing">Still going: <a href="${e.url}">${escapeHtml(e.title)}</a>, day ${n} of ${of}</li>`).join('')}
        </ul>
      </div>
    </li>`;

  // Era by era; what comes before the first era has no heading.
  const groups = [];
  for (const d of days) {
    const era = eraFor(eras, d);
    const last = groups[groups.length - 1];
    if (last && last.era === era) last.days.push(d); else groups.push({ era, days: [d] });
  }
  let previous = null;
  const body = groups.map((g) => {
    // The time since the last moment is said before the era's name, not
    // under it: it is the distance into the new era.
    const lead = previous === null ? '' : `<p class="chron-gap chron-gap-era" aria-hidden="true">${later(g.days[0] - previous)}</p>`;
    const items = g.days.map((d, i) => {
      const gap = previous === null || i === 0 ? '' : `<li class="chron-gap" aria-hidden="true"><span>${later(d - previous)}</span></li>`;
      previous = d;
      return gap + momentHtml(moments.get(d));
    }).join('');
    return `${lead}
      <section class="chron-era"${g.era ? ` aria-labelledby="era-${g.era.id}"` : ' aria-label="Before the first era"'}>
        ${g.era ? `<h2 class="chron-era-title" id="era-${g.era.id}">${escapeHtml(g.era.title)} <span class="muted">from day ${g.era.from_day}</span></h2>` : ''}
        <ol class="chron">${items}</ol>
      </section>`;
  }).join('');

  const undated = timeline.undated;
  return `
    ${body}
    ${undated.length ? `
      <section class="chron-undated" aria-labelledby="undated-head">
        <h2 class="side-head" id="undated-head">Not on the line yet</h2>
        <ul class="chron-items">${undated.map((i) => `<li><a href="${i.url}">${escapeHtml(i.type === 'chapter' ? `Chapter ${i.order}: ${i.name}` : i.title)}</a>${i.when ? ` <span class="muted">${escapeHtml(i.when)}</span>` : ''}</li>`).join('')}</ul>
        ${canWrite ? `<p><a href="/stories/${story.id}/timeline?view=dates">Give them a day</a></p>` : ''}
      </section>` : ''}
    ${canWrite ? eraForms(eras, story) : ''}`;
}

function eraForms(eras, story) {
  return `
    <section class="chron-era-edit" aria-labelledby="eras-head">
      <h2 class="side-head" id="eras-head">Eras</h2>
      <p class="muted">Name the stretches of the story's time -- <em>The academy years</em>, <em>The siege</em> -- and the chronicle is read in them. Each runs from its first day until the next one starts.</p>
      ${eras.map((e) => `
        <form method="post" action="/timeline/eras/${e.id}" class="inline-form era-row">
          <label><span class="sr-only">Name of the era</span><input type="text" name="title" value="${escapeHtml(e.title)}" maxlength="80" required></label>
          <label>from day <input type="text" name="fromDay" value="${e.from_day}" inputmode="numeric" class="era-day" required></label>
          <button class="btn ghost small" type="submit">Save</button>
          <button class="btn ghost small danger" type="submit" formaction="/timeline/eras/${e.id}/delete">Remove</button>
        </form>`).join('')}
      <form method="post" action="/stories/${story.id}/timeline/eras" class="inline-form era-row">
        <label><span class="sr-only">Name of a new era</span><input type="text" name="title" maxlength="80" placeholder="A new era" required></label>
        <label>from day <input type="text" name="fromDay" inputmode="numeric" class="era-day" required></label>
        <button class="btn small" type="submit">Add the era</button>
      </form>
    </section>`;
}

// ---------- dating the story ----------

function datesView({ timeline, story, whens, mayChapter }) {
  const chapters = chaptersOf(timeline);
  const entries = [...timeline.placed, ...timeline.undated].filter((i) => i.type === 'entry')
    .sort((a, b) => (has(a.day) ? a.day : Infinity) - (has(b.day) ? b.day : Infinity) || String(a.title).localeCompare(String(b.title)));
  const back = jumpsBack(chapters);
  const input = (name, value, label, cls = '') => `<input type="text" name="${name}" value="${escapeHtml(has(value) ? String(value) : '')}" aria-label="${escapeHtml(label)}"${cls ? ` class="${cls}"` : ''}${name === 'when' ? ' list="story-whens"' : ' inputmode="numeric" autocomplete="off"'}>`;
  const chapterRow = (c) => {
    const editable = mayChapter(c);
    return `
      <tr id="row-${c.key}" data-key="${c.key}"${editable ? '' : ' class="is-locked"'}>
        <td class="num">${c.order}</td>
        <th scope="row"><a href="${c.url}">${escapeHtml(c.name)}</a>${c.pov ? ` <span class="muted">${escapeHtml(c.pov)}</span>` : ''}</th>
        ${editable ? `
        <td><input type="hidden" name="key" value="${c.key}">${input('when', c.when, `When chapter ${c.order} happens, in words`)}<input type="hidden" name="end" value=""></td>
        <td>${input('day', c.day, `Day of chapter ${c.order}`, 'tl-day-input')}</td>` : `
        <td>${escapeHtml(c.when || '')}</td><td>${has(c.day) ? c.day : ''}</td>`}
        <td class="tl-resolved" aria-live="polite">${back.has(c.key) ? `<span class="chron-flag">Flashback</span> ` : ''}${editable ? '' : '<span class="muted">Its writer dates it</span>'}</td>
      </tr>`;
  };
  const entryRow = (e) => `
      <tr id="row-${e.key}" data-key="${e.key}">
        <th scope="row"><a href="${e.url}">${escapeHtml(e.title)}</a> <span class="muted">${escapeHtml(KIND_WORD[e.kind] || e.kind)}</span></th>
        <td><input type="hidden" name="key" value="${e.key}">${input('when', e.when, `When ${e.title} happens, in words`)}</td>
        <td>${input('day', e.day, `First day of ${e.title}`, 'tl-day-input')}</td>
        <td>${input('end', e.end, `Last day of ${e.title}, if it lasts`, 'tl-day-input')}</td>
        <td class="tl-resolved" aria-live="polite"></td>
      </tr>`;
  return `
    <form method="post" action="/stories/${story.id}/timeline" class="tl-dates" data-story="${story.id}">
      <p class="muted">A day is a number on the story's own calendar. Write it, or count from the row above: <strong>+1</strong> is the next day, <strong>+0</strong> the same day, <strong>-40</strong> forty days back -- a flashback. Each row is saved as you leave it; the button saves everything at once.</p>
      <datalist id="story-whens">${whens.map((w) => `<option value="${escapeHtml(w)}">`).join('')}</datalist>
      <h2 class="side-head">Chapters, in the order they are told</h2>
      <div class="tl-dates-wrap" role="region" aria-label="Chapter dates; scrolls sideways" tabindex="0">
        <table class="tl-dates-table">
          <thead><tr><th scope="col">#</th><th scope="col">Chapter</th><th scope="col">What the story calls the moment</th><th scope="col">Day</th><th scope="col"><span class="sr-only">Result</span></th></tr></thead>
          <tbody data-list="c">${chapters.map(chapterRow).join('')}</tbody>
        </table>
      </div>
      ${entries.length ? `
      <h2 class="side-head">Events, and anything else in the glossary with a date</h2>
      <div class="tl-dates-wrap" role="region" aria-label="Glossary dates; scrolls sideways" tabindex="0">
        <table class="tl-dates-table">
          <thead><tr><th scope="col">Entry</th><th scope="col">What the story calls it</th><th scope="col">Day</th><th scope="col">Until day</th><th scope="col"><span class="sr-only">Result</span></th></tr></thead>
          <tbody data-list="e">${entries.map(entryRow).join('')}</tbody>
        </table>
      </div>` : ''}
      <p><button class="btn" type="submit">Save the dates</button></p>
    </form>`;
}

// ---------- the page ----------

const VIEWS = [['grid', 'Grid'], ['chronicle', 'Chronicle'], ['dates', 'Dates']];

function timelinePage({ user, story, timeline, eras = [], canWrite = false, view = 'grid', order = 'told', whens = [], notice = '', error = '', mayChapter = () => false }) {
  const shown = VIEWS.filter(([id]) => id !== 'dates' || canWrite);
  const current = shown.some(([id]) => id === view) ? view : 'grid';
  const inner = current === 'chronicle' ? chronicleView({ timeline, eras, story, canWrite })
    : current === 'dates' ? datesView({ timeline, story, whens, mayChapter })
      : gridView({ timeline, eras, order, story, canWrite });
  return layout({
    title: `Timeline &middot; ${story.title}`,
    user,
    wide: true,
    body: `
      ${storyBar(story, { current: 'timeline', canWrite, isOwner: story.author_id === user.id })}
      <div class="page-head">
        <div>
          <h1>Timeline</h1>
          <p class="muted">When things happen in <a href="/stories/${story.id}">${escapeHtml(story.title)}</a>, which is not always the order they are told in. Nothing here is guessed: it is what has been given a day.</p>
        </div>
      </div>
      ${notice ? `<p class="flash info" role="status">${escapeHtml(notice)}</p>` : ''}
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
      <p class="outline-totals">
        <span>${timeline.dated} of ${plural(timeline.chapters, 'chapter', 'chapters')} dated</span>
        ${timeline.events ? `<span>${plural(timeline.events, 'event', 'events')}</span>` : ''}
        ${timeline.span ? `<span>Day ${escapeHtml(String(timeline.span.from))} to ${escapeHtml(String(timeline.span.to))}</span>` : ''}
        ${timeline.outOfOrder ? `<span class="pending-total">${plural(timeline.outOfOrder, 'flashback', 'flashbacks')}</span>` : ''}
      </p>
      <nav class="tl-views" aria-label="Ways to see the timeline">
        ${shown.map(([id, label]) => `<a href="/stories/${story.id}/timeline?view=${id}" class="tl-view${id === current ? ' is-current' : ''}"${id === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
      </nav>
      <div class="tl-view-body tl-view-${current}">${inner}</div>`,
  });
}

module.exports = { timelinePage };
