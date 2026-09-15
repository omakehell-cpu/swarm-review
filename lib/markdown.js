// lib/markdown.js -- the Markdown a chapter is written in, and the
// offset-aware rendering that comment anchoring depends on.
//
// The parsing is markdown-it's. The rest of this file -- flattenLength and
// renderHighlighted especially -- is this app's, and is the part that
// actually matters: comments are stored as character offsets into the
// *flattened* text of a chapter (the prose with every mark of markdown
// removed and nothing else added or taken away), and the renderer has to
// walk that same coordinate space to put a highlight back on the words it
// was made on. See test/markdown-anchoring.test.js.
//
// markdown-it is configured from its "zero" preset, which enables no rules
// at all, and then told exactly which ones this app supports. That is
// deliberate and worth keeping: every rule enabled here changes what
// counts as a syntax character, and therefore changes where every stored
// comment in the archive lands. A rule switched on by a future version of
// markdown-it could silently slide comments off their quotes; from a zero
// preset, it cannot.
//
// Supported: paragraphs (single newlines inside a paragraph are kept as
// line breaks, not merged -- friendlier for pasted prose than strict
// CommonMark), # .. ###### headings, **bold**/__bold__, *italic*/_italic_,
// ***bold italic***, ~~strikethrough~~, `inline code`, [text](url) links,
// > blockquotes, horizontal rules (---, ***, ___), - / * / 1. lists, and
// backslash escapes (\* is a literal asterisk).
//
// Deliberately not enabled: indented code blocks (four spaces of
// indentation is something prose does by accident), fenced code, tables,
// raw HTML, reference-style links, autolinks, images, and setext
// headings. Several of those would be nice; none is worth a block type
// this file's renderer would have to learn before it could count
// characters through it.
'use strict';

const MarkdownIt = require('markdown-it');

const { escapeHtml } = require('./util');

const md = new MarkdownIt('zero', { html: false, linkify: false, typographer: false })
  .enable([
    // block
    'heading', 'hr', 'list', 'blockquote',
    // inline
    'emphasis', 'strikethrough', 'backticks', 'link', 'escape', 'newline',
  ]);

// Only these schemes are allowed in Markdown [text](url) links. Without
// this, a link like [click](javascript:...) would run code in the browser
// of anyone who clicked it (XSS). A URL with no scheme (e.g. "/page" or
// "page.html") is treated as relative and therefore safe.
const SAFE_HREF_RE = /^(https?:|mailto:|tel:)/i;
function isSafeHref(href) {
  const trimmed = String(href || '').trim();
  if (!trimmed) return false;
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  if (!hasScheme) return true; // ruta relativa, sin esquema -> segura
  return SAFE_HREF_RE.test(trimmed);
}

// ---------------------------------------------------------------------
// markdown-it tokens -> this file's own small AST
// ---------------------------------------------------------------------
// The AST is kept rather than rendering markdown-it's tokens directly
// because two other things read it: renderHighlighted below, which needs
// to walk it twice in the same order, and lib/docx.js, which turns it into
// Word paragraphs.

const INLINE_WRAPPERS = { strong: 'strong', em: 'em', s: 'strike' };

// Walks the flat children array of one `inline` token, which uses
// open/close pairs rather than nesting.
function inlineNodesFrom(children, start = 0, stopAt = null) {
  const nodes = [];
  let i = start;
  while (i < children.length) {
    const token = children[i];
    if (stopAt && token.type === stopAt) return { nodes, next: i + 1 };

    if (token.type === 'text') {
      if (token.content) nodes.push({ type: 'text', value: token.content });
      i += 1;
    } else if (token.type === 'code_inline') {
      nodes.push({ type: 'code', value: token.content });
      i += 1;
    } else if (token.type === 'softbreak' || token.type === 'hardbreak') {
      nodes.push({ type: 'text', value: '\n' });
      i += 1;
    } else if (token.type === 'link_open') {
      const inner = inlineNodesFrom(children, i + 1, 'link_close');
      nodes.push({ type: 'link', href: token.attrGet('href') || '', children: inner.nodes });
      i = inner.next;
    } else if (INLINE_WRAPPERS[token.tag] && token.nesting === 1) {
      const inner = inlineNodesFrom(children, i + 1, `${token.type.replace(/_open$/, '')}_close`);
      nodes.push({ type: INLINE_WRAPPERS[token.tag], children: inner.nodes });
      i = inner.next;
    } else {
      i += 1;
    }
  }
  return { nodes, next: i };
}

