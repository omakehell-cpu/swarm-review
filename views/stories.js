'use strict';

const { layout } = require('../lib/layout');
const { escapeHtml } = require('../lib/util');
const { timeHtml } = require('../lib/time');
const { storyState, STORY_STATES, CHOOSABLE_STORY_STATES } = require('../lib/story-state');
const { ICONS, bylineWith, emptyState, storyCoverImg, storyStateBadge, tagChips, tagPicker, wordCount } = require('./shared');
const { ACCEPT_ATTRIBUTE } = require('../lib/entity-images');
const { SHELVES, SHELF_ORDER } = require('../lib/story-shelves');
const front = require('./front');
const { listHref } = front;

// One story as it appears in any list -- the front page, a tag's page, a
// search result. `hiddenBy` is the reader's own hidden tags that this
// story tripped (see handleStories); it only ever arrives set from a list
// that has already decided to fold the story away.
// How far along, in a hairline: only when the author has set a goal.
// A word goal, when the author has set one: a short bar with its number
// beside it, so the line is never a stray rule with no meaning.
function storyProgress(s) {
  if (!s.word_goal || s.word_goal <= 0) return '';
  const percent = Math.round(Math.max(0, Math.min(1, (s.word_count || 0) / s.word_goal)) * 100);
  // Words against the goal, said in words: "0%" read as a broken bar.
  return `<span class="story-progress-wrap"><span class="story-progress" aria-hidden="true"><span class="story-progress-fill" style="width: ${percent}%"></span></span>${(s.word_count || 0).toLocaleString('en-GB')} of ${wordCount(s.word_goal)}</span>`;
}

// Whether anybody is reading, in words, on one quiet line with the goal.
function storyAudience(s) {
  const bits = [];
  const goal = storyProgress(s);
  if (goal) bits.push(goal);
  if (s.reader_count) bits.push(`<span>read by ${s.reader_count} ${s.reader_count === 1 ? 'person' : 'people'}</span>`);
  if (s.note_count) bits.push(`<span>${s.note_count} note${s.note_count === 1 ? '' : 's'}</span>`);
  return bits.length ? `<p class="story-audience">${bits.join('')}</p>` : '';
}

function storyRow(s, { tags = [], sinceQs = '', hiddenBy = [], coauthors = [] } = {}) {
  // Not an <a> wrapping the whole row, which is what every other list
  // here does: the tag chips are links themselves, and an anchor inside
  // an anchor is invalid -- the parser closes the outer one early and the
  // row falls apart. The title carries the link and stretches an overlay
  // across the row instead (see .story-row in style.css), so the row is
  // still clickable everywhere the chips aren't.
  return `
    <div class="chapter-row story-row" data-find="${escapeHtml(`${s.title} ${s.author_name || ''} ${s.description || ''}`.toLowerCase())}">
      ${storyCoverImg(s)}
      <div class="chapter-row-main">
        <h3><a class="row-link" href="/stories/${s.id}${sinceQs}">${escapeHtml(s.title)}</a> ${s.has_new_chapters ? '<span class="badge new">New</span>' : ''}</h3>
        <p class="story-facts">
          <span>${bylineWith(s.author_name, coauthors)}</span>
          ${s.series ? `<span class="story-series">${escapeHtml(s.series)}</span>` : ''}
          <span>${s.chapter_count} chapter${s.chapter_count === 1 ? '' : 's'}${s.word_count ? ` &middot; ${wordCount(s.word_count)}` : ''}</span>
          ${timeHtml(s.last_chapter_at || s.created_at)}
          ${storyState(s) === 'ongoing' ? '' : storyStateBadge(s)}
          ${s.pending_comments > 0 ? `<span class="badge pending">${s.pending_comments} waiting</span>` : ''}
        </p>
        ${s.description ? `<p class="story-blurb">${escapeHtml(s.description)}</p>` : ''}
        ${storyAudience(s)}
        ${hiddenBy.length
          ? `<p class="hidden-by">Hidden by your tag settings: ${hiddenBy.map((t) => escapeHtml(t.name)).join(', ')}</p>`
          : tagChips(tags)}
      </div>
    </div>
  `;
}


