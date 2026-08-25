// lib/docx.js -- minimal, dependency-free .docx (Word) generation and
// parsing, built on top of lib/zip.js. Only handles the subset of OOXML
// that matters for this app's Markdown subset: paragraphs, bold/italic/
// strikethrough/inline-code runs, headings, blockquotes (as indented
// italic paragraphs), bullet/numbered lists (rendered as literal bullet/
// number text rather than real Word numbering -- simpler and still reads
// fine, just not "true" Word list formatting if you edit it further in
// Word), horizontal rules (as a bottom-bordered empty paragraph), and
// hyperlinks. Good enough for review-and-comment fiction chapters; not a
// general-purpose Word importer/exporter.
'use strict';

const { createZip, readZip } = require('./zip');
const { parseMarkdown } = require('./markdown');

// ---------------------------------------------------------------------
// XML escaping helpers
// ---------------------------------------------------------------------
function xmlEscape(str) {
  return String(str ?? '').replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[c]));
}

function xmlUnescape(str) {
  return String(str ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&'); // must be last
}

// ---------------------------------------------------------------------
// package boilerplate
// ---------------------------------------------------------------------
const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const PACKAGE_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function buildDocumentRelsXml(relationships) {
  const rels = relationships.map((r) =>
    `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(r.target)}" TargetMode="External"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

// ---------------------------------------------------------------------
// writer: markdown AST -> word/document.xml
// ---------------------------------------------------------------------
function buildRunProps(fmt) {
  const parts = [];
  if (fmt.sz) { parts.push(`<w:sz w:val="${fmt.sz}"/><w:szCs w:val="${fmt.sz}"/>`); }
  if (fmt.bold) parts.push('<w:b/><w:bCs/>');
  if (fmt.italic) parts.push('<w:i/><w:iCs/>');
  if (fmt.strike) parts.push('<w:strike/>');
  if (fmt.code) parts.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
  if (fmt.link) parts.push('<w:color w:val="1155CC"/><w:u w:val="single"/>');
  return parts.length ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
}

function renderTextRun(value, fmt) {
  const rPr = buildRunProps(fmt);
  const pieces = value.split('\n');
  let xml = '';
  pieces.forEach((piece, i) => {
    if (i > 0) xml += `<w:r>${rPr}<w:br/></w:r>`;
    if (piece.length) xml += `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(piece)}</w:t></w:r>`;
  });
  return xml;
}

function renderRunsXml(nodes, fmt, relationships) {
  let xml = '';
  for (const node of nodes) {
    if (node.type === 'text') xml += renderTextRun(node.value, fmt);
    else if (node.type === 'code') xml += renderTextRun(node.value, { ...fmt, code: true });
    else if (node.type === 'link') {
      const rId = `rId${relationships.length + 1}`;
      relationships.push({ id: rId, target: node.href });
      xml += `<w:hyperlink r:id="${rId}" w:history="1">${renderRunsXml(node.children, { ...fmt, link: true }, relationships)}</w:hyperlink>`;
    } else if (node.type === 'strongem') xml += renderRunsXml(node.children, { ...fmt, bold: true, italic: true }, relationships);
    else if (node.type === 'strong') xml += renderRunsXml(node.children, { ...fmt, bold: true }, relationships);
    else if (node.type === 'em') xml += renderRunsXml(node.children, { ...fmt, italic: true }, relationships);
    else if (node.type === 'strike') xml += renderRunsXml(node.children, { ...fmt, strike: true }, relationships);
  }
  return xml;
}

const HEADING_HALF_PT = { 1: 56, 2: 44, 3: 36, 4: 30, 5: 26, 6: 24 };

function renderParagraphsXml(blocks, relationships) {
  let xml = '';
  for (const block of blocks) {
    if (block.type === 'hr') {
      xml += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>';
    } else if (block.type === 'heading') {
      const sz = HEADING_HALF_PT[block.level] || 24;
      // Reference the standard "HeadingN" style ID (Word has built-in
      // defaults for these even when styles.xml doesn't define them) *and*
      // apply direct bold/size formatting, so it looks right everywhere
      // and also round-trips back into a real heading if re-uploaded.
      xml += `<w:p><w:pPr><w:pStyle w:val="Heading${block.level}"/><w:spacing w:before="240" w:after="120"/></w:pPr>${renderRunsXml(block.inline, { bold: true, sz }, relationships)}</w:p>`;
    } else if (block.type === 'blockquote') {
      xml += `<w:p><w:pPr><w:ind w:left="720"/></w:pPr>${renderRunsXml(block.inline, { italic: true }, relationships)}</w:p>`;
    } else if (block.type === 'ul') {
      xml += block.items.map((item) =>
        `<w:p><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:r><w:t xml:space="preserve">&#8226;&#9;</w:t></w:r>${renderRunsXml(item, {}, relationships)}</w:p>`
      ).join('');
    } else if (block.type === 'ol') {
      xml += block.items.map((item, i) =>
        `<w:p><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:r><w:t xml:space="preserve">${i + 1}.&#9;</w:t></w:r>${renderRunsXml(item, {}, relationships)}</w:p>`
      ).join('');
    } else {
      xml += `<w:p>${renderRunsXml(block.inline, {}, relationships)}</w:p>`;
    }
  }
  return xml;
}

