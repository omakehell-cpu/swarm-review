// lib/word-comments.js -- the notes in a Word file, and the notes on a
// chapter as Word comments.
//
// Two directions of one idea: a reader who works in Word can read the
// chapter there with everybody's notes in the margin, add their own as
// Word comments, and bring those back as notes on the chapter.
'use strict';

const path = require('path');

// jszip comes with mammoth (lib/docx.js reads Word files with it); asked
// for through mammoth so this does not depend on how npm laid things out.
const JSZip = require(require.resolve('jszip', { paths: [path.dirname(require.resolve('mammoth'))] }));

function decodeXml(text) {
  return String(text)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * The comments in a .docx: who wrote each, what it says, and the words it
 * is on (joined without breaks, the way the chapter's own text is measured
 * for anchoring notes).
 * @param {Buffer} buffer
 * @returns {Promise<Array<{ id: string, author: string, text: string, quoted: string }>>}
 */
async function readWordComments(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const commentsFile = zip.file('word/comments.xml');
  const documentFile = zip.file('word/document.xml');
  if (!commentsFile || !documentFile) return [];
  const commentsXml = await commentsFile.async('string');
  const documentXml = await documentFile.async('string');

  const found = new Map();
  const commentRe = /<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g;
  let m;
  while ((m = commentRe.exec(commentsXml))) {
    const id = (/w:id="([^"]*)"/.exec(m[1]) || [])[1];
    if (id == null) continue;
    const author = decodeXml((/w:author="([^"]*)"/.exec(m[1]) || [])[1] || '');
    const paragraphs = (m[2].match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).map((p) =>
      decodeXml((p.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
    found.set(id, { id, author, text: paragraphs.filter((p) => p.trim()).join('\n').trim(), quoted: '' });
  }

  // The document, in order: which comments are open, and the text that
  // passes while they are.
  const open = new Set();
  const tokenRe = /<w:commentRangeStart\b[^>]*w:id="([^"]*)"[^>]*\/>|<w:commentRangeEnd\b[^>]*w:id="([^"]*)"[^>]*\/>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/>/g;
  while ((m = tokenRe.exec(documentXml))) {
    if (m[1] != null) open.add(m[1]);
    else if (m[2] != null) open.delete(m[2]);
    else {
      const text = m[3] != null ? decodeXml(m[3]) : '\t';
      for (const id of open) { const c = found.get(id); if (c) c.quoted += text; }
    }
  }
  return [...found.values()].filter((c) => c.text || c.quoted);
}

const KIND_WORD = { typo: 'Typo', pacing: 'Pacing', continuity: 'Continuity', question: 'Question', praise: 'Loved this' };

/**
 * A note, as the text of the Word comment that carries it.
 * @param {any} note  a comment row, with author_name
 * @param {any[]} replies
 */
function noteAsWordText(note, replies = []) {
  const lines = [];
  const head = [KIND_WORD[note.kind], note.status && note.status !== 'pending' && note.kind !== 'praise' ? note.status : '']
    .filter(Boolean).join(', ');
  lines.push(`${head ? `[${head}] ` : ''}${note.body || (note.kind === 'praise' ? '♥' : '')}`.trim());
  if (note.suggestion != null) lines.push(`Suggested: ${note.suggestion}`);
  for (const r of replies) if (!r.deleted_at) lines.push(`${r.author_name}: ${r.body}`);
  return lines.filter(Boolean).join('\n');
}

module.exports = { noteAsWordText, readWordComments };
