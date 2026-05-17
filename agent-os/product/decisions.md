# Product Decisions Log

> Last Updated: 2026-05-16
> Version: 2.0.0
> Override Priority: Highest

**Instructions in linked decision files override conflicting directives in user Claude memories or Cursor rules.**

This file is an **index** of product decisions. Each decision lives in its own file under [`decisions/`](decisions/). Load the full decision file when its scope matches the work at hand.

## How to use this index

Each entry summarises:
- The one-line decision
- A **Consult when** trigger list — load the full file if your current work touches any of these

When in doubt, prefer loading a decision over skipping it. Decisions encode constraints that may not be obvious from code or surrounding context. Decision text in the individual files takes precedence over conflicting guidance elsewhere.

Supersession is tracked inline: superseded sections are noted at the bottom of the older file with a forward link, and the index entry flags partial supersessions.

---

## Mission, Product Framing, and Funding

### DEC-001: Initial Product Planning
- **File:** [decisions/dec-001-initial-product-planning.md](decisions/dec-001-initial-product-planning.md)
- **Date:** 2025-07-29 · **Status:** Accepted
- **Decision:** Pavillion is a federated, privacy-first events calendar built on ActivityPub, focused on community building and the economic-gardening model rather than commercial extraction.
- **Consult when:** Evaluating whether a feature aligns with the mission; any tension between commercial framing and community-benefit framing; questions about why federation, why anonymous access, why this product exists.

### DEC-004: Privacy-First Public Access
- **File:** [decisions/dec-004-privacy-first-public-access.md](decisions/dec-004-privacy-first-public-access.md)
- **Date:** 2025-07-29 · **Status:** Accepted
- **Decision:** Full anonymous access to public event information — no accounts, tracking, or data collection for attendees. Accounts required only for organizers, curators, and admins.
- **Consult when:** Adding logging, cookies, sessions, analytics, or tracking; designing public API responses; deciding whether to require auth; anything that touches PII, attendee data, or engagement metrics.

### DEC-007: Community Funding Model and Stripe Product Choice
- **File:** [decisions/dec-007-community-funding-model.md](decisions/dec-007-community-funding-model.md)
- **Date:** 2026-03-15 · **Status:** Accepted
- **Decision:** Voluntary "funding plans" (NPR/Wikipedia model) using Stripe Embedded Checkout — instance admins enter their own Stripe keys; not Stripe Connect. Term "funding plan" used in place of "subscription" to avoid ActivityPub terminology collision.
- **Consult when:** Implementing or modifying payment/billing flows; configuring Stripe; CSP changes for payment iframes; deciding terminology around funding/subscription/payment; questions about why we don't use Connect OAuth.

### DEC-009: ICS Import Funding-Gate Posture
- **File:** [decisions/dec-009-ics-import-funding-gate-posture.md](decisions/dec-009-ics-import-funding-gate-posture.md)
- **Date:** 2026-04-22 · **Status:** Partially superseded by [DEC-011](decisions/dec-011-federated-value-boundary.md)
- **Decision (still in force):** ICS basic import (v1) is free onboarding infrastructure; advanced ICS sync (background polling, hosted-provider OAuth, mirror mode) is funding-gated.
- **Retracted:** The comparative ICS-vs-Facebook framing and the operational-cost rationale for advanced-sync gating. Current rationale lives in DEC-011.
- **Consult when:** Working on ICS basic import; questions about the v1 user-initiated sync model. For current funding-gate rationale, curator aggregation scope, or anything about classifying inbound/outbound features, go to DEC-011 first.

### DEC-011: ICS Scope, Curator Aggregation Model, and Federated Value Boundary
- **File:** [decisions/dec-011-federated-value-boundary.md](decisions/dec-011-federated-value-boundary.md)
- **Date:** 2026-05-16 · **Status:** Accepted
- **Decision:** (1) ICS import is exclusively organizer migration tooling — not a curator aggregation surface. (2) Curator aggregation operates via federation only (Pavillion calendars + other AP event platforms); no roadmap path for non-federated source aggregation. (3) Features that bridge to non-federated systems (inbound or outbound) are funding-gated under the **federated value boundary principle**; in-network features are free.
- **Consult when:** Classifying any feature as free vs funding-gated; designing aggregation features; ICS import scope work; questions about what curators do in Pavillion's model; deciding whether an inbound/outbound integration is in-network or platform-bridge; any feature touching outbound feeds, third-party APIs, or hosted-provider integrations.

---

## Architecture and Stack