function buildDocumentXml(title, blocks) {
  const relationships = [];
  let body = '';
  if (title) {
    body += `<w:p><w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr><w:t xml:space="preserve">${xmlEscape(title)}</w:t></w:r></w:p>`;
  }
  body += renderParagraphsXml(blocks, relationships);
  body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`;
  return { xml, relationships };
}

// title: chapter title shown as a heading at the top of the document.
// markdownSource: the raw markdown text (chapter content) to render.
function markdownToDocxBuffer({ title, markdownSource }) {
  const blocks = parseMarkdown(markdownSource);
  const { xml: documentXml, relationships } = buildDocumentXml(title, blocks);
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES_XML, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(PACKAGE_RELS_XML, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(buildDocumentRelsXml(relationships), 'utf8') },
  ];
  return createZip(entries);
}

// ---------------------------------------------------------------------
// reader: word/document.xml -> markdown source string
// ---------------------------------------------------------------------
function parseRelationships(relsXml) {
  const map = {};
  if (!relsXml) return map;
  const re = /<Relationship\b([^>]*)\/>/g;
  let m;
  while ((m = re.exec(relsXml))) {
    const attrs = {};
    const attrRe = /(\w+)="([^"]*)"/g;
    let am;
    while ((am = attrRe.exec(m[1]))) attrs[am[1]] = am[2];
    if (attrs.Id && attrs.Target) map[attrs.Id] = attrs.Target;
  }
  return map;
}

function runXmlToMarkdown(runXml) {
  const rPrMatch = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(runXml);
  const rPrXml = rPrMatch ? rPrMatch[1] : '';
  const bold = /<w:b\b(?![^>]*w:val="(0|false)")[^>]*\/?>/.test(rPrXml);
  const italic = /<w:i\b(?![^>]*w:val="(0|false)")[^>]*\/?>/.test(rPrXml);
  const strike = /<w:strike\b(?![^>]*w:val="(0|false)")[^>]*\/?>/.test(rPrXml);
  const isCode = /<w:rFonts\b[^>]*w:ascii="(Consolas|Courier New|Courier)"/.test(rPrXml);

  let rawText = '';
  const tokenRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>|<w:tab\s*\/?>|<w:br\b[^>]*\/?>/g;
  let tm;
  while ((tm = tokenRe.exec(runXml))) {
    if (tm[1] !== undefined) rawText += xmlUnescape(tm[1]);
    else if (tm[0].includes('w:tab')) rawText += '\t';
    else rawText += '\n';
  }
  if (!rawText) return '';

  if (isCode) return `\`${rawText}\``;
  let out = rawText;
  if (bold && italic) out = `***${out}***`;
  else if (bold) out = `**${out}**`;
  else if (italic) out = `*${out}*`;
  if (strike) out = `~~${out}~~`;
  return out;
}

function paragraphInlineToMarkdown(contentXml, relsMap) {
  let out = '';
  const re = /<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>|<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
  let m;
  while ((m = re.exec(contentXml))) {
    if (m[1] !== undefined) {
      const idMatch = /r:id="([^"]+)"/.exec(m[1]);
      const href = idMatch ? (relsMap[idMatch[1]] || '#') : '#';
      let inner = '';
      const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
      let rm;
      while ((rm = runRe.exec(m[2]))) inner += runXmlToMarkdown(rm[1]);
      if (inner.trim()) out += `[${inner}](${href})`;
    } else {
      out += runXmlToMarkdown(m[3]);
    }
  }
  return out;
}

