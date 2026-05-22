---
description: Bring up a Pavillion instance from a clean Linux server to a federating server with one admin account in about thirty minutes.
---

# Quickstart

This guide takes you from a clean Linux server to a Pavillion instance that's reachable on its domain, has one working admin account, and has successfully federated with one other Pavillion instance. It should take about thirty minutes if your DNS is already in place. There is a fully detailed [Installation](./installation) guide if you want to know the details of what is happening under the hood.

## What you need before you start

- **A domain you control.** A subdomain is fine — `events.example.org` works. The domain is your instance's identity on the federated network; once events have flown, you can't change it without breaking every existing federation relationship. Pick a domain you'll be comfortable with in five years.
- **DNS that already resolves.** Point the domain's A or AAAA record at your server's public IP *before* you run the deploy. The script doesn't check, and federation handshakes won't work if other instances can't reach you at the name you claim.
- **A Linux server with at least 1 GB of RAM.** If it's a freshly-imaged Debian or Ubuntu box, `bin/provision.sh` will install Docker, set up a deploy user, and harden SSH for you — see the [fresh server path](#fresh-server-use-the-provisioning-script) below. If you're putting Pavillion on a server you already run, you'll want Docker and Docker Compose installed and working (`docker compose version` should print a version). Podman with the compose plugin works too if your shop doesn't run Docker.
- **A decision about TLS.** Either (a) you'll use the bundled standalone Caddy that ships with Pavillion's Compose file and let it get a Let's Encrypt cert automatically, or (b) you'll put your own http proxy (nginx, Caddy, etc) in front. The bundled option is simpler and right for a dedicated Pavillion server. Bring-your-own is right when your server hosts other apps and already has a proxy. The Quickstart assumes you'll used the bundled Caddy — if you're bringing your own, jump to [Reverse proxy and TLS](./reverse-proxy-and-tls) for the config snippets before continuing.
- **Ports 80 and 443 open** on your server's firewall to the public internet. Caddy needs both — 80 for ACME HTTP-01 challenges, 443 for the actual traffic.

::: tip <Lightbulb /> A note on DNS propagation.
DNS changes can take minutes to propagate, sometimes longer. If you've *just* added the A record, the deploy might come up green while Caddy is still failing to get a cert behind the scenes. Wait for `dig +short events.example.org` to return your server's IP from the server itself *and* from somewhere off-network before running the deploy.
:::

## Run the deploy

Two paths through this step, depending on what's on the server.

### Fresh server: use the provisioning script

If the server is a freshly-imaged Debian or Ubuntu box with nothing else on it, `bin/provision.sh` does the rest of the setup in one shot: creates a non-root deploy user, hardens SSH, configures the firewall (UFW, allowing only 22/80/443), installs Docker, clones the repo into `/opt/pavillion`, brings up the app, and enables the bundled standalone Caddy so your domain answers on 443 with a Let's Encrypt cert. Run it from your local machine — the provisioning script fetches itself onto the server via curl, so you don't need the Pavillion repo cloned locally first:

```bash
ssh -i ~/.ssh/YOUR_SSH_KEY root@YOUR_SERVER "curl -fsSL https://raw.githubusercontent.com/stephenhoward/pavillion/main/bin/provision.sh | bash -s -- --standalone --domain=yourdomain.example.org"
```

If you do already have the repo locally — you're upgrading another instance, or you've been hacking on Pavillion — you can pipe the local copy instead: `ssh root@your-server 'bash -s -- --standalone --domain=events.example.org' < bin/provision.sh`. Same result.

The script needs your SSH public key already on the server's `root` account before you run it — `ssh-copy-id root@your-server` first if it isn't there. It refuses to continue otherwise, because the next thing it does is disable root SSH and password auth. From here on, you'll log into the server as `pavillion@your-server`, not `root`.

When the script reports `Provisioning Complete`, the app containers are up, the standalone Caddy is fetching a TLS certificate, and `https://your-domain` should load within a few seconds. Drop `--standalone` if you'd rather put your own nginx, Caddy, or Traefik in front — without it the app listens on `127.0.0.1:3000` and waits for you to wire up your own proxy. See [Reverse proxy and TLS](./reverse-proxy-and-tls) for the bring-your-own snippets.