// A short quote of a comment, enough to recognise which one it is without
// reproducing the whole thing where it can't be replied to.
function commentGist(body, max = 120) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  return escapeHtml(text.length > max ? `${text.slice(0, max - 1).trimEnd()}\u2026` : text);
}


// What's waiting for this reader, above the list of everything. Renders
// nothing at all when there is nothing -- an empty "you're all caught up"
// box every single day is furniture, not information.
function inboxSection(inbox) {
  if (!inbox) return '';

  const pending = inbox.pending.length ? `
    <section class="inbox-group">
      <h2>Waiting on you</h2>
      <ul class="inbox-list">
        ${inbox.pending.map((row) => `
          <li>
            <a href="/chapters/${row.chapter_id}">
              <span class="inbox-count">${row.pending}</span>
              <span class="inbox-what">note${row.pending === 1 ? '' : 's'} to answer</span>
              <span class="inbox-where">${escapeHtml(row.story_title)} &middot; chapter ${row.chapter_number}: ${escapeHtml(row.chapter_title)}</span>
            </a>
          </li>`).join('')}
      </ul>
    </section>` : '';

  const replies = inbox.replies.length ? `
    <section class="inbox-group">
      <h2>${inbox.replies.some((r) => r.mention) ? 'Replies and mentions' : 'Replies to you'}</h2>
      <ul class="inbox-list">
        ${inbox.replies.map((r) => `
          <li>
            <a href="/chapters/${r.chapter_id}#comment-${r.id}">
              <span class="inbox-what"><strong>${escapeHtml(r.author_name)}</strong> ${r.mention ? '<span class="muted">mentioned you:</span> ' : ''}${commentGist(r.body)}</span>
              <span class="inbox-where">${escapeHtml(r.story_title)} &middot; chapter ${r.chapter_number}: ${escapeHtml(r.chapter_title)}</span>
            </a>
          </li>`).join('')}
      </ul>
    </section>` : '';

  const asked = inbox.asked && inbox.asked.length ? `
    <section class="inbox-group inbox-asked">
      <h2>Asked to read by you</h2>
      <ul class="inbox-list">
        ${inbox.asked.map((r) => `
          <li>
            <a href="/chapters/${r.chapter_id}">
              <span class="inbox-what"><strong>${escapeHtml(r.requested_by_name || 'Somebody')}</strong> asked: chapter ${r.chapter_number}, ${escapeHtml(r.chapter_title)}</span>
              ${r.question ? `<span class="inbox-question">&ldquo;${commentGist(r.question, 160)}&rdquo;</span>` : ''}
              <span class="inbox-where">${escapeHtml(r.story_title)}${r.word_count ? ` &middot; ${wordCount(r.word_count)}` : ''} &middot; ${timeHtml(r.created_at)}</span>
            </a>
          </li>`).join('')}
      </ul>
    </section>` : '';

  return `${asked}${pending}${replies}`;
}

// The welcome card: three steps, each ticked off by doing it rather than
// by pressing anything. See welcomeState in models/activity.js.
function welcomeCard(welcome) {
  if (!welcome || !welcome.show) return '';
  const t = welcome.tryThis;
  const step = (done, title, body) => `
    <li class="welcome-step${done ? ' done' : ''}">
      <span class="welcome-mark" aria-hidden="true">${done ? ICONS.tick : ''}</span>
      <span><strong>${title}</strong>${done ? '<span class="sr-only"> (done)</span>' : ''}<br><span class="muted">${body}</span></span>
    </li>`;
  return `
    <section class="welcome" aria-labelledby="welcome-title">
      <div class="welcome-head">
        <h2 id="welcome-title">Welcome to the group</h2>
        <form method="post" action="/welcome/dismiss" class="inline-form">
          <button class="btn ghost tiny" type="submit">I know my way round</button>
        </form>
      </div>
      <p class="welcome-lede">This is where we read each other's chapters and say what we think, line by line. Three things and you are in:</p>
      <ol class="welcome-steps">
        ${step(welcome.read, 'Read a chapter',
          t ? `Start with <a href="/chapters/${t.id}">${escapeHtml(t.title)}</a> by ${escapeHtml(t.author_name)}, from ${escapeHtml(t.story_title)}.` : 'Any chapter on this page that is not yours.')}
        ${step(welcome.noted, 'Leave a note on a line',
          'Select a few words in a chapter and a button appears &mdash; or press <kbd>C</kbd>. Say what you think, suggest a rewrite, or just leave a &hearts;.')}
        ${step(welcome.wrote, 'Put up something of your own',
          '<a href="/stories/new">Start a story</a> with its first chapter, then ask somebody to read it from the chapter page.')}
      </ol>
    </section>`;
}

