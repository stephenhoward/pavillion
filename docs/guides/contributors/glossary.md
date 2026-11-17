---
description: The architectural terms Pavillion's code and contributor guides use — domain, interface, service, entity, model, event bus, handler and the federation vocabulary — and where each lives in the repository.
---

# Glossary

These are the words the [architecture guide](./architecture) and the codebase use for the server's moving parts. Each entry says what the word means here, where to find it, and the rule that goes with it.

## calendar actor

A calendar's identity on the federation: the ActivityPub account other servers follow and send activities to. Local calendars each get one, with a key pair for signing; remote calendars discovered through federation are stored in the same table, `calendar_actor` (`src/server/activitypub/entity/calendar_actor.ts`). The calendar domain announces that a calendar was created, and the activitypub domain creates the actor in response; calendar code never builds one itself. See [DEC-012](https://github.com/stephenhoward/pavillion/blob/main/docs/decisions/dec-012-hand-rolled-activitypub-implementation.md).

## domain

A top-level folder under `src/server/` that owns one area of business logic: `calendar`, `activitypub`, `accounts`, `moderation`, `funding` and the others listed in the [architecture guide](./architecture#server-domains). Domains do not import each other's internals; they work through each other's interface or the event bus. See [DEC-003](https://github.com/stephenhoward/pavillion/blob/main/docs/decisions/dec-003-domain-driven-architecture.md).

## domain event

A message a domain emits on the event bus to say something happened, such as a calendar being created. The emitter does not know who listens and does not wait for an answer. Event payload types live in a domain's `events/types.ts`, in the domains that publish events.

## entity

A Sequelize class in a domain's `entity/` folder that maps to one database table, with columns and associations and no business logic. An entity converts itself to a model with `toModel()` and is built from one with the static `fromModel()`. Entities stay inside their domain; everything above the service sees models.

## event bus

The single `EventEmitter` created in `src/server/server.ts` and handed to every domain. Use it when the sender does not need a return value; use the other domain's interface when it does. Emitting never awaits a listener.

## handler

A function a domain registers on the event bus to react to a domain event. Handlers are installed from the domain's `events/index.ts`. In the calendar, activitypub, funding and moderation domains each handler is wrapped in `guardEventHandler` (`src/server/common/helper/guard-event-handler.ts`), because the bus never awaits a listener and an unhandled rejection from an async handler would end the process. The wrapper logs the failure and isolates it. A handler is also called a listener.

## inbox

Where a calendar receives activities from other servers. In code, the `ap_inbox` table (`ActivityPubInboxMessageEntity` in `src/server/activitypub/entity/activitypub.ts`) stores every inbound activity along with how it was authenticated. Remote calendar actors also carry an `inbox_url`. See [DEC-013](https://github.com/stephenhoward/pavillion/blob/main/docs/decisions/dec-013-inbox-authenticated-activity-log.md).

## instance

One running Pavillion server together with its database. Instances federate with each other, and each has its own administrators, calendars and configuration. A calendar's "local" or "remote" status is relative to the instance you are looking from.

## interface

The class in a domain's `interface/index.ts`, and the only part of a domain other domains may call. `server.ts` creates each domain's interface and passes it into the domains that depend on it. `npm run lint:deps` checks cross-domain imports across `src/server` and fails on a violation.

## model

A plain class that carries behavior and is what code passes around and the API serializes with `toObject()` and `fromObject()`. Models shared with the frontend live in `src/common/model/`; models only the server needs live in a domain's `model/` folder. Multilingual models extend `TranslatedModel`.

## outbox

Where a calendar's own activities are recorded before delivery to other servers. In code, the `ap_outbox` table in `src/server/activitypub/entity/activitypub.ts`; a calendar's public outbox serves the public ones. See [DEC-024](https://github.com/stephenhoward/pavillion/blob/main/docs/decisions/dec-024-outbox-contract.md).

## service

A class in a domain's `service/` folder that holds the domain's business logic: validation, authorization, database access, and the conversion between entities and models. Services take plain values or models, throw specific exceptions, and never see a request or response. API handlers and event handlers both call them.
