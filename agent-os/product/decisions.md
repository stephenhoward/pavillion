# Product Decisions Log

> Last Updated: 2026-09-19
> Version: 2.6.0
> Override Priority: Highest

**Instructions in linked decision files override conflicting directives in user Claude memories or Cursor rules.**

This file is an **index** of product decisions. Each decision lives in its own file under [`decisions/`](decisions/). Load the full decision file when its scope matches the work at hand.

## How to use this index

Each entry summarises:
- The one-line decision
- A **Consult when** trigger list — load the full file if your current work touches any of these

When in doubt, prefer loading a decision over skipping it. Decisions encode constraints that may not be obvious from code or surrounding context. Decision text in the individual files takes precedence over conflicting guidance elsewhere.

Every decision file describes **current state**. An accepted decision whose surrounding reality has moved is edited in place to match — git holds the change history, so the file itself does not carry a log of its own revisions.

Supersession is the exception, because it retires a decision rather than refining one: superseded sections are noted at the bottom of the older file with a forward link, and the index entry flags partial supersessions.

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
- **Decision:** Voluntary "funding plans" (NPR/Wikipedia model, applied instance-inward: calendar owners support the instance operator, who keeps the service online) using Stripe Embedded Checkout — instance admins enter their own Stripe keys; not Stripe Connect. Stripe is the only provider in v1; PayPal is descoped, its scaffolding left inert and hidden from the admin UI. Vocabulary: the instance is always the recipient of support and calendars are "covered by" a plan, never "funded" — a rule that binds enum values and identifiers as much as prose, so the single-calendar status union is `'admin_exempt' | 'grant' | 'covered' | 'not_covered'`; "funding plan" is the product noun and "subscription" is reserved for payment-mechanics prose and the provider boundary; the access-gating platform is "funding access", with three bounded identifier exceptions (`SubscriptionRequiredError` as the legacy wire exception, the Stripe-mirroring provider adapter names, and the bulk admin `'subscribed'` enum).
- **Consult when:** Implementing or modifying payment/billing flows; configuring Stripe; adding or re-enabling a payment provider; CSP changes for payment iframes; naming anything in the funding or access-gating vocabulary; adding or renaming a funding status value, enum member, identifier or CSS class that describes how a calendar relates to a plan; deciding terminology around funding/subscription/payment/entitlement; distinguishing the display status from the funding-access gate; questions about why we don't use Connect OAuth, or why PayPal code exists but is unreachable.

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
- **Consult when:** Classifying any feature as free vs funding-gated; adding an entry to the funding-gated feature registry (`FUNDING_GATED_FEATURES`); designing aggregation features; ICS import scope work; questions about what curators do in Pavillion's model; deciding whether an inbound/outbound integration is in-network or platform-bridge; any feature touching outbound feeds, third-party APIs, or hosted-provider integrations.

---

## Architecture and Stack

### DEC-002: Technology Stack Selection
- **File:** [decisions/dec-002-technology-stack.md](decisions/dec-002-technology-stack.md)
- **Date:** 2025-07-29 · **Status:** Partially superseded by [DEC-012](decisions/dec-012-hand-rolled-activitypub-implementation.md)
- **Decision:** Vue 3 + TypeScript frontend, Express + TypeScript backend, Sequelize + PostgreSQL persistence, Vitest for testing. (Original DEC-002 named `activitypub-express` as the federation library; that clause is retracted — see DEC-012.)
- **Consult when:** Choosing a library or framework; questions about why we use these specific tools rather than alternatives; evaluating runtime/build trade-offs against compiled alternatives. For federation-implementation questions specifically, see DEC-012.

### DEC-003: Domain-Driven Architecture
- **File:** [decisions/dec-003-domain-driven-architecture.md](decisions/dec-003-domain-driven-architecture.md)
- **Date:** 2025-07-29 · **Status:** Accepted
- **Decision:** Strict domain boundaries; cross-domain communication via well-defined interfaces only; no direct imports across domain boundaries.
- **Consult when:** Creating a new domain; refactoring cross-domain code; encountering or resolving cross-domain imports; service-layer design; questions about why the codebase is organized by domain instead of by feature or MVC layer.

