# Pavillion

Pavillion is a federated events calendar. Using federation it aims to provide an easy way for organizatioins to share their own events with the public, and also make it simple to share and aggregate events from across multiple sources to make community calendars that can be curated by cities, chambers of commerce, tourism boards, or other community-oriented organizations.

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

For detailed deployment instructions, see the [Deployment Guide](docs/deployment.md).

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
