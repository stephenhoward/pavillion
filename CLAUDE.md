# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pavillion is a federated events calendar built with Vue.js 3 frontend and Express.js backend. It uses ActivityPub for federation, allowing organizations to share events across multiple instances. The application supports multilingual content and emphasizes accessibility and community building.

## Development Commands

```bash
# Running the application
npm run dev              # Start frontend (3000) and backend (3001)
npm run dev:frontend     # Frontend only
npm run dev:backend      # Backend only
npm start                # Production server

# Testing
npm test                 # All unit and integration tests
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only
npm run test:e2e         # Single-instance e2e (fast, no Docker)
npm run test:federation  # Federation e2e (requires Docker)
npm run test:coverage    # Coverage report
npm run test:watch       # Tests in watch mode with UI

# Code quality
npm run lint             # Run ESLint
npm run lint:fix         # ESLint with auto-fix
npm run build            # Build production assets
npm run preview          # Preview production build
```

## Task Management

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Commit Messages

- ALWAYS use conventional commit format

## Development Server Behavior

- Backend auto-restarts on file changes
- Database resets and re-seeds on restart
- Frontend hot-reloads without server restart
- Dev environment login: `admin@pavillion.dev` / `admin`
- Check ports: `lsof -i :3000`

## Path Aliases

`@/*` maps to `src/*` (configured in tsconfig.json and vite.config.ts)

## Architecture Overview

Backend uses domain-driven design with domains: Accounts, Authentication, Calendar, ActivityPub, Configuration, Media, Public. Each domain has: `api/v1/`, `entity/`, `model/` (server-only business models), `service/`, `interface/`, `events/`, `test/`. Multilingual content uses a `TranslatedModel` base class. TypeScript experimental decorators are enabled for Sequelize entities.

Frontend has two apps: Client (authenticated) and Site (public views), using Vue 3 composition API, Pinia stores, and SCSS.

Testing uses Vitest for unit/integration, Playwright for e2e, and Playwright MCP for manual verification. Event instances auto-refresh after database seeding.

**For detailed patterns, use the appropriate skill** (e.g., `backend-domain-structure`, `backend-entity-model`, `frontend-i18n`).

## Agent OS Documentation

- **Mission & Vision:** @agent-os/product/mission.md
- **Technical Architecture:** @agent-os/product/tech-stack.md
- **Development Roadmap:** @agent-os/product/roadmap.md
- **Decision History:** @agent-os/product/decisions.md
- **Active Specs:** @agent-os/specs/

## Important Notes

- Check @agent-os/product/roadmap.md for current priorities
- Product-specific files in `agent-os/product/` override global standards
- User instructions override specs in `.agent-os/specs/`
