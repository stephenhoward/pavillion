# Pavillion Deployment Guide

This guide covers deploying Pavillion using Docker or Podman containers.

## Prerequisites

- **Docker** (20.10+) and **Docker Compose** (v2.0+), or
- **Podman** (4.0+) with **podman-compose** (see [Podman Compatibility](#podman-compatibility))
- A server with at least 1GB RAM
- A domain name with DNS configured
- A reverse proxy for SSL termination (nginx, Caddy, or Traefik recommended)

## Quick Start (5-Minute Deployment)

For experienced users who want to get running quickly:

```bash
# 1. Clone the repository (or download release)
git clone https://github.com/stephenhoward/pavillion.git
cd pavillion

# 2. Run the deploy script (generates secrets, prompts for domain, starts containers)
bin/deploy.sh

# 3. Check that containers are running
docker compose ps
```

The application will be available at `http://localhost:3000` (configure your reverse proxy for production).

## Step-by-Step First Deployment

### Step 1: Get the Pavillion Files

Clone the repository or download the latest release:

```bash
git clone https://github.com/stephenhoward/pavillion.git
cd pavillion
```

### Step 2: Run bin/deploy.sh

```bash
bin/deploy.sh
```

The deploy script will:

1. Detect that `.env` is absent → install mode.
2. Generate all required secrets.
3. Prompt for your domain name.
4. Create `config/local.yaml` from the example.
5. Pull the latest container images.
6. Start the containers.
7. Poll `/health` until the app is ready.

Save the generated secrets to your password manager. They are written
to `.env` with mode 600 (owner-only), and also to individual files
under `secrets/` for Docker secrets integration.

### Step 3: Configure Your Instance

`bin/deploy.sh` creates `config/local.yaml` from the example template and
fills in your domain. Edit it to configure email and any other instance
settings:

```yaml
# Your instance domain (required, set by deploy.sh)
domain: "calendar.example.org"

# Email configuration for password resets and invitations
mail:
  transport: smtp
  from: noreply@calendar.example.org
  settings:
    host: smtp.example.org
    port: 587
    secure: false
```

To monitor the startup process at any time:

```bash
docker compose logs -f app
```

You should see output showing:
1. Docker secrets being loaded
2. Database connection being established
3. Migrations running (on first start)
4. Application starting and listening on port 3000

### Step 4: Verify the Deployment

Check that containers are running:

```bash
docker compose ps
```

You should see four containers running:
- `pavillion-app` - The application server
- `pavillion-worker` - The background job processor
- `pavillion-autoheal` - Container health monitor and auto-restarter
- `pavillion-db` - The PostgreSQL database

Test the health endpoint:

```bash
curl http://localhost:3000/health
```

### Step 5: Configure Reverse Proxy

Pavillion should be served behind a reverse proxy that handles SSL termination. Example configurations:

**Nginx:**
```nginx
server {
    listen 443 ssl http2;
    server_name calendar.example.org;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**Caddy:**
```caddy
calendar.example.org {
    reverse_proxy localhost:3000
}
```

### Standalone Mode (Built-in HTTPS)

If you don't already have a reverse proxy, Pavillion includes an optional built-in [Caddy](https://caddyserver.com/) reverse proxy that provides automatic HTTPS via Let's Encrypt.

**Enable standalone mode** by setting `COMPOSE_PROFILES` in your `.env` file:

```bash
DOMAIN=calendar.example.org
COMPOSE_PROFILES=standalone
```

Or pass the profile flag directly:

```bash
docker compose --profile standalone up -d
```

**Configuration requirements:**

1. **Set `DOMAIN`** in `.env` to your public domain name. This must match the `domain:` value in `config/local.yaml`.

2. **Restrict direct app access** (recommended) so traffic goes through Caddy:
   ```bash
   APP_PORT=127.0.0.1:3000
   ```

3. **Ensure ports 80 and 443 are available** on your host. If another service already uses these ports, standalone mode won't work — use the default mode with your existing reverse proxy instead.

**How it works:**

- Caddy automatically obtains and renews Let's Encrypt certificates for your domain
- Certificates are persisted in the `pavillion-caddy-data` volume — avoid `docker compose down -v` in routine operations or you'll lose cached certificates
- When `DOMAIN=localhost`, Caddy automatically disables HTTPS, suitable for local development only

**Verify standalone mode is running:**

```bash
docker compose ps
```

You should see four containers: `pavillion-app`, `pavillion-worker`, `pavillion-db`, and `pavillion-caddy`.

#### Per-Instance Caddy Snippets (`caddy-extras.d/`)

The standalone Caddyfile imports `*.caddyfile` snippets from `caddy-extras.d/` before the default app proxy. The directory is gitignored (only `caddy-extras.d/README.md` is tracked), so production deploys ship with no snippets and the import is a no-op. Use this extension point when a single instance needs a Caddy handler that does not belong in the upstream config — for example, a staging server that exposes an auto-deploy webhook listener on the host:

```caddy
# caddy-extras.d/hooks.caddyfile (gitignored, per-instance only)
handle /hooks/* {
    reverse_proxy host.docker.internal:9000
}
```

Snippets must contain only directives valid inside a site block (`handle`, `route`, `redir`, `respond`, etc.). After editing, validate with:

```bash
docker compose --profile standalone exec caddy caddy validate --config /etc/caddy/Caddyfile
```

## Secrets Management

### How Secrets Work

Pavillion uses a layered approach to secrets management:

1. **Deploy script generates secrets**: The `bin/deploy.sh` script creates unique, cryptographically secure secrets for each deployment.

2. **Dual storage for flexibility**:
   - `.env` file: Contains secrets as environment variables (simple approach)
   - `secrets/` directory: Contains individual secret files for Docker secrets (enhanced security)

3. **Docker secrets integration**: The container entrypoint reads secrets from files mounted at `/run/secrets/` and exports them as environment variables. This means secrets are never visible in `docker inspect` output.

### Backup Your Secrets

**CRITICAL**: Always backup your secrets to a password manager (Bitwarden, 1Password, LastPass, etc.)

Secrets to backup:
- `JWT_SECRET` - API authentication tokens
- `SESSION_SECRET` - Session cookies
- `DB_PASSWORD` - Database access

If you lose these secrets:
- `JWT_SECRET`: All existing API tokens become invalid; users must log in again
- `SESSION_SECRET`: All existing sessions become invalid; users must log in again
- `DB_PASSWORD`: You cannot access your database (data loss if not backed up)

### Security Recommendations

1. **Use full-disk encryption**: For production servers, enable full-disk encryption (LUKS on Linux, FileVault on macOS). This protects secrets at rest if the server is physically compromised.

2. **Restrict file permissions**: The deploy script creates files with `chmod 600` (owner read/write only). Verify permissions:
   ```bash
   ls -la .env secrets/
   ```

3. **Don't commit secrets**: The `.gitignore` is configured to exclude `.env` and `secrets/*`. Never commit these to version control.

4. **Rotate secrets periodically**: See [Secret Rotation Guide](secret-rotation.md) for procedures.

### Manual Secret Generation

If you prefer to generate secrets manually instead of using `bin/deploy.sh`:

```bash
# Generate a secure secret
openssl rand -base64 32

# Create .env file
cat > .env << EOF
JWT_SECRET=$(openssl rand -base64 32)
SESSION_SECRET=$(openssl rand -base64 32)
DB_PASSWORD=$(openssl rand -base64 32)
DB_NAME=pavillion
DB_USER=pavillion
EOF
chmod 600 .env

# Create secrets directory for Docker secrets
mkdir -p secrets
echo -n "$(grep JWT_SECRET .env | cut -d= -f2)" > secrets/jwt_secret.txt
echo -n "$(grep SESSION_SECRET .env | cut -d= -f2)" > secrets/session_secret.txt
echo -n "$(grep DB_PASSWORD .env | cut -d= -f2)" > secrets/db_password.txt
chmod 600 secrets/*.txt
```

## Environment Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | - | Secret for signing JWT tokens |
| `SESSION_SECRET` | Yes | - | Secret for signing session cookies |
| `DB_PASSWORD` | Yes | - | PostgreSQL database password |
| `DB_USER` | No | `pavillion` | PostgreSQL username |
| `DB_NAME` | No | `pavillion` | PostgreSQL database name |
| `APP_PORT` | No | `3000` | Host port to expose the application |
| `DB_WAIT_TIMEOUT` | No | `30` | Seconds to wait for database on startup |
| `S3_BUCKET` | No | - | S3 bucket name (if using S3 storage) |
| `S3_REGION` | No | - | S3 region (e.g., `us-east-1`) |
| `S3_ACCESS_KEY` | No | - | S3 access key ID |
| `S3_SECRET_KEY` | No | - | S3 secret access key |
| `S3_ENDPOINT` | No | - | Custom S3 endpoint (for DigitalOcean Spaces, MinIO) |
| `DOMAIN` | No | `localhost` | Public domain name (required for standalone mode) |
| `COMPOSE_PROFILES` | No | - | Set to `standalone` to enable built-in Caddy proxy |
| `PAVILLION_IMAGE_TAG` | No | `latest` | Tag of the `ghcr.io/stephenhoward/pavillion` image to deploy. Set to `main` on staging to track unreleased builds, or pin to a specific version (e.g., `v1.2.3`) for reproducible production deploys. |
| `SMTP_HOST` | No | - | SMTP server hostname |
| `SMTP_PORT` | No | `587` | SMTP server port |
| `SMTP_USER` | No | - | SMTP authentication username |
| `SMTP_PASSWORD` | No | - | SMTP authentication password |

## Port Reference

| Port | Service | Description |
|------|---------|-------------|
| 3000 | Application | HTTP application server (map to 80/443 via reverse proxy) |
| 3001 | Worker | Health check endpoint (container-internal only, not exposed to host) |
| 80 | Caddy | HTTP (standalone mode only, redirects to HTTPS) |
| 443 | Caddy | HTTPS (standalone mode only, automatic Let's Encrypt) |
| 5432 | PostgreSQL | Database (internal only, not exposed by default) |

## Volume Reference

| Volume | Container Path | Description |
|--------|---------------|-------------|
| `pavillion-db` | `/var/lib/postgresql/data` | PostgreSQL database files |
| `pavillion-media` | `/app/storage/media` | Uploaded media files (if using local storage) |
| `./config/local.yaml` | `/app/config/local.yaml` | Instance configuration (bind mount) |
| `pavillion-caddy-data` | `/data` | Caddy TLS certificates and state (standalone mode) |
| `pavillion-caddy-config` | `/config` | Caddy runtime configuration (standalone mode) |

## Health Monitoring & Auto-Recovery

Pavillion includes automatic health monitoring and container recovery using [autoheal](https://github.com/willfarrell/docker-autoheal). When a monitored container becomes unhealthy, autoheal automatically restarts it without manual intervention.

### How It Works

The `pavillion-autoheal` container (`willfarrell/autoheal:1.2.0`) watches Docker health events and restarts any container that Docker reports as unhealthy. It runs as a lightweight Alpine-based sidecar (~5 MB) alongside the application stack.

Monitoring is **scoped by label**: only containers with the `autoheal=true` label are monitored. In the default Compose configuration, this includes the `app` and `worker` containers. The database and Caddy containers are not monitored by autoheal and rely on their own `restart: unless-stopped` policies.

### Health Check Endpoints

Each monitored container has a Docker-native healthcheck that polls an HTTP endpoint:

- **App container** (`pavillion-app`): `GET http://localhost:3000/health` -- the same public health endpoint used for deployment verification. Checked every 30 seconds with a 60-second start period.
- **Worker container** (`pavillion-worker`): `GET http://localhost:3001/health` -- a minimal internal health server bound to `127.0.0.1:3001`. This port is container-internal only and is not exposed to the host or other containers. Checked every 30 seconds with a 120-second start period (longer because the worker waits for the app to be healthy first).

### Autoheal Configuration

The autoheal service uses the following settings:

| Setting | Value | Description |
|---------|-------|-------------|
| `AUTOHEAL_CONTAINER_LABEL` | `autoheal` | Only restart containers with this label set to `true` |
| `AUTOHEAL_INTERVAL` | `30` | Seconds between health check polls |
| `AUTOHEAL_START_PERIOD` | `120` | Seconds to wait after autoheal starts before acting on unhealthy containers |

### Viewing Restart Events

Autoheal logs every restart action to stdout. To check whether any containers have been restarted:

```bash
# View autoheal logs
docker compose logs autoheal

# Follow autoheal logs in real time
docker compose logs -f autoheal
```

You can also check the health status of all containers:

```bash
docker compose ps
```

The `STATUS` column will show `healthy`, `unhealthy`, or `health: starting` for containers with healthchecks configured.

### No External Alerting

Autoheal is a self-healing mechanism, not a monitoring or alerting system. Restart events are logged to the container's stdout and are visible through `docker compose logs`, but no external notifications are sent. If you need alerting for persistent failures, consider adding an external monitoring tool that watches container health status.

### Docker Socket Security Note

Autoheal requires read-write access to the Docker socket (`/var/run/docker.sock`) so it can issue restart commands to the Docker daemon. This is a common pattern for container management tools but grants the autoheal container the ability to manage other containers on the host.

This is an accepted trade-off for automated recovery. To limit exposure:

- Autoheal only acts on containers with the `autoheal=true` label, not all containers on the host
- The autoheal image is pinned to a specific version (`1.2.0`) to avoid unexpected changes from upstream
- The container runs with `restart: unless-stopped` so it recovers from its own failures

If your security policy does not permit Docker socket access from containers, you can remove the `autoheal` service from `docker-compose.yml` and rely on Docker's built-in `restart: unless-stopped` policy for basic recovery. This provides restart-on-crash but not restart-on-unhealthy behavior.

## Podman Compatibility

Pavillion is fully compatible with Podman as a Docker alternative. Use `podman-compose` as a drop-in replacement:

```bash
# Install podman-compose
pip install podman-compose

# Use podman-compose instead of docker compose
podman-compose up -d
podman-compose logs -f app
podman-compose down
```

All Docker Compose commands work the same with `podman-compose`. The container images are OCI-compliant and work with both runtimes.

## Troubleshooting

### Container won't start

Check the logs for errors:

```bash
docker compose logs app
```

Common issues:
- **Secrets not generated**: Run `bin/deploy.sh` to generate secrets
- **Database password not set**: Ensure `DB_PASSWORD` is set in `.env`
- **Port already in use**: Change `APP_PORT` in `.env` or stop the conflicting service
- **Insufficient memory**: Ensure at least 1GB RAM is available

### "JWT_SECRET must be set in production" error

This error occurs when running in production mode without proper secrets configured:

```bash
# Generate secrets with the deploy script
bin/deploy.sh

# Or manually set secrets in .env
```

### Database connection failures

If the application can't connect to the database:

```bash
# Check database container is running
docker compose ps db

# Check database logs
docker compose logs db

# Verify database is healthy
docker compose exec db pg_isready -U pavillion
```

### Migration failures

If migrations fail, the container will exit. Check the logs for specific errors:

```bash
docker compose logs app | grep -i migration
```

To retry migrations after fixing the issue:

```bash
docker compose restart app
```

### Reset everything and start fresh

To completely reset the deployment (WARNING: this deletes all data):

```bash
docker compose down -v
bin/deploy.sh  # Generate new secrets and restart
```

## Next Steps

- [Configuration Reference](configuration.md) - Full configuration options
- [Secret Rotation Guide](secret-rotation.md) - How to rotate secrets
- [Upgrading Guide](upgrading.md) - How to upgrade to new versions
- [Contributing](CONTRIBUTING.md) - Get involved in development