### DEC-012: Hand-Rolled ActivityPub Implementation
- **File:** [decisions/dec-012-hand-rolled-activitypub-implementation.md](decisions/dec-012-hand-rolled-activitypub-implementation.md)
- **Date:** 2026-05-23 · **Status:** Accepted (partially supersedes [DEC-002](decisions/dec-002-technology-stack.md))
- **Decision:** Pavillion's ActivityPub federation is implemented hand-rolled in `src/server/activitypub/`, not via the `activitypub-express` library named in DEC-002. The library was never imported by runtime code and was removed from the dependency tree by pv-8fif.1.
- **Consult when:** Working on federation code; questions about why we don't use activitypub-express; evaluating whether to adopt an external ActivityPub library; auditing federation security against library-specific assumptions.

### DEC-013: Inbox is the Authenticated-Activity Log
- **File:** [decisions/dec-013-inbox-authenticated-activity-log.md](decisions/dec-013-inbox-authenticated-activity-log.md)
- **Date:** 2026-05-16 · **Status:** Accepted
- **Decision:** Every `ap_inbox` row is authenticated by a recorded mechanism, captured in `auth_source` (open string enum: `'http_signature'`, `'outbox_pull'`, ...) alongside `auth_origin`, the peer origin verified at the ingest boundary. The table's invariant is "authenticated by *some* recorded mechanism," not "arrived via signed POST." The two columns split: `auth_source` (mechanism) is diagnostic — never a policy surface — while `auth_origin` (verified peer origin) is the **sanctioned policy key for inbound gates**: any gate keyed on the sender's identity consumes it, never a host re-derived from the self-asserted `actor` field. Backfill and live ingest share one storage model and one chronological dispatch pipeline.
- **Consult when:** Adding a new ingest path (ICS pull, hosted-provider OAuth, Facebook import); local in-process outbox→inbox dispatch to same-instance recipients (`auth_source='local_dispatch'`); reading from or writing to `ap_inbox`; designing or modifying the inbox dispatch pipeline; deciding how to gate trust on inbound activities; adding any inbound gate, throttle, or block keyed on the sending instance's identity — which value to key on; questions about why `auth_source` is not consulted by handlers, or why backfill writes real rows instead of dispatching synthetically.

