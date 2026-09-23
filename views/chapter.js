'use strict';

const { layout } = require('../lib/layout');
const { escapeHtml, toScriptJson } = require('../lib/util');
const { parseMarkdown, renderHighlighted } = require('../lib/markdown');
const { timeHtml } = require('../lib/time');
const { chapterCastBlock, missingNamesBlock } = require('./bible');
const { ICONS, KIND_LABEL, STATUS_LABEL, emptyState, kindBadge, personLink, readersLine, suggestionDiff, wiki, wordCount } = require('./shared');
// Above the text, for the author: how the chapter read, added up. The
// paragraphs are shaded in the text itself (public/js/reactions.js); this
// is the same thing as sentences, with a way to each place.
const REACTION_LABEL = { hooked: 'Hooked', lost: 'Lost me', slow: 'Dragged', unconvinced: 'Didn\u2019t buy it' };
function reactionSummary(map) {
  if (!map || !map.readers) return '';
  const totals = {};
  const places = {};
  for (const [para, counts] of Object.entries(map.byParagraph)) {
    for (const [kind, n] of Object.entries(counts)) {
      totals[kind] = (totals[kind] || 0) + Number(n);
      (places[kind] = places[kind] || []).push([Number(para), Number(n)]);
    }
  }
  const line = Object.keys(REACTION_LABEL).filter((k) => totals[k]).map((kind) => {
    const top = places[kind].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3)
      .map(([p, n]) => `<a href="#chapter-text" data-para="${p}">paragraph ${p}${n > 1 ? ` (${n})` : ''}</a>`).join(', ');
    return `<li class="reaction-sum reaction-sum-${kind}"><strong>${REACTION_LABEL[kind]}</strong> ${totals[kind]} &middot; ${top}</li>`;
  }).join('');
  return `
    <section class="reaction-summary" aria-label="How the chapter read" data-reaction-author>
      <p class="reaction-summary-head">How it read, from ${map.readers} reader${map.readers === 1 ? '' : 's'}</p>
      <ul>${line}</ul>
    </section>`;
}

// "@luis" in a note is a person: a link to their page. The text is
// escaped first and only then linked, so nothing in a note becomes markup.
function withMentions(body) {
  return escapeHtml(body).replace(/(^|[^\w@&])@([A-Za-z0-9_-]{3,30})(?![\w-])/g,
    (whole, before, name) => `${before}<a class="mention" href="/users/${encodeURIComponent(name)}">@${name}</a>`);
}

function renderReply(r, { currentUserId }) {
  const isReplyAuthor = currentUserId === r.author_id;
  if (r.deleted_at) {
    return `<div class="reply retracted"><strong>${escapeHtml(r.author_name)}</strong> <span class="muted"><em>[retracted]</em></span></div>`;
  }
  return `
    <div class="reply">
      <strong>${escapeHtml(r.author_name)}</strong>
      <span>${withMentions(r.body)}</span>
      ${timeHtml(r.created_at)}
      ${isReplyAuthor ? `
        <form method="post" action="/comments/${r.id}/retract" class="inline-form" data-confirm="Retract this reply?">
          <button class="btn tiny ghost" type="submit">Retract</button>
        </form>` : ''}
    </div>`;
}

