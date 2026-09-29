'use strict';

const { layout } = require('../lib/layout');
const { storyBar } = require('./story-nav');
const { escapeHtml } = require('../lib/util');
const { parseMarkdown, renderHighlighted } = require('../lib/markdown');
const { characterStudyFieldset, characterStudyNudge, characterStudySection } = require('./character-study');
const { ICONS, bible, bibleImages, emptyState, whenFields } = require('./shared');
const { entityTimelineBlock, entityStatusBlock } = require('./bible-when');
// One per story: its people, places, groups, things and events. Not the
// glossary -- that mirrors the shared wiki and is read-only here. This is
// the author's own, and it is the only thing in the app that knows which
// chapters a character is actually in (see lib/story-bible.js).

const KIND_ORDER = bible.KINDS;

function entityKindLabel(kind) {
  return bible.KIND_LABELS[kind] || bible.KIND_LABELS[bible.DEFAULT_KIND];
}

function entityBadges(entity) {
  const bits = [];
  if (entity.role) bits.push(`<span class="ent-badge role-${entity.role}">${escapeHtml(bible.ROLE_LABELS[entity.role])}</span>`);
  if (entity.status) bits.push(`<span class="ent-badge status-${entity.status}">${escapeHtml(bible.STATUS_LABELS[entity.status])}</span>`);
  return bits.join('');
}


// "Chapters 3-11, 7 of them" says more in one line than either number
// does alone: the span is where they live in the story, the count is how
// much of it they are in.
function appearanceSummary(entity) {
  if (!entity.appearances) return '<span class="ent-none">Not named in any chapter</span>';
  if (entity.appearances === 1) return `In chapter ${entity.first_chapter}`;
  if (entity.appearances === entity.last_chapter - entity.first_chapter + 1) return `In chapters ${entity.first_chapter}&ndash;${entity.last_chapter}`;
  return `In ${entity.appearances} chapters, ${entity.first_chapter}&ndash;${entity.last_chapter}`;
}


// Where the crop keeps, written the way CSS wants it. A picture row and a
// cover row spell the two numbers differently, so this takes either.
function focusPosition(image) {
  const pick = (a, b) => {
    const n = Number(a !== undefined && a !== null ? a : b);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 50;
  };
  return `${pick(image.focus_x, image.focusX)}% ${pick(image.focus_y, image.focusY)}%`;
}


// The initial stands in for a picture that is not there. The box is the
// same box either way: a cast list where half the rows are indented and
// half are not reads as two lists, and the eye spends its time on the
// ragged edge instead of on the names.
function entityMonogram(entity) {
  const letter = String(entity.name || '').trim().charAt(0).toUpperCase();
  return `<span class="row-cover row-cover-empty" aria-hidden="true">${escapeHtml(letter || '?')}</span>`;
}

function entityRow(entity, cover) {
  const search = `${entity.name} ${entity.summary || ''} ${entity.alias_list || ''}`.toLowerCase();
  return `
    <a class="chapter-row glossary-row has-cover" href="/bible/${entity.id}" data-search="${escapeHtml(search)}">
      ${cover
    ? `<img class="row-cover" src="/entity-images/${cover.id}" alt="" loading="lazy" style="object-position: ${focusPosition(cover)}">`
    : entityMonogram(entity)}
      <div class="chapter-row-main">
        <h3>${escapeHtml(entity.name)} ${entityBadges(entity)}</h3>
        ${entity.summary ? `<p class="muted">${escapeHtml(entity.summary)}</p>` : ''}
        ${entity.alias_list ? `<p class="entity-aka">Also ${escapeHtml(entity.alias_list)}</p>` : ''}
      </div>
      <div class="chapter-row-meta">
        <span>${appearanceSummary(entity)}</span>
        ${entity.link_count ? `<span>${entity.link_count} relation${entity.link_count === 1 ? '' : 's'}</span>` : ''}
      </div>
    </a>`;
}

function bibleConflictNotice(conflicts) {
  if (!conflicts.length) return '';
  return `
    <div class="bible-conflicts">
      <p><strong>${conflicts.length} name${conflicts.length === 1 ? ' is' : 's are'} shared by more than one entry.</strong>
      A shared name is counted for nobody, because guessing which of them a chapter meant would put people in scenes they are not in. Give one of them a distinguishing alias and the appearances come back.</p>
      <ul>
        ${conflicts.map((c) => `<li><strong>${escapeHtml(c.name)}</strong> &mdash; ${c.entities.map((e) => `<a href="/bible/${e.id}">${escapeHtml(e.name)}</a>`).join(', ')}</li>`).join('')}
      </ul>
    </div>`;
}

const SORT_LABELS = {
  name: 'A to Z', appearances: 'Most present', role: 'By role', recent: 'Lately changed',
};

function bibleSortBar(story, kind, sort) {
  const href = (value) => {
    const qs = new URLSearchParams();
    if (kind) qs.set('kind', kind);
    if (value !== 'name') qs.set('sort', value);
    const tail = qs.toString();
    return `/stories/${story.id}/bible${tail ? `?${tail}` : ''}`;
  };
  return `
    <div class="glossary-filters">
      <span class="filter-label">Order</span>
      <div class="tag-chips">
        ${Object.keys(SORT_LABELS).map((value) => `
          <a class="tag-chip${value === sort ? ' current' : ''}" href="${escapeHtml(href(value))}"${value === sort ? ' aria-current="true"' : ''}>${escapeHtml(SORT_LABELS[value])}</a>`).join('')}
      </div>
    </div>`;
}


// Who can read this bible, said plainly, with the switch beside it for
// whoever gets to decide. A coauthor sees the state and not the switch:
// they write in the bible, but whether it is anybody else's business is
// the story's to say, and the story has one owner.
function biblePrivacyBlock(story, isOwner) {
  // The owner's, and nobody else's -- not the switch, and not the state
  // it is in. A coauthor writes in the bible; who else may read it is the
  // one thing about it that is not theirs to see or to set.
  if (!isOwner) return '';
  const isPrivate = !!story.bible_private;
  const line = isPrivate
    ? 'Only the people who write this story can see it, and its names do not link in the chapters.'
    : 'Anyone who can read the story can read its glossary.';
  return `
    <form method="post" action="/stories/${story.id}/bible/privacy" class="bible-privacy inline-form">
      <span class="ent-badge${isPrivate ? ' status-private' : ''}">${isPrivate ? 'Private' : 'Open'}</span>
      <span class="muted">${line}</span>
      <input type="hidden" name="visibility" value="${isPrivate ? 'open' : 'private'}">
      <button class="btn ghost small" type="submit">${isPrivate ? 'Open it to readers' : 'Make it private'}</button>
    </form>`;
}

