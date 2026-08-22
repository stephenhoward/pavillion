# DEC-015: Routing Keys and Display Snapshots on Activity-Log Rows

> Date: 2026-08-09
> Status: Accepted
> Category: Technical
> Stakeholders: Tech Lead

## Decision

`notification_activity` rows carry denormalized columns of **two classes with opposite staleness contracts**, and the two must never be conflated:

- **Display snapshots** — `object_label`, `actor_display_name`, `actor_display_url`. These are frozen at write time and their staleness is a **feature**: it is what keeps a row renderable after the underlying object is deleted or renamed. A snapshot is never re-resolved and never routes anything.
- **Routing keys** — `object_calendar_id`. These are read at render time to build a live destination, so staleness is a **defect**: a wrong value routes a calendar owner to *another calendar's* reports tab.

Three rules follow.

**1. A routing key may only be denormalized onto a log row if its source is write-once.** `object_calendar_id` copies `ReportEntity.calendar_id`, and the copy is safe only because that column is written once at report creation and never reassigned — invariant 6 of the notification-target derivation. Enforcement today is a behavioural test on the read path plus a scoped structural tripwire (`src/server/notifications/test/integration/read-path-targets.test.ts`) that parses `moderation/service/moderation.ts` and fails if any `ReportEntity` write path ever includes `calendar_id`. The tripwire is a **stopgap, not the invariant's proper home**: it exists because a reassignment path cannot be behaviourally tested before it is written, and it reaches across a domain boundary to read another domain's source. If report reassignment is ever added, the correct response is a write-through to `object_calendar_id` (and a real behavioural test), never a relaxed assertion. The write-once obligation is documented on `ReportEntity.calendar_id` itself so the domain that must honour it can see it.

**2. Neither class of column may become a policy surface.** This is the [DEC-013](dec-013-inbox-authenticated-activity-log.md) rule for `auth_source`, transferred unchanged. Authorization comes from live state — for the notification read path, a single per-call `loadAccountRoles` read threaded in as `ctx.isAdmin`. `object_calendar_id` supplies a url name for a link and nothing else; "this row has a calendar id, therefore the viewer owns that calendar" is never a valid inference. The rule forbids *answering an authorization question from a stored copy*; it is not a prohibition on reading stored data for ordinary correctness.

**3. The emitted target is an affordance, never a trust boundary.** Every destination a routing key can produce enforces its own authorization server-side (`userCanReviewReports` on the owner reports tab; `account.hasRole('admin')` in every admin report handler). A mis-routed link is a usability defect, not an access-control one — which is why rule 2 can hold without a membership check on the read path.

## Context

Epic pv-mvfk made inbox notification rows navigable. Its read path needed the calendar that owns a reported event, so a non-admin recipient could be linked to their own calendar's reports tab rather than the admin moderation surface. The epic's original non-goals forbade any schema change to `notification_activity`. That non-goal was retracted mid-epic and one nullable column (`object_calendar_id`, migration `0040`) was added at emit time from a bus payload field the handlers already read.

The rulings that came out of that retraction — the two-classes-of-denormalization distinction, the source-immutability precondition, and the DEC-013-derived constraint — lived only in bead notes and docstrings. Bead notes stop being read when the bead closes. DEC-013's own "diagnostic, never a policy surface" rule survived a year and three additional ingest paths precisely because it lived in a decision file; this decision gives these rulings the same durability.

The Wave 2 architecture audit also found that the epic's record cited DEC-013 too broadly. That correction is recorded in the Rationale below rather than being left to a reader who finds only the strong form.

## Alternatives Considered

1. **Resolve the owning calendar at read time via a cross-domain lookup (the pre-retraction shape)**
   - Approach: no schema change. On each inbox read, the notifications domain asks moderation for each report row's calendar id, then resolves url names.
   - Pros: no migration; no new invariant obligation; every read sees current data, so a hypothetical reassignment path would need no write-through; no pre-migration NULL cohort.
   - Cons: a per-row cross-domain lookup on a read path whose entire design is a fixed two extra queries per page at any page size (50 default, 100 max). It also re-fetches at read a fact the write path was already handed on the bus — `handleReportFlagged` reads `payload.calendarId` and then discards it purely because the schema gave it nowhere to live.

2. **Reuse `object_label` / add no dedicated column, deriving the destination from the label snapshot**
   - Approach: infer routing from the display snapshot already on the row.
   - Cons: collapses the two staleness contracts into one column, which is the exact error this decision exists to prevent. A renamed or deleted calendar would either break the link or break the render; the two requirements are in direct opposition.

3. **Add `object_calendar_id` as a routing key, populated at emit time (Selected)**
   - Approach: one nullable column on `notification_activity`, written from the bus payload the handlers already hold, read only to build a link. No backfill.
   - Pros: read-path cost stays bounded and batched; no cross-domain call added to the read path; the write path stops discarding a value it was given.
   - Cons: a migration; a new invariant obligation (source write-once) that previously needed to hold nowhere; and a pre-migration NULL cohort, since rows written before `0040` have no value to route with.

## Rationale

