# What's new

Every batch of changes, newest first, in plain language. The dates are when
the work landed, not when the server picked it up -- if something here is
missing on the site, it has not been restarted yet.

## 2026-09-16 — A feed, so a note stops waiting in silence

- **You can be told that something is waiting**, without this app ever reaching out to the network. Your account page will make you a private feed: notes waiting on your chapters, replies to notes you left, and chapters you have not opened. Paste the address into whatever you read feeds in.
- It is a feed rather than an email on purpose. An email would mean a mail server and would make this the only part of the app that talks to the outside world; a feed sits still until your reader comes and asks for it.
- **The address is the password.** Anyone holding it can read your feed without logging in -- which is exactly what makes it work in a reader. It is not created until you ask for one, *Make a new link* replaces it the moment you think it has got out, and *Turn it off* removes it.

## 2026-09-16 — Two things the cast list was doing badly

- **You choose what a thumbnail keeps.** A picture is rarely square and a face is rarely in the middle of one, so the crop was cutting people's heads off. Click the spot on the picture; the square underneath shows the result at the size it is actually used. The two numbers beside it are the same setting typed out, for anybody who would rather type, and they are what gets saved. The entry's own page and the cast list are cut the same way.
- **Entries without a picture keep the box.** An initial in it, the same size and place as a thumbnail, so a half-illustrated cast reads as one column of names instead of two ragged ones. The names line up as well now, which they did not: the middle of each row was sized to fit and so started wherever that row's own meta line left off.
- On a phone the cast list keeps the picture beside the name instead of stacking it on top and centring everything.

## 2026-09-16 — Targets, and the story counted

- **A story can have a word target.** Set it on *Edit details* and a bar appears on the story page and on the analysis, saying where the draft is against it. No target, no bar: nothing nags at you unless you asked it to.
- **A daily target of your own**, on your account page, with what you have written today, this week, and how many days in a row you have hit it. It counts words added, so a day spent cutting is an honest zero rather than a negative.
- **Analysis**, next to *Outline* on the story page: the length of every chapter, the weight of each arc, who the story is told through, what each strand carries, which notes are still waiting, and a grid of who is named in what. Nothing on that page is set by hand -- it is the chapters, the bible and the notes, added up.
- **Chapters can say whose point of view they are, and which strand they belong to.** Both optional, both free text, both offered back to you from what the story has used before, so a vocabulary settles on its own. They show up on the outline, and they are what the point of view and strand charts are counting.

## 2026-09-16 — An outline, and the whole story in one file

- **Every story has an outline**, from the story page: all its chapters on one line each, with what happens, who is in it, how long it is and what notes are still waiting. **Drag a row** to move a chapter, and **edit a summary where it sits**.
- **Compile the whole story** into one .docx, .md or .txt. Chapters in order, arcs as parts, a title page. Until now the only thing you could download was one chapter at a time.

## 2026-09-16 — Three ways your work was at risk

- **The editor keeps your draft in your browser while you type.** If the tab closes, the browser falls over or the session drops, the text is offered back when you come back. It is a rescue, not a sync: it never replaces what the server has without you saying so, and it is thrown away the moment a real save lands.
- **A save can no longer land silently on top of somebody else's.** If a chapter gained a version while you had the editor open (another tab, another person), the save is refused once: your text stays in the box, theirs is shown underneath, and saving again is a decision rather than an accident.
- **The database now backs itself up.** Daily, into `data/backups`, keeping the last fourteen, plus a "take one now" button on the admin page. That protects against a mistake; point a cloud folder or a second disk at that directory to be protected against the machine.

## 2026-09-15 — Help, and a bible you can close

- **A Help section**, from the top bar: six how-tos, one per part of the site, with screenshots.
- **This changelog**, inside it, marking anything published since you last looked.
- **A story bible can be made private.** The owner's switch, at the top of the bible page, and only the owner sees it. Closed, only the people who write the story can see the bible -- and the chapters stop linking names or listing who is in them, so nothing leaks through the back.

