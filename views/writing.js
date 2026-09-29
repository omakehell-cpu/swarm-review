'use strict';

const { layout } = require('../lib/layout');
const { escapeHtml, toScriptJson } = require('../lib/util');
const { parseMarkdown, renderHighlighted } = require('../lib/markdown');
const { timeHtml } = require('../lib/time');
const { besidePanel, editorBiblePanel } = require('./bible');
const { diffBlockHtml } = require('./chapter');
const { arcField, fileUploadField, positionField, povAndStrandFields, renderCommentReadOnly, stageField, tagPicker, uploadVersionField, whenFields } = require('./shared');
function archivedStoriesPage({ user, stories }) {
  const rows = stories.length ? stories.map((s) => `
    <div class="chapter-row archived-row">
      <div class="chapter-row-main">
        <h3>${escapeHtml(s.title)}</h3>
        <p class="muted">by ${escapeHtml(s.author_name)} &middot; archived ${timeHtml(s.archived_at)}</p>
      </div>
      <div class="chapter-row-meta">
        ${user.id === s.author_id ? `
          <form method="post" action="/stories/${s.id}/unarchive" class="inline-form">
            <button class="btn small ghost" type="submit">Unarchive</button>
          </form>
          <form method="post" action="/stories/${s.id}/delete" class="inline-form" data-confirm="Delete this story and everything in it forever? This cannot be undone.">
            <button class="btn small danger" type="submit">Delete forever</button>
          </form>` : ''}
      </div>
    </div>
  `).join('') : '<p class="muted">No archived stories.</p>';

  return layout({
    title: 'Archived stories',
    user,
    body: `
      <p class="breadcrumb"><a href="/">&larr; Stories</a></p>
      <h1>Archived stories</h1>
      <div class="chapter-list">${rows}</div>`,
  });
}

// ---------- the writing desk: one frame for all three pages ----------
//
// New story, new chapter and editing a chapter are the same room: a bar
// along the top that is always there -- where you are, whether it is kept,
// and the buttons that save it -- then the title written as a title, the
// text, and beside it a column of tabs (the checks, the notes, the bible,
// something to read beside). Everything that is not writing is one step
// away rather than on the way: the chapter's details in a drawer, and what
// a publish needs to know (what changed, what the story is about, its tags)
// asked at the moment of publishing.
//
// All of it is ordinary markup that works with nothing switched on: the
// drawer and the publish questions are sections of the form, in place, and
// writing-desk-frame.js turns them into a drawer and a sheet.

const FORM_ID = 'writer-form';

/**
 * @param {{ back: string, backLabel: string, cancelHref: string, publishLabel: string, draft?: boolean, details?: boolean, sheet?: boolean }} opts
 */
function writerBar({ back, backLabel, cancelHref, publishLabel, draft = false, details = true, sheet = true }) {
  return `
    <div class="writer-bar" role="region" aria-label="Saving">
      <a class="writer-bar-back" href="${back}">&larr; ${escapeHtml(backLabel)}</a>
      <p class="writer-bar-status" data-draft-status aria-live="polite"></p>
      <div class="writer-bar-actions">
        ${details ? `<button class="btn ghost small" type="button" data-details-open aria-controls="chapter-details" aria-expanded="false" hidden>Details</button>` : ''}
        <a class="btn ghost small" href="${cancelHref}">Cancel</a>
        ${draft ? `<button class="btn ghost small" type="submit" form="${FORM_ID}" name="intent" value="draft" formnovalidate>Save draft</button>` : ''}
        <button class="btn small" type="submit" form="${FORM_ID}" name="intent" value="publish"${sheet ? ' data-publish-open' : ''}>${escapeHtml(publishLabel)}</button>
      </div>
    </div>`;
}

// The column beside the text, as tabs. Each panel is written out whole,
// so with no script they are simply one under the other; the tab row is
// hidden until writing-desk-frame.js has something to switch.
/** @param {Array<{ id: string, label: string, html: string, attrs?: string }|null>} panels */
function sideTabs(panels) {
  const shown = panels.filter(Boolean);
  return `
    <div class="side-tabs" role="tablist" aria-label="Beside the text" hidden>
      ${shown.map((p, i) => `<button type="button" role="tab" class="side-tab" id="tab-${p.id}" aria-controls="side-${p.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? '0' : '-1'}">${escapeHtml(p.label)}<span class="side-tab-count" data-tab-count></span></button>`).join('')}
    </div>
    ${shown.map((p) => `<section class="side-panel" id="side-${p.id}" role="tabpanel" aria-labelledby="tab-${p.id}"${p.attrs ? ` ${p.attrs}` : ''}>${p.html}</section>`).join('')}`;
}

