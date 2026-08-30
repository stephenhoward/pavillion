# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, and any other agent that supports the AGENTS.md convention) when working with code in this repository.

## Project Overview

Pavillion is a federated events calendar built with Vue.js 3 frontend and Express.js backend. It uses ActivityPub for federation, allowing organizations to share events across multiple instances. The application supports multilingual content and emphasizes accessibility and community building.

## Development Commands

```bash
# Running the application
npm run dev              # Start frontend (Vite, 5173) and backend (Express, 3000)
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
bd update <id> --claim   # Claim work (sets assignee + in_progress atomically)
bd note <id> "..."    # Append a note (does not clobber existing notes)
bd close <id>         # Complete work
```

## Commit Messages

- ALWAYS use conventional commit format

## Development Server Behavior

- Backend auto-restarts on file changes
- Database resets and re-seeds on restart
- Frontend hot-reloads without server restart
- Dev environment login: `admin@pavillion.dev` / `admin`
- App URL is http://localhost:3000 (the backend serves the HTML, which pulls JS/CSS assets from Vite on 5173) — not 5173, which returns 404 for SPA routes
- Check ports: `lsof -i :3000` (backend/app) and `lsof -i :5173` (Vite/HMR)

## Environment Quirks

Recurring agent time-wasters, verified against session history — read before shelling out:

- The Bash tool runs zsh. Quote glob arguments (`--include='*.ts'`, `ls 'vitest*.ts'`) — an unquoted glob that matches nothing aborts the **entire** command with "no matches found", including parts that would have worked. Bare `===` echo separators trigger zsh equals-expansion (`=== not found`); quote them (`echo '==='`).
- `grep` in the Bash tool is a ugrep shim, not `/usr/bin/grep`. `\+` in patterns fails with "invalid syntax" — match a literal leading `+` (e.g. git-diff added lines) with `'^[+]'`. Prefer the Grep tool for searches.
- A no-match `grep` exits 1, which marks the whole Bash call as an error and skips any later `&&` steps. Append `|| true` when zero matches is an acceptable outcome, or end compound commands with something that always succeeds.
- `npm run test:e2e` (154 tests) exceeds the default 2-minute Bash timeout; pass a 10-minute timeout when running it.
- Running a single integration test file requires the integration config: `npx vitest run <file> --config vitest.integration.config.ts`. The default vitest config excludes `src/server/**/test/integration/**`, so without the flag vitest reports "No test files found" and exits 1 — an exclusion, not a failure.
- Before editing a file, view it with the Read tool, not `sed`/`cat` — the Edit tool refuses files that were only viewed via Bash, and the failed attempt plus forced re-read wastes two calls.

## Path Aliases

`@/*` maps to `src/*` (configured in tsconfig.json and vite.config.ts)

## Architecture Overview

Backend uses domain-driven design with domains: Accounts, Authentication, Calendar, ActivityPub, Configuration, Media, Public. Each domain has: `api/v1/`, `entity/`, `model/` (server-only business models), `service/`, `interface/`, `events/`, `test/`. Multilingual content uses a `TranslatedModel` base class. TypeScript experimental decorators are enabled for Sequelize entities.

Frontend has two apps: Client (authenticated) and Site (public views), using Vue 3 composition API, Pinia stores, and SCSS.

Testing uses Vitest for unit/integration, Playwright for e2e, and Playwright MCP for manual verification. Event instances auto-refresh after database seeding.

**For detailed patterns, use the appropriate skill** (e.g., `backend-domain-structure`, `backend-entity-model`, `frontend-i18n`).

## Product Decisions

Architectural and product decisions live in @agent-os/product/decisions.md — an index of individual decision files under `agent-os/product/decisions/`. Load a decision when its **Consult when** triggers match the work at hand; decision text overrides conflicting guidance elsewhere.
