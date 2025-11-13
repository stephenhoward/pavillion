# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pavillion is a federated events calendar built with Vue.js 3 frontend and Express.js backend. It uses ActivityPub for federation, allowing organizations to share events across multiple instances. The application supports multilingual content and emphasizes accessibility and community building.

## Development Commands

### Running the Application
- `npm run dev` - Start both frontend (port 3000) and backend (port 3001) in development mode
- `npm run dev:frontend` - Start only the Vite frontend development server
- `npm run dev:backend` - Start only the backend with hot reload using tsx watch
- `npm start` - Start production server

### Testing
- `npm test` - Run all tests
- `npm run test:unit` - Run unit tests only (excludes integration tests)
- `npm run test:integration` - Run integration tests only
- `npm run test:coverage` - Run tests with coverage report
- `npm run test:watch` - Run tests in watch mode with UI

### Code Quality
- `npm run lint` - Run ESLint on TypeScript, JavaScript, and Vue files
- `npm run lint:fix` - Run ESLint with auto-fix
- `npm run build` - Build production assets
- `npm run preview` - Preview production build

## Architecture

### Domain-Driven Structure
The backend is organized into domains, each with their own API routes, entities, services, and interfaces:
- **Accounts** - User account management and invitations
- **Authentication** - Login, password reset, JWT handling
- **Calendar** - Core calendar and event functionality
- **ActivityPub** - Federation protocol implementation
- **Configuration** - Site settings and configuration
- **Media** - File upload and media management
- **Public** - Public-facing calendar views

### Key Architectural Patterns

#### Domain Organization
Each domain follows this structure:
- `api/v1/` - Express route handlers
- `entity/` - Sequelize database models
- `model/` - Business model objects that are not exposed on the client side
- `service/` - Business logic and data processing
- `interface/` - Domain interfaces for cross-domain communication
- `events/` - Domain events and event handlers
- `test/` - Domain-specific tests

#### Model Layer
- **Common Models** (`src/common/model/`) - Shared data models used across client/server
- **Entity Models** (`src/server/*/entity/`) - Sequelize database entities
- **Translation Support** - Base `TranslatedModel` class for multilingual content

#### Frontend Structure
- **Client App** (`src/client/`) - Main authenticated user interface
- **Site App** (`src/site/`) - Public calendar views
- **Components** - Vue 3 components with composition API
- **Stores** - Pinia stores for state management
- **Services** - API client services

### Database and ORM
- PostgreSQL in production, SQLite for testing
- Sequelize ORM with TypeScript decorators
- Database resets and re-seeds on development server restart
- Event instances are automatically refreshed after seeding

### Federation
- ActivityPub protocol implementation for calendar federation
- HTTP signature verification for secure federation
- Support for federated event sharing and discovery

### Internationalization
- i18next for server-side translations
- Vue i18next integration for client-side
- Translation files in `src/*/locales/` directories
- Handlebars template helpers for email translations

### Testing Strategy
- Vitest for unit and integration testing ( 'npx vitest run ...')
- Vue Test Utils for component testing
- Supertest for API testing
- Development database resets automatically, so test data doesn't persist
- Playwright for end to end (e2e) testing

### Development Server Behavior
- Backend auto-restarts on file changes
- Database resets and re-seeds with test data on restart
- Frontend hot-reloads without server restart
- Check server status with `lsof -i :3000` if needed

## Path Aliases
- `@/*` maps to `src/*` (configured in tsconfig.json and vite.config.ts)

## Important Configuration
- TypeScript with experimental decorators for Sequelize
- ESLint with Vue and TypeScript support
- SCSS preprocessing with modern compiler
- Development runs on ports 3000 (frontend) and 3001 (backend)

## Agent OS Documentation

### Product Context
- **Mission & Vision:** @agent-os/product/mission.md
- **Technical Architecture:** @agent-os/product/tech-stack.md
- **Development Roadmap:** @agent-os/product/roadmap.md
- **Decision History:** @agent-os/product/decisions.md

### Project Management
- **Active Specs:** @agent-os/specs/

## Workflow Instructions

When asked to work on this codebase:

1. **First**, check @agent-os/product/roadmap.md for current priorities
3. **Always**, adhere to the standards in the files listed above

## Important Notes

- Product-specific files in `agent-os/product/` override any global standards
- User's specific instructions override (or amend) instructions found in `.agent-os/specs/...`
- Always adhere to established patterns, code style, and best practices documented above.