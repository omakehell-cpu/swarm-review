# Swarm Review

A self-hosted archive for one shared-universe writing group: a place to
write chapters, to read each other's, and to leave the kind of note the
author can act on. It also keeps a local copy of the group's wiki, and
takes in stories published elsewhere so that everything the group has
written is in one place.

Everything in it is plain: chapters are Markdown, notes are anchored to
the passage they are about, and every version ever saved stays where it
was with its notes still on it. There is no email, no notification
service, no account it talks to. One process, one SQLite file, one
machine.

## What it needs to run

Almost nothing. The web server, the database, the sessions, the Markdown
and the file uploads are all Node.js built-ins -- including SQLite itself,
via `node:sqlite`. There is no build step, no bundler and no framework.

Four libraries are the exception, and each one is there because writing
it by hand would have been worse:

| package | what it does |
| --- | --- |
| `markdown-it` | parses the Markdown a chapter is written in. It replaced a hand-written parser that made `file_name_here` italic, had no escape syntax, and couldn't see an indented list at all. |
| `mammoth` | reads an uploaded `.docx`. Word's file format is genuinely complicated -- real numbering, styles, footnotes -- and the hand-written reader this replaced quietly lost most of it. |
| `docx` | writes the `.docx` you get from a download link, as a document Word will edit further rather than a flat approximation of one. |
| `pdfkit` | draws the PDF a story compiles to. The alternative was writing a line breaker. |