// What everybody has been doing lately, most recent first. Sentences,
// because that is what it is: "Luis read Seals and signatures".
function activityItem(a) {
  const what = a.subject ? (a.href ? `<a href="${escapeHtml(a.href)}">${escapeHtml(a.subject)}</a>` : escapeHtml(a.subject)) : '';
  return `
    <li class="activity-item kind-${escapeHtml(a.kind)}">
      <span class="activity-who">${escapeHtml(a.display_name)}</span>
      ${escapeHtml(a.verb)} ${what}${a.times > 1 ? ` <span class="activity-times">&times;${a.times}</span>` : ''}
      ${timeHtml(a.created_at)}
    </li>`;
}

// On the front page, only the last three, in a quiet strip below the
// stories: enough to feel that other people are here, and out of the way
// of what you came for. The rest is one link away.
function activityStrip(activity) {
  if (!activity || !activity.length) return '';
  return `
    <section class="activity-strip" aria-labelledby="activity-title">
      <h2 id="activity-title">Lately</h2>
      <ol class="activity-list">${activity.slice(0, 3).map(activityItem).join('')}</ol>
      <a class="activity-more" href="/activity">All activity &rarr;</a>
    </section>`;
}

function activityPage({ user, activity }) {
  return layout({
    title: 'Activity',
    user,
    body: `
      <p class="breadcrumb"><a href="/">&larr; Stories</a></p>
      <div class="page-head"><h1>Lately in the group</h1></div>
      <p class="muted">What people have been reading, writing and saying, newest first. Several notes on one chapter on the same day count once.</p>
      ${activity.length
        ? `<ol class="activity-list activity-full">${activity.map(activityItem).join('')}</ol>`
        : emptyState({ art: 'sheets', title: 'Nothing yet', body: 'When somebody reads, writes or leaves a note, it shows up here.' })}`,
  });
}

// What changed on the site since this reader last looked. Shown once: the
// route marks it seen as it hands it over, and after that it lives under
// What's new in the menu.
function whatsNewCard(whatsNew) {
  if (!whatsNew || !whatsNew.releases.length) return '';
  const items = whatsNew.releases.map((r) => `
      <li>
        <a href="/help/changelog#${escapeHtml(r.anchor)}">${escapeHtml(r.heading || r.date)}</a>
        ${r.highlights.length ? `<span class="whats-new-points">${r.highlights.map(escapeHtml).join(' &middot; ')}</span>` : ''}
      </li>`).join('');
  return `
    <section class="whats-new-card" aria-labelledby="whats-new-title">
      <h2 id="whats-new-title">New on the site since you were last here</h2>
      <ul class="whats-new-list">${items}</ul>
      <p class="whats-new-foot">
        <a href="/help/changelog">${whatsNew.more ? `All of it, and ${whatsNew.more} more change${whatsNew.more === 1 ? '' : 's'}` : 'Read all about it'} &rarr;</a>
        <span class="muted">This note shows once. It all stays under Help, in What's new.</span>
      </p>
    </section>`;
}

// ---------- the list: where from, shelves, search, and pages ----------
// (the controls themselves are in views/front.js)

