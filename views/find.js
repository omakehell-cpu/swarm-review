'use strict';

// /find: the advanced search, on a page of its own. Every way of
// narrowing the list at once -- words in the title, blurb or tags; the
// author; words anywhere in the chapters; how long; a series; the state;
// tags; only the stories you follow -- then the stories that match, as
// covers or a list, the way you like them everywhere else.

const { layout } = require('../lib/layout');
const { escapeHtml } = require('../lib/util');
const { LENGTHS, SHELVES } = require('../lib/story-shelves');
const front = require('./front');
const { storyResults } = require('./stories');

function findForm(state, allGroups) {
  const active = new Set((state.activeTags || []).map((t) => t.slug));
  return `
    <form method="get" action="/find#results" class="find-form" role="search" aria-label="Advanced search">
      <div class="adv-grid">
        <label class="adv-field adv-wide">Title, blurb or tag
          <input type="search" name="q" value="${escapeHtml(state.q)}" autocomplete="off" id="find-q">
        </label>
        <label class="adv-field">Author
          <input type="search" name="author" value="${escapeHtml(state.author || '')}" list="find-authors" autocomplete="off">
          <datalist id="find-authors">${(state.authors || []).map((a) => `<option value="${escapeHtml(a)}"></option>`).join('')}</datalist>
        </label>
        <label class="adv-field">Words in the text
          <input type="search" name="text" value="${escapeHtml(state.text || '')}" autocomplete="off" aria-describedby="find-text-hint">
          <span class="hint" id="find-text-hint">Anywhere in the chapters. Put a phrase in "quotes".</span>
        </label>
        <label class="adv-field">Where it stands
          <select name="shelf">
            ${['all', 'writing', 'complete', 'dropped'].map((k) => `<option value="${k === 'all' ? '' : k}"${state.shelf === k ? ' selected' : ''}>${k === 'all' ? 'Any' : escapeHtml(SHELVES[k].label)}</option>`).join('')}
          </select>
        </label>
        <label class="adv-field">Length
          <select name="length">
            <option value="">Any length</option>
            ${Object.entries(LENGTHS).map(([k, v]) => `<option value="${k}"${state.length === k ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}
          </select>
        </label>
        ${state.seriesList.length ? `
          <label class="adv-field">Series
            <select name="series">
              <option value="">Any series</option>
              ${state.seriesList.map((x) => `<option value="${escapeHtml(x.name)}"${x.name === state.series ? ' selected' : ''}>${escapeHtml(x.name)} (${x.n})</option>`).join('')}
            </select>
          </label>` : ''}
        <label class="adv-field">Order
          <select name="sort">
            <option value="">Latest first</option>
            <option value="title"${state.sort === 'title' ? ' selected' : ''}>A to Z</option>
            <option value="mine"${state.sort === 'mine' ? ' selected' : ''}>Only stories I write in</option>
          </select>
        </label>
        <label class="adv-check adv-wide"><input type="checkbox" name="following" value="1"${state.following ? ' checked' : ''}> Only stories I follow</label>
      </div>
      ${allGroups.length ? `
        <details class="adv-tags"${active.size ? ' open' : ''}>
          <summary>Tags${active.size ? ` (${active.size} chosen)` : ''}</summary>
          ${allGroups.map((g) => `
            <fieldset class="tag-group">
              <legend>${escapeHtml(g.group)}</legend>
              <div class="tag-group-options">${g.tags.map((t) => `
                <label class="tag-pick${active.has(t.slug) ? ' checked' : ''}">
                  <input type="checkbox" name="tag" value="${escapeHtml(t.slug)}"${active.has(t.slug) ? ' checked' : ''}>
                  <span>${escapeHtml(t.name)}</span>
                </label>`).join('')}</div>
            </fieldset>`).join('')}
          <p class="hint">A story has to carry every tag you pick.</p>
        </details>` : ''}
      <div class="find-actions">
        <button class="btn" type="submit">Search</button>
        <a class="btn ghost" href="/find">Start again</a>
      </div>
    </form>`;
}

function findPage({ user, asked = false, stories, list, tagsByStory, coauthorsByStory = new Map(), activeTags = [], allGroups = [], sort = '' }) {
  const state = { ...list, sort, activeTags, base: '/find' };
  const tagsFor = (s) => (tagsByStory && tagsByStory.get(s.id)) || [];
  const coauthorsFor = (s) => coauthorsByStory.get(s.id) || [];
  return layout({
    title: 'Advanced search',
    user,
    current: 'stories',
    body: `
      <p class="breadcrumb"><a href="/">&larr; Stories</a></p>
      <div class="page-head"><div>
        <h1>Advanced search</h1>
        <p class="muted">Every way of narrowing the stories at once. For chapters, notes and the glossary as well, use the search in the bar at the top.</p>
      </div></div>
      ${findForm(state, allGroups)}
      <section class="find-results" id="results" aria-labelledby="shelf-heading" tabindex="-1">
        ${asked ? `
          ${front.activeChips(state)}
          <div class="library-controls find-controls">
            <span></span>
            <div class="library-view">${front.viewControls(state)}</div>
          </div>
          ${storyResults(stories, state, { tagsFor, coauthorsFor, totalStories: 1, level: 2 })}`
    : '<p class="find-hint muted">Fill in as much or as little as you like, and press Search.</p>'}
      </section>`,
  });
}

module.exports = { findPage };