Nothing else was worth its weight. The writing checks were the obvious
candidate -- `compromise` can conjugate an irregular verb, which is what
turning a passive round needs -- but it is 352KB in every reader's browser
and the only thing needed from it is a table of 138 irregular participles.
That table is 2.7KB and is inlined in `public/js/writing-analyzer.js`,
taken from [english-verbs-irregular](https://www.npmjs.com/package/english-verbs-irregular)
(Apache-2.0, part of RosaeNLG). The EPUB is written by hand, including its
zip, in ninety lines (`lib/epub.js`, `lib/zip.js`): an EPUB is a zip of
five XML files, and a library for that would have cost more than it saved.

So a fresh copy does need one `npm install` before it will start. The
development tools under [Checking your work](#checking-your-work) come
down with it and the server never loads them; `npm install --omit=dev`
skips them if you'd rather not have them on the server.

**Requirement: Node.js >= 22.5.0** (built-in SQLite support). Check with
`node -v`.

## Running it

```bash
npm install     # once, and again after pulling changes
node server.js
```

Then open `http://localhost:3000`. The first account you register becomes
the admin -- that's the account that gets the "Admin" link in the top nav
and access to `/admin`.

On first run the app auto-generates an invite code (printed to the
console at startup) and a session-signing secret, both stored in the
`data/` folder so they survive restarts. You can also set `PORT` and
`SESSION_SECRET` yourself, either as environment variables or in a `.env`
file (see `.env.example`).

Everything the group has written lives in `data/`: the SQLite database at
`data/swarm-review.sqlite`, the pictures uploaded to bible entries in
`data/entity-images/`, and the nightly copies in `data/backups/`. Back up
that folder and you have the whole site. **One writer at a time, on the
machine the file is on** -- see `docs/DATABASE.md` before you touch the
database by hand.

## How it works

### Writing

- **Stories, chapters, versions.** A story is the container; an author
  starts one with its first chapter and adds more over time. Saving an
  edit publishes a new version automatically, but only if the text
  actually changed -- fixing a title does not. Every past version stays,
  with the notes that were made on it, reachable from the **Version**
  dropdown on the chapter page. `/chapters/:id/diff` shows what changed
  between any two, paragraph by paragraph and then word by word.
- **Markdown**, in a small subset: `**bold**`, `*italic*`, `~~strike~~`,
  `` `code` ``, `[link](url)`, `# headings`, `> quotes`, `---` for a scene
  break, `-`/`1.` lists. Unlike strict Markdown, a single line break is
  kept as you typed it -- friendlier for pasted prose. `\*` escapes.
- **The writing checks** run in the editor as you type: long and dense
  sentences, passive voice, adverbs propping up a verb, filler, complex
  words, repeated words, filter verbs, said-bookisms, repeated openings,
  and a spellchecker that knows the story's own invented names. Each can
  be switched off on its own, and where there is an honest rewrite the
  check **proposes it** rather than only complaining. Beside the word
  count is the **reading grade**. All of it runs in a worker, in the
  reader's own browser; nothing is sent anywhere.
- **The desk.** Scene notes and snapshots belong to the chapter's author:
  a snapshot is a copy of the text kept under a name, to compare against
  or go back to, without publishing a version for everybody to see.
- **Not losing work.** A draft is kept on the server as you write, so one
  started on a phone is there on the laptop, and the browser keeps its own
  copy as well. Saving asks nothing; closing the tab on unsaved writing
  asks.
- **Replacing a chapter with a file** you wrote somewhere else -- `.md`,
  `.txt` or `.docx` -- publishes it as the next version, from a control
  under the text box with its own button and its own question.
- **The outline** lists every chapter on one line with the things you sort
  a draft by (summary, point of view, strand, state), draggable to
  reorder. **Analysis** counts the same draft: words per chapter and per
  arc, who the story is told through, which threads carry it, what was
  written week by week, who is in what. **The timeline** puts the chapters
  on the story's own calendar rather than in the order they are told; the
  whole story is dated from one form there (a day can be written as "+1"
  from the row above), and a **pin** on a paragraph marks where the time
  moves inside a chapter.
- **The plan** is the scaffold, for the people writing the story: its
  arcs, nested as deep as it is built, each saying what happens, what is
  different at the end and why it matters -- and chapters planned but not
  written, which **Write it** turns into chapters in their planned place,
  in any order. The top level is still the *Arc* on a chapter.
- **Split or merge**: a chapter cut in two at a paragraph, or the next one
  folded in, with the waiting notes going with their words.
- **Leave dialogue alone**: a switch that stops the writing checks marking
  anything inside quotation marks except spelling.

### Reviewing

- **Notes on a passage.** Select text in a chapter and leave a note
  anchored to exactly those words -- it shows as a highlight and as a card
  in the margin. Selection works against the rendered text, so a note can
  span bold and italic and still land. `C` does it from the keyboard.
- **What kind of note it is**, in one word: a plain note, a typo, pacing,
  continuity, a question, or praise. A label, not a workflow: every kind
  is answered the same way, except praise, which asks nothing of the
  author.
- **A rewrite, offered rather than described.** A reviewer can suggest the
  replacement text for the passage they quoted; accepting it puts it into
  the chapter.
- **Accept, turn down, retract, reopen, reply** -- all in place, without
  losing your position on a chapter with forty notes. A note follows its
  passage into the next version where the passage can still be found.
- **Reactions** mark a paragraph as *hooked*, *lost*, *slow* or
  *unconvinced* -- one click, for the things a note is too much for.
- **@names** in a note reach the person named, and the editor offers the
  names as you type one.
- **Asking for a read**: the author asks particular people to read a
  chapter, with a question if they have one, and it waits on the front
  page of whoever was asked until they have been.

### Reading

- **Read or Review.** Read mode is the chapter and nothing else -- no
  highlights, no margin. **Aa** sets the type size, measure and line
  spacing, and **Fill screen** takes the rest of the page away. All of it
  follows you between devices.
- **A name you do not remember** -- a character from the bible, a page
  from the glossary -- opens beside the chapter when you click it, with
  its picture if it has one, and the name on the card is the way on to the
  entry itself.
- **The front page** is what the group is doing: what is being written,
  what is waiting for a read, what you were in the middle of, and the
  shelves (being written, complete, set aside). You can **follow** a story
  to keep it in front of you.
- **Your own feed**, as Atom, for a reader that checks on your behalf. It
  is off until you ask for one, and its address is a secret.

### Story notes and the glossary

- **Story notes** (it was called the story bible, and still is in the
  code, the URLs and the tables) are who and what is in a story: people, places,
  ships, whatever the story needs, with a picture, aliases, custom fields,
  who knows whom, and which chapters each one turns up in -- worked out by
  reading the chapters rather than ticked by hand. A bible can be kept
  private to the people who write the story.
- Names from the story notes are **linked in the prose**, and so are names from
  the shared wiki. A reader who would rather have plain prose turns them
  off once, in Account.
- **The glossary** is a full local mirror of the group's wiki
  (`WIKI_BASE_URL`, default `https://swarmwiki.tampaad.net`): every page's
  content, rendered from its wikitext, with the links between pages kept
  inside the app where the page exists here and falling back to the wiki
  where it does not. It is the one thing in the app that ever talks to
  another machine, and only when an admin presses **Sync wiki now**.

### Bringing work in, and taking it out

- **In**: a chapter from `.md`, `.txt` or `.docx`; a whole shelf of
  StoriesOnline EPUBs at once, from `/admin/import` or from a folder on
  the server, with their tags mapped onto this app's own; the notes
  somebody left in a Word file, read back as notes on the chapter.
- **Out**: a chapter as `.md`, `.txt` or `.docx` -- with the chapter's
  notes as real Word comments, if you want them. A whole story as
  **`.pdf`** or **`.epub`**, as well as `.docx`, `.md` and `.txt`.
- The PDF is typeset rather than printed from a web page, in one of two
  layouts: **manuscript** (double-spaced, ragged right, running heads --
  what a competition asks for) or **book** (justified, chapters opening on
  the right, typographic quotes). Both read the same document model
  (`lib/typeset.js`), so they cannot disagree about what a scene break is,
  and the same story compiles to the same bytes twice.

### Finding things

- **Search** is SQLite's FTS5 over chapters, stories, bible entries and
  the glossary: whole words, `"exact phrases"`, half-typed names, accents
  folded, best first, each hit with the line it was found in.
- **/find** is the advanced one, with the questions a group actually
  asks: by author, by tag, by where a story stands, by length, by series,
  by words in the text, and only the ones you follow.
- **Tags** come from a list an admin curates, grouped the way
  StoriesOnline groups them; an author can propose one while tagging a
  story, and it works immediately and waits in a queue to be approved.
  Anyone can hide tags they would rather not see.
- **/help** is this app explaining itself, and **/help/changelog** is what
  changed and when. Both are the markdown files in `docs/`, rendered by
  the app -- there is no copy of them in a table to drift.

## Three names, and which is which

Worth knowing apart, because only one of them is anybody else's business:

- **Your name** is what the group reads: the byline on a chapter, the name
  above a note. Changeable whenever you like, everywhere at once.
- **Your handle** is the `@luis` a note calls you by and the address of
  your page (`/users/luis`). It does not move: everything written about
  you, and every link to your page, is made of it.
- **The name you sign in with** is what you type into the login box and
  nothing else. Yours alone, and changeable in Account with your password
  beside it.

All three start out as the name you registered with.

## Coauthors

A story belongs to the person who started it. From the story's page they
can add anyone else in the group as a **coauthor**, and a coauthor can:

- add chapters to that story
- edit the chapters they wrote themselves
- use and add to the story's dictionary (the universe's proper nouns,
  which the spellchecker needs)

A coauthor cannot rewrite a chapter somebody else wrote, edit the story's
details or tags, reorder its chapters, archive it or delete it. Those stay
with the owner, and being a site admin does not change any of it -- admins
run the site, they don't get a key to everyone's drafts.

Either side can end it: the owner can remove a coauthor, and a coauthor
can step back on their own. Either way the chapters they already wrote
stay theirs -- their name is on them and they can still edit them. This is
a writing group, not a permissions system, and quietly reassigning
somebody's prose because they left a story would be the wrong thing to do.

## Archiving, and deleting

Stories and chapters can be **archived** by their author: out of the way,
not lost, readable, with their notes, and back with one click. Permanent
deletion is only offered from the archived list, never on an active item
-- you have to archive something, look at it again, and only then delete
it for good. That one is a real SQL delete: there is no trash behind it.

A deleted **account** is different: their stories, chapters and notes are
not deleted with them. They are re-credited to a placeholder "Deleted
user", because the group should not lose a discussion because somebody
left.

## Admin & account security

- **Invite codes** are single-use. The admin generates one from `/admin`
  and shares it with the one person about to register; it stops working
  the moment it is used, replaced, or registration is closed. A code can
  also be **made out to one name**, so it is no use to anybody else.
- **Account lockout** after three wrong passwords, until an admin
  reactivates it. An admin can also lock an account by hand, and that
  takes effect on the locked person's very next request, not their next
  login.
- **Password resets** are a single-use link, good for 24 hours, that the
  admin generates and the person uses to choose their own password. There
  is no email here, so this is how a forgotten password gets fixed; the
  admin never sees or sets it, and the link can be revoked before use.
- **Changing a password signs out every other session** -- a token
  carries the version it was issued under, and changing the password
  moves it.
- **Every form carries a CSRF token**, added to the form by the layout and
  checked before anything is written.
- **Backups happen by themselves**, daily into `data/backups/`, keeping
  the last fortnight, plus "take one now" on `/admin`. A copy can also be
  **restored from the admin page**, which names the file and its date,
  takes a copy of the current database first, and refuses while anybody
  else is writing.
- **The log rotates itself**, so `server.log` does not grow for ever under
  a service that never closes it.

## Deployment

This is live: it runs on a Mac mini, kept running by two `launchd`
services (`com.swarmreview.server` for the app itself,
`com.swarmreview.tunnel` for the tunnel below) that start automatically on
boot and restart the process if it ever crashes -- see
**`SETUP-MAC-MINI.md`** for the plist files and the `launchctl` commands
to check on, restart or stop either one.

It's reachable from anywhere at **https://swarmarchive.com**, via a
Cloudflare Tunnel (no router configuration or open ports) -- see
**`SETUP-DOMAIN.md`** for exactly how that's wired up, in case it ever
needs to move to a different machine or the tunnel needs recreating.

If you're setting this up fresh somewhere else (a different machine, or
just running it locally to try it out): install Node.js 22+
(`brew install node` on macOS, or an LTS installer from nodejs.org
elsewhere), copy this folder over, and run `node server.js` -- see
**`SETUP-MAC-MINI.md`** (Part 1) or **`SETUP-WINDOWS.md`** for a more
step-by-step walkthrough. A Docker option (`docker compose up -d --build`,
using the included `Dockerfile` and `docker-compose.yml`) is there if
you'd rather have it in a container; the SQLite database lives in a
mounted `./data` folder next to the compose file either way, so
`docker compose down` / `up` again doesn't lose data.

