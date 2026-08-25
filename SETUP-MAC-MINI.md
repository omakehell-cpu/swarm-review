# Setting up Swarm Review on your Mac mini

This guide gets the app running locally on your Mac mini first (so you can
open it in a browser and try it yourself), and then outlines your options
for making it reachable by the rest of the group later on.

## Part 1 — Run it locally on the Mac mini

### 1. Get the project files onto the Mac mini

You already have `swarm-review.zip` (I sent it earlier and saved a copy in
your `review-project` folder on this PC). Get that zip onto the Mac mini
however is easiest for you — AirDrop, a USB stick, iCloud Drive/Dropbox,
or emailing it to yourself. Once it's there, double-click it in Finder to
unzip it (or unzip it into wherever you keep projects, e.g. `~/Projects/`).

### 2. Check whether Node.js is installed

Open **Terminal** (Cmd+Space, type "Terminal", Enter) and run:

```bash
node -v
```

- If you see a version number **22.5.0 or higher**, you're set — skip to
  step 4.
- If you see "command not found" or a lower version, install/update Node
  (step 3).

### 3. Install Node.js (only if needed)

The easiest way on a Mac is [Homebrew](https://brew.sh). If you don't have
it yet:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the on-screen instructions (it may ask you to run one or two more
commands to add Homebrew to your PATH — it will tell you exactly what to
paste). Then install Node.js:

```bash
brew install node
```

Verify it worked:

```bash
node -v
```

You should see something well above `v22.5.0` (Homebrew installs a recent
version).

### 4. Start the server

In Terminal, go to the folder where you unzipped the project — for
example, if it's on your Desktop:

```bash
cd ~/Desktop/swarm-review
node server.js
```

You should see something like:

```
Swarm Review listening on http://localhost:3000
Invite code for new account registration: XXXXXXXX
```

**Write down that invite code** — everyone who registers an account needs
to type it in once. Leave this Terminal window open; the site stops
working if you close it or press Ctrl+C.

### 5. Open it in your browser

Go to **http://localhost:3000** in Safari or Chrome on the Mac mini.
Register the first account (it automatically becomes the admin account),
then explore: start a story with its first chapter, select some text to leave a comment,
accept/reject it from another account, upload a new version, etc.

At this point it only works from the Mac mini itself — that's expected,
this is the "local" stage. Part 2 below covers letting your friends reach
it too.

### Stopping / restarting

- To stop the server: click into that Terminal window and press `Ctrl+C`.
- To start it again later: `cd ~/Desktop/swarm-review && node server.js`
  (or wherever you put the folder).
- Your data (accounts, stories, chapters, comments) lives in a `data/` folder next
  to `server.js` and persists between restarts — you won't lose anything
  by stopping and restarting the server.

## Part 2 — Making it reachable by the group (later)

Once you're happy with how it works locally, there are a few ways to let
your friends reach it too. Roughly in order of how much hassle they are:

**Tailscale (recommended starting point)** — a free private network app.
You install it on the Mac mini and each friend installs it on their own
device; then they can open the site using a private address that only
your group can reach, with no need to touch your router or expose
anything to the public internet. Simplest and most secure option for a
trusted friend group.

**Port forwarding + a domain name** — makes the site reachable by anyone
on the public internet, the way a normal website works. Requires
configuring your home router to forward a port to the Mac mini, ideally a
dynamic DNS service (since home internet IPs usually change) or a real
domain, and a reverse proxy like Caddy in front of the app to get free
HTTPS. More setup, but means people don't need to install anything.

**Keeping the server always running** — whichever option you pick,
you'll also want the app to start automatically and restart itself if it
crashes or the Mac mini reboots, rather than relying on a Terminal window
staying open. On macOS this is normally done with a small `launchd`
config, or a process manager like `pm2`. I can set this up for you when
we get to this step.

When you're ready to tackle this part, tell me which of these fits how
you want the group to access it (or if you're unsure, tell me a bit about
your setup — e.g. is the Mac mini always on, do you already use
Tailscale/a VPN for anything, do you have a domain name — and I'll
recommend one) and I'll walk you through it step by step, the same way as
this guide.
