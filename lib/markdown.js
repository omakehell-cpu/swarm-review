// lib/markdown.js -- a small, dependency-free Markdown subset, hand-written
// so the app has no external packages to install anywhere it runs.
//
// Supported: paragraphs (single newlines inside a paragraph are kept as
// line breaks, not merged -- friendlier for pasted prose than strict
// CommonMark), # .. ###### headings, **bold**/__bold__, *italic*/_italic_,
// ***bold italic***, ~~strikethrough~~, `inline code`, [text](url) links,
// > blockquotes, horizontal rules (---, ***, ___), and - / * / 1. lists.
//
// Design note on comment anchoring: the reading pane renders this to real
// HTML (so **bold** actually shows bold), but comments still need to be
// anchored by plain character offsets the way the browser's
// window.getSelection() reports them. Those offsets are counted against
// the *rendered, visible* text (i.e. with markdown syntax characters
// stripped out) -- exactly what a TreeWalker over the rendered DOM's text
// nodes sees, in document order. flattenLength() and
// renderHighlighted() both walk the same AST in the same order so the
// coordinate spaces always agree.
'use strict';

const { escapeHtml } = require('./util');

// Solo se permiten estos esquemas en los enlaces [texto](url) del Markdown.
// Sin esto, un enlace como [clic](javascript:...) ejecutaria codigo en el
// navegador de cualquiera que hiciera clic (XSS). Una URL sin esquema (p.ej.
// "/pagina" o "pagina.html") se considera relativa y por tanto segura.
const SAFE_HREF_RE = /^(https?:|mailto:|tel:)/i;
function isSafeHref(href) {
  const trimmed = String(href || '').trim();
  if (!trimmed) return false;
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  if (!hasScheme) return true; // ruta relativa, sin esquema -> segura
  return SAFE_HREF_RE.test(trimmed);
}

// ---------------------------------------------------------------------
// block-level parsing
// ---------------------------------------------------------------------
const HR_RE = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_ITEM_RE = /^[-*]\s+(.*)$/;
const OL_ITEM_RE = /^\d+\.\s+(.*)$/;
const BLOCKQUOTE_LINE_RE = /^>\s?(.*)$/;

function parseMarkdown(source) {
  const raw = String(source ?? '').replace(/\r\n/g, '\n');
  const rawBlocks = raw.split(/\n{2,}/);
  const blocks = [];

  for (const rawBlock of rawBlocks) {
    const block = rawBlock.replace(/^\n+|\n+$/g, '');
    if (!block.trim()) continue;
    const lines = block.split('\n');

    if (lines.length === 1 && HR_RE.test(lines[0].trim())) {
      blocks.push({ type: 'hr' });
      continue;
    }

    const headingMatch = lines.length === 1 ? HEADING_RE.exec(lines[0]) : null;
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, inline: parseInline(headingMatch[2]) });
      continue;
    }

    if (lines.every((l) => BLOCKQUOTE_LINE_RE.test(l))) {
      const inner = lines.map((l) => BLOCKQUOTE_LINE_RE.exec(l)[1]).join('\n');
      blocks.push({ type: 'blockquote', inline: parseInline(inner) });
      continue;
    }

    if (lines.every((l) => UL_ITEM_RE.test(l))) {
      blocks.push({ type: 'ul', items: lines.map((l) => parseInline(UL_ITEM_RE.exec(l)[1])) });
      continue;
    }

    if (lines.every((l) => OL_ITEM_RE.test(l))) {
      blocks.push({ type: 'ol', items: lines.map((l) => parseInline(OL_ITEM_RE.exec(l)[1])) });
      continue;
    }

    blocks.push({ type: 'paragraph', inline: parseInline(lines.join('\n')) });
  }

  return blocks;
}

// ---------------------------------------------------------------------
// inline-level parsing
// ---------------------------------------------------------------------
// Order matters: more specific / longer markers are tried first so that,
// e.g., "***x***" is not swallowed by the "**" alternative first.
const INLINE_SOURCE = [
  '`([^`\\n]+)`', // 1 code
  '\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)', // 2 link text, 3 link href
  '\\*\\*\\*([\\s\\S]+?)\\*\\*\\*', // 4 bold+italic
  '\\*\\*([\\s\\S]+?)\\*\\*', // 5 bold
  '__([\\s\\S]+?)__', // 6 bold
  '\\*([\\s\\S]+?)\\*', // 7 italic
  '_([\\s\\S]+?)_', // 8 italic
  '~~([\\s\\S]+?)~~', // 9 strike
].join('|');

