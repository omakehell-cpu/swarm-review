// public/js/md-serialize.js -- turns what the visual editor shows back
// into the Markdown a chapter is stored as.
//
// The visual editor is the same chapter rendered by the server's own
// Markdown code (lib/markdown.js, via /markdown/preview) and made
// editable. What comes back has to be Markdown that renders to what the
// writer saw -- the test for this file is exactly that: render, serialise,
// render again, and the two renderings must match. It does not have to be
// the same Markdown character for character: `__bold__` comes back as
// `**bold**`, and a stray asterisk in the prose comes back escaped.
//
// Only what lib/markdown.js understands is produced: paragraphs with their
// line breaks, headings, block quotes, scene breaks, bullet and numbered
// lists, bold, italic, strikethrough, code and links. Anything else the
// browser invents while editing (a <span style>, a <font>, a stray <div>)
// is kept for its words and loses its dress.
(function () {
  'use strict';

  const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'HR', 'UL', 'OL', 'LI', 'PRE', 'SECTION', 'ARTICLE']);

  // Characters that mean something to the parser anywhere in a line.
  const escapeInline = (text) => text.replace(/[\\*_~`[\]]/g, '\\$&');

  // ...and the ones that only mean something at the start of a line: a
  // heading, a quote, a list item, a scene break.
  function escapeLineStarts(text) {
    return text.split('\n').map((line) => line
      .replace(/^(\s*)([#>+-])(?=\s|$)/, '$1\\$2')
      .replace(/^(\s*)(\d+)([.)])(?=\s|$)/, '$1$2\\$3')
      .replace(/^(\s*)(-{3,})\s*$/, '$1\\$2')).join('\n');
  }

  // Emphasis markers cannot sit against whitespace on their inner side, so
  // "**word **" becomes "**word** ".
  function wrap(marker, inner) {
    if (!inner.trim()) return inner;
    const lead = inner.match(/^\s*/)[0];
    const trail = inner.match(/\s*$/)[0];
    return `${lead}${marker}${inner.trim()}${marker}${trail}`;
  }

  function inline(node) {
    if (node.nodeType === 3) return escapeInline(node.nodeValue.replace(/\u00a0/g, ' '));
    if (node.nodeType !== 1) return '';
    const tag = node.nodeName;
    const inner = () => Array.from(node.childNodes).map(inline).join('');
    if (tag === 'BR') return '\n';
    if (tag === 'STRONG' || tag === 'B') return wrap('**', inner());
    if (tag === 'EM' || tag === 'I') return wrap('*', inner());
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') return wrap('~~', inner());
    if (tag === 'CODE') {
      const text = node.textContent.replace(/\u00a0/g, ' ');
      if (!text) return '';
      const fence = text.includes('`') ? '``' : '`';
      return `${fence}${fence === '``' ? ' ' : ''}${text}${fence === '``' ? ' ' : ''}${fence}`;
    }
    if (tag === 'A') {
      const href = (node.getAttribute('href') || '').replace(/[()\s]/g, (c) => encodeURIComponent(c));
      const text = inner();
      return href ? `[${text}](${href})` : text;
    }
    // A block that ended up inside a line (the browser does this) is a line
    // break and its words.
    if (BLOCK.has(tag)) return `\n${inner()}`;
    return inner();
  }

  // A paragraph's lines, cleaned: no spaces hanging off the ends of lines,
  // no empty lines at either end.
  function paragraphText(nodes) {
    const text = nodes.map(inline).join('');
    const lines = text.split('\n').map((l) => l.replace(/[ \t]+$/, ''));
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return escapeLineStarts(lines.join('\n'));
  }

  function blocks(container) {
    const out = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const text = paragraphText(run);
      if (text.trim()) out.push(text);
      run = [];
    };
    for (const node of Array.from(container.childNodes)) {
      const tag = node.nodeType === 1 ? node.nodeName : '';
      if (!BLOCK.has(tag)) { run.push(node); continue; }
      flush();
      if (tag === 'HR') { out.push('---'); continue; }
      if (/^H[1-6]$/.test(tag)) {
        const text = paragraphText(Array.from(node.childNodes)).replace(/\n+/g, ' ').replace(/^\\#/, '#');
        if (text.trim()) out.push(`${'#'.repeat(Math.min(Number(tag[1]), 6))} ${text.replace(/^#/, '\\#')}`);
        continue;
      }
      if (tag === 'BLOCKQUOTE') {
        const inner = blocks(node).join('\n\n');
        if (inner.trim()) out.push(inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'));
        continue;
      }
      if (tag === 'UL' || tag === 'OL') {
        const items = Array.from(node.querySelectorAll('li'))
          .map((li) => paragraphText(Array.from(li.childNodes).filter((c) => c.nodeName !== 'UL' && c.nodeName !== 'OL')).replace(/\n+/g, ' '))
          .filter((t) => t.trim());
        if (items.length) out.push(items.map((t, i) => (tag === 'OL' ? `${i + 1}. ${t}` : `- ${t}`)).join('\n'));
        continue;
      }
      // P, DIV and the rest: a paragraph, unless it holds blocks of its own.
      const hasBlocks = Array.from(node.childNodes).some((c) => c.nodeType === 1 && BLOCK.has(c.nodeName));
      if (hasBlocks) out.push(...blocks(node));
      else {
        const text = paragraphText(Array.from(node.childNodes));
        if (text.trim()) out.push(text);
      }
    }
    flush();
    return out;
  }

  /** @param {Element} root */
  function markdownFromDom(root) {
    return blocks(root).join('\n\n');
  }

  /** @type {any} */ (window).markdownFromDom = markdownFromDom;
}());
