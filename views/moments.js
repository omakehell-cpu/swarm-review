'use strict';

// Pins on the story's calendar, dropped inside a chapter: every paragraph
// with a place to say "from here, it is...". Most paragraphs say nothing,
// and that is the point -- a pin is for where the time moves.

const { layout } = require('../lib/layout');
const { escapeHtml } = require('../lib/util');

const clip = (text, n = 140) => (text.length > n ? `${text.slice(0, n - 1).trim()}…` : text);
const val = (v) => (v === null || v === undefined ? '' : escapeHtml(String(v)));

/**
 * @param {{ user: any, chapter: any, moments: { paragraphs: any[], lost: any[] }, whens?: string[], notice?: string }} a
 */
function chapterMomentsPage({ user, chapter, moments, whens = [], notice = '' }) {
  const { paragraphs, lost } = moments;
  const start = chapter.story_day === null || chapter.story_day === undefined
    ? (chapter.story_when ? escapeHtml(chapter.story_when) : 'not dated')
    : `Day ${escapeHtml(String(chapter.story_day))}${chapter.story_when && chapter.story_when !== `Day ${chapter.story_day}` ? `, ${escapeHtml(chapter.story_when)}` : ''}`;
  const rows = paragraphs.map((p) => `
    <tr${p.mark ? ' class="has-mark"' : ''}>
      <th scope="row">
        <span class="moment-para">${escapeHtml(clip(p.text))}</span>
        <input type="hidden" name="anchor" value="${escapeHtml(p.anchor)}">
        <input type="hidden" name="offset" value="${p.offset}">
      </th>
      <td><input type="text" name="when" value="${escapeHtml(p.mark ? p.mark.story_when : '')}" maxlength="80" list="known-whens" aria-label="From paragraph ${p.index + 1}, when it is, in the story's words"></td>
      <td><input type="text" name="day" value="${p.mark ? val(p.mark.story_day) : ''}" inputmode="numeric" size="6" aria-label="From paragraph ${p.index + 1}, the day, or +N from the row above"></td>
    </tr>`).join('');

  return layout({
    title: `Moments &middot; ${chapter.title}`,
    user,
    wide: true,
    body: `
      <p class="breadcrumb"><a href="/chapters/${chapter.id}">&larr; ${escapeHtml(`${chapter.chapter_number}. ${chapter.title}`)}</a> &middot; <a href="/stories/${chapter.story_id}/timeline">Timeline</a></p>
      <h1>When things happen in this chapter</h1>
      <p class="muted">The chapter starts on its own date (${start}), set under Details in the editor or on the timeline. Where the time moves inside it -- the next morning, a week later, ten years back -- drop a pin on that paragraph: from there on, that is when it is. Most paragraphs stay empty.</p>
      ${notice ? `<p class="flash info" role="status">${escapeHtml(notice)}</p>` : ''}
      <form method="post" action="/chapters/${chapter.id}/moments">
        ${lost.length ? `
          <section class="chart chart-wide">
            <h2 class="side-head">Pins whose paragraph has changed</h2>
            <p class="muted chart-note">The words these were dropped on are not at the start of any paragraph now. They stay on the timeline's list until you drop them again or take them off.</p>
            <ul class="moment-lost">${lost.map((m) => `
              <li><label class="adv-check"><input type="checkbox" name="removeLost" value="${m.id}"> Take off <q>${escapeHtml(clip(m.anchor_text, 60))}</q> &mdash; ${m.story_day !== null ? `Day ${escapeHtml(String(m.story_day))}` : ''}${m.story_when ? ` ${escapeHtml(m.story_when)}` : ''}</label></li>`).join('')}
            </ul>
          </section>` : ''}
        <p class="muted chart-note">A day can be counted from the row above: <strong>+1</strong> is the next day, <strong>-10</strong> ten days back. The first row counts from the chapter's own day.</p>
        <div class="outline-wrap" role="region" aria-label="Paragraphs and pins, scrolls sideways on a narrow screen" tabindex="0">
        <table class="timeline-dates moments-table">
          <caption class="sr-only">Paragraphs of the chapter, each with a place for a pin</caption>
          <thead><tr><th scope="col">From this paragraph</th><th scope="col">When it is</th><th scope="col">Day</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        </div>
        ${whens.length ? `<datalist id="known-whens">${whens.map((v) => `<option value="${escapeHtml(v)}"></option>`).join('')}</datalist>` : ''}
        <p><button class="btn" type="submit">Save the pins</button></p>
      </form>`,
  });
}

module.exports = { chapterMomentsPage };