Skip to [Create your first admin account](#create-your-first-admin-account) below once `https://your-domain` loads.

### Existing server: clone and run the deploy script directly

If the server already has its own deploy user, firewall, and Docker setup — or you don't want SSH hardening applied by the provisioning script — clone the repo and run `bin/deploy.sh` yourself:

```bash
git clone https://github.com/stephenhoward/pavillion.git
cd pavillion
COMPOSE_PROFILES=standalone bin/deploy.sh
```

The script detects this is a fresh install (no `.env` present), generates every secret it needs, and prompts for your domain:

```
Enter your domain name (e.g., events.example.org):
```

Type the domain you set DNS for and press Enter. The script writes `config/local.yaml` with that domain substituted in, pulls the container images, brings them up, and polls the `/health` endpoint until the app reports ready. About two to five minutes on a typical server, most of which is image pulls on the first run.

When you see `[OK] Deploy complete.`, the app is up and the bundled Caddy is fetching a TLS certificate. Open `https://your-domain` in a browser. The first load may take a few seconds while Caddy finishes the ACME handshake.

Drop the `COMPOSE_PROFILES=standalone` if you're putting your own proxy in front instead — see [Reverse proxy and TLS](./reverse-proxy-and-tls) for the config snippets.

::: tip <Lightbulb /> A note on what gets written to disk.
Either path writes the same files: a `.env` file (your secrets, mode 600), a `secrets/` directory (the same secrets as files, for containers that read them by path), a `.deploy-state` file (tracks which secrets have ever been provisioned, used by the upgrade path), and `config/local.yaml` (your instance-specific config). Back these up after the next step — see [Backups](./backups). Losing `.env` or `secrets/` means losing your federation identity.
:::

## Create your first admin account

The first time a browser hits your instance, it gets redirected to `/setup`. This page only exists when the database has no admin accounts yet — once you create the first one, the route returns 404 forever.

Pick an email address you actually read and a strong password. The setup page creates an account with admin role and signs you in. You land on the dashboard.

::: tip <Lightbulb /> A note on the first email address.
Use a mailbox you check daily. Password resets, account applications, and moderation and federation-incident notifications go there.
:::

## A one-event smoke test

The one-event smoke test confirms the app is wired end-to-end — database writes, the public site renders, the URL handle resolves, images upload — before you invite anyone else in.

From the dashboard:

1. Create a calendar. Pick a short, durable handle — see [Customize your calendar's identity](/guides/calendar-owners/identity) for the longer version of why. A throwaway calendar named `test` is fine for the smoke test; you can delete it later.
2. Publish one event. Any title, any future date. Save it.
3. Open the calendar's public URL: `https://your-domain/view/<handle>`. Confirm the event renders, the page loads cleanly, and the link in the address bar is the `https://` version with a valid certificate.

If the public page renders, the app, database, reverse proxy, and TLS are all working. If the page is blank, blocked, or the cert is invalid, stop here — fix the basics before going further. The [Troubleshooting](./troubleshooting) guide has the diagnostic loop.

## Confirm federation works

This is the part that's easy to silently get wrong. The app can come up green, the calendar can render, and federation can be completely broken because the app can't reach the network or your domain doesn't resolve from outside your network. So test it.

The fastest test is to follow another live Pavillion instance and confirm at least one event arrives. You'll need the handle of a calendar on another instance to follow — ask in the community channels if you don't have one yet, or set up a second test instance and federate the two.

From your dashboard, find the **Follow a calendar** field, type the handle (`somecalendar@their-instance.example`), and submit. Within a few seconds the follow should be accepted; within a few seconds more, any recent public events from that calendar should appear in your view of theirs.

If nothing arrives within a minute or two, head to [Testing federation](./testing-federation). The most common causes are DNS that resolves locally but not externally, TLS that isn't trusted by the other instance, and clock skew breaking signature verification.

## What's next

You now have a working Pavillion instance with one admin account and confirmed federation. Before you open it up to other people:

- **[Email](./email).** Configure SMTP before anyone signs up — password resets and invitations need a working transport. Without this, any user who forgets their password is locked out.
- **[Backups](./backups).** Back up `.env`, `secrets/`, `config/local.yaml`, and the Postgres data volume. Losing the secrets means losing your federation identity — every other instance has cached your public key under that domain, and a new key on the same domain looks like an impostor.
- **[What your instance is for](./what-your-instance-is-for) and [Who gets a calendar](./who-gets-a-calendar).** Before you invite the first calendar owner, decide what you're hosting and for whom. These are the questions nobody else can answer for you.
- **[Federation policy](./federation-policy).** What you accept from the wider network, and what you don't.

And to fill in what this guide glossed over:

- **[Installation](./installation)** — what `bin/deploy.sh` actually did, container by container.
- **[Configuration](./configuration)** — the settings worth tuning beyond the defaults.
- **[Reverse proxy and TLS](./reverse-proxy-and-tls)** — the bring-your-own-proxy path, and what the bundled Caddy is doing on your behalf.

## Things that trip people up

**Re-running `bin/deploy.sh` on an existing install.** It detects an existing `.env` and switches to upgrade mode — it doesn't re-prompt for the domain and doesn't reset your data. That's by design. If you actually need to start over, delete `.env`, `secrets/`, `.deploy-state`, `config/local.yaml`, and the Postgres data volume, then re-run. There's no undo.

**Running `bin/provision.sh` without an SSH key already on `root`.** The script checks `/root/.ssh/authorized_keys` and refuses to run if it's empty, because its next move is to disable password auth and root login — if you don't have a key on file, the script would lock you out the moment it finished. Run `ssh-copy-id root@your-server` from your local machine before piping the script over.

**Dropping `--standalone` without setting up your own proxy.** Without the flag, `bin/provision.sh` leaves the app on the host's `127.0.0.1:3000` with no TLS terminator in front. The firewall opens 80 and 443 but nothing is listening on them, so `https://your-domain` will time out. If you meant to bring your own proxy, point it at `127.0.0.1:3000` next. If you didn't, re-run provisioning with `--standalone` — or, on the server, append `COMPOSE_PROFILES=standalone` to `/opt/pavillion/.env` and run `./bin/deploy.sh` again.

**The domain you typed at the prompt is now baked in.** Federation identity is the domain — other instances cache your public key under it. Changing the domain after events have federated breaks every existing relationship. If you got the domain wrong on first install and *no events have federated yet*, the cleanest fix is the start-over path above. After federation has happened, you live with the domain you picked.

**The bundled Caddy can't share ports with another proxy.** If your server already has nginx or another reverse proxy bound to 80 and 443, the standalone Caddy container will fail to start. Either stop the other proxy, or skip `COMPOSE_PROFILES=standalone` and follow [Reverse proxy and TLS](./reverse-proxy-and-tls) to put your existing proxy in front of Pavillion instead.

**DNS resolves from inside your network but not from outside.** Split-horizon DNS, a hosts-file entry you forgot about, or a firewall that lets you reach the server from your office but blocks the public internet — any of these will make federation look broken in confusing ways. The other instance can't follow you back if it can't reach your domain. Test from somewhere off-network before assuming the wiring is right.
