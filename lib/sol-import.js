'use strict';

// lib/sol-import.js -- a StoriesOnline EPUB, read into a story.
//
// SOL's EPUBs are all built by the same generator (the "World Literature
// Company" publisher in the OPF), so they share one shape:
//
//   itscover.xhtml   the cover page (images/cover.jpg)
//   info.xhtml       title, author, description, tags, dates, status
//   <n>.xhtml ...    one file per chapter, each opening with <h2>Chapter n</h2>
//     -- or --
//   contents.xhtml   the whole story in one file, for a one-part story
//   finish.xhtml     "The End", and the story's and the author's SOL links
//
// This reads that shape and hands back plain data: the story's details and
// its chapters as Markdown. It touches no database -- routes/import.js
// shows the result for checking, and only then writes it.
//
// The chapter test does not trust the shape blindly. Several content files
// are several chapters. One file is split at its own chapter headings when
// it has them ("Chapter 3", "Part Two", "Prologue", or at least two
// headings of the same level); failing that, at paragraphs that are only
// "Chapter 3" or similar; and failing that it is one chapter.

const path = require('path');

const JSZip = require(require.resolve('jszip', { paths: [path.dirname(require.resolve('mammoth'))] }));

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', eacute: 'é' };
function decode(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENTITIES[n.toLowerCase()] !== undefined ? ENTITIES[n.toLowerCase()] : m));
}
const stripTags = (html) => decode(String(html).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** The inside of <body>, or the whole thing if there is none. */
function bodyOf(xhtml) {
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(xhtml);
  return m ? m[1] : String(xhtml);
}

// ---------------------------------------------------------------- xhtml -> md

const BLOCK = /^(p|div|h[1-6]|blockquote|li|ul|ol|hr|center|section|article|pre|table|tr)$/i;

/**
 * XHTML to Markdown, for the handful of things a story uses: paragraphs,
 * italics and bold, line breaks, scene breaks, quotes, lists and headings.
 * Everything else keeps its text and loses its markup.
 * @param {string} html
 */
function htmlToMarkdown(html) {
  const out = [];
  let line = '';
  let quote = 0;
  let opened = '';
  const listStack = [];
  const flush = () => {
    const text = line.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '  \n').trim();
    if (text) {
      const prefix = quote ? '> '.repeat(quote) : '';
      out.push(text.split('\n').map((l) => prefix + l).join('\n'));
    }
    line = '';
    opened = '';
  };
  // Emphasis hugs its words: "<i> word</i> " is " *word* ", never
  // "* word *", which Markdown would not read as emphasis at all.
  const mark = (marker, closing) => {
    if (!closing) { line += marker; opened = marker; return; }
    if (opened === marker && line.endsWith(marker)) { line = line.slice(0, -marker.length); opened = ''; return; }
    const trimmed = line.replace(/\s+$/, '');
    line = trimmed + marker + (trimmed.length < line.length ? ' ' : '');
    opened = '';
  };
  const re = /<!--[\s\S]*?-->|<(\/?)([a-z0-9]+)([^>]*?)(\/?)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[5] !== undefined) {
      let piece = decode(m[5]).replace(/\s+/g, ' ');
      if (opened && line.endsWith(opened) && /^\s/.test(piece)) {
        line = `${line.slice(0, -opened.length)} ${opened}`;
        piece = piece.replace(/^\s+/, '');
      }
      if (piece) opened = '';
      line += piece;
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const selfClosing = m[4] === '/';
    if (tag === 'br') { line += '\n'; continue; }
    if (tag === 'hr') { flush(); out.push('---'); continue; }
    if (tag === 'img' || tag === 'head' || tag === 'script' || tag === 'style') continue;
    if (tag === 'em' || tag === 'i' || tag === 'cite') { mark('*', closing); continue; }
    if (tag === 'strong' || tag === 'b') { mark('**', closing); continue; }
    if (tag === 's' || tag === 'strike' || tag === 'del') { mark('~~', closing); continue; }
    if (tag === 'blockquote') { flush(); quote += closing ? -1 : 1; quote = Math.max(0, quote); continue; }
    if (tag === 'ul' || tag === 'ol') { flush(); if (closing) listStack.pop(); else if (!selfClosing) listStack.push({ tag, n: 0 }); continue; }
    if (tag === 'li') {
      flush();
      if (!closing) {
        const list = listStack[listStack.length - 1];
        if (list) { list.n += 1; line = list.tag === 'ol' ? `${list.n}. ` : '- '; } else line = '- ';
      }
      continue;
    }
    if (/^h[1-6]$/.test(tag)) {
      flush();
      if (!closing) line = `${'#'.repeat(Math.max(2, Number(tag[1])))} `;
      continue;
    }
    if (BLOCK.test(tag)) { flush(); continue; }
  }
  flush();
  return out
    .filter((b) => b.trim())
    .join('\n\n')
    // A scene break is always its own paragraph, and never two in a row.
    .replace(/(?:\n\n---){2,}/g, '\n\n---')
    .replace(/^---\n\n|\n\n---$/g, '')
    .trim();
}

