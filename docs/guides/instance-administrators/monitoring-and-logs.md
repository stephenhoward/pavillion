---
description: Monitor a Pavillion instance honestly — the metrics endpoint an external scraper can read, how to keep it private, and the healthcheck, autoheal and log topics still to come.
---

# Monitoring and logs

> Status: in progress. The metrics section below is complete. The healthcheck, autoheal and log-management topics listed under [Still to come](#still-to-come) are not written yet.

Pavillion ships with enough self-healing to recover from most short-lived problems on its own — Docker healthchecks plus the `autoheal` sidecar that restarts unhealthy containers. What it doesn't ship is alerting. If your instance is down at 3am, nothing is going to wake you up unless you wire that part yourself. However, Pavillion does give you is something you can wire to: a metrics endpoint that reports backup, disk, database and job-queue health in the format most monitoring tools already read. This guide can help you add monitoring so youfind out the backup disk is filling up from a graph than from a failed backup.

## Metrics for an external monitor

### What the endpoint serves

The `app` container serves [OpenMetrics](https://openmetrics.io/) text at `/metrics` on port **9464** — a second listener, separate from the application on port 3000. Every series starts with `pavillion_`:

| Series | What it tells you |
|--------|-------------------|
| `pavillion_backup_last_success_timestamp_seconds` | When the most recent verified database backup finished |
| `pavillion_backup_last_success_size_bytes` | How large that backup was |
| `pavillion_disk_total_bytes`, `pavillion_disk_free_bytes`, `pavillion_disk_used_bytes` | Filesystem usage, one sample per `volume` label: `backups` and `media` |
| `pavillion_disk_snapshot_timestamp_seconds` | When the background worker last measured a volume. Only `volume="backups"` carries it — see below |
| `pavillion_db_size_bytes` | The database's size on disk |
| `pavillion_queue_depth` | Background jobs waiting or running, one sample per `queue` label |
| `pavillion_queue_failed_jobs` | Background jobs that failed in the last 24 hours, per `queue` |

The backup volume is mounted on the worker container, not the app, so the worker measures it once an hour and the app reports the last reading. That's why the backups volume has a snapshot timestamp and the media volume, which the app measures live on every scrape, doesn't.

A series with nothing to report is **missing, not zero**. On a fresh instance the backup series appear after the first nightly backup and the `backups` disk series after the worker's first hourly check. On an instance that stores media in S3 the `volume="media"` samples never appear, because there's no local disk to measure.

Nothing in the endpoint describes your calendars, your events, or the people who visit them. No series or label is derived from any of those. By design, instance metrics are about system health, not service content.

These names are a stable contract: you'll put them in alert rules that live on your side, not ours. If one is ever renamed or removed, this guide will carry a deprecation note first.

### Private by default

Docker Compose never publishes port 9464 to the host. Only containers on the same Compose network can reach it — a scraper you run alongside Pavillion, for instance. That holds whether you use the bundled Caddy, your own proxy, or no proxy at all, and there's nothing to configure to get it.

The listener has **no built-in authentication**. Anyone who can reach the port can read it. That's fine while it stays unpublished, and it's the reason everything in [Exposing the metrics on purpose](#exposing-the-metrics-on-purpose) involves authentication.

The data exposed is operational, not personal: the endpoint carries no visitor data, but it does describe your instance's internals to whoever reads it — how close the disks are to full, how big the database is, whether background jobs are failing. The backup timestamp deserves particular care. To someone planning to damage the instance, it says how much data a destructive act right now would cost you, and when the next backup window falls.

Two settings in `config/local.yaml` (or their environment variables) shape the listener:

| Setting | Environment variable | Default |
|---------|----------------------|---------|
| `housekeeping.monitoring.metrics.port` | `METRICS_PORT` | `9464` |
| `housekeeping.monitoring.metrics.bindAddress` | `METRICS_BIND_ADDRESS` | `0.0.0.0` |

`0.0.0.0` is correct inside the container: a companion scraper on the Compose network has to be able to reach it, and the unpublished port is what keeps it private. If you run Pavillion directly on a host instead of in Docker, set the bind address to `127.0.0.1` — there, `0.0.0.0` puts an unauthenticated endpoint on every network the machine is attached to. Changing either setting never publishes the port. `housekeeping.monitoring.metrics.enabled: false` turns the listener off.

The project's reasoning for this posture is recorded in [DEC-017: Operational Telemetry Exposure](https://github.com/stephenhoward/pavillion/blob/main/docs/decisions/dec-017-operational-telemetry-exposure.md).

### When to use `/health` or the metrics port

They answer different questions, so point different watchers at them.

- **`/health` on port 3000** answers *is it up?* It returns a plain yes or no and nothing else, because it's public. Point an external uptime check at it — something running somewhere other than your server, through your normal domain.
- **The metrics port** answers *is it healthy?* Disk, backups, database, queues. Point a scraper at it from inside the Compose network.

The quick test: if the watcher lives outside your server, it gets `/health`. If it sits on the Compose network next to the app, it gets the metrics.

### Worked example: Prometheus as a companion container

Pavillion doesn't bundle or require a monitoring stack. The endpoint is the contract; which scraper reads it is your choice, and if you already run monitoring, point it at `app:9464` and skip this section. The example below uses Prometheus because it reads the format natively. Anything that speaks OpenMetrics works the same way.

The scraper lives in its own directory, as its own Compose project, outside the Pavillion checkout. That's deliberate: upgrading Pavillion replaces `docker-compose.yml`, and `./bin/deploy.sh` refuses to upgrade a checkout with stray files in it. A separate project that joins Pavillion's network from the outside survives both.

**1. Find Pavillion's network name.** Compose names the network after the project, which by default comes from the name of the directory you cloned into — `pavillion_default` for a checkout at `/opt/pavillion`, but don't assume it. Read the project name off the running app container and write it into a fresh directory:

```bash
mkdir -p ~/pavillion-monitoring && cd ~/pavillion-monitoring
PROJECT=$(docker inspect pavillion-app --format '{{index .Config.Labels "com.docker.compose.project"}}')
echo "PAVILLION_NETWORK=${PROJECT}_default" > .env
cat .env
```

**2. Write the scrape configuration** as `~/pavillion-monitoring/prometheus.yml`:

```yaml
global:
  scrape_interval: 60s

scrape_configs:
  - job_name: pavillion
    static_configs:
      - targets: ['app:9464']
```

**3. Write the Compose file** as `~/pavillion-monitoring/compose.yaml`:

```yaml
services:
  prometheus:
    image: prom/prometheus:v3.5.0
    restart: unless-stopped
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus-data:/prometheus
    ports:
      # Loopback only: the Prometheus UI has no authentication either.
      - "127.0.0.1:9090:9090"
    networks:
      - pavillion

networks:
  pavillion:
    name: ${PAVILLION_NETWORK}
    external: true

volumes:
  prometheus-data:
```

**4. Start it and check it's collecting:**

```bash
docker compose up -d
# Give it a minute for the first scrape, then:
curl -sG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=up{job="pavillion"}'
curl -sG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=pavillion_db_size_bytes'
```

The first query should come back with a value of `"1"` — the scraper reached the app. The second should show your database's size in bytes. To browse the Prometheus UI from your own machine, tunnel to it rather than publishing it: `ssh -L 9090:127.0.0.1:9090 you@your-server`, then open `http://localhost:9090`.

If the first query returns `"0"`, check the endpoint directly from the Pavillion checkout, which takes the scraper out of the picture:

```bash
cd /opt/pavillion
docker compose exec app node -e "fetch('http://localhost:9464/metrics').then(r => r.text()).then(console.log)"
```

**A note on what joining the network grants.** A container on Pavillion's Compose network can reach every service on it, not only the metrics port: the app's main listener, and PostgreSQL on port 5432. The database still asks for its password, but the network no longer stands in the way. That's an accepted trade-off for scraping from inside, and it's why the example is one scraper and not a full dashboard-and-alerting stack — every image you attach is one more thing with a route to your database. Run a scraper image you trust, pin its version as the example does rather than tracking `latest`, and update it on purpose.

### What to alert on first

Two alerts cover the failures you can't see any other way. How they reach you — email, chat, a pager — is your monitoring tool's job; Pavillion ships no rule files.

**First: the backup-disk snapshot going stale.**

```promql
time() - pavillion_disk_snapshot_timestamp_seconds{volume="backups"} > 7200
```

If the worker dies, the app keeps reporting the last disk reading it saw, and those numbers look healthy forever. The worker measures every hour, so a snapshot older than two hours means at least one check was missed. Keep the `volume="backups"` label in the expression: the disk series are keyed by volume, and an unlabelled rule quietly starts covering every volume that gains a snapshot later, with a threshold chosen for this one.

**Second: the scrape itself failing.**

```promql
up{job="pavillion"} == 0
```

When the scraper can't reach the app, every other alert goes silent with it. This one is the alert that tells you the others can't fire.

### Exposing the metrics on purpose

If your scraper lives somewhere else — a monitoring server you already run for other things — you'll need to open a path to the endpoint. Route it through your reverse proxy with authentication. Publish the port directly only when the scraper sits on a network you control.

::: warning Never expose the metrics endpoint without authentication.
It has none of its own. An open metrics route tells anyone who finds it when your backups run and how full your disks are.
:::

**Through the bundled Caddy (preferred).** The route inherits Caddy's TLS, so the credentials and the metrics both travel encrypted. From the Pavillion checkout, generate a password hash — the command prompts for the password, so it stays out of your shell history:

```bash
cd /opt/pavillion
docker compose --profile standalone exec caddy caddy hash-password
```

Save the following as `caddy-extras.d/metrics.caddyfile`, with the hash in place of the placeholder:

```caddy
handle /_metrics {
	basic_auth {
		scraper PASTE_THE_HASH_HERE
	}
	rewrite * /metrics
	reverse_proxy app:9464
}
```

Validate and restart Caddy:

```bash
docker compose --profile standalone exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose --profile standalone restart caddy
```

Your remote scraper then reads `https://your-domain/_metrics` with the username `scraper` and that password. To narrow it further, add a `remote_ip` matcher with your scraper's address alongside the path. Snippets in `caddy-extras.d/` are gitignored, so the route survives upgrades.

::: tip <Lightbulb /> A note on the underscore.
A calendar can be named `metrics`, and its public page lives at `/metrics` on your domain. A route there would hide that page. No calendar name can start with `_`, so `/_metrics` can never collide with one.
:::

If you run your own proxy on the host instead of the bundled Caddy, it sits outside the Compose network and can't reach `app:9464`, so it needs the port published to loopback first — the next variant — and then the same shape of route: a path that can't be a calendar name, authentication, and TLS.

**By publishing the port.** This serves the metrics as plain HTTP, with no TLS and no password, so where it's published is the only protection it has. Bind it to loopback or to a private interface — a VPN or internal-network address — never to all interfaces. Create `docker-compose.override.yml` in the Pavillion checkout, and tell git to ignore it so `./bin/deploy.sh` doesn't treat it as an uncommitted change:

```yaml
services:
  app:
    ports:
      - "127.0.0.1:9464:9464"
```

```bash
cd /opt/pavillion
echo docker-compose.override.yml >> .git/info/exclude
./bin/deploy.sh
```

Replace `127.0.0.1` with a private address if the scraper is elsewhere on a network you control. Don't rely on a host firewall to cover a port published on every interface: Docker inserts its own rules ahead of UFW's, so a UFW rule won't stop traffic to a published port.

Whichever route you choose, glance at your proxy's access log for that path now and then. A scrape from an address you don't recognize is how you find out a credential has leaked.

### Things that trip people up

**The backup-snapshot alert never fires on a new instance.** The expression above compares against a series that doesn't exist until the worker's first hourly check, and a missing series raises nothing. If the worker never comes up at all, the alert stays quiet forever. Once the instance has been running for more than an hour, `absent(pavillion_disk_snapshot_timestamp_seconds{volume="backups"})` catches that case.

**`docker compose down` on Pavillion while the scraper is attached.** Compose can't remove a network that another project's container is still using, so the command complains about the network. Stop the scraper first (`docker compose down` in `~/pavillion-monitoring`), then take Pavillion down, then bring the scraper back up after Pavillion is running again — a recreated network is a new network, and the scraper has to rejoin it. Routine upgrades through `./bin/deploy.sh` don't remove the network, so they don't hit this.

**Expecting zeros on a fresh install.** Missing backup series mean no backup has run yet, not that something's broken. Don't write alerts that treat absence and zero as the same thing.

## Still to come

These topics are planned for this guide and not written yet:

- The healthcheck endpoints: `app` on `/health`, `worker` on its internal port, what each one actually verifies
- How `autoheal` works, what containers it watches (the ones with `autoheal=true`), what it doesn't watch and why
- Reading container logs: `docker compose logs -f app`, what to grep for, the patterns that indicate database trouble vs. federation trouble vs. email trouble
- What Pavillion doesn't have: built-in alerting. Either you watch `docker compose ps` manually, or you point an external monitor at `/health`, or you accept that you'll find out when a user emails you
- A short list of external monitoring options worth considering for community-scale instances (Uptime Kuma, Healthchecks.io, Better Stack) — short on opinions about which, longer on what to watch for
- Log retention and rotation. The default is "until the disk fills up." That's almost never what you want
