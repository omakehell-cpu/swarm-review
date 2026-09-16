# Still to do

Not a promise and not an order of work -- just the things that are known to
be missing, so they stop living in somebody's head. Grouped by what they
cost, because that is the useful question when there is an evening free.
Move an item into the changelog when it ships.

Accessibility sits above the groups because it is the only item with a
person blocked by it today. Everything under it is sized, not ranked.

## Accessibility, for a writer who cannot see the screen

**This one has somebody waiting on it.** One of the authors in the group is
blind, so the app is not being read the way it was built and tested: it is
being listened to, and driven from the keyboard. That makes this the first
item on the list rather than a line at the bottom labelled "a11y pass".

What needs doing, roughly in the order it would hurt:

- **A real pass with a screen reader**, on the four things a writer does
  every day: read a chapter, leave a note in the margin, write and save a
  chapter, and find something. Not a checklist run over the markup -- the
  actual paths, listened to.
- **The margin notes.** Selecting text and hanging a note off it is the
  heart of this app and the most mouse-shaped thing in it. There has to be
  a way to quote a passage and comment on it from the keyboard alone, and
  a way to hear which passage a note belongs to when the notes are read
  out in a column of their own.
- **The writing checks in the editor.** They mark passages by colour and
  underline. Announced badly, forty passive-voice marks are forty
  interruptions; announced well they are a list you can walk. Probably
  belongs as a summary list beside the text rather than only as marks in
  it.
- **Everything that is currently a colour.** Chapter stage, "notes
  waiting", the presence grid on the analysis, the red that means
  unresolved. The grid already carries its counts for a reader; the rest
  needs checking, one by one, for whether the colour is the only thing
  saying it.
- **Keyboard order and focus**, on the pages that grew a second column:
  the chapter with its notes, the entry with its side panel, the outline
  with its drag handles (the up/down buttons are the keyboard path -- make
  sure they are announced as such).
- **Images.** Entry pictures take a caption; the alt text falls back to the
  entry's name, which is thin. The crop control is pure geometry and is
  useless read aloud -- it needs to at least say what it is for. The help
  figures have captions; whether those captions describe the picture or
  just label it is another question.
- **Ask her.** The fastest way to find the ten worst things is to sit with
  the person who is hitting them. Everything above is a guess made by
  somebody looking at a screen.

# Medium -- two or three days each

All four of these shipped on 2026-09-16; see the changelog. What is left
of this group is the half of the notification question that was never a
coding problem:

## Email, if a feed is not enough

The feed covers somebody who reads feeds. Somebody who does not still
finds out only by coming to look. A digest by email would reach them, and
would need an SMTP server -- which would make this the only part of the
app that reaches out to the network. That is the decision, and it has not
changed by having built the feed: it is about how the group wants to be
interrupted, not about what is easy.

# Large -- a week or more

## Scenes inside a chapter

Scrivener's Binder. The chapter stops being atomic and becomes a list of
scenes, each with its own summary, point of view and state, reorderable,
and still reading as one continuous text.

This is the real structural change: it touches the model, the anchored
comments and the editor. Not worth starting until it is clear you need it
-- with chapters of four thousand words, maybe you do not.

# Background debt

- **The search is a `LIKE`.** Four milliseconds today (measured, not
  guessed) -- and a problem at ten times the text. SQLite has FTS5 built
  in: fast, ranked, and able to handle a phrase.
- **An accessibility pass**, beyond the urgent part at the top of this
  file.
- **Restoring a backup from the web.** They are taken daily and kept for a
  fortnight, and the only way to use one is to stop the server, find the
  file and swap it by hand. The admin page should either do it or tell you
  exactly how.
