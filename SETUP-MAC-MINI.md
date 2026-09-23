# Setting up Swarm Review on the Mac mini

This is where the app actually lives now -- it runs on the Mac mini,
kept up automatically by `launchd`, and is reachable from anywhere at
**https://swarmarchive.com** (see `SETUP-DOMAIN.md` for how that tunnel
is wired up). The project folder is `~/Documents/swarmEditor/swarm-review`.

Part 1 below is how it was first set up (and how you'd redo it if this
ever needs to move to a different Mac); Part 2 is the actual `launchd`
setup that's running right now -- what to run if you need to check on it,
restart it, or see its logs.

## Part 1 — Getting it running manually

You shouldn't normally need this (the live copy starts itself on boot,
see Part 2), but it's how to run a copy by hand -- for testing something
without touching the live service, or setting this up on a new machine.

### 1. Get the project files onto the Mac

Copy the `swarm-review` folder over however is easiest -- AirDrop, a USB
stick, iCloud Drive/Dropbox, or `git clone` from the project's GitHub
repo if it's already been pushed there.

### 2. Check whether Node.js is installed

Open **Terminal** (Cmd+Space, type "Terminal", Enter) and run:

```bash
node -v
```

- If you see a version number **22.5.0 or higher**, you're set -- skip to
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
commands to add Homebrew to your PATH -- it will tell you exactly what to
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

In Terminal, go to the project folder and run it:

```bash
cd ~/Documents/swarmEditor/swarm-review
npm install
node server.js
```

You should see something like:

```
Swarm Review listening on http://localhost:3000
Registration is currently closed -- log in as an admin and generate a new invite code from /admin.
```

("Registration is closed" just means there's no active invite code right
now -- generate one from `/admin` if you need to let someone new in. On a
brand new `data/` folder you'd see a freshly generated invite code printed
instead, since there'd be no admin account yet to generate one from.)

Leave this Terminal window open; a manually-started copy like this stops
working if you close it or press Ctrl+C. (The live copy doesn't have this
problem -- see Part 2.)

### 5. Open it in your browser

Go to **http://localhost:3000**. If this is a fresh `data/` folder,
register the first account (it automatically becomes the admin account),
then explore: start a story with its first chapter, select some text to
leave a comment, accept/reject it from another account, upload a new
version, etc.

### Stopping / restarting

- To stop: click into that Terminal window and press `Ctrl+C`.
- To start it again later: `cd ~/Documents/swarmEditor/swarm-review &&
  node server.js`.
- Data (accounts, stories, chapters, comments) lives in a `data/` folder
  next to `server.js` and persists between restarts -- you won't lose
  anything by stopping and restarting the server this way. It's the same
  `data/` folder the live, `launchd`-managed copy uses, so a manual run
  like this sees (and can affect) the real, live data -- there's no
  separate "test" database.

## Part 2 — How the live copy actually stays running

Two `launchd` services, both set to start at login and restart
automatically if the process ever dies (`KeepAlive`):

- **`com.swarmreview.server`** -- runs `node server.js` in the project
  folder.
- **`com.swarmreview.tunnel`** -- runs `cloudflared tunnel run
  swarm-review`, the Cloudflare Tunnel that makes
  `https://swarmarchive.com` reach this machine (see `SETUP-DOMAIN.md`
  for how that tunnel itself was created).

Both plist files live in `~/Library/LaunchAgents/`:

**`~/Library/LaunchAgents/com.swarmreview.server.plist`**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.swarmreview.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/iagozasdeuna/Documents/swarmEditor/swarm-review/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/iagozasdeuna/Documents/swarmEditor/swarm-review</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/iagozasdeuna/Documents/swarmEditor/swarm-review/server.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/iagozasdeuna/Documents/swarmEditor/swarm-review/server.log</string>
</dict>
</plist>
```

**`~/Library/LaunchAgents/com.swarmreview.tunnel.plist`**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.swarmreview.tunnel</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/cloudflared</string>
        <string>tunnel</string>
        <string>run</string>
        <string>swarm-review</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/swarm-review-tunnel.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/swarm-review-tunnel.log</string>
</dict>
</plist>
```

### Useful commands

Check both are actually running (a PID next to the label means yes; a `-`
means it's not currently running):

```bash
launchctl list | grep swarmreview
```

Restart one cleanly after pulling in code changes (kills and relaunches
it in one step, no separate stop-then-start needed):

```bash
launchctl kickstart -k gui/$(id -u)/com.swarmreview.server
launchctl kickstart -k gui/$(id -u)/com.swarmreview.tunnel
```

Watch the logs (Ctrl+C to stop watching, doesn't stop the service):

```bash
tail -f ~/Documents/swarmEditor/swarm-review/server.log
```

The server trims that log itself once it passes 2 MB, keeping the last
three copies as `server.log.1` to `.3`. If the log lives somewhere else,
set `SWARM_LOG_PATH` to its path.

```sh
tail -f /tmp/swarm-review-tunnel.log
```

Stop a service until the next login/reboot (or until you `load` it
again):

```bash
launchctl unload ~/Library/LaunchAgents/com.swarmreview.server.plist
```

Start it again:

```bash
launchctl load ~/Library/LaunchAgents/com.swarmreview.server.plist
```

Note: killing the `node` or `cloudflared` process directly (e.g. via
Activity Monitor, or `kill <pid>`) doesn't actually stop it -- `KeepAlive`
means `launchd` just restarts it right away. Use `unload` (above) or
`kickstart -k` if you actually want it to stop, or need to force a clean
restart after an update.

### Things worth knowing

- The Mac mini needs to actually be **on and awake** for the site to be
  reachable -- check Energy Saver / Battery settings if it seems to go
  down on its own (System Settings → Energy → uncheck anything that lets
  it sleep automatically while plugged in).
- `data/swarm-review.sqlite` is the entire site's data -- back that file
  up somewhere else occasionally (there's also a one-click backup button
  on `/admin` that downloads a WAL-safe snapshot without needing to stop
  the server).
- If this ever needs to move to a different machine: copy the project
  folder (including `data/` if you want to keep existing
  accounts/stories) and `.env`, install Node the same way (Part 1), then
  redo the two plists above with that machine's actual `node`/`cloudflared`
  paths (`which node`, `which cloudflared`) and `iagozasdeuna` swapped for
  the new machine's username -- `SETUP-DOMAIN.md` covers moving the tunnel
  itself the same way.
