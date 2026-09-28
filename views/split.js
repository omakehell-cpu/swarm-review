'use strict';

// Where one chapter ends and the next begins, moved: a chapter cut in two
// at a paragraph, or the next chapter folded into this one. One page for
// both, because they are the same question asked in two directions.

const { layout } = require('../lib/layout');
const { escapeHtml } = require('../lib/util');

const clip = (text, n = 160) => (text.length > n ? `${text.slice(0, n - 1).trim()}…` : text);

/**
 * @param {{ user: any, chapter: any, story: any, points: { at: number, text: string, isBreak: boolean }[],
 *   next: any, canMerge: boolean, draftWaiting: boolean, pendingNotes: number, error?: string, values?: any }} args
 */
function splitChapterPage({ user, chapter, story, points, next, canMerge, draftWaiting, pendingNotes, error = '', values = {} }) {
  const chosen = values.at === undefined ? null : Number(values.at);
  const title = values.title ?? `${chapter.title} (continued)`;
  const choices = points.map((p, i) => `
    <li class="split-point${p.isBreak ? ' is-break' : ''}">
      <label>
        <input type="radio" name="at" value="${p.at}"${chosen === p.at ? ' checked' : ''} required>
        <span class="split-line">${p.isBreak
    ? '<span class="split-break">Scene break</span> <span class="muted">— the new chapter starts after it</span>'
    : escapeHtml(clip(p.text))}</span>
      </label>
      <span class="sr-only">Paragraph ${i + 2} of ${points.length + 1}</span>
    </li>`).join('');

  const splitForm = draftWaiting ? `
      <p class="flash info">You have writing in the editor that is not published yet. <a href="/chapters/${chapter.id}/edit">Publish it or throw it away</a> first, so the chapter being cut is the one you mean.</p>`
    : !points.length ? '<p class="muted">This chapter is one paragraph long: there is nowhere to cut it.</p>'
      : `
      <form method="post" action="/chapters/${chapter.id}/split" class="split-form">
        <fieldset>
          <legend>Start the new chapter at</legend>
          <p class="muted">The first line of each paragraph. Everything from the one you pick to the end becomes the new chapter.</p>
          <ol class="split-points">${choices}</ol>
        </fieldset>
        <label>Title of the new chapter
          <input type="text" name="title" value="${escapeHtml(title)}" maxlength="200" required>
        </label>
        <p class="hint">It goes straight after this one, as chapter ${chapter.chapter_number + 1}, with the same point of view, strand, stage and date. This chapter keeps its title and the first half of the text, as a new version -- the whole chapter is still in its history.${pendingNotes ? ` Of the ${pendingNotes} note${pendingNotes === 1 ? '' : 's'} waiting, the ones on the second half go with it.` : ''} Anybody who has read this chapter has read both.</p>
        <p><button class="btn" type="submit">Split the chapter</button></p>
      </form>`;

  const mergeBlock = !next ? '<p class="muted">This is the last chapter, so there is nothing after it to merge.</p>'
    : !canMerge ? `<p class="muted">The next chapter, ${escapeHtml(`${next.chapter_number}. ${next.title}`)}, was written by somebody else, so it cannot be folded into yours.</p>`
      : draftWaiting ? '<p class="muted">Publish or throw away the writing waiting in the editor first.</p>'
        : `
      <form method="post" action="/chapters/${chapter.id}/merge" class="inline-form"
            data-confirm="Put all of chapter ${next.chapter_number}, ${escapeHtml(next.title)}, on the end of this one? It is archived, not deleted, and its waiting notes come with the text.${next.arc_title ? ` It opens the arc ${escapeHtml(next.arc_title)}, which will start at the chapter after it instead, if that one does not open an arc of its own.` : ''}">
        <p>Put <a href="/chapters/${next.id}">${escapeHtml(`${next.chapter_number}. ${next.title}`)}</a> on the end of this chapter. It is archived, not deleted: it stays in the story's archived chapters with its history and settled notes, and its waiting notes come across with its text.</p>
        <button class="btn ghost" type="submit">Merge the next chapter into this one</button>
      </form>`;

  return layout({
    title: `Split or merge &middot; ${chapter.title}`,
    user,
    body: `
      <p class="breadcrumb"><a href="/chapters/${chapter.id}">&larr; ${escapeHtml(`${chapter.chapter_number}. ${chapter.title}`)}</a> &middot; <a href="/stories/${story.id}">${escapeHtml(story.title)}</a></p>
      <h1>Split or merge</h1>
      <p class="muted">Move where this chapter ends. Nothing is lost either way: the old shape stays in the version history.</p>
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
      <section class="split-section" aria-labelledby="split-head">
        <h2 id="split-head">Split it in two</h2>
        ${splitForm}
      </section>
      <section class="split-section" aria-labelledby="merge-head">
        <h2 id="merge-head">Merge the next chapter into it</h2>
        ${mergeBlock}
      </section>`,
  });
}

module.exports = { splitChapterPage };