// ------------------------------------------------------------- the chapters

const CHAPTERISH = /^(chapter|part|book|prologue|epilogue|interlude|afterword|foreword|preface)\b/i;

/** Headings in a piece of XHTML, with where they sit. */
function headingsIn(html) {
  const found = [];
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html))) found.push({ level: Number(m[1]), text: stripTags(m[2]), start: m.index, end: re.lastIndex });
  return found;
}

/** A paragraph that is nothing but "Chapter 3" (or "Chapter 3: The Diner"). */
function chapterParagraphs(html) {
  const found = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = stripTags(m[1]);
    if (text.length <= 80 && /^(chapter|part)\s+([0-9]+|[ivxlc]+|[a-z]+-?[a-z]*)\b/i.test(text)) {
      found.push({ level: 0, text, start: m.index, end: re.lastIndex });
    }
  }
  return found;
}

/** Cut one file at the given markers; what comes before the first is kept with it. */
function cutAt(html, marks) {
  const chapters = [];
  marks.forEach((mark, i) => {
    const from = i === 0 ? 0 : mark.start;
    const to = i + 1 < marks.length ? marks[i + 1].start : html.length;
    const before = i === 0 ? html.slice(0, mark.start) : '';
    const body = before + html.slice(mark.end, to);
    chapters.push({ title: mark.text, html: i === 0 ? body : html.slice(mark.end, to), from });
  });
  return chapters;
}

/**
 * The chapters of one file that holds the whole story.
 * @param {string} html  the body
 * @param {string} storyTitle
 */
function splitOneFile(html, storyTitle) {
  const heads = headingsIn(html).filter((h) => !/^the end$/i.test(h.text));
  const chapterish = heads.filter((h) => CHAPTERISH.test(h.text));
  if (chapterish.length >= 1 && (chapterish.length >= 2 || chapterish[0].start < 200)) {
    return cutAt(html, chapterish);
  }
  // Two or more headings of the same level are a story's own divisions.
  const byLevel = new Map();
  for (const h of heads) byLevel.set(h.level, (byLevel.get(h.level) || []).concat(h));
  const levels = [...byLevel.entries()].filter(([, list]) => list.length >= 2).sort((a, b) => a[0] - b[0]);
  if (levels.length) return cutAt(html, levels[0][1]);
  const paras = chapterParagraphs(html);
  if (paras.length >= 2) return cutAt(html, paras);
  return [{ title: storyTitle, html }];
}

// ------------------------------------------------------------- the metadata

function infoField(info, label) {
  const re = new RegExp(`<b>\\s*${label}\\s*:?\\s*</b>\\s*:?\\s*([\\s\\S]*?)</p>`, 'i');
  const m = re.exec(info);
  return m ? stripTags(m[1]) : '';
}

