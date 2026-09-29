'use strict';

// A person's character study (lib/character-study.js): the questions on
// the entry form, the answers on the entry page, and the nudge on the
// glossary. All of it is for the people who write the story.

const study = require('../lib/character-study');
const { escapeHtml } = require('../lib/util');

const paragraphs = (text) => String(text || '').split(/\n{2,}/)
  .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
const lower = (label) => label.charAt(0).toLowerCase() + label.slice(1);

/**
 * The questions, on the entry form. Shown for a person; the kind select
 * hides it for anything else (public/js/bible-form.js), and whatever it
 * holds is only saved for a person.
 * @param {Record<string, string>} answers
 * @param {string} kind
 */
function characterStudyFieldset(answers, kind) {
  return `
    <fieldset class="character-study-form" id="study" data-for-kind="person"${study.hasStudy(kind) ? '' : ' hidden'}>
      <legend>Character study</legend>
      <p class="hint">Five questions for you, not the reader: only the people who write this story see the answers. Answer the ones you know; the rest will wait.</p>
      ${study.QUESTIONS.map((q) => `
        <label>${escapeHtml(q.label)}
          <textarea name="study_${q.key}" rows="3" aria-describedby="study-hint-${q.key}">${escapeHtml((answers && answers[q.key]) || '')}</textarea>
        </label>
        <span class="hint" id="study-hint-${q.key}">${escapeHtml(q.hint)}</span>`).join('')}
    </fieldset>`;
}

/**
 * The answers on the entry page, and the questions still open.
 * @param {{ id: number, kind: string }} entity
 * @param {Record<string, string>} answers
 */
function characterStudySection(entity, answers) {
  if (!study.hasStudy(entity.kind)) return '';
  const answered = study.QUESTIONS.filter((q) => answers[q.key]);
  const open = study.QUESTIONS.filter((q) => !answers[q.key]);
  const edit = `/bible/${entity.id}/edit#study`;
  return `
    <section class="character-study" aria-labelledby="study-head">
      <h2 class="side-head" id="study-head">Character study <span class="muted">&middot; only the writers see this</span></h2>
      ${answered.length ? `<dl class="study-answers">${answered.map((q) => `
        <dt>${escapeHtml(q.label)}</dt><dd>${paragraphs(answers[q.key])}</dd>`).join('')}</dl>` : ''}
      ${!answered.length
    ? `<p class="muted">What do they want, and what do they need? What do they fear, how do they talk, and how will they change? <a href="${edit}">Start the study</a></p>`
    : open.length
      ? `<p class="muted">Not asked yet: ${open.map((q) => escapeHtml(lower(q.label))).join(', ')}. <a href="${edit}">Answer ${open.length === 1 ? 'it' : 'them'}</a></p>`
      : ''}
    </section>`;
}

/**
 * On the glossary: the main characters nobody has studied yet. A nudge,
 * once, and only for the people who write the story.
 * @param {{ id: number, name: string }[]} missing
 */
function characterStudyNudge(missing) {
  if (!missing.length) return '';
  const names = missing.slice(0, 6).map((e) => `<a href="/bible/${e.id}/edit#study">${escapeHtml(e.name)}</a>`);
  const more = missing.length > 6 ? ` and ${missing.length - 6} more` : '';
  return `
    <p class="study-nudge"><strong>No character study yet</strong> for ${names.join(', ')}${more}.
      <span class="muted">Five questions -- what they want, what they need, what they fear, how they talk, how they change -- and a main character starts to move.</span></p>`;
}

module.exports = { characterStudyFieldset, characterStudyNudge, characterStudySection };
