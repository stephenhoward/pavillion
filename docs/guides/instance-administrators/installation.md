---
description: Full first-deployment walkthrough for Pavillion — what each container does, what bin/deploy.sh actually generates, and what to verify before letting people sign up.
---

# Install a Pavillion instance

> Status: placeholder. This guide will be written before launch.

The detailed install — what the [Quickstart](./quickstart) glossed over. Covers the container topology so you know what's running and why, what `bin/deploy.sh` writes to disk on a fresh install, and the difference between install mode and upgrade mode.

## Planned scope

- Container topology: `pavillion-app` (the web server), `pavillion-worker` (background jobs and outbound federation), `pavillion-db` (PostgreSQL), `pavillion-autoheal` (restarts unhealthy containers), and optionally `pavillion-caddy` (standalone reverse proxy)
- Why each container exists and what fails if it's not running
- What `bin/deploy.sh` does in install mode: generates secrets, prompts for your domain, writes `.env` and `config/local.yaml`, pulls images, starts containers, polls `/health`
- What to do when the script detects an existing `.env` (upgrade mode — see [upgrading](./upgrading))
- Verifying the install: `docker compose ps`, the `/health` endpoint, the first admin login
- Podman compatibility for sites that don't run Docker

This guide assumes you've worked through the [Quickstart](./quickstart) at least once or are comfortable running Docker Compose in production.
