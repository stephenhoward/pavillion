# Pavillion Tech Stack

> Version: 1.0.0
> Last Updated: 2025-07-29
> Scope: Pavillion federated events calendar system

## Context

This file defines the complete technology stack for the Pavillion project - a federated events calendar system with ActivityPub federation support. This tech stack is optimized for building scalable, multilingual, federated social calendar applications.

## Core Technologies

### Application Framework
- **Framework:** Express.js
- **Version:** 4.21+
- **Language:** TypeScript 5.8+
- **Runtime:** Node.js 22 LTS
- **Module System:** ES Modules (type: "module")

### Database
- **Primary:** PostgreSQL 17+
- **ORM:** Sequelize 6.37+ with sequelize-typescript 2.1+
- **Development DB:** SQLite3 5.1+ (for rapid development/testing)
- **Schema:** Sequelize decorators with entity classes

## Frontend Stack

### JavaScript Framework
- **Framework:** Vue.js 3.5+
- **Composition API:** `<script setup>` pattern
- **Build Tool:** Vite 6.3+
- **TypeScript:** Full TypeScript integration

### Import Strategy
- **Strategy:** ES Modules with path aliases
- **Package Manager:** npm
- **Node Version:** 22 LTS
- **Path Aliases:** `@/*` for `src/*`

### CSS Framework
- **Primary:** Custom SCSS with mixins
- **Preprocessor:** Sass/SCSS (sass 1.80+)
- **Architecture:** Component-scoped styles with shared mixins
- **Dark Mode:** Built-in light/dark theme support

### UI Components
- **Strategy:** Custom Vue 3 components
- **Pattern:** Single File Components (.vue)
- **Icons:** Custom implementation (no external icon library)
- **Typography:** Creato Display font family

### State Management
- **Library:** Pinia 3.0+ (Vue 3 state management)
- **Pattern:** Composable stores with TypeScript
- **Persistence:** Local storage integration

## Development Tools

### Code Quality
- **Linter:** ESLint 9.26+ with TypeScript plugin
- **Style Plugin:** @stylistic/eslint-plugin 4.2+
- **Vue Plugin:** eslint-plugin-vue 10.1+
- **TypeScript:** @typescript-eslint/eslint-plugin 8.32+

### Testing Framework
- **Test Runner:** Vitest 3.1+ (Vite-native testing)
- **Frontend Testing:** @vue/test-utils 2.4+ with happy-dom 15.11+
- **Backend Testing:** Supertest 7.1+ for API testing
- **Mocking:** Sinon 19.0+ for test doubles
- **Coverage:** @vitest/coverage-v8 3.1+

### Development Workflow
- **Hot Reload:** Vite dev server for frontend
- **Backend Watch:** tsx 4.19+ with watch mode
- **Concurrency:** concurrently 9.1+ for parallel dev servers
- **TypeScript Execution:** tsx for direct TypeScript execution

## Backend Architecture

### Authentication & Security
- **Session Management:** Passport.js 0.7+
- **Local Auth:** passport-local 1.0+
- **API Auth:** passport-jwt 4.0+ with jsonwebtoken 9.0+
- **HTTP Signatures:** http-signature 1.4+ (for ActivityPub)

### File Storage & Media
- **Storage Abstraction:** Flydrive 1.2+ (multi-provider storage)
- **Cloud Storage:** Amazon S3 (@aws-sdk/client-s3 3.828+)
- **Upload Handling:** Multer 2.0+ for multipart uploads
- **Image Processing:** Native implementation

### Email Services
- **SMTP Client:** Nodemailer 6.9+ 
- **Template Engine:** Handlebars 4.7+ (for email templates)
- **Configuration:** Environment-based SMTP settings

### Internationalization
- **i18n Library:** i18next 25.0+ (multilingual support)
- **Vue Integration:** i18next-vue 5.2+
- **Browser Detection:** i18next-browser-languagedetector 8.1+
- **Backend Loading:** i18next-fs-backend 2.6+
- **Language Direction:** iso-639-1-dir 3.0+ (RTL support)