// Nothing on this shelf: say which shelves the same search did find
// something on, rather than an empty page that looks like the end.
function emptyShelf(state) {
  const elsewhere = SHELF_ORDER.filter((k) => k !== 'all' && k !== state.shelf && state.counts[k]);
  const pointers = elsewhere.map((k) => `<a href="${listHref(state, { shelf: k === state.defaultShelf ? '' : k })}">${state.counts[k]} ${escapeHtml(SHELVES[k].label.toLowerCase())}</a>`);
  // Plain text: emptyState escapes its title.
  const what = state.q
    ? `Nothing ${state.shelf === 'all' ? '' : `${SHELVES[state.shelf].label.toLowerCase()} `}matches “${state.q}”`
    : `Nothing ${SHELVES[state.shelf].label.toLowerCase()} here${state.series || state.origin ? ' with that filter' : ' yet'}`;
  return emptyState({
    art: 'sheets',
    title: `${what}.`,
    body: pointers.length ? `On the other shelves: ${pointers.join(', ')}.` : (state.q ? 'Try fewer words, or part of a name.' : ''),
    action: state.q || state.series || state.origin ? `<a class="btn ghost small" href="${listHref(state, { q: '', series: '', origin: '' })}">Clear the search</a>` : '',
  });
}

/**
 * @param {any} props `list` is what lib/story-shelves.js made of the
 *   stories, plus the order and the view; `stories` is the page of it.
 */
function storiesPage({ user, stories, folded = [], since, tagsByStory, coauthorsByStory = new Map(), activeTags = [], inbox = null, activity = [], welcome = null, whatsNew = null, sort = '', totalStories = 0, list = null, forYou = null }) {
  const state = list || {
    shelf: 'all', defaultShelf: 'all', q: '', series: '', counts: { writing: 0, complete: 0, dropped: 0, all: stories.length },
    total: stories.length, page: 1, pages: 1, seriesList: [], view: '',
  };
  const listState = { ...state, sort, activeTags, base: '/' };
  const sinceQs = since ? `?since=${encodeURIComponent(since)}` : '';
  const tagsFor = (s) => (tagsByStory && tagsByStory.get(s.id)) || [];
  const coauthorsFor = (s) => coauthorsByStory.get(s.id) || [];

  // Stories folded away by this reader's own hidden tags (see /account) --
  // out of the way, but never silently gone.
  const foldedBlock = folded.length ? `
    <details class="folded-stories">
      <summary>${folded.length} stor${folded.length === 1 ? 'y' : 'ies'} hidden by your tag settings</summary>
      <div class="chapter-list">${folded.map((s) => storyRow(s, { tags: tagsFor(s), sinceQs, hiddenBy: s.hiddenBy, coauthors: coauthorsFor(s) })).join('')}</div>
    </details>` : '';

  // Write and review, side by side, before anything else: this is a
  // writers' group, and the page is weighted the way it works.
  const narrowed = Boolean(state.q || activeTags.length || state.series || state.author || state.text || state.length || state.following || sort === 'mine');
  const top = forYou && !narrowed && state.page === 1 ? `
    <div class="bands">
      ${front.deskColumn(forYou.desk, { hasStories: forYou.hasStories })}
      ${front.reviewColumn({ inbox, following: forYou.following, newByStory: forYou.newByStory })}
    </div>` : '';
  const aside = forYou && !narrowed && state.page === 1 ? [front.followingList(forYou.following), front.recentlyList(forYou.recentlyRead)].join('').trim() : '';

  return layout({
    title: 'Stories',
    user,
    current: 'stories',
    body: `
      <a class="skip-link" href="#library">Skip to the stories</a>
      <div class="page-head front-head">
        <h1>Stories</h1>
      </div>
      ${activeTags.length ? '' : whatsNewCard(whatsNew)}
      ${activeTags.length ? '' : welcomeCard(welcome)}
      ${top}
      <section class="band band-read story-shelves library shelf-${escapeHtml(state.shelf)}" id="library" aria-labelledby="read-title" tabindex="-1">
        <h2 id="read-title" class="band-title">Read</h2>
        ${aside ? `<div class="read-asides">${aside}</div>` : ''}
        ${totalStories ? front.listControls(listState) : ''}
        ${front.activeChips(listState)}
        ${storyResults(stories, listState, { sinceQs, tagsFor, coauthorsFor, totalStories })}
      </section>
      ${foldedBlock}
      ${activeTags.length ? '' : activityStrip(activity)}
      <p class="muted archive-link"><a href="/archived-stories">View archived stories &rarr;</a></p>`,
  });
}

