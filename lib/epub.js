'use strict';

// A story as an EPUB 3, written by hand.
//
// An EPUB is a zip of XHTML with two bits of metadata pointing at it, and
// the alternative was a dependency to produce four small files. It is
// built from the same typeset document the PDF uses (lib/typeset.js), so
// the two agree about what a scene break is and where a chapter starts --
// which they did not when each one re-parsed a string of markdown and
// guessed.
//
// What a reader sees is not a page here: an e-reader sets its own type at
// its own size, and the right thing to do is to say as little as possible
// about that. So the stylesheet controls only what belongs to the book and
// not to the reader -- indents, the shape of a chapter opening, the scene
// break -- and never the typeface or the size.

const { zip } = require('./zip');
const { runsOf, plainText } = require('./typeset');

const escapeXml = (value) => String(value === null || value === undefined ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function inlineHtml(inline) {
  return runsOf(inline).map((run) => {
    let text = escapeXml(run.text);
    if (run.mono) text = `<code>${text}</code>`;
    if (run.italic) text = `<em>${text}</em>`;
    if (run.bold) text = `<strong>${text}</strong>`;
    if (run.href) text = `<a href="${escapeXml(run.href)}">${text}</a>`;
    return text;
  }).join('');
}

const page = (title, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>
`;

// Chapter bodies, one file each: an e-reader turns pages inside a file and
// jumps between them, so a chapter per file is what makes "next chapter"
// mean anything and keeps a long book from being one enormous document.
function chapterFiles(doc) {
  const files = [];
  let current = null;
  const open = (id, title, heading, kind) => {
    current = { id, title, heading, kind, parts: [] };
    files.push(current);
  };

  for (const block of doc.blocks) {
    if (block.type === 'titlePage') continue; // its own file, built below
    if (block.type === 'part') {
      open(`part${files.length + 1}`, block.title, '', 'part');
      continue;
    }
    if (block.type === 'chapter' || block.type === 'section') {
      open(`ch${files.length + 1}`, block.title || block.heading, block.heading, 'chapter');
      continue;
    }
    if (!current) open('ch0', doc.title, '', 'chapter');

    if (block.type === 'sceneBreak') {
      current.parts.push(`<p class="scene">${escapeXml(doc.rules.sceneBreak)}</p>`);
      continue;
    }
    if (block.type === 'subheading') {
      const level = Math.min(6, Math.max(2, (block.level || 2) + 1));
      current.parts.push(`<h${level}>${inlineHtml(block.inline)}</h${level}>`);
      continue;
    }
    if (block.type === 'blockquote') {
      current.parts.push(`<blockquote><p>${inlineHtml(block.inline)}</p></blockquote>`);
      continue;
    }
    if (block.type === 'ul' || block.type === 'ol') {
      const tag = block.type;
      current.parts.push(`<${tag}>${(block.items || []).map((i) => `<li>${inlineHtml(i)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (block.type === 'paragraph') {
      current.parts.push(`<p${block.opening ? ' class="opening"' : ''}>${inlineHtml(block.inline)}</p>`);
      continue;
    }
    if (block.inline) current.parts.push(`<p>${inlineHtml(block.inline)}</p>`);
  }

  return files.map((file) => ({
    ...file,
    href: `${file.id}.xhtml`,
    xhtml: page(file.title, file.kind === 'part'
      ? `<section class="part" epub:type="part"><h1>${escapeXml(file.title)}</h1></section>`
      : `<section epub:type="chapter">
${file.heading ? `<p class="chapter-number">${escapeXml(file.heading)}</p>` : ''}
<h1>${escapeXml(file.title)}</h1>
${file.parts.join('\n')}
</section>`),
  }));
}

const STYLE = `/* Only what belongs to the book. The typeface, the size and the
   margins belong to whoever is reading, and an EPUB that argues with them
   is an EPUB somebody turns off. */
body { margin: 0; }
h1 { font-size: 1.35em; font-weight: bold; text-align: center; margin: 0 0 1.6em; }
.part h1 { margin-top: 35%; font-size: 1.6em; }
.chapter-number {
  text-align: center; margin: 0 0 0.4em;
  font-size: 0.8em; letter-spacing: 0.14em; text-transform: uppercase;
}
p { margin: 0; text-indent: 1.2em; text-align: justify; }
p.opening { text-indent: 0; }
p.scene { text-indent: 0; text-align: center; margin: 1.2em 0; }
blockquote { margin: 1em 2em; }
blockquote p { text-indent: 0; }
ul, ol { margin: 1em 0 1em 2em; }
li { margin: 0.2em 0; }
.title-page { text-align: center; margin-top: 30%; }
.title-page h1 { font-size: 1.8em; }
.title-page .author { margin: 1.2em 0 0; text-indent: 0; }
.title-page .blurb { margin: 2.5em 1.5em 0; text-indent: 0; font-style: italic; }
`;

/**
 * @param {import('./typeset').TypesetDocument} doc
 * @param {{ identifier?: string, language?: string, modified?: string }} [opts]
 * @returns {Buffer}
 */
function renderEpub(doc, opts = {}) {
  const {
    identifier = `urn:uuid:swarm-${Buffer.from(doc.title || 'story').toString('hex').slice(0, 24)}`,
    language = 'en',
    // Fixed unless a caller says otherwise, so the same story compiled
    // twice is the same file.
    modified = '2026-01-01T00:00:00Z',
  } = opts;

  const front = doc.blocks.find((b) => b.type === 'titlePage');
  const chapters = chapterFiles(doc);
  const files = [];

  if (front) {
    files.push({
      id: 'titlepage',
      href: 'titlepage.xhtml',
      title: front.title,
      kind: 'front',
      xhtml: page(front.title, `<section class="title-page" epub:type="titlepage">
<h1>${escapeXml(front.title)}</h1>
${front.author ? `<p class="author">${escapeXml(front.author)}</p>` : ''}
${front.blurb ? `<p class="blurb">${escapeXml(front.blurb)}</p>` : ''}
</section>`),
    });
  }
  files.push(...chapters);

  const manifest = files
    .map((f) => `    <item id="${f.id}" href="${f.href}" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const spine = files.map((f) => `    <itemref idref="${f.id}"/>`).join('\n');

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(doc.title)}</dc:title>
    <dc:language>${escapeXml(language)}</dc:language>
${doc.author ? `    <dc:creator>${escapeXml(doc.author)}</dc:creator>\n` : ''}    <meta property="dcterms:modified">${escapeXml(modified)}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifest}
  </manifest>
  <spine>
${spine}
  </spine>
</package>
`;

  const nav = page('Contents', `<nav epub:type="toc" id="toc">
<h1>Contents</h1>
<ol>
${files.filter((f) => f.kind !== 'front').map((f) => `<li><a href="${f.href}">${escapeXml(f.heading ? `${f.heading}: ${f.title}` : f.title)}</a></li>`).join('\n')}
</ol>
</nav>`);

  return zip([
    // First, and stored: the specification says so, and a reader that
    // sniffs the file looks exactly there.
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    {
      name: 'META-INF/container.xml',
      data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
    },
    { name: 'OEBPS/package.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    { name: 'OEBPS/style.css', data: STYLE },
    ...files.map((f) => ({ name: `OEBPS/${f.href}`, data: f.xhtml })),
  ]);
}

module.exports = { renderEpub, escapeXml, plainText };
