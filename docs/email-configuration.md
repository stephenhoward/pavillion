# Email Configuration Guide

> Last Updated: 2026-01-11
> Version: 1.0.0

This guide covers email configuration for Pavillion across all environments: local development, Docker development, and production deployments.

## Table of Contents

1. [Overview](#overview)
2. [Transport Architecture](#transport-architecture)
3. [Environment Variables](#environment-variables)
4. [Local Development (npm run dev)](#local-development-npm-run-dev)
5. [Docker Development (Mailpit)](#docker-development-mailpit)
6. [Production Configuration](#production-configuration)
7. [Troubleshooting](#troubleshooting)

---

## Overview

Pavillion uses a transport adapter pattern for email delivery, allowing seamless switching between different email backends based on environment and configuration. The system automatically selects the appropriate transport based on environment variables and NODE_ENV.

### Email Types Supported

Pavillion sends the following transactional emails:
- **Account invitations** - Invite users to join the platform
- **Password reset requests** - Allow users to recover account access
- **Editor invitations** - Invite collaborators to edit calendars
- **Editor notifications** - Notify users when they're added as calendar editors

### Design Principles

- **Zero configuration for development** - Local development works immediately without setup
- **Docker development with visual inspection** - Mailpit provides a web UI for viewing emails
- **Production flexibility** - Supports any SMTP provider with standard configuration

---

## Transport Architecture

The email system uses a transport adapter pattern located at `src/server/email/`. Each transport implements the same interface, allowing the application to send emails without knowing the underlying delivery mechanism.

### Available Transports

| Transport | Use Case | Configuration |
|-----------|----------|---------------|
| `development` | Local npm development | Writes emails to `logs/mail/` directory |
| `mailpit` | Docker development | Sends to Mailpit container for web UI viewing |
| `smtp` | Production | Sends via configured SMTP server |
| `testing` | Unit/integration tests | In-memory storage for test assertions |
| `sendmail` | Legacy systems | Uses local sendmail binary |

### Transport Selection Logic

The email service selects a transport using the following priority order:

```
1. NODE_ENV=test                          --> Testing transport (in-memory)
2. SMTP_HOST=mailpit                      --> Mailpit transport (Docker)
3. SMTP_HOST set (without MAIL_TRANSPORT) --> SMTP transport (auto-detect)
4. MAIL_TRANSPORT=<type>                  --> Explicitly specified transport
5. NODE_ENV=development (no SMTP_HOST)    --> Development transport (file-based)
6. Fallback                               --> Config file transport or development
```

### Transport Selection Flowchart

```
                    START
                      |
                      v
              +---------------+
              | NODE_ENV=test |
              +---------------+
                /           \
              yes            no
              /               \
             v                 v
      [Testing]        +----------------+
                       | SMTP_HOST=     |
                       | mailpit?       |
                       +----------------+
                        /            \
                      yes             no
                      /               \
                     v                 v
              [Mailpit]        +----------------+
                               | SMTP_HOST set? |
                               +----------------+
                                /            \
                              yes             no
                              /               \
                             v                 v
                       [SMTP]          +----------------+
                                       | MAIL_TRANSPORT |
                                       | explicitly set?|
                                       +----------------+
                                        /            \
                                      yes             no
                                      /               \
                                     v                 v
                            [Specified         +----------------+
                             Transport]        | NODE_ENV=      |
                                               | development?   |
                                               +----------------+
                                                /            \
                                              yes             no
                                              /               \
                                             v                 v
                                    [Development]      [Config File
                                    (file-based)        or Default]
```

---

## Environment Variables

The email system uses the config package's environment variable mapping. These variables are defined in `config/custom-environment-variables.yaml`:

| Variable | Description | Example |
|----------|-------------|---------|
| `SMTP_HOST` | SMTP server hostname | `smtp.smtp2go.com` |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_USER` | SMTP authentication username | `user@example.com` |
| `SMTP_PASSWORD` | SMTP authentication password | `your-smtp-password` |
| `SMTP_SECURE` | Use TLS (true/false) | `true` |
| `MAIL_FROM` | Default sender address | `noreply@yourdomain.com` |
| `MAIL_TRANSPORT` | Explicit transport override | `smtp`, `development`, `mailpit` |

### Environment Variable Priority

Environment variables are mapped to config paths via `config/custom-environment-variables.yaml`:
- `SMTP_*` variables map to `mail.settings.*`
- `MAIL_FROM` maps to `mail.from`
- `MAIL_TRANSPORT` maps to `mail.transport`

This follows the same pattern as database credentials (`DB_*`) and JWT secrets (`JWT_SECRET`), keeping secrets out of configuration files while allowing easy override in container environments.

---

## Local Development (npm run dev)

When running Pavillion locally with `npm run dev`, emails are automatically saved to files without any configuration required.

### How It Works

1. The development transport writes all emails to `logs/mail/` directory
2. Each email is saved as an `.eml` file with timestamp and recipient in filename
3. Console output shows email metadata (from, to, subject, file path)

### Viewing Development Emails

```bash
# Start the development server
npm run dev

# Trigger an email action (e.g., password reset)
# Check console output for email details

# View saved emails
ls -la logs/mail/

# Open an email file (macOS)
open logs/mail/2026-01-11T10-30-00-000Z-user@example.com-Password-Reset.eml

# Or view in terminal
cat logs/mail/*.eml
```

### Console Output Example

When an email is sent in development mode, you'll see:

```
--- Email Sent (Development Mode) ---
From: noreply@example.com
To: user@example.com
Subject: Reset Your Password
Saved to: logs/mail/2026-01-11T10-30-00-000Z-user@example.com-Reset-Your-Password.eml
--- End Email ---
```

### Email File Format

The `.eml` files are standard email format and can be:
- Opened with any email client (Apple Mail, Thunderbird, Outlook)
- Viewed as text in any editor
- Parsed programmatically for debugging

### Customizing Development Email Output

```bash
# Change output directory
MAIL_OUTPUT_DIR=./my-emails npm run dev

# Disable console output (emails still saved to files)
MAIL_CONSOLE=false npm run dev
```

---

## Docker Development (Mailpit)

When running Pavillion with Docker Compose, emails are captured by Mailpit, providing a web interface for viewing and debugging emails.

### Starting Docker Development Environment

```bash
# Start all services including Mailpit
docker compose -f docker-compose.dev.yml up

# Or start in detached mode
docker compose -f docker-compose.dev.yml up -d
```

### Accessing Mailpit Web UI

Once containers are running, open your browser to:

**http://localhost:8025**

### Mailpit Web Interface Features

The Mailpit web UI provides:

- **Inbox view** - List of all captured emails with sender, recipient, subject, and timestamp
- **Email preview** - Click any email to view full content
- **HTML rendering** - See emails exactly as recipients would
- **Plain text view** - View text-only version
- **Headers inspection** - View all email headers
- **Source view** - Raw email source code
- **Attachment handling** - Download and view attachments
- **Search** - Filter emails by any criteria
- **Delete** - Clear individual or all emails

### Email Testing Workflow

1. **Start containers**: `docker compose -f docker-compose.dev.yml up`
2. **Open Mailpit**: Navigate to http://localhost:8025
3. **Trigger email**: Perform an action in the app (password reset, invitation, etc.)
4. **View email**: Email appears in Mailpit within seconds
5. **Inspect content**: Check HTML rendering, links, and content
6. **Clear emails**: Use "Delete All" to reset between tests

### How Docker Email Configuration Works

The `docker-compose.dev.yml` configures the app container with:

```yaml
environment:
  - SMTP_HOST=mailpit
  - SMTP_PORT=1025
  - MAIL_FROM=pavillion-dev@localhost
```

When `SMTP_HOST=mailpit`, the email service automatically selects the Mailpit transport, which sends emails via SMTP to the Mailpit container on port 1025.

### Mailpit Container Configuration

```yaml
mailpit:
  image: axllent/mailpit
  ports:
    - "8025:8025"  # Web UI
    - "1025:1025"  # SMTP (optional external exposure)
```

### Troubleshooting Docker Email

**Emails not appearing in Mailpit:**

1. Verify Mailpit is running:
   ```bash
   docker compose -f docker-compose.dev.yml ps
   ```

2. Check app container logs for email errors:
   ```bash
   docker compose -f docker-compose.dev.yml logs app
   ```

3. Verify environment variables:
   ```bash
   docker compose -f docker-compose.dev.yml exec app env | grep -E 'SMTP|MAIL'
   ```

4. Test SMTP connectivity from app container:
   ```bash
   docker compose -f docker-compose.dev.yml exec app nc -zv mailpit 1025
   ```

**Mailpit web UI not loading:**

1. Check if port 8025 is in use:
   ```bash
   lsof -i :8025
   ```

2. Restart Mailpit container:
   ```bash
   docker compose -f docker-compose.dev.yml restart mailpit
   ```

---

## Production Configuration

Production deployments require a third-party SMTP provider for reliable email delivery.

### Choosing an SMTP Provider

When selecting an SMTP provider, consider:

- **Deliverability rates** - How reliably emails reach inboxes vs. spam folders
- **Free tier generosity** - Monthly limits and daily sending caps
- **Ease of setup** - Domain verification process and documentation quality
- **Credit card requirements** - Some providers require payment info even for free tiers

Search for "transactional email provider comparison" to find current reviews and comparisons. Look for providers that specialize in transactional email (password resets, notifications) rather than marketing email.

### Basic SMTP Configuration

#### Via Environment Variables (Recommended)

```bash
# Required
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=your-username
SMTP_PASSWORD=your-password
MAIL_FROM=noreply@yourdomain.com

# Optional
SMTP_SECURE=true  # Use TLS (recommended)
```

#### Via YAML Configuration

Create or modify `config/production.yaml`:

```yaml
mail:
  transport: smtp
  from: noreply@yourdomain.com
  settings:
    host: smtp.your-provider.com
    port: 587
    secure: true
    user: your-username
    pass: your-password
```

**Important**: Never commit credentials to version control. Use environment variables for production secrets.

### Common SMTP Ports

| Port | Security | Use Case |
|------|----------|----------|
| 25 | None | Legacy, often blocked |
| 465 | SSL/TLS | Implicit TLS |
| 587 | STARTTLS | Recommended for submission |
| 2525 | Varies | Alternative when 587 blocked |

### Security Settings

| Setting | Value | Description |
|---------|-------|-------------|
| `SMTP_SECURE=true` | Port 465 | Use implicit TLS |
| `SMTP_SECURE=false` | Port 587 | Use STARTTLS (upgrades to TLS) |

Most providers recommend port 587 with STARTTLS (`SMTP_SECURE=false` or omit the variable).

### Testing Production Configuration

After configuring SMTP:

1. Deploy your configuration
2. Trigger a test email (password reset to your email)
3. Check your inbox (and spam folder)
4. Verify email content and formatting

---

## Troubleshooting

### Common Issues

#### "Connection refused" errors

- Verify SMTP_HOST and SMTP_PORT are correct
- Check if your hosting provider blocks outbound SMTP (common on shared hosting)
- Try alternative ports (2525, 465)

#### "Authentication failed"

- Double-check SMTP_USER and SMTP_PASSWORD
- Ensure you're using SMTP credentials, not account password
- Check if your provider requires app-specific passwords

#### Emails going to spam

1. Verify sender domain authentication (SPF, DKIM, DMARC)
2. Use [mail-tester.com](https://www.mail-tester.com) to check spam score
3. Ensure MAIL_FROM uses a verified domain
4. Check sender reputation with your provider

#### Emails not sending in production

1. Check application logs for error messages:
   ```bash
   docker logs pavillion-app | grep -i mail
   ```

2. Verify environment variables are set:
   ```bash
   docker exec pavillion-app env | grep -E 'SMTP|MAIL'
   ```

3. Test SMTP connectivity:
   ```bash
   openssl s_client -connect smtp.provider.com:587 -starttls smtp
   ```

#### Transport type confusion

Check which transport is active:
```bash
# In logs, look for:
Creating mail transport: smtp
# or
Creating mail transport: development
```

### DNS Record Verification

Use these tools to verify your DNS records:

- **MXToolbox**: [mxtoolbox.com/SuperTool.aspx](https://mxtoolbox.com/SuperTool.aspx)
- **Google Admin Toolbox**: [toolbox.googleapps.com/apps/checkmx](https://toolbox.googleapps.com/apps/checkmx)
- **DKIM Validator**: [dmarcanalyzer.com/dkim/dkim-check](https://dmarcanalyzer.com/dkim/dkim-check)

### Getting Help

If you continue to experience issues:

1. Check the provider's documentation and status page
2. Contact the provider's support with error messages
3. Open an issue in the Pavillion repository with:
   - Environment (Docker/local/production)
   - Provider being used
   - Error messages (sanitized of credentials)
   - Steps to reproduce

---

## Related Documentation

- [Production Deployment Guide](./deployment.md)
- [Configuration Reference](./configuration.md)