### Date & Time
- **Date Library:** Luxon 3.5+ (modern date/time handling)
- **Recurrence:** RRule 2.8+ (recurring event patterns)
- **Timezone Support:** Full timezone handling with Luxon

## Configuration Management

### Application Configuration
- **Config Library:** config 3.3+ (hierarchical configuration)
- **Format:** YAML configuration files
- **Environments:** default.yaml, development.yaml, test.yaml
- **Pattern:** Environment-specific overrides

### Environment Files Structure
```
config/
├── default.yaml          # Base configuration
├── development.yaml      # Development overrides
├── test.yaml            # Test environment settings
└── seeds/               # Database seed data
```

## Development Environment

### Package Scripts
```json
{
  "dev:frontend": "vite",
  "dev:backend": "NODE_ENV=development tsx watch src/server/app.ts",
  "dev": "concurrently 'npm:dev:frontend' 'npm:dev:backend'",
  "start": "NODE_ENV=production node src/server/app.ts",
  "build": "vite build",
  "test": "npx vitest run",
  "test:unit": "npx vitest run --exclude='**/integration/**'",
  "test:coverage": "npx vitest run --exclude='**/integration/**' --coverage",
  "test:integration": "npx vitest run integration",
  "lint": "eslint --ext .ts,.js,.vue src",
  "lint:fix": "eslint --ext .ts,.js,.vue src --fix"
}
```

### Example Application Structure
```
src/
├── client/              # Authenticated user interface
│   ├── app.ts          # Client app entry point
│   ├── components/     # Vue components
│   ├── assets/         # SCSS styles and fonts
│   ├── locale/         # Client i18n translations
│   └── test/           # Client unit tests
├── site/               # Public calendar viewer
│   ├── app.ts          # Site app entry point
│   ├── components/     # Public-facing components
│   ├── assets/         # Site-specific styles
│   └── locale/         # Site i18n translations
|   |__ test/           # Site unit tests
├── server/             # Backend application
│   ├── app.ts          # Express.js server entry
│   ├── {domain}/       # Domain-specific modules
│   │   ├── api/        # REST API handlers
│   │   ├── entity/     # Database entities
│   │   ├── service/    # Business logic services
│   │   ├── interface.ts # Domain interface
│   │   └── test/       # Domain tests
│   └── common/         # Shared server utilities
└── common/             # Shared frontend/backend code
    ├── model/          # Domain models
    ├── exceptions/     # Custom exceptions
    └── test/           # Shared model tests
```

## Deployment Stack

### Application Hosting
- **Platform:** Not yet specified (to be determined)
- **Container:** Node.js 22 LTS runtime
- **Process Manager:** PM2 or similar for production
- **Environment Variables:** dotenv pattern for configuration

### Database Hosting
- **Production:** PostgreSQL (managed service recommended)
- **Development:** Local PostgreSQL or SQLite
- **Migrations:** Sequelize migrations for schema changes
- **Seeds:** YAML-based seed data for development

### Asset Storage
- **Development:** Local file system
- **Production:** S3-compatible storage (AWS S3, DigitalOcean Spaces, etc.)
- **CDN:** CloudFront or equivalent for asset delivery
- **Access Control:** Signed URLs for private media

## Version Requirements

### Core Dependencies
```json
{
  "vue": "^3.5.12",
  "express": "^4.21.1",
  "typescript": "^5.8.3",
  "vite": "^6.3.5",
  "vitest": "^3.1.3",
  "sequelize": "^6.37.5",
  "sequelize-typescript": "^2.1.6",
  "activitypub-express": "^4.4.2",
  "i18next": "^25.0.2",
  "luxon": "^3.5.0",
  "passport": "^0.7.0"
}
```

### Development Dependencies
```json
{
  "@vitejs/plugin-vue": "^5.2.0",
  "@typescript-eslint/eslint-plugin": "^8.32.0",
  "@vue/test-utils": "^2.4.6",
  "eslint": "^9.26.0",
  "sass": "^1.80.6",
  "sinon": "^19.0.2",
  "tsx": "^4.19.2",
  "concurrently": "^9.1.0"
}
```