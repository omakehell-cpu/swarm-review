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

@figure account-page.png | The account page: your name, your password, and the tags you would rather not see.

## Being told there is something waiting

This is a review site, and the awkward part of one is that a note can sit
on your chapter for a week without you knowing. The index puts what is
waiting on you at the top, but you have to be here to see it.

So: **a feed, one per person**, from *Being told there is something
waiting* on your account page. Press the button, copy the address, paste
it into whatever you read feeds in. It carries three things:

- notes waiting on a chapter of yours, still unanswered,
- replies to notes you left,
- chapters you have not opened yet.

@figure feed-link.png | The feed block once a link has been made, with the two buttons that rotate it or turn it off.

**Nothing is sent from here.** That is the point of a feed rather than an
email: this app never reaches out to the network, and the feed just sits
there until your reader comes and asks for it.

The other half of that bargain is that **the address is the password**.
Anyone holding it can read your feed without logging in, which is what
makes it work in a reader at all. Keep it to yourself; if it gets out,
*Make a new link* replaces it and the old one stops working on the spot.
*Turn it off* removes it entirely.

## Your page

Everyone has one, at their name wherever it appears. It shows the stories
they have written, the chapters they have contributed, and their statistics:
how much they have written, how much they have read, and what they have said
on other people's work.

It is visible to everyone who can log in, and to nobody else. There is no
public web out there looking at this site.

@figure your-page.png | Your page: what you have written, and what you have been doing.

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

## How the site looks

Your account page has three looks to choose from: **Clean**, the site as
it was designed; **Literary**, paper and serif, with the stories laid out
as a shelf of covers; and **The Swarm**, a dark console with the chapter on
a lit page in the middle of it. The choice is yours alone -- nobody else
sees it -- and it follows you to every device you sign in on. Light and
dark still follow the moon button in the top bar, except in The Swarm,
which is always dark.