function bibleIndexPage({
  user, story, entities = [], counts = {}, total = 0, kind = '', canWrite = false,
  conflicts = [], notice = '', covers = new Map(), sort = 'name', isOwner = false, notNames = [], unstudied = [],
}) {
  // The kinds are a row of tabs with their counts, not five big numbers:
  // on a young bible those were mostly zeros, and the biggest thing on the
  // page. What each kind holds is the tab's tooltip.
  const door = (k) => `
    <a class="tag-chip kind-tab${k === kind ? ' current' : ''}${counts[k] ? '' : ' is-empty'}" href="/stories/${story.id}/bible?kind=${k}"
       title="${escapeHtml(bible.KIND_BLURBS[k])}"${k === kind ? ' aria-current="page"' : ''}>
      ${escapeHtml(bible.KIND_PLURALS[k])}<span class="tag-chip-count">${counts[k] || 0}</span>
    </a>`;

  const list = entities.length
    ? `<h2 class="sr-only">Entries</h2><div class="chapter-list" id="glossary-list">${entities.map((e) => entityRow(e, covers.get(e.id))).join('')}</div>
       <p class="no-matches" id="glossary-no-matches" hidden>Nothing here matches.</p>`
    : emptyState({
      art: 'sheets',
      title: total ? 'Nothing of that kind yet' : 'The glossary is empty',
      body: total
        ? 'Every entry is filed under one kind. Nothing has been filed under this one yet.'
        : 'This is where the people, places and things of the story live -- who they are, who they know, and which chapters they turn up in. The chapters are worked out from the text itself, so an entry starts paying for itself the moment you write it down.',
      action: canWrite ? `<a class="btn" href="/stories/${story.id}/bible/new">${ICONS.plus}Add the first entry</a>` : '',
    });

  return layout({
    title: `Glossary &middot; ${story.title}`,
    user,
    body: `
      ${storyBar(story, { current: 'glossary', canWrite, isOwner: story.author_id === user.id })}
      <div class="page-head">
        <div>
          <h1>Glossary</h1>
          <p class="muted">The people, places and things of <a href="/stories/${story.id}">${escapeHtml(story.title)}</a> &mdash; ${total} entr${total === 1 ? 'y' : 'ies'}. Which chapters each one appears in is read out of the chapters themselves, every time they change.</p>
        </div>
        <div class="page-head-actions">
          ${canWrite ? `<a class="btn" href="/stories/${story.id}/bible/new">${ICONS.plus}New entry</a>` : ''}
          ${canWrite ? `
            <form method="post" action="/stories/${story.id}/bible/rescan" class="inline-form">
              <button class="btn ghost small" type="submit">Rescan chapters</button>
            </form>` : ''}
        </div>
      </div>
      ${notice ? `<p class="flash info">${escapeHtml(notice)}</p>` : ''}
      ${biblePrivacyBlock(story, isOwner)}
      ${bibleConflictNotice(conflicts)}
      ${canWrite ? characterStudyNudge(unstudied) : ''}
      ${total ? `
        <nav class="kind-tabs" aria-label="Kinds of entry">
          <a class="tag-chip kind-tab${kind ? '' : ' current'}" href="/stories/${story.id}/bible"${kind ? '' : ' aria-current="page"'}>Everything<span class="tag-chip-count">${total}</span></a>
          ${KIND_ORDER.map(door).join('')}
        </nav>
        <form method="get" action="/stories/${story.id}/bible" class="inline-form glossary-search">
          <input type="search" id="glossary-filter" name="q" placeholder="Filter by name, alias or summary..." autocomplete="off">
          ${kind ? `<input type="hidden" name="kind" value="${escapeHtml(kind)}">` : ''}
          <button class="btn ghost small" type="submit">Filter</button>
        </form>
        ${bibleSortBar(story, kind, sort)}
        <p class="muted"><span id="glossary-count">${entities.length} entr${entities.length === 1 ? 'y' : 'ies'}</span>${kind ? ` &middot; ${escapeHtml(bible.KIND_PLURALS[kind])}` : ''}.${kind === 'event' ? ` <a href="/stories/${story.id}/timeline">See them on the timeline &rarr;</a>` : ''}</p>` : ''}
      ${list}
      ${canWrite ? notNamesBlock(story, notNames) : ''}`,
  });
}

// The words put away as "not a name", with the way back beside each. It
// lived on the story page, a long way from where anybody would look for it.
function notNamesBlock(story, notNames) {
  if (!notNames.length) return '';
  return `
    <details class="not-names" id="not-names">
      <summary>Words that are not names (${notNames.length})</summary>
      <p class="muted">Put away from the chapters' lists of names that are not in the glossary. Bring one back and it is offered again.</p>
      <ul class="not-names-list">
        ${notNames.map((n) => `
          <li>
            <span>${escapeHtml(n.name)}</span>
            <form method="post" action="/stories/${story.id}/bible/not-names/${n.id}/delete" class="inline-form" data-inline-form data-then="remove">
              <input type="hidden" name="returnTo" value="/stories/${story.id}/bible#not-names">
              <button class="btn ghost tiny" type="submit" aria-label="Offer ${escapeHtml(n.name)} again">Bring back</button>
            </form>
          </li>`).join('')}
      </ul>
    </details>`;
}

function entityAppearanceList(entity, appearances, chapters, canWrite) {
  const shown = appearances.filter((a) => !a.archived_at);
  const first = shown.length ? shown[0].chapter_number : null;
  const rows = shown.length ? shown.map((a) => `
    <li>
      <a href="/chapters/${a.chapter_id}">Chapter ${a.chapter_number}: ${escapeHtml(a.title)}</a>
      ${a.chapter_number === first ? '<span class="ent-badge first-here">First</span>' : ''}
      <span class="ent-mentions">${a.source === 'manual'
        ? 'added by hand'
        : `${a.mentions} mention${a.mentions === 1 ? '' : 's'}${a.first_name && a.first_name.toLowerCase() !== entity.name.toLowerCase() ? ` as &ldquo;${escapeHtml(a.first_name)}&rdquo;` : ''}`}</span>
    </li>`).join('') : '<li class="ent-none">Not named in any chapter yet.</li>';

  const inChapter = new Set(shown.map((a) => a.chapter_id));
  const editor = canWrite && chapters.length ? `
    <details class="appearance-editor">
      <summary>Correct this</summary>
      <p class="muted">The scan only sees names. Somebody present but never named is missed; a name that is also a ship or a common word is found too often. Tick what the text got wrong -- your correction survives every rescan.</p>
      <form method="post" action="/bible/${entity.id}/appearances">
        <ul class="appearance-ticks">
          ${chapters.filter((c) => !c.archived_at).map((c) => `
            <li>
              <label class="tick">
                <input type="checkbox" name="chapter" value="${c.id}" ${inChapter.has(c.id) ? 'checked' : ''}>
                <span>Chapter ${c.chapter_number}: ${escapeHtml(c.title)}</span>
              </label>
            </li>`).join('')}
        </ul>
        <button class="btn ghost small" type="submit">Save appearances</button>
      </form>
    </details>` : '';

  return `<ul class="appearance-list">${rows}</ul>${editor}`;
}

