// lib/docx.js -- reading and writing .docx (Word) files.
//
// This used to be a hand-written OOXML reader and writer on top of
// lib/zip.js. It worked, but it only understood the small corner of Word
// it had been taught: numbered lists came back as bullets, tables and
// footnotes vanished, and the chapter title the writer put at the top of
// the document came back as a stray bold line the next time somebody
// uploaded that same file.
//
// Now: mammoth reads (it knows Word's actual style model, including real
// numbering and footnotes), the `docx` package writes (it produces a
// document Word will happily edit further, with real heading styles and
// real numbering rather than typed-out "1." text).
//
// The bridge in both directions is this app's own Markdown dialect -- see
// lib/markdown.js -- because that's what a chapter is stored as. So the
// reader converts Word to HTML and then to that dialect, and the writer
// parses that dialect and builds a Word document from the blocks.
'use strict';

const mammoth = require('mammoth');
const {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink,
  HeadingLevel, AlignmentType, BorderStyle, LevelFormat, convertInchesToTwip,
} = require('docx');

const { parseMarkdown } = require('./markdown');

// ---------------------------------------------------------------------
// reading: .docx -> markdown
// ---------------------------------------------------------------------

// Maps the styles this app's own writer uses back to what they meant, so a
// chapter downloaded as .docx and re-uploaded comes back as the chapter it
// was. The `=> !` on Title is what keeps the chapter's own title out of the
// text: the title lives in a field of its own in this app, and writing it
// into the document body is a convenience for reading it in Word, not part
// of the prose.
const STYLE_MAP = [
  "p[style-name='Title'] => !",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
  "r[style-name='Code'] => code",
  "r[style-name='Code Char'] => code",
];

// mammoth's HTML is small, well-formed and predictable, which is what makes
// walking it with a tokenizer reasonable here. It is not a general-purpose
// HTML parser and should never be pointed at HTML from anywhere else.
const TOKEN_RE = /<\/?([a-z0-9]+)((?:\s+[^>]*?)?)\s*(\/?)>|([^<]+)/gi;

function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function attr(attrs, name) {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs || '');
  return m ? decodeEntities(m[1]) : '';
}

// Builds a shallow tree of { tag, attrs, children } / strings.
function parseHtml(html) {
  const root = { tag: '#root', attrs: '', children: [] };
  const stack = [root];
  // Void elements never get a closing tag, so they must not open a scope.
  const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link']);
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(html)) !== null) {
    const [full, tagName, attrs, selfClosing, text] = m;
    if (text !== undefined) {
      stack[stack.length - 1].children.push(decodeEntities(text));
      continue;
    }
    const tag = tagName.toLowerCase();
    if (full.startsWith('</')) {
      // Close the innermost matching scope, ignoring a stray close tag.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const node = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing && !VOID.has(tag)) stack.push(node);
  }
  return root;
}

const INLINE_WRAPPERS = {
  strong: '**', b: '**',
  em: '*', i: '*',
  s: '~~', del: '~~', strike: '~~',
  code: '`',
};

function inlineToMarkdown(nodes) {
  let out = '';
  for (const node of nodes) {
    if (typeof node === 'string') { out += node.replace(/\s+/g, ' '); continue; }
    if (node.tag === 'br') { out += '\n'; continue; }
    // Word documents can carry images; a chapter here is text, and a
    // base64 image dropped into the prose would be unreadable either way.
    if (node.tag === 'img') continue;
    if (node.tag === 'a') {
      const href = attr(node.attrs, 'href');
      const label = inlineToMarkdown(node.children).trim();
      // Footnote and endnote references come through as links to an
      // anchor further down the document; the note's own text is emitted
      // as a list at the end, so the marker itself adds nothing.
      if (!href || href.startsWith('#')) { out += label; continue; }
      out += label ? `[${label}](${href})` : href;
      continue;
    }
    const wrap = INLINE_WRAPPERS[node.tag];
    const inner = inlineToMarkdown(node.children);
    if (!wrap) { out += inner; continue; }
    // Wrapping empty or whitespace-only content would leave dangling
    // asterisks in the text.
    if (!inner.trim()) { out += inner; continue; }
    // Word happily marks the trailing space of a word as bold too; moving
    // the whitespace outside the marks keeps the Markdown from breaking.
    const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
    out += `${lead}${wrap}${core}${wrap}${trail}`;
  }
  return out;
}