function renderComment(c, { isChapterAuthor, currentUserId, replies, isLatest = true }) {
  const praise = c.kind === 'praise';
  const statusLabel = praise ? 'Loved' : (c.applied_in ? 'Applied' : (STATUS_LABEL[c.status] || c.status));
  const repliesHtml = replies.map((r) => renderReply(r, { currentUserId })).join('');
  const kindClass = c.kind ? ` kind-${c.kind}` : '';

  if (c.deleted_at) {
    return `
      <div class="comment status-${c.status}${kindClass} retracted" id="comment-${c.id}" data-comment-id="${c.id}">
        <div class="comment-meta">
          <strong>${escapeHtml(c.author_name)}</strong>
          <span class="status-badge status-${c.status}">${statusLabel}</span>
          ${timeHtml(c.created_at)}
        </div>
        <p class="comment-body muted"><em>[comment retracted]</em></p>
        ${repliesHtml}
      </div>`;
  }

  const isCommentAuthor = currentUserId === c.author_id;
  // An accepted or rejected note has been dealt with, so it folds to one
  // line: the column should read as a list of what still needs answering,
  // with the settled ones a click away rather than gone. Pending notes are
  // the actual work and stay open. <details> rather than a script, so the
  // column still behaves with JavaScript off. Praise is the exception: it
  // was never waiting on anybody, and folding it away is the one thing
  // that would stop it being read.
  const settled = c.status !== 'pending' && !praise;
  const statusBadge = `<span class="status-badge status-${c.status}${praise ? ' status-praise' : ''}">${statusLabel}</span>`;
  const hasSuggestion = c.suggestion != null;

  // Where this note has been. Both are facts about the text, not about
  // the note, so they sit with the quote.
  const history = [
    c.left_on ? `<span class="note-history">Left on v${c.left_on}, followed the text here</span>` : '',
    c.passage_changed_in && c.status === 'pending'
      ? `<span class="note-history changed">The passage was rewritten in <a href="?v=${c.passage_changed_in}">v${c.passage_changed_in}</a>, so this note stayed here</span>` : '',
    c.applied_in ? `<span class="note-history applied">${ICONS.tick}Put into the text in <a href="?v=${c.applied_in}">v${c.applied_in}</a></span>` : '',
  ].filter(Boolean).join('');

  const quote = hasSuggestion
    ? `<div class="suggestion" aria-label="Suggested rewrite">${suggestionDiff(c.quoted_text || '', c.suggestion)}</div>`
    : (c.quoted_text ? `<blockquote class="quoted">${escapeHtml(c.quoted_text)}</blockquote>` : '');

  const about = c.entity_id && c.entity_name
    ? `<p class="note-about">About <a href="/bible/${c.entity_id}">${escapeHtml(c.entity_name)}</a> in the bible</p>` : '';

  const canApply = isChapterAuthor && hasSuggestion && c.status === 'pending' && isLatest;

  // What a screen reader hears first, and what heading navigation lands
  // on: whose note, what kind, where it stands, and what it is about. The
  // column is otherwise a run of names, badges and times with nothing to
  // tell one note from the next.
  const quoteGist = (c.quoted_text || '').replace(/\s+/g, ' ').trim();
  const heading = [
    `Note by ${c.author_name}`,
    hasSuggestion ? 'suggested rewrite' : (KIND_LABEL[c.kind] || '').toLowerCase(),
    praise ? '' : statusLabel.toLowerCase(),
  ].filter(Boolean).join(', ') + (quoteGist ? `, on \u201c${quoteGist.length > 60 ? `${quoteGist.slice(0, 59)}\u2026` : quoteGist}\u201d` : ', on the whole chapter');
  const srHead = `<h3 class="sr-only">${escapeHtml(heading)}, ${timeHtml(c.created_at)}</h3>`;
  // Back to the words it is about -- the keyboard's way of doing what
  // clicking the underline does the other way round.
  const goto = c.start_offset != null ? `<a class="note-goto" href="#passage-${c.id}">Go to the passage</a>` : '';

  const inner = `
      ${quote}
      ${goto}
      ${history ? `<p class="note-histories">${history}</p>` : ''}
      ${c.body ? `<p class="comment-body">${withMentions(c.body)}</p>` : ''}
      ${about}
      ${canApply || (isChapterAuthor && !praise) ? `
      <div class="comment-actions" role="group" aria-label="${escapeHtml(`What to do with the note by ${c.author_name}`)}">
        ${canApply ? `
          <form method="post" action="/comments/${c.id}/apply" class="inline-form"
                data-confirm="Put this rewrite into the chapter? It is saved as a new version, and the old one stays in the history.">
            <button class="btn small accept" type="submit">${ICONS.tick}Apply change</button>
          </form>` : ''}
        ${isChapterAuthor && c.status === 'pending' ? `
          <form method="post" action="/comments/${c.id}/status" class="inline-form">
            <button name="status" value="accepted" class="btn small ${hasSuggestion ? 'ghost' : 'accept'}" type="submit"${hasSuggestion ? ' title="Mark it accepted without changing the text -- for when you made the edit yourself"' : ''}>${hasSuggestion ? '' : ICONS.tick}Accept${hasSuggestion ? ' only' : ''}</button>
            <button name="status" value="rejected" class="btn small reject" type="submit">${ICONS.cross}Reject</button>
          </form>` : ''}
        ${isChapterAuthor && c.status !== 'pending' && !praise ? `
          <form method="post" action="/comments/${c.id}/reopen" class="inline-form">
            <button class="btn small ghost" type="submit">Reopen</button>
          </form>` : ''}
      </div>` : ''}
      ${repliesHtml}
      <div class="comment-foot" role="group" aria-label="${escapeHtml(`More on the note by ${c.author_name}`)}">
        <details class="reply-box" aria-label="Reply to ${escapeHtml(c.author_name)}">
          <summary aria-label="Reply to ${escapeHtml(c.author_name)}">Reply</summary>
          <form method="post" action="/comments/${c.id}/reply" class="reply-form">
            <input type="text" name="body" placeholder="Reply..." required maxlength="2000" aria-label="Reply to ${escapeHtml(c.author_name)}">
            <button type="submit" class="btn small ghost">Reply</button>
          </form>
        </details>
        ${isCommentAuthor ? `
        <details class="edit-comment" aria-label="Edit your note">
          <summary>Edit</summary>
          <form method="post" action="/comments/${c.id}/edit">
            <textarea name="body" maxlength="4000"${hasSuggestion || praise ? '' : ' required'}>${escapeHtml(c.body)}</textarea>
            <button type="submit" class="btn small">Save</button>
          </form>
        </details>
        <form method="post" action="/comments/${c.id}/retract" class="inline-form comment-retract" data-confirm="Retract this note?">
          <button class="linklike" type="submit">Retract</button>
        </form>` : ''}
      </div>`;

  const gist = c.body || (hasSuggestion ? `\u2192 ${c.suggestion}` : (praise ? '\u2665' : ''));

  if (settled) {
    return `
    <details class="comment settled status-${c.status}${kindClass}" id="comment-${c.id}" data-comment-id="${c.id}">
      <summary class="comment-summary">
        <strong>${escapeHtml(c.author_name)}</strong>
        ${kindBadge(c.kind)}
        ${statusBadge}
        <span class="comment-gist">${escapeHtml(gist)}</span>
      </summary>
      ${srHead}
      <p class="comment-when muted">${timeHtml(c.created_at)}${c.edited_at ? ' &middot; edited' : ''}</p>
      ${inner}
    </details>`;
  }

  return `
    <div class="comment status-${c.status}${kindClass}" id="comment-${c.id}" data-comment-id="${c.id}">
      ${srHead}
      <div class="comment-meta" aria-hidden="true">
        <strong>${escapeHtml(c.author_name)}</strong>
        ${kindBadge(c.kind)}
        ${hasSuggestion ? '<span class="kind-badge kind-suggestion">Rewrite</span>' : ''}
        ${praise ? '' : statusBadge}
        ${timeHtml(c.created_at)}
        ${c.edited_at ? '<span class="muted edited-tag">(edited)</span>' : ''}
      </div>
      ${inner}
    </div>`;
}


