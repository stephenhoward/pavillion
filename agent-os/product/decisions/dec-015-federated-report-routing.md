# DEC-015: A Federated Report Reaches the Origin Calendar Owner First

> Date: 2026-08-08
> Status: Accepted
> Category: Technical
> Stakeholders: Tech Lead

## Decision

A moderation report that crosses a federation boundary is addressed to the **origin calendar's actor**, never to the origin instance's admin. This holds in both directions and is the same rule on each side:

- **Inbound.** `ModerationService.receiveRemoteReport` (`service/moderation.ts`) looks the reported event up and scopes the new report to `event.calendarId` — the calendar that owns the event — independent of which inbox received the `Flag`. The report enters the origin calendar owner's queue at tier 1 with `reporterType: 'federation'`. A `calendarId` supplied by the caller is ignored; server-side resolution is authoritative.
- **Outbound.** The forwarding route resolves its `Flag` recipient with `getEventSourceActorUri(report.eventId)` — the origin calendar's actor URI, read from the stored remote event. It does not construct an instance-level URI. If the helper cannot resolve a target, the forward is refused with a 400 rather than sent somewhere approximate.

The origin instance's **admin** sees a federated report only through the ordinary escalation path, not because the report was addressed to them.

**This is safe only because owner dismissal auto-escalates.** `dismissReport` does not set `DISMISSED`. It sets `status: ESCALATED, escalation_type: 'automatic'`, records an escalation row with `decision: 'dismissed'`, and the report becomes visible to the admin queue — `getAdminReports` bases its query on *escalated OR admin-initiated*. An owner therefore controls **when** their admin sees a report, never **whether**. Owner-first routing and auto-escalation are one mechanism, not two independent behaviors that happen to coexist.

The names in the code do not describe this behavior and are not being changed: the route is `POST /api/v1/admin/reports/:reportId/forward-to-admin`, the persisted escalation carries `decision: 'forwarded_to_remote_admin'`, and the UI key is `forward_to_admin`. Only user-visible copy names the calendar owner.

## Context

The rule was decided implicitly, twice, on opposite sides of the boundary, and written down nowhere.

The receive side chose it first: `receiveRemoteReport` has always scoped to `event.calendarId`. The send side did not know it had a choice — the forward route built its recipient by parsing the event's source hostname into `https://{host}/admin`. No Pavillion instance serves an actor there; actor documents exist only at `/calendars/:urlname` and `/users/:username`. `OutboxService.resolveInboxUrl` treats a full-URL recipient as an actor profile, GETs it, and reads `.inbox` — against `/admin` that request lands on the SPA, `.inbox` is `undefined`, and delivery never happens. Every forwarded report was a silent no-op on the wire (pv-o3ay.8).

Fixing that required naming the intended recipient, which surfaced the question the receive side had already answered. Three advisory reviews on 2026-08-08 independently flagged that the answer was asserted across four beads (pv-o3ay.8, pv-o3ay.4, pv-rctv, pv-nedp) and held nowhere durable. [DEC-014](dec-014-create-original-announce-repost.md) exists because of exactly this failure mode — its own Context records a load-bearing federation rule whose rationale "lived only in a bead note and in code comments."

Two further pressures make a bead note insufficient here:

1. There is a **stated revisit condition**. `pv-rctv` will add a real instance-level ActivityPub actor with its own key pair, actor document, and inbox. Without this file, the natural reading of that bead is "we targeted the calendar because no admin actor existed — now that one does, retarget." That reading is wrong: the recipient choice is a policy about who moderates first, not a workaround for a missing actor. `pv-rctv` is about the **sender** identity.
2. The routing has a **product commitment behind it**. `docs/guides/instance-administrators/federation-incidents.md` tells admins that the order of operations is investigate → talk to the calendar owner → decide → act, and names skipping the owner conversation as the single most common admin mistake. Routing a federated report to the admin first would have the software contradict the guide.

## Alternatives Considered

1. **Address the origin instance's admin (the pre-fix intent)**
   - Approach: forward the `Flag` to an instance-level admin actor; on receive, file the report into the admin queue rather than the owning calendar's.
   - Pros: matches the endpoint name and the persisted enum; gives the receiving admin cross-calendar report volume as a first-class signal; a single well-known recipient per instance simplifies addressing.
   - Cons: no such actor exists — this is why the outbound path was inert. More importantly it inverts the escalation ladder: a report from off-instance would skip the tier the guide tells admins never to skip, putting the admin in the position of adjudicating content whose owner has not yet been asked about it. It also makes the origin admin the first responder for every remote grievance, which is the workload the tiered model exists to avoid.

2. **A shared instance moderation inbox**
   - Approach: a single instance-wide inbox receives all federated `Flag` activities; a router fans them out to owning calendars, or holds them for triage.
   - Pros: one federation-facing endpoint to document and to rate-limit; natural place to hang instance-wide policy (per-host report throttling, blocklists) later.
   - Cons: a second inbox model beside the per-calendar one contradicts [DEC-013](dec-013-inbox-authenticated-activity-log.md)'s single ingest-and-dispatch pipeline, and duplicates addressing and delivery machinery for one activity type. The fan-out step reproduces `receiveRemoteReport`'s calendar resolution while adding a queue that can silently stall. It buys instance-level policy hooks we have no requirement for and defers the routing question rather than answering it.

