# DEC-013: Inbox is the Authenticated-Activity Log

> Date: 2026-05-16
> Status: Accepted
> Category: Technical
> Stakeholders: Tech Lead

## Decision

Every row in `ap_inbox` is authenticated by a recorded mechanism, captured in a new `auth_source` column. Authentication runs at the ingest boundary, before persistence. Known initial values are `'http_signature'` (live signed POST, verified by `activitypub-express` middleware) and `'outbox_pull'` (backfill worker, gated by SSRF checks, rate limits, and per-activity trust gates). The column is an open string enum enforced at the application layer; future ingest paths add new values without schema changes.

A companion `auth_origin` column (nullable) records the remote server the activity was authenticated against — verified HTTP Signature `keyId` origin for `'http_signature'` rows, outbox URL for `'outbox_pull'` rows. `auth_origin` is an audit/debug trail.

**`auth_source` is a diagnostic field, not access control.** No code path branches on its value to decide whether to dispatch, trust, or surface a row. It records the *first* authentication mechanism that produced the persisted row; on a race between two mechanisms authenticating the same activity URI, the existing primary-key conflict picks a winner and the loser's mechanism is not recorded. Downstream handlers continue to gate on per-activity-type trust checks (actor-origin match, attributedTo match, Undo cross-check, etc.) — those gates do not consult `auth_source`.

Both columns live on the `ActivityPubInboxMessageEntity` subclass only. `ap_outbox` is unaffected: outbox rows are locally produced and carry no ingest-trust semantic.

## Context

`ap_inbox` was originally treated as "the place signed POSTs land." The invariant that every row was authenticated existed only implicitly — HTTP Signature middleware happened to run before the row was written, so authentication came along for free. PR #310 (`feat/follow-backfill-remote-calendars`) introduced follow-backfill: a freshly-followed remote calendar previously appeared empty until the source published a new event, so the PR pulled the source's outbox and **synthesized** in-memory inbox messages that bypassed persistence to call `processInboxMessage` directly. The architecture-advisor flagged the synthetic-dispatch pattern as a violation of the inbox's role and recommended a redesign.

Two reframings drive this decision:

