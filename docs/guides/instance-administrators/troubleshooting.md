---
description: Diagnose common Pavillion failures — container start failures, database connection errors, federation silence, email not sending — by symptom, with the underlying cause spelled out.
---

# Troubleshooting

> Status: placeholder. This guide will be written before launch.

A symptom-indexed troubleshooting guide. Each entry names the visible failure, the underlying cause, and the fix. The aim is to teach you to read the symptom — not to memorize incantations.

## Planned scope

- **Container won't start.** Common causes: secrets missing, database password not set, port collision, migrations failed mid-run. How to read `docker compose logs app` to tell which
- **App container restarts in a loop.** Usually a startup probe failing or a runtime crash that autoheal is recovering from. Where to look in the logs to tell which
- **"JWT_SECRET must be set in production" or similar.** The secrets pipeline didn't run, or a `_FILE` variable points somewhere the file doesn't exist
- **Database connection failures.** Either the database container isn't healthy, the password is wrong, or the app started before the database was ready
- **Migrations failed.** What to do when a migration is partway through. When to retry, when to restore from backup
- **Email not sending.** SMTP credentials wrong, or right but blocked at the provider, or right but landing in spam (see [email](./email))
- **Federation looks broken.** Outbound is the worker container's job; inbound depends on your domain being reachable and your TLS being valid. The diagnostic loop in [testing federation](./testing-federation)
- **Health endpoint returns 500.** Read the app logs; the health check is usually telling you about a downstream dependency
- **"Reset everything and start fresh"** — the nuclear option, what it deletes, when it's the right call