// The list itself, with its heading and pages: covers or one line each,
// or -- when there is nothing -- where else there is something.
function storyResults(stories, listState, { sinceQs = '', tagsFor, coauthorsFor, totalStories = 0, level = 3 }) {
  const state = listState;
  const searching = state.q || state.author || state.text || state.length || state.following;
  const heading = searching ? `${SHELVES[state.shelf].label}, matching your search`
    : (state.activeTags.length ? `${SHELVES[state.shelf].label}, with those tags`
      : (state.sort === 'mine' ? `${SHELVES[state.shelf].label}, that you write in` : SHELVES[state.shelf].label));
  const rows = stories.length
    // A row of the catalogue for each story, or -- for comparing a shelf of
    // hundreds -- one line of a table.
    ? (state.view === 'table'
      ? front.storyTable(stories, { coauthorsFor, sinceQs })
      : `<ul class="story-wides">${stories.map((s) => front.storyWide(s, { tags: tagsFor(s), sinceQs, coauthors: coauthorsFor(s) })).join('')}</ul>`)
    : totalStories && !state.activeTags.length ? emptyShelf(state) : (state.activeTags.length
      ? emptyState({
        art: 'label',
        title: 'Nothing carries every tag you picked',
        body: `A story has to have <em>all</em> of them, not any. Try taking one off: ${state.activeTags.map((t) => escapeHtml(t.name)).join(', ')}.`,
        action: `<a class="btn ghost small" href="${listHref(state, { tags: [] })}">Clear the filter</a>`,
      })
      : emptyState({
        art: 'sheets',
        title: 'No stories yet',
        body: 'A story is a set of chapters with one author and, if they want, coauthors. You write the first chapter as you create it.',
        action: '<a class="btn" href="/stories/new">Start the first one</a>',
      }));
  return `
    <h${level} class="list-label" id="shelf-heading">${escapeHtml(heading)}${state.series ? ` &middot; ${escapeHtml(state.series)}` : ''} <span class="list-count" id="story-count" aria-live="polite">${state.total}</span></h${level}>
    ${rows}
    ${state.base === '/' ? front.seeAll({ ...state, stories }) : front.pager(state)}`;
}

// ---------- story tags ----------

function tagsIndexPage({ user, groups }) {
  const total = groups.reduce((n, g) => n + g.tags.length, 0);
  const chip = (t) => `
    <a class="tag-chip${t.story_count ? '' : ' unused'}" href="/tags/${encodeURIComponent(t.slug)}"${
      t.description ? ` title="${escapeHtml(t.description)}"` : ''}>
      ${escapeHtml(t.name)}<span class="tag-count">${t.story_count}</span>
    </a>`;

  // Most of the vocabulary is unused most of the time -- a starting list
  // of sixty-odd against an archive of a handful of stories. Showing all
  // of it at once made the page read as a catalogue of nothing: rows and
  // rows of "0". What somebody wants first is the tags that would
  // actually take them somewhere.
  const used = groups.map((g) => ({ ...g, tags: g.tags.filter((t) => t.story_count > 0) }))
    .filter((g) => g.tags.length);
  const unusedCount = total - used.reduce((n, g) => n + g.tags.length, 0);

  const section = (g) => `
    <section class="tag-index-group">
      <h2>${escapeHtml(g.group)}</h2>
      <div class="tag-chips">${g.tags.map(chip).join('')}</div>
    </section>`;

  let body;
  if (!groups.length) {
    body = emptyState({
      art: 'label',
      title: 'No tags have been set up',
      body: 'Tags are the vocabulary the whole group shares. An admin adds them from the admin page.',
      action: user.is_admin ? '<a class="btn ghost small" href="/admin#tags">Set them up</a>' : '',
    });
  } else if (!used.length) {
    body = emptyState({
      art: 'label',
      title: 'Nothing is tagged yet',
      body: `The vocabulary is there \u2014 ${total} tag${total === 1 ? '' : 's'} \u2014 but no story carries one. They go on a story from its own page, under &ldquo;Edit details&rdquo;.`,
    }) + `
      <details class="tag-vocabulary">
        <summary>See the whole vocabulary</summary>
        ${groups.map(section).join('')}
      </details>`;
  } else {
    body = `
      ${used.map(section).join('')}
      ${unusedCount ? `
        <details class="tag-vocabulary">
          <summary>${unusedCount} more tag${unusedCount === 1 ? '' : 's'} nothing is using yet</summary>
          ${groups.map((g) => ({ ...g, tags: g.tags.filter((t) => !t.story_count) }))
            .filter((g) => g.tags.length).map(section).join('')}
        </details>` : ''}`;
  }

  return layout({
    title: 'Tags',
    user,
    current: 'tags',
    body: `
      <div class="page-head"><h1>Tags</h1></div>
      <p class="muted">${total} tag${total === 1 ? '' : 's'} in the group's shared vocabulary. The number on each is how many stories carry it.</p>
      ${body}`,
  });
}

