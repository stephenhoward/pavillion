# DEC-007: Community Funding Model and Stripe Product Choice

> Date: 2026-03-15
> Status: Accepted
> Category: Product
> Stakeholders: Product Owner, Tech Lead, Development Team

## Decision

Pavillion will support optional community funding plans that allow calendar owners to collect contributions from their community to sustain calendar infrastructure. The feature uses Stripe Embedded Checkout for payment processing, with instance administrators entering Stripe API keys directly rather than using Stripe Connect OAuth. The term "funding plan" is used instead of "subscription" throughout the codebase and UI to avoid terminology collision with ActivityPub's use of "subscription" for follow relationships.

**Stripe is the only payment provider in v1.** PayPal is descoped: the scaffolding stays in the tree, inert. There is no reachable PayPal payment path — checkout resolves an enabled Stripe provider only. PayPal completion is deferred, not cancelled.

### The three sites that encode "Stripe only"

"Stripe only" is **not** enforced in one place. Three independent sites encode it, two of them written before the descope and of opposite polarity (denylist rather than allowlist). Re-enabling PayPal means changing all three; changing only one produces a partially-enabled provider, which is worse than either end state.

| Site | Mechanism | Effect |
|---|---|---|
| `src/client/components/admin/funding.vue` — `V1_PROVIDER_TYPES` | Allowlist (`['stripe']`) applied to the provider list on load | Keeps PayPal out of the admin connected-providers list and the add-provider wizard |
| `src/client/components/account/FundingForm.vue` — `availableProviders` | Denylist (`providerType !== 'paypal'`) applied to `GET /v1/options` | Keeps PayPal out of the purchase form's provider choice. Predates the descope. The file also carries an unreachable `startPayPalCheckout()` stub that only sets a generic error |
| `src/server/funding/service/funding.ts` — `resolveEnabledStripeProvider()` | Hard-coded query (`provider_type: 'stripe', enabled: true`) | Checkout-session creation can only ever resolve Stripe, whatever the UI offers |

The concrete failure mode of a partial change: flip only the admin allowlist and PayPal becomes connectable and enableable in the admin UI, while `FundingForm.vue`'s denylist still hides it from purchasers — an instance with a configured, enabled, invisible provider. That is precisely the silent-failure mode this descope exists to prevent.

Consolidating these into one shared constant is worthwhile but was deliberately not done here: it touches `src/common/model/funding-plan.ts` and `FundingForm.vue`, both outside the descope's scope and under concurrent change. The consolidation is tracked as **pv-vhop**. Until it lands, this table is the authoritative enumeration.

### Inert scaffolding, and the one reachable piece

Left in place and genuinely unreachable: the PayPal adapter (`service/provider/paypal.ts`), the `paypal` branch of `ProviderFactory.getAdapter`, the admin credential form in `add-provider-wizard.vue`, `paypal-config-modal.vue` (now referenced by nothing), and the unconfigured PayPal row seeded by `ensureDefaultProviders()`.

**Reachable but inert:** `POST /api/funding/v1/admin/providers/paypal/configure` (`api/v1/provider_connection.ts`) and `FundingInterface.configurePayPal` remain live and admin-authenticated. A direct caller — not the UI, which no longer offers the route — can still validate credentials against the PayPal API, encrypt them, and persist them. This is accepted: it is a configuration surface, not a checkout path, it requires instance-admin authority, and the resulting row still cannot produce a checkout session. It is named here so that "inert" is not read as "removed."

### Terminology

- The access-gating platform built on top of funding plans is called **funding access** — `checkFundingAccess`, `useFundingAccess`, `FundingStatus`. "Entitlement" is not used as an identifier anywhere in the codebase.
- `SubscriptionRequiredError` is the one documented **legacy wire exception**. Gated endpoints keep returning `402` with `errorName: 'SubscriptionRequiredError'` so existing clients continue to recognise the response. That name is frozen at the wire boundary; no new identifier — service method, model field, API field, translation key, or UI copy — may propagate "subscription" into the funding vocabulary.

## Context

Running a Pavillion instance requires ongoing costs for hosting, maintenance, and community development. Rather than monetizing the platform through advertising or data collection, Pavillion adopts a community-supported funding model analogous to NPR or Wikipedia donation drives. Calendar owners can create funding plans that invite voluntary contributions from community members who benefit from the calendar. This approach directly aligns with the economic gardening mission ([DEC-001](dec-001-initial-product-planning.md)) by keeping community infrastructure community-funded rather than commercially driven.

The initial implementation used Stripe Connect with OAuth, which is designed for marketplace platforms that route payments between multiple parties. This was the wrong product for Pavillion's use case, where each instance collects payments directly on behalf of its own calendars. Stripe Embedded Checkout is the correct product: it handles payment processing via an iframe embedded in the page, the user never leaves the site, and the instance owner maintains a direct relationship with Stripe using their own API keys — the same direct-credential shape the PayPal scaffolding was built around before PayPal was descoped for v1.

