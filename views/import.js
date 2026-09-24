'use strict';

const { layout } = require('../lib/layout');
const { escapeHtml } = require('../lib/util');
const { wordCount } = require('./shared');

// Importing a StoriesOnline story: the upload form, and the page that
// shows what was read before anything is written (routes/import.js).

function importedAuthorsList(authors) {
  if (!authors.length) return '';
  return `
    <section class="import-authors">
      <h2 class="side-head">Imported authors</h2>
      <ul class="plain-list">
        ${authors.map((a) => `
          <li>
            <a href="/users/${encodeURIComponent(a.username)}">${escapeHtml(a.display_name)}</a>
            <span class="muted">${a.story_count} stor${a.story_count === 1 ? 'y' : 'ies'}${a.claimed_by ? ` &middot; claimed by ${escapeHtml(a.claimed_by_name || '')}` : ' &middot; not claimed'}</span>
          </li>`).join('')}
      </ul>
    </section>`;
}

function importPage({ user, authors = [], error = '' }) {
  return layout({
    title: 'Import a story',
    user,
    current: 'admin',
    body: `
      <p class="breadcrumb"><a href="/admin">&larr; Admin</a></p>
      <h1>Import a story</h1>
      <p class="muted import-lede">An EPUB downloaded from StoriesOnline. The chapters are found and cut apart, and you see all of it before anything is saved. The story goes to an <strong>imported author</strong>: a name, not an account, until the writer signs up here and claims it.</p>
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
      <form method="post" action="/admin/import" enctype="multipart/form-data" class="import-form">
        <label>EPUB file<input type="file" name="epub" accept=".epub,application/epub+zip" required></label>
        <button class="btn" type="submit">Read it</button>
      </form>
      ${importedAuthorsList(authors)}`,
  });
}

// One row per tag the book has and the vocabulary does not: add it (in a
// group), use the near spelling the site already has, or leave it off.
function missingTagRows(suggestions, groups) {
  if (!suggestions.length) return '';
  return `
    <fieldset class="import-tags">
      <legend>Not in the vocabulary yet</legend>
      <p class="hint">Suggested for adding: each one you add becomes a tag anybody can use, in the group you pick. Where the site already has a tag spelled nearly the same, that one is offered instead.</p>
      <ul>
        ${suggestions.map((s, i) => {
    const options = [
      s.similar ? `<option value="use" selected>Use ${escapeHtml(s.similar.name)}</option>` : '',
      `<option value="add"${s.similar ? '' : ' selected'}>${s.proposed ? 'Approve the proposed tag' : 'Add it'}</option>`,
      '<option value="skip">Leave it off</option>',
    ].join('');
    const allGroups = groups.includes(s.group) ? groups : [...groups, s.group];
    return `
          <li>
            <span class="import-tag-name">${escapeHtml(s.name)}</span>
            <label class="sr-only" for="tag${i}">What to do with ${escapeHtml(s.name)}</label>
            <select id="tag${i}" name="tag${i}">${options}</select>
            <label class="sr-only" for="group${i}">Group for ${escapeHtml(s.name)}</label>
            <select id="group${i}" name="group${i}">
              ${allGroups.map((g) => `<option${g === s.group ? ' selected' : ''}>${escapeHtml(g)}</option>`).join('')}
            </select>
          </li>`;
  }).join('')}
      </ul>
    </fieldset>`;
}

function importPreviewPage({ user, key, filename, parsed, author, duplicate, tags, groups = [] }) {
  const firstLine = (md) => {
    const para = String(md).split('\n\n').find((p) => p.trim() && p.trim() !== '---') || '';
    const t = para.replace(/[*_>#]/g, '').trim();
    return t.length > 140 ? `${t.slice(0, 139)}…` : t;
  };
  return layout({
    title: `Import: ${parsed.title}`,
    user,
    current: 'admin',
    body: `
      <p class="breadcrumb"><a href="/admin/import">&larr; Import a story</a></p>
      <h1>${escapeHtml(parsed.title)}</h1>
      <p class="muted">Read from ${escapeHtml(filename || 'the file')}. Nothing is saved until you press Import.</p>
      ${duplicate ? `<p class="error" role="alert">This story is already here: <a href="/stories/${duplicate.id}">${escapeHtml(duplicate.title)}</a>. Importing again would make a second copy, so it is not offered.</p>` : ''}

      <form method="post" action="/admin/import/${key}" class="import-preview">
        <dl class="import-facts">
          <dt>Title</dt><dd><input type="text" name="title" value="${escapeHtml(parsed.title)}" maxlength="200" required></dd>
          <dt>Author</dt><dd>${escapeHtml(parsed.author)} <span class="muted">${author
    ? `&middot; already here as an imported author${author.claimed_by ? ' (claimed; the story will go to the imported author, and can be moved after)' : ''}`
    : '&middot; new: an imported author will be made'}</span></dd>
          ${parsed.series ? `<dt>Series</dt><dd>${escapeHtml(parsed.series)}</dd>` : ''}
          <dt>Published</dt><dd>${escapeHtml(parsed.published || 'unknown')}${parsed.updated ? `, updated ${escapeHtml(parsed.updated)}` : ''} &middot; ${parsed.status === 'complete' ? 'complete' : 'ongoing'}</dd>
          ${parsed.storyUrl ? `<dt>On StoriesOnline</dt><dd><a href="${escapeHtml(parsed.storyUrl)}" rel="noopener noreferrer" target="_blank">${escapeHtml(parsed.storyUrl)}</a></dd>` : ''}
          <dt>Cover</dt><dd>${parsed.cover ? 'yes' : 'none'}</dd>
          <dt>Tags</dt><dd>${tags.matched.length ? tags.matched.map((t) => `<span class="tag-chip">${escapeHtml(t.name)}</span>`).join(' ') : '<span class="muted">none of them are in the vocabulary yet</span>'}</dd>
          ${parsed.description ? `<dt>Description</dt><dd>${escapeHtml(parsed.description)}</dd>` : ''}
        </dl>
        ${duplicate ? '' : missingTagRows(tags.suggestions || [], groups)}

        <h2 class="side-head">${parsed.chapters.length} chapter${parsed.chapters.length === 1 ? '' : 's'} &middot; ${wordCount(parsed.words)}</h2>
        <ol class="import-chapters">
          ${parsed.chapters.map((c, i) => `
            <li>
              <label class="sr-only" for="title${i}">Title of chapter ${i + 1}</label>
              <input type="text" id="title${i}" name="title${i}" value="${escapeHtml(c.title)}" maxlength="200">
              <span class="muted">${wordCount(c.words)}</span>
              <p class="import-first">${escapeHtml(firstLine(c.markdown))}</p>
            </li>`).join('')}
        </ol>
        <div class="row">
          ${duplicate ? '' : '<button class="btn" type="submit">Import</button>'}
          <a class="btn ghost" href="/admin/import">Start again</a>
        </div>
      </form>`,
  });
}

module.exports = { importPage, importPreviewPage };