function docxBufferToMarkdown(buffer) {
  const files = readZip(buffer);
  const documentXml = files.get('word/document.xml');
  if (!documentXml) throw new Error('That file does not look like a valid .docx (missing word/document.xml).');
  const relsMap = parseRelationships((files.get('word/_rels/document.xml.rels') || Buffer.alloc(0)).toString('utf8'));

  const normalized = documentXml.toString('utf8').replace(/<w:p\b([^>]*)\/>/g, '<w:p$1></w:p>');
  const bodyMatch = /<w:body>([\s\S]*)<\/w:body>/.exec(normalized);
  const bodyXml = bodyMatch ? bodyMatch[1] : normalized;

  const descriptors = [];
  const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pm;
  while ((pm = pRe.exec(bodyXml))) {
    const innerXml = pm[1];
    const pPrMatch = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(innerXml);
    const pPrXml = pPrMatch ? pPrMatch[1] : '';
    const contentXml = pPrMatch ? innerXml.slice(0, pPrMatch.index) + innerXml.slice(pPrMatch.index + pPrMatch[0].length) : innerXml;
    const styleMatch = /<w:pStyle\s+w:val="([^"]+)"/.exec(pPrXml);
    const styleVal = styleMatch ? styleMatch[1] : '';

    const isHr = /<w:pBdr>[\s\S]*?<w:bottom\b/.test(pPrXml);
    const headingMatch = /heading\s*0*([1-6])/i.exec(styleVal);
    // A hanging indent (first line further left than the rest) is how both
    // our own writer and real Word mark bullet/numbered list paragraphs;
    // check it in addition to <w:numPr>/"ListParagraph" so lists exported
    // by this app round-trip correctly when re-uploaded, since our writer
    // renders list bullets as literal text rather than real w:numPr.
    const isList = /<w:numPr>/.test(pPrXml) || /ListParagraph/i.test(styleVal) || /<w:ind\b[^>]*w:hanging="\d+"/.test(pPrXml);
    const isQuote = !isList && (/quote/i.test(styleVal) || (() => {
      const indMatch = /<w:ind\b[^>]*w:left="(\d+)"/.exec(pPrXml);
      return indMatch && Number(indMatch[1]) >= 360;
    })());

    const text = paragraphInlineToMarkdown(contentXml, relsMap);

    if (isHr && !text.trim()) { descriptors.push({ type: 'hr' }); continue; }
    if (!text.trim()) continue; // skip genuinely empty paragraphs (just spacing in Word)

    if (headingMatch) descriptors.push({ type: 'heading', level: Number(headingMatch[1]), text });
    else if (isList) {
      // Strip a leading literal bullet/number marker if present (our own
      // writer emits list markers as plain text, since it doesn't use real
      // Word numbering); a no-op for genuine Word list paragraphs, whose
      // marker is generated by Word itself and isn't part of the run text.
      const stripped = text.replace(/^\s*(?:[••●◦]|\d+[.)])\s*/, '');
      descriptors.push({ type: 'ul', text: stripped || text });
    }
    else if (isQuote) descriptors.push({ type: 'blockquote', text });
    else descriptors.push({ type: 'paragraph', text });
  }

  const chunks = [];
  let i = 0;
  while (i < descriptors.length) {
    const d = descriptors[i];
    if (d.type === 'ul') {
      const items = [];
      while (i < descriptors.length && descriptors[i].type === 'ul') { items.push(`- ${descriptors[i].text}`); i++; }
      chunks.push(items.join('\n'));
      continue;
    }
    if (d.type === 'heading') chunks.push(`${'#'.repeat(d.level)} ${d.text}`);
    else if (d.type === 'blockquote') chunks.push(d.text.split('\n').map((l) => `> ${l}`).join('\n'));
    else if (d.type === 'hr') chunks.push('---');
    else chunks.push(d.text);
    i++;
  }
  return chunks.join('\n\n');
}

module.exports = { markdownToDocxBuffer, docxBufferToMarkdown };
