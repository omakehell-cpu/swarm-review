'use strict';

// The plan of a story: the arcs it is built from, nested, with the chapters
// written and the chapters still to write in the order they will be read.
// It is the scaffold -- laid out first, filled in later, in any order.

const { layout } = require('../lib/layout');
const { escapeHtml } = require('../lib/util');
const { storyViewSwitch } = require('./analysis');

const wordsLabel = (n) => `${Number(n || 0).toLocaleString('en-GB')} word${n === 1 ? '' : 's'}`;
const itemName = (item) => (item.type === 'chapter' ? `${item.number}. ${item.title}` : `Planned: ${item.title}`);
const paragraphs = (text) => String(text || '').split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');

// The questions an arc answers, in the order a writer is asked them. An
// empty box asks you to be inspired; a question asks you to answer it.
const ARC_QUESTIONS = [
  ['summary', 'What happens in it', 'The events, in a few lines.'],
  ['change_text', 'What is different at the end', 'An arc is a change: who or what is not the same when it is over?'],
  ['purpose', 'Why it matters to the whole story', 'What would the story lose without it?'],
];

function itemRow(item, story, { canWrite, first, last }) {
  if (item.type === 'chapter') {
    return `
      <li class="plan-item is-written">
        <div class="plan-item-main">
          <a class="plan-item-title" href="/chapters/${item.id}">${escapeHtml(`${item.number}. ${item.title}`)}</a>
          <span class="muted plan-item-meta">${wordsLabel(item.words)}${item.pov ? ` &middot; ${escapeHtml(item.pov)}` : ''}</span>
          ${item.summary ? `<p class="plan-item-notes">${escapeHtml(item.summary)}</p>` : ''}
        </div>
      </li>`;
  }
  return `
    <li class="plan-item is-planned" id="plan-p${item.id}">
      <div class="plan-item-main">
        <span class="plan-badge">Planned</span>
        <span class="plan-item-title">${escapeHtml(item.title)}</span>
        ${item.notes ? `<div class="plan-item-notes">${paragraphs(item.notes)}</div>` : ''}
      </div>
      ${canWrite ? `
      <div class="plan-item-actions">
        <a class="btn small" href="/stories/${story.id}/chapters/new?plan=${item.id}">Write it</a>
        <a class="btn ghost small" href="/plan/slots/${item.id}/edit" aria-label="Edit ${escapeHtml(item.title)}">Edit</a>
        <form method="post" action="/plan/slots/${item.id}/move" class="inline-form">
          <input type="hidden" name="direction" value="up">
          <button class="btn ghost small" type="submit"${first ? ' disabled' : ''} aria-label="Move ${escapeHtml(item.title)} up">&uarr;</button>
        </form>
        <form method="post" action="/plan/slots/${item.id}/move" class="inline-form">
          <input type="hidden" name="direction" value="down">
          <button class="btn ghost small" type="submit"${last ? ' disabled' : ''} aria-label="Move ${escapeHtml(item.title)} down">&darr;</button>
        </form>
      </div>` : ''}
    </li>`;
}