function entityRelationBlock(entity, links, others, canWrite) {
  const rows = links.length ? links.map((l) => `
    <li>
      <div class="rel-main">
        <span class="rel-label">${l.label ? escapeHtml(l.label) : 'related to'}</span>
        <a href="/bible/${l.other_id}">${escapeHtml(l.other_name)}</a>
        <span class="rel-kind">${escapeHtml(entityKindLabel(l.other_kind))}</span>
      </div>
      ${canWrite ? `
        <form method="post" action="/bible/${entity.id}/links/${l.id}/delete" class="inline-form rel-remove">
          <button class="btn ghost tiny" type="submit">Remove</button>
        </form>` : ''}
    </li>`).join('') : '<li class="ent-none">Nobody yet.</li>';

  const form = canWrite && others.length ? `
    <form method="post" action="/bible/${entity.id}/links" class="relation-form">
      <label>Relation
        <input type="text" name="label" placeholder="sister of, serves under, owns..." maxlength="80" list="relation-words">
      </label>
      <datalist id="relation-words">
        ${(entity.kind === 'event'
    ? ['leads to', 'caused by', 'part of', 'happens during', 'fought in', 'was at', 'ends', 'begins']
    : ['sister of', 'brother of', 'parent of', 'child of', 'married to', 'serves under', 'commands', 'lives in', 'member of', 'took part in', 'owns'])
    .map((w) => `<option value="${w}"></option>`).join('')}
      </datalist>
      <label>To
        <select name="to">
          ${others.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}
        </select>
      </label>
      <label>Called back the other way
        <input type="text" name="reverse_label" placeholder="leave blank if it reads the same both ways" maxlength="80">
      </label>
      <button class="btn ghost small" type="submit">Add relation</button>
    </form>` : '';

  return `<ul class="relation-list">${rows}</ul>${form}`;
}


// Choosing what a square cut out of this picture keeps. The two numbers
// are the control: they work with nothing switched on, they are what gets
// saved, and clicking the picture is only a faster way of typing them.
// The square beside them is the actual crop at the actual size, because
// the only honest preview of a thumbnail is a thumbnail.
function cropForm(entity, image, isCover) {
  const id = `${entity.id}-${image.id}`;
  return `
    <form method="post" action="/bible/${entity.id}/images/${image.id}/focus" class="crop-form" data-focus-form="${id}">
      <span class="crop-preview">
        <img src="/entity-images/${image.id}" alt="" style="object-position: ${focusPosition(image)}" data-focus-preview>
      </span>
      <span class="crop-fields">
        <span class="crop-label">${isCover ? 'What the thumbnail keeps' : 'If this becomes the cover'}</span>
        <span class="crop-numbers">
          <label>Across <input type="number" name="focusX" value="${focusPosition(image).split(' ')[0].replace('%', '')}" min="0" max="100" step="1" data-focus-x></label>
          <label>Down <input type="number" name="focusY" value="${focusPosition(image).split(' ')[1].replace('%', '')}" min="0" max="100" step="1" data-focus-y></label>
          <button class="btn ghost tiny" type="submit">Save crop</button>
        </span>
      </span>
    </form>`;
}


// The gallery. The first picture is the entry's face -- in the index, at
// the top of its own page -- so "make this the portrait" is just "move it
// to the front", and there is no second concept to keep in step.
function entityImageBlock(entity, images, canWrite) {
  const figures = images.map((image, i) => `
    <figure class="entity-figure">
      ${canWrite ? `
        <a class="figure-shot" href="/entity-images/${image.id}" target="_blank" rel="noopener noreferrer"
           data-focus-picker="${entity.id}-${image.id}">
          <img src="/entity-images/${image.id}" alt="${escapeHtml(image.caption || entity.name)}" loading="lazy">
          <span class="focus-pin" style="left: ${focusPosition(image).split(' ')[0]}; top: ${focusPosition(image).split(' ')[1]}"></span>
        </a>`
    : `
        <a class="figure-shot" href="/entity-images/${image.id}" target="_blank" rel="noopener noreferrer">
          <img src="/entity-images/${image.id}" alt="${escapeHtml(image.caption || entity.name)}" loading="lazy">
        </a>`}
      ${i === 0 ? '<span class="cover-flag">Cover</span>' : ''}
      <figcaption>
        ${canWrite ? `
          ${cropForm(entity, image, i === 0)}
          <form method="post" action="/bible/${entity.id}/images/${image.id}/caption" class="caption-form">
            <input type="text" name="caption" value="${escapeHtml(image.caption)}" placeholder="Caption" maxlength="240">
            <button class="btn ghost tiny" type="submit">Save</button>
          </form>
          <div class="figure-actions">
            ${i > 0 ? `<form method="post" action="/bible/${entity.id}/images/${image.id}/up" class="inline-form"><button class="btn ghost tiny" type="submit">&larr; Earlier</button></form>` : ''}
            ${i < images.length - 1 ? `<form method="post" action="/bible/${entity.id}/images/${image.id}/down" class="inline-form"><button class="btn ghost tiny" type="submit">Later &rarr;</button></form>` : ''}
            <form method="post" action="/bible/${entity.id}/images/${image.id}/delete" class="inline-form"><button class="btn ghost tiny danger" type="submit">Remove</button></form>
          </div>`
    : (image.caption ? escapeHtml(image.caption) : '')}
      </figcaption>
    </figure>`).join('');

  const adder = canWrite && images.length < bibleImages.MAX_IMAGES_PER_ENTRY ? `
    <form method="post" action="/bible/${entity.id}/images" enctype="multipart/form-data" class="image-form">
      <label>Add a picture
        <input type="file" name="image" accept="${bibleImages.ACCEPT_ATTRIBUTE}" data-shrink required>
      </label>
      <label>Caption <input type="text" name="caption" maxlength="240" placeholder="Optional"></label>
      <button class="btn ghost small" type="submit">Upload</button>
      <span class="hint">PNG, JPEG, GIF or WebP. Large pictures are shrunk in your browser before they are sent, so nothing waits on the upload.</span>
    </form>` : '';

  if (!figures && !adder) return '';
  return `
    <section class="entity-pictures" id="pictures">
      <h2 class="side-head">Pictures</h2>
      ${figures ? `<div class="figure-strip">${figures}</div>` : '<p class="ent-none">None yet.</p>'}
      ${adder}
    </section>`;
}


