# Your account, and everyone else's

The name people see, what your page shows, and the parts of the site only
admins touch.

## Your account

**Account**, from your name in the top bar, holds four things:

- **The name people see.** Your username is how you log in and never
  changes; the display name is what appears on everything you write, and you
  can change it whenever you like.
- **Your password**, changed with the current one in hand. If you have lost
  it, the login page will send you a reset link instead.
- **Tags you would rather not see** — see [tags](/help/tags-and-search).
- A link to **your page as the group sees it**.

## Your page

Everyone has one, at their name wherever it appears. It shows the stories
they have written, the chapters they have contributed, and their statistics:
how much they have written, how much they have read, and what they have said
on other people's work.

It is visible to everyone who can log in, and to nobody else. There is no
public web out there looking at this site.

## The theme

The switch at the right of the top bar moves between light and dark, and
follows your system by default. It is remembered in your browser, not your
account, so it can be different on your phone and your desk.

## Admin

Admins run the site rather than the writing. They cannot write in your story
or touch your chapters — that is deliberate and there are tests to keep it
that way.

What they do:

- **Invites.** Registration is invite-only. An admin generates a code, or
  invites a specific person by name, and can close registration altogether.
- **Accounts.** Three wrong passwords locks an account, and an admin
  reactivates it. They can also send somebody a reset link.
- **Tags.** Approving or merging the tags authors have proposed.
- **The wiki.** Pressing *Sync wiki now* to refresh the glossary.
- **Backup.** Downloading the whole database as one file.
- **A log** of what each person has been doing, which is there so that
  "something went wrong yesterday" is answerable.

## Where your writing lives

Everything is on one machine, in one SQLite file, behind a login. Nothing
here calls out to anywhere except the wiki sync, and that only when an admin
presses the button.

There is no AI anywhere in this app. The spellchecker is a dictionary, the
writing checks are rules, and the story bible's scan is a regular
expression. Nothing you write is sent anywhere to be read by anything.