// Moving between chapters without going back to the story page. Absent
// entirely for a one-chapter story, where "next" and "previous" are just
// two dead controls.
function chapterNav(chapter, neighbours, { compact = false, canWrite = false } = {}) {
  const total = neighbours ? neighbours.total : 1;
  const prev = neighbours ? neighbours.prev : null;
  const next = neighbours ? neighbours.next : null;
  const label = (c) => `Chapter ${c.chapter_number}: ${escapeHtml(c.title)}`;

  // The compact one rides on the breadcrumb line, where the breadcrumb
  // itself is already the link back to the story and the byline under it
  // already says which chapter of how many this is -- so it carries the
  // two arrows and nothing else. Saying "chapter 1 of 3" a third time
  // within four lines is not navigation, it is noise.
  if (compact) {
    if (total < 2) return '';
    return `
      <nav class="chapter-nav compact" aria-label="Chapters, before the text">
        ${prev ? `<a class="chapter-nav-arrow" href="/chapters/${prev.id}" title="${label(prev)}" rel="prev">&larr; Previous</a>`
               : '<span class="chapter-nav-arrow disabled" aria-hidden="true"></span>'}
        ${next ? `<a class="chapter-nav-arrow" href="/chapters/${next.id}" title="${label(next)}" rel="next">Next &rarr;</a>`
               : '<span class="chapter-nav-arrow disabled" aria-hidden="true"></span>'}
      </nav>`;
  }
  // The one at the foot of the chapter carries the titles: by the time
  // you get there you've finished reading and the question is what comes
  // next, which a bare arrow doesn't answer.
  //
  // For whoever writes the story, the answer to that question at the end
  // of the last chapter is "nothing yet" -- which is the moment to offer
  // the next one, in the slot the next chapter would occupy. It is the
  // one place on this page where adding a chapter is the obvious thing
  // to do, and it is why the foot still renders for a story with a
  // single chapter and no neighbours at all.
  const writeNext = !next && canWrite
    ? `<a class="chapter-nav-link next add" href="/stories/${chapter.story_id}/chapters/new">
          <span class="chapter-nav-dir">Next &rarr;</span>
          <span class="chapter-nav-title">${ICONS.plus}Write the next chapter</span>
        </a>`
    : '<span></span>';
  if (total < 2 && !canWrite) return '';
  return `
    <nav class="chapter-nav foot" aria-label="Chapters, after the text">
      ${prev ? `<a class="chapter-nav-link prev" href="/chapters/${prev.id}" rel="prev">
          <span class="chapter-nav-dir">&larr; Previous</span>
          <span class="chapter-nav-title">${label(prev)}</span>
        </a>` : '<span></span>'}
      <a class="chapter-nav-here" href="/stories/${chapter.story_id}">All chapters</a>
      ${next ? `<a class="chapter-nav-link next" href="/chapters/${next.id}" rel="next">
          <span class="chapter-nav-dir">Next &rarr;</span>
          <span class="chapter-nav-title">${label(next)}</span>
        </a>` : writeNext}
    </nav>`;
}


// Two arrows pinned to the edges of the window, and only while the
// chapter is being read rather than reviewed: in read mode there is
// nothing else on screen to click, and what you want next is almost
// always the next chapter. They stay out of the way -- half-faded until
// pointed at -- and they are gone entirely on any window too narrow to
// have margins to spare, where they would sit on top of the prose.
function chapterFloatNav(chapter, neighbours) {
  if (!neighbours || neighbours.total < 2) return '';
  const { prev, next } = neighbours;
  const label = (c) => `Chapter ${c.chapter_number}: ${escapeHtml(c.title)}`;
  return `
    <nav class="chapter-float" aria-hidden="true">
      ${prev ? `<a class="chapter-float-arrow prev" href="/chapters/${prev.id}" rel="prev" tabindex="-1"
          title="${label(prev)}">&larr;</a>` : ''}
      ${next ? `<a class="chapter-float-arrow next" href="/chapters/${next.id}" rel="next" tabindex="-1"
          title="${label(next)}">&rarr;</a>` : ''}
    </nav>`;
}

