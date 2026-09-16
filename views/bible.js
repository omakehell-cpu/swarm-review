'use strict';

const { layout } = require('../lib/layout');
const { escapeHtml } = require('../lib/util');
const { parseMarkdown, renderHighlighted } = require('../lib/markdown');
const { ICONS, bible, bibleImages, emptyState, whenFields } = require('./shared');
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
  if (entity.appearances === 1) return `Chapter ${entity.first_chapter}`;
  return `Chapters ${entity.first_chapter}&ndash;${entity.last_chapter} &middot; ${entity.appearances} of them`;
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
        ${entity.alias_list ? `<p class="entry-categories">a.k.a. ${escapeHtml(entity.alias_list)}</p>` : ''}
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
    : 'Anyone who can read the story can read its bible.';
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
  conflicts = [], notice = '', covers = new Map(), sort = 'name', isOwner = false,
}) {
  const door = (k) => `
    <a class="glossary-door${k === kind ? ' current' : ''}" href="/stories/${story.id}/bible?kind=${k}">
      <span class="door-count">${counts[k] || 0}</span>
      <h2>${escapeHtml(bible.KIND_PLURALS[k])}</h2>
      <p class="muted">${escapeHtml(bible.KIND_BLURBS[k])}</p>
    </a>`;

  const list = entities.length
    ? `<div class="chapter-list" id="glossary-list">${entities.map((e) => entityRow(e, covers.get(e.id))).join('')}</div>
       <p class="no-matches" id="glossary-no-matches" hidden>Nothing here matches.</p>`
    : emptyState({
      art: 'sheets',
      title: total ? 'Nothing of that kind yet' : 'The bible is empty',
      body: total
        ? 'Every entry is filed under one kind. Nothing has been filed under this one yet.'
        : 'This is where the people, places and things of the story live -- who they are, who they know, and which chapters they turn up in. The chapters are worked out from the text itself, so an entry starts paying for itself the moment you write it down.',
      action: canWrite ? `<a class="btn" href="/stories/${story.id}/bible/new">${ICONS.plus}Add the first entry</a>` : '',
    });

  return layout({
    title: `Bible &middot; ${story.title}`,
    user,
    body: `
      <p class="breadcrumb"><a href="/stories/${story.id}">&larr; ${escapeHtml(story.title)}</a></p>
      <div class="page-head">
        <div>
          <h1>Story bible</h1>
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
      ${total ? `
        <div class="glossary-doors bible-doors">${KIND_ORDER.map(door).join('')}</div>
        <form method="get" action="/stories/${story.id}/bible" class="inline-form glossary-search">
          <input type="search" id="glossary-filter" name="q" placeholder="Filter by name, alias or summary..." autocomplete="off">
          ${kind ? `<input type="hidden" name="kind" value="${escapeHtml(kind)}">` : ''}
          <button class="btn ghost small" type="submit">Filter</button>
          ${kind ? `<a class="btn ghost small" href="/stories/${story.id}/bible">Everything</a>` : ''}
        </form>
        ${bibleSortBar(story, kind, sort)}
        <p class="muted"><span id="glossary-count">${entities.length} entr${entities.length === 1 ? 'y' : 'ies'}</span>${kind ? ` &middot; ${escapeHtml(bible.KIND_PLURALS[kind])}` : ''}.</p>` : ''}
      ${list}`,
  });
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
        <input type="text" name="label" placeholder="sister of, serves under, owns..." maxlength="80">
      </label>
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
      <p class="breadcrumb"><a href="/stories/${story.id}/bible">&larr; ${escapeHtml(story.title)} bible</a></p>
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

function entityPage({
  user, story, entity, aliases = [], links = [], appearances = [], chapters = [],
  others = [], images = [], fields = [], canWrite = false, error = '',
}) {
  return layout({
    title: entity.name,
    user,
    body: `
      <p class="breadcrumb"><a href="/stories/${story.id}/bible">&larr; ${escapeHtml(story.title)} bible</a></p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <div class="page-head entity-head">
        <div class="entity-head-main">
          ${images.length
    ? `<img class="entity-portrait" src="/entity-images/${images[0].id}" alt="${escapeHtml(images[0].caption || entity.name)}" style="object-position: ${focusPosition(images[0])}">`
    : ''}
          <div>
          <h1>${escapeHtml(entity.name)} ${entityBadges(entity)}</h1>
          <p class="muted">${escapeHtml(entityKindLabel(entity.kind))}${aliases.length ? ` &middot; also ${aliases.map((a) => escapeHtml(a)).join(', ')}` : ''}</p>
          ${entity.summary ? `<p class="summary">${escapeHtml(entity.summary)}</p>` : ''}
          </div>
        </div>
        <div class="page-head-actions">
          ${canWrite ? `<a class="btn ghost small" href="/bible/${entity.id}/edit">Edit</a>` : ''}
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
          ${entityImageBlock(entity, images, canWrite)}
        </div>
        <aside class="entity-side">
          ${entityFieldList(fields)}
          <section>
            <h2 class="side-head">Appears in</h2>
            ${entityAppearanceList(entity, appearances, chapters, canWrite)}
          </section>
          <section>
            <h2 class="side-head">Related</h2>
            ${entityRelationBlock(entity, links, others, canWrite)}
          </section>
        </aside>
      </div>
      ${canWrite ? `
        <form method="post" action="/bible/${entity.id}/delete" class="inline-form danger-form">
          <button class="btn ghost small danger" type="submit">Delete this entry</button>
        </form>` : ''}`,
  });
}

function entityFormPage({ user, story, entity = null, aliases = [], fields = [], templates = {}, usedLabels = [], whens = [], error = '' }) {
  const value = (field) => escapeHtml(entity ? entity[field] || '' : '');
  const selected = (field, option) => ((entity ? entity[field] : '') === option ? ' selected' : '');
  return layout({
    title: entity ? `Edit ${entity.name}` : 'New bible entry',
    user,
    body: `
      <p class="breadcrumb"><a href="${entity ? `/bible/${entity.id}` : `/stories/${story.id}/bible`}">&larr; Back</a></p>
      <div class="writer-card">
      <h1>${entity ? `Edit ${escapeHtml(entity.name)}` : 'New bible entry'}</h1>
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
          <label>Status
            <select name="status">
              ${bible.STATUSES.map((s2) => `<option value="${s2}"${selected('status', s2)}>${escapeHtml(bible.STATUS_LABELS[s2])}</option>`).join('')}
            </select>
          </label>
        </div>
        ${whenFields(entity ? entity.story_when : '', entity ? entity.story_day : null, { whens })}
        ${entityFieldFieldset({
    templates, fields, usedLabels,
    currentKind: (entity && entity.kind) || bible.DEFAULT_KIND,
  })}
        <label>Description
          <textarea name="description" rows="14" placeholder="Who they are, what they want, how they talk, what they look like. Markdown works here, and so do links to other chapters.">${value('description')}</textarea>
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
function missingNamesBlock(names, storyId, returnTo) {
  if (!names.length) return '';
  return `
    <section class="missing-names">
      <h2 class="side-head">${names.length} name${names.length === 1 ? '' : 's'} here ${names.length === 1 ? 'is' : 'are'} not in the bible</h2>
      <p class="muted">Proper names this chapter uses that no entry, glossary page or dictionary word accounts for. Guesswork, so some of it will be wrong -- take what is useful.</p>
      <ul class="missing-list">
        ${names.map((n) => `
          <li>
            <form method="post" action="/stories/${storyId}/bible/quick" class="inline-form">
              <input type="hidden" name="name" value="${escapeHtml(n.name)}">
              <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
              <span class="missing-name">${escapeHtml(n.name)}</span>
              <span class="missing-count">${n.count}&times;</span>
              <select name="kind" aria-label="What ${escapeHtml(n.name)} is">
                ${bible.KINDS.map((k) => `<option value="${k}">${escapeHtml(bible.KIND_LABELS[k])}</option>`).join('')}
              </select>
              <button class="btn ghost tiny" type="submit">Add</button>
            </form>
          </li>`).join('')}
      </ul>
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
function besidePanel({ chapter = null, story, chapters = [], entities = [] }) {
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
    <details class="beside" id="beside" data-beside>
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
          <p class="writer-section-label">The bible</p>
          ${entities.length > 8 ? '<input type="search" class="beside-filter" placeholder="Filter" data-beside-filter aria-label="Filter the bible">' : ''}
          <ul class="beside-picks" data-beside-list>
            ${entities.map((e) => pick(`/bible/${e.id}`, `/bible/${e.id}/beside`, e.name, e.summary || '')).join('')}
          </ul>` : `
          <p class="muted">Nothing in <a href="/stories/${story.id}/bible" target="_blank" rel="noopener noreferrer">the bible</a> yet.</p>`}
      </div>
    </details>
    <aside class="beside-pane" data-beside-pane hidden aria-live="polite">
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

function besideEntityFragment(entity, { aliases = [], links = [], description = '' }) {
  return `
    <h3>${escapeHtml(entity.name)}</h3>
    <p class="muted">${escapeHtml(entityKindLabel(entity.kind))}${aliases.length ? ` &middot; also ${aliases.map((a) => escapeHtml(a)).join(', ')}` : ''}</p>
    ${entity.summary ? `<p class="summary">${escapeHtml(entity.summary)}</p>` : ''}
    ${links.length ? `<ul class="relation-list">${links.map((l) => `
      <li><span class="rel-label">${escapeHtml(l.label || 'related to')}</span> <a href="/bible/${l.other_id}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.other_name)}</a></li>`).join('')}</ul>` : ''}
    ${description ? `<div class="reading-pane beside-reading">${description}</div>` : '<p class="muted">No description yet.</p>'}`;
}


// The same thing inside the editor, where the text is not saved yet: the
// panel asks the server about the draft in the textarea, so there is one
// implementation of what counts as a name rather than a second one in
// JavaScript drifting away from the first.
function editorBiblePanel(chapter) {
  return `
    <aside class="editor-bible" id="editor-bible" data-story-id="${chapter.story_id}">
      <h2 class="side-head">Bible</h2>
      <p class="muted">Somebody new turned up mid-scene? Write them down here without leaving the chapter.</p>
      <form class="quick-entry" data-quick-entry>
        <input type="text" name="name" placeholder="Name" maxlength="${bible.MAX_NAME_LENGTH}" required>
        <select name="kind">
          ${bible.KINDS.map((k) => `<option value="${k}">${escapeHtml(bible.KIND_LABELS[k])}</option>`).join('')}
        </select>
        <input type="text" name="summary" placeholder="One line (optional)" maxlength="240">
        <button class="btn ghost small" type="submit">Add to the bible</button>
      </form>
      <p class="quick-result" data-quick-result hidden></p>
      <div class="editor-missing">
        <button class="btn ghost small" type="button" data-scan-names>Names in this draft</button>
        <div data-missing-list></div>
      </div>
      <p class="muted"><a href="/stories/${chapter.story_id}/bible" target="_blank" rel="noopener noreferrer">The whole bible &rarr;</a></p>
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
      <p class="muted"><a href="/stories/${storyId}/bible">The whole bible &rarr;</a></p>
    </section>`;
}

// ---------- the analysis (bibisco's strongest screen, on data this app

module.exports = {
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
