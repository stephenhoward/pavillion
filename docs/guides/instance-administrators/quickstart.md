---
description: Bring up a Pavillion instance from a clean Linux server to a federating server with one admin account in about thirty minutes.
---

# Quickstart

> Status: placeholder. This guide will be written before launch.

The on-ramp for a new admin. Starts with a clean Linux server and ends with a Pavillion instance that's reachable on its domain, has one working admin account, and has successfully federated with one known instance to prove the wiring works. About thirty minutes if your DNS is already in place.

## Planned scope

- Prerequisites stated honestly — a domain, DNS that resolves, a server with at least 1 GB of RAM, and either an existing reverse proxy or willingness to use the bundled Caddy
- The `bin/deploy.sh` happy path: clone, run, answer the domain prompt, watch the health endpoint come up
- Creating your first admin account
- A one-event smoke test to confirm the site renders
- Following a known federating instance to confirm outbound federation works
- Where to go next: the [installation](./installation) guide for what `deploy.sh` actually did, [configuration](./configuration) for tuning, [email](./email) before anyone tries to sign up