## 2026-09-15 — The story bible

- **Every story now has a bible**: the people, places, groups, things and events it is made of, at *Bible* on the story page. Each entry takes a name, other names it answers to, a one-line summary, a role and a status, a description, and a spoiler section that stays folded.
- **You do not tag appearances.** Which chapters an entry turns up in is read out of the chapters themselves, by name and alias, and re-read whenever a chapter changes. Take a name out of a scene and that scene leaves the entry.
- **You can overrule it.** Somebody present but never named is missed; a name that is also a ship is found too often. *Correct this* on an entry ticks chapters by hand, and your correction survives every rescan.
- **Entries take pictures.** Several per entry, with captions; the first is the entry's face in the cast list. Large ones are shrunk in your browser before they are sent.
- **Entries take custom fields.** A template per kind — every person asked for a Rank and a Home world — plus extras on the one entry that needs them.
- **Names in a chapter link to their entries**, the way the wiki's names already linked to the glossary. Where a name is both, your own entry wins.
- **Names the bible has not heard of are offered for one click**, on the chapter and inside the editor, working on the draft you have not saved yet.
- **The chapter page says who is in it**, and marks who is new there.
- Bibles are in the site search, and the index sorts by presence, role or last change.

## 2026-09-15 — The glossary, reorganised

- The glossary front page is a **directory**, not a list: three doors (the world, stories, authors) and the wiki's subject categories gathered into families.
- Every listing is cut into **A–Z sections** with a jump bar, and filters as you type.
- How finished a page is (Canon, Stub, Temporary) moved off the subject row into its own filter, and the wiki's housekeeping categories are out of the way.
- A glossary entry shows **previews of what it links to** in the margin, once per term.

## 2026-09-15 — Arcs, states, and who did what

- A story can be cut into **arcs** ("Book One"), shown in the chapter index and the statistics.
- A story has a **state** — ongoing, asking for revisions, complete, dropped — and goes to *hiatus* on its own after six months of silence.
- A chapter says **what it is asking for**: draft, wants notes, or settled.
- Everyone has a **public page** with their stories, chapters and statistics, and the **name people see** can be changed from your account.
- Admin has a **log of what each person has done**.
- **Three ways out of a chapter**: navigation at the top and the bottom, floating arrows while reading, and the ← and → keys.
- The author gets an **"add the next chapter"** button at the end of the last one.

## 2026-09-14 — A new look, and reading apart from reviewing

- The whole site was reset on a **Swiss grid**: one accent colour, rules instead of boxes, and the prose still in Literata.
- **Read and Review are separate modes.** Reading gets the text and nothing else; reviewing brings the notes back.
- **Every note sits beside the words it is about**, in the margin, joined by a line.
- The reader sets their own **type size, line length and spacing**, and can fill the screen.
- The app records **who has read what**, so silence means something.
- The writing checks now **propose the rewrite**, not just the complaint.
- A story can have a **synopsis**, **coauthors**, and word counts per chapter.
- **Version diffs in prose**, a **site-wide search**, and .docx in and out.

## 2026-09-13 — Tags and the glossary

- **Story tags** in the shape of StoriesOnline's codes, with authors able to propose new ones and readers able to hide the ones they would rather not see.
- A full **offline mirror of the shared-universe wiki** as the Glossary, synced only when an admin asks for it.
- Character, place and ship names **auto-link** from chapter text to the glossary, with a hover preview.
- The site got its typography: Literata and Inter, self-hosted.

## 2026-08-25 — Writing help, and the locks on the doors

- A **writing analyzer** in the chapter editor: passive voice, adverbs, long sentences and the rest, each check switchable on its own.
- A real **spellchecker** with a proper affix-aware dictionary, and a per-story word list for invented names.
- **Self-service password reset**, account lockout after repeated wrong passwords, and invite-only registration.
- Security headers, and nothing cached that should not be.
