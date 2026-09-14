# Going live: swarmarchive.com

This is how `swarmarchive.com` ended up pointing at the app, so anyone in
the group can open that URL from anywhere -- not just `localhost:3000` on
the Mac mini itself. It's already done and live; this doc is here for
reference, and for redoing it if the tunnel ever needs to move to a
different machine or get recreated.

## Why Cloudflare Tunnel

The domain is managed through Cloudflare, which makes **Cloudflare
Tunnel** the path of least friction, and it's the recommended default
here over old-school port forwarding:

- No router configuration, no opening ports 80/443 -- this matters because
  many home ISPs put you behind CGNAT, where port forwarding just doesn't
  work at all, even if you configure it correctly.
- The home IP address is never exposed publicly -- the Mac only makes an
  *outbound* connection to Cloudflare, nothing listens for inbound
  connections from the internet directly.
- Free, automatic HTTPS -- Cloudflare issues and renews the certificate,
  no touching Let's Encrypt or any cert files.
- Since the domain's DNS is already on Cloudflare, there's no separate
  "point my domain at Cloudflare" step to do first.

The trade-off: Cloudflare sits in the middle of every request (it's a
proxy, not a plain redirect). For a friend group's writing site that's a
complete non-issue, and it's how a large share of self-hosted personal
projects are exposed today.

The tunnel is named **`swarm-review`** and runs on the Mac mini via
`launchd` (see Part 7 below and `SETUP-MAC-MINI.md`) -- the real, current
identifiers for this setup:

- Tunnel name: `swarm-review`
- Tunnel ID: `c483e240-de85-46bd-a2d2-66abc4263c44`
- Hostname: `swarmarchive.com`
- Config file: `~/.cloudflared/config.yml`

## Part 1 — Install and authenticate cloudflared

```bash
brew install cloudflared
cloudflared --version
```

Then link it to the Cloudflare account:

```bash
cloudflared tunnel login
```

This opens a browser to a Cloudflare login/authorize page. Log in and
pick **swarmarchive.com** from the list of domains. This creates
`~/.cloudflared/cert.pem`, which is what lets this machine create tunnels
for that domain -- keep it private, it's effectively a credential.

## Part 2 — Create the tunnel

```bash
cloudflared tunnel create swarm-review
```

This prints a **Tunnel ID** (a long UUID) -- for this setup that's
`c483e240-de85-46bd-a2d2-66abc4263c44`. It also creates a credentials file
at `~/.cloudflared/<TUNNEL-ID>.json` -- also private, don't share or
commit it anywhere.

## Part 3 — Configure it

`~/.cloudflared/config.yml` (the real, current content):

```yaml
tunnel: c483e240-de85-46bd-a2d2-66abc4263c44
credentials-file: /Users/iagozasdeuna/.cloudflared/c483e240-de85-46bd-a2d2-66abc4263c44.json

ingress:
  - hostname: swarmarchive.com
    service: http://localhost:3000
  - service: http_status:404
```

That last `http_status:404` line is required by cloudflared -- it's the
catch-all for any hostname that isn't `swarmarchive.com` (there isn't one
yet, but the config needs a fallback).

If `www.swarmarchive.com` should also work, add another `- hostname:`
entry above the catch-all line pointing at the same service.

## Part 4 — Route the domain to the tunnel

```bash
cloudflared tunnel route dns swarm-review swarmarchive.com
```

This adds the DNS record in Cloudflare automatically (a CNAME pointing at
the tunnel) -- no need to go into the Cloudflare DNS dashboard and add
anything by hand.

## Part 5 — Turn on Secure cookies

Since the app is served over `https://`, it needs to know so it locks the
login cookie to HTTPS-only (see `.env.example` for why). This is already
set in the live `.env` on the Mac mini:

```
SECURE_COOKIES=1
```

(If setting this up fresh: create `.env` in the `swarm-review` folder
with that line, if it isn't there already.)

## Part 6 — Test it

Two things need to run at once. Open **two** Terminal windows:

**Window 1** — the app itself:
```bash
cd ~/Documents/swarmEditor/swarm-review
npm install
node server.js
```

**Window 2** — the tunnel:
```bash
cloudflared tunnel run swarm-review
```

Leave both open. Then, from a **phone, on mobile data (not the same
WiFi)** -- that's important, it's the only way to actually prove it's
reaching the outside world and not just the local network -- open:

**https://swarmarchive.com**

That should show the login page, padlock and all. The very first account
anyone registers there becomes the admin, same as always -- if there's
already a local `data/` folder from testing, that's still there and still
has its existing accounts/stories, nothing resets.

If it doesn't load: give it a minute (DNS/certificate propagation is
usually seconds, but occasionally takes longer), then check both Terminal
windows for errors, and double-check `config.yml`'s hostname matches
`swarmarchive.com` exactly.

## Part 7 — Keeping it running automatically

This is the part that's actually live right now: two `launchd` services
(`com.swarmreview.server` and `com.swarmreview.tunnel`) start both pieces
automatically at boot/login and restart them if either ever crashes, so
nothing depends on a Terminal window staying open. The full plist
contents, plus the `launchctl` commands to check on, restart, or stop
either one, are in **`SETUP-MAC-MINI.md` (Part 2)** -- that's the
authoritative reference for this part, so it isn't duplicated here.

The short version: each plist lives in `~/Library/LaunchAgents/`, runs
one command (`node server.js` for the server, `cloudflared tunnel run
swarm-review` for the tunnel), and sets `RunAtLoad` + `KeepAlive` to
`true`.

## Notes

- The Mac mini needs to actually be **on and awake** for the site to be
  reachable -- Cloudflare Tunnel doesn't change that. See
  `SETUP-MAC-MINI.md` for the sleep-settings note.
- `data/swarm-review.sqlite` is still the entire site's data -- the
  domain/tunnel setup doesn't change anything about backups.
- Moving this to a different machine later: install `cloudflared` there
  the same way (`brew install cloudflared` on macOS), run `cloudflared
  tunnel login`, then reuse the *same* tunnel -- `cloudflared tunnel run
  swarm-review` works from any machine that has that tunnel's credentials
  file (copy `~/.cloudflared/<TUNNEL-ID>.json` and `config.yml` over, with
  the `credentials-file` path in `config.yml` updated for the new
  machine's username/home directory) -- and redo the `launchd` plists as
  described in `SETUP-MAC-MINI.md`, swapping in the new machine's actual
  `node`/`cloudflared` paths and username.
