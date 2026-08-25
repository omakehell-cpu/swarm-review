# Setting up Swarm Review on this Windows PC (for review, before the Mac mini)

Good news: the app has zero external dependencies (including no native
modules to compile), so it runs the same way on Windows as it will later
on the Mac mini. This lets you try it out here first.

## 1. Check whether Node.js is installed

Open **PowerShell** (Start menu → type "PowerShell" → Enter) and run:

```powershell
node -v
```

- If you see **v22.5.0 or higher**, skip to step 3.
- If you see an error or a lower version, install/update Node (step 2).

## 2. Install Node.js (only if needed)

Easiest option — using `winget` (built into modern Windows):

```powershell
winget install OpenJS.NodeJS.LTS
```

Close and reopen PowerShell afterward, then confirm it worked:

```powershell
node -v
```

(Alternative: download the Windows installer directly from
[nodejs.org](https://nodejs.org) and run it if you prefer a GUI installer.)

## 3. Extract the project

The zip is already sitting in this folder: `review-project\swarm-review.zip`.

In File Explorer, right-click `swarm-review.zip` → **Extract All...** →
extract it into `review-project` (or wherever you like). You should end
up with a `review-project\swarm-review\` folder containing `server.js`,
`README.md`, etc.

## 4. Start the server

In PowerShell:

```powershell
cd "$HOME\Desktop\review-project\swarm-review"
node server.js
```

You should see:

```
Swarm Review listening on http://localhost:3000
Invite code for new account registration: XXXXXXXX
```

**Write down that invite code.** Leave this PowerShell window open — the
site stops working if you close it.

If **Windows Defender Firewall** pops up asking whether to allow Node.js
to access the network, click **Allow access** — it's only needed if you
later want other devices on your network to reach it; for viewing it
yourself at `localhost` it doesn't strictly matter, but allowing it is
safe and avoids the prompt reappearing.

## 5. Open it in your browser

Go to **http://localhost:3000** in Edge, Chrome, or Firefox. Register the
first account (becomes the admin automatically) and try it out — start a
story with its first chapter (written in Markdown), select some text to
leave a comment, accept/reject it, upload a new version, add a second
chapter to the story, etc.

## Stopping / restarting

- Stop: click into the PowerShell window and press `Ctrl+C`.
- Restart later: same two commands from step 4.
- Your data (accounts, stories, chapters, comments) lives in a `data`
  folder next to `server.js` and survives restarts.

## When you're happy with it

Once you've reviewed it here, moving to the Mac mini is just: copy the
same `swarm-review` folder over (or re-extract the zip there), install
Node.js the Mac way (see `SETUP-MAC-MINI.md`), and run the same
`node server.js`. Nothing about the app itself needs to change between
the two — only where it physically runs.

One thing *not* to carry over: if you want the Mac mini's copy to start
with a clean slate (no test accounts/stories from trying it out here),
just don't copy the `data` folder over — a fresh one gets created
automatically the first time you run it there, with its own new invite
code.

## Got a domain and want it live now?

If you'd rather put this PC on the internet with a real domain right away
instead of waiting for the Mac mini, see **`SETUP-DOMAIN.md`** — it covers
exactly that, using Cloudflare Tunnel (no router configuration needed).