function listToMarkdown(node, ordered, depth) {
  const lines = [];
  let n = 0;
  for (const item of node.children) {
    if (typeof item === 'string' || item.tag !== 'li') continue;
    n += 1;
    const nested = [];
    const own = item.children.filter((c) => {
      if (typeof c !== 'string' && (c.tag === 'ul' || c.tag === 'ol')) { nested.push(c); return false; }
      return true;
    });
    const marker = ordered ? `${n}.` : '-';
    lines.push(`${'  '.repeat(depth)}${marker} ${inlineToMarkdown(own).trim()}`);
    // This app's Markdown has no nested lists, so a nested one is flattened
    // into the parent rather than dropped -- the words matter more than the
    // indentation.
    for (const sub of nested) lines.push(listToMarkdown(sub, sub.tag === 'ol', depth + 1));
  }
  return lines.join('\n');
}

function tableToMarkdown(node) {
  // This app's Markdown has no table syntax. Rendering each row as a line
  // of cells keeps the content, which is what a reviewer needs; it is not
  // a faithful table and does not pretend to be.
  const rows = [];
  const walk = (n) => {
    for (const child of n.children) {
      if (typeof child === 'string') continue;
      if (child.tag === 'tr') {
        const cells = child.children
          .filter((c) => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th'))
          .map((c) => inlineToMarkdown(c.children).trim());
        if (cells.some(Boolean)) rows.push(cells.join(' | '));
      } else walk(child);
    }
  };
  walk(node);
  return rows.join('\n');
}

function blocksToMarkdown(nodes) {
  const out = [];
  for (const node of nodes) {
    if (typeof node === 'string') {
      // Whitespace between block elements.
      if (node.trim()) out.push(node.trim());
      continue;
    }
    const heading = /^h([1-6])$/.exec(node.tag);
    if (heading) {
      const text = inlineToMarkdown(node.children).trim();
      if (text) out.push(`${'#'.repeat(Number(heading[1]))} ${text}`);
    } else if (node.tag === 'p') {
      const text = inlineToMarkdown(node.children).trim();
      if (text) out.push(text);
    } else if (node.tag === 'ul' || node.tag === 'ol') {
      const text = listToMarkdown(node, node.tag === 'ol', 0);
      if (text.trim()) out.push(text);
    } else if (node.tag === 'blockquote') {
      const inner = blocksToMarkdown(node.children);
      if (inner.trim()) out.push(inner.split('\n\n').map((para) => `> ${para.replace(/\n/g, '\n> ')}`).join('\n\n'));
    } else if (node.tag === 'table') {
      const text = tableToMarkdown(node);
      if (text.trim()) out.push(text);
    } else if (node.tag === 'hr') {
      out.push('---');
    } else if (node.tag === 'br') {
      continue;
    } else {
      // div, section, or anything else with block children inside it.
      const inner = blocksToMarkdown(node.children);
      if (inner.trim()) out.push(inner);
    }
  }
  return out.join('\n\n');
}

function htmlToMarkdown(html) {
  return blocksToMarkdown(parseHtml(html).children)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Turns an uploaded .docx into this app's Markdown.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function docxBufferToMarkdown(buffer) {
  const { value } = await mammoth.convertToHtml({ buffer }, { styleMap: STYLE_MAP });
  return htmlToMarkdown(value);
}

// ---------------------------------------------------------------------
// writing: markdown -> .docx
// ---------------------------------------------------------------------

const NUMBERING_REFERENCE = 'swarm-ordered-list';

// A character style rather than a bare monospace font, so the reader above
// can recognise inline code on the way back in -- a font name alone would
// be indistinguishable from an author who simply likes Courier.
const CODE_STYLE_ID = 'Code';

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
];