// The custom fields on an entry's page: what the template asked for, in
// its order, then whatever else this one entry needed. Blanks are not
// shown -- an unanswered question belongs in the form, not on the page.
function entityFieldList(fields) {
  if (!fields.length) return '';
  return `
    <section class="entity-fields">
      <h2 class="side-head">Details</h2>
      <dl class="field-list">
        ${fields.map((f) => `
          <div><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd></div>`).join('')}
      </dl>
    </section>`;
}


// One block per kind, all but the current one hidden. With JavaScript the
// block follows the "What is it" select; without it, the hidden ones stay
// hidden and you get the fields for the kind the entry actually is, which
// is the right answer anyway.
function fieldTemplateBlocks(templates, fields, currentKind) {
  return bible.KINDS.map((kind) => {
    const rows = bible.fieldRows(templates[kind] || [], kind === currentKind ? fields : [], 0);
    if (!rows.length) return '';
    return `
      <div class="template-fields" data-kind="${kind}"${kind === currentKind ? '' : ' hidden'}>
        ${rows.map((row) => `
          <label class="field-row">
            <span class="field-name">${escapeHtml(row.label)}</span>
            <input type="hidden" name="fieldLabel" value="${escapeHtml(row.label)}"${kind === currentKind ? '' : ' disabled'}>
            <input type="text" name="fieldValue" value="${escapeHtml(row.value)}" maxlength="${bible.MAX_FIELD_VALUE}"${kind === currentKind ? '' : ' disabled'}>
          </label>`).join('')}
      </div>`;
  }).join('');
}

function entityFieldFieldset({ templates, fields, currentKind, usedLabels }) {
  const template = templates[currentKind] || [];
  const inTemplate = new Set(template.map((l) => l.toLowerCase()));
  const extras = (fields || []).filter((f) => !inTemplate.has(f.label.toLowerCase()));
  const blank = (label = '', value = '') => `
    <div class="field-pair">
      <input type="text" name="fieldLabel" value="${escapeHtml(label)}" list="known-field-labels" placeholder="Field" maxlength="${bible.MAX_FIELD_LABEL}">
      <input type="text" name="fieldValue" value="${escapeHtml(value)}" placeholder="Value" maxlength="${bible.MAX_FIELD_VALUE}">
    </div>`;
  return `
    <div class="writer-section">
      <p class="writer-section-label">Details</p>
      <p class="hint">Whatever this story needs written down: a rank, a class, a home world, a colour of eyes. Fields the whole story shares are set once, <a href="#field-template">as a template per kind</a>; anything below that is this entry's own.</p>
      ${fieldTemplateBlocks(templates, fields, currentKind)}
      <div class="field-extras" id="field-extras">
        ${extras.map((f) => blank(f.label, f.value)).join('')}
        ${blank()}${blank()}${blank()}
      </div>
      <button class="btn ghost tiny" type="button" data-add-field>Another field</button>
      <datalist id="known-field-labels">
        ${(usedLabels || []).map((l) => `<option value="${escapeHtml(l)}"></option>`).join('')}
      </datalist>
    </div>`;
}


// The template editor: one box per kind, one label per line. A short
// ordered list is easier to rewrite than to edit row by row, and
// rewriting it is also how it gets reordered.
function fieldTemplatePage({ user, story, templates = {}, notice = '' }) {
  return layout({
    title: `Fields &middot; ${story.title}`,
    user,
    body: `
      <p class="breadcrumb"><a href="/stories/${story.id}/bible">&larr; ${escapeHtml(story.title)}: glossary</a></p>
      <div class="writer-card">
        <h1>What every entry says</h1>
        <p class="muted writer-intro">The fields the form should ask for, per kind. Every person gets a Rank and a Home world; every ship a Class. One label per line, in the order you want them asked.</p>
        <p class="muted">Taking a label out never deletes what an entry already said under it -- it just stops being asked for, and stays on the entries that answered it.</p>
        ${notice ? `<p class="flash info">${escapeHtml(notice)}</p>` : ''}
        <form method="post" action="/stories/${story.id}/bible/fields" class="chapter-form">
          ${bible.KINDS.map((kind) => `
            <label>${escapeHtml(bible.KIND_PLURALS[kind])}
              <textarea name="${kind}" rows="5" placeholder="One label per line">${escapeHtml((templates[kind] || []).join('\n'))}</textarea>
            </label>`).join('')}
          <div class="writer-actions">
            <a class="btn ghost" href="/stories/${story.id}/bible">Cancel</a>
            <button class="btn" type="submit">Save the template</button>
          </div>
        </form>
      </div>`,
  });
}

// ---------- changing things where they are shown ----------

// A piece of an entry that its writers can change where it stands: click
// it, change it, Enter. The value goes to /bible/:id/set and the text is
// put back. With JavaScript off it is plain text, and Edit is the way in.
/**
 * @param {any} entity
 * @param {string} field
 * @param {string} shown the HTML shown when it is not being edited
 * @param {{ value?: string, options?: Array<[string, string]>, placeholder?: string, tag?: string, cls?: string }} [opts]
 */
function inlineEdit(entity, field, shown, opts = {}) {
  const tag = opts.tag || 'span';
  const attrs = [
    `data-inline-edit="${field}"`,
    `data-entity="${entity.id}"`,
    `data-value="${escapeHtml(opts.value == null ? '' : opts.value)}"`,
    opts.options ? `data-options="${escapeHtml(JSON.stringify(opts.options))}"` : '',
    opts.placeholder ? `data-placeholder="${escapeHtml(opts.placeholder)}"` : '',
    'tabindex="0"', 'role="button"',
    `title="Click to change"`,
  ].filter(Boolean).join(' ');
  return `<${tag} class="inline-edit${opts.cls ? ` ${opts.cls}` : ''}" ${attrs}>${shown || `<span class="inline-empty">${escapeHtml(opts.placeholder || 'Add')}</span>`}</${tag}>`;
}

/** @returns {Array<[string, string]>} */
const KIND_OPTIONS = () => bible.KINDS.map((k) => /** @type {[string, string]} */ ([k, bible.KIND_LABELS[k]]));
/** @returns {Array<[string, string]>} */
const ROLE_OPTIONS = () => bible.ROLES.map((r) => /** @type {[string, string]} */ ([r, r ? bible.ROLE_LABELS[r] : 'No role']));