1. The inbox is the authenticated-activity log. HTTP Signature is one authentication mechanism; outbox pull (with the worker's trust gates) is another. Future ingest paths — ICS pull, hosted-provider OAuth, Facebook import — plug in as additional mechanisms. The invariant the table enforces is "authenticated by *some* recorded mechanism," not "arrived via signed POST."
2. ActivityPub §5.1 mandates `OrderedCollection` for outboxes but does not define ordering semantics; reverse-chronological is Mastodon convention only. Persisting backfilled rows with `message_time = activity.published` lets the existing `processInboxMessages` `ASC` sweep dispatch them correctly regardless of source emit order. This is load-bearing: the strict Undo cross-check requires the referenced Announce row to exist before the Undo is dispatched, which only chronological dispatch guarantees.

## Alternatives Considered

1. **Shape A — Synthetic dispatch (PR #310 as-shipped)**
   - Approach: backfill builds in-memory `ActivityPubInboxMessageEntity` instances (`.build()` with a `.update` monkey-patch to bypass persistence) and calls `processInboxMessage` directly. No `ap_inbox` rows are written.
   - Pros: No schema change; reuses the existing dispatch pipeline; quick to ship.
   - Cons: Breaks the inbox's role as the authenticated-activity log — backfilled activities never appear in the table. Dispatch ordering depends on outbox emit order; reverse-chronological emitters dispatch Undos before their target Announces, defeating the strict cross-check. Idempotency relies entirely on downstream unique constraints; a re-run re-processes every activity. Excludes Update and Undo entirely because they cannot be safely dispatched out of order. Hidden coupling between backfill and the dispatch implementation (the monkey-patch is fragile to refactors).

2. **Shape C — Extracted dispatcher, no persistence**
   - Approach: factor `processInboxMessage` into a pure dispatcher that takes a parsed activity and a calendar, independent of the entity. Backfill calls the dispatcher directly with activities pulled from the outbox; no `ap_inbox` rows are written. Live HTTP path also wraps the dispatcher.
   - Pros: Removes the synthetic-entity hack; cleaner separation between persistence and dispatch logic.
   - Cons: Same fundamental problem as Shape A — backfilled activities are not durably recorded, so re-runs cannot detect already-processed activities without a second tracking table. Dispatch ordering still depends on caller-supplied order, so Update/Undo support requires the caller to buffer and sort, duplicating logic the existing `message_time ASC` sweep already performs. The inbox table loses its meaning as the log of everything authenticated, splitting "what arrived via signed POST" from "what we pulled from an outbox" into two storage models for no semantic gain.

3. **Shape B — Real `ap_inbox` rows with `auth_source` (Selected)**
   - Approach: backfill writes real `ap_inbox` rows tagged `auth_source='outbox_pull'`, `message_time = activity.published` (clamped), via `findOrCreate`. After all pages are persisted, backfill calls the existing `processInboxMessages` sweep once; the sweep dispatches pending rows in `message_time ASC` order.
   - Pros: Inbox table's invariant becomes explicit and verifiable; backfilled and live-POST activities share one storage model and one dispatch pipeline; chronological dispatch is guaranteed by the existing sweep, enabling Update/Undo support; idempotency is `findOrCreate` on the existing PK; race resolution is first-writer-wins via the same PK; future ingest paths slot in by adding a new `auth_source` value.
   - Cons: Schema migration required (two new columns); user-perceptible feed latency is pagination + drain rather than per-page dispatch (acceptable for correctness; per-page drain breaks the chronological-dispatch invariant the strict Undo cross-check depends on).

Shape B was chosen because it makes the table's authentication invariant explicit, unifies backfill and live ingest on one storage and dispatch model, and is the only option whose dispatch ordering guarantee is strong enough to safely support Update and Undo during backfill.

## Rationale

Treating `ap_inbox` as the authenticated-activity log — rather than as the signed-POST landing zone — is the conceptual change that everything else falls out of. Once that frame is adopted, the schema change is mechanical (record the mechanism), backfill stops needing a special dispatch path (it just writes rows), Update and Undo support stops being a per-caller correctness problem (the existing `ASC` sweep handles ordering), and future ingest paths slot in by extending an open enum rather than re-architecting the dispatch pipeline.

The choice to make `auth_source` diagnostic rather than access-controlling is deliberate. Access control already lives in the per-activity-type trust gates that run before `findOrCreate` (actor-origin match, attributedTo match, Undo cross-check). Layering a second policy surface keyed on `auth_source` would duplicate that logic, create drift risk between the two surfaces, and tempt callers to write "trust this row because `auth_source='http_signature'`" — which is exactly the implicit invariant the redesign is trying to make explicit.

## Consequences

**Positive:**
- The inbox table's invariant ("every row was authenticated by a recorded mechanism") is explicit, schema-enforced via `NOT NULL DEFAULT 'http_signature'`, and verifiable.
- Backfill and live HTTP ingest share one storage model and one dispatch pipeline; `processInboxMessages` does not need to know how a row arrived.
- Chronological dispatch via `message_time ASC` enables Update and Undo support during backfill without per-caller ordering logic.
- Idempotency and race resolution are handled by the existing primary-key constraint; re-running backfill is safe by construction.
- Future ingest paths (ICS pull, hosted-provider OAuth, Facebook import) add a new `auth_source` value and a new worker; no changes to dispatch or trust-gate infrastructure.
- `auth_origin` provides an audit/debug trail for federation-correctness investigations without becoming a policy surface.

**Negative:**
- The synthetic-dispatch pattern on PR #310 `feat/follow-backfill-remote-calendars` is intentionally superseded by this decision. That branch is parked; the new work lands on `feat/inbox-auth-source-and-backfill` and PR #310 will be closed without merging once the new PR ships, branch preserved on `origin` for reference.
- User-perceptible feed latency for follow-backfill is pagination time plus a single end-of-pagination drain, not per-page dispatch. At the 60 req/min per-host rate limit, a 50-page outbox takes ~50 seconds minimum before the user sees any backfilled history. Per-page drain is not an option — it would dispatch Undos before their target Announces on reverse-chronological outboxes, breaking the strict cross-check.
- Schema migration adds two columns to `ap_inbox`. PostgreSQL ≥11 makes `ADD COLUMN ... DEFAULT` a metadata-only operation; older versions backfill synchronously. Production version must be verified before deploying.
- `auth_source` is an open string enum, not a closed union. Application-layer code must treat unknown values as opaque diagnostic data rather than branching on them.