Multi-provider support was designed in early (a provider adapter interface, a factory, and per-provider admin credential forms) with Stripe and PayPal as the two implementations. Only the Stripe path reached the correctness bar needed to gate paid features on it: PayPal's checkout completion, webhook handling, and lifecycle reconciliation were never finished or validated. Shipping a half-wired second provider in the admin UI would let an instance administrator connect PayPal and end up with a funding configuration that silently fails to renew, suspend, or cancel.

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

On the PayPal descope specifically:

5. **Hide PayPal, keep the scaffolding** (Selected)
   - Pros: No reachable half-finished payment path; the adapter abstraction survives, so finishing PayPal later is additive rather than a rewrite; smallest diff, no migration, nothing to un-delete
   - Cons: Dead code stays in the tree and must be documented as deliberately unreachable (this decision); "Stripe only" ends up encoded in three sites rather than one

6. **Remove the PayPal scaffolding entirely**
   - Pros: No dead code, no ambiguity about what is supported, only one place left encoding "Stripe only"
   - Cons: Discards a working provider-adapter abstraction that cost real effort and whose only defect is unfinished lifecycle handling; reinstating PayPal becomes a rewrite rather than a completion, which makes the deferral read as a cancellation; deleting the seeded row and the admin route needs a migration and a wider blast radius than the descope warrants

7. **Show PayPal with a "not available" badge**
   - Pros: Honest about the roadmap; reuses the existing status-badge pattern; sets expectations for operators who want PayPal (the acceptance criteria permitted this treatment)
   - Cons: Adds translated UI copy and a badge state for a provider nobody can use, which has to be maintained and re-translated until PayPal ships; advertises a capability with no committed date; "coming soon" in an admin settings page is a support-question generator. Hiding costs nothing today because no instance has ever been able to complete a PayPal checkout

## Rationale

The community funding model was chosen because:

1. **Mission alignment** - Community infrastructure should be funded by the community it serves, not through commercialization or data extraction. This follows the NPR/Wikipedia model where the service is free to access but sustained by voluntary contributions from those who value it.
2. **Economic gardening** - Funding plans enable local organizations to sustain their event calendars as community infrastructure, supporting the broader goal of strengthening local economies and community resilience.
3. **Correct Stripe product** - Embedded Checkout is the right product for direct payment collection. Connect OAuth is designed for platforms that facilitate payments between third parties (marketplaces), which is not what Pavillion does. Each instance owner has their own Stripe account and collects payments directly.
4. **Terminology clarity** - Using "funding plan" instead of "subscription" avoids confusion with ActivityPub terminology where "subscription" refers to following an actor or calendar. This distinction is important in a federated system where ActivityPub concepts are core to the architecture.
5. **Privacy consistency** - The funding model maintains Pavillion's privacy-first principles ([DEC-004](dec-004-privacy-first-public-access.md)). Payment processing is handled by Stripe; Pavillion stores only the minimum metadata needed to track funding plan status, not payment details.
6. **One provider, correct** - Gating features on funding access means the payment lifecycle has to be trustworthy. One fully-validated provider is worth more than two partially-wired ones, and hiding PayPal costs nothing today because no instance has ever been able to complete a PayPal checkout. Removing the scaffolding instead of hiding it would throw away the adapter abstraction that makes a second provider cheap to finish later.
7. **Terminology discipline with a bounded exception** - "Funding access" keeps the gating platform in the same vocabulary as funding plans, and rules out a third term ("entitlement") for the same concept. `SubscriptionRequiredError` is grandfathered rather than renamed because it is an observable wire contract; confining the exception to the wire keeps the collision with ActivityPub "subscription" out of everything new.

## Consequences

**Positive:**
- Sustainable funding path for community calendar infrastructure without commercialization
- Consistent with economic gardening mission and community-first values
- Simpler integration than Connect OAuth with fewer moving parts
- Users complete payment without leaving the site
- Clear terminology boundary between funding plans and ActivityPub subscriptions
- Instance owners maintain direct Stripe relationship and full control over their payment configuration
- A single supported provider means one payment lifecycle to validate before enabling live funds
- The provider adapter abstraction survives the descope, so finishing PayPal later is additive

**Negative:**
- Instance administrators must create and configure their own Stripe account
- Instances that would prefer PayPal have no option in v1, and Stripe availability varies by country
- API keys must be stored securely (encrypted at rest) adding operational complexity
- Funding plan management adds UI and backend complexity to the calendar domain
- Per-calendar funding configuration requires calendar owners to understand pricing options
- Inert PayPal scaffolding remains in the tree, so readers must consult this decision to know it is deliberately unreachable rather than merely unfinished
- "Stripe only" is enforced at three uncoordinated sites of mixed polarity, so re-enabling PayPal is an all-three change and a partial change produces a configured-but-invisible provider. The enumeration table above is the mitigation; a shared constant is the real fix and is tracked as pv-vhop
- The admin PayPal configure route stays live to direct callers, so an instance admin can still persist credentials that nothing will ever use
- `SubscriptionRequiredError` on the wire diverges from the "funding access" vocabulary used everywhere else, which requires the exception to be documented rather than inferred
