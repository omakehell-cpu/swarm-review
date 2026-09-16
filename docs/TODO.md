# Still to do

Not a promise and not an order of work -- just the things that are known to
be missing, so they stop living in somebody's head. Newest thinking at the
top of each entry; move an item into the changelog when it ships.

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

## Notifications

Somebody leaves a note and nobody knows until they next look. The only fix
that actually reaches a person is email, and email is the one thing that
would send traffic off this machine -- which is against the rule the app is
built on. Needs a decision before any code: in-app only, or a mail server,
and if a mail server, whose.

## A timeline

The bible knows who is in which chapter. It does not know when anything
happens in the story's own calendar, which is the other half of keeping a
long book straight.

## Writing, not just reading, on a phone

The reading side works on a phone. The editor does not really, and a
chapter written on a train is still a chapter.

## Scenes inside chapters

A chapter is the smallest unit the app knows about. Long chapters are made
of scenes, and moving a scene is a thing writers do constantly.

## A search that is worth the name

The current one is a LIKE over the text. SQLite has FTS5 built in; that
would make it fast, ranked, and able to handle a phrase.

## Restoring from a backup

Backups are taken daily and kept for a fortnight, and the only way to use
one is to stop the server and copy a file by hand. The admin page should be
able to do it, or at least tell you exactly how.
