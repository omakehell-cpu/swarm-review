'use strict';

// A story as a PDF, laid out rather than dumped.
//
// pdfkit does the drawing; everything that makes this look like a document
// instead of a wall of text is here: where a chapter starts on its page,
// which paragraphs are indented, what a scene break looks like, what is in
// the running head, and which pages get a number.
//
// Times, Helvetica and Courier are the fonts every PDF reader already has,
// so nothing is embedded and a novel comes out at a size somebody can
// actually email. The app's own Literata would have to be converted out of
// woff2 first, and a manuscript is supposed to be in Times anyway.

const PDFDocument = require('pdfkit');
const { runsOf, plainText } = require('./typeset');

const IN = 72; // PostScript points to the inch, which is what pdfkit counts in

/**
 * @param {import('./typeset').TypesetDocument} doc
 * @returns {Promise<Buffer>}
 */
function renderPdf(doc) {
  const rules = doc.rules;
  const margin = rules.marginIn * IN;

  const pdf = new PDFDocument({
    size: 'A4',
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    // What a reader shows in its title bar and what a library files it
    // under. A key is left out entirely rather than set to undefined:
    // pdfkit walks these values to build the document id and an undefined
    // takes the whole render down.
    info: {
      Title: doc.title || 'Untitled',
      Creator: 'The Swarm Review',
      ...(doc.author ? { Author: doc.author } : {}),
    },
    autoFirstPage: false,
    bufferPages: true,
  });

  /** @type {Buffer[]} */
  const chunks = [];
  pdf.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => pdf.on('end', () => resolve(Buffer.concat(chunks))));

  const leading = rules.bodySize * rules.lineHeight;
  const bodyWidth = pdf.page ? pdf.page.width - margin * 2 : 595.28 - margin * 2;

  let firstTextPage = 0;
  const newPage = () => { pdf.addPage(); return pdf.page; };

  // Pages that actually got prose. A blank verso -- the one a book leaves
  // when a chapter has to open on the right -- should carry nothing at
  // all, and a running head on an otherwise empty page is the clearest
  // possible sign that a document was generated rather than set.
  const written = new Set();
  const markWritten = () => written.add(pdf.bufferedPageRange().count);

  const write = (runs, opts = {}) => {
    const {
      indent = 0, align = rules.justify ? 'justify' : 'left',
      size = rules.bodySize, gap = 0, font = 'Times-Roman', block = false,
    } = opts;
    pdf.font(font).fontSize(size);
    if (!runs.length) { pdf.moveDown(0.5); return; }
    markWritten();
    let started = false;
    runs.forEach((run, i) => {
      const last = i === runs.length - 1;
      let f = font;
      if (run.mono) f = 'Courier';
      else if (run.bold && run.italic) f = 'Times-BoldItalic';
      else if (run.bold) f = 'Times-Bold';
      else if (run.italic) f = 'Times-Italic';
      pdf.font(f);
      pdf.text(run.text, started ? undefined : margin + (block ? indent : 0), started ? undefined : pdf.y, {
        continued: !last,
        // Justify only what is safe to justify: a last line, and a line
        // that has to stretch two words across the page, both look worse
        // justified than ragged.
        align: last ? align : 'left',
        lineGap: leading - size,
        // pdfkit's indent is a first-line indent, which is what prose
        // wants: the rest of the paragraph returns to the margin. Shifting
        // x instead would indent the whole block, which is a quotation.
        indent: started || block ? 0 : indent,
        width: bodyWidth - (block ? indent : 0),
      });
      started = true;
    });
    if (gap) pdf.moveDown(gap);
  };

  // --- the pages themselves ---
  for (const block of doc.blocks) {
    if (block.type === 'titlePage') {
      newPage();
      markWritten();
      pdf.y = pdf.page.height / 3;
      pdf.font('Times-Bold').fontSize(rules.name === 'book' ? 26 : 18)
        .text(block.title, { align: 'center', lineGap: 6 });
      if (block.author) {
        pdf.moveDown(0.8);
        pdf.font('Times-Roman').fontSize(13).text(block.author, { align: 'center' });
      }
      if (block.blurb && rules.name === 'book') {
        pdf.moveDown(2.5);
        pdf.font('Times-Italic').fontSize(11)
          .text(block.blurb, margin + IN, pdf.y, { align: 'center', width: bodyWidth - IN * 2 });
      }
      if (rules.name === 'manuscript') {
        // Where a manuscript puts the word count and how to reach the
        // writer: bottom right, as it has been since typewriters.
        pdf.font('Times-Roman').fontSize(12)
          .text(`about ${Math.round((block.words || 0) / 100) * 100} words`,
            margin, pdf.page.height - margin - 14, { align: 'right', width: bodyWidth });
      }
      continue;
    }

    if (block.type === 'part') {
      newPage();
      if (!firstTextPage) firstTextPage = pdf.bufferedPageRange().count;
      markWritten();
      pdf.y = pdf.page.height / 3;
      pdf.font('Times-Bold').fontSize(rules.name === 'book' ? 20 : 14)
        .text(block.title, { align: 'center' });
      continue;
    }

    if (block.type === 'chapter' || block.type === 'section') {
      newPage();
      // A book opens its chapters on a right-hand page, which means a
      // blank left-hand one whenever the last chapter ended on the right.
      if (rules.chapterOpensOnRecto && pdf.bufferedPageRange().count % 2 === 1) newPage();
      if (!firstTextPage) firstTextPage = pdf.bufferedPageRange().count;
      markWritten();
      pdf.y = margin + (pdf.page.height - margin * 2) * rules.chapterDropRatio;
      if (block.heading) {
        pdf.font('Times-Roman').fontSize(rules.bodySize)
          .text(block.heading.toUpperCase(), { align: 'center', characterSpacing: 1.2 });
        pdf.moveDown(0.6);
      }
      pdf.font('Times-Bold').fontSize(rules.name === 'book' ? 16 : 12)
        .text(block.title || '', { align: 'center' });
      pdf.moveDown(rules.name === 'book' ? 2 : 1.5);
      continue;
    }

    if (!pdf.page) { newPage(); if (!firstTextPage) firstTextPage = 1; }

    if (block.type === 'sceneBreak') {
      markWritten();
      pdf.moveDown(0.6);
      pdf.font('Times-Roman').fontSize(rules.bodySize)
        .text(rules.sceneBreak, { align: 'center' });
      pdf.moveDown(0.6);
      continue;
    }

    if (block.type === 'subheading') {
      pdf.moveDown(0.8);
      write(runsOf(block.inline), { font: 'Times-Bold', size: rules.bodySize + 1, align: 'left', gap: 0.4 });
      continue;
    }

    if (block.type === 'blockquote') {
      pdf.moveDown(0.3);
      write(runsOf(block.inline || []), {
        indent: IN * 0.4, align: 'left', size: rules.bodySize - 0.5, block: true, gap: 0.5,
      });
      continue;
    }

    if (block.type === 'ul' || block.type === 'ol') {
      (block.items || []).forEach((item, i) => {
        const mark = block.type === 'ol' ? `${i + 1}.` : '\u2022';
        write([{ text: `${mark}  ` }, ...runsOf(item)], { indent: IN * 0.3, align: 'left', block: true });
      });
      pdf.moveDown(0.4);
      continue;
    }

    if (block.type === 'paragraph') {
      // Not indenting the first paragraph of a chapter or of a scene is
      // the one typesetting habit that most separates a page that was set
      // from a page that was typed.
      const indent = block.opening && !rules.indentFirstParagraph ? 0 : rules.indentEm * rules.bodySize;
      write(runsOf(block.inline), { indent });
      continue;
    }

    if (block.inline) write(runsOf(block.inline));
  }

  // --- running heads and page numbers, once every page exists ---
  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    const pageNumber = i + 1;
    // Front matter carries neither, and neither does a page nothing was
    // written on.
    if (pageNumber < firstTextPage || !firstTextPage) continue;
    if (!written.has(pageNumber)) continue;
    pdf.switchToPage(i);
    const head = rules.runningHead === 'surname'
      ? [doc.surname, doc.title, String(pageNumber - firstTextPage + 1)].filter(Boolean).join(' / ')
      : doc.title;
    pdf.font('Times-Roman').fontSize(9.5).fillColor('#444')
      .text(head, margin, margin - 20, { align: rules.runningHead === 'surname' ? 'right' : 'center', width: bodyWidth });
    if (rules.pageNumbers && rules.runningHead !== 'surname') {
      pdf.text(String(pageNumber - firstTextPage + 1), margin, pdf.page.height - margin + 14,
        { align: 'center', width: bodyWidth });
    }
    pdf.fillColor('#000');
  }

  pdf.end();
  return done;
}

module.exports = { renderPdf, IN, plainText };