// The editor is two columns on a wide screen, as Hemingway is: the text,
// and beside it the tabs.
function editorGrid(writerCard, side = '') {
  return `
    <div class="chapter-body-grid editor-grid">
      ${writerCard}
      <aside class="comments-pane editor-side" aria-label="Beside the text">${side}</aside>
    </div>`;
}

// The chapter's details, in a drawer: what it is about, what it wants, the
// arc it opens, whose eyes, when. Set once in a while, never needed to
// write, so none of it is between the author and the text.
function detailsDrawer(inner, heading = 'Chapter details') {
  return `
    <details class="details-drawer" id="chapter-details" data-details-drawer>
      <summary class="writer-section-label">${escapeHtml(heading)}</summary>
      <div class="drawer-body">
        <button class="btn ghost tiny drawer-close" type="button" data-details-close hidden>Close</button>
        ${inner}
      </div>
    </details>`;
}

// What a publish needs to know, asked when publishing. Without a script it
// is the last section of the form, above nothing; with one, pressing
// Publish opens it as a sheet over the page, with the real Publish in it.
function publishSheet(inner, { heading, button }) {
  return `
    <section class="publish-sheet" data-publish-sheet aria-labelledby="publish-sheet-title">
      <h2 id="publish-sheet-title" class="writer-section-label">${escapeHtml(heading)}</h2>
      ${inner}
      <div class="publish-sheet-actions">
        <button class="btn ghost small" type="button" data-publish-close hidden>Back to the text</button>
        <button class="btn" type="submit" name="intent" value="publish" data-publish-confirm>${escapeHtml(button)}</button>
      </div>
    </section>`;
}

// The text, with the line under it that says how it stands: the words
// this session, the day's goal, and where the draft is kept.
function mainField({ content, placeholder, storyId = null, label = 'Chapter text', breaks = false }) {
  return `
    <div class="main-field"><label for="chapter-content" class="sr-only">${escapeHtml(label)}</label><textarea id="chapter-content" name="content" rows="24" placeholder="${escapeHtml(placeholder)}"${storyId ? ` data-story-id="${storyId}"` : ''}${breaks ? ' data-chapter-breaks' : ''} data-editor-tools>${escapeHtml(content)}</textarea>
      <p class="writer-status" data-writer-status></p>
    </div>
    <template id="markdown-help"><p class="hint">${MARKDOWN_HELP}</p></template>`;
}

const MARKDOWN_HELP = '**bold**, *italic*, ***both***, ~~strikethrough~~, `code`, [link](https://...), # Heading, &gt; quote, --- for a scene break, and - or 1. list items. A backslash keeps a character as it is (\\* is a real asterisk). Line breaks are kept as you type them.';

// ---------- new story (+ first chapter) ----------

/** @param {{ user: Row, error?: string|null, values?: FormValues, groups?: any[], selectedTagIds?: number[] }} props */
function newStoryPage({ user, error, values = /** @type {FormValues} */ ({}), groups = [], selectedTagIds = [] }) {
  const sheet = publishSheet(`
      <p class="muted">The story is written; this is how it is introduced. Both can be changed later from the story page.</p>
      <label>What it is about<textarea name="storyDescription" rows="3" placeholder="The line or two a reader sees before they open it.">${escapeHtml(values.storyDescription || '')}</textarea></label>
      <div class="sheet-tags">
        <p class="writer-section-label">Tags</p>
        ${tagPicker(groups, selectedTagIds, { allowPropose: true })}
      </div>`, { heading: 'Before you publish', button: 'Publish story' });
  return layout({
    title: 'New story',
    user,
    current: 'new-story',
    wide: true,
    body: `
      ${writerBar({ back: '/', backLabel: 'Stories', cancelHref: '/', publishLabel: 'Publish', details: true })}
      ${editorGrid(`
      <div class="writer-card">
        <h1 class="sr-only">Start a new story</h1>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/stories/new" class="chapter-form" id="${FORM_ID}" enctype="multipart/form-data">
          <label class="story-title-field"><span class="sr-only">Story title</span><input type="text" name="storyTitle" value="${escapeHtml(values.storyTitle || '')}" required placeholder="The story's title" autofocus></label>
          <label class="title-field"><span class="sr-only">Chapter 1 title</span><input type="text" name="chapterTitle" value="${escapeHtml(values.chapterTitle || '')}" required placeholder="Chapter 1 title"></label>
          ${mainField({ content: values.content || '', placeholder: 'Once upon a time...', label: 'Chapter 1 text' })}
          ${detailsDrawer(`
            <label>Chapter summary<textarea name="chapterSummary" rows="2">${escapeHtml(values.chapterSummary || '')}</textarea></label>
            <div class="no-js-only">${fileUploadField()}</div>`)}
          ${sheet}
        </form>
      </div>
      `, sideTabs([{ id: 'checks', label: 'Checks', html: '', attrs: 'data-checks-slot' }]))}
      <script src="/js/nspell.bundle.js"></script>
      <script src="/js/writing-analyzer.js" defer></script>`,
  });
}