// The card that answers "who was that again?" without leaving the
// chapter.
//
// A name in the text is a real link to a real page and stays one: this is
// the same page, asked for in a smaller shape, put in the column that is
// already there for everything that is about the text rather than in it.
// Nothing is rendered here -- the card is an empty frame the reader fills
// by clicking a name, and with JavaScript off, or on a screen with no room
// for a second column, it never appears at all and the link does what a
// link does.
//
// The card's own heading becomes the link onwards, because that is the
// question a card leaves you with: the summary was not enough, take me to
// the entry.
function nameCard() {
  return `
    <article class="name-card" id="name-card" data-name-card hidden tabindex="-1"
             role="region" aria-label="The name you opened">
      <button class="btn ghost tiny name-card-close" type="button" data-name-card-close>Close</button>
      <div class="name-card-body" data-name-card-body></div>
      <p class="name-card-more"><a href="/" data-name-card-link>Open the whole entry &rarr;</a></p>
    </article>`;
}


// What kind of note, picked before or after writing it. Radio buttons in
// a fieldset, so a screen reader hears "What kind of note, Note, 1 of 6"
// and the arrow keys move between them. Plain note is the default because
// it is what most notes are.
function noteKindPicker(idPrefix) {
  const kinds = [['', 'Note'], ['typo', 'Typo'], ['pacing', 'Pacing'], ['continuity', 'Continuity'], ['question', 'Question'], ['praise', '<span aria-hidden="true">\u2665 </span>Love it']];
  return `
    <fieldset class="note-kinds">
      <legend class="sr-only">What kind of note</legend>
      ${kinds.map(([value, label]) => `
        <label class="note-kind${value ? ` kind-${value}` : ''}">
          <input type="radio" name="kind" value="${value}"${value ? '' : ' checked'} id="${idPrefix}-kind-${value || 'note'}">
          <span>${label}</span>
        </label>`).join('')}
    </fieldset>`;
}

// Which bible entry a continuity note is about. Only offered when the
// reader can see the bible, and only shown once "Continuity" is picked.
function entityPicker(entities) {
  if (!entities || !entities.length) return '';
  return `
    <label class="entity-field">About (optional)
      <select name="entityId">
        <option value="">Nothing in particular</option>
        ${entities.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('')}
      </select>
    </label>`;
}

// Notes still waiting on an older version, because the words they were
// about are not in this one. Without this line they would be behind the
// version dropdown, which is to say gone.
function leftBehindNotice(leftBehind) {
  if (!leftBehind || !leftBehind.length) return '';
  const byVersion = new Map();
  for (const n of leftBehind) byVersion.set(n.version_number, (byVersion.get(n.version_number) || 0) + 1);
  const links = [...byVersion.entries()].map(([v, count]) =>
    `<a href="?v=${v}">${count} on v${v}</a>`).join(', ');
  return `
    <p class="left-behind">
      ${leftBehind.length === 1 ? 'One note is' : `${leftBehind.length} notes are`} still waiting on an earlier version, because the passage ${leftBehind.length === 1 ? 'it was' : 'they were'} about has since been rewritten: ${links}.
    </p>`;
}