function arcBlock(arc, items, story, opts, rendered) {
  rendered.add(arc.id);
  const heading = `h${Math.min(6, 2 + arc.depth)}`;
  const within = items.slice(arc.start, arc.end + 1);
  const firstItem = within[0];
  const lastItem = within[within.length - 1];
  const span = firstItem ? (firstItem === lastItem ? itemName(firstItem) : `${itemName(firstItem)} to ${itemName(lastItem)}`) : '';
  const answers = ARC_QUESTIONS.map(([key, label]) => (arc[key] ? `
      <div class="plan-arc-answer"><p class="plan-arc-q">${label}</p>${paragraphs(arc[key])}</div>` : '')).join('');
  const unanswered = ARC_QUESTIONS.filter(([key]) => !arc[key]).map(([, label]) => label.toLowerCase());
  return `
    <li class="plan-arc depth-${Math.min(arc.depth, 3)}">
      <section aria-labelledby="arc-${arc.id}">
        <div class="plan-arc-head">
          <p class="plan-arc-kicker">${arc.label}</p>
          <${heading} id="arc-${arc.id}" class="plan-arc-title">${escapeHtml(arc.title)}</${heading}>
          <p class="muted plan-arc-meta">${escapeHtml(span)} &middot; ${arc.chapters} written${arc.planned ? `, ${arc.planned} planned` : ''} &middot; ${wordsLabel(arc.words)}</p>
          ${opts.canWrite ? `<a class="btn ghost small plan-arc-edit" href="/plan/arcs/${arc.id}/edit" aria-label="Edit the arc ${escapeHtml(arc.title)}">Edit</a>` : ''}
        </div>
        ${answers}
        ${unanswered.length && opts.canWrite ? `<p class="plan-arc-nudge">Not said yet: ${unanswered.join('; ')}. <a href="/plan/arcs/${arc.id}/edit">Answer ${unanswered.length === 1 ? 'it' : 'them'}</a></p>` : ''}
        ${arc.problems.length ? `<ul class="plan-problems" role="note">${arc.problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
        <ol class="plan-list">${renderRange(arc.children, items, arc.start, arc.end, story, opts, rendered)}</ol>
      </section>
    </li>`;
}

// Walks a stretch of the running order, opening an arc wherever one
// starts and carrying on after it ends. An arc that overlaps the one
// before it cannot be drawn inside this walk; it is listed underneath
// instead, with what is wrong with it.
function renderRange(arcs, items, from, to, story, opts, rendered) {
  let html = '';
  let i = from;
  const placed = arcs.filter((a) => a.start !== null).sort((a, b) => a.start - b.start);
  while (i <= to && i < items.length) {
    const arc = placed.find((a) => a.start === i && !rendered.has(a.id));
    if (arc) {
      const end = Math.min(arc.end, to);
      html += arcBlock({ ...arc, end }, items, story, opts, rendered);
      i = end + 1;
      continue;
    }
    html += itemRow(items[i], story, { canWrite: opts.canWrite, first: i === 0, last: i === items.length - 1 });
    i += 1;
  }
  return html;
}

function itemOptions(items, selected, { none = null } = {}) {
  return `${none ? `<option value=""${!selected ? ' selected' : ''}>${escapeHtml(none)}</option>` : ''}${items
    .map((i) => `<option value="${i.key}"${selected === i.key ? ' selected' : ''}>${escapeHtml(itemName(i))}</option>`).join('')}`;
}

function arcOptions(all, selected, exclude = null) {
  const byParent = new Map();
  for (const a of all) {
    const k = a.parent_id || 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(a);
  }
  const out = [];
  const walk = (parent, depth) => {
    for (const a of (byParent.get(parent) || []).sort((x, y) => (x.start ?? 0) - (y.start ?? 0))) {
      if (a.id === exclude) continue;
      out.push(`<option value="${a.id}"${Number(selected) === a.id ? ' selected' : ''}>${' '.repeat(depth)}${escapeHtml(a.title)}</option>`);
      walk(a.id, depth + 1);
    }
  };
  walk(0, 0);
  return out.join('');
}

/**
 * The arc form, for a new arc and for changing one.
 * @param {{ action: string, items: any[], all: any[], values?: any, arcId?: number|null, submit: string }} a
 */
function arcForm({ action, items, all, values = {}, arcId = null, submit }) {
  return `
    <form method="post" action="${action}" class="plan-form">
      <label>Name<input type="text" name="title" value="${escapeHtml(values.title || '')}" maxlength="80" required placeholder="Book Two, The long winter, Kessler learns to fly"></label>
      <div class="entity-form-row">
        <label>Inside
          <select name="parentId">
            <option value="">Nothing -- a top-level arc</option>
            ${arcOptions(all, values.parentId, arcId)}
          </select>
        </label>
        <label>Starts at
          <select name="startRef" required>${itemOptions(items, values.startRef)}</select>
        </label>
        <label>Ends at
          <select name="endRef">${itemOptions(items, values.endRef, { none: 'Where the arc it is in ends' })}</select>
        </label>
      </div>
      <p class="hint">A top-level arc runs until the next one starts, the way a book or a part does, and its name is the heading that opens it in the compiled story. An arc inside another has its own end: nest as deep as the story is built.</p>
      ${ARC_QUESTIONS.map(([key, label, hint]) => `
        <label>${label}
          <textarea name="${key}" rows="3">${escapeHtml(values[key] || '')}</textarea>
          <span class="hint">${hint}</span>
        </label>`).join('')}
      <p><button class="btn" type="submit">${submit}</button></p>
    </form>`;
}

/**
 * @param {{ user: any, story: any, plan: { items: any[], arcs: any[], all: any[] }, canWrite: boolean, notice?: string, error?: string, values?: any }} a
 */
function planPage({ user, story, plan, canWrite, notice = '', error = '', values = {} }) {
  const { items, arcs, all } = plan;
  const rendered = new Set();
  const tree = renderRange(arcs, items, 0, items.length - 1, story, { canWrite }, rendered);
  const lost = all.filter((a) => !rendered.has(a.id));
  const written = items.filter((i) => i.type === 'chapter').length;
  const planned = items.length - written;
  const lastKey = items.length ? items[items.length - 1].key : '';

  return layout({
    title: `Plan &middot; ${story.title}`,
    user,
    wide: true,
    body: `
      <p class="breadcrumb"><a href="/stories/${story.id}">&larr; ${escapeHtml(story.title)}</a></p>
      <div class="page-head">
        <div>
          <h1>Plan</h1>
          <p class="muted">The shape of <a href="/stories/${story.id}">${escapeHtml(story.title)}</a> before it is all written: the arcs it is built from, and the chapters still to write, in the order they will be read. Write them in any order you like. Only the people who write this story can see this page.</p>
        </div>
        ${storyViewSwitch(story, { canWrite })}
      </div>
      ${notice ? `<p class="flash info" role="status">${escapeHtml(notice)}</p>` : ''}
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
      <p class="outline-totals">
        <span>${written} written</span>
        <span>${planned} planned</span>
        <span>${all.length} arc${all.length === 1 ? '' : 's'}</span>
      </p>
      ${items.length ? `<ol class="plan-list plan-root">${tree}</ol>` : '<p class="muted">Nothing here yet. Plan the first chapter below.</p>'}
      ${lost.length ? `
        <section class="chart chart-wide">
          <h2 class="side-head">Arcs that cannot be placed</h2>
          <ul class="plan-problems">${lost.map((a) => `<li><a href="/plan/arcs/${a.id}/edit">${escapeHtml(a.title)}</a>: ${escapeHtml(a.problems.join(' ') || 'It overlaps the arc before it.')}</li>`).join('')}</ul>
        </section>` : ''}
      ${canWrite ? `
        <div class="plan-forms">
          <section class="chart" aria-labelledby="plan-slot-head">
            <h2 class="side-head" id="plan-slot-head">Plan a chapter</h2>
            <form method="post" action="/stories/${story.id}/plan/slots" class="plan-form">
              <label>Working title<input type="text" name="title" value="${escapeHtml(values.slotTitle || '')}" maxlength="200" required></label>
              <label>What happens in it
                <textarea name="notes" rows="4">${escapeHtml(values.slotNotes || '')}</textarea>
                <span class="hint">The beats, the scene, the line you have for it. It becomes the chapter's summary when you write it.</span>
              </label>
              <label>Goes after
                <select name="afterRef">
                  <option value=""${lastKey ? '' : ' selected'}>The very start</option>
                  ${items.map((i) => `<option value="${i.key}"${i.key === (values.afterRef ?? lastKey) ? ' selected' : ''}>${escapeHtml(itemName(i))}</option>`).join('')}
                </select>
              </label>
              <p><button class="btn" type="submit">Add to the plan</button></p>
            </form>
          </section>
          ${items.length ? `
          <section class="chart" aria-labelledby="plan-arc-head">
            <h2 class="side-head" id="plan-arc-head">Add an arc</h2>
            ${arcForm({ action: `/stories/${story.id}/plan/arcs`, items, all, values: values.arc || {}, submit: 'Add the arc' })}
          </section>` : ''}
        </div>` : ''}`,
  });
}

/** @param {{ user: any, story: any, arc: any, plan: any, error?: string, values?: any }} a */
function planArcPage({ user, story, arc, plan, error = '', values = null }) {
  const v = values || {
    title: arc.title, parentId: arc.parent_id, startRef: arc.start_ref, endRef: arc.end_ref,
    summary: arc.summary, change_text: arc.change_text, purpose: arc.purpose,
  };
  return layout({
    title: `${escapeHtml(arc.title)} &middot; Plan`,
    user,
    body: `
      <p class="breadcrumb"><a href="/stories/${story.id}/plan">&larr; The plan of ${escapeHtml(story.title)}</a></p>
      <h1>${escapeHtml(arc.title)}</h1>
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
      ${arcForm({ action: `/plan/arcs/${arc.id}/edit`, items: plan.items, all: plan.all, values: v, arcId: arc.id, submit: 'Save the arc' })}
      <form method="post" action="/plan/arcs/${arc.id}/delete" class="inline-form"
            data-confirm="Take the arc ${escapeHtml(arc.title)} out of the plan? Its chapters stay where they are, and any smaller arcs in it move up a level.">
        <button class="btn danger small" type="submit">Delete the arc</button>
      </form>`,
  });
}

/** @param {{ user: any, story: any, slot: any, error?: string }} a */
function planSlotPage({ user, story, slot, error = '' }) {
  return layout({
    title: `${escapeHtml(slot.title)} &middot; Plan`,
    user,
    body: `
      <p class="breadcrumb"><a href="/stories/${story.id}/plan">&larr; The plan of ${escapeHtml(story.title)}</a></p>
      <h1>${escapeHtml(slot.title)}</h1>
      <p class="muted">A chapter planned and not written yet.</p>
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
      <form method="post" action="/plan/slots/${slot.id}/edit" class="plan-form">
        <label>Working title<input type="text" name="title" value="${escapeHtml(slot.title)}" maxlength="200" required></label>
        <label>What happens in it<textarea name="notes" rows="8">${escapeHtml(slot.notes)}</textarea></label>
        <p>
          <button class="btn" type="submit">Save</button>
          <a class="btn ghost" href="/stories/${story.id}/chapters/new?plan=${slot.id}">Write it now</a>
        </p>
      </form>
      <form method="post" action="/plan/slots/${slot.id}/delete" class="inline-form"
            data-confirm="Take ${escapeHtml(slot.title)} out of the plan? Its notes go with it.">
        <button class="btn danger small" type="submit">Delete from the plan</button>
      </form>`,
  });
}

module.exports = { planArcPage, planPage, planSlotPage };