const inlineFrom = (token) => (token && token.children ? inlineNodesFrom(token.children).nodes : []);

// Where the token that closes the one at `open` sits.
function matchingClose(tokens, open) {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    depth += tokens[i].nesting;
    if (depth === 0 && i > open) return i;
  }
  return tokens.length - 1;
}

// A blockquote, or a list item, can hold several paragraphs; this AST
// gives each one a single run of inline content, so they are joined with
// the blank line that separated them.
function joinInline(blocks) {
  const out = [];
  for (const block of blocks) {
    if (!block.inline || !block.inline.length) continue;
    if (out.length) out.push({ type: 'text', value: '\n\n' });
    out.push(...block.inline);
  }
  return out;
}

function itemsFrom(tokens) {
  const items = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].type !== 'list_item_open') { i += 1; continue; }
    const end = matchingClose(tokens, i);
    const inner = blocksFrom(tokens.slice(i + 1, end));
    // This AST has no nested lists. Rather than drop the words, a nested
    // list's items become further items of the list around it -- which is
    // also what the hand-written parser this replaced did with them.
    const own = inner.filter((b) => b.type !== 'ul' && b.type !== 'ol');
    items.push(joinInline(own));
    for (const nested of inner.filter((b) => b.type === 'ul' || b.type === 'ol')) {
      items.push(...nested.items);
    }
    i = end + 1;
  }
  return items;
}

function blocksFrom(tokens) {
  const blocks = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type === 'heading_open') {
      blocks.push({
        type: 'heading',
        level: Number(token.tag.slice(1)) || 1,
        inline: inlineFrom(tokens[i + 1]),
      });
      i += 3;
    } else if (token.type === 'paragraph_open') {
      const inline = inlineFrom(tokens[i + 1]);
      if (inline.length) blocks.push({ type: 'paragraph', inline });
      i += 3;
    } else if (token.type === 'hr') {
      blocks.push({ type: 'hr' });
      i += 1;
    } else if (token.type === 'blockquote_open') {
      const end = matchingClose(tokens, i);
      blocks.push({ type: 'blockquote', inline: joinInline(blocksFrom(tokens.slice(i + 1, end))) });
      i = end + 1;
    } else if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const end = matchingClose(tokens, i);
      blocks.push({
        type: token.type === 'ordered_list_open' ? 'ol' : 'ul',
        items: itemsFrom(tokens.slice(i + 1, end)),
      });
      i = end + 1;
    } else {
      i += 1;
    }
  }
  return blocks;
}

function parseMarkdown(source) {
  return blocksFrom(md.parse(String(source ?? '').replace(/\r\n/g, '\n'), {}));
}

// ---------------------------------------------------------------------
// flattened length (the offset coordinate space used for comment anchors)
// ---------------------------------------------------------------------
function inlineLength(nodes) {
  let total = 0;
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'code') total += node.value.length;
    else total += inlineLength(node.children);
  }
  return total;
}

function flattenLength(blocks) {
  let total = 0;
  for (const block of blocks) {
    if (block.type === 'hr') continue;
    if (block.type === 'ul' || block.type === 'ol') {
      for (const item of block.items) total += inlineLength(item);
    } else {
      total += inlineLength(block.inline);
    }
  }
  return total;
}

// ---------------------------------------------------------------------
// plain-text extraction (used for the "quoted passage" preview text; not
// used for offsets, just for convenience elsewhere if ever needed)
// ---------------------------------------------------------------------
function inlineToPlainText(nodes) {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'code') out += node.value;
    else out += inlineToPlainText(node.children);
  }
  return out;
}