function opfText(opf, tag) {
  const m = new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)</dc:${tag}>`, 'i').exec(opf);
  return m ? stripTags(m[1]) : '';
}

const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Reads a StoriesOnline EPUB.
 * @param {Buffer} buffer
 */
async function readSolEpub(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    throw Object.assign(new Error('That file is not an EPUB (it is not a zip archive).'), { userFacing: true });
  }
  const text = async (name) => (zip.file(name) ? zip.file(name).async('string') : null);
  const container = await text('META-INF/container.xml');
  const opfPath = container && (/full-path="([^"]+)"/.exec(container) || [])[1];
  const opf = opfPath && await text(opfPath);
  if (!opf) throw Object.assign(new Error('That EPUB has no package file, so its chapters cannot be found.'), { userFacing: true });
  const base = path.posix.dirname(opfPath);
  const at = (href) => (base === '.' ? href : `${base}/${href}`).replace(/#.*$/, '');

  // The manifest and the reading order.
  const items = new Map();
  for (const m of opf.matchAll(/<item\b([^>]*)\/?>/gi)) {
    const attr = (n) => (new RegExp(`${n}="([^"]*)"`).exec(m[1]) || [])[1];
    items.set(attr('id'), { href: decode(attr('href') || ''), type: attr('media-type') || '', props: attr('properties') || '' });
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/gi)].map((m) => items.get(m[1])).filter(Boolean);

  // The table of contents' names for each file, if it has them.
  const labels = new Map();
  const navItem = [...items.values()].find((i) => /\bnav\b/.test(i.props));
  const nav = navItem && await text(at(navItem.href));
  if (nav) for (const m of nav.matchAll(/<a[^>]*href="([^"#]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) labels.set(decode(m[1]), stripTags(m[2]));

  const info = await text(at('info.xhtml')) || '';
  const finish = await text(at('finish.xhtml')) || '';

  const title = opfText(opf, 'title') || stripTags((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(info) || [])[1] || '') || 'Untitled';
  const author = opfText(opf, 'creator') || stripTags(((/<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(info) || [])[1] || '').replace(/^\s*by\s+/i, '')) || 'Unknown';
  const description = infoField(info, 'Description') || opfText(opf, 'description');
  const tagLine = infoField(info, 'Tags');
  const tags = tagLine
    ? tagLine.split(',').map((t) => t.trim()).filter(Boolean)
    : [...opf.matchAll(/<dc:subject[^>]*>([\s\S]*?)<\/dc:subject>/gi)].map((m) => stripTags(m[1]));
  const series = decode((/<meta\s+name="calibre:series"\s+content="([^"]*)"/i.exec(opf) || [])[1] || '');
  const published = infoField(info, 'Published') || opfText(opf, 'date');
  const updated = infoField(info, 'Updated');
  const status = infoField(info, 'Status');
  const storyUrl = (/https?:\/\/(?:www\.)?storiesonline\.net\/s\/\d+[^"<\s]*/i.exec(finish) || [])[0] || '';
  const authorUrl = (/https?:\/\/(?:www\.)?storiesonline\.net\/a\/[^"<\s]*/i.exec(finish) || [])[0] || '';
  const authorSlug = (/\/a\/([^/"?#<\s]+)/.exec(authorUrl) || [])[1] || slugify(author);
  const solId = (/\/s\/(\d+)/.exec(storyUrl) || [])[1] || '';

  // The cover.
  let cover = null;
  const coverItem = [...items.values()].find((i) => /\bcover-image\b/.test(i.props))
    || items.get((/<meta\s+name="cover"\s+content="([^"]+)"/i.exec(opf) || [])[1]);
  if (coverItem && /^image\//.test(coverItem.type) && zip.file(at(coverItem.href))) {
    cover = { buffer: await zip.file(at(coverItem.href)).async('nodebuffer'), type: coverItem.type };
  }

  // The story's own files: the spine, less the furniture around it.
  const FURNITURE = /(^|\/)(itscover|info|finish|nav|toc|cover|titlepage|copyright)\.x?html?$/i;
  const content = spine.filter((i) => /x?html/.test(i.type) && !FURNITURE.test(i.href) && !/\bnav\b/.test(i.props));
  const docs = [];
  for (const item of content) {
    const raw = await text(at(item.href));
    if (raw) docs.push({ href: item.href, html: bodyOf(raw), label: labels.get(item.href) || '' });
  }

  let parts;
  if (docs.length > 1) {
    parts = docs.map((d, i) => {
      const first = headingsIn(d.html)[0];
      const opens = first && first.start < 200;
      return {
        title: (opens ? first.text : '') || d.label || `Chapter ${i + 1}`,
        html: opens ? d.html.slice(0, first.start) + d.html.slice(first.end) : d.html,
      };
    });
  } else if (docs.length === 1) {
    parts = splitOneFile(docs[0].html, title);
  } else {
    throw Object.assign(new Error('That EPUB has no chapters in it that could be read.'), { userFacing: true });
  }

  const chapters = parts.map((p) => {
    // SOL's own furniture inside a chapter: the copyright line, "The End".
    const html = p.html
      .replace(/<h[1-6][^>]*class="[^"]*\b(copy|end)\b[^"]*"[^>]*>[\s\S]*?<\/h[1-6]>/gi, '')
      .replace(/<h[1-6][^>]*>\s*(copyright|the end)\b[\s\S]*?<\/h[1-6]>/gi, '');
    const markdown = htmlToMarkdown(html);
    const words = (markdown.replace(/[*_~`#>-]/g, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
    return { title: p.title.replace(/\s+/g, ' ').trim().slice(0, 200) || title, markdown, words };
  }).filter((c) => c.markdown.trim());

  return {
    title, author, authorSlug, authorUrl, description, tags, series,
    published, updated, status: /complete/i.test(status) ? 'complete' : 'ongoing',
    storyUrl, solId, cover, chapters,
    words: chapters.reduce((n, c) => n + c.words, 0),
  };
}

module.exports = { htmlToMarkdown, readSolEpub, slugify, splitOneFile };