// How the scan finds this entry, said out loud: the names, the parts of a
// person's name it finds on their own, and what it leaves out and why. The
// place to fix a false alarm ("Kessler" is her brother) and to undo one.
function entityFoundAsBlock(entity, matching) {
  if (!matching) return '';
  const chip = (text) => `<span class="found-chip">${escapeHtml(text)}</span>`;
  const part = (text) => `
    <li class="found-part">${chip(text)}
      <form method="post" action="/bible/${entity.id}/not-as" class="inline-form" data-inline-form data-then="reload">
        <input type="hidden" name="form" value="${escapeHtml(text)}">
        <button class="btn ghost tiny" type="submit" aria-label="${escapeHtml(text)} on its own is not ${escapeHtml(entity.name)}">Not them</button>
      </form>
    </li>`;
  const toggle = (field, on, text) => `
    <form method="post" action="/bible/${entity.id}/set" class="found-toggle" data-inline-form data-autosubmit>
      <input type="hidden" name="field" value="${field}">
      <input type="hidden" name="value" value="0">
      <label class="found-check"><input type="checkbox" name="value" value="1"${on ? ' checked' : ''}> <span>${text}</span></label>
      <button class="btn ghost tiny" type="submit" data-no-js>Save</button>
    </form>`;
  const isPerson = entity.kind === 'person';
  return `
    <section id="found-as" class="found-as">
      <h2 class="side-head">Found in the text as</h2>
      <p class="found-names">${matching.names.map(chip).join(' ')}</p>
      ${isPerson && matching.parts.length ? `
        <p class="hint">And on their own, the parts of the name:</p>
        <ul class="found-parts">${matching.parts.map(part).join('')}</ul>` : ''}
      ${isPerson && matching.common.length ? `<p class="hint">${matching.common.map((w) => `<strong>${escapeHtml(w)}</strong>`).join(', ')} ${matching.common.length === 1 ? 'is also an ordinary word' : 'are also ordinary words'}, so not found alone. Add ${matching.common.length === 1 ? 'it' : 'one'} as an alias if it always means them.</p>` : ''}
      ${matching.sharedWith.length ? `<p class="hint">${matching.sharedWith.map((s) => `<strong>${escapeHtml(s.part)}</strong> is shared with ${s.others.map(escapeHtml).join(', ')}`).join('; ')}, so on its own it counts for neither.</p>` : ''}
      ${matching.conflicts.length ? `<p class="error">${matching.conflicts.map((c) => `<strong>${escapeHtml(c.name)}</strong> is also ${c.others.map(escapeHtml).join(', ')}`).join('; ')}: it is not counted for anybody until one of them stops using it.</p>` : ''}
      ${matching.blocked.length ? `
        <p class="hint">Not them on their own:</p>
        <ul class="found-parts">${matching.blocked.map((b) => `
          <li>${chip(b)}
            <form method="post" action="/bible/${entity.id}/unblock" class="inline-form" data-inline-form data-then="reload">
              <input type="hidden" name="form" value="${escapeHtml(b)}">
              <button class="btn ghost tiny" type="submit">Undo</button>
            </form>
          </li>`).join('')}</ul>` : ''}
      <div class="found-toggles">
        ${isPerson ? toggle('match_parts', entity.match_parts !== 0, 'Find the parts of the name on their own') : ''}
        ${toggle('any_case', !!entity.any_case, 'Also when written in lower case')}
      </div>
    </section>`;
}

// Two entries that turned out to be one person: this one folds into the
// other, which keeps its name and takes this one's as an alias.
function entityMergeBlock(entity, others) {
  if (!others.length) return '';
  return `
    <details class="entity-merge">
      <summary>Merge into another entry&hellip;</summary>
      <p class="muted">For two entries that are the same one. ${escapeHtml(entity.name)} goes, and becomes an alias of the one you pick, which takes its chapters, relations, pictures, details and status changes. Where both say something, the one you pick keeps its own; the rest is added.</p>
      <form method="post" action="/bible/${entity.id}/merge" class="inline-form"
            data-confirm="Merge ${escapeHtml(entity.name)} into the entry you picked? This cannot be undone from here.">
        <label>Into <select name="into">${others.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}</select></label>
        <button class="btn ghost small" type="submit">Merge</button>
      </form>
    </details>`;
}

function entityPage({
  user, story, entity, aliases = [], links = [], appearances = [], chapters = [],
  others = [], images = [], fields = [], canWrite = false, error = '', notice = '',
  statusChanges = [], matching = null, neighbours = null, study = null,
}) {
  const aliasText = aliases.map((a) => escapeHtml(a)).join(', ');
  const deleteWarning = [
    `Delete ${entity.name} from the glossary?`,
    appearances.length ? ` The list of the ${appearances.length} chapter${appearances.length === 1 ? '' : 's'} it is in goes too (the chapters stay).` : '',
    links.length ? ` ${links.length} relation${links.length === 1 ? '' : 's'} will be removed.` : '',
    images.length ? ` ${images.length} picture${images.length === 1 ? '' : 's'} will be deleted.` : '',
    ' If it is the same as another entry, merge it instead.',
  ].join('');
  const meta = canWrite
    ? `${inlineEdit(entity, 'kind', escapeHtml(entityKindLabel(entity.kind)), { value: entity.kind, options: KIND_OPTIONS() })}
       &middot; ${inlineEdit(entity, 'role', entity.role ? escapeHtml(bible.ROLE_LABELS[entity.role]) : '', { value: entity.role || '', options: ROLE_OPTIONS(), placeholder: 'No role' })}
       &middot; also ${inlineEdit(entity, 'aliases', aliasText, { value: aliases.join(', '), placeholder: 'no other names' })}`
    : `${escapeHtml(entityKindLabel(entity.kind))}${entity.role ? ` &middot; ${escapeHtml(bible.ROLE_LABELS[entity.role])}` : ''}${aliases.length ? ` &middot; also ${aliasText}` : ''}`;
  return layout({
    title: entity.name,
    user,
    flash: notice ? { type: 'info', message: notice } : null,
    body: `
      <p class="breadcrumb"><a href="/stories/${story.id}/bible">&larr; ${escapeHtml(story.title)}: glossary</a></p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <div class="page-head entity-head">
        <div class="entity-head-main">
          ${images.length
    ? `<img class="entity-portrait" src="/entity-images/${images[0].id}" alt="${escapeHtml(images[0].caption || entity.name)}" style="object-position: ${focusPosition(images[0])}">`
    : ''}
          <div>
          <h1>${canWrite ? inlineEdit(entity, 'name', escapeHtml(entity.name), { value: entity.name }) : escapeHtml(entity.name)}
            ${entity.status ? `<span class="ent-badge status-${entity.status}">${escapeHtml(bible.STATUS_LABELS[entity.status])}</span>` : ''}</h1>
          <p class="muted entity-meta">${meta}</p>
          ${canWrite
    ? inlineEdit(entity, 'summary', entity.summary ? escapeHtml(entity.summary) : '', { value: entity.summary || '', placeholder: 'Add the one line you would say about them', tag: 'p', cls: 'summary' })
    : (entity.summary ? `<p class="summary">${escapeHtml(entity.summary)}</p>` : '')}
          </div>
        </div>
        <div class="page-head-actions">
          ${canWrite ? `<a class="btn ghost small" href="/bible/${entity.id}/edit">Edit everything</a>` : ''}
        </div>
      </div>
      <div class="entity-grid">
        <div class="entity-main">
          ${entity.description ? `<div class="reading-pane entity-description">${renderHighlighted(parseMarkdown(entity.description), [], null)}</div>`
    : '<p class="muted">No description yet.</p>'}
          ${entity.secret ? `
            <details class="entity-secret">
              <summary>Spoilers &mdash; what the reader does not know yet</summary>
              <div class="reading-pane">${renderHighlighted(parseMarkdown(entity.secret), [], null)}</div>
            </details>` : ''}
          ${canWrite && study ? characterStudySection(entity, study) : ''}
          ${entityImageBlock(entity, images, canWrite)}
        </div>
        <aside class="entity-side">
          ${entityFieldList(fields)}
          ${entityTimelineBlock(entity, story, neighbours, canWrite)}
          ${entityStatusBlock(entity, statusChanges, chapters, canWrite)}
          <section>
            <h2 class="side-head">Appears in</h2>
            ${entityAppearanceList(entity, appearances, chapters, canWrite)}
          </section>
          ${canWrite ? entityFoundAsBlock(entity, matching) : ''}
          <section>
            <h2 class="side-head">Related</h2>
            ${entityRelationBlock(entity, links, others, canWrite)}
          </section>
        </aside>
      </div>
      ${canWrite ? `
        <div class="entity-danger">
          ${entityMergeBlock(entity, others)}
          <form method="post" action="/bible/${entity.id}/delete" class="inline-form danger-form">
            <button class="btn ghost small danger" type="submit" data-confirm="${escapeHtml(deleteWarning)}">Delete this entry</button>
          </form>
        </div>` : ''}`,
  });
}