function tagPage({ user, tag, stories, tagsByStory }) {
  const rows = stories.length
    ? stories.map((s) => storyRow(s, { tags: tagsByStory.get(s.id) || [] })).join('')
    : emptyState({
      art: 'label',
      title: 'No stories carry this tag yet',
      body: 'Tags go on a story from its own page, under &ldquo;Edit details&rdquo;.',
    });
  return layout({
    title: tag.name,
    user,
    current: 'tags',
    body: `
      <p class="breadcrumb"><a href="/tags">&larr; All tags</a></p>
      <div class="page-head"><h1>${escapeHtml(tag.name)}</h1></div>
      <p class="muted">${tag.description ? `${escapeHtml(tag.description)} ` : ''}${escapeHtml(tag.tag_group)} tag &middot; ${stories.length} stor${stories.length === 1 ? 'y' : 'ies'}.</p>
      <div class="chapter-list">${rows}</div>`,
  });
}

function tagNotFoundPage({ user, slug }) {
  return layout({
    title: 'Tag not found',
    user,
    current: 'tags',
    body: `
      <p class="breadcrumb"><a href="/tags">&larr; All tags</a></p>
      <h1>No such tag</h1>
      <p class="muted">Nothing here is tagged "${escapeHtml(slug)}" -- it may have been renamed or removed since that link was made.</p>`,
  });
}


// The cover, on the details page but in forms of its own: a file upload
// is multipart and the details form is not, and forms cannot nest. The
// crop works the way a bible picture's does -- click the picture where the
// thumbnail should centre, or type the two numbers (public/js/image-focus.js).
function coverSection(story, coverError) {
  const has = Boolean(story.cover_filename);
  const x = Number(story.cover_focus_x ?? 50);
  const y = Number(story.cover_focus_y ?? 50);
  const key = `cover-${story.id}`;
  return `
    <section class="writer-section cover-section" id="cover">
      <p class="writer-section-label">Cover</p>
      ${coverError ? `<p class="error">${escapeHtml(coverError)}</p>` : ''}
      ${has ? `
        <div class="cover-editor">
          <a class="figure-shot cover-full" href="/stories/${story.id}/cover?v=${encodeURIComponent(story.cover_filename)}" target="_blank" rel="noopener noreferrer" data-focus-picker="${key}">
            <img src="/stories/${story.id}/cover?v=${encodeURIComponent(story.cover_filename)}" alt="The current cover">
            <span class="focus-pin" style="left: ${x}%; top: ${y}%"></span>
          </a>
          <form method="post" action="/stories/${story.id}/cover/focus" class="crop-form" data-focus-form="${key}">
            <span class="crop-preview cover-crop-preview">
              ${storyCoverImg(story, 'cover-thumb').replace('<img ', '<img data-focus-preview ')}
            </span>
            <span class="crop-fields">
              <span class="crop-label">What the thumbnail in the story list keeps</span>
              <span class="crop-numbers">
                <label>Across <input type="number" name="focusX" value="${x}" min="0" max="100" step="1" data-focus-x></label>
                <label>Down <input type="number" name="focusY" value="${y}" min="0" max="100" step="1" data-focus-y></label>
                <button class="btn ghost tiny" type="submit">Save crop</button>
              </span>
            </span>
          </form>
        </div>` : '<p class="hint">No cover: the story is listed as text, which is fine. A cover is a picture you have the right to use &mdash; a sketch, a photo, a design of your own.</p>'}
      <form method="post" action="/stories/${story.id}/cover" enctype="multipart/form-data" class="image-form">
        <label>${has ? 'Replace it' : 'Upload a cover'}
          <input type="file" name="cover" accept="${ACCEPT_ATTRIBUTE}" data-shrink required>
        </label>
        <button class="btn ghost small" type="submit">Upload</button>
        <span class="hint">PNG, JPEG, GIF or WebP. Upright works best (three wide by four tall); large pictures are shrunk in your browser before they are sent.</span>
      </form>
      ${has ? `
        <form method="post" action="/stories/${story.id}/cover/remove" class="inline-form" data-confirm="Take the cover off this story?">
          <button class="btn ghost tiny" type="submit">Remove the cover</button>
        </form>` : ''}
    </section>`;
}

