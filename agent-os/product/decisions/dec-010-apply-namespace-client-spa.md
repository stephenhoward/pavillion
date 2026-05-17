# DEC-010: Public Apply Namespace Returns to Client SPA

> Date: 2026-05-03
> Status: Accepted
> Category: Technical
> Stakeholders: Tech Lead, Development Team
> Related Spec: @pv-e92c (bead)
> Supersedes: [DEC-006](dec-006-view-url-namespace.md) pv-l9wv addendum (the `/apply/` reservation as a public site namespace)

## Decision

`/apply/confirm/:token` moves from the site SPA shell to the client SPA's logged-out auth flow, with the canonical URL becoming `/auth/apply/confirm/:token`. The `/apply/` top-level reservation in `src/server/app_routes.ts` is removed; that path falls through to the client SPA catch-all like the other `/auth/*` URLs do today. The `/view/` reservation established by [DEC-006](dec-006-view-url-namespace.md) itself remains in force; only the pv-l9wv addendum that extended the reservation to `/apply/` is superseded.

## Context

The DEC-006 pv-l9wv addendum (committed earlier in this branch) reserved `/apply/` as a public site namespace and routed `/apply/confirm/:token` through the site SPA shell. The stated rationale was cookie hygiene — anonymous visitors should not load the authenticated client shell. On reflection during a post-implementation audit of the affected component, that argument did not hold:

- The cookie-hygiene concern is API-layer: the confirm GET/POST endpoints (commits `07d9901`, `40779dd`) return identical generic responses for any failure mode and run with no session middleware. Whether the user-facing landing page is rendered by the client SPA or the site SPA does not affect that property.
- Anonymous visitors already load the client SPA when they hit `/auth/login`, `/auth/apply`, or `/auth/forgot`. None of those leak anything via cookies because anonymous visitors have no session cookie to begin with. `/apply/confirm/:token` is the same kind of anonymous-visitor flow as those routes.
- Conceptually, applying for an account, confirming the email, logging in, and resetting a password are one continuous "logged-out auth" surface owned by the client SPA. Splitting one step of it into a separate SPA created visual drift, accessibility regressions (the site shell provides no `<h1>` for inner pages to subordinate to), and an unnecessary cross-SPA SCSS dependency to make the site page look like the client page.

## Alternatives Considered

1. **Keep the page in the site SPA and patch the audit findings in place**
   - Pros: Smaller change; preserves the pv-l9wv addendum
   - Cons: Patches symptoms, not the root cause (wrong SPA placement); requires either adding an `<h1>` to the site shell (visually invasive for every other site page) or accepting a heading-hierarchy violation; preserves the cross-SPA SCSS dependency that the architecture-auditor flagged

2. **Extract `logged_out/root.vue` to `src/common/components/` and reuse from both SPAs**
   - Pros: Enables future cross-SPA component reuse
   - Cons: Premature abstraction — apply-confirm is the only candidate, and moving it to the client SPA makes the abstraction unnecessary; YAGNI

3. **Move the page to the client SPA at `/auth/apply/confirm/:token`** (Selected)
   - Pros: Inherits correct shell (`AuthViews` provides `<header><h1>` for free); eliminates cross-SPA SCSS imports; conceptually unifies the logged-out auth surface in one SPA
   - Cons: User-facing URL changes from `/apply/confirm/:token` to `/auth/apply/confirm/:token` (acceptable pre-launch — no in-the-wild emails point at the old URL)

## Consequences

**Positive:**
- Page inherits `AuthViews` wrapper for free: `<main class="logged-out"><header><h1>{{ siteTitle }}</h1></header><section><RouterView /></section><footer/>` — correct heading hierarchy, named landmark via the `<h1>`-bearing header.
- Cross-SPA SCSS imports added to `src/site/assets/style.scss` in commit `bbedcb1` are reverted; the only remaining cross-SPA stylesheet dependency is the original `fonts` import.
- One conceptual model for the logged-out surface: all routes live under `/auth/*` in the client SPA. The DEC-006 pv-l9wv addendum's separate "public site namespace for anonymous flows" rule no longer needs to exist.

**Negative:**
- DEC-006 is now split between an original decision (the `/view/` URL convention, still in force) and a superseded addendum (the `/apply/` reservation). The historical record adds noise but is preserved for traceability.
