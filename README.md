# Swarm Review

A small self-hosted web app for a shared-universe writing group: authors
organize their work into stories, each made up of chapters written in
Markdown. Everyone else selects passages of text and leaves inline
comments (like Google Docs suggestions), and the chapter's author accepts
or rejects each comment. Authors can upload multiple revised versions of
the same chapter; older versions and their comments stay around for
reference.

## Why it has zero dependencies

This app is built entirely on Node.js's own built-ins — including its
built-in SQLite module (`node:sqlite`) — so there is **no `npm install`
step and nothing to download**. That makes it trivial to self-host: copy
the folder to a machine with a recent Node.js and run it.

**Requirement: Node.js >= 22.5.0** (built-in SQLite support). Check with
`node -v`. Node 22 LTS or newer works well.

## Running it

```bash
node server.js
```

Then open `http://localhost:3000`. The first account you register becomes
the admin — that's the account that gets the "Admin" link in the top nav
and access to `/admin` (see below).

On first run the app auto-generates an invite code (printed to the
console at startup) and a session-signing secret, both stored in the
`data/` folder so they survive restarts. You can also set `PORT` and
`SESSION_SECRET` yourself, either as environment variables or in a `.env`
file (see `.env.example`).

All data (accounts, stories, chapters, versions, comments, invite codes)
lives in a single SQLite file at `data/swarm-review.sqlite`. Back that
file up and you have the whole site.

## How it works

- **Stories & chapters** — a story is the container (title + description)
  for a piece of writing; an author starts one with its first chapter and
  adds more chapters to it over time. Only the story's original author can
  add chapters to it or edit its chapters.
- **Markdown** — chapter text is written in a small Markdown subset:
  `**bold**`, `*italic*`, `***both***`, `~~strikethrough~~`, `` `code` ``,
  `[link](url)`, `# Headings`, `> quotes`, `---` for a scene break, and
  `-`/`1.` lists. Unlike strict Markdown, single line breaks are kept as
  you typed them (no need for a blank line between every line) — friendlier
  for pasted prose. See `lib/markdown.js`.
- **Editing a chapter** — the chapter's author can click "Edit chapter" at
  any time to change its title, summary, and the text itself, the same way
  you'd edit any document. Behind the scenes, saving publishes the edited
  text as a new version automatically (only if the text actually changed;
  an edit that only touches the title/summary doesn't create one). This
  keeps every past version, and any comments already anchored to them, on
  record — reviewers can always go back and see exactly what a comment was
  originally about via the "Version" dropdown on the chapter page.
- **Inline comments** — any logged-in user selects a piece of text in the
  chapter (this works against the rendered Markdown, so a selection can
  span across bold/italic text and still anchors correctly) and leaves a
  comment anchored to that exact passage; it shows up as a highlight in
  the text and a matching card in the sidebar. You can also leave a
  general comment not tied to any specific passage.
- **Accept / reject** — only the chapter's author can mark a comment as
  accepted or rejected, from the comment card in the sidebar. Anyone can
  reply to a comment thread.
- Comments are attached to one specific version. When the author uploads
  a new version, previous comments stay on the old version (as a record
  of what was discussed) and the new version starts with a clean slate.
- **Archiving & deleting** — stories and chapters can be archived (hidden
  from the main lists, but not lost) by their author, from a button on the
  story/chapter page. An archived item can be unarchived at any time from
  its "Archived stories" / "Archived chapters" list. Permanent deletion is
  only offered from that archived list (never on an active item), as a
  safety gate against one-click data loss — you have to archive something
  first, look at it again on the archived list, and only then delete it
  forever. Deleting a story or chapter forever also removes its chapters/
  versions/comments with it.
- **Comment edit / retract / reopen** — the author of a comment (or reply)
  can edit its text at any time (an "(edited)" tag shows it was changed),
  or retract it, which keeps the thread intact but shows "[retracted]"
  instead of the text. If the chapter's author accepted or rejected a
  comment by mistake, they can hit "Reopen" to put it back to pending.
- **Timestamps** — every story, chapter, version, and comment shows when
  it was created (and comments show when edited). Server-rendered in UTC
  so it works even without JavaScript, then upgraded in the browser to a
  relative time ("3h ago") or your local time/timezone once the page
  loads (`lib/time.js` + `public/js/timestamps.js`).
- **"What's new" indicator** — no email notifications, but the dashboard
  and each story page mark chapters published (and stories with new
  chapters) since your last visit with a "New" badge, and a chapter with
  new comments since then gets a "New comments" badge. This updates
  automatically every time you load the dashboard — no setup needed.
- **File upload/download** — anywhere there's a chapter-text box (new
  story, add chapter, edit chapter), you can either paste text or upload a
  `.md`, `.txt`, or `.docx` file instead, which replaces whatever's in the
  box. `.docx` is read by pulling out its paragraphs/formatting (bold,
  italic, strikethrough, headings, bullet lists, blockquote-style
  paragraphs, hyperlinks) and converting them into this app's Markdown.
  From any chapter page you can also download the version you're viewing
  as `.md` (the raw Markdown source), `.txt` (clean plain text, Markdown
  syntax stripped), or `.docx` (a real, independently-verified Word
  document with actual bold/italic/headings/etc., not just formatted
  text pasted in). Both directions (`lib/docx.js`) are hand-written
  against the raw OOXML/zip format with no external library, matching the
  rest of the app's zero-dependency approach; it covers the Markdown
  subset this app supports well, but isn't a general-purpose Word
  converter -- see the limitations below.