/** @param {{ user: Row, story: Row, groups: any[], selectedTagIds: number[], error?: string|null, coverError?: string|null, values?: FormValues }} props */
function editStoryPage({ user, story, groups, selectedTagIds, error, coverError = null, values = /** @type {FormValues} */ ({}) }) {
  const title = values.title !== undefined ? values.title : story.title;
  const description = values.description !== undefined ? values.description : story.description;
  const synopsis = values.synopsis !== undefined ? values.synopsis : (story.synopsis || '');
  const status = values.status !== undefined ? values.status : (story.status || 'ongoing');
  return layout({
    title: `Edit - ${story.title}`,
    user,
    body: `
      <p class="breadcrumb"><a href="/stories/${story.id}">&larr; ${escapeHtml(story.title)}</a></p>
      <div class="writer-card">
        <h1>Story details</h1>
        <p class="muted writer-intro">The title, the blurb, and the tags that tell everyone what they're walking into. Editing these doesn't touch a single chapter.</p>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form method="post" action="/stories/${story.id}/edit" class="chapter-form">
          <label class="main-field">Title
            <input type="text" name="title" value="${escapeHtml(title)}" required>
          </label>
          <label>Description
            <textarea name="description" rows="3">${escapeHtml(description || '')}</textarea>
            <span class="hint">A couple of lines on what this story is, shown wherever it's listed.</span>
          </label>
          <label>Synopsis
            <textarea name="synopsis" rows="6">${escapeHtml(synopsis)}</textarea>
            <span class="hint">What actually happens, for somebody coming back to chapter nine after a month away. Spoilers are fine &mdash; it stays folded on the story page.</span>
          </label>
          <label>Where it stands
            <select name="status">
              ${CHOOSABLE_STORY_STATES.map((key) => `
                <option value="${key}"${key === status ? ' selected' : ''}>${escapeHtml(STORY_STATES[key].label)} &mdash; ${escapeHtml(STORY_STATES[key].hint)}</option>`).join('')}
            </select>
            <span class="hint">There is no &ldquo;on hiatus&rdquo; to pick: a story that has been ongoing with nothing new for six months says so on its own, and stops saying it the day you add a chapter.</span>
          </label>
          <label>Word goal (optional)
            <input type="number" name="wordGoal" value="${story.word_goal || ''}" min="0" step="1000" placeholder="e.g. 90000">
            <span class="hint">What the finished thing is aiming at. The story page draws how far along it is. Leave it empty and nothing is drawn: a number nobody set is not a target anybody missed.</span>
          </label>
          <div class="writer-section">
            <p class="writer-section-label">Tags</p>
            ${tagPicker(groups, selectedTagIds, { allowPropose: true })}
          </div>
          <div class="writer-actions">
            <a class="btn ghost" href="/stories/${story.id}">Cancel</a>
            <button class="btn" type="submit">Save details</button>
          </div>
        </form>
        ${coverSection(story, coverError)}
      </div>`,
  });
}

// ---------- glossary (a local, offline mirror of the shared-universe

module.exports = {
  storyResults,
  activityPage,
  commentGist,
  editStoryPage,
  inboxSection,
  storiesPage,
  storyRow,
  tagNotFoundPage,
  tagPage,
  tagsIndexPage,
};