3. **Address the origin calendar's actor; owner first, admin by escalation** (Selected)
   - Approach: as described above — send side resolves `getEventSourceActorUri`, receive side scopes to `event.calendarId`, `dismissReport` auto-escalates.
   - Pros: both sides of the boundary implement one rule; the recipient always exists, because the event's own actor is what made the event federate in the first place; the federated report enters the same tier-1 queue as a local one, so owners see a uniform surface and downstream escalation, notification, and pattern-detection code needs no federation-specific branch; encodes the documented admin practice in the routing itself.
   - Cons: the origin admin has no first-class view of cross-instance report volume against a calendar (see Consequences); the endpoint and persisted enum now contradict the behavior; correctness depends on an auto-escalation property in a different method from the one that does the routing.

## Rationale

A federated report is a report about a specific event, and every event has an owner. Routing to that owner is not a concession to a missing instance actor — it is the only routing that preserves the tiered moderation model across the boundary. Local reports go to the calendar owner first and reach the admin by escalation; a report that happens to originate on another instance is not a different kind of report and should not enter at a different tier. Preserving the tier is what lets everything downstream of the queue — escalation records, notifications, pattern detection — stay federation-agnostic.

The tier is only meaningful if it cannot be used to bury a report, which is what `dismissReport`'s auto-escalation guarantees. The case that makes this load-bearing is the owner who is themselves the subject of the report: they receive it first, and under a conventional dismissal they would be the only party who ever saw it. Auto-escalation converts "the owner decides" into "the owner responds first, and the admin sees the response," which is the property the routing actually depends on. It is stated here rather than left in `dismissReport` because the pressure to change it will not arrive as a moderation-routing change — it will arrive as an ergonomics request ("let owners clear obvious spam without bothering the admin"), and nothing in the routing code will fail when it lands.

Keeping the "admin" names is a cost accepted deliberately. Renaming the persisted `decision` value requires a data migration and would orphan existing escalation rows; renaming the route is a breaking API change. Neither buys behavior. This file is the compensating control for names that lie, which is why the `Consult when` list is keyed on the misleading identifiers rather than on a concept — someone reading `forwarded_to_remote_admin` needs to land here.

## Consequences

**Positive:**

- One rule governs both directions; the send side no longer needs to know anything about the receiver's internal structure beyond the actor URI the event already advertises.
- The recipient is guaranteed to exist. `getEventSourceActorUri` resolves from the stored remote event, so a forward either targets a real actor or is refused with a 400 — there is no path back to silent non-delivery against a URI nobody serves.
- A federated report is an ordinary tier-1 report. Escalation, notification, and pattern detection required no federation-specific branch; `reporterType: 'federation'` is a provenance label, not a routing input.
- The software now enforces the order of operations that `federation-incidents.md` asks admins to follow by hand.

**Negative / limitations recorded with this decision:**

1. **Auto-escalation is load-bearing and is enforced nowhere near the routing.** `dismissReport` turning an owner dismissal into `status: ESCALATED, escalation_type: 'automatic'` is the only thing that stops an owner who is the subject of a remote report from deciding whether their admin ever learns of it. No test at the routing site fails if that behavior is relaxed. Any change to `dismissReport`, to `ReportStatus.DISMISSED` semantics, or to the `getAdminReports` base condition (`escalated OR admin-initiated`) is a change to cross-instance moderation and must be evaluated as one.
2. **The endpoint, the persisted enum, and the UI key all say "admin" and mean "calendar owner."** `POST /api/v1/admin/reports/:reportId/forward-to-admin`, `decision: 'forwarded_to_remote_admin'`, and the `forward_to_admin` translation key survive unchanged; `decision` values render raw and untranslated in the escalation timeline, so the timeline shows `forwarded_to_remote_admin` beside notes text naming a calendar. Migrating the enum is tracked separately and is a data-migration decision, not a naming cleanup.
3. **Cross-instance report volume against a calendar is not a first-class admin signal.** The origin admin sees federated reports only via the escalation branch of `getAdminReports`. Five remote instances reporting the same calendar, each handled promptly by its owner, produce no aggregate admin-visible signal. A future instance-health view would need to query on `reporterType: 'federation'` directly rather than relying on the escalation queue.
4. **Admin-initiated and owner-initiated forwards are indistinguishable to the receiver in v1.** Both arrive as a `Flag` from a calendar actor — the forwarding admin's primary calendar acts as courier, so the activity `actor` matches the HTTP-Signature `keyId` (pv-o3ay.7). The receiver cannot tell "an admin escalated this to you" from "an owner passed this along," and cannot weight the two differently. `pv-rctv` (instance-level admin actor) is the fix for the sender identity; it does **not** change the recipient, which is this decision.
5. **A volunteer calendar owner, not an instance admin, is now the party who learns something about a remote reporter — so host-only anonymization is what keeps this within [DEC-004](dec-004-privacy-first-public-access.md).** The wire payload from `FlagActivityBuilder` carries `actor`, `object`, `content`, a category hashtag, `summary`, and `published` — no reporter IP, no email hash, no account id. `forwardedFromInstance` stores a hostname only, and `anonymizeFlagActor` reduces the reporter to `https://<host>` with `actor_kind: 'anonymous'` and null identity fields before any notification is written. What the owner may learn about a remote reporter is *which instance* reported, never *who*. Widening that — passing a reporter handle, display name, or actor URI through to the owner-facing surface — is a DEC-004 question, not a UX one.

**Revisit when:** an instance-level admin actor exists (`pv-rctv`) **and** there is a demonstrated need for the origin admin to be first responder for off-instance reports. The first condition alone is not a trigger — it changes who signs, not who receives.