function entityFormPage({ user, story, entity = null, aliases = [], fields = [], templates = {}, usedLabels = [], whens = [], study = {}, error = '' }) {
  const value = (field) => escapeHtml(entity ? entity[field] || '' : '');
  const selected = (field, option) => ((entity ? entity[field] : '') === option ? ' selected' : '');
  return layout({
    title: entity ? `Edit ${entity.name}` : 'New entry in the glossary',
    user,
    body: `
      <p class="breadcrumb"><a href="${entity ? `/bible/${entity.id}` : `/stories/${story.id}/bible`}">&larr; Back</a></p>
      <div class="writer-card">
      <h1>${entity ? `Edit ${escapeHtml(entity.name)}` : 'New entry in the glossary'}</h1>
      <p class="muted writer-intro">An entry is for you, not the reader: who this is, who they know, and which chapters they turn up in. The chapters are worked out from the text -- you only write the rest.</p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <form method="post" action="${entity ? `/bible/${entity.id}` : `/stories/${story.id}/bible`}" class="chapter-form entity-form">
        <label>Name
          <input type="text" name="name" value="${value('name')}" maxlength="${bible.MAX_NAME_LENGTH}" required autofocus>
        </label>
        <label>What is it
          <select name="kind">
            ${bible.KINDS.map((k) => `<option value="${k}"${selected('kind', k)}>${escapeHtml(bible.KIND_LABELS[k])}</option>`).join('')}
          </select>
        </label>
        <label>Also called
          <textarea name="aliases" rows="2" placeholder="One per line, or separated by commas. Ranks, nicknames, maiden names -- anything the prose calls them.">${escapeHtml(aliases.join('\n'))}</textarea>
        </label>
        <span class="hint">Aliases are how the chapter scan finds them: a chapter that only ever says "the Old Man" still counts as an appearance.</span>
        <label>One line
          <input type="text" name="summary" value="${value('summary')}" maxlength="240" placeholder="The sentence you would say if somebody asked who this was.">
        </label>
        <div class="entity-form-row">
          <label>Role
            <select name="role">
              ${bible.ROLES.map((r) => `<option value="${r}"${selected('role', r)}>${escapeHtml(bible.ROLE_LABELS[r])}</option>`).join('')}
            </select>
          </label>
          <label>Status at the start
            <select name="status">
              ${bible.STATUSES.map((s2) => `<option value="${s2}"${selected('status', s2)}>${escapeHtml(bible.STATUS_LABELS[s2])}</option>`).join('')}
            </select>
          </label>
        </div>
        ${whenFields(entity ? entity.story_when : '', entity ? entity.story_day : null, { whens, dayEnd: entity ? entity.story_day_end : null, withEnd: true })}
        ${entityFieldFieldset({
    templates, fields, usedLabels,
    currentKind: (entity && entity.kind) || bible.DEFAULT_KIND,
  })}
        ${characterStudyFieldset(study, (entity && entity.kind) || bible.DEFAULT_KIND)}
        <label>Description
          <textarea name="description" rows="14" placeholder="Who they are, where they come from, what they look like. Markdown works here, and so do links to other chapters.">${value('description')}</textarea>
        </label>
        <label>Spoilers
          <textarea name="secret" rows="6" placeholder="What you know and the reader does not -- kept folded away on the entry page.">${value('secret')}</textarea>
        </label>
        <div class="writer-actions">
          <button class="btn" type="submit">${entity ? 'Save' : 'Create entry'}</button>
          <a class="btn ghost" href="${entity ? `/bible/${entity.id}` : `/stories/${story.id}/bible`}">Cancel</a>
        </div>
      </form>
      <p class="muted" id="field-template"><a href="/stories/${story.id}/bible/fields">Set the fields every entry of a kind is asked for &rarr;</a></p>
      </div>`,
  });
}


// Names the chapter uses that the bible has never heard of. A suggestion,
// not a decision: one click writes the entry, and the entry is a stub with
// the name in it, which is the part that was stopping anybody.
// What a name found in the text is: a new entry of some kind, or another
// name for somebody already in the bible -- with the likeliest one, if any
// shares a word with it, chosen to begin with.
function nameKindSelect(name, entities) {
  const guess = bible.likelySameAs(name, entities);
  return `
    <select name="kind" aria-label="What ${escapeHtml(name)} is">
      <optgroup label="A new entry">
        ${bible.KINDS.map((k) => `<option value="${k}">${escapeHtml(bible.KIND_LABELS[k])}</option>`).join('')}
      </optgroup>
      ${entities.length ? `<optgroup label="Another name for">
        ${entities.map((e) => `<option value="alias:${e.id}"${e.id === guess ? ' selected' : ''}>${escapeHtml(e.name)}</option>`).join('')}
      </optgroup>` : ''}
    </select>`;
}