// Asking for a read, and being asked. Two faces of one thing, and only
// the people involved see either: the author sees who they asked and how
// it went; the person asked sees the question, above the chapter, and a
// way to say they are done. Everybody else sees nothing.
function reviewBlock({ chapter, isChapterAuthor, requests = [], mine = null, people = [] }) {
  if (mine && !isChapterAuthor) {
    return `
      <section class="review-ask" aria-label="A request to read this">
        <p><strong>${escapeHtml(mine.requested_by_name || 'The author')} asked you to read this.</strong>
        ${mine.question ? `<span class="review-question">&ldquo;${escapeHtml(mine.question)}&rdquo;</span>` : ''}</p>
        <form method="post" action="/review-requests/${mine.id}/done" class="review-done-form">
          <label class="sr-only" for="review-done-note">A line for ${escapeHtml(chapter.author_name)} (optional)</label>
          <input type="text" id="review-done-note" name="note" maxlength="1000" placeholder="A line for ${escapeHtml(chapter.author_name)}, if you like: &ldquo;Loved the ending, notes on the middle&rdquo;">
          <button class="btn small" type="submit">${ICONS.tick}I've finished reading</button>
        </form>
      </section>`;
  }
  if (!isChapterAuthor) return '';

  const rows = requests.map((r) => {
    const state = r.done_at
      ? `<span class="review-state done">${ICONS.tick}Done ${timeHtml(r.done_at)}</span>`
      : `<span class="review-state waiting">Waiting since ${timeHtml(r.created_at)}</span>`;
    const notes = r.notes_since ? ` &middot; ${r.notes_since} note${r.notes_since === 1 ? '' : 's'}` : '';
    return `
      <li>
        <strong>${escapeHtml(r.reviewer_name)}</strong> ${state}${notes}
        ${r.done_note ? `<span class="review-done-note">&ldquo;${escapeHtml(r.done_note)}&rdquo;</span>` : ''}
        ${!r.done_at ? `
          <form method="post" action="/review-requests/${r.id}/withdraw" class="inline-form"
                data-confirm="Take back the request to ${escapeHtml(r.reviewer_name)}?">
            <button class="btn tiny ghost" type="submit">Take back</button>
          </form>` : ''}
      </li>`;
  }).join('');

  const form = people.length ? `
    <details class="review-form">
      <summary>${requests.length ? 'Ask somebody else, or ask again' : 'Ask someone to read this'}</summary>
      <form method="post" action="/chapters/${chapter.id}/review-requests">
        <fieldset class="review-people">
          <legend>Who</legend>
          ${people.map((p) => `
            <label class="tag-pick"><input type="checkbox" name="reviewer" value="${p.id}"> <span>${escapeHtml(p.display_name)}</span></label>`).join('')}
        </fieldset>
        <label>What you want to know (optional)
          <textarea name="question" rows="2" maxlength="1000" placeholder="Does the jump in time work? Is the fight too long?"></textarea>
          <span class="hint">A question gets better notes than &ldquo;thoughts?&rdquo;. They see it above the chapter, and on their front page until they say they are done.</span>
        </label>
        <button class="btn small" type="submit">Ask</button>
      </form>
    </details>` : '';

  if (!rows && !form) return '';
  return `
    <section class="review-requests" id="review-requests" aria-label="Asked to read">
      ${rows ? `<ul class="review-list">${rows}</ul>` : ''}
      ${form}
    </section>`;
}

