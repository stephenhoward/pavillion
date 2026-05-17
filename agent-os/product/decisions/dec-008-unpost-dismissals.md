# DEC-008: Sticky Per-Calendar Unpost Dismissals

> Date: 2026-04-11
> Status: Accepted
> Category: Technical
> Stakeholders: Tech Lead, Development Team
> Related Spec: @docs/superpowers/specs/2026-04-11-unpost-reposted-events-design.md

## Decision

When a calendar owner unposts a reposted event, the system writes a sticky `RepostDismissalEntity` row scoped to `(event_id, calendar_id)`. The inbox auto-repost handler checks this row before creating a new `SharedEventEntity`, skipping silently if present. Dismissals are strictly per-calendar: a dismissal on Calendar A never suppresses auto-reposts on Calendar B, even within the same instance. Dismissals only gate re-share creation — `Update(Event)` activities continue to flow through the inbox unmodified so the underlying `EventEntity` stays in sync for every calendar still sharing it.

## Context

Before this decision, unposting a reposted event was fragile: if the source calendar re-broadcast or edited the event, the auto-repost handler would silently re-share it on the same calendar. Calendar owners had no durable way to say "no, not this one." The previous `unshareEvent` path destroyed the `SharedEventEntity` row but left no record of the owner's intent, so the next inbound `Announce` recreated it. This undermined the community-control principle ([DEC-001](dec-001-initial-product-planning.md)): followers had policy control over *future* follows but not over *this specific event I already said no to*.

## Alternatives Considered

1. **Block Update activities entirely for dismissed events**
   - Pros: Dismissed events would stop updating on the calendar list, reinforcing the "it's gone" feeling.
   - Cons: Breaks federation sync for every *other* calendar still sharing the event — a single dismissal would stale the event across the instance. Violates federation-first principles.

2. **Global (per-instance) dismissals across all calendars an account owns**
   - Pros: Simpler mental model for owners managing multiple calendars.
   - Cons: Violates the community-control principle that each calendar owner speaks only for their own calendar. Multi-editor calendars would get a confusing blast radius.

3. **Per-calendar sticky dismissal with Update sync preserved** (Selected)
   - Pros: Respects community control, preserves federation sync for other reposters, survives source re-broadcast.
   - Cons: Dismissal rows accumulate over time (mitigated by `ON DELETE CASCADE` on event deletion); no audit/undo UI yet (data preserved, surface can be added later).

## Rationale

Per-calendar scoping is the only option that keeps DEC-001's community-control promise intact while also preserving federation-first semantics. Every calendar speaks for itself; no calendar's dismissal leaks into another calendar's policy surface. The explicit choice to leave `Update` processing unblocked is a federation-correctness invariant: `EventEntity` is a globally-shared fact, and every calendar currently sharing the event must see edits, regardless of which calendars have opted out of auto-reposting it.

## Consequences

**Positive:**
- Respects DEC-001 community-control principle: each calendar owner controls only their own calendar
- Preserves federation sync: Update activities continue flowing to all other calendars that still share the event
- Survives source re-broadcast: the dismissal is durable, not a one-time destructive delete
- No new API surface: the existing `DELETE /api/v1/social/shares/:eventId` endpoint handles the dismissal write transparently
- User-facing concept ("unpost") cleanly hides the implementation vocabulary ("dismissal")

**Negative:**
- `ap_repost_dismissal` rows accumulate over time, bounded by event lifetime via `ON DELETE CASCADE`
- No UI yet to audit or undo dismissals — deferred to a future bead; data is preserved so the surface can be added later