// ---------- add another chapter to an existing story ----------


// Beside a chapter written from the plan: what the plan says about it, and
// the arcs it is in, with what each is for. The scaffold, kept in view.
function planPanel(plan, story) {
  const paras = (text) => String(text || '').split(/\n{2,}|\n(?=[-*•])/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  return `
    <h2 class="side-head">From the plan</h2>
    ${plan.notes ? `<div class="plan-panel-notes">${paras(plan.notes)}</div>` : '<p class="muted">The plan has no notes for this chapter.</p>'}
    ${(plan.arcs || []).map((a) => `
      <div class="plan-panel-arc">
        <p class="plan-arc-kicker">${escapeHtml(a.label)}</p>
        <p class="plan-panel-arc-title">${escapeHtml(a.title)}</p>
        ${a.summary ? `<p class="muted">${escapeHtml(a.summary)}</p>` : ''}
        ${a.change ? `<p class="muted"><strong>By the end:</strong> ${escapeHtml(a.change)}</p>` : ''}
      </div>`).join('')}
    <p class="muted"><a href="/stories/${story.id}/plan" target="_blank" rel="noopener noreferrer">The whole plan &#8599;</a></p>`;
}

/** @param {{ user: Row, story: Row, chapters?: Row[], castList?: Row[], error?: string|null, notice?: string, vocabulary?: any, values?: FormValues }} props */
function newChapterPage({ user, story, chapters = [], castList = [], error, notice = '', vocabulary = {}, values = /** @type {FormValues} */ ({}) }) {
  // Where it will go: the planned place when there is one, otherwise the end.
  const next = values.position && values.position !== 'end' ? Number(values.position) : chapters.length + 1;
  return layout({
    title: `New chapter - ${story.title}`,
    user,
    wide: true,
    body: `
      ${writerBar({ back: values.planSlot ? `/stories/${story.id}/plan` : `/stories/${story.id}`, backLabel: values.planSlot ? 'The plan' : story.title, cancelHref: values.planSlot ? `/stories/${story.id}/plan` : `/stories/${story.id}`, publishLabel: 'Publish chapter', sheet: false, draft: !!values.planSlot })}
      ${editorGrid(`
      <div class="writer-card">
        <h1 class="sr-only">Add a chapter to &ldquo;${escapeHtml(story.title)}&rdquo;</h1>
        <p class="writer-kicker">${escapeHtml(story.title)} &middot; chapter ${next}</p>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/stories/${story.id}/chapters/new" class="chapter-form" id="${FORM_ID}" enctype="multipart/form-data">
          ${values.planSlot ? `<input type="hidden" name="planSlot" value="${escapeHtml(String(values.planSlot))}">
          ${notice ? `<p class="flash info" role="status">${escapeHtml(notice)}</p>` : ''}
          <p class="plan-writing-note muted">Writing this from the plan${values.plan && values.plan.draftSavedAt ? `, from the draft you saved ${timeHtml(values.plan.draftSavedAt)}` : ''}.
            <em>Save draft</em> keeps it for you alone; <em>Publish chapter</em> puts it where the plan has it. What the plan says is beside the text.</p>` : notice ? `<p class="flash info" role="status">${escapeHtml(notice)}</p>` : ''}
          <label class="title-field"><span class="sr-only">Chapter title</span><input type="text" name="title" value="${escapeHtml(values.title || '')}" required placeholder="Chapter title" autofocus></label>
          ${mainField({ content: values.content || '', placeholder: 'Write the chapter here...', storyId: story.id, breaks: true })}
          ${detailsDrawer(`
            <label>Chapter summary<textarea name="summary" rows="2">${escapeHtml(values.summary || '')}</textarea></label>
            ${positionField(chapters, values.position)}
            ${stageField(values.stage)}
            ${arcField(values.arcTitle)}
            ${povAndStrandFields(values.pov, values.strand, vocabulary)}
            ${whenFields(values.storyWhen, values.storyDay, vocabulary)}
            <div class="no-js-only">${fileUploadField()}</div>`)}
        </form>
      </div>
      `, sideTabs([
        values.plan ? { id: 'plan', label: 'Plan', html: planPanel(values.plan, story) } : null,
        { id: 'checks', label: 'Checks', html: '', attrs: 'data-checks-slot' },
        { id: 'bible', label: 'Glossary', html: editorBiblePanel({ story_id: story.id }) },
        { id: 'beside', label: 'Beside', html: besidePanel({ story, chapters, entities: castList, open: true }) },
      ]))}
      <script src="/js/nspell.bundle.js"></script>
      <script src="/js/writing-analyzer.js" defer></script>`,
  });
}

// ---------- edit chapter (title, summary, and the text itself) ----------


// Somebody saved while this editor was open. Nothing of theirs and
// nothing of yours is thrown away here: their version is in the database
// and shown below, yours is still in the box above, and the next save is
// yours to make on purpose.
function conflictNotice(chapter, conflict) {
  return `
    <div class="conflict-notice">
      <p><strong>Somebody saved version ${conflict.version} of this chapter while you had it open.</strong>
      Nothing has been lost and nothing has been overwritten: your text is still in the box below, and theirs is in the chapter.</p>
      <p class="muted">Saved ${timeHtml(conflict.at)}${conflict.changelog ? ` &middot; &ldquo;${escapeHtml(conflict.changelog)}&rdquo;` : ''}.
      <a href="/chapters/${chapter.id}/diff" target="_blank" rel="noopener noreferrer">See what changed &#8599;</a></p>
      <details class="conflict-theirs">
        <summary>What version ${conflict.version} says</summary>
        <div class="reading-pane">${renderHighlighted(parseMarkdown(conflict.content), [], null)}</div>
      </details>
      <p>Take anything of theirs you want into your own text, then save again. Saving now publishes your version on top of theirs, which is a thing you can do, but the version history keeps both either way.</p>
    </div>`;
}




// Where this editor stands relative to what readers see. Said once, at
// the top, in a sentence -- the difference between "saved" and
// "published" is the whole point of having drafts, and it must never be
// something the author has to work out.
function draftNotice(chapter, draft, justDrafted, publishedVersionNumber) {
  if (!draft) return '';
  const behind = draft.base_version && publishedVersionNumber > draft.base_version;
  return `
    <div class="draft-notice${justDrafted ? ' just-saved' : ''}" role="status">
      <p><strong>${justDrafted ? 'Draft saved.' : 'This is your unpublished draft.'}</strong>
      Saved ${timeHtml(draft.updated_at)}; readers still see version ${publishedVersionNumber}. <a href="/help/writing-a-chapter" class="muted">How drafts work</a></p>
      ${behind ? `<p class="draft-behind">Version ${publishedVersionNumber} was published after you started this draft (from v${draft.base_version}). <a href="/chapters/${chapter.id}/diff?from=${draft.base_version}&to=${publishedVersionNumber}" target="_blank" rel="noopener noreferrer">See what changed &#8599;</a> Publishing will ask before it goes on top.</p>` : ''}
      <form method="post" action="/chapters/${chapter.id}/draft/discard" class="inline-form"
            data-confirm="Throw this draft away and go back to version ${publishedVersionNumber}? The draft cannot be recovered.">
        <button class="btn ghost tiny" type="submit">Discard the draft</button>
      </form>
    </div>`;
}

// A note beside the editor, as something to act on while rewriting. The
// reference copy (renderCommentReadOnly) with the author's answers under
// it: go to the words, put a suggested rewrite into the text, accept,
// turn down. The forms work without a script (they go to the chapter
// page); editor-notes.js does them in place so the rewrite is not left.
function editorNote(c, replies) {
  const inner = renderCommentReadOnly(c, { replies });
  if (c.deleted_at || c.kind === 'praise') return inner;
  const pending = c.status === 'pending';
  const hasSuggestion = c.suggestion != null;
  const attrs = ` data-comment-id="${c.id}" data-status="${escapeHtml(c.status)}"`
    + `${c.quoted_text ? ` data-quoted="${escapeHtml(c.quoted_text)}"` : ''}`
    + `${hasSuggestion ? ` data-suggestion="${escapeHtml(c.suggestion)}"` : ''}`;
  const who = escapeHtml(c.author_name);
  const actions = pending ? `
      <div class="editor-note-actions" role="group" aria-label="What to do with the note by ${who}">
        ${c.quoted_text ? '<button type="button" class="btn tiny ghost note-find" hidden>Go to the words</button>' : ''}
        ${hasSuggestion ? '<button type="button" class="btn tiny note-use" hidden>Put it in the text</button>' : ''}
        <form method="post" action="/comments/${c.id}/status" class="inline-form note-answer">
          <button name="status" value="accepted" class="btn tiny" type="submit">Accept</button>
          <button name="status" value="rejected" class="btn tiny ghost" type="submit">Turn down</button>
        </form>
      </div>` : `
      <div class="editor-note-actions" role="group" aria-label="What to do with the note by ${who}">
        <form method="post" action="/comments/${c.id}/reopen" class="inline-form note-answer">
          <button class="btn tiny ghost" type="submit">Reopen</button>
        </form>
      </div>`;
  // The reference copy is one element; the actions go inside it, at the end.
  return inner.replace(/^(\s*<div class="comment[^"]*")/, `$1${attrs}`).replace(/<\/div>\s*$/, `${actions}\n    </div>`);
}

/** @param {{ user: Row, chapter: Row, latestContent: string, comments?: Row[], error?: string|null, canWrite?: boolean, conflict?: any, latestVersionNumber?: number, publishedVersionNumber?: number, draft?: Row|null, justDrafted?: boolean, desk?: any, vocabulary?: any, siblings?: Row[], castList?: Row[], values?: FormValues }} props */
function editChapterPage({ user, chapter, latestContent, comments = [], error, canWrite = true, conflict = null, latestVersionNumber = 0, publishedVersionNumber = 0, draft = null, justDrafted = false, desk = null, vocabulary = {}, siblings = [], castList = [], values = /** @type {FormValues} */ ({}) }) {
  const published = publishedVersionNumber || latestVersionNumber;
  const topLevelComments = comments.filter((c) => c.parent_id == null);
  const repliesByParent = {};
  comments.filter((c) => c.parent_id != null).forEach((c) => {
    (repliesByParent[c.parent_id] = repliesByParent[c.parent_id] || []).push(c);
  });
  const hasComments = topLevelComments.length > 0;
  const commentsHtml = topLevelComments
    .map((c) => editorNote(c, repliesByParent[c.id] || []))
    .join('');
  const pendingCount = topLevelComments.filter((c) => c.status === 'pending' && !c.deleted_at && c.kind !== 'praise').length;
  // Data for the editor's best-effort inline highlight -- see
  // resolveCommentRanges in writing-analyzer.js for why this is a plain
  // substring search rather than an exact offset mapping.
  const commentsData = topLevelComments
    .filter((c) => !c.deleted_at && c.quoted_text)
    .map((c) => ({ id: c.id, quoted: c.quoted_text, status: c.status }));

  const writerCard = `
    <div class="writer-card">
      <h1 class="sr-only">Edit chapter ${chapter.chapter_number}</h1>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      ${conflict ? conflictNotice(chapter, conflict) : ''}
      ${conflict ? '' : draftNotice(chapter, draft, justDrafted, published)}
      <form method="post" action="/chapters/${chapter.id}/edit" class="chapter-form" id="${FORM_ID}" enctype="multipart/form-data"
            data-draft-url="/chapters/${chapter.id}/draft"${desk ? ' data-desk' : ''}>
        ${desk ? `<script type="application/json" id="desk-data">${toScriptJson(desk)}</script>` : ''}
        <input type="hidden" name="baseVersion" value="${conflict ? conflict.version : (latestVersionNumber || '')}">
        <label class="title-field"><span class="sr-only">Chapter title</span><input type="text" name="title" value="${escapeHtml(values.title ?? chapter.title)}" required placeholder="Chapter title"></label>
        ${mainField({ content: values.content ?? latestContent, placeholder: 'Write the chapter here...', storyId: chapter.story_id, breaks: true })}
        ${detailsDrawer(`
          <label>Chapter summary<textarea name="summary" rows="2">${escapeHtml(values.summary ?? chapter.summary ?? '')}</textarea></label>
          ${stageField(values.stage ?? chapter.stage)}
          ${arcField(values.arcTitle ?? chapter.arc_title)}
          ${povAndStrandFields(values.pov ?? chapter.pov, values.strand ?? chapter.strand, vocabulary)}
          ${whenFields(values.storyWhen ?? chapter.story_when, values.storyDay ?? chapter.story_day, vocabulary)}
          <div class="no-js-only">${uploadVersionField()}</div>`)}
        ${publishSheet(`
          <label>What changed? <span class="muted">Shown in the version history, and optional.</span>
            <input type="text" name="changelog" value="${escapeHtml(values.changelog || '')}" placeholder="e.g. Tightened the opening, fixed a couple of typos"></label>`,
          { heading: `Publish as version ${published + 1}`, button: `Publish as v${published + 1}` })}
      </form>
    </div>`;

  const notesPanel = hasComments ? `
      <section class="editor-notes" aria-labelledby="editor-notes-title" data-pending="${pendingCount}">
        <div class="editor-notes-head">
          <h2 id="editor-notes-title">Notes <span class="notes-count">${pendingCount} pending</span></h2>
          <span class="editor-notes-step" hidden>
            <button type="button" class="btn tiny ghost" data-step="-1" title="Previous note waiting (Alt+K)">&uarr; Previous</button>
            <button type="button" class="btn tiny ghost" data-step="1" title="Next note waiting (Alt+J)">Next &darr;</button>
          </span>
        </div>
        <p class="hint">Go to each note's words, rewrite, and answer it here. Replies are on the chapter page.</p>
        <div id="editor-note-list">${commentsHtml}</div>
      </section>` : '';

  const mainHtml = editorGrid(writerCard, sideTabs([
    { id: 'checks', label: 'Checks', html: '', attrs: 'data-checks-slot' },
    hasComments ? { id: 'notes', label: pendingCount ? `Notes (${pendingCount})` : 'Notes', html: notesPanel } : null,
    canWrite ? { id: 'bible', label: 'Glossary', html: editorBiblePanel(chapter) } : null,
    canWrite ? { id: 'beside', label: 'Beside', html: besidePanel({ chapter, story: { id: chapter.story_id }, chapters: siblings, entities: castList, open: true }) } : null,
    canWrite && chapter.plan_notes ? { id: 'plan', label: 'Plan', html: planPanel({ notes: chapter.plan_notes, arcs: [] }, { id: chapter.story_id }) } : null,
  ])) + (hasComments ? `
    <script type="application/json" id="chapter-comments-data">${toScriptJson(commentsData)}</script>` : '');

  return layout({
    title: `Edit - ${chapter.title}`,
    user,
    wide: true,
    body: `
      ${writerBar({ back: `/chapters/${chapter.id}`, backLabel: `Chapter ${chapter.chapter_number}: ${chapter.title}`, cancelHref: `/chapters/${chapter.id}`, publishLabel: `Publish${published ? ` as v${published + 1}` : ''}`, draft: true })}
      ${mainHtml}
      <script src="/js/nspell.bundle.js"></script>
      <script src="/js/writing-analyzer.js" defer></script>`,
  });
}

// A snapshot against the chapter as it stands, in prose, the same way the
// version comparison shows it.
function snapshotComparePage({ user, chapter, snapshot, againstLabel, blocks, summary }) {
  const body = summary.identical
    ? '<p class="muted diff-identical">The snapshot and the chapter say the same thing, word for word.</p>'
    : blocks.map(diffBlockHtml).join('\n');
  return layout({
    title: `Snapshot - ${chapter.title}`,
    user,
    body: `
      <p class="breadcrumb"><a href="/chapters/${chapter.id}/edit">&larr; Back to the editor</a></p>
      <div class="page-head"><h1>&ldquo;${escapeHtml(snapshot.name)}&rdquo;</h1></div>
      <p class="muted diff-summary">Snapshot taken ${timeHtml(snapshot.created_at)}, compared with ${escapeHtml(againstLabel)}.
        ${summary.identical ? '' : `<span class="diff-count added">+${summary.added} word${summary.added === 1 ? '' : 's'}</span>
        <span class="diff-count removed">&minus;${summary.removed} word${summary.removed === 1 ? '' : 's'}</span>`}
        Struck through is what the snapshot had; underlined is what is there now.</p>
      <div class="reading-pane"><div class="diff-body">${body}</div></div>`,
  });
}

// ---------- story detail (chapter list) ----------

module.exports = {
  snapshotComparePage,
  archivedStoriesPage,
  conflictNotice,
  editChapterPage,
  newChapterPage,
  newStoryPage,
};