function missingNameRow(n, storyId, returnTo, entities) {
  return `
          <li>
            <form method="post" action="/stories/${storyId}/bible/quick" class="inline-form missing-row">
              <input type="hidden" name="name" value="${escapeHtml(n.name)}">
              <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
              <span class="missing-name">${escapeHtml(n.name)}</span>
              <span class="missing-count">${n.count}&times;</span>
              ${nameKindSelect(n.name, entities)}
              <input type="text" name="summary" class="missing-summary" maxlength="240" placeholder="One line (optional)"
                     aria-label="One line about ${escapeHtml(n.name)} (optional)">
              <button class="btn ghost tiny" type="submit">Add</button>
              <button class="btn ghost tiny missing-dismiss" type="submit" formaction="/stories/${storyId}/bible/not-names"
                      aria-label="${escapeHtml(n.name)} is not a name">Not a name</button>
            </form>
          </li>`;
}

function missingNamesBlock(names, storyId, returnTo, entities = []) {
  if (!names.length) return '';
  const own = names.filter((n) => !n.inGlossary);
  const glossary = names.filter((n) => n.inGlossary);
  return `
    <section class="missing-names">
      <h2 class="side-head">${own.length ? `${own.length} name${own.length === 1 ? '' : 's'} here ${own.length === 1 ? 'is' : 'are'} not in the glossary` : 'Every name here is accounted for'}</h2>
      <p class="muted">Proper names this chapter uses that no entry or dictionary word accounts for. Guesswork, so some of it will be wrong. Add one as a new entry, with its one line if you have it, or as <strong>another name for</strong> somebody already there (Colonel Jack is Jack); <strong>Not a name</strong> puts a false alarm away for the whole story.</p>
      ${own.length ? `<ul class="missing-list">${own.map((n) => missingNameRow(n, storyId, returnTo, entities)).join('')}</ul>` : ''}
      ${glossary.length ? `
        <details class="missing-glossary">
          <summary>${glossary.length} more ${glossary.length === 1 ? 'is a name' : 'are names'} the wiki already has</summary>
          <p class="muted">They link to the wiki as they are. Add one if, in this story, it is somebody of your own.</p>
          <ul class="missing-list">${glossary.map((n) => missingNameRow(n, storyId, returnTo, entities)).join('')}</ul>
        </details>` : ''}
    </section>`;
}


// Writing with something open beside you: the chapter before this one, or
// whichever entry in the bible you keep having to check.
//
// The links are real links to real pages, opening in a new tab, so this
// works with nothing switched on -- and with JavaScript the page is
// fetched into the column instead, which is the same thing without losing
// the draft. Nothing here is a second copy of a page: the panel asks the
// server for the one that already exists.
function besidePanel({ chapter = null, story, chapters = [], entities = [], open = false }) {
  const others = chapters.filter((c) => !chapter || c.id !== chapter.id);
  const near = chapter
    ? others.filter((c) => Math.abs(c.chapter_number - chapter.chapter_number) <= 2)
    : others.slice(-3);
  const pick = (href, src, label, note = '') => `
    <li><a href="${href}" target="_blank" rel="noopener noreferrer" data-beside-src="${src}"
           data-search="${escapeHtml(`${label} ${note}`.toLowerCase())}">
      <span>${escapeHtml(label)}</span>${note ? `<span class="beside-note">${escapeHtml(note)}</span>` : ''}
    </a></li>`;

  return `
    <details class="beside" id="beside" data-beside${open ? ' open' : ''}>
      <summary>Open something beside this</summary>
      <div class="beside-body">
        <p class="hint">The chapter before, or whoever you keep having to look up. It opens in the column beside the text; with JavaScript off, in a new tab.</p>
        ${near.length ? `
          <p class="writer-section-label">Chapters</p>
          <ul class="beside-picks">
            ${near.map((c) => pick(`/chapters/${c.id}`, `/chapters/${c.id}/beside`,
    `${c.chapter_number}. ${c.title}`, c.pov || '')).join('')}
          </ul>` : ''}
        ${entities.length ? `
          <p class="writer-section-label">Glossary</p>
          ${entities.length > 8 ? '<input type="search" class="beside-filter" placeholder="Filter" data-beside-filter aria-label="Filter the glossary">' : ''}
          <ul class="beside-picks" data-beside-list>
            ${entities.map((e) => pick(`/bible/${e.id}`, `/bible/${e.id}/beside`, e.name, e.summary || '')).join('')}
          </ul>` : `
          <p class="muted">Nothing in <a href="/stories/${story.id}/bible" target="_blank" rel="noopener noreferrer">the glossary</a> yet.</p>`}
      </div>
    </details>
    <aside class="beside-pane" data-beside-pane hidden aria-live="polite" aria-label="Open beside the editor">
      <div class="beside-pane-head">
        <span data-beside-title></span>
        <button class="btn ghost tiny" type="button" data-beside-close>Close</button>
      </div>
      <div class="beside-pane-body" data-beside-body></div>
    </aside>`;
}


// What the panel puts in that column: the page that already exists, with
// nothing around it. Not a second rendering of a chapter -- the same one.
function besideChapterFragment(chapter, content) {
  return `
    <h3>${chapter.chapter_number}. ${escapeHtml(chapter.title)}</h3>
    ${chapter.summary ? `<p class="muted">${escapeHtml(chapter.summary)}</p>` : ''}
    <div class="reading-pane beside-reading">${content}</div>`;
}

/**
 * An entry as a card: in the column beside the editor, or floating over a
 * chapter when a name in it is clicked. Opened from a chapter, it is the
 * entry as it stands there -- its status up to that chapter -- and for
 * the people writing the story it carries the fixes that belong to that
 * moment: the one line, the status from here on, "not them here", and a
 * relation, without leaving the chapter.
 * @param {any} entity
 * @param {{ aliases?: string[], links?: any[], description?: string, image?: any, canWrite?: boolean, chapter?: any, later?: any[], as?: string, others?: {id: number, name: string}[] }} [opts]
 */
