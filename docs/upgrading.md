# Upgrading Pavillion

This guide covers upgrading your Pavillion instance to new versions.

## Standard Upgrade Process

Upgrading Pavillion is designed to be simple and automatic:

```bash
# Pull the latest image
docker compose pull

# Restart with the new version
docker compose up -d
```

That's it! The container will automatically:

1. Wait for the database to be ready
2. Run any pending database migrations
3. Start the new version of the application

## Pre-Upgrade Checklist

Before upgrading, especially for major version changes:

### 1. Check Release Notes

Review the [release notes](https://github.com/pavillion/pavillion/releases) for:
- Breaking changes that may require configuration updates
- New required environment variables
- Deprecated features being removed

### 2. Backup Your Data

Always backup before upgrading:

```bash
# Stop the application (database stays running)
docker compose stop app

# Backup the database
docker compose exec db pg_dump -U pavillion pavillion > backup-$(date +%Y%m%d-%H%M%S).sql

# Backup media files (if using local storage)
docker compose cp app:/app/storage/media ./media-backup-$(date +%Y%m%d)

# Or for volumes:
docker run --rm -v pavillion-media:/data -v $(pwd):/backup alpine \
  tar czf /backup/media-backup-$(date +%Y%m%d).tar.gz -C /data .
```

### 3. Check System Resources

Ensure you have sufficient disk space and memory:

```bash
# Check disk space
df -h

# Check available memory
free -h
```

## Step-by-Step Upgrade

### Step 1: Create Backups

```bash
# Database backup
docker compose exec db pg_dump -U pavillion pavillion > backup-pre-upgrade.sql

# Optional: media backup (if using local storage)
docker run --rm -v pavillion-media:/data -v $(pwd):/backup alpine \
  tar czf /backup/media-backup.tar.gz -C /data .
```

### Step 2: Pull New Version

```bash
# Pull the latest version
docker compose pull

# Or pull a specific version
docker compose pull pavillion/pavillion:v1.2.0
```

### Step 3: Review Changes

Check what will change:

```bash
# See current running version
docker compose ps

# See what images will be updated
docker compose images
```

### Step 4: Perform the Upgrade

```bash
# Restart with new version
docker compose up -d
```

### Step 5: Monitor the Upgrade

Watch the logs for successful migration and startup:

```bash
docker compose logs -f app
```

Look for:
- "PostgreSQL is ready!" - Database connection established
- "Successfully executed migrations:" or "No pending migrations to run." - Migrations complete
- "Starting Pavillion application..." - Application starting

### Step 6: Verify the Upgrade

```bash
# Check containers are running
docker compose ps

# Test health endpoint
curl http://localhost:3000/health

# Check the application in your browser
```

## Migration Failure Troubleshooting

If migrations fail, the container will exit with an error code. This is by design to prevent data corruption.

### Viewing Migration Errors

```bash
# Check application logs
docker compose logs app

# Look for migration-specific messages
docker compose logs app | grep -i migration
```

### Common Migration Issues

**1. Database connection issues:**
```bash
# Verify database is running and healthy
docker compose ps db
docker compose exec db pg_isready -U pavillion
```

**2. Schema conflicts:**
If you've manually modified the database schema, migrations may fail. Options:
- Restore from backup and try again
- Manually fix the schema to match expected state
- Contact support with the specific error message

**3. Disk space issues:**
```bash
# Check disk space
df -h
# Clean up old images
docker system prune
```

### Retrying Migrations

After fixing the underlying issue:

```bash
# Restart the application container
docker compose restart app

# Watch the logs
docker compose logs -f app
```

## Rollback Procedure

If an upgrade fails or causes issues, you can rollback to the previous version:

### Step 1: Stop the Current Version

```bash
docker compose down
```

### Step 2: Restore Database Backup

```bash
# Start only the database
docker compose up -d db

# Wait for it to be ready
docker compose exec db pg_isready -U pavillion

# Drop and recreate the database
docker compose exec db psql -U pavillion -c "DROP DATABASE pavillion;"
docker compose exec db psql -U pavillion -c "CREATE DATABASE pavillion;"

# Restore from backup
cat backup-pre-upgrade.sql | docker compose exec -T db psql -U pavillion pavillion
```

### Step 3: Run Previous Version

Edit `docker-compose.yml` to specify the previous version:

```yaml
services:
  app:
    image: pavillion/pavillion:v1.1.0  # Previous version
```

Then start the application:

```bash
docker compose up -d
```

### Step 4: Verify Rollback

```bash
docker compose ps
curl http://localhost:3000/health
```

## Breaking Change Guidelines

When upgrading across major versions, pay attention to:

### Configuration Changes

Breaking changes may require updating `config/local.yaml`. Common changes:
- Configuration keys renamed or restructured
- New required configuration options
- Deprecated options removed

Review your configuration against the latest `config/local.yaml.example`.

### Environment Variable Changes

Check `.env.example` for:
- New required environment variables
- Changed variable names
- Removed variables

### Database Schema Changes

Major versions may include significant schema changes. These are handled automatically by migrations, but:
- Large databases may take longer to migrate
- Some migrations cannot be automatically reversed
- Always backup before major version upgrades

## Upgrade Best Practices

1. **Always backup first** - Database backups are quick and can save hours of recovery time
2. **Read release notes** - Know what's changing before you upgrade
3. **Upgrade regularly** - Small, frequent upgrades are safer than large jumps
4. **Test in staging** - If possible, test upgrades on a staging instance first
5. **Upgrade during low-traffic periods** - Minimize impact on users
6. **Monitor after upgrade** - Watch logs and metrics for unexpected behavior

## Getting Help

If you encounter issues:

1. Check the [troubleshooting section](#migration-failure-troubleshooting)
2. Search [existing issues](https://github.com/pavillion/pavillion/issues)
3. Open a new issue with:
   - Current version and target version
   - Full error messages from logs
   - Steps to reproduce
   - Your configuration (without secrets)