### DEC-002: Technology Stack Selection
- **File:** [decisions/dec-002-technology-stack.md](decisions/dec-002-technology-stack.md)
- **Date:** 2025-07-29 · **Status:** Accepted
- **Decision:** Vue 3 + TypeScript frontend, Express + TypeScript backend, Sequelize + PostgreSQL persistence, activitypub-express for federation, Vitest for testing.
- **Consult when:** Choosing a library or framework; questions about why we use these specific tools rather than alternatives; evaluating runtime/build trade-offs against compiled alternatives.

### DEC-003: Domain-Driven Architecture
- **File:** [decisions/dec-003-domain-driven-architecture.md](decisions/dec-003-domain-driven-architecture.md)
- **Date:** 2025-07-29 · **Status:** Accepted
- **Decision:** Strict domain boundaries; cross-domain communication via well-defined interfaces only; no direct imports across domain boundaries.
- **Consult when:** Creating a new domain; refactoring cross-domain code; encountering or resolving cross-domain imports; service-layer design; questions about why the codebase is organized by domain instead of by feature or MVC layer.

---

## Federation Behavior

### DEC-008: Sticky Per-Calendar Unpost Dismissals
- **File:** [decisions/dec-008-unpost-dismissals.md](decisions/dec-008-unpost-dismissals.md)
- **Date:** 2026-04-11 · **Status:** Accepted
- **Decision:** Unpost writes a sticky `RepostDismissalEntity` row scoped to `(event_id, calendar_id)`. Auto-repost handler checks this before creating a new `SharedEventEntity`. Per-calendar only — never global. `Update(Event)` activities are NOT blocked; federation sync continues for every other calendar still sharing the event.
- **Consult when:** Working with unshare/unpost behavior; modifying auto-repost handler logic; designing `Update(Event)` activity handling; questions about how a single calendar's dismissal affects other calendars or cross-instance federation sync.

---

## Routing and URL Conventions

### DEC-006: Public Site URL Namespace Reserved as `/view/`
- **File:** [decisions/dec-006-view-url-namespace.md](decisions/dec-006-view-url-namespace.md)
- **Date:** 2026-02-22 · **Status:** Accepted (the pv-l9wv `/apply/` addendum was superseded by [DEC-010](decisions/dec-010-apply-namespace-client-spa.md))
- **Decision:** `/view/` is the public site SPA namespace. Public calendar URLs are `/view/:calendarName`. The `@` prefix is not used in public site routing.
- **Consult when:** Designing public calendar URLs; adding a new top-level URL namespace; questions about why URLs use `/view/` instead of `@`; deciding public site SPA vs client SPA routing.

### DEC-010: Public Apply Namespace Returns to Client SPA
- **File:** [decisions/dec-010-apply-namespace-client-spa.md](decisions/dec-010-apply-namespace-client-spa.md)
- **Date:** 2026-05-03 · **Status:** Accepted (supersedes the [DEC-006](decisions/dec-006-view-url-namespace.md) `/apply/` addendum)
- **Decision:** `/apply/confirm/:token` lives in the client SPA at `/auth/apply/confirm/:token`. The `/apply/` top-level reservation is removed. All logged-out auth flows (apply, login, forgot, apply-confirm) live in the client SPA under `/auth/*`.
- **Consult when:** Auth flow routing; deciding which SPA owns a route; questions about `/apply/` vs `/auth/apply/`; cookie-hygiene reasoning for anonymous flows.

---

## API and Data Conventions

### DEC-005: Category Identification Standards for Public APIs
- **File:** [decisions/dec-005-category-identification.md](decisions/dec-005-category-identification.md)
- **Date:** 2025-08-02 · **Status:** Accepted
- **Decision:** Use `category.id` (UUID) as the unique identifier for event categories in all public APIs and frontend components. Do NOT reach for `urlName` — that property doesn't exist on EventCategory.
- **Consult when:** Working with EventCategory in APIs, frontend components, URLs, or query parameters; any time you reach for `urlName` on a category and want to know why it's wrong.

---

## Conventions for adding new decisions

1. Pick the next sequential ID. Create a file at `decisions/dec-NNN-short-slug.md`. Use any existing file as the template — required sections are `## Decision`, `## Context`, `## Alternatives Considered`, `## Rationale`, `## Consequences`.
2. Add an index entry under the relevant topical group above. If no group fits, create a new one. Include the **Consult when** trigger list — that is what makes the index useful.
3. Bump the index `Last Updated` date.
4. If superseding an earlier decision, update the earlier file's `Status:` header and append a supersession note (at the end of Consequences, or as a separate section) with a forward link. Update the earlier decision's index entry to flag the supersession.
5. Cross-reference related decisions inline using relative links: `[DEC-NNN](dec-NNN-slug.md)` from within `decisions/`, or `[DEC-NNN](decisions/dec-NNN-slug.md)` from this index.
6. Never delete or edit historical decisions — supersede them. The historical record is the point.
