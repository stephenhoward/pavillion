# Pavillion Configuration Reference

This document provides a complete reference for all Pavillion configuration options.

## Configuration Sources

Pavillion uses the [node-config](https://github.com/node-config/node-config) library for configuration. Settings are loaded from multiple sources with the following priority (highest to lowest):

1. **Environment variables** - For secrets and deployment-specific overrides
2. **config/local.yaml** - Instance-specific customization (volume mounted)
3. **config/production.yaml** - Production defaults (in container image)
4. **config/default.yaml** - Base defaults (in container image)

## Quick Configuration

For most deployments, you only need to configure:

1. **`./bin/setup.sh`** - Run once to generate secure secrets
2. **`config/local.yaml`** - Your domain and email settings

## Secrets Management

### Overview

Pavillion requires three secrets for secure operation:

| Secret | Purpose | Impact if Compromised |
|--------|---------|----------------------|
| `JWT_SECRET` | Signs API authentication tokens | Attacker can forge API tokens |
| `SESSION_SECRET` | Signs browser session cookies | Attacker can forge sessions |
| `DB_PASSWORD` | PostgreSQL database access | Full database access |

### Generating Secrets

**Recommended**: Run the setup script to generate all secrets automatically:

```bash
./bin/setup.sh
```

This creates:
- `.env` file with all secrets (chmod 600)
- `secrets/` directory with individual secret files for Docker secrets

### Docker Secrets (_FILE Pattern)

For enhanced security, Pavillion supports Docker secrets using the `_FILE` suffix pattern. This prevents secrets from appearing in `docker inspect` output.

**How it works:**

1. Docker Compose mounts secret files to `/run/secrets/` (tmpfs, in-memory only)
2. The container entrypoint reads each `*_FILE` environment variable
3. Secret content is loaded from the file path and exported as the base variable
4. The `*_FILE` variable is unset for security

**Supported secrets:**

| Environment Variable | File Pattern | Secret File |
|---------------------|--------------|-------------|
| `DB_PASSWORD` | `DB_PASSWORD_FILE` | `/run/secrets/db_password` |
| `JWT_SECRET` | `JWT_SECRET_FILE` | `/run/secrets/jwt_secret` |
| `SESSION_SECRET` | `SESSION_SECRET_FILE` | `/run/secrets/session_secret` |
| `S3_SECRET_KEY` | `S3_SECRET_KEY_FILE` | `/run/secrets/s3_secret_key` |
| `SMTP_PASSWORD` | `SMTP_PASSWORD_FILE` | `/run/secrets/smtp_password` |

**Example docker-compose.yml configuration:**

```yaml
services:
  app:
    environment:
      - DB_PASSWORD_FILE=/run/secrets/db_password
    secrets:
      - db_password

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

### Backward Compatibility

Both approaches work:

1. **Direct environment variables**: Set `DB_PASSWORD=mysecret` in `.env`
2. **Docker secrets**: Set `DB_PASSWORD_FILE=/run/secrets/db_password`

The `_FILE` pattern takes precedence if both are set.

### Development vs Production

| Environment | Secret Handling |
|-------------|-----------------|
| Development (`npm run dev`) | Uses default values from `config/default.yaml` |
| Docker Development | Uses environment variables from `.env` |
| Production | **Requires** real secrets; fails on startup with defaults |

**Production validation**: The application checks secrets at startup in production mode. If development-default secrets are detected, the application fails with a clear error message.

## Environment Variables

Environment variables are the recommended way to pass secrets to the container.

### Security Secrets (Required)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes* | Development default | Secret for signing JWT tokens |
| `SESSION_SECRET` | Yes* | Development default | Secret for signing session cookies |
| `DB_PASSWORD` | Yes | - | PostgreSQL database password |

*Required in production; development uses defaults from config files.

### Database Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_HOST` | Yes* | `db` | PostgreSQL server hostname |
| `DB_PORT` | No | `5432` | PostgreSQL server port |
| `DB_NAME` | No | `pavillion` | Database name |
| `DB_USER` | No | `pavillion` | Database username |
| `DB_PASSWORD` | Yes | - | Database password |
| `DB_WAIT_TIMEOUT` | No | `30` | Seconds to wait for database on container startup |

*`DB_HOST` is set automatically by Docker Compose to `db`, matching the database service name.

### S3 Storage Configuration

Configure these for S3-compatible media storage (AWS S3, DigitalOcean Spaces, MinIO, etc.):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `S3_BUCKET` | Yes* | - | S3 bucket name |
| `S3_REGION` | Yes* | - | AWS region (e.g., `us-east-1`) |
| `S3_ACCESS_KEY` | Yes* | - | Access key ID |
| `S3_SECRET_KEY` | Yes* | - | Secret access key |
| `S3_ENDPOINT` | No | - | Custom endpoint URL for S3-compatible services |

*Required only if using S3 storage. Also requires setting `media.storage.driver: 's3'` in `config/local.yaml`.

### SMTP Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SMTP_HOST` | No | `localhost` | SMTP server hostname |
| `SMTP_PORT` | No | `587` | SMTP server port |
| `SMTP_USER` | No | - | SMTP authentication username |
| `SMTP_PASSWORD` | No | - | SMTP authentication password |

### Application Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `production` | Runtime environment |
| `APP_PORT` | No | `3000` | Host port for Docker Compose mapping |

## YAML Configuration Options

### Domain Configuration

```yaml
# Your instance's public domain (required for federation)
domain: "calendar.example.org"
```

### Database Configuration

Database settings are typically handled via environment variables. Only configure in YAML if you need special settings:

```yaml
database:
  dialect: postgres        # Database type (postgres for production)
  host: db                 # PostgreSQL hostname
  port: 5432              # PostgreSQL port
  database: pavillion     # Database name
  username: pavillion     # Database user
  # password: (use environment variable DB_PASSWORD)
  logging: false          # Set to true to log SQL queries
  pool:
    max: 10               # Maximum connections in pool
    min: 2                # Minimum connections in pool
    acquire: 30000        # Max time (ms) to acquire connection
    idle: 10000           # Max time (ms) connection can be idle
```

### Host Configuration

```yaml
host:
  port: 3000              # Application port (inside container)
```

### Media Storage Configuration

#### Local Storage (Default)

Media files are stored in the `pavillion-media` Docker volume:

```yaml
media:
  uploadPath: '/app/storage/media/inbound'   # Temporary upload location
  finalPath: '/app/storage/media/public'     # Final storage location
  maxFileSize: 10485760                       # 10MB in bytes
  allowedTypes:
    - 'image/png'
    - 'image/jpeg'
    - 'image/heic'
  allowedExtensions:
    - '.png'
    - '.jpg'
    - '.jpeg'
    - '.heic'
  storage:
    driver: 'local'
    basePath: '/app/storage/media'
```

#### S3 Storage (Recommended for Production)

For production deployments, S3-compatible storage is recommended:

```yaml
media:
  uploadPath: '/app/storage/media/inbound'
  finalPath: '/app/storage/media/public'
  maxFileSize: 10485760
  allowedTypes:
    - 'image/png'
    - 'image/jpeg'
    - 'image/heic'
  allowedExtensions:
    - '.png'
    - '.jpg'
    - '.jpeg'
    - '.heic'
  storage:
    driver: 's3'
    bucket: 'your-bucket-name'
    region: 'us-east-1'
    # For S3-compatible services (DigitalOcean Spaces, MinIO):
    # endpoint: 'https://nyc3.digitaloceanspaces.com'
    # forcePathStyle: true  # Required for some S3-compatible services
    #
    # Credentials via environment variables:
    #   S3_ACCESS_KEY - Access key ID
    #   S3_SECRET_KEY - Secret access key
```

### Email Configuration

```yaml
mail:
  transport: smtp                           # Use 'smtp' for production
  from: noreply@calendar.example.org        # From address for emails
  settings:
    host: smtp.example.org                  # SMTP server hostname
    port: 587                               # SMTP port (587 for TLS, 465 for SSL)
    secure: false                           # true for port 465, false for others
    # Authentication via environment variables (recommended):
    #   SMTP_USER - Username
    #   SMTP_PASSWORD - Password
    # Or directly in config (not recommended for production):
    # user: your_username
    # pass: your_password
```

### Federation Settings

```yaml
federation:
  enabled: true           # Enable ActivityPub federation
  autoRepost: false       # Automatically repost events from trusted instances
```

## Complete Configuration Example

Here's a complete `config/local.yaml` example:

```yaml
# Pavillion Instance Configuration
# See docs/configuration.md for full reference

# Your instance domain (required)
domain: "calendar.example.org"

# Email configuration
mail:
  transport: smtp
  from: noreply@calendar.example.org
  settings:
    host: smtp.example.org
    port: 587
    secure: false

# Media storage
media:
  uploadPath: '/app/storage/media/inbound'
  finalPath: '/app/storage/media/public'
  maxFileSize: 10485760
  allowedTypes:
    - 'image/png'
    - 'image/jpeg'
    - 'image/heic'
  allowedExtensions:
    - '.png'
    - '.jpg'
    - '.jpeg'
    - '.heic'
  storage:
    # Option 1: Local storage (uses Docker volume)
    driver: 'local'
    basePath: '/app/storage/media'

    # Option 2: S3 storage (uncomment and configure)
    # driver: 's3'
    # bucket: 'your-bucket-name'
    # region: 'us-east-1'

# Federation settings
federation:
  enabled: true
  autoRepost: false
```

## Environment File Example

Complete `.env` file example:

```env
# Required secrets (generate with ./bin/setup.sh)
JWT_SECRET=your_jwt_secret_here
SESSION_SECRET=your_session_secret_here
DB_PASSWORD=your_secure_database_password

# Optional database settings
DB_NAME=pavillion
DB_USER=pavillion

# Optional application port
APP_PORT=3000

# Optional S3 storage (if using S3 driver)
# S3_BUCKET=your-bucket-name
# S3_REGION=us-east-1
# S3_ACCESS_KEY=your-access-key
# S3_SECRET_KEY=your-secret-key
# S3_ENDPOINT=https://custom-endpoint.example.com

# Optional SMTP settings (can also be in local.yaml)
# SMTP_HOST=smtp.example.org
# SMTP_PORT=587
# SMTP_USER=your_smtp_username
# SMTP_PASSWORD=your_smtp_password
```

## Docker Compose Overrides

You can customize the Docker Compose configuration by creating a `docker-compose.override.yml` file:

```yaml
# docker-compose.override.yml
# This file is automatically merged with docker-compose.yml

services:
  app:
    # Change the exposed port
    ports:
      - "8080:3000"

    # Add additional environment variables
    environment:
      - LOG_LEVEL=debug

  db:
    # Expose PostgreSQL for external access (development only!)
    ports:
      - "5432:5432"
```

## Configuration for Development

For local development with PostgreSQL (instead of SQLite):

1. Start the development database:
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```

2. Create a `config/local.yaml` with development settings:
   ```yaml
   database:
     dialect: postgres
     host: localhost
     port: 5432
     database: pavillion_dev
     username: pavillion
     password: devpassword
   ```

3. Run the application:
   ```bash
   npm run dev
   ```

## Security Considerations

1. **Never commit secrets** - Use environment variables for passwords and API keys
2. **Use strong passwords** - Generate random passwords with `openssl rand -base64 32`
3. **Use the setup script** - Run `./bin/setup.sh` to generate secure secrets automatically
4. **Restrict database access** - Don't expose PostgreSQL port in production
5. **Use HTTPS** - Always use a reverse proxy with SSL in production
6. **Limit file uploads** - Configure appropriate `maxFileSize` limits
7. **Review federation settings** - Be cautious with `autoRepost` in production
8. **Enable full-disk encryption** - Use LUKS or equivalent for production servers
9. **Backup secrets** - Store secrets in a password manager for disaster recovery
