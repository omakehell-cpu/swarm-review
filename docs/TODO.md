# Still to do

Not a promise and not an order of work. Every item says three things: what
it is, **what it costs**, and **what it touches** -- because "how long" and
"what breaks if it goes wrong" are the two questions worth knowing before
an evening starts, and neither is obvious from the name.

Move an item into the changelog when it ships.

---

# First, because somebody is blocked by it

## Accessibility, for a writer who cannot see the screen

One of the authors in the group is blind. The app is not being read the way
it was built and tested: it is being listened to and driven from the
keyboard. Everything below was worked out by somebody looking at a screen,
which is the reason the last item is the first thing to do.

### Sit with her and listen to it
**Cost: half a day, and it is hers, not yours.** **Touches: nothing.**
Four paths: read a chapter, leave a note, write and save a chapter, find
something. Not a checklist run over the markup -- the actual paths, heard.
This will reorder everything under it and probably add two things nobody
here has thought of. Doing the rest first is guessing twice.

### Everything that is currently only a colour
**Cost: half a day.** **Touches: every page, one line at a time.** Low
risk, tedious.
Chapter stage, notes waiting, the red that means unresolved, the presence
grid. The grid already carries its counts. The rest needs checking one by
one for whether the colour is the only thing saying it, and a word added
where it is.

### Keyboard order and focus on the two-column pages
**Cost: half a day.** **Touches: the chapter page, the entry page, the
outline.** Medium risk: focus order is easy to improve for one person and
break for another, which is why it wants testing with her rather than
reasoning.
The outline's drag handles have up/down buttons as the keyboard path --
make sure they are announced as that, not as decoration.

### Alt text that says something
**Cost: two hours.** **Touches: the story notes and the help pages.** No risk.
An entry picture falls back to the entry's name, which tells a listener
nothing they did not already know. The crop control is pure geometry and is
useless read aloud. The help figures have captions; whether they describe
the picture or merely label it is a separate question.

### What she has told us so far
Contrast and WCAG as the floor, checked with Accessibility Insights (axe).
Every control named for what it does. A number before its label ("20
percent volume", not "volume 20 percent"), so a value can be scanned. No
"slide to" gestures. Formatting that is seen and not said -- indents, font
changes -- has to be said. Landmarks and headings for pages where things
get done; for a story, "let nothing get between me and my book". She uses a
Mac.

### Done on 2026-09-23
The automated floor: WCAG 2.2 AA with no violations on every main page, in
every look, light and dark (`npm run a11y`). Skip links; the chapter as a
named region; a heading on every note with a way back to its passage;
passages with notes announced as highlighted in Review and not in Read;
scene breaks named; the writing checks as a walkable list; formatting state
on the editor's buttons and Alt+F to hear it; value-first labels on the
reading settings; two account settings for reading with nothing in the way.
Next is hearing it with her.

### Done on 2026-09-23, second round: zoom, and a script for listening
At 320 CSS pixels (a laptop at 400%) nothing scrolls sideways except the
outline table, inside its own box the keyboard can reach; pinned bars stop
being pinned on a screen that short, so they cannot hide the focus; text
spacing and 200% text lose nothing. The story's cover sits above its
title on a narrow screen. Note buttons say which note they belong to.
`docs/accessibility/voiceover-checklist.md` is the four paths as a
VoiceOver script, to run before the session with her and after any change
to the chapter page, the editor or the notes.

### Done on 2026-09-16
The margin notes: a passage can be selected with the keyboard and commented
on with **C**, the offer announces itself, and answering a note happens in
place with focus kept and one sentence spoken. It was the heart of the app
and the one thing in it that could only be done with a mouse. What is left
of that item is hearing it done.

---

# Worth doing when there is an evening

## Index cards for the outline
**Cost: a day.** **Touches: one page, read-only.** Low risk -- it is a
second way of drawing chapters the outline already loads.
Scrivener's corkboard: the same chapters as cards on a board rather than
rows in a table, each showing its summary, coloured by point of view or
strand, dragged to reorder. The table is better for comparing numbers; the
board is better for seeing the shape of an act at a glance, which is the
one thing the table is bad at. Everything it needs -- summary, POV, strand,
order -- is already on the chapter.

## A character interview
**Cost: a day.** **Touches: the story notes only.** Low risk.
bibisco's best idea: instead of an empty "notes" box, a list of questions
for a character -- what do they want, what do they refuse to do, what do
they lie about -- answered one at a time, with the unanswered ones still
visible. An empty box asks you to be inspired; a question asks you to
answer it. The story notes already have free text per entry; this is a set of
prompts stored beside it and a page that walks them.

## Who knows whom, drawn
**Cost: two or three days.** **Touches: the story notes; a new page.**
The links between entries in the story notes exist and are listed as text. bibisco draws
them, and a drawing answers "who has not met whom yet" in a second where a
list does not. This is the one item here that would want real work in the
browser -- SVG, positions, dragging -- and the one most likely to look
worse than the list it replaces if it is done carelessly.

## Saved searches
**Cost: half a day.** **Touches: search and the story page.** Low risk.
Scrivener's Collections: name a search and keep it -- "every chapter that
mentions Kessler", "everything tagged *revise*" -- and have it on the story
page as a list that stays current. The search is now fast enough for this
to be worth having; before the index it was not.

## A deadline, not just a target
**Cost: half a day.** **Touches: the story settings and the analysis page.**
The word goal knows where you are going but not when. bibisco asks for a
date as well, and then the only number that matters is words per day left.
Small, and the kind of thing that either helps a great deal or is switched
off in a week.

---

# Large, and only if you want it

## Scenes inside a chapter
**Cost: a week or more.** **Touches: the model, the anchored comments and
the editor -- the three most delicate things in the app.**
Scrivener's Binder: a chapter stops being atomic and becomes a list of
scenes, each with its own summary, point of view and state, reorderable,
still reading as one continuous text.

This is the real structural change. The anchored comments are what makes it
expensive: a note is pinned to an offset in a chapter's text, and splitting
that text into scenes moves every offset. **Not worth starting until it is
clear you need it** -- with chapters of four thousand words, you may not.

---

# Decided against

## Email
**Not doing it.** The feed reaches the people who will be reached, and
email would make this the only part of the app that opens a connection to
somebody else's machine. Running our own mail server is not the
alternative: this one lives on a Mac behind a Cloudflare tunnel that
carries HTTP only, on a home IP with no reverse DNS of its own, which means
the mail would not be rejected -- it would quietly land in spam, which is
worse.

If it ever comes back, it comes back for **password resets**, not for
notifications: that is the one case where somebody is locked out and
waiting, and where an admin generating a link by hand is the current
answer. The shape it would take, so nobody works it out twice: a relay
(Resend, Brevo, SMTP2GO -- all free far past this group's volume), three
DNS records on the domain, credentials in `.env`, and no `SMTP_HOST`
meaning no mail at all and the app behaving exactly as it does today.
