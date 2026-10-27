# DEC-006: Public Site URL Namespace Reserved as `/view/`

> Date: 2026-02-22
> Status: Superseded by [DEC-018](dec-018-root-calendar-urls.md) (the pv-l9wv `/apply/` addendum had already been superseded by [DEC-010](dec-010-apply-namespace-client-spa.md))
> Category: Technical
> Stakeholders: Development Team

## Decision

The `/view/` path prefix is permanently reserved as the public site SPA namespace. Public calendar URLs use the form `/view/:calendarName` (and locale-prefixed equivalents `/[lang]/view/:calendarName`). The `@` character is no longer used in public site routing.

## Context

The original `/@calendarname` routing convention conflicted visually and conceptually with ActivityPub's use of `@` for actor identity (e.g., `@user@instance.social`). This was identified as a pre-launch concern — changing after launch would require backward-compatibility redirects and could break bookmarked URLs. Switching to `/view/calendarname` resolves the ambiguity while keeping a readable, semantic URL structure.

## Alternatives Considered

1. **Keep `/@calendarname`**
   - Pros: Already implemented, no migration needed
   - Cons: Confusing overlap with ActivityPub `@` actor notation

2. **Use `/c/:calendarName` (short prefix)**
   - Pros: Shorter URLs
   - Cons: Less descriptive, less obvious to end users

3. **Use `/view/:calendarName`** (Selected)
   - Pros: Clear semantic meaning, no conflict with ActivityPub, readable
   - Cons: Slightly longer URLs

## Rationale

`/view/` clearly communicates intent (viewing a calendar), avoids all confusion with ActivityPub actor addresses, and establishes a clean namespace boundary. Since this is a pre-launch change, no backward-compatibility redirects are needed.

## Consequences

**Positive:**
- No ambiguity between public calendar URLs and ActivityPub actor URLs
- Clear, semantic URL structure that is understandable to end users
- The `view` exclusion in the client catch-all regex prevents `/view/` paths from being accidentally served by the authenticated client SPA

**Negative:**
- URLs are slightly longer than the `@` convention
- Any external documentation or links using `/@` format are now invalid (acceptable pre-launch)

## Addendum (pv-l9wv): Additional Public Site Namespaces

The principle established here — a reserved top-level public-site namespace served from the unauthenticated site SPA shell rather than the authenticated client SPA — extends to other public anonymous flows. As of pv-l9wv, `/apply/` is also reserved as a public site namespace (currently scoped to `/apply/confirm/:token` for account-application email confirmation). Any new top-level public-site namespace must be added to the catch-all exclusion in `src/server/app_routes.ts` and routed through `handlers.site_index` / `handlers.locale_prefixed_site` so anonymous visitors do not load the authenticated client shell (DEC-004 cookie hygiene).

**Superseded by [DEC-010](dec-010-apply-namespace-client-spa.md) (2026-05-03)** — the `/apply/` reservation has been retracted. `/apply/confirm/:token` moved into the client SPA at `/auth/apply/confirm/:token`. The `/view/` reservation remained in force at that point; it has since been retired by DEC-018, below.

## Superseded by [DEC-018](dec-018-root-calendar-urls.md) (2026-09-14)

`/view/` is no longer an address. Public calendar URLs moved to the domain root — `/:calendarName` and `/:lang/:calendarName` — and the discovery page moved to `/discover`. The `/view` segment stays reserved permanently and only ever issues 301s: `/view` → `/discover`, `/view/<rest>` → `/<rest>`, locale twins included.

What survives from this decision: the `@` prefix is still not used in public site routing, and the reasoning above for why — its collision with ActivityPub actor handles — is the reason returning to it was rejected again in DEC-018. What does not survive: the `/view/` namespace itself, and the "pre-launch, no backward-compatibility redirects are needed" clause in the Rationale. Redirects are now permanent, because old URLs are held by federated peers, search indexes and bookmarks rather than only by this project.

Namespace separation between calendar names and application routes is no longer achieved by a path prefix. It is enforced by `src/common/routing/reserved-segments.ts`, the single definition of the top-level segments a calendar may not claim; the catch-all exclusion in `src/server/app_routes.ts` derives from that module rather than listing `view` by hand. See [DEC-018](dec-018-root-calendar-urls.md) for the current URL contract.