function besideEntityFragment(entity, {
  aliases = [], links = [], description = '', image = null, canWrite = false, chapter = null, later = [], as = '', others = [],
} = {}) {
  // Half of what a bible is for is recognising somebody, and a face does
  // that faster than a line of summary. The crop the entry was given is
  // the crop that shows here too -- a portrait cropped to the middle of a
  // group photograph is worse than no portrait.
  const portrait = image
    ? `<img class="beside-portrait" src="/entity-images/${image.id}" alt="${escapeHtml(image.caption || entity.name)}"
            loading="lazy" style="object-position: ${focusPosition(image)}">`
    : '';
  const status = entity.status
    ? ` <span class="ent-badge status-${escapeHtml(entity.status)}">${escapeHtml(bible.STATUS_LABELS[entity.status])}${chapter ? ` in chapter ${chapter.chapter_number}` : ''}</span>`
    : '';
  const summary = canWrite
    ? inlineEdit(entity, 'summary', entity.summary ? escapeHtml(entity.summary) : '', { value: entity.summary || '', placeholder: 'Add the one line you would say about them', tag: 'p', cls: 'summary' })
    : (entity.summary ? `<p class="summary">${escapeHtml(entity.summary)}</p>` : '');
  const tools = canWrite ? `
    <div class="card-tools">
      ${later.length ? `<p class="hint">Later: ${later.map((c) => `${escapeHtml(bible.STATUS_LABELS[c.status] || c.status)} from chapter ${c.chapter_number}`).join(', ')}.</p>` : ''}
      ${chapter ? `
        <form method="post" action="/bible/${entity.id}/status" class="card-form" data-inline-form data-then="say">
          <input type="hidden" name="chapterId" value="${chapter.id}">
          <label class="sr-only" for="card-status-${entity.id}">Status from this chapter</label>
          <select name="status" id="card-status-${entity.id}">
            ${bible.STATUSES.filter(Boolean).map((s) => `<option value="${s}">${escapeHtml(bible.STATUS_LABELS[s])}</option>`).join('')}
          </select>
          <button class="btn ghost tiny" type="submit">from this chapter on</button>
        </form>
        <form method="post" action="/bible/${entity.id}/not-here" class="card-form" data-inline-form data-then="unlink" data-unlink="${entity.id}">
          <input type="hidden" name="chapterId" value="${chapter.id}">
          <button class="btn ghost tiny" type="submit">Not ${escapeHtml(entity.name)} in this chapter</button>
        </form>
        ${as ? `
        <form method="post" action="/bible/${entity.id}/not-as" class="card-form" data-inline-form data-then="unlink" data-unlink="${entity.id}" data-unlink-as="${escapeHtml(as)}">
          <input type="hidden" name="form" value="${escapeHtml(as)}">
          <button class="btn ghost tiny" type="submit">&ldquo;${escapeHtml(as)}&rdquo; is never ${escapeHtml(entity.name)}</button>
        </form>` : ''}` : ''}
      ${others.length ? `
        <details class="card-relation">
          <summary>Add a relation</summary>
          <form method="post" action="/bible/${entity.id}/links" class="card-form" data-inline-form data-then="relation">
            <label class="sr-only" for="card-rel-${entity.id}">Relation</label>
            <input type="text" name="label" id="card-rel-${entity.id}" placeholder="sister of, serves under..." maxlength="80">
            <label class="sr-only" for="card-to-${entity.id}">To</label>
            <select name="to" id="card-to-${entity.id}">${others.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}</select>
            <button class="btn ghost tiny" type="submit">Add</button>
          </form>
        </details>` : ''}
    </div>` : '';
  return `
    <div class="beside-head">
      ${portrait}
      <div class="beside-head-text">
        <h3>${escapeHtml(entity.name)}</h3>
        <p class="muted">${escapeHtml(entityKindLabel(entity.kind))}${aliases.length ? ` &middot; also ${aliases.map((a) => escapeHtml(a)).join(', ')}` : ''}${status}</p>
      </div>
    </div>
    ${summary}
    <ul class="relation-list" data-card-relations>${links.map((l) => `
      <li><span class="rel-label">${escapeHtml(l.label || 'related to')}</span> <a href="/bible/${l.other_id}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.other_name)}</a></li>`).join('')}</ul>
    ${tools}
    ${description ? `<div class="reading-pane beside-reading">${description}</div>` : '<p class="muted">No description yet.</p>'}`;
}


// The same thing inside the editor, where the text is not saved yet: the
// panel asks the server about the draft in the textarea, so there is one
// implementation of what counts as a name rather than a second one in
// JavaScript drifting away from the first.
function editorBiblePanel(chapter) {
  return `
    <aside class="editor-bible" id="editor-bible" data-story-id="${chapter.story_id}" aria-label="Add to the glossary">
      <h2 class="side-head">Glossary</h2>
      <p class="muted">Somebody new turned up mid-scene? Write them down here without leaving the chapter.</p>
      <form class="quick-entry" data-quick-entry>
        <input type="text" name="name" placeholder="Name" aria-label="Name" maxlength="${bible.MAX_NAME_LENGTH}" required>
        <select name="kind" aria-label="What it is">
          ${bible.KINDS.map((k) => `<option value="${k}">${escapeHtml(bible.KIND_LABELS[k])}</option>`).join('')}
        </select>
        <input type="text" name="summary" placeholder="One line (optional)" aria-label="One line about them (optional)" maxlength="240">
        <button class="btn ghost small" type="submit">Add to the glossary</button>
      </form>
      <p class="quick-result" data-quick-result hidden></p>
      <div class="editor-missing">
        <button class="btn ghost small" type="button" data-scan-names>Names in this draft</button>
        <div data-missing-list></div>
      </div>
      <p class="muted"><a href="/stories/${chapter.story_id}/bible" target="_blank" rel="noopener noreferrer">The whole glossary &rarr;</a></p>
    </aside>`;
}


// The cast of one chapter, shown on the chapter page. Reading a chapter
// six months after writing it, this is the line that saves you.
function chapterCastBlock(entities, storyId) {
  if (!entities.length) return '';
  return `
    <section class="chapter-cast">
      <h2 class="side-head">In this chapter</h2>
      <ul class="cast-line">
        ${entities.map((e) => `<li><a href="/bible/${e.id}">${escapeHtml(e.name)}</a>${
  e.first_chapter != null && e.first_chapter === e.this_chapter ? '<span class="ent-badge first-here">New here</span>' : ''
}${e.summary ? `<span class="cast-note">${escapeHtml(e.summary)}</span>` : ''}</li>`).join('')}
      </ul>
      <p class="muted"><a href="/stories/${storyId}/bible">The whole glossary &rarr;</a></p>
    </section>`;
}

// ---------- the analysis (bibisco's strongest screen, on data this app

module.exports = {
  inlineEdit,
  notNamesBlock,
  missingNameRow,
  KIND_ORDER,
  SORT_LABELS,
  appearanceSummary,
  besideChapterFragment,
  besideEntityFragment,
  besidePanel,
  bibleConflictNotice,
  bibleIndexPage,
  biblePrivacyBlock,
  bibleSortBar,
  chapterCastBlock,
  cropForm,
  editorBiblePanel,
  entityAppearanceList,
  entityBadges,
  entityFieldFieldset,
  entityFieldList,
  entityFormPage,
  entityImageBlock,
  entityKindLabel,
  entityMonogram,
  entityPage,
  entityRelationBlock,
  entityRow,
  fieldTemplateBlocks,
  fieldTemplatePage,
  focusPosition,
  missingNamesBlock,
};
