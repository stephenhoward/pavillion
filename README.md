# Pavillion

Pavillion is a federated events calendar. Using federation it aims to provide an easy way for organizatioins to share their own events with the public, and also make it simple to share and aggregate events from across multiple sources to make community calendars that can be curated by cities, chambers of commerce, tourism boards, or other community-oriented organizations.

## Project Principles

### Accessibility

- Multilingual out of the box. Providing translation tools for both the software interfaces and the content shared.
- Allowing for content to be translated into multiple languages to support multilingual communities.
- Designing the software to be usable with screen readers and other accessibility technology
- Providing structures in the content that encourage event hosts to describe the accessiblity of their events to those who attend them.

### Autonomy

- Open Source under the [Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/)
- No centralized service
- No account required for the public to view events.
- Different pavillion servers can determine what content they wish to host.

### Flexibility

- Provide an embeddable version of a calendar for easy inclusion in an organization's website.
- Provide syncing/exporting to popular platforms (eg, Facebook) to reduce the effort of sharing events far and wide.

### Community

The goal of the project, both in it's open source development, and it's end use, is to find help people find more connections with their communities.

## Getting Involved

Please see our [code of conduct](docs/CODE_OF_CONDUCT.md) and [contribution guide](docs/CONTRIBUTING.md) for details on how to get started and have a positive impact on the project.

## License

Pavillion is licensed under the [Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/). This means:

- You can use, modify, and distribute the software
- If you modify Pavillion's files, those modifications must be released under MPL-2.0
- You must make the source code available when you distribute the software

## Quick Start with Docker

Deploy Pavillion in minutes using Docker Compose:

```bash
# Clone the repository
git clone https://github.com/pavillion/pavillion.git
cd pavillion

# Create configuration files
cp .env.example .env
cp config/local.yaml.example config/local.yaml

# Set your database password in .env
# Set your domain in config/local.yaml

# Start the application
docker compose up -d
```

This will start three containers:
- **app** - Web server handling HTTP requests (port 3000)
- **worker** - Background job processor for backups and monitoring
- **db** - PostgreSQL database

For detailed deployment instructions, see the [Deployment Guide](docs/deployment.md).

## Container Architecture

Pavillion uses a **Sidekiq-style worker architecture** with separate web and worker containers:

### Web Container (`app`)
- Serves HTTP requests
- Queues background jobs
- Runs database migrations on startup
- Exposes admin dashboard with system status

### Worker Container (`worker`)
- Processes background jobs from the queue
- Runs scheduled database backups (daily at 2 AM)
- Monitors disk space and sends email alerts
- Does not serve HTTP requests

Both containers use the same Docker image with different command arguments. The worker container runs with the `--worker` flag to enable job processing mode.

### Log Rotation

Both containers are configured with automatic log rotation:
- Maximum log file size: 10 MB
- Maximum number of log files: 5
- Total maximum disk usage per container: 50 MB

To adjust log rotation settings, modify the `logging` configuration in `docker-compose.yml`:

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"  # Adjust size as needed
    max-file: "5"    # Adjust file count as needed
```

### Backup Volume

The worker container uses a dedicated volume for database backups:

```yaml
volumes:
  pavillion-backups:
    name: pavillion-backups
```

By default, this creates a named Docker volume. For production deployments, you can configure this volume to use different backing storage:

**Option 1: Local directory bind mount**
```yaml
volumes:
  pavillion-backups:
    name: pavillion-backups
    driver: local
    driver_opts:
      type: none
      device: /path/to/backup/storage
      o: bind
```

**Option 2: NFS mount**
```yaml
volumes:
  pavillion-backups:
    name: pavillion-backups
    driver: local
    driver_opts:
      type: nfs
      o: addr=nfs.example.com,nolock,soft,rw
      device: ":/path/to/nfs/share"
```

**Option 3: Cloud-backed filesystem**

Use your cloud provider's Docker volume driver (e.g., AWS EFS, Google Cloud Filestore).

### Troubleshooting

**Worker container not processing jobs:**
- Check worker logs: `docker logs pavillion-worker`
- Verify database connection in worker container
- Ensure pg-boss tables exist in database

**Backups not running:**
- Check worker container is running: `docker ps | grep worker`
- Verify backup volume is mounted: `docker inspect pavillion-worker`
- Check worker logs for scheduled job registration messages

**Disk space alerts not sending:**
- Verify SMTP configuration in `config/local.yaml`
- Check worker logs for email sending errors
- Test email configuration using CLI: `docker exec pavillion-worker pavillion backup status`

**Log files growing too large:**
- Adjust `max-size` in docker-compose.yml logging configuration
- Reduce `max-file` count if disk space is limited
- Consider external log aggregation for production

For more troubleshooting help, see the [Deployment Guide](docs/deployment.md).

## Development

### Standard Development (SQLite)

For rapid development with hot-reload and in-memory SQLite database:

```bash
npm install
npm run dev
```

This starts the frontend (Vite) and backend (Express) with hot-reload enabled. The database resets on each restart.

### Development with PostgreSQL

To test against a production-like PostgreSQL environment:

```bash
# Start the PostgreSQL container
docker compose -f docker-compose.dev.yml up -d

# Run the application
npm run dev
```

See [docs/configuration.md](docs/configuration.md) for connecting your local app to PostgreSQL.

## Federation Testing

Pavillion includes a comprehensive federation testing infrastructure that allows you to test ActivityPub federation between multiple instances on your local machine. The setup creates two isolated instances with Docker, nginx routing, and Playwright E2E tests.

Quick start:
```bash
npm run federation:start    # Start the environment
npm run test:federation     # Run federation tests
npm run federation:stop     # Stop when done
```

For detailed setup instructions, troubleshooting, and architecture documentation, see the [Federation Testing Guide](docs/federation-testing.md).

## Documentation

- [Deployment Guide](docs/deployment.md) - Docker deployment instructions
- [Configuration Reference](docs/configuration.md) - All configuration options
- [Federation Testing Guide](docs/federation-testing.md) - Multi-instance testing setup and troubleshooting
- [Upgrading Guide](docs/upgrading.md) - Upgrade procedures and migration handling
- [Contributing](docs/CONTRIBUTING.md) - How to contribute to Pavillion
- [Code of Conduct](docs/CODE_OF_CONDUCT.md) - Community guidelines
