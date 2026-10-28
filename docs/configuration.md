# Pavillion Configuration Reference

This document provides a complete reference for all Pavillion configuration options. Every top-level key in `config/default.yaml` has a section under [YAML Configuration Options](#yaml-configuration-options), and every environment variable mapped in `config/custom-environment-variables.yaml` is listed under [Environment Variables](#environment-variables). Defaults quoted here are the values in `config/default.yaml`; that file stays the authoritative source if the two ever disagree.

## Configuration Sources

Pavillion uses the [node-config](https://github.com/node-config/node-config) library for configuration. Settings are loaded from multiple sources with the following priority (highest to lowest):

1. **Environment variables** - For secrets and deployment-specific overrides
2. **config/local.yaml** - Instance-specific customization (volume mounted)
3. **config/production.yaml** - Production defaults (in container image)
4. **config/default.yaml** - Base defaults (in container image)

## Quick Configuration

For most deployments, you only need to configure:

1. **`bin/deploy.sh`** - Run once to generate secrets, prompt for your domain, and start the application
2. **`config/local.yaml`** - Your email settings and any other instance-specific overrides (the deploy script creates this from the example template)

## Secrets Management

### Overview

Pavillion requires six secrets for secure operation:

| Secret | Purpose | Impact if Compromised |
|--------|---------|----------------------|
| `JWT_SECRET` | Signs API authentication tokens | Attacker can forge API tokens |
| `SESSION_SECRET` | Signs browser session cookies | Attacker can forge sessions |
| `DB_PASSWORD` | PostgreSQL database access | Full database access |
| `EMAIL_HASH_SECRET` | Keys the hashes of reporter emails and IP addresses for moderation | With database access, attacker can check whether a given email filed a report and recover retained reporter IP addresses |
| `ENCRYPTION_KEY` | Encrypts funding provider API keys at rest | Attacker can decrypt stored provider keys |
| `CALENDAR_IMPORT_HMAC_SECRET` | Signs ICS import DNS/rel-me verification snippets | Attacker can forge import verification challenges |

### Generating Secrets

**Recommended**: Run the deploy script to generate all secrets automatically:

```bash
bin/deploy.sh
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
| `EMAIL_HASH_SECRET` | `EMAIL_HASH_SECRET_FILE` | `/run/secrets/email_hash_secret` |
| `ENCRYPTION_KEY` | `ENCRYPTION_KEY_FILE` | `/run/secrets/encryption_key` |
| `CALENDAR_IMPORT_HMAC_SECRET` | `CALENDAR_IMPORT_HMAC_SECRET_FILE` | `/run/secrets/calendar_import_hmac_secret` |
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
| `EMAIL_HASH_SECRET` | Yes* | Development default | Keys the hashes of reporter emails and IPs for moderation. Rotation stops existing hashes matching: blocked reporters, email rate limits and report-pattern history reset. |
| `ENCRYPTION_KEY` | Yes* | Development default | Encrypts funding provider API keys at rest. Rotation breaks decryption of stored keys. |
| `CALENDAR_IMPORT_HMAC_SECRET` | Yes* | Development default | HMAC for ICS import DNS/rel-me verification snippets. Rotation only invalidates pending verification challenges. |

*Required in production; development uses defaults from config files.

### Database Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_DIALECT` | No | `postgres` in production | Overrides `database.dialect` (`postgres` or `sqlite`) |
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
| `SMTP_SECURE` | No | - | Overrides `mail.settings.secure`; `true` for port 465 |
| `MAIL_TRANSPORT` | No | `smtp` in production | Overrides `mail.transport` (`smtp`, `development`, `testing`, `mailpit`, `sendmail`) |
| `MAIL_FROM` | No | `noreply@example.com` | Overrides `mail.from`, the sender address on outgoing email |

### Application Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `production` | Runtime environment |
| `APP_PORT` | No | `127.0.0.1:3000` | Host address for the Docker Compose mapping, as `host:port` or a bare port. The default binds loopback only; a bare port binds every interface, and Docker-published ports are not filtered by UFW |
| `HOST_PORT` | No | `3000` | Overrides `host.port`, the port the application listens on inside the container |
| `LOCAL_DOMAIN` | No | `localhost:3000` | Overrides `domain`, the instance's public domain |

### Metrics Listener

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `METRICS_PORT` | No | `9464` | Overrides `housekeeping.monitoring.metrics.port` |
| `METRICS_BIND_ADDRESS` | No | `0.0.0.0` | Overrides `housekeeping.monitoring.metrics.bindAddress` |

Changing either never publishes the port to the host. See [Housekeeping](#housekeeping) below.

### Development and Testing

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SKIP_SIGNATURES` | No | - | `true` disables HTTP signature verification on inbound federation requests, for local federation testing. Refused when `NODE_ENV=production`: verification raises an error rather than being skipped. Also settable as `federation.skipSignatures: 'true'` in YAML. |

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
  storage: null           # SQLite file path; default.yaml uses ':memory:', production.yaml clears it
```

#### Connection pool and session limits

Pavillion ships explicit values for these; the defaults below are what runs unless
you override them. Override in `config/local.yaml` if your database imposes a lower
connection limit than the pool asks for.

```yaml
database:
  pool:
    max: 10               # Maximum connections in pool
    min: 0                # Minimum connections held open when idle
    acquire: 30000        # Max time (ms) a request waits for a connection
    idle: 10000           # Max time (ms) a connection sits unused before release
  dialectOptions:         # PostgreSQL only; ignored by SQLite
    statement_timeout: 60000                      # Max ms for a single query
    idle_in_transaction_session_timeout: 60000    # Max ms a transaction may sit idle
    lock_timeout: 5000                            # Max ms a statement waits on a row lock
```

The pool is shared by the whole application, so these values decide how many
requests can be in flight against the database at once. The three `dialectOptions`
timeouts bound how long any one request can hold its connection: `statement_timeout`
caps a running query, `lock_timeout` fails a statement that has waited too long on a
row lock so it gives its connection back, and `idle_in_transaction_session_timeout`
caps a transaction parked on a slow outbound call such as a payment provider request.
Database migrations clear all three for the duration of their own transaction, so
schema changes on large tables are not cut short.

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

### Authentication Secrets

```yaml
jwt:
  # secret: (use environment variable JWT_SECRET)
  expiresIn: '7d'
session:
  # secret: (use environment variable SESSION_SECRET)
```

`jwt.secret` signs API authentication tokens and `session.secret` signs
browser session cookies. Set both through their environment variables (see
[Secrets Management](#secrets-management)); production startup refuses the
development defaults. `jwt.expiresIn` is present in `default.yaml` but is not
read by the application, so changing it has no effect.

### Calendar Configuration

```yaml
calendar:
  materializationCap: 1000        # Max stored occurrence rows per event
  import:
    # hmacSecret: (use environment variable CALENDAR_IMPORT_HMAC_SECRET)
    dohResolvers:                 # DNS-over-HTTPS resolvers for ownership checks
      - 'https://1.1.1.1/dns-query'
      - 'https://8.8.8.8/resolve'
    maxSourcesPerCalendar: 10     # Max URL import sources per calendar
```

- **`materializationCap`** bounds how many occurrence rows a single event may
  store. It protects the public event-occurrence path, which creates rows on
  demand, from being driven to write an unbounded recurring schedule.
- **`import.hmacSecret`** derives the per-source verification tokens a calendar
  owner publishes to prove they control an import source. Set it with
  `CALENDAR_IMPORT_HMAC_SECRET`; production startup refuses an empty or
  development-only value.
- **`import.dohResolvers`** lists the DNS-over-HTTPS resolvers used to check
  an import source's DNS verification record. At least two are required and
  they must agree. Each must speak the JSON DNS API: Cloudflare serves it at
  `/dns-query`, Google at `/resolve`.
- **`import.maxSourcesPerCalendar`** limits each calendar to **ten import
  sources** by default. Only URL sources that sync from a feed count toward
  the limit; one-off file uploads do not. A calendar owner who reaches it
  cannot add another URL source until they remove one, and a file upload is
  refused while the calendar's URL sources fill the limit.

### Funding Configuration

```yaml
funding:
  # encryptionKey: (use environment variable ENCRYPTION_KEY)
```

`funding.encryptionKey` encrypts the payment provider API keys an instance
administrator stores. Set it with `ENCRYPTION_KEY` (generate with
`openssl rand -hex 32`). Rotating it breaks decryption of keys already stored.

### Moderation Configuration

```yaml
moderation:
  # emailHashSecret: (use environment variable EMAIL_HASH_SECRET)
  retention:
    ipHash: 30      # Days a report keeps its reporter's full IP hash
    ipSubnet: 90    # Days a report keeps its reporter's IP subnet
```

`moderation.emailHashSecret` keys the hashes of reporter email addresses and
IP addresses. Set it with `EMAIL_HASH_SECRET`.

The `retention` values decide how long reporter IP data stays on a report.
A daily job clears each report's IP hash once the report is older than
`ipHash` days, and its IP subnet once older than `ipSubnet` days. The coarse
region recorded with a report is kept. Shorter values hold less reporter data;
longer ones give moderators more time to spot repeated reports from one
source.

### Rate Limiting

```yaml
rateLimit:
  enabled: true     # false turns off the HTTP rate limiters
  store: memory
  login:
    byIp:
      windowMs: 900000   # Window length in milliseconds
      max: 10            # Requests allowed per window
  # ...one block per limiter, listed below
```

Every limiter has the same shape: `windowMs` (window length in milliseconds)
and `max` (requests allowed per key in that window). Override any of them in
`config/local.yaml` by repeating the path down to the value you change.

`enabled: false` turns off the HTTP rate limiters; test and end-to-end
configurations do this. It does not turn off the federated-report cap, which
is enforced by the moderation service rather than an HTTP limiter.
Counters are held in each process's memory and reset when it restarts.
`store` is present in `default.yaml` but is not read; `memory` is the only
behaviour.

| Limiter | Keyed on | Default |
|---------|----------|---------|
| `passwordReset.byIp` | IP address | 5 per 15 minutes |
| `passwordReset.byEmail` | Email address | 3 per hour |
| `passwordReset.confirm.byIp` | IP address | 20 per 15 minutes |
| `login.byIp` | IP address | 10 per 15 minutes |
| `login.byEmail` | Email address | 5 per hour |
| `register.byIp` | IP address | 5 per 15 minutes |
| `register.byEmail` | Email address | 3 per hour |
| `application.byIp` | IP address | 5 per 15 minutes |
| `application.byEmail` | Email address | 3 per hour |
| `application.confirm.byIp` | IP address | 20 per 15 minutes |
| `invitation.accept.byIp` | IP address | 20 per 15 minutes |
| `emailChange.byAccount` | Account | 10 per hour |
| `emailChange.byDestination` | New email address, across all accounts | 2 per 24 hours |
| `emailChange.confirm.byIp` | IP address | 20 per 15 minutes |
| `activitypub.actor` | Remote actor | 60 per minute |
| `activitypub.calendar` | Receiving calendar | 120 per minute |
| `activitypub.user` | Receiving user inbox | 120 per minute |
| `moderation.reportByIp` | IP address | 10 report submissions per 15 minutes |
| `moderation.verifyByIp` | IP address | 20 verification requests per 15 minutes |
| `moderation.byEmail` | Email address | 3 verification emails per 24 hours |
| `moderation.byAccount` | Account | 20 report submissions per hour |
| `moderation.federatedReportByInstance` | Event and reporting instance | 5 federated reports per 24 hours |
| `publicWidget.byIp` | IP address | 300 per 15 minutes |
| `publicEventInstance.byIp` | IP address | 120 per 15 minutes |
| `publicCalendarList.byIp` | IP address | 60 per minute |
| `configSite.byIp` | IP address | 60 per minute |
| `widgetConfig.byAccount` | Account | 100 per 15 minutes |
| `calendarFundingPlan.byAccount` | Account | 30 per 15 minutes |
| `checkoutSession.byAccount` | Account | 10 per 15 minutes |
| `fundingWebhook.byIp` | IP address | 300 per minute |
| `importSource.createByAccount` | Account | 15 new import sources per hour |
| `importSource.verifyBySource` | Import source | 3 verification attempts per hour |
| `importSource.syncBySource` | Import source | 4 sync attempts per hour |

### Housekeeping

The worker container runs Pavillion's scheduled maintenance: database
backups, disk checks, inbox cleanup and event occurrence refresh.

```yaml
housekeeping:
  enabled: true
  backup:
    schedule: '0 2 * * *'     # Daily at 2 AM
    retention:
      daily: 7                # Daily backups kept
      weekly: 4               # Weekly backups kept
      monthly: 6              # Monthly backups kept
    path: '/backups'          # Where backups are written
  monitoring:
    disk:
      enabled: true
      warning_threshold: 80   # Percent used that sends a warning alert
      critical_threshold: 90  # Percent used that sends a critical alert
      check_interval: '0 * * * *'
    metrics:
      enabled: true
      port: 9464              # METRICS_PORT
      bindAddress: '0.0.0.0'  # METRICS_BIND_ADDRESS
  inbox:
    retentionDays: 30         # Days a processed federation inbox message is kept
    batchSize: 1000           # Rows deleted per batch
    schedule: '0 5 * * *'     # Daily at 5 AM
  instances:
    schedule: '0 6 * * 0'     # Weekly, Sunday at 6 AM
```

#### Backups

After each backup the worker prunes old ones on a grandfather-father-son
policy, keeping the most recent `retention.daily` daily, `retention.weekly`
weekly and `retention.monthly` monthly backups. `path` is the directory the
backups are written to, and the filesystem the disk check measures. See
[Backups](./backups.md) for what to back up
beyond the database and how to test a restore.

The backup job runs daily at 2 AM regardless of `backup.schedule`. That key
is shown in the admin status panel and the housekeeping status command but
does not change when the backup runs.

#### Disk monitoring

Every hour the worker measures usage of the backup filesystem and emails an
alert when it passes `warning_threshold` or `critical_threshold` percent.
`housekeeping.enabled`, `monitoring.disk.enabled` and
`monitoring.disk.check_interval` are reported by the housekeeping status
command but do not change what runs: the disk check always runs hourly.

#### Metrics listener

`monitoring.metrics` controls the OpenMetrics listener: `enabled: false`
turns it off, `port` and `bindAddress` set where it listens. The port is never
published to the host by Docker Compose and has no authentication of its own.
If you run Pavillion directly on a host rather than in a container, set
`bindAddress` to `127.0.0.1`. See
[Monitoring and logs](./monitoring-and-logs.md)
for scraping it and for exposing it deliberately.

#### Inbox cleanup

Pavillion records every inbound federation activity in its inbox. On
`inbox.schedule` the worker deletes processed messages older than
`inbox.retentionDays`, `inbox.batchSize` rows at a time.

#### Event instance refresh

Pavillion stores each event's upcoming occurrences up to six months ahead,
calculated when the event is created, edited or received from another
instance. On `instances.schedule` the worker rebuilds them so an event nobody
edits keeps occurrences out to six months. This covers events from other
instances too, and sends nothing to followers.

### Federation Configuration

```yaml
federation:
  skipSignatures: 'true'    # Local federation testing only
```

Not set in `default.yaml`. Setting it to the string `'true'` (or setting
`SKIP_SIGNATURES=true`) disables HTTP signature verification on inbound
federation requests. It exists for local multi-instance testing; with
`NODE_ENV=production` verification raises an error instead of being skipped.

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
```

## Environment File Example

Complete `.env` file example:

```env
# Required secrets (generate with bin/deploy.sh)
JWT_SECRET=your_jwt_secret_here
SESSION_SECRET=your_session_secret_here
DB_PASSWORD=your_secure_database_password
EMAIL_HASH_SECRET=your_email_hash_secret_here
ENCRYPTION_KEY=your_encryption_key_here
CALENDAR_IMPORT_HMAC_SECRET=your_import_hmac_secret_here

# Optional database settings
DB_NAME=pavillion
DB_USER=pavillion

# Optional host address for the app (default: loopback only)
APP_PORT=127.0.0.1:3000

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
3. **Use the deploy script** - Run `bin/deploy.sh` to generate secure secrets automatically
4. **Restrict database access** - Don't expose PostgreSQL port in production
5. **Use HTTPS** - Always use a reverse proxy with SSL in production
6. **Limit file uploads** - Configure appropriate `maxFileSize` limits
7. **Enable full-disk encryption** - Use LUKS or equivalent for production servers
8. **Backup secrets** - Store secrets in a password manager for disaster recovery
