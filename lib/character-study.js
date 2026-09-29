'use strict';

// A character study: the questions a writer asks about somebody before
// they are a character and not a name. The answers are the writer's own
// working notes -- what a person wants, and how they will change, is the
// plot -- so only the people who write the story ever see them.
//
// Five questions, in the order they are usually answered. They are
// questions rather than fields because a blank field is easy to skip and
// a question is not: "what do they need?" is the one most people have
// never asked themselves, and the one that makes a character move.

const QUESTIONS = [
  { key: 'want', label: 'What they want', hint: 'The goal they chase -- the one they would name if you asked them.' },
  { key: 'need', label: 'What they need', hint: 'What would actually set them right. Often not what they want, and they may not know it.' },
  { key: 'fear', label: 'What they fear', hint: 'What they would do almost anything to avoid.' },
  { key: 'voice', label: 'How they talk', hint: 'Their words and their rhythm, and the thing they never say out loud.' },
  { key: 'change', label: 'How they change', hint: 'Who they are at the start, and who they are by the end.' },
];
const KEYS = QUESTIONS.map((q) => q.key);
const MAX_ANSWER = 4000;

/** Only people get one: a place does not want anything. */
const hasStudy = (kind) => (kind || 'person') === 'person';

/**
 * The answers posted from the entry form (study_want, study_need, ...),
 * trimmed, keyed by question.
 * @param {Record<string, any>} body
 * @returns {Record<string, string>}
 */
function answersFromBody(body) {
  const out = {};
  for (const key of KEYS) {
    const raw = body[`study_${key}`];
    out[key] = String(raw == null ? '' : raw).replace(/\r\n/g, '\n').trim().slice(0, MAX_ANSWER);
  }
  return out;
}

module.exports = { KEYS, QUESTIONS, answersFromBody, hasStudy };