### DEC-015: Routing Keys and Display Snapshots on Activity-Log Rows
- **File:** [decisions/dec-015-activity-log-routing-keys.md](decisions/dec-015-activity-log-routing-keys.md)
- **Date:** 2026-08-09 · **Status:** Accepted
- **Decision:** `notification_activity` carries two classes of denormalized column with opposite staleness contracts — **display snapshots** (`object_label`) whose staleness is a feature, and **routing keys** (`object_calendar_id`) whose staleness is a defect. A routing key may only be denormalized onto a log row if its source is **write-once** (invariant 6: `ReportEntity.calendar_id`; enforced by a behavioural test plus a scoped structural tripwire that is a stopgap, not the invariant's proper home). Neither class may become a policy surface — the [DEC-013](decisions/dec-013-inbox-authenticated-activity-log.md) rule transferred unchanged; authorization comes from live state. The schema change is carried by **event-carried state transfer**, not by DEC-013 precedent.
- **Consult when:** Adding, reading, or removing any denormalized column on `notification_activity` or another activity/log table; deciding whether a value may be copied across a domain boundary at write time; building a link or destination from stored data; touching `ReportEntity.calendar_id` or any report-reassignment path; changing `deriveTarget` / `collectTargetCalendarIds` / `buildTargetContext`; questions about whether a stored column may answer an authorization question; citing DEC-013 as precedent for a schema change (read the three disanalogies first).

---

## Federation Behavior

### DEC-008: Sticky Per-Calendar Unpost Dismissals
- **File:** [decisions/dec-008-unpost-dismissals.md](decisions/dec-008-unpost-dismissals.md)
- **Date:** 2026-04-11 · **Status:** Accepted
- **Decision:** Unpost writes a sticky `RepostDismissalEntity` row scoped to `(event_id, calendar_id)`. Auto-repost handler checks this before creating a new `SharedEventEntity`. Per-calendar only — never global. `Update(Event)` activities are NOT blocked; federation sync continues for every other calendar still sharing the event.
- **Consult when:** Working with unshare/unpost behavior; modifying auto-repost handler logic; designing `Update(Event)` activity handling; questions about how a single calendar's dismissal affects other calendars or cross-instance federation sync; deciding whether some other cleared local state should resist an inbound activity that re-sets it.

### DEC-014: Create Means Original, Announce Means Repost
- **File:** [decisions/dec-014-create-original-announce-repost.md](decisions/dec-014-create-original-announce-repost.md)
- **Date:** 2026-08-01 · **Status:** Accepted
- **Decision:** A locally-created event federates as `Create(Event)` with the full object embedded (id `{eventUrl}/create`); a repost federates as `Announce` carrying the canonical event IRI only. Announce is never used for an original. `isOriginal` stays derived from attribution (`attributed_to === actor`), not from wire type, so peers that Announce their own originals still classify correctly. Same-instance fan-out drives the auto-repost cascade from the Create path under `trustLocalOrigin`, where a pre-existing `EventObjectEntity` is expected rather than a duplicate. Paired Note emissions are outbound interop only — inbound Notes are never ingested. Inbound per-language content is split two ways: the ActivityPub layer strips markup and **closes the key set** (`ALLOWED_CONTENT_KEYS`), while the calendar domain owns the length cap (`sanitizeImageAlt`, a complete normalizer rather than the second half of one) because the columns are its own — from which follows the **version-skew rule**: the receiver's version decides which content keys survive ingest, so a new content field only federates once receivers upgrade. The multilingual-map gate counts only *mapped* content (name or description), shared by the Event and its Note, never `isEmpty()`. Records four intentional v1 limitations: inbound `eventStatus:EventCancelled` is not acted on; the FEP category keyword heuristic is English-only with a frozen keyword table; alt on a remote `Image` is not ingested (though alt inside `pavillion:content` **is**); and series alt text does not federate because the series object emits no `Image`.
- **Consult when:** Emitting or handling any Event-bearing activity; changing `handleEventCreated`, `processCreateEvent`, `processShareEvent`, or `checkAndPerformAutoRepost`; reasoning about original-vs-repost classification or the originals/reposts follow-policy split; adding or reordering paired Note emission; FEP-8a8e interop with Mobilizon/Gancio; questions about inbound `eventStatus` handling or why non-English categories emit no FEP category; adding, renaming, or removing a per-language content field, or changing `ALLOWED_CONTENT_KEYS`, `_sanitizeContentObject`, or `sanitizeImageAlt`; deciding which layer bounds or sanitizes a federated content value; assuming a newly added content field reaches existing peers; changing the `nameMap`/`summaryMap`/`contentMap` gate or `helper/content-languages.ts`; emitting or consuming alt text on an AS2 `Image`; proposing to ingest remote media.

### DEC-015: A Federated Report Reaches the Origin Calendar Owner First
- **File:** [decisions/dec-015-federated-report-routing.md](decisions/dec-015-federated-report-routing.md)
- **Date:** 2026-08-08 · **Status:** Accepted
- **Decision:** A moderation report crossing a federation boundary is addressed to the **origin calendar's actor**, never the origin instance's admin — outbound via `getEventSourceActorUri` from **both** send routes (`owner-report-routes.ts` and `admin-report-routes.ts`), inbound accepted **only at the owning calendar's inbox** (`processFlagActivity` drops a `Flag` whose event belongs to another calendar) and scoped there to `event.calendarId`. Inbound volume is capped per (event, reporting instance) at 5/24h rather than deduplicated, because a peer forwards each of its users' reports separately; suppressed reports are dropped, with the `ap_inbox` row ([DEC-013](decisions/dec-013-inbox-authenticated-activity-log.md)) as the record of attempt volume. Neither send route constructs an instance-level URI and both 400 when the actor cannot be resolved; the admin route additionally pins the resolved actor to the event's source host. The origin admin sees the report only through the ordinary escalation path. This is safe **only** because `dismissReport` auto-escalates (`status: ESCALATED, escalation_type: 'automatic'`) — unlike [DEC-008](decisions/dec-008-unpost-dismissals.md)'s sticky repost dismissal, a report dismissal never persists as one — so an owner controls *when* their admin sees a report, never *whether*. The endpoint (`forward-to-admin`), the persisted `decision: 'forwarded_to_remote_admin'`, and the `forward_to_admin` UI key keep "admin" names that contradict the behavior; this file is the compensating control.
- **Consult when:** Changing `dismissReport`, `ReportStatus.DISMISSED` semantics, or the `getAdminReports` escalated-OR-admin-initiated base condition; changing the report-queue `source` filter enum (`VALID_SOURCES`) or what the admin queue surfaces for `source=federation`; changing how either forward route picks a `Flag` recipient (they must move together); touching `processFlagActivity`'s check that the receiving inbox owns the reported event, or adding any new caller of `receiveRemoteReport` (the endpoint binding is the caller's obligation); changing `rateLimit.moderation.federatedReportByInstance`, `FederatedReportRateLimitError` handling, or the pattern-detection thresholds it is sized against; adding an instance-level admin actor; changing `getEventSourceActorUri`; reading or writing `forwarded_to_actor_uri` or `decision: 'forwarded_to_remote_admin'`; deciding what a calendar owner may see about a remote reporter; designing a future "federated moderation signals" feature.