// A fresh RegExp is created per call (rather than reusing one module-level
// instance) because this function recurses, and a shared `g`-flag regex's
// `lastIndex` would otherwise be clobbered by the recursive call.
function parseInline(text) {
  const nodes = [];
  let lastIndex = 0;
  const re = new RegExp(INLINE_SOURCE, 'g');
  let m;
  while ((m = re.exec(text))) {
    if (m.index > lastIndex) nodes.push({ type: 'text', value: text.slice(lastIndex, m.index) });
    if (m[1] !== undefined) {
      nodes.push({ type: 'code', value: m[1] });
    } else if (m[2] !== undefined) {
      nodes.push({ type: 'link', href: m[3], children: [{ type: 'text', value: m[2] }] });
    } else if (m[4] !== undefined) {
      nodes.push({ type: 'strongem', children: parseInline(m[4]) });
    } else if (m[5] !== undefined) {
      nodes.push({ type: 'strong', children: parseInline(m[5]) });
    } else if (m[6] !== undefined) {
      nodes.push({ type: 'strong', children: parseInline(m[6]) });
    } else if (m[7] !== undefined) {
      nodes.push({ type: 'em', children: parseInline(m[7]) });
    } else if (m[8] !== undefined) {
      nodes.push({ type: 'em', children: parseInline(m[8]) });
    } else if (m[9] !== undefined) {
      nodes.push({ type: 'strike', children: parseInline(m[9]) });
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) nodes.push({ type: 'text', value: text.slice(lastIndex) });
  return nodes;
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

function renderPlainText(blocks) {
  const parts = [];
  for (const block of blocks) {
    if (block.type === 'hr') {
      parts.push('---');
    } else if (block.type === 'heading') {
      parts.push(inlineToReadableText(block.inline));
    } else if (block.type === 'blockquote') {
      parts.push(inlineToReadableText(block.inline).split('\n').map((l) => `> ${l}`).join('\n'));
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

function renderHighlighted(blocks, comments) {
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

  function renderLeaf(value) {
    const leafStart = cursor;
    const leafEnd = cursor + value.length;
    const localPoints = points.filter((p) => p > leafStart && p < leafEnd);
    const bounds = [leafStart, ...localPoints, leafEnd];
    let html = '';
    for (let i = 0; i < bounds.length - 1; i++) {
      const segStart = bounds[i];
      const segEnd = bounds[i + 1];
      if (segStart >= segEnd) continue;
      const segText = value.slice(segStart - leafStart, segEnd - leafStart);
      const active = anchored.filter((c) => c.start_offset <= segStart && c.end_offset >= segEnd);
      if (active.length === 0) {
        html += escapeHtml(segText);
      } else {
        const ids = active.map((c) => c.id).join(',');
        const statuses = new Set(active.map((c) => c.status));
        let cls = 'hl';
        if (statuses.has('pending')) cls += ' hl-pending';
        else if (statuses.has('rejected') && !statuses.has('accepted')) cls += ' hl-rejected';
        else cls += ' hl-accepted';
        html += `<span class="${cls}" data-comment-ids="${escapeHtml(ids)}">${escapeHtml(segText)}</span>`;
      }
    }
    cursor = leafEnd;
    return html;
  }

  function renderInline(nodes) {
    let html = '';
    for (const node of nodes) {
      if (node.type === 'text') html += renderLeaf(node.value);
      else if (node.type === 'code') html += `<code>${renderLeaf(node.value)}</code>`;
      else if (node.type === 'link') html += `<a href="${escapeHtml(isSafeHref(node.href) ? node.href : '#')}" target="_blank" rel="noopener noreferrer">${renderInline(node.children)}</a>`;
      else if (node.type === 'strongem') html += `<strong><em>${renderInline(node.children)}</em></strong>`;
      else if (TAG[node.type]) html += `<${TAG[node.type]}>${renderInline(node.children)}</${TAG[node.type]}>`;
      else html += renderInline(node.children || []);
    }
    return html;
  }

  let out = '';
  for (const block of blocks) {
    if (block.type === 'hr') {
      out += '<hr>';
    } else if (block.type === 'heading') {
      const level = Math.min(Math.max(block.level, 1), 6);
      out += `<h${level}>${renderInline(block.inline)}</h${level}>`;
    } else if (block.type === 'blockquote') {
      out += `<blockquote>${renderInline(block.inline)}</blockquote>`;
    } else if (block.type === 'ul') {
      out += `<ul>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`;
    } else if (block.type === 'ol') {
      out += `<ol>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ol>`;
    } else {
      out += `<p>${renderInline(block.inline)}</p>`;
    }
  }
  return out;
}

module.exports = {
  parseMarkdown,
  flattenLength,
  inlineToPlainText,
  renderHighlighted,
  renderPlainText,
};