**The argument that carries the schema change is event-carried state transfer, not DEC-013.** Moderation already hands the owning calendar id to notifications on the bus for all three report verbs; `handleReportFlagged` reads it at line 494 and the other two handlers read it for label resolution. Notifications was therefore re-fetching at read a fact it had already been given at write, and had discarded only because the schema offered no place to keep it. Persisting a value the write path holds is the ordinary shape of event-carried state transfer between domains under [DEC-003](dec-003-domain-driven-architecture.md), and it is what keeps the read path free of a moderation dependency.

**DEC-013 supports rule 2 fully and the schema change only mildly.** Rule 2 is DEC-013's constraint transferred without modification: a persisted column that records something about a row must not become a second surface for a decision that live state already governs. That transfer is exact.

The epic's record additionally cited DEC-013 as precedent for the schema change itself — Shapes A and C avoided a migration via special-purpose paths, Shape B paid one to keep a single storage model and a single pipeline. Three disanalogies weaken that reading, and the precedent should be cited with them attached:

- DEC-013's migration made an **existing implicit invariant** ("every inbox row was authenticated") explicit and verifiable. This one **creates a new invariant obligation** (source write-once) that previously needed to hold nowhere. Making a true thing checkable and taking on a new thing to keep true are not the same move.
- `auth_source` records **what the owning domain did at its own boundary**. `object_calendar_id` **copies a fact another domain determined**, which is what introduces the staleness question at all.
- DEC-013's rejected shapes **lost correctness** — out-of-order dispatch, no idempotency, Update/Undo unsupportable. The alternative rejected here loses **a query and a constructor argument**. The stakes are not comparable, and neither is the strength of the precedent.

**Rule 1's enforcement is deliberately imperfect and labelled as such.** A structural test that parses another domain's source is worth having when no behavioural test can exist yet, but it must be scoped to the exact call shape it claims to guard — an earlier unscoped version matched `createHmac(...).update(...)` and produced a false red. It is recorded here as a stopgap so a future reader treats a failure as a signal to add a write-through, not as a test to loosen.

## Consequences

**Positive:**
- The distinction between a frozen display snapshot and a live routing key is written down once, in a place that outlives the beads that discovered it. A future denormalized column on any log row can be classified before it is added.
- The precondition for adding one — a write-once source — is explicit, so the question "may I copy this here?" has an answer that is not a judgement call.
- The DEC-013 policy-surface rule now covers two log tables under one stated principle rather than by analogy in a docstring.
- The read path stays bounded: two extra queries per inbox page at any page size, and no moderation dependency in the notifications read path.

**Negative:**
- **A type-level moderation edge already existed** in notifications before this epic — `src/server/notifications/events/index.ts:15` has imported `@/server/moderation/events/types` since 2026-05-24. Characterising the rejected alternative as introducing a "new permanent cross-domain edge" overstated its cost; what it would actually have added is a *runtime* per-row dependency on a read path, which is a real but smaller objection. Cite the alternative's cost accurately.
- **The no-backfill choice created a pre-migration NULL cohort.** Report notifications recorded before migration `0040` carry no routing key and render as plain text — indistinguishable, to a user or an acceptance tester, from the defect the epic set out to fix. Success criterion 1 of pv-mvfk was consequently rescoped to activities recorded after `0040` is deployed. The window is bounded by the 90-day retention pass, but this is a cost the rejected read-time-resolution alternative would not have incurred.
- `object_calendar_id` NULL now carries three distinct meanings — not applicable to this verb, no owning calendar (an admin report against a remote event), or a pre-`0040` row — and none is an error. All three degrade to `target: null`, so a client cannot distinguish "not navigable for this verb" from "not resolvable for you". That uniformity is grounded in the privacy-playbook's `error-responses` standard and ordinary IDOR hygiene — **not** in [DEC-004](dec-004-privacy-first-public-access.md), which an earlier revision of this file cited here. DEC-004 governs anonymous *attendee* access to public event information and explicitly places organizers, curators and instance admins outside its guarantee; every surface a routing key can reach is an authenticated organizer/admin surface, so DEC-004 has no jurisdiction over it. The mis-citation is recorded rather than silently deleted because it is the same over-broad-citation failure this file's Rationale corrects for DEC-013, and the discipline has to apply symmetrically.
- A **display snapshot rendered as the anchor text of a live routing key** may name a resource that no longer exists. `object_label` is frozen at write time and `deriveTarget` builds an `event` target from `object_id` with no existence check, so a deleted event's row still renders a link — to nothing. This is a usability cost accepted under rule 3 (a mis-routed or dead link is not an access-control defect), and the fix is **never** a per-row existence check: that is precisely the per-row cross-domain traffic the bounded read path exists to avoid, for the same reason the owner-membership lookup was rejected. Before Wave 3 the snapshot's stated benefit — keeping a row renderable after its object is deleted — was fully realised; now the row renders but its affordance is dead. Recorded so a future reader meeting a dead link knows it was foreseen.
- The structural tripwire couples a notifications test to the text of `moderation/service/moderation.ts`. Refactoring that file can break the test without any behaviour changing.