---

## Routing and URL Conventions

### DEC-006: Public Site URL Namespace Reserved as `/view/`
- **File:** [decisions/dec-006-view-url-namespace.md](decisions/dec-006-view-url-namespace.md)
- **Date:** 2026-02-22 · **Status:** Superseded by [DEC-018](decisions/dec-018-root-calendar-urls.md) (its pv-l9wv `/apply/` addendum had already been superseded by [DEC-010](decisions/dec-010-apply-namespace-client-spa.md))
- **Decision (retired):** `/view/` was the public site SPA namespace and public calendar URLs were `/view/:calendarName`. DEC-018 moved those URLs to the domain root and left `/view` as a permanent redirect. **Still in force:** the `@` prefix is not used in public site routing.
- **Consult when:** Questions about why URLs do not use `@`; history of the `/view/` namespace and why the pre-launch "no redirects needed" rationale no longer applies. For the current public URL contract go to [DEC-018](decisions/dec-018-root-calendar-urls.md) first.

### DEC-018: Public Calendar URLs Live at the Domain Root
- **File:** [decisions/dec-018-root-calendar-urls.md](decisions/dec-018-root-calendar-urls.md)
- **Date:** 2026-09-14 · **Status:** Accepted (supersedes [DEC-006](decisions/dec-006-view-url-namespace.md))
- **Decision:** Public calendar URLs are `/:calendarName` and `/:lang/:calendarName`; discovery is `/discover` (the server matches a tail, the site SPA has no route for one); a bare locale root 301s to that locale's discovery page; `/view` is permanently reserved and only ever 301s (`/view` → `/discover`, `/view/<rest>` → `/<rest>`, locale twins included, query preserved). The redirects are permanent because old URLs are held by federated peers, search indexes and bookmarks — not, as under DEC-006, by a pre-launch product. `src/common/routing/reserved-segments.ts` is the **single definition of what a calendar may not be named**, and is deliberately **not** a routing table (its entries carry four different dispositions, and a router consuming it decides each one itself). Reserving a new top-level segment is therefore necessary but not always sufficient: a route served by a domain router mounted after the page router must **also** be added to `SERVER_OWNED_SEGMENTS` in `src/server/app_routes.ts` (a duplication that follows from the page router being mounted ahead of every domain router, not from a principle), or the client catch-all answers its whole subtree — 404s included — with the client HTML shell; a client SPA route needs the reserved module only; a top-level site SPA page always needs all three of the reserved module, a route in `src/site/routes.ts`, and an explicit server route ahead of the derived site routes, because reserving the name is itself what stops the segment reaching the site handler. The reservation governs **claiming** a name, never **resolving** one: `getCalendarByName` gates on `CALENDAR_URL_NAME_RE` alone, because applying the reserved list at resolution time would strip a pre-existing calendar named e.g. `admin` of its public page, actor document, WebFinger response and inbound inbox delivery, with no remedy for its owner. A **routing disposition** (which path shape is this?) may consult the reserved list — `parseEventPageParams` does; a **resolver** (does this calendar exist?) may not. Now that the root routes have shipped, the startup collision report describes present breakage — the page is unreachable today while the calendar still federates — and names both halves of the trade a deliberate rename makes. The client SPA keeps `/` and its own top-level segments. Complementing the reserved module, `src/common/routing/public-paths.ts` is the **single declaration of the shapes we emit** (`DISCOVER_PATH`, `calendarPath`, `eventPath`, `seriesPath`): one module says what a calendar may not be *named*, the other what a link to one *looks like*, and neither is the route table (`buildSiteRoutes`, joined to the builders by `public-url-contract.test.ts`). The builders are root-relative with **no locale and no origin** — locale belongs to `useLocale.localizedPath`, origin to the caller (`https://${config.domain}` + path) — which is what lets server, site and client all import them under DEC-003; composing the origin at the call site is the sanctioned pattern, never grounds to opt out. Only two deliberate non-consumers: `parseAttributedToUri`'s remote branch (a peer's domain, not ours) and `meta-tags.ts` (segments captured pre-decode would be encoded twice). Rule 2 runs one way, so its other half is that **a URL we construct on a peer's domain is a guess about that peer's version**: a remote calendar's public page URL is read from the peer's actor document `url`, origin-pinned and cached on `calendar_actor.page_url`, consumed from cache on the display path and never fetched there; the `/view/<calendarName>` guess survives only as the sweep-exempt fallback, because it resolves on peers of either version; and our own actor document declares `url` so peers need not guess ours.
- **Consult when:** Adding, moving, or removing any top-level URL namespace or route segment (server mount, client SPA route, or site SPA route) — reserving the name is necessary but may not be sufficient; mounting a new domain router, or changing `SERVER_OWNED_SEGMENTS` or the client catch-all exclusion in `src/server/app_routes.ts`; changing `src/common/routing/reserved-segments.ts` or building a route table from it; calendar or series url-name validation, and any question about whether a rule applies to creation, to a routing disposition, or to resolution; calling `isReservedRouteSegment` on a read path; touching the `/view` or bare-locale-root redirects, or proposing to retire them; locale-prefixed routing (`/:lang/...`) and why locale codes are reserved by delegation rather than enumeration; the startup reserved-name collision report and what it tells an operator; deciding which SPA serves a path; designing public calendar, event, or series link generation; emitting any URL or path to one of our own public pages, adding or changing a builder in `src/common/routing/public-paths.ts`, or proposing that a call site is exempt from them; constructing or resolving any URL on a *peer's* domain, including a remote calendar's public page link, `calendar_actor.page_url`, `sanitizePeerPageUrl`, or `parseAttributedToUri`'s fallback; adding a property to the actor document we emit.

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

## Security and Disclosure

### DEC-016: The Public Health-Report Disclosure Boundary
- **File:** [decisions/dec-016-health-report-disclosure-boundary.md](decisions/dec-016-health-report-disclosure-boundary.md)
- **Date:** 2026-08-29 · **Status:** Accepted
- **Decision:** The weekly Trivy triage comment on the public `health-report` issue may name a CVE added to or pruned from the base-image watch list, and may report escalations **only as a count**. It may never carry an escalated CVE's identity, the reachability reasoning or call sites checked, the affected code path, or the fact that a reachable CVE is currently unfixed and unmitigated — because an escalation means all of that by construction, and the reachability conclusion (not the CVE identity) is the part that is public nowhere else. The exploitability analysis stays on the private watch/escalation bead, which makes **`.beads/**` being gitignored load-bearing for security disclosure**. The repo has no `SECURITY.md`, so this is the project's de facto outbound disclosure posture. Also names the previously-unnamed maintainer concept: an **accepted security risk, recorded on a rolling watch bead**. Not a [DEC-004](decisions/dec-004-privacy-first-public-access.md) matter — that decision's scope is anonymous attendee access and attendee data.
- **Consult when:** Posting anything to the public health-report issue, or widening what the weekly triage publishes; changing whether `.beads/` is tracked in git, or otherwise relocating where exploitability analysis is stored; authoring a `SECURITY.md` or any vulnerability-disclosure policy; handling a reachable finding that has no upstream fix and no mitigation; deciding what may be said publicly about a vulnerability in Pavillion's image or dependency tree; changing `triage-health` step 7 or the watch-bead escalation rules in step 4.

### DEC-017: Operational Telemetry Exposure
- **File:** [decisions/dec-017-operational-telemetry-exposure.md](decisions/dec-017-operational-telemetry-exposure.md)
- **Date:** 2026-08-31 · **Status:** Accepted
- **Decision:** Operational telemetry is served as tool-neutral OpenMetrics on a **second HTTP listener whose port compose never publishes**, so private-by-default is a property of the endpoint rather than of a proxy rule or network topology — the proxy/internal-network framing was rejected because `docker-compose.yml` has no `networks:` key, `app` publishes `${APP_PORT:-3000}:3000` on the host, and bundled Caddy is an opt-in profile. The public `/health` on the main listener stays liveness-only. No monitoring stack is bundled or mandated: the endpoint is the contract, the scraper is the operator's choice. **Series describe the instance's operation, never its audience** — no calendar-, event-, or visitor-derived series or labels, ever, a rule that binds future request-level metrics rather than being re-opened by them; no label value is per-entity or free-form, and every housekeeping-sourced value is read through `HousekeepingInterface` ([DEC-003](decisions/dec-003-domain-driven-architecture.md)) — with the media volume named as the one justified exception (a direct read of Media's storage configuration plus a `statfs` of the local path, where the configured driver decides whether the series exists at all) — while snapshot-derived series export their own write timestamp per [DEC-015](decisions/dec-015-activity-log-routing-keys.md)'s staleness lens. All series carry the `pavillion_` prefix and documented names are a stable operator contract (renames need a deprecation note); a metric with no data is an absent series, never a zero. Family membership follows **what a series measures, not which process measured it** — `pavillion_disk_*` is filesystem usage keyed by a filesystem label and every monitored filesystem belongs to it, leaving `pavillion_media_*` for non-filesystem media quantities and `pavillion_backup_*` for backups-as-events. This is an operational-disclosure boundary in the [DEC-016](decisions/dec-016-health-report-disclosure-boundary.md) family, **not a [DEC-004](decisions/dec-004-privacy-first-public-access.md) matter**. The exposition is **hand-rolled while every series is a gauge**; the first counter or histogram brings in `prom-client` on a dedicated registry, with the renderer kept as the single declaration site — no histogram or counter is ever written by hand, and default process/runtime metrics are not enabled without amending the family list.
- **Consult when:** Adding, renaming, or removing a metric series, label, or help string; deciding which `pavillion_*` family a new series belongs to; adding any new HTTP listener to the server, or changing where one binds; publishing a port or adding a `networks:` key in docker-compose.yml; changing what `/health` returns or who may read it; proposing to bundle, vendor, or mandate a monitoring/scraping tool; designing any alerting, dashboard, or request-level-metrics feature; deciding whether a value may appear in telemetry at all; classifying a disclosure question as operational vs attendee-privacy; adding a counter, histogram, or summary series; adding `prom-client`, an OpenTelemetry SDK, or any other metrics client library; enabling default process or runtime metrics; changing how the exposition document is rendered or validated.

---

## Conventions for adding new decisions

1. Pick the next sequential ID. Create a file at `decisions/dec-NNN-short-slug.md`. Use any existing file as the template — required sections are `## Decision`, `## Context`, `## Alternatives Considered`, `## Rationale`, `## Consequences`.
2. Add an index entry under the relevant topical group above. If no group fits, create a new one. Include the **Consult when** trigger list — that is what makes the index useful.
3. Bump the index `Last Updated` date.
4. If superseding an earlier decision, update the earlier file's `Status:` header and append a supersession note (at the end of Consequences, or as a separate section) with a forward link. Update the earlier decision's index entry to flag the supersession.
5. Cross-reference related decisions inline using relative links: `[DEC-NNN](dec-NNN-slug.md)` from within `decisions/`, or `[DEC-NNN](decisions/dec-NNN-slug.md)` from this index.
6. Keep accepted decisions in current state. When later work changes what a decision describes without overturning it, edit the file in place rather than appending an amendment or change-log section — git is the history. Reserve supersession (step 4) for decisions that are actually retired or reversed; do not delete a superseded file.
