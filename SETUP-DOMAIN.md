# Going live: swarmarchive.com

This gets `swarmarchive.com` actually pointing at your app, so anyone in
the group can open that URL from anywhere — not just `localhost:3000` on
this PC.

## Why Cloudflare Tunnel

Your domain is already managed through Cloudflare (that's the dashboard
the link you shared opens into), which makes **Cloudflare Tunnel** the
path of least friction, and it's the recommended default here over
old-school port forwarding:

- No router configuration, no opening ports 80/443 — this matters because
  many home ISPs (Movistar, Orange, etc. included) put you behind CGNAT,
  where port forwarding just doesn't work at all, even if you configure it
  correctly.
- Your home IP address is never exposed publicly — the PC only makes an
  *outbound* connection to Cloudflare, nothing listens for inbound
  connections from the internet directly.
- Free, automatic HTTPS — Cloudflare issues and renews the certificate,
  you never touch Let's Encrypt or any cert files.
- Since the domain's DNS is already on Cloudflare, there's no separate
  "point my domain at Cloudflare" step to do first.

The trade-off: Cloudflare sits in the middle of every request (it's a
proxy, not a plain redirect). For a friend group's writing site that's a
complete non-issue, and it's how a large share of self-hosted personal
projects are exposed today.

This guide runs the app on **this Windows PC** (per what you said — the
Mac mini can take over later; moving it is just re-running these same
steps there, nothing about the app changes).

## Part 1 — Install and authenticate cloudflared

Open PowerShell in the `swarm-review` folder (or anywhere — this part
doesn't care about the working directory) and install `cloudflared`:

```powershell
winget install --id Cloudflare.cloudflared
```

Close and reopen PowerShell, then confirm it worked:

```powershell
cloudflared --version
```

Now link it to your Cloudflare account:

```powershell
cloudflared tunnel login
```

This opens your browser to a Cloudflare login/authorize page. Log in and
pick **swarmarchive.com** from the list of domains. This creates
`%USERPROFILE%\.cloudflared\cert.pem`, which is what lets this PC create
tunnels for that domain — keep it private, it's effectively a credential.

## Part 2 — Create the tunnel

```powershell
cloudflared tunnel create swarm-review
```

This prints a **Tunnel ID** (a long UUID) — copy it, you need it in the
next step. It also creates a credentials file at
`%USERPROFILE%\.cloudflared\<TUNNEL-ID>.json` — also private, don't share
or commit it anywhere.

## Part 3 — Configure it

Create `%USERPROFILE%\.cloudflared\config.yml` (plain text file, e.g. with
Notepad) with this content, replacing `<TUNNEL-ID>` and `<YourUsername>`
with your actual values:

```yaml
tunnel: <TUNNEL-ID>
credentials-file: C:\Users\<YourUsername>\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: swarmarchive.com
    service: http://localhost:3000
  - service: http_status:404
```

That last `http_status:404` line is required by cloudflared — it's the
catch-all for any hostname that isn't `swarmarchive.com` (there isn't one
yet, but the config needs a fallback).

If you also want `www.swarmarchive.com` to work, add another `- hostname:`
entry above the catch-all line pointing at the same service.

## Part 4 — Route the domain to the tunnel

```powershell
cloudflared tunnel route dns swarm-review swarmarchive.com
```

This adds the DNS record in Cloudflare automatically (a CNAME pointing at
your tunnel) — you don't need to go into the Cloudflare DNS dashboard and
add anything by hand.

## Part 5 — Turn on Secure cookies

Now that the app will actually be served over `https://`, tell it so it
locks the login cookie to HTTPS-only (see `.env.example` for why). In the
`swarm-review` folder, create a file named `.env` (if you don't have one
already) with:

```
SECURE_COOKIES=1
```

## Part 6 — Test it

You need two things running at once. Open **two** PowerShell windows:

**Window 1** — the app itself:
```powershell
cd "$HOME\Desktop\review-project\swarm-review"
node server.js
```

**Window 2** — the tunnel:
```powershell
cloudflared tunnel run swarm-review
```

Leave both open. Now, from your **phone, on mobile data (not your home
WiFi)** — that's important, it's the only way to actually prove it's
reaching the outside world and not just your own network — open:

**https://swarmarchive.com**

You should get the login page, padlock and all. The very first account
anyone registers there becomes the admin, same as always — if you've
already got a local `data/` folder from testing, that's still there and
still has your existing accounts/stories, nothing resets.

If it doesn't load: give it a minute (DNS/certificate propagation is
usually seconds, but occasionally takes longer), then check both
PowerShell windows for errors, and double-check the `config.yml` hostname
matches `swarmarchive.com` exactly.

## Part 7 — Keep it running automatically (recommended once it works)

Right now the site goes down the moment you close either PowerShell
window, log off, or restart the PC. To have both pieces start on their
own and keep running in the background:

**1. Create two tiny launcher scripts**, so Task Scheduler has something
simple to point at. In the `swarm-review` folder, create
`start-server.bat`:

```bat
@echo off
node server.js
```

And anywhere convenient (e.g. also in `swarm-review`), `start-tunnel.bat`:

```bat
@echo off
cloudflared tunnel run swarm-review
```

**2. Register both as scheduled tasks that start at boot**, run as your
own Windows account, and keep running whether you're logged in or not.
Open PowerShell **as Administrator** and run (this will prompt you to
type your Windows account password — that's normal, Task Scheduler needs
it to be able to run the task when nobody's logged in):

```powershell
schtasks /create /tn "SwarmReview-Server" /tr "'C:\Users\omake\Desktop\review-project\swarm-review\start-server.bat'" /sc onstart /ru "omake" /rl highest /f
schtasks /create /tn "SwarmReview-Tunnel" /tr "'C:\Users\omake\Desktop\review-project\swarm-review\start-tunnel.bat'" /sc onstart /ru "omake" /rl highest /f
```

(Adjust the path in the first line if you extracted the zip somewhere
else than `review-project\swarm-review`.)

Test them without waiting for a real reboot:

```powershell
schtasks /run /tn "SwarmReview-Server"
schtasks /run /tn "SwarmReview-Tunnel"
```

Then check `https://swarmarchive.com` loads with no PowerShell window
open at all. From now on both start automatically every time the PC
boots.

**To stop them** (e.g. to update the app): `schtasks /end /tn
"SwarmReview-Server"` and the same for `-Tunnel`, or just open Task
Manager and end the `node.exe` / `cloudflared.exe` processes.

**To remove them entirely**: `schtasks /delete /tn "SwarmReview-Server"
/f` (and the same for `-Tunnel`).

## Notes

- This PC needs to actually be **on** for the site to be reachable —
  Cloudflare Tunnel doesn't change that. Check your Windows power/sleep
  settings if the PC tends to sleep on its own; a sleeping PC means the
  site is down until someone wakes it.
- Your `data/swarm-review.sqlite` file is still the entire site's data —
  the domain/tunnel setup doesn't change anything about backups. Copy that
  file somewhere safe occasionally.
- Moving this to the Mac mini later: install `cloudflared` there instead
  (via Homebrew: `brew install cloudflared`), run `cloudflared tunnel
  login` + reuse the *same* tunnel (`cloudflared tunnel run swarm-review`
  works from any machine that has that tunnel's credentials file), and use
  `launchd` instead of Task Scheduler for the "start automatically" part —
  happy to write that version of Part 7 when you get there.