- **Wiki linking** — character/place/ship names recognized from the
  shared-universe wiki (`WIKI_BASE_URL`, default `https://tampaad.net`)
  get auto-linked in chapter text, with a hover preview of that page's
  summary. Backed by a local cache (`lib/wiki.js`) refreshed once a day
  automatically, or on demand from `/admin` -- rendering a chapter never
  makes a live request to the wiki itself. Readers can turn it off with
  the "Wiki links" toggle on the chapter page if it's more noise than
  help for a given story.

## Admin & account security

- **Invite codes** are single-use now, not a shared static password. The
  admin generates one from `/admin`, shares it with exactly the one person
  who's about to register, and it stops working the moment either that
  person registers with it, or the admin generates a new one (which
  invalidates whatever code was active before), or the admin hits "Close
  registration" (deactivates the current code without creating a new one
  — nobody can register at all until a fresh code is generated). The admin
  panel always shows the current active code, plus a history of past codes
  and who used them.
- **Account lockout** — after 3 wrong passwords in a row, an account is
  locked automatically and can't log in (even with the right password)
  until an admin reactivates it from `/admin`. This also applies mid-
  session: if the admin locks someone's account manually while they're
  already logged in, their session stops working on their very next
  request, not just their next login.
- **Admin panel** (`/admin`, only visible/reachable for the admin account)
  lets the admin, per user: set a new password directly (no email flow
  exists, so this is how a forgotten password gets fixed), lock the
  account manually (same effect as the automatic lockout above — handy for
  someone who's left the group or is misbehaving) and reactivate it later,
  or delete the account outright. Deleting an account is permanent, but
  their stories/chapters/comments are *not* deleted with them — they're
  kept and re-credited to a placeholder "Deleted user" so the group
  doesn't lose chapters or discussion just because someone's account went
  away. An admin can't lock or delete their own account (to avoid locking
  themselves out), and can't delete the only remaining admin account.

## Deployment

This is live: it runs on a Mac mini, kept running by two `launchd`
services (`com.swarmreview.server` for the app itself,
`com.swarmreview.tunnel` for the tunnel below) that start automatically on
boot and restart the process if it ever crashes -- see
**`SETUP-MAC-MINI.md`** for the plist files and the `launchctl` commands
to check on/restart/stop either one.

It's reachable from anywhere at **https://swarmarchive.com**, via a
Cloudflare Tunnel (no router configuration or open ports) -- see
**`SETUP-DOMAIN.md`** for exactly how that's wired up, in case it ever
needs to move to a different machine or the tunnel needs recreating.

If you're setting this up fresh somewhere else (a different machine, or
just running it locally to try it out): install Node.js 22+
(`brew install node` on macOS, or an LTS installer from nodejs.org
elsewhere), copy this folder over, and run `node server.js` -- see
**`SETUP-MAC-MINI.md`** (Part 1) or **`SETUP-WINDOWS.md`** for a more
step-by-step walkthrough of that part. A Docker option
(`docker compose up -d --build`, using the included `Dockerfile` and
`docker-compose.yml`) is also there if you'd rather have it in a
container instead of a plain `launchd`/Node setup -- the SQLite database
lives in a mounted `./data` folder next to the compose file either way, so
`docker compose down` / `up` again doesn't lose data.
## Project layout

```
server.js        entry point: HTTP server + routing
db.js            SQLite schema (via node:sqlite)
models.js        query helpers (users, stories, chapters, versions, comments)
auth.js          password hashing, session cookies, invite code generator
views.js         server-rendered HTML pages
lib/markdown.js  the Markdown parser + offset-aware comment highlighting
lib/docx.js      hand-written .docx (Word) reader/writer, built on lib/zip.js
lib/zip.js       minimal dependency-free ZIP reader/writer
lib/multipart.js parser for file-upload (multipart/form-data) requests
lib/time.js      renders SQLite timestamps as <time> elements (UTC fallback)
lib/wiki.js      syncs + matches names against the shared-universe wiki
lib/             other small shared helpers (HTML escaping, cookies, layout)
public/          client-side CSS/JS (text-selection + highlighting logic)
data/            created at runtime: the SQLite database + secrets
```

## Known limitations / ideas for later

- No self-service password reset (no email flow to support it) — but the
  admin can set anyone a new password directly from `/admin`, so this is
  a quick fix, not a database chore, now.
- No live Markdown preview while writing — formatting only shows once you
  publish. Could add a preview pane later if useful.
- `.docx` upload is "good enough," not perfect: bullet vs. numbered lists
  both come back as bullets (real Word numbering isn't reconstructed),
  tables/images/footnotes are ignored, and a downloaded chapter that's
  re-uploaded will show its embedded title as a bold line at the top of
  the text (since the title lives in a separate field in this app, not
  in the document body) — just delete that line if it bothers you.
  A stray literal `*`/`_`/`~` character in an uploaded Word doc could in
  rare cases get misread as Markdown formatting after upload.
- No email notifications when someone comments on your chapter — just the
  in-app "New" / "New comments" badges since your last visit (see above).
  A real email digest could be added later if the group wants it, but it
  needs an SMTP setup this app deliberately doesn't have yet.
- No co-authored stories — a story has a single author who is the only
  one who can add chapters to it or edit them.
- Deleting a story or chapter "forever" is a real, permanent SQL delete —
  there's no trash/undo beyond the archive step before it.
