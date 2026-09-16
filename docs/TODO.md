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

### The writing checks in the editor
**Cost: a day.** **Touches: the editor only.** Low risk: it adds a way of
reading what is already there.
They mark passages by colour and underline, which is nothing to a screen
reader. Announced badly, forty passive-voice marks are forty interruptions.
The shape that probably works is a list beside the text -- "four passives,
two long sentences" -- that can be walked, each entry moving the cursor to
its passage. The analysis page already proves the data is there.

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
**Cost: two hours.** **Touches: the bible and the help pages.** No risk.
An entry picture falls back to the entry's name, which tells a listener
nothing they did not already know. The crop control is pure geometry and is
useless read aloud. The help figures have captions; whether they describe
the picture or merely label it is a separate question.

### Done on 2026-09-16
The margin notes: a passage can be selected with the keyboard and commented
on with **C**, the offer announces itself, and answering a note happens in
place with focus kept and one sentence spoken. It was the heart of the app
and the one thing in it that could only be done with a mouse. What is left
of that item is hearing it done.

---

# Worth doing when there is an evening

## Not shipping half a megabyte of glossary
**Cost: half a day.** **Touches: one page.** Low risk.
`/glossary?view=all` renders all 691 wiki pages into **491 KB of HTML** in
one response. It is fast on the server -- 13 ms -- and that is not the
problem: it is half a megabyte down a home tunnel to somebody's phone, and
691 rows for a screen reader to walk past. The A–Z jump bar is already
there; the fix is to send one letter at a time, or the first hundred with
a "more" link.

## Restoring a backup from the web
**Cost: a day.** **Touches: the admin page and the database file.**
**The highest-risk item on this list** -- it is the one feature whose bug
is "the wrong database is now live". Wants a confirmation that names the
file and its date, a copy of the current database taken first, and the
server refusing to do it while anybody else is writing.
Copies are taken daily and kept for a fortnight. Using one means stopping
the server, finding the file and swapping it by hand, which is a thing
nobody will get right at midnight.

## A CSRF token
**Cost: two hours.** **Touches: every form and the four `fetch` calls.**
Low risk, and easy to verify -- a missing token is a loud failure, not a
quiet one.
Today the only thing stopping another site from posting to this one is the
session cookie's `SameSite=Lax`, which is genuinely enough in a current
browser. It is doing all of the work alone, though, and the number of
things posted by script rather than by a form keeps growing. Cheap now,
annoying later.

## The log grows forever
**Cost: an hour.** **Touches: how the service is started, not the app.**
`server.log` is 23 KB today and nothing ever truncates it. On a Mac mini
that runs for a year this is the kind of thing that is fine until it is
not.

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
