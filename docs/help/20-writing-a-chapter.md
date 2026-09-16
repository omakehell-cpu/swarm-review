# Writing and publishing

Starting a story, adding chapters, and what the editor is telling you.

## A story, then chapters

**New story** takes the story's title and its first chapter in one go: a
story here is never empty. Everything else — the description, the tags, the
synopsis — can wait, and is on **Edit details** afterwards.

After that, **Add chapter** from the story page, or from the end of the last
chapter, which is usually where you are when you think of it.

## Writing the text

The text box takes **markdown**: `**bold**`, `*italic*`, `> quote`, `-` or
`1.` for lists, `#` for a heading, `---` for a scene break, and
`[link](https://...)`. Line breaks are kept exactly as you type them. A
backslash makes a character literal, so `\*` shows a real asterisk.

@figure chapter-editor.png | The editor: the text, the markdown reminder, and the writing checks down the side.

If the chapter already exists as a file, **upload it instead** — `.md`,
`.txt` or `.docx` — and it replaces the text in the box. Word documents keep
their bold, italics, headings and blockquotes.

## Replacing a chapter with a file

Under the text box when you are editing: **Replace this chapter with a
file**. Choose a `.md`, `.txt` or `.docx`, press **Upload and publish**, and
that file is the chapter — a new version, published there and then. It asks
first, because it does something Save does not: whatever is in the box at
that moment is not saved.

Nothing is lost. A new version never overwrites the one before it: the
version you replaced is still in the **Version** dropdown on the chapter
page, with its notes still attached to it, and you can read the difference
between any two of them.

It is for the case where the writing happened somewhere else — the draft
that lives in a folder, the chapter that came back from somebody's Word, the
version you wrote on a train. If you only want to see what is in the file,
open it yourself and paste: this button does not show you the text first.

**Optional details** is where the chapter summary lives, along with two
things worth setting:

- **What this chapter wants** — *draft*, *wants notes*, or *settled*. It
  tells your readers whether to reach for the red pen at all.
- **Starts an arc** — name the arc this chapter opens ("Book One: Four
  hundred days") and the story's contents group everything from here to the
  next named chapter under it. Leave it empty on every chapter that just
  carries on.

**Point of view**, **strand**, and **when this happens** live there too --
see [targets and analysis](/help/targets-and-analysis) for what they feed,
which is the outline, the analysis and the timeline.

**What changed?** is one line for the version history. Future you will want
it.

@figure optional-details.png | Optional details: the summary, what the chapter is asking for, and the arc it opens.

## On a phone

The editor is built to get out of the way on a small screen. The page is
the title, the text, and a **Save** bar that rides along the bottom, so
saving is never a scroll away from wherever you have got to.

@figure editor-phone.png | The editor on a phone: the text, and a save bar that stays put.

**Markdown is supported** and **Optional details** are folded shut and one
tap from open. On a screen with room for them they are open, as before --
nothing was taken away, it was put where it fits.

## Writing with something open beside it

**Open something beside this**, under the editor, puts a second column
next to the text: the chapter before this one, or whichever bible entry
you keep having to check. It is read-only, and it does not touch what you
are writing.

@figure beside.png | The chapter before, open in the column beside the one being written.

Everything in the list is an ordinary link, so with JavaScript off it
opens in a new tab instead and your draft stays where it is. On a chapter
that already has notes down the side, the panel shares that column rather
than opening a third one.

## The writing checks

The editor marks passive voice, adverbs propping up a verb, sentences that
have gone on too long, and the rest. Each check can be switched off on its
own, and where there is an honest rewrite the check **proposes it** rather
than only complaining.

They are suggestions from a set of rules, not judgements. Nothing is sent
anywhere: the checks run in your browser.

Along the same strip, beside the word count, is a **reading grade** -- the
American school year that would follow the text on a first read, worked out
from sentence length and syllables per word. Most published fiction lands
between 4 and 8; children's books lower, a dense literary chapter higher.
It is the one number there that is not a count of things to fix, and it has
no colour for the same reason: there is no grade that is wrong. A hard
chapter written on purpose is a hard chapter written on purpose. It is
useful for noticing that a scene has drifted somewhere you did not mean it
to go, and useless as a target.

The spellchecker uses a real dictionary, which means it does not know your
invented names. Add them to the **story dictionary** (on the story page, or
from the spelling highlight itself) and it will stop underlining them. Names
you write into the story bible are added for you.

## Who can write

The story's owner can do anything to it. **Coauthors** — added by the owner,
under *Who can write in this story* — can add chapters and edit the ones
they wrote themselves. They cannot rewrite somebody else's chapter, and they
cannot change the story.

Being an admin is not a key to somebody else's story.

## The outline

**Outline**, on the story page, puts every chapter on one line: what
happens, who is in it, how long it is, and how many notes are still
waiting on somebody. It is the view for seeing the shape of a draft rather
than reading it.

**Drag a row** to move a chapter (the up and down buttons still work if
you would rather, or if JavaScript is off), and **write a summary straight
into the table** -- it saves when you click away. A chapter with no summary
is counted at the top, because a summary you never wrote is the one you
will want in six months.

Next to it is **Analysis**, which counts the same draft instead of listing
it -- [what that page shows](/help/targets-and-analysis).

## The whole story in one file

At the foot of the story page: the entire thing as one **.pdf**, **.epub**,
**.docx**, **.md** or **.txt**. Chapters in running order, arcs as parts, a
title page with the author and the blurb. The synopsis is left out unless
you ask for it, because it is a note to the group rather than the front of
the book.

Before you pick a format you pick a **layout**, and the two are genuinely
different documents:

- **Manuscript** is the format an agent or a competition asks for.
  Double-spaced, ragged right, twelve point serif, an inch of margin all
  round, your surname and the page number in the top corner, every chapter
  starting a third of the way down a fresh page. It is deliberately plain
  and deliberately easy to mark up.
- **Book** is the one to read. Justified, single-spaced and a little
  tighter, first lines indented except at the opening of a chapter and
  after a scene break, chapters starting on a right-hand page with a blank
  left-hand page before them where that is what it takes, the story's title
  in the running head. Scene breaks come out as `* * *`.

In the book layout the straight quotes off your keyboard become
typographic ones -- “like this”, and the apostrophe in *don’t* with them.
The manuscript layout leaves them alone: that file is your text as you
typed it.

The layout applies to the PDF, which is a real typeset document rather than
a printed web page. The **EPUB** ignores most of it on purpose: an e-reader
decides its own typeface, size and margins, and a book that fights that
decision is a worse book on somebody's phone. What the EPUB keeps is the
structure -- a table of contents that works, one file per chapter, parts as
parts.

It compiles the chapters as they stand at that moment. It is not a
publishing pipeline and does not want to be: it is what you send somebody
who asked to read the thing, and what you upload when somebody asks for a
manuscript.

## Archiving

**Archive chapter** and **Archive story** take something out of the way
without destroying it. Archived work is still readable, still has its notes,
and can be brought back. Deleting for good is a separate, deliberate thing.