function runsFromInline(nodes, format = {}) {
  const runs = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      if (node.value) runs.push(new TextRun({ text: node.value, ...format }));
    } else if (node.type === 'code') {
      runs.push(new TextRun({ text: node.value, style: CODE_STYLE_ID, ...format }));
    } else if (node.type === 'strong') {
      runs.push(...runsFromInline(node.children, { ...format, bold: true }));
    } else if (node.type === 'em') {
      runs.push(...runsFromInline(node.children, { ...format, italics: true }));
    } else if (node.type === 'strongem') {
      runs.push(...runsFromInline(node.children, { ...format, bold: true, italics: true }));
    } else if (node.type === 'strike') {
      runs.push(...runsFromInline(node.children, { ...format, strike: true }));
    } else if (node.type === 'link') {
      runs.push(new ExternalHyperlink({
        link: node.href,
        children: runsFromInline(node.children, { ...format, style: 'Hyperlink' }),
      }));
    } else if (node.children) {
      runs.push(...runsFromInline(node.children, format));
    }
  }
  return runs;
}

function paragraphsFromBlocks(blocks) {
  const paragraphs = [];
  // Each ordered list gets its own instance, or Word would carry the
  // numbering on from the previous list and start the second one at 4.
  let listInstance = 0;

  for (const block of blocks) {
    if (block.type === 'heading') {
      paragraphs.push(new Paragraph({
        heading: HEADING_LEVELS[Math.min(block.level, 6) - 1],
        children: runsFromInline(block.inline),
      }));
    } else if (block.type === 'blockquote') {
      paragraphs.push(new Paragraph({
        style: 'Quote',
        indent: { left: convertInchesToTwip(0.4) },
        children: runsFromInline(block.inline),
      }));
    } else if (block.type === 'ul') {
      for (const item of block.items) {
        paragraphs.push(new Paragraph({ bullet: { level: 0 }, children: runsFromInline(item) }));
      }
    } else if (block.type === 'ol') {
      listInstance += 1;
      for (const item of block.items) {
        paragraphs.push(new Paragraph({
          numbering: { reference: NUMBERING_REFERENCE, level: 0, instance: listInstance },
          children: runsFromInline(item),
        }));
      }
    } else if (block.type === 'hr') {
      paragraphs.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: '999999' } },
        spacing: { before: 200, after: 200 },
      }));
    } else {
      paragraphs.push(new Paragraph({ children: runsFromInline(block.inline) }));
    }
  }
  return paragraphs;
}

/**
 * Renders a chapter as a Word document.
 * @param {{ title?: string, markdownSource: string }} chapter
 * @returns {Promise<Buffer>}
 */
async function markdownToDocxBuffer({ title, markdownSource }) {
  const body = paragraphsFromBlocks(parseMarkdown(markdownSource));

  const doc = new Document({
    title: title || '',
    styles: {
      paragraphStyles: [
        {
          id: 'Quote',
          name: 'Quote',
          basedOn: 'Normal',
          quickFormat: true,
          run: { italics: true },
          paragraph: { indent: { left: convertInchesToTwip(0.4) } },
        },
      ],
      characterStyles: [
        {
          id: CODE_STYLE_ID,
          name: 'Code',
          basedOn: 'DefaultParagraphFont',
          quickFormat: true,
          run: { font: 'Courier New' },
        },
      ],
    },
    numbering: {
      config: [{
        reference: NUMBERING_REFERENCE,
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } },
        }],
      }],
    },
    sections: [{
      children: [
        // Styled as the document's Title so Word shows it as one and the
        // reader above knows to leave it out of the prose.
        ...(title ? [new Paragraph({
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: [new TextRun(title)],
        })] : []),
        ...body,
      ],
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { markdownToDocxBuffer, docxBufferToMarkdown, htmlToMarkdown };