## Project layout

```
server.js        entry point: the HTTP server and one routing table
db.js            the schema, in SQLite (node:sqlite), migrations and all
db-review.js     the schema for the review loop, applied by db.js
db-plan.js       the schema for the plan: arcs, planned chapters, pins
auth.js          password hashing, session cookies, invite codes
routes/          one file per area; each exports a table of routes
models/          the queries, one file per area, behind models.js
views/           server-rendered HTML, one file per area, behind views.js
lib/             everything that is neither a route, a query nor a page:
                   markdown.js    markdown + offset-aware highlighting
                   typeset.js     the document a story compiles to
                   pdf.js         that document, drawn (pdfkit)
                   epub.js zip.js that document, as an EPUB, by hand
                   docx.js        Word in and out
                   word-comments  notes as Word comments, both ways
                   sol-import.js  a StoriesOnline EPUB, read into a story
                   wiki.js        the glossary's local mirror of the wiki
                   story-bible.js who is in what, worked out from the text
                   search-query   what somebody typed, as an FTS5 query
                   diff.js        two versions, compared
                   suggestions.js a reviewer's rewrite, put into the text
                   backup.js logrotate.js csrf.js feed.js ...
public/           the browser's share: CSS, and one small script per job
docs/             help/, CHANGELOG.md, TODO.md, DATABASE.md, accessibility/
scripts/          things run by hand: imports, a11y audit, rebuild-archive
test/             the suite (Node's own runner; see below)
types.d.ts        declarations for the checker, never loaded by the app
data/             created at runtime: the database, secrets, pictures, backups
```

