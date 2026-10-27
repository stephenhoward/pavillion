# DEC-012: Hand-Rolled ActivityPub Implementation

> Date: 2026-05-23
> Status: Accepted
> Category: Technical
> Stakeholders: Tech Lead
> Partially supersedes: [DEC-002](dec-002-technology-stack.md) — the `activitypub-express` federation library selection

## Decision

Pavillion's ActivityPub federation is implemented as a hand-rolled domain in `src/server/activitypub/` rather than via the `activitypub-express` library. The library was named in [DEC-002](dec-002-technology-stack.md) as the federation implementation but was never imported by runtime code and was removed from the dependency tree by pv-8fif.1 (PR #320, commit `bf8d999`). This decision supersedes the federation-library clause of DEC-002; all other library selections in DEC-002 remain in force.

## Context

DEC-002 (2025-07-29) selected `activitypub-express` as the federation library at planning time. During implementation the federation surface was built directly against ActivityPub specifications and HTTP signature primitives without integrating the library: every runtime path in `src/server/activitypub/` (inbox handlers, outbox dispatch, signature verification, actor management, WebFinger, FEP-8a8e composition) was written against `express`, `http-signature`, and intra-domain modules. The library remained in `package.json` and as an ambient type-declaration stub (`activitypub-express.d.ts`) but had zero importers. A security audit in 2026-05 surfaced this: the unused dependency was pulling four CVE-bearing transitive packages (`form-data` CRITICAL, `request` SSRF, `tough-cookie` prototype pollution, `qs` DoS), all chaining exclusively through `activitypub-express -> request`. Removing the dead dependency eliminated those findings and forced the doc-trail to catch up with reality.

## Alternatives Considered

1. **Adopt activitypub-express now to match the original DEC-002 plan**
   - Pros: Honors the planning-time decision; potentially reduces protocol-conformance maintenance burden
   - Cons: The library is unmaintained (last release 2023) and depends on the deprecated `request` HTTP client; adopting it now would re-introduce the CVE chain pv-8fif.1 just eliminated; the hand-rolled domain already implements every protocol surface Pavillion needs (Follow/Accept, Announce, Update, Delete, Undo, paired Notes for Mastodon outbox, WebFinger, FEP-8a8e Tier 1+2 interop)

2. **Inline amendment to DEC-002**
   - Pros: Single-file edit; keeps decision history compact
   - Cons: Violates the decisions.md "Never delete or edit historical decisions — supersede them" convention; erases the planning-time vs implementation-time distinction that matters for future readers evaluating other planning-time library selections in DEC-002

3. **Partial supersession via a new decision record** (Selected)
   - Pros: Honors decisions.md conventions; follows the DEC-009 → DEC-011 partial-supersession precedent; preserves the historical record of why the library was selected and why it was deselected; allows a future audit to see both the planning intent and the implementation outcome
   - Cons: One more file in `decisions/`

## Rationale

The hand-rolled implementation is the operational reality. Pavillion's federation surface has shipped to production, federates with Mobilizon/Gancio/Friendica (FEP-8a8e Tier 1+2), supports Mastodon outbox rendering, and carries its own test suite (signed delivery, signature strict receive, follow, events, auto-repost, cross-instance editors, unpost-sticky, WebFinger). The library was a planning-time placeholder that the implementation never needed. The CVE chain removed by pv-8fif.1 is the forcing function that makes documenting this overdue.

The federation library clause of DEC-002 is retracted. The Vue.js 3, Express.js, TypeScript, Sequelize + PostgreSQL, and Vitest selections in DEC-002 remain in force.

## Consequences

**Positive:**
- Documentation matches operational reality; new contributors won't search for a phantom integration
- Security posture improvement carried by pv-8fif.1 is now reflected in the decision record
- Future federation work is unconstrained by an external library's release cadence or maintenance status
- Preserves the planning-time decision record (DEC-002) for institutional memory

**Negative:**
- Hand-rolled implementation must track ActivityPub spec evolution and FEP additions internally; no library upstream to absorb that work
- Maintenance burden for protocol-level correctness sits in `src/server/activitypub/` rather than being delegated
