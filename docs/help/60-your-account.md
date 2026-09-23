# Your account, and everyone else's

The name people see, what your page shows, and the parts of the site only
admins touch.

## Your account

**Account**, from your name in the top bar, is everything about the site
that is yours to set. From the top:

- **Your name** -- the name people see. Your username is how you log in
  and never changes; the display name is what appears on everything you
  write, and you can change it whenever you like. Under it, a link to
  **your page as the group sees it**.
- **Reading chapters** -- two settings for reading with nothing in the way:
  *open every chapter in Read mode*, and *no links in the prose* (names
  from the bible and the glossary read as plain words). See
  [with a screen reader](/help/screen-readers) for why they exist; they are
  for anybody.
- **How the site looks** -- Clean, Literary or The Swarm; see the end of
  this page.
- **Writing** -- a target of your own in words a day, and how this week
  has gone; see [targets](/help/targets-and-analysis).
- **Being told there is something waiting** -- your private feed; below.
- **Change password** -- with the current one in hand. If you have lost
  it, an admin can make you a reset link. Changing it signs
  you out everywhere else.
- **Tags you'd rather not see** -- see [tags](/help/tags-and-search).

All of it follows you to every device you sign in on, except light and
dark, which each browser remembers for itself.

@figure account-page.png | The top of the account page: your name, reading, how the site looks, and your daily target.

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

## Light and dark

The moon at the right of the top bar moves between light and dark, and
follows your system until you press it. It is remembered in your browser,
not your account, so it can be different on your phone and your desk.

## Admin

Admins run the site rather than the writing. They cannot write in your story
or touch your chapters — that is deliberate and there are tests to keep it
that way.

What they do:

- **Invites.** Registration is invite-only. An admin generates a code, or
  invites a specific person by name, and can close registration altogether.
  Every code that still works has a **Copy the invite** button: it copies a
  short message, ready to paste into a chat or an email, with a link that
  fills the code in (and the username, for a named invite) on the sign-up
  page.
- **Accounts.** Three wrong passwords locks an account, and an admin
  reactivates it. They can also send somebody a reset link.
- **Tags.** Approving or merging the tags authors have proposed.
- **The wiki.** Pressing *Sync wiki now* to refresh the glossary.
- **Backup.** The server keeps a copy of everything every day, for two
  weeks. An admin can take one on demand, download the whole database as
  one file, and **put a copy back**: choose it, type RESTORE, and the site
  goes back to how it was then. A copy of the site as it stood is taken
  first, so a restore can be undone the same way.
- **A log** of what each person has been doing, which is there so that
  "something went wrong yesterday" is answerable.

@figure invite-copy.png | The invite code on the admin page, with the button that copies it as a message.

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
