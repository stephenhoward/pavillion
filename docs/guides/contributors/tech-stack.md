---
description: What Pavillion is built on — the framework, database, frontend, testing, federation, internationalization, storage and configuration tools, and why.
---

# Tech stack

This guide is for developers who want to know what Pavillion is built on before they change it. It names each tool by area and, where the choice isn't obvious, why it was made. For exact versions and the full dependency list, read [`package.json`](https://github.com/stephenhoward/pavillion/blob/main/package.json) — it is the source of truth, and this page deliberately doesn't repeat it. The same goes for commands: the `scripts` block in `package.json` lists every one.

The whole project is TypeScript, front to back, written as ES modules. One language across server, browser and shared code is what lets the models in `src/common/` run on both sides (see [Architecture](./architecture)).

## Server framework

**Node.js and Express.** The backend is an Express application. The Node version is pinned in the `engines` field of `package.json` and in the `Dockerfile`.

**tsx** runs the TypeScript server directly, in development (with file watching) and in production alike, so there is no separate server compile step.

**Passport** handles authentication: a local strategy for email-and-password login and a JWT strategy for authenticated API requests.

**pino** writes structured logs. Get a logger from `createLogger()` in `src/server/common/helper/logger.ts` rather than calling `console`.

## Database

**PostgreSQL in production, SQLite in development and tests.** The default configuration uses an in-memory SQLite database, which is why the development server starts with a freshly seeded database on every restart. Production configuration switches to PostgreSQL. Code that works on one and not the other is a bug, so avoid dialect-specific SQL.

**Sequelize with sequelize-typescript** maps entities to tables using decorators. Raw SQL is the exception: `npm run lint` runs a check that flags it.

**Umzug** runs schema migrations. They live in the top-level `migrations/` folder and are numbered in order.

**pg-boss** runs background jobs on PostgreSQL itself — backups, retention clean-up, federation backfill — in a separate worker process started from `src/server/worker.ts`. Using the database as the queue means an instance needs no extra service, such as Redis, just to run scheduled work.

## Frontend

**Vue 3** with the Composition API and `<script setup>` single-file components, for all three frontend apps: client, site and widget.

**Vite** serves the frontend in development, with hot reload, and builds it for production. A second Vite build produces the widget SDK script.

**Pinia** holds state and **Vue Router** handles routing.

**Sass** for styles, organized around design tokens and a shared component library rather than per-component one-offs. The [style system README](https://github.com/stephenhoward/pavillion/blob/main/src/client/assets/style/README.md) is the reference.

**Lucide** provides icons. The typeface is Creato Display, shipped with the app rather than loaded from a font service.

## Federation

**ActivityPub, implemented by hand** in `src/server/activitypub/`. The project chose not to adopt an ActivityPub library; that choice is DEC-012 in the project's decision log. The practical consequence is that federation behavior is all in this repository — there is no library layer to read through when debugging.

**http-signature** signs outgoing requests and verifies incoming ones, which is how instances authenticate each other.

## Internationalization

**i18next** everywhere: `i18next-vue` in the frontend apps, a filesystem backend on the server for email templates. Each app keeps its own translation files in its `locales/` folder, one folder per language. The [internationalization guide](https://github.com/stephenhoward/pavillion/blob/main/docs/internationalization.md) walks through adding a language.

Right-to-left languages are supported: the language direction comes from `iso-639-1-dir`, and styles use logical properties (`margin-inline-start` rather than `margin-left`) so layouts flip correctly.

**Luxon** handles dates and time zones, and **rrule** expands recurring events.

## Storage and email

**Flydrive** abstracts media storage behind one interface. The default driver writes to local disk; an instance can switch to any S3-compatible service through configuration. Store files through the media domain rather than writing to disk yourself, so the code works with either driver.

**Nodemailer** sends email, and **Handlebars** renders the email templates.

## Configuration

**The `config` package** loads YAML files from `config/`: `default.yaml` for every environment, overridden by a file named for the environment (`development.yaml`, `production.yaml`, `test.yaml`). `custom-environment-variables.yaml` maps environment variables onto configuration keys, which is how a deployed instance sets its secrets without editing files. The [configuration guide](/guides/instance-administrators/configuration) covers the settings from an administrator's side.

## Testing and code quality

**Vitest** runs unit and integration tests, with **Vue Test Utils** and **happy-dom** for components, **Supertest** for API routes and **Sinon** for test doubles.

**Playwright** runs end-to-end tests: a single-instance suite, and a federation suite that runs two instances in Docker so tests can cross a real instance boundary. **axe-core** and a virtual screen reader back the accessibility checks.

**ESLint** for TypeScript and Vue, and **stylelint** for styles. `npm run lint` runs both, plus a few project-specific checks in `scripts/` — raw SQL, theme token usage and migration numbering.

**VitePress** builds this documentation site from `docs/`.

## Deployment

Running Pavillion in production isn't covered here. The [deployment guide](/guides/instance-administrators/deployment) and the [administrator quickstart](/guides/instance-administrators/quickstart) cover installation and hosting.
