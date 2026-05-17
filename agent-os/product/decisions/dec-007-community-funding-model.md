# DEC-007: Community Funding Model and Stripe Product Choice

> Date: 2026-03-15
> Status: Accepted
> Category: Product
> Stakeholders: Product Owner, Tech Lead, Development Team

## Decision

Pavillion will support optional community funding plans that allow calendar owners to collect contributions from their community to sustain calendar infrastructure. The feature uses Stripe Embedded Checkout for payment processing, with instance administrators entering Stripe API keys directly rather than using Stripe Connect OAuth. The term "funding plan" is used instead of "subscription" throughout the codebase and UI to avoid terminology collision with ActivityPub's use of "subscription" for follow relationships.

## Context

Running a Pavillion instance requires ongoing costs for hosting, maintenance, and community development. Rather than monetizing the platform through advertising or data collection, Pavillion adopts a community-supported funding model analogous to NPR or Wikipedia donation drives. Calendar owners can create funding plans that invite voluntary contributions from community members who benefit from the calendar. This approach directly aligns with the economic gardening mission ([DEC-001](dec-001-initial-product-planning.md)) by keeping community infrastructure community-funded rather than commercially driven.

The initial implementation used Stripe Connect with OAuth, which is designed for marketplace platforms that route payments between multiple parties. This was the wrong product for Pavillion's use case, where each instance collects payments directly on behalf of its own calendars. Stripe Embedded Checkout is the correct product: it handles payment processing via an iframe embedded in the page, the user never leaves the site, and the instance owner maintains a direct relationship with Stripe using their own API keys (similar to how PayPal integration works).

## Alternatives Considered

1. **Stripe Connect OAuth (marketplace model)**
   - Pros: Managed onboarding flow, Stripe handles account verification
   - Cons: Wrong product for direct payment use case, adds unnecessary platform intermediary, complex OAuth flow, implies Pavillion is a marketplace when it is not

2. **Stripe Hosted Checkout (redirect model)**
   - Pros: Simplest integration, Stripe manages the entire checkout page
   - Cons: User leaves the site during payment, breaks the embedded community experience, less control over UX

3. **Stripe Embedded Checkout (iframe model)** (Selected)
   - Pros: User stays on site, direct payment relationship, correct product for single-merchant use case, clean UX with iframe integration
   - Cons: Requires CSP updates for Stripe iframe, slightly more frontend integration work

4. **No funding feature**
   - Pros: Simpler codebase, no payment complexity
   - Cons: No sustainable funding path for community infrastructure, instance operators bear all costs

## Rationale

The community funding model was chosen because:

1. **Mission alignment** - Community infrastructure should be funded by the community it serves, not through commercialization or data extraction. This follows the NPR/Wikipedia model where the service is free to access but sustained by voluntary contributions from those who value it.
2. **Economic gardening** - Funding plans enable local organizations to sustain their event calendars as community infrastructure, supporting the broader goal of strengthening local economies and community resilience.
3. **Correct Stripe product** - Embedded Checkout is the right product for direct payment collection. Connect OAuth is designed for platforms that facilitate payments between third parties (marketplaces), which is not what Pavillion does. Each instance owner has their own Stripe account and collects payments directly.
4. **Terminology clarity** - Using "funding plan" instead of "subscription" avoids confusion with ActivityPub terminology where "subscription" refers to following an actor or calendar. This distinction is important in a federated system where ActivityPub concepts are core to the architecture.
5. **Privacy consistency** - The funding model maintains Pavillion's privacy-first principles ([DEC-004](dec-004-privacy-first-public-access.md)). Payment processing is handled by Stripe; Pavillion stores only the minimum metadata needed to track funding plan status, not payment details.

## Consequences

**Positive:**
- Sustainable funding path for community calendar infrastructure without commercialization
- Consistent with economic gardening mission and community-first values
- Simpler integration than Connect OAuth with fewer moving parts
- Users complete payment without leaving the site
- Clear terminology boundary between funding plans and ActivityPub subscriptions
- Instance owners maintain direct Stripe relationship and full control over their payment configuration

**Negative:**
- Instance administrators must create and configure their own Stripe account
- API keys must be stored securely (encrypted at rest) adding operational complexity
- Funding plan management adds UI and backend complexity to the calendar domain
- Per-calendar funding configuration requires calendar owners to understand pricing options