`models.js` and `views.js` still exist and still export what they always
did; each is now a barrel over its folder, and a test fails the moment two
files inside one of them export the same name.

## Checking your work

```
npm install     # the runtime libraries, plus the dev tools below
npm run check   # lint, then types, then tests
```

| command | what it does |
| --- | --- |
| `npm run lint` | ESLint. Mostly there for `no-undef`, which catches a name that doesn't exist -- the mistake that breaks a rarely-taken branch of the browser code and shows up weeks later as "the editor stopped working for me". |
| `npm run typecheck` | TypeScript reading the plain `.js` files (`checkJs`), no compile step and no conversion. It honours JSDoc where it exists and infers the rest. `strict` is off on purpose: see the comment at the top of `tsconfig.json`. |
| `npm test` | Node's built-in test runner over `test/`: 46 files, and rather more tests than that. |
| `npm run a11y` | walks the pages with an audit of its own (`scripts/a11y-audit.js`) -- see `docs/accessibility/`. |

The suite is weighted towards the things that have actually gone wrong:

- `test/markdown-anchoring.test.js` -- comment offsets are counted against
  the text with the markdown stripped out. Read this before replacing the
  markdown renderer with a library: a renderer that emits the same HTML
  but counts characters differently would slide every existing note in the
  archive off its quote.
