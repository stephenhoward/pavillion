---
description: How Pavillion's code is organized — the server domains and the rules between them, the frontend apps, entity and model separation, and where business logic belongs.
---

# Architecture

This guide is for developers about to change Pavillion's code who need to know where that change belongs. The short version: the server is split into domains that only talk to each other through one interface class each, the database layer never leaks past a domain's services, and HTTP handlers stay thin. The rest of this page explains each of those rules and what breaks when one is skipped.

## The parts of the application

Everything lives under `src/`, and the top-level folder tells you who the code runs for.

- **`src/server/`** — the Express backend, split into domains (below). `server.ts` builds the domains and wires them together; `worker.ts` is the entry point for the background-job process.
- **`src/client/`** — the authenticated app: the screens calendar owners, editors and administrators use to manage calendars and the instance.
- **`src/site/`** — the public calendar pages anyone can browse without an account.
- **`src/widget/`** — the calendar that renders inside an iframe on someone else's website. **`src/widget-sdk/`** is the small script a host page loads to create that iframe.
- **`src/common/`** — code shared across the others: domain models, exceptions, routing helpers, validation and i18n setup. `src/common/ui/` holds the components and styling used by more than one frontend app.

Imports use the `@/` alias for `src/`, so `@/common/model/calendar` rather than a chain of `../`.

The client and site are separate Vue apps on purpose. The site serves anonymous visitors and carries none of the authenticated app's code or state; keep anything that needs a login out of it.

## Server domains

The backend is organized by business domain, not by technical layer. The current domains are accounts, activitypub, authentication, calendar, configuration, email, funding, housekeeping, media, moderation, notifications, public and setup — each a folder under `src/server/`. The project decision behind this is DEC-003 in the project's decision log.

A domain folder has the same shape every time:

| Folder | Holds |
|---|---|
| `api/v1/` | Express route handlers — the HTTP surface |
| `entity/` | Sequelize entities — the database tables |
| `model/` | Models only the server needs, such as email messages |
| `service/` | Business logic |
| `interface/` | The domain's single public class, used by every other domain |
| `events/` | Handlers for events published on the shared event bus |
| `test/` | Unit tests, with integration tests under `test/integration/` |

Not every domain needs every folder. The domain's `index.ts` installs its API routes and its event handlers when the server starts.

### The boundary rules

**Never import from another domain's `service/`, `entity/` or `model/` folders.** The only thing one domain may use from another is its interface class.

**Talk to another domain through its interface.** Each domain exposes one class in `interface/index.ts` — a concrete class, despite the name. `server.ts` creates each domain's interface and passes it into the constructor of any domain that depends on it. If calendar needs account information, `CalendarDomain` receives an `AccountsInterface`, calls a method on it, and never learns how accounts are stored. When two domains need each other, one of them receives the other through a setter after both are built, which keeps the dependency visible instead of turning it into a circular import.

**Announce, don't call, when the other domain only needs to react.** A single `EventEmitter`, the event bus, is created in `server.ts` and handed to every domain. When calendar creates a calendar, it emits an event; activitypub listens for that event and provisions the calendar's federation identity. Calendar doesn't know activitypub exists. Use the event bus when the sender doesn't need an answer, and the interface when it does.

The quick test for a new piece of cross-domain work: does the caller need a return value? If yes, add a method to the other domain's interface. If no, emit an event and let the other domain decide what to do with it.

::: tip <Lightbulb /> A note on enforcement.
No lint rule catches a cross-domain import; code review does. A shortcut import of another domain's service works on the day you write it, and it turns that service's internals into a contract nobody agreed to. Adding the method to the interface is a few extra lines and keeps the domain free to change.
:::

## Entities and models

The database layer and the business layer are separate types.

- **Entities** live in each domain's `entity/` folder. They are Sequelize classes that describe a table — columns, associations, nothing else. No business logic.
- **Models** live in `src/common/model/`, so the frontend and backend share the same definitions. A model is a plain class that carries behavior. Multilingual models (a calendar's name and description in several languages, say) extend `TranslatedModel`.

Each entity converts itself with `toModel()`, and builds itself from a model with the static `fromModel()`. Services do that conversion at the database edge, so everything above the service — interfaces, API handlers, other domains — sees models, never entities.

The same separation applies on the wire. A model goes out as JSON through `toObject()` and comes back through its static `fromObject()`, which is how the frontend gets real model instances rather than loose objects.

The reason for the split is that an entity is shaped by the database and a model is shaped by what the application needs. Once an entity escapes its domain, a column rename turns into a change across the codebase.

## API handlers and services

HTTP handlers in `api/v1/` are adapters. A handler:

- reads parameters from the request,
- calls a method on its domain's interface,
- catches the domain's exceptions and maps each to a status code, and
- serializes the result with `toObject()`.

All validation, authorization and business rules live in the service layer. Services take plain values or models as arguments, look up what they need, check that it exists, and throw a specific exception when something is wrong. A service never sees a `Request` or `Response` and never chooses a status code.

The payoff is reuse. The same service method serves the HTTP API, an event-bus handler, a command-line tool and a test, and it enforces the same rules in all four. A permission check written in a route handler is a check the event handler and the CLI silently skip.

Exceptions shared between server and frontend live in `src/common/exceptions/`. When a handler sends an error, it includes the exception's name as `errorName` so the frontend can rebuild the same exception type.

## Frontend styling

The style system — design tokens, component classes and the rules for when to write new CSS — is documented in the [style system README](https://github.com/stephenhoward/pavillion/blob/main/src/client/assets/style/README.md). Read it before adding styles; most of what a new component needs already exists.

## What next

- [Tech stack](./tech-stack) — what each part of this architecture is built with.
- [Contributing guide](https://github.com/stephenhoward/pavillion/blob/main/docs/CONTRIBUTING.md) — environment setup, branches, commits and pull requests.
