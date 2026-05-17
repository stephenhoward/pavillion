# DEC-009: ICS Import Funding-Gate Posture

> Date: 2026-04-22
> Status: Partially superseded by [DEC-011](dec-011-federated-value-boundary.md) (2026-05-16)
> Category: Product
> Stakeholders: Product Owner, Tech Lead
> Related Spec: @pv-1qcp (bead)

## Decision

ICS basic import (v1) is free and ungated onboarding infrastructure. Advanced ICS sync capabilities — background polling, mirror mode with ongoing source precedence, and hosted-provider OAuth (Google Calendar, Outlook/M365, iCloud) — will ship as funding-gated features in later phases. This diverges from the roadmap Phase 2 Facebook import posture (explicitly funding-gated) because Facebook import serves ongoing community aggregation while ICS import serves one-time migration from a user's existing self-hosted calendar.

## Context

Roadmap Phase 2 gates Facebook event import behind funding plan subscription (per [DEC-007](dec-007-community-funding-model.md) community funding model), and the same question arises for ICS import: should a calendar owner pay to migrate events in from their existing Nextcloud, Gancio, or WordPress Events Calendar? The ICS import epic (pv-1qcp) is the foundation for that migration path, using DNS TXT verification to prove source ownership and user-initiated "Sync now" pulls with no background polling in v1.

[DEC-001](dec-001-initial-product-planning.md) establishes the economic-gardening mission: Pavillion exists to lower barriers to community infrastructure, not extract rent at every touchpoint. [DEC-007](dec-007-community-funding-model.md) establishes that funding plans fund ongoing operational value (hosting, maintenance, community development) via voluntary community contribution rather than gatekeeping access. Gating migration itself — the moment when a user is actively choosing to move their community infrastructure onto Pavillion — would contradict both principles: it charges at the point of highest friction, before the user has received any value from the platform, and it punishes the exact migration path Pavillion wants to encourage.

## Alternatives Considered

1. **Gate all ICS import behind funding plan (mirror Facebook import posture)**
   - Pros: Consistent rule across all import paths; clear revenue signal at adoption time
   - Cons: Creates chicken-and-egg migration barrier (user must fund before they can evaluate migration); contradicts economic-gardening mission (DEC-001) by charging at the friction point; conflates one-time migration with ongoing aggregation

2. **Gate after the Nth source or Nth import run**
   - Pros: Free entry path; funding signal tied to heavy usage
   - Cons: Arbitrary threshold is hard to defend to users; implementation complexity (counting, resets, edge cases); still gates migration for calendars with multiple legacy sources; pattern doesn't exist elsewhere in the codebase

3. **Free for v1 basic import; advanced sync features funding-gated in later phases** (Selected)
   - Pros: Migration frictionless; funding aligned with ongoing operational value (polling infrastructure, OAuth maintenance, aggregation/mirror complexity); consistent with NPR/Wikipedia contribution model from DEC-007
   - Cons: No direct funding signal at migration time (acceptable — funding plans exist independently on the calendar and the user can subscribe once they've settled in)

## Rationale

Migration onboarding should be frictionless. Once a user has moved their calendar onto Pavillion and is operating it day-to-day, advanced sync capabilities — hosted provider OAuth, background polling, aggregation and mirror modes — represent ongoing platform value that is legitimately funding-gated territory. This matches DEC-007's NPR/Wikipedia model: the service is free to adopt and use, and voluntary contributions sustain the advanced operations that benefit the broader community. The distinction from the Facebook import posture is the use case, not the technology: Facebook import is community aggregation (aggregating Facebook event pages into a community calendar), while ICS import is personal migration (moving your own calendar's events into your own Pavillion calendar).

## Consequences

**Positive:**
- Low-friction migration path aligns with DEC-001 economic-gardening mission
- Funding-gate posture remains internally consistent (funding pays for ongoing operational value, not gatekeeping adoption)
- Users can evaluate Pavillion with their real calendar data before deciding to fund
- Clear product boundary: v1 basic import is onboarding infrastructure; advanced sync is platform value

**Negative:**
- No direct funding signal at migration time (acceptable — funding plans exist independently on the calendar and can be subscribed to once the user has settled in)
- Future advanced-sync funding gates must be clearly communicated so users understand what they're subscribing for, not retroactively locking behavior users relied on in v1

## Partially superseded by [DEC-011](dec-011-federated-value-boundary.md) (2026-05-16)

The comparative framing of ICS import vs Facebook import as "personal migration vs community aggregation," and the operational-cost rationale for funding-gating advanced ICS sync, are retracted. Facebook event import is no longer feasible per Facebook's platform constraints, and the use-case spectrum that distinction relied on has collapsed. The core decisions (ICS basic import is free onboarding; advanced ICS sync is funding-gated) remain in force, now justified under the federated value boundary principle established in DEC-011.