- `test/form-parsing.test.js` -- a form field sent more than once (a row of
  tag checkboxes) must arrive as all of its values. It once arrived as the
  last one only, so eight ticked tags saved as one, with nothing thrown and
  nothing logged.
- `test/comment-actions.test.js` -- `new FormData(form)` does not include
  the button that submitted it, so Accept and Reject posted nothing at all.
  Found by driving a real browser and looking at what arrived.
- `test/every-page.e2e.test.js` -- opens every page in the app once. A
  route that calls a model by a name it does not export looks fine in every
  unit test around it and throws the moment somebody opens the page.
- `test/typeset.test.js` -- the two layouts really are two layouts, and the
  book is the shorter document. It was not: a folio written below the
  bottom margin made pdfkit start a new page for every page it stamped.
- `test/structure.test.js` -- the barrels export what the app asks them
  for, and no two modules fight over one name.
- `test/server.e2e.test.js` -- a throwaway database, the real `node
  server.js` in a child process, and an HTTP client doing what a browser
  does: register, log in, post a story, edit a chapter, read the diff,
  search, log out.

**A test never touches `data/swarm-review.sqlite`.** `test/helpers/tmpdb.js`
gives each run its own file, and `db.js` refuses to open the real one from
inside a test process at all -- it throws rather than obeys. That guard
exists because a test file once required a library at the top that pulled
`db.js` in before its own setup ran, and the suite emptied the live
glossary into a fixture.

To have all three run before every commit, enable the hook once per clone:

```
git config core.hooksPath .githooks
```

It takes about a second and a half, steps aside if `node_modules` isn't
installed, and `git commit --no-verify` skips it when you need it to.

## Known limitations / ideas for later

- **No email at all**, by choice: no notifications, and no "forgot my
  password" that does not go through an admin. The feed and the front page
  are how you find out something is waiting. `docs/TODO.md` records what
  the shape would be if it ever comes back, and why it is not worth it
  here.
- **`.docx` is good, not lossless**, because a chapter is stored as
  Markdown and Markdown has less in it than Word does. Headings, bold,
  italic, strikethrough, links, inline code, blockquotes and both kinds of
  list survive in both directions. Images are dropped. A table keeps its
  text, one row per line, but stops being a table.
- **The glossary is a copy**, synced by hand. It is never fetched while
  somebody is reading, which is the point, but it is as old as the last
  time an admin pressed the button.
- **Deleting for good is for good** -- the archive step is the only undo.
- The rest is in `docs/TODO.md`, with what each thing would cost and what
  it would touch.