// ---------------------------------------------------------------------
// plain-text rendering (for .txt export): markdown syntax stripped,
// readable as plain prose. Links keep their URL in parentheses since
// there's no way to make them clickable in plain text.
// ---------------------------------------------------------------------
function inlineToReadableText(nodes) {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'code') out += node.value;
    else if (node.type === 'link') out += `${inlineToReadableText(node.children)} (${node.href})`;
    else out += inlineToReadableText(node.children || []);
  }
  return out;
}

// The .txt download wants real Markdown-ish markers, because it is a text
// file somebody may open anywhere. The diff wants the prose as the reading
// view shows it, where a blockquote is an indented italic block and not a
// line starting with ">", so it asks for the marker to be left off.
/**
 * @param {any[]} blocks
 * @param {{ quoteMarker?: string }} [options]
 */
function renderPlainText(blocks, { quoteMarker = '> ' } = {}) {
  const parts = [];
  for (const block of blocks) {
    if (block.type === 'hr') {
      parts.push('---');
    } else if (block.type === 'heading') {
      parts.push(inlineToReadableText(block.inline));
    } else if (block.type === 'blockquote') {
      parts.push(inlineToReadableText(block.inline).split('\n').map((l) => `${quoteMarker}${l}`).join('\n'));
    } else if (block.type === 'ul') {
      parts.push(block.items.map((item) => `- ${inlineToReadableText(item)}`).join('\n'));
    } else if (block.type === 'ol') {
      parts.push(block.items.map((item, i) => `${i + 1}. ${inlineToReadableText(item)}`).join('\n'));
    } else {
      parts.push(inlineToReadableText(block.inline));
    }
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------
// HTML rendering with offset-aware comment highlighting
// ---------------------------------------------------------------------
const TAG = { strong: 'strong', em: 'em', strike: 's' };

// `findWikiMatches(text)` (see lib/wiki.js), if provided, is used to
// auto-link character/place/ship names recognized from the shared wiki's
// index. Optional so callers that don't need it (or during a request
// where the wiki module isn't relevant) can simply omit it.
function renderHighlighted(blocks, comments, findWikiMatches) {
  const anchored = (comments || []).filter(
    (c) => c.parent_id == null && c.start_offset != null && c.end_offset != null && c.end_offset > c.start_offset
  );
  const totalLength = flattenLength(blocks);
  const pointSet = new Set([0, totalLength]);
  anchored.forEach((c) => {
    pointSet.add(Math.max(0, Math.min(c.start_offset, totalLength)));
    pointSet.add(Math.max(0, Math.min(c.end_offset, totalLength)));
  });
  const points = Array.from(pointSet).sort((a, b) => a - b);

  let cursor = 0;

  // `allowWikiLink` is false for text that's already inside a markdown
  // [link](url) or `code` span -- nesting an <a> inside another <a> would
  // be invalid HTML, and auto-linking inside code would misread literal
  // text as prose.
  function renderLeaf(value, allowWikiLink) {
    const leafStart = cursor;
    const leafEnd = cursor + value.length;
    // Wiki matches are found per-leaf (findWikiMatches only sees this
    // leaf's own text) and translated into the same global offset space
    // as comment boundaries, so both sets of cut points merge into one
    // segmentation -- that's what keeps a wiki-linked name that's partly
    // covered by a comment highlight from producing overlapping,
    // improperly-nested <a>/<span> tags: every segment ends up either
    // fully inside one, fully inside the other, both, or neither.
    const wikiMatches = (allowWikiLink && findWikiMatches) ? findWikiMatches(value) : [];
    const wikiByStart = new Map(wikiMatches.map((m) => [leafStart + m.start, m]));
    const wikiPoints = [];
    wikiMatches.forEach((m) => { wikiPoints.push(leafStart + m.start, leafStart + m.end); });

    const localPoints = points.filter((p) => p > leafStart && p < leafEnd);
    const bounds = [leafStart, ...Array.from(new Set([...localPoints, ...wikiPoints])).sort((a, b) => a - b), leafEnd];
    let html = '';
    for (let i = 0; i < bounds.length - 1; i++) {
      const segStart = bounds[i];
      const segEnd = bounds[i + 1];
      if (segStart >= segEnd) continue;
      const segText = value.slice(segStart - leafStart, segEnd - leafStart);

      const wikiMatch = wikiByStart.get(segStart);
      const isFullWikiMatch = wikiMatch && leafStart + wikiMatch.end === segEnd;
      const inner = isFullWikiMatch
        ? `<a class="wiki-link${wikiMatch.cast ? ' cast-link' : ''}" href="${escapeHtml(wikiMatch.url)}" data-wiki-summary="${escapeHtml(wikiMatch.summary)}">${escapeHtml(segText)}</a>`
        : escapeHtml(segText);

      const active = anchored.filter((c) => c.start_offset <= segStart && c.end_offset >= segEnd);
      if (active.length === 0) {
        html += inner;
      } else {
        const ids = active.map((c) => c.id).join(',');
        const statuses = new Set(active.map((c) => c.status));
        let cls = 'hl';
        if (statuses.has('pending')) cls += ' hl-pending';
        else if (statuses.has('rejected') && !statuses.has('accepted')) cls += ' hl-rejected';
        else cls += ' hl-accepted';
        html += `<span class="${cls}" data-comment-ids="${escapeHtml(ids)}">${inner}</span>`;
      }
    }
    cursor = leafEnd;
    return html;
  }

  function renderInline(nodes, allowWikiLink) {
    let html = '';
    for (const node of nodes) {
      if (node.type === 'text') html += renderLeaf(node.value, allowWikiLink);
      else if (node.type === 'code') html += `<code>${renderLeaf(node.value, false)}</code>`;
      else if (node.type === 'link') html += `<a href="${escapeHtml(isSafeHref(node.href) ? node.href : '#')}" target="_blank" rel="noopener noreferrer">${renderInline(node.children, false)}</a>`;
      else if (node.type === 'strongem') html += `<strong><em>${renderInline(node.children, allowWikiLink)}</em></strong>`;
      else if (TAG[node.type]) html += `<${TAG[node.type]}>${renderInline(node.children, allowWikiLink)}</${TAG[node.type]}>`;
      else html += renderInline(node.children || [], allowWikiLink);
    }
    return html;
  }

  let out = '';
  for (const block of blocks) {
    if (block.type === 'hr') {
      out += '<hr>';
    } else if (block.type === 'heading') {
      const level = Math.min(Math.max(block.level, 1), 6);
      out += `<h${level}>${renderInline(block.inline, true)}</h${level}>`;
    } else if (block.type === 'blockquote') {
      out += `<blockquote>${renderInline(block.inline, true)}</blockquote>`;
    } else if (block.type === 'ul') {
      out += `<ul>${block.items.map((item) => `<li>${renderInline(item, true)}</li>`).join('')}</ul>`;
    } else if (block.type === 'ol') {
      out += `<ol>${block.items.map((item) => `<li>${renderInline(item, true)}</li>`).join('')}</ol>`;
    } else {
      out += `<p>${renderInline(block.inline, true)}</p>`;
    }
  }
  return out;
}

// Counts words the way a writer means the question. It walks the parsed
// document rather than the source or the plain-text rendering, so it sees
// exactly the characters a reader sees: no markdown marks, no list
// markers, no scene-break rules, and a link's text but not its target --
// the same text flattenLength() measures for comment anchoring.
function countWords(source) {
  let text = '';
  const add = (nodes) => { text += ` ${inlineToPlainText(nodes)}`; };
  for (const block of parseMarkdown(source)) {
    if (block.type === 'hr') continue;
    if (block.type === 'ul' || block.type === 'ol') block.items.forEach(add);
    else add(block.inline);
  }
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu);
  return words ? words.length : 0;
}

module.exports = {
  parseMarkdown,
  countWords,
  flattenLength,
  inlineToPlainText,
  renderHighlighted,
  renderPlainText,
};
