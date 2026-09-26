'use strict';

// Two blocks of the entry page, both about time: where the entry sits in
// the story's own calendar, and how it stands chapter by chapter. Kept
// apart from views/bible.js so that file stays readable.
const { escapeHtml } = require('../lib/util');
const { bible } = require('./shared');

// Where an entry sits in the story's own calendar: its day (or days, for
// something that lasts), the event just before and the one just after, and
// the way to see it among everything else on the timeline.
function entityTimelineBlock(entity, story, neighbours, canWrite) {
  const dated = entity.story_day !== null && entity.story_day !== undefined;
  if (!dated && entity.kind !== 'event' && !entity.story_when) return '';
  const days = dated
    ? `Day ${escapeHtml(String(entity.story_day))}${entity.story_day_end !== null && entity.story_day_end !== undefined ? `&ndash;${escapeHtml(String(entity.story_day_end))}` : ''}`
    : '';
  const step = (e, dir) => (e ? `<li><span class="status-when">${dir}</span> <a href="/bible/${e.id}">${escapeHtml(e.name)}</a> <span class="muted">day ${escapeHtml(String(e.story_day))}</span></li>` : '');
  return `
    <section class="entity-when">
      <h2 class="side-head">On the timeline</h2>
      ${dated || entity.story_when ? `<p class="entity-day">${days}${days && entity.story_when ? ' &middot; ' : ''}${entity.story_when ? escapeHtml(entity.story_when) : ''}</p>`
    : `<p class="muted">Not on it yet.${canWrite ? ` Give it a day under <a href="/bible/${entity.id}/edit">When this happens</a>.` : ''}</p>`}
      ${neighbours && (neighbours.before || neighbours.after) ? `<ul class="status-list">${step(neighbours.before, 'Before it')}${step(neighbours.after, 'After it')}</ul>` : ''}
      ${dated ? `<p><a href="/stories/${story.id}/timeline#tl-e${entity.id}">See it on the timeline &rarr;</a></p>` : ''}
    </section>`;
}

// The status, chapter by chapter: how they start, then every change and
// the chapter it happens in. A reader is only ever given the part of this
// they have read up to; the people writing it get all of it, and the form.
function entityStatusBlock(entity, changes, chapters, canWrite) {
  const label = (s) => escapeHtml(bible.STATUS_LABELS[s || ''] || bible.STATUS_LABELS['']);
  const start = entity.start_status != null ? entity.start_status : entity.status;
  const rows = [`
    <li><span class="status-when">At the start</span> <span class="ent-badge status-${escapeHtml(start || 'none')}">${label(start)}</span></li>`]
    .concat(changes.map((c) => `
    <li>
      <span class="status-when">From <a href="/chapters/${c.chapter_id}">chapter ${c.chapter_number}</a></span>
      <span class="ent-badge status-${escapeHtml(c.status || 'none')}">${label(c.status)}</span>
      ${canWrite ? `
        <form method="post" action="/bible/${entity.id}/status/${c.id}/delete" class="inline-form" data-inline-form data-then="reload">
          <button class="btn ghost tiny" type="submit" aria-label="Take back the change in chapter ${c.chapter_number}">Remove</button>
        </form>` : ''}
    </li>`)).join('');
  const live = chapters.filter((c) => !c.archived_at);
  const form = canWrite ? `
    <form method="post" action="/bible/${entity.id}/status" class="status-form" data-inline-form data-then="reload">
      <label class="sr-only" for="status-${entity.id}">Status</label>
      <select name="status" id="status-${entity.id}">
        ${bible.STATUSES.map((s) => `<option value="${s}">${label(s)}</option>`).join('')}
      </select>
      <label class="sr-only" for="status-from-${entity.id}">From</label>
      <select name="chapterId" id="status-from-${entity.id}">
        <option value="">from the start</option>
        ${live.map((c) => `<option value="${c.id}">from chapter ${c.chapter_number}: ${escapeHtml(c.title)}</option>`).join('')}
      </select>
      <button class="btn ghost small" type="submit">Set</button>
    </form>
    <p class="hint">Readers only see a change once they have read that far.</p>` : '';
  return `
    <section id="status">
      <h2 class="side-head">Status</h2>
      <ul class="status-list">${rows}</ul>
      ${form}
    </section>`;
}

module.exports = { entityTimelineBlock, entityStatusBlock };
