---
description: Monitor a Pavillion instance honestly — healthchecks, autoheal, container logs, and the gap where external alerting belongs but isn't built in.
---

# Monitoring and logs

> Status: placeholder. This guide will be written before launch.

Pavillion ships with enough self-healing to recover from most short-lived problems on its own — Docker healthchecks plus the `autoheal` sidecar that restarts unhealthy containers. What it doesn't ship is alerting. If your app is down at 3am, nothing is going to wake you up unless you wire that part yourself. This guide is honest about both halves.

## Planned scope

- The healthcheck endpoints: `app` on `/health`, `worker` on its internal port, what each one actually verifies
- How `autoheal` works, what containers it watches (the ones with `autoheal=true`), what it doesn't watch and why
- Reading container logs: `docker compose logs -f app`, what to grep for, the patterns that indicate database trouble vs. federation trouble vs. email trouble
- What Pavillion doesn't have: built-in alerting. Either you watch `docker compose ps` manually, or you point an external monitor at `/health`, or you accept that you'll find out when a user emails you
- A short list of external monitoring options worth considering for community-scale instances (Uptime Kuma, Healthchecks.io, Better Stack) — short on opinions about which, longer on what to watch for
- Log retention and rotation. The default is "until the disk fills up." That's almost never what you want
