# DEC-011: ICS Scope, Curator Aggregation Model, and Federated Value Boundary

> Date: 2026-05-16
> Status: Accepted
> Category: Product
> Stakeholders: Product Owner, Tech Lead
> Related Spec: Cited by roadmap v5.0.0 (`agent-os/product/roadmap.md`)
> Partially supersedes: [DEC-009](dec-009-ics-import-funding-gate-posture.md) — the comparative ICS-vs-Facebook framing and the operational-cost rationale for advanced-sync funding gating

## Decision

Three connected scope decisions:

1. **ICS import is exclusively organizer migration tooling.** It is not a curator aggregation surface. The basic-import-is-free-onboarding decision from [DEC-009](dec-009-ics-import-funding-gate-posture.md) stands; the DEC-009 framing that contrasted ICS as "personal migration" against Facebook import as "community aggregation" is retracted. ICS import exists to help an organization move its own existing calendar data into its own Pavillion calendar, full stop.

2. **Curator aggregation operates via federation only.** A community curator (chamber of commerce, tourism board, city events page) aggregates by following other Pavillion calendars and other ActivityPub event platforms (Mobilizon, Gancio, Friendica). The 20 source calendars in a typical curator aggregator are 20 community organizations with their own Pavillion calendars, federated to the curator via the existing follow + auto-repost mechanism — not 20 external platforms scraped or imported. There is no roadmap path for curator aggregation from non-federated sources (Facebook, Eventbrite, Google Calendar, etc.) — neither as a free in-product feature nor as a funding-gated one.

3. **Advanced ICS sync (background polling, hosted-provider OAuth, mirror mode) remains funding-gated, but the rationale is rewritten.** DEC-009 framed this as operational-cost gating. This decision regates it under the *federated value boundary principle*: features that maintain ongoing integrations with non-federated systems — inbound (Google Calendar OAuth, Outlook/M365, iCloud, ICS polling of non-federated sources) or outbound (ICS feed export, third-party read API, advanced widget embedding) — are platform-bridge services, structurally distinct from in-network features. Operational cost remains a secondary contributing concern but is no longer the primary justification.

## Context

DEC-009 was written when Facebook event import was the planned vector for community aggregation from non-federated platforms. Subsequent investigation has confirmed Facebook import is infeasible due to platform constraints Facebook has imposed. This invalidates DEC-009's comparative framing, which positioned ICS import (free, personal migration) against Facebook import (funding-gated, community aggregation) as two ends of a use-case spectrum. With Facebook removed, that spectrum collapses, and the curator aggregation model needs to be restated without reference to non-federated platforms.

In parallel, roadmap v5.0.0 introduced an explicit operating principle — the *federated value boundary* — that separates in-network features (free) from outside-network features (funding-gated). This principle is more mission-coherent than DEC-009's operational-cost framing because it maps directly to the federation differentiator in `mission.md`: the federated network is what Pavillion exists to enhance, and features that step outside the federated paradigm are value-add platform-bridge services with a different cost and incentive structure.

The mission's "Community Curators ... aggregate and curate events from multiple sources" language has been read ambiguously over time. Read in context with the rest of the Problem section ("organizations maintain their own calendars while enabling community curators to create comprehensive, unified views"), "multiple sources" unambiguously means multiple federated calendars maintained by the organizations themselves. The alternate reading — that "multiple sources" could include non-federated platforms (Facebook pages, Eventbrite listings, individual websites) — is a misreading: those external platforms are named in the *problem statement* as the fragmentation Pavillion solves, not in the *solution architecture* as inputs to curator aggregation. The solution is to bring organizations onto Pavillion (where they maintain their own calendars) and federate.

This misreading was actively encoded by DEC-009's Facebook framing and propagated into the v5 roadmap draft, where it would have shipped a curator-workflow phase modeled on cross-platform ICS aggregation if not caught in review. This DEC corrects the record so the misreading does not recur.

## Alternatives Considered

1. **Leave DEC-009 in place; let the Facebook framing decay silently**
   - Pros: No new document to maintain
   - Cons: DEC-009 actively codifies a curator model that no longer has any implementation path; future readers (human or AI) keep importing the stale model — which has already happened once during roadmap v5 drafting

2. **Edit DEC-009 in place**
   - Pros: Single source of truth
   - Cons: Violates the codebase convention of immutable decision records with supersession notes (established by DEC-006 → DEC-010); loses the historical record of what was believed when

3. **Issue DEC-011 with the corrected framing; mark DEC-009's invalidated paragraphs as superseded** (Selected)
   - Pros: Follows established supersession convention; preserves historical record; gives roadmap v5 a clean decision to cite; future readers see both the original framing and the correction
   - Cons: Two documents to read for full context (acceptable — that is how supersession works in this repo)

## Rationale

Three reasons drove this revision:

1. **Mission coherence.** The federated network is the mission's central architectural commitment. Funding-gating features by whether they sit inside or outside that network makes the funding ask honest: voluntary contribution sustains community infrastructure; value-add platform bridges to non-federated systems are appropriately a paid surface. This aligns [DEC-001](dec-001-initial-product-planning.md) (economic gardening) and [DEC-007](dec-007-community-funding-model.md) (voluntary contribution model) with a concrete in/out rule that decides individual feature placement.

2. **Stale rationale is dangerous.** DEC-009's Facebook-as-community-aggregation framing actively misled the v5 roadmap draft. The longer a stale framing sits in the decision record, the more downstream artifacts inherit it. Correcting the record at the decision layer prevents further propagation.

3. **Curator model precision matters for current work.** With curator aggregation correctly framed as in-network federation, Phase 1 of the v5 roadmap (Curation Workflow on Top of Follow + Repost) targets the right problems: selective repost policies, category normalization across followed Pavillion calendars, deduplication in the repost chain, editorial controls preserved across source updates. With the wrong framing, Phase 1 would have targeted source-management UIs for non-Pavillion sources that do not exist as inputs.

## Consequences

**Positive:**
- Mission-coherent funding-gate rationale (in-network = free; platform bridge = gated) replaces an ad-hoc operational-cost framing
- Curator aggregation model is unambiguously restricted to federation, preventing future drift toward multi-platform aggregation surfaces that do not fit the architecture
- ICS import scope is clear: organizer migration tool, full stop — no aggregation use case attached
- Roadmap v5 Phase 1 has a defensible decision-level foundation
- The boundary principle gives every future inbound/outbound feature a deterministic free/gated classification, reducing future scope debates

**Negative:**
- Reading DEC-009 now requires also reading DEC-011 to understand which paragraphs are superseded (standard cost of the supersession convention)
- Operational-cost concerns about advanced ICS sync (polling rate limits, OAuth maintenance burden, hosted-provider API quotas) are demoted from primary to secondary rationale, which slightly reduces their salience in future planning — should be re-surfaced during the deferred-phase re-engagement when advanced ICS sync is built
- The federated value boundary requires a judgment call for edge cases that span the boundary (e.g. schema.org Event markup on public event pages: content stays on Pavillion but is consumed by Google's crawler). The v5 roadmap classifies these as in-network discovery infrastructure; this DEC accepts that classification and reserves the right to revisit it case-by-case
