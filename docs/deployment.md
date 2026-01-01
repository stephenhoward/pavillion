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
git clone https://github.com/pavillion/pavillion.git
cd pavillion

# 2. Run the setup script to generate secure secrets
./bin/setup.sh

# 3. Configure your instance
cp config/local.yaml.example config/local.yaml
# Edit config/local.yaml with your domain and email settings

# 4. Start the application
docker compose up -d

# 5. Check that containers are running
docker compose ps
```

The application will be available at `http://localhost:3000` (configure your reverse proxy for production).

## Step-by-Step First Deployment

### Step 1: Get the Pavillion Files

Clone the repository or download the latest release:

```bash
git clone https://github.com/pavillion/pavillion.git
cd pavillion
```

### Step 2: Generate Secrets with Setup Script

Run the setup script to automatically generate secure secrets:

```bash
./bin/setup.sh
```

The setup script will:
1. Generate cryptographically secure secrets (JWT, session, database password)
2. Create a `.env` file with secure permissions
3. Create `secrets/` directory with individual secret files for Docker secrets
4. Display the generated secrets for backup

**IMPORTANT**: Save the displayed secrets to a password manager immediately. If you lose these secrets, you will lose access to your data.

### Step 3: Configure Your Instance

Copy the example configuration file:

```bash
cp config/local.yaml.example config/local.yaml
```

Edit `config/local.yaml` and configure your instance:

```yaml
# Your instance domain (required)
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

### Step 4: Start the Application

Start all containers in the background:

```bash
docker compose up -d
```

Monitor the startup process:

```bash
docker compose logs -f app
```

You should see output showing:
1. Docker secrets being loaded
2. Database connection being established
3. Migrations running (on first start)
4. Application starting and listening on port 3000

### Step 5: Verify the Deployment

Check that containers are running:

```bash
docker compose ps
```

You should see two containers running:
- `pavillion-app` - The application server
- `pavillion-db` - The PostgreSQL database

Test the health endpoint:

```bash
curl http://localhost:3000/health
```

### Step 6: Configure Reverse Proxy

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

## Secrets Management

### How Secrets Work

Pavillion uses a layered approach to secrets management:

1. **Setup script generates secrets**: The `./bin/setup.sh` script creates unique, cryptographically secure secrets for each deployment.

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

2. **Restrict file permissions**: The setup script creates files with `chmod 600` (owner read/write only). Verify permissions:
   ```bash
   ls -la .env secrets/
   ```

3. **Don't commit secrets**: The `.gitignore` is configured to exclude `.env` and `secrets/*`. Never commit these to version control.

4. **Rotate secrets periodically**: See [Secret Rotation Guide](secret-rotation.md) for procedures.

### Manual Secret Generation

If you prefer to generate secrets manually instead of using `bin/setup.sh`:

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
| `SMTP_HOST` | No | - | SMTP server hostname |
| `SMTP_PORT` | No | `587` | SMTP server port |
| `SMTP_USER` | No | - | SMTP authentication username |
| `SMTP_PASSWORD` | No | - | SMTP authentication password |

## Port Reference

| Port | Service | Description |
|------|---------|-------------|
| 3000 | Application | HTTP application server (map to 80/443 via reverse proxy) |
| 5432 | PostgreSQL | Database (internal only, not exposed by default) |

## Volume Reference

| Volume | Container Path | Description |
|--------|---------------|-------------|
| `pavillion-db` | `/var/lib/postgresql/data` | PostgreSQL database files |
| `pavillion-media` | `/app/storage/media` | Uploaded media files (if using local storage) |
| `./config/local.yaml` | `/app/config/local.yaml` | Instance configuration (bind mount) |

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
- **Secrets not generated**: Run `./bin/setup.sh` to generate secrets
- **Database password not set**: Ensure `DB_PASSWORD` is set in `.env`
- **Port already in use**: Change `APP_PORT` in `.env` or stop the conflicting service
- **Insufficient memory**: Ensure at least 1GB RAM is available

### "JWT_SECRET must be set in production" error

This error occurs when running in production mode without proper secrets configured:

```bash
# Generate secrets with the setup script
./bin/setup.sh

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
./bin/setup.sh  # Generate new secrets
docker compose up -d
```

## Next Steps

- [Configuration Reference](configuration.md) - Full configuration options
- [Secret Rotation Guide](secret-rotation.md) - How to rotate secrets
- [Upgrading Guide](upgrading.md) - How to upgrade to new versions
- [Contributing](CONTRIBUTING.md) - Get involved in development