function chapterPage({ user, chapter, versions, currentVersion, comments, isChapterAuthor, canWrite = false, neighbours = null, readers = [], cast = [], findMatches = null, missingNames = [], entities = [], leftBehind = [], appliedFrom = null, reviewHtml = '', place = null, mentionable = [], reactions = null, notice = '' }) {
  const topLevel = comments.filter((c) => c.parent_id == null);
  const repliesByParent = {};
  comments.filter((c) => c.parent_id != null).forEach((c) => {
    (repliesByParent[c.parent_id] = repliesByParent[c.parent_id] || []).push(c);
  });

  const versionOptions = versions.map((v) => `
    <option value="${v.version_number}" ${v.id === currentVersion.id ? 'selected' : ''}>
      Version ${v.version_number}${v.id === versions[0].id ? ' (latest)' : ''}
    </option>`).join('');

  // Two different things wearing one heading: a note on a passage, which
  // belongs next to that passage, and a note on the chapter, which belongs
  // to no particular line. Splitting them is what lets the first kind sit
  // in the margin -- and it is better information either way.
  const anchored = topLevel.filter((c) => c.start_offset != null && c.end_offset != null);
  const general = topLevel.filter((c) => c.start_offset == null || c.end_offset == null);
  const isLatest = currentVersion.id === versions[0].id;
  const render = (c) => renderComment(c, { isChapterAuthor, currentUserId: user.id, replies: repliesByParent[c.id] || [], isLatest });
  const anchoredHtml = anchored.map(render).join('');
  const generalHtml = general.length ? `
    <section class="general-notes">
      <h3>On the chapter as a whole</h3>
      ${general.map(render).join('')}
    </section>` : '';

  const commentsHtml = topLevel.length
    ? topLevel.map(render).join('')
    : emptyState({
      art: 'margin',
      title: 'No comments on this version',
      body: 'Select any passage in the chapter to comment on it, or use the general comment below for something that is not about one particular line.',
    });

  const ast = parseMarkdown(currentVersion.content);
  // The story's own cast first, then whatever wiki names are left over
  // (see lib/cast-links.js); falling back to the wiki alone for any caller
  // that has not built the combined matcher.
  // A reader who has asked for no links in the prose gets none at all:
  // not the glossary's, not the bible's.
  const highlighted = renderHighlighted(ast, comments, user.plain_names ? null : (findMatches || wiki.findWikiMatches));

  const body = `
    <div class="chapter-topline">
      <p class="breadcrumb"><a href="/stories/${chapter.story_id}">&larr; ${escapeHtml(chapter.story_title)}</a></p>
      ${chapterNav(chapter, neighbours, { compact: true })}
    </div>
    <div class="chapter-header" data-kicker="LOG ${String(chapter.chapter_number).padStart(2, '0')} // ${escapeHtml(chapter.story_title).toUpperCase()} // V${currentVersion.version_number}${currentVersion.word_count ? ` // ${currentVersion.word_count} W` : ''}">
      <h1 id="chapter-title"><span class="chapter-kicker">Chapter ${chapter.chapter_number}${
        neighbours && neighbours.total > 1 ? `<span class="chapter-kicker-of"> of ${neighbours.total}</span>` : ''
      }<span class="sr-only">:</span></span> ${escapeHtml(chapter.title)}</h1>
      <p class="muted byline">by ${personLink(chapter.author_username, chapter.author_name)}${
        currentVersion.word_count ? ` &middot; ${wordCount(currentVersion.word_count)}` : ''
      } &middot; ${timeHtml(chapter.created_at)}${
        // Who has read it belongs to the same line as who wrote it: one
        // line of facts under the title rather than two.
        isChapterAuthor ? ` &middot; ${readersLine(readers, currentVersion.version_number)}` : ''
      }</p>
      ${chapter.summary ? `<p class="summary">${escapeHtml(chapter.summary)}</p>` : ''}
      <div class="version-bar">
        ${versions.length > 1 ? `
        <div class="version-context">
          <label><span class="sr-only">Version</span>
            <select id="version-select">${versionOptions}</select>
          </label>
          ${currentVersion.changelog ? `<span class="changelog muted">&ldquo;${escapeHtml(currentVersion.changelog)}&rdquo;</span>` : ''}
          <a class="version-compare" href="/chapters/${chapter.id}/diff?to=${currentVersion.version_number}">What changed?</a>
        </div>` : ''}
        <div class="version-actions" id="reading-controls" data-has-comments="${comments.length ? '1' : '0'}" data-read-first="${user.read_first ? '1' : '0'}">
          <div class="mode-switch" role="group" aria-label="How to view this chapter">
            <button type="button" data-mode="read" aria-pressed="false" title="The story alone">Read</button>
            <button type="button" data-mode="review" aria-pressed="false" title="The story and the notes">Review</button>
            ${isChapterAuthor ? '<button type="button" data-mode="revise" aria-pressed="false" title="The notes, and the writing checks marked in the text">Revise</button>' : ''}
          </div>
          <details class="reading-prefs" aria-label="Reading settings">
            <summary aria-label="Reading settings: type size, line length, spacing">Aa</summary>
            <div class="reading-prefs-panel">
              <div class="reading-prefs-row">
                <span>Type size</span>
                <div class="reading-prefs-options" role="group" aria-label="Type size">
                  <button type="button" data-pref="reading-size" data-value="1rem" aria-label="Small, type size">S</button>
                  <button type="button" data-pref="reading-size" data-value="" aria-label="Medium, type size">M</button>
                  <button type="button" data-pref="reading-size" data-value="1.25rem" aria-label="Large, type size">L</button>
                  <button type="button" data-pref="reading-size" data-value="1.45rem" aria-label="Extra large, type size">XL</button>
                </div>
              </div>
              <div class="reading-prefs-row">
                <span>Line length</span>
                <div class="reading-prefs-options" role="group" aria-label="Line length">
                  <button type="button" data-pref="reading-measure" data-value="58ch" aria-label="Narrow, line length">Narrow</button>
                  <button type="button" data-pref="reading-measure" data-value="" aria-label="Normal, line length">Normal</button>
                  <button type="button" data-pref="reading-measure" data-value="86ch" aria-label="Wide, line length">Wide</button>
                </div>
              </div>
              <div class="reading-prefs-row">
                <span>Line spacing</span>
                <div class="reading-prefs-options" role="group" aria-label="Line spacing">
                  <button type="button" data-pref="reading-leading" data-value="1.55" aria-label="Tight, line spacing">Tight</button>
                  <button type="button" data-pref="reading-leading" data-value="" aria-label="Normal, line spacing">Normal</button>
                  <button type="button" data-pref="reading-leading" data-value="2.05" aria-label="Loose, line spacing">Loose</button>
                </div>
              </div>
              ${user.plain_names ? '' : `
              <div class="reading-prefs-row">
                <span>Names</span>
                <div class="reading-prefs-options" role="group" aria-label="Names in the text">
                  <button type="button" data-wiki-links="on" aria-label="Linked, names in the text">Linked</button>
                  <button type="button" data-wiki-links="off" aria-label="Plain, names in the text">Plain</button>
                </div>
              </div>`}
            </div>
          </details>
          ${isChapterAuthor ? `<a class="btn ghost small" href="/chapters/${chapter.id}/edit">${ICONS.pen}Edit</a>` : ''}
          <details class="menu" aria-label="More for this chapter">
            <summary class="btn ghost small" aria-label="More for this chapter: downloads and archiving">More</summary>
            <div class="menu-panel">
              ${canWrite ? `
                <p class="menu-heading">Story</p>
                <a href="/stories/${chapter.story_id}/chapters/new">Add a chapter</a>` : ''}
              <p class="menu-heading">Download this version</p>
              <a href="/chapters/${chapter.id}/download.docx?v=${currentVersion.version_number}">Word (.docx)</a>
              ${comments.some((c) => c.parent_id == null && !c.deleted_at) ? `<a href="/chapters/${chapter.id}/download.docx?v=${currentVersion.version_number}&amp;notes=1">Word, with the notes as comments</a>` : ''}
              <a href="/chapters/${chapter.id}/download.md?v=${currentVersion.version_number}">Markdown (.md)</a>
              <a href="/chapters/${chapter.id}/download.txt?v=${currentVersion.version_number}">Plain text (.txt)</a>
              ${isChapterAuthor ? `
                <p class="menu-heading">Chapter</p>
                <form method="post" action="/chapters/${chapter.id}/archive" class="inline-form"
                      data-confirm="Archive this chapter? It stays readable from the story's archived chapters.">
                  <button class="menu-danger" type="submit">Archive chapter</button>
                </form>` : ''}
            </div>
          </details>
        </div>
      </div>
    </div>
    ${reviewHtml}
    ${reactions && reactions.mode === 'author' ? reactionSummary(reactions.map) : ''}
    <div class="chapter-body-grid">
      <article class="reading-pane" aria-labelledby="chapter-title">
        <div id="chapter-text" tabindex="-1" data-chapter-id="${chapter.id}" data-version-id="${currentVersion.id}"${place ? ` data-place="${place.paragraph}" data-place-of="${place.total}"` : ''} data-story-id="${chapter.story_id}" data-can-edit-dictionary="${isChapterAuthor ? '1' : '0'}" data-is-author="${isChapterAuthor ? '1' : '0'}">${highlighted}</div>
      </article>
      <aside class="comments-pane" id="notes" aria-label="Notes on this chapter">
        ${nameCard()}
        <h2>Notes${topLevel.some((x) => !x.deleted_at) ? ` <span class="notes-count">${topLevel.filter((x) => !x.deleted_at).length}</span>` : ''}</h2>
        ${notice ? `<p class="flash-inline" role="status">${escapeHtml(notice)}</p>` : ''}
        ${appliedFrom ? `<p class="flash-inline" role="status">${ICONS.tick}The rewrite from ${escapeHtml(appliedFrom)} is in the text. This is the new version; the one before it is still in the history.</p>` : ''}
        ${isLatest ? leftBehindNotice(leftBehind) : ''}
        <div id="comment-list">${topLevel.length ? anchoredHtml : commentsHtml}</div>
        ${generalHtml}

        <div id="new-comment-box" class="new-comment-box hidden">
          <p class="quoted-preview" id="nc-preview"></p>
          <form method="post" action="/chapters/${chapter.id}/comments">
            <input type="hidden" name="versionId" value="${currentVersion.id}">
            <input type="hidden" name="start" id="nc-start">
            <input type="hidden" name="end" id="nc-end">
            <input type="hidden" name="quoted" id="nc-quoted">
            ${noteKindPicker('nc')}
            ${entityPicker(entities)}
            <textarea name="body" id="nc-body" maxlength="4000" placeholder="Comment on the selected passage" aria-label="Your note"></textarea>
            <label class="suggest-toggle"><input type="checkbox" name="suggestSend" value="1" id="nc-suggest-toggle"> Suggest a rewrite of the passage</label>
            <label class="suggest-field">How you would write it
              <textarea name="suggestion" id="nc-suggestion" maxlength="4000" rows="3"></textarea>
              <span class="hint">Change the words in place. The author sees exactly what you changed and can put it into the text with one click.</span>
            </label>
            <div class="row">
              <button type="submit" class="btn small">Comment</button>
              <button type="button" class="btn small ghost" id="nc-cancel">Cancel</button>
            </div>
          </form>
        </div>

        ${isLatest ? `
        <details class="notes-from-word" aria-label="Notes from a Word file">
          <summary>Notes from a Word file</summary>
          <p class="hint">Read it in Word? Download it with the notes (More, above the text), add your own as Word comments, and bring them here. Each becomes a note by you, on the same words.</p>
          <form method="post" action="/chapters/${chapter.id}/notes-from-word" enctype="multipart/form-data" class="notes-from-word-form">
            <label>Word file (.docx)<input type="file" name="file" accept=".docx" required></label>
            <button type="submit" class="btn small">Bring the notes in</button>
          </form>
        </details>` : ''}
        <details class="general-comment" aria-label="A note on the whole chapter">
          <summary>General comment (no text selected)</summary>
          <form method="post" action="/chapters/${chapter.id}/comments">
            <input type="hidden" name="versionId" value="${currentVersion.id}">
            ${noteKindPicker('gc')}
            <textarea name="body" maxlength="4000" placeholder="General comment about this version" aria-label="Your note"></textarea>
            <button type="submit" class="btn small">Comment</button>
          </form>
        </details>
      </aside>
    </div>
    ${chapterCastBlock(cast, chapter.story_id)}
    ${missingNamesBlock(missingNames, chapter.story_id, `/chapters/${chapter.id}`)}
    ${chapterNav(chapter, neighbours, { canWrite })}
    ${chapterFloatNav(chapter, neighbours)}
    <button id="selection-toast" class="selection-toast hidden" type="button">+ Comment on selection</button>
    <script type="application/json" id="chapter-meta">${toScriptJson({ chapterId: chapter.id })}</script>
    ${reactions ? `<script type="application/json" id="reactions-data">${toScriptJson(reactions)}</script>` : ''}
    ${mentionable.length ? `<script type="application/json" id="mention-people">${toScriptJson(mentionable.map((p) => ({ u: p.username, n: p.display_name })))}</script>` : ''}
    <script src="/js/nspell.bundle.js"></script>
    <script src="/js/writing-analyzer.js" defer></script>
    <script src="/js/app.js"></script>
  `;

  return layout({ title: chapter.title, user, body, skip: { href: '#chapter-text', label: 'Skip to the chapter' } });
}

// ---------- comparing two versions of a chapter ----------

function diffVersionOptions(versions, selectedNumber) {
  return versions.map((v) => `
    <option value="${v.version_number}"${v.version_number === selectedNumber ? ' selected' : ''}>
      v${v.version_number}${v.changelog ? ` -- ${escapeHtml(v.changelog)}` : ''}
    </option>`).join('');
}

function diffBlockHtml(block) {
  if (block.type === 'equal') {
    return `<p class="diff-para diff-equal">${escapeHtml(block.text)}</p>`;
  }
  if (block.type === 'add') {
    return `<p class="diff-para diff-added"><ins>${escapeHtml(block.text)}</ins></p>`;
  }
  if (block.type === 'remove') {
    return `<p class="diff-para diff-removed"><del>${escapeHtml(block.text)}</del></p>`;
  }
  // A paragraph that was edited: the surviving words in normal type, with
  // what went and what arrived marked in place, so the sentence can still
  // be read as a sentence.
  const inner = block.words.map((w) => {
    if (w.type === 'equal') return escapeHtml(w.text);
    if (w.type === 'add') return `<ins>${escapeHtml(w.text)}</ins>`;
    return `<del>${escapeHtml(w.text)}</del>`;
  }).join('');
  return `<p class="diff-para diff-changed">${inner}</p>`;
}

function chapterDiffPage({ user, chapter, versions, fromVersion, toVersion, blocks, summary, formattingOnly = false }) {
  const body = summary.identical
    ? `<p class="muted diff-identical">${formattingOnly
        ? 'The prose is word for word the same. Only the formatting changed &mdash; emphasis, a heading, a link.'
        : 'These two versions are word for word the same.'}</p>`
    : blocks.map(diffBlockHtml).join('\n');

  // Reading the diff of a version against itself is a legitimate thing to
  // ask for by fiddling with the URL, and produces an empty page rather
  // than an error -- but say so plainly.
  const sameVersion = fromVersion.id === toVersion.id;

  return layout({
    title: `Changes - ${chapter.title}`,
    user,
    body: `
      <p class="breadcrumb"><a href="/chapters/${chapter.id}">&larr; Chapter ${chapter.chapter_number}: ${escapeHtml(chapter.title)}</a></p>
      <div class="page-head">
        <h1>What changed</h1>
      </div>

      <form method="get" action="/chapters/${chapter.id}/diff" class="diff-picker">
        <label>From
          <select name="from">${diffVersionOptions(versions, fromVersion.version_number)}</select>
        </label>
        <label>To
          <select name="to">${diffVersionOptions(versions, toVersion.version_number)}</select>
        </label>
        <button class="btn small" type="submit">Compare</button>
      </form>

      <p class="muted diff-summary">
        ${sameVersion ? 'Comparing a version with itself. ' : ''}
        ${summary.identical ? 'No differences.' : `
          <span class="diff-count added">+${summary.added} word${summary.added === 1 ? '' : 's'}</span>
          <span class="diff-count removed">&minus;${summary.removed} word${summary.removed === 1 ? '' : 's'}</span>
          across ${summary.touched} paragraph${summary.touched === 1 ? '' : 's'}`}
        &middot; v${fromVersion.version_number} ${timeHtml(fromVersion.created_at)} &rarr; v${toVersion.version_number} ${timeHtml(toVersion.created_at)}
      </p>

      <div class="reading-pane">
        <div class="diff-body">${body}</div>
      </div>`,
  });
}


// A chapter that has only ever had one version has nothing to compare it
// with -- which is a normal state for a new chapter, not an error.
function diffUnavailablePage({ user, chapter }) {
  return layout({
    title: `Changes - ${chapter.title}`,
    user,
    body: `
      <p class="breadcrumb"><a href="/chapters/${chapter.id}">&larr; Chapter ${chapter.chapter_number}: ${escapeHtml(chapter.title)}</a></p>
      <h1>Nothing to compare yet</h1>
      <p class="muted">This chapter has only one version. A second one appears the first time its author saves a change to the text, and then this page will show what moved.</p>`,
  });
}

// ---------- search ----------

module.exports = {
  chapterDiffPage,
  chapterFloatNav,
  chapterNav,
  chapterPage,
  diffBlockHtml,
  diffUnavailablePage,
  diffVersionOptions,
  renderComment,
  renderReply,
  reviewBlock,
};
