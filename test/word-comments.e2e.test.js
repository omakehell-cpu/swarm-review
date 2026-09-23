// Notes as Word comments, and Word comments as notes
// (lib/word-comments.js, lib/docx.js, routes/chapters.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startApp, makeClient, form, multipart, multipartWithFile } = require('./helpers/app');
const { markdownToDocxBuffer } = require('../lib/docx');
const { readWordComments } = require('../lib/word-comments');

let app;
let models;
let ana;
let marta;
let chapterId;
const PASSWORD = 'a long enough password';
const TEXT = 'Kessler came up through the *service spine* at 04:20.\n\nThe drop is at six, and nobody spoke.';

test.before(async () => {
  app = await startApp();
  models = app.models;
  const auth = require('../auth');
  const invite = models.getActiveInviteCode();
  ana = makeClient(app.base);
  await ana.request('/register', {
    method: 'POST', ...form([['username', 'ana'], ['displayName', 'Ana'], ['password', PASSWORD], ['inviteCode', invite.code]]),
  });
  await ana.login('ana', PASSWORD);
  for (const u of ['luis', 'marta']) models.createUser({ username: u, displayName: u === 'luis' ? 'Luis' : 'Marta', passwordHash: auth.hashPassword(PASSWORD), isAdmin: false });
  marta = makeClient(app.base); await marta.login('marta', PASSWORD);
  await ana.request('/stories/new', { method: 'POST', ...multipart([['storyTitle', 'Anchorage'], ['chapterTitle', 'One'], ['content', TEXT]]) });
  chapterId = models.listChaptersForStory(models.listStories()[0].id)[0].id;
  const version = models.getLatestVersion(chapterId);
  const luis = models.getUserByUsername('luis').id;
  // "service spine" is inside italics: offsets 28..41 of the flattened text.
  const flat = 'Kessler came up through the service spine at 04:20.The drop is at six, and nobody spoke.';
  const at = flat.indexOf('service spine');
  const note = models.createComment({ versionId: version.id, authorId: luis, startOffset: at, endOffset: at + 13, quotedText: 'service spine', body: 'Is this a real place?', kind: 'question' });
  models.createComment({ versionId: version.id, authorId: models.getUserByUsername('ana').id, parentId: note.id, body: 'Yes, the ring’s core.' });
  models.createComment({ versionId: version.id, authorId: luis, body: 'Loved the pace overall.' });
});

test.after(() => app.stop());

test('the chapter comes out of Word with its notes as comments, on their words', async () => {
  const res = await marta.request(`/chapters/${chapterId}/download.docx?notes=1`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /with-notes\.docx/);
  const comments = await readWordComments(Buffer.from(await res.arrayBuffer()));
  const q = comments.find((c) => c.quoted === 'service spine');
  assert.ok(q, 'the anchored note is a comment on exactly its words');
  assert.strictEqual(q.author, 'Luis');
  assert.match(q.text, /^\[Question\] Is this a real place\?/);
  assert.match(q.text, /Ana: Yes, the ring/);
  const general = comments.find((c) => c.text.includes('Loved the pace'));
  assert.strictEqual(general.quoted, 'One', 'a note on the whole chapter sits on the title');
  // And the plain download still has none.
  const plain = await marta.request(`/chapters/${chapterId}/download.docx`);
  assert.deepStrictEqual(await readWordComments(Buffer.from(await plain.arrayBuffer())), []);
});

test('Word comments come back as notes, and this site’s own are not doubled', async () => {
  const downloaded = Buffer.from(await (await marta.request(`/chapters/${chapterId}/download.docx?notes=1`)).arrayBuffer());
  const before = models.listCommentsForVersion(models.getLatestVersion(chapterId).id).length;
  const same = await marta.request(`/chapters/${chapterId}/notes-from-word`, {
    method: 'POST', ...multipartWithFile([], { name: 'file', filename: 'one.docx', body: downloaded }),
  });
  assert.match(decodeURIComponent(same.headers.get('location')), /no comments that are not already here/);
  assert.strictEqual(models.listCommentsForVersion(models.getLatestVersion(chapterId).id).length, before);

  // Marta's own comments, made in Word: one on words still there, one on
  // words that are not.
  const hers = await markdownToDocxBuffer({
    title: 'One',
    markdownSource: `${TEXT}\n\nA line she added.`,
    notes: [
      { start: 51, end: 69, author: 'Marta', text: 'Why six?' },
      { start: 88, end: 105, author: 'Marta', text: 'Cut this.' },
    ],
  });
  const res = await marta.request(`/chapters/${chapterId}/notes-from-word`, {
    method: 'POST', ...multipartWithFile([], { name: 'file', filename: 'hers.docx', body: hers }),
  });
  assert.match(decodeURIComponent(res.headers.get('location')), /2 notes added from Word; 1 on the chapter as a whole/);
  const notes = models.listCommentsForVersion(models.getLatestVersion(chapterId).id).filter((c) => c.author_name === 'Marta');
  const placed = notes.find((c) => c.body === 'Why six?');
  assert.ok(placed && placed.start_offset === 51 && placed.quoted_text === 'The drop is at six', 'anchored on the same words');
  const loose = notes.find((c) => c.body.includes('Cut this.'));
  assert.strictEqual(loose.start_offset, null);
  assert.match(loose.body, /On “A line she added\.”: Cut this\./);
});

test('the chapter page offers both', async () => {
  const html = await (await marta.request(`/chapters/${chapterId}`)).text();
  assert.match(html, /download\.docx\?v=1&amp;notes=1">Word, with the notes as comments/);
  assert.match(html, /action="\/chapters\/\d+\/notes-from-word"/);
});
