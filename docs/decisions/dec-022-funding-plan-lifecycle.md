# DEC-022: One Unended Funding Plan per Account, and Who Learns Its Payment State

> Date: 2026-11-05
> Status: Accepted
> Category: Product
> Stakeholders: Tech Lead, Calendar Owners, Instance Administrators

## Decision

A funding plan is the account's single standing arrangement to support its instance ([DEC-007](dec-007-community-funding-model.md)). Six rules govern its lifecycle and who may learn about it.

**1. An account holds at most one unended plan.** A plan is *unended* while its status is anything but `cancelled` — `active` (including an active plan winding down to a period-end cancellation), `past_due` or `suspended`. `FundingService.createCheckoutSession` refuses a new checkout with `ActiveFundingPlanExistsError` (409) while the account holds one. A past-due or suspended plan counts: the provider is usually still retrying its invoice, so a second subscription would bill the account twice if the old invoice later collects. One plan may cover several calendars; one calendar is covered by at most one open allocation (a partial unique index on the allocation table enforces that half). The account half is enforced today by the checkout gate's read, not by a database constraint; adding one is outstanding work and must encode this rule — unended, not merely `active`.

**2. `getStatus` defines "the account's plan".** It returns the newest unended plan, and the newest cancelled plan only when nothing is unended. The plan-level routes — status, cancel, resume and billing portal — resolve the plan through it, so the account acts on the live plan, never on an older or ended row. An account whose only plan has ended still sees that plan, as ended. Adding or removing a calendar is narrower: it acts only on an `active` plan, since changing what a past-due or suspended plan covers would change a charge the provider is still trying to collect.

**3. Changing your mind is resume, never resubscribe.** Before a period-end cancellation takes effect, the owner reverses it on the same plan (`POST /api/funding/v1/resume`, the **Keep My Plan** action on the account funding page). Resume locks the plan, asks the provider to drop the scheduled cancellation, and clears the local boundary only once the provider confirms none remains. It is refused (`FundingPlanNotResumableError`, 409) when the plan has ended, its boundary has passed, it has no pending cancellation, or no calendar remains on it (no allocation is open beyond the boundary — as after the last calendar is removed, or for a plan bought with none) — such a plan must lapse rather than renew covering nothing.

**4. `cancelled` is terminal.** No webhook or job revives a cancelled plan. Returning after the boundary is a new checkout, which creates a new plan.

**5. Suspension recovers through the provider.** A suspended plan's remedy is to update the payment method through the provider's billing portal, which the account funding page offers for past-due and suspended plans alike, and which therefore must stay reachable for as long as the plan is unended: an admin disconnecting the provider is shown every unended plan — past-due and suspended included — and must confirm cancelling them first, so no plan is left without its recovery path. Pavillion refuses a second plan as a workaround (rule 1): a checkout started from a calendar page by an account with a suspended plan is answered with a pointer to the account funding page.

**6. Payment state is disclosed only to the account that holds the plan.** Payment state — past due, suspended, cancellation requested or taken effect, amounts, dates, provider identifiers, decline details — reaches only the plan-owning account: on its account funding page and in lifecycle emails to that account's address. Owners and editors of the calendars a plan covers learn **coverage** (the calendar's funding status and which extended features are available), never the plan's payment state. Lifecycle emails follow from this:

- One email per lifecycle change — payment failed, suspended, cancelled — whether the change began in Pavillion or at the provider (billing portal, provider dashboard, or the provider ending the subscription after retries). A change already announced is not announced again when the provider's webhook confirms it, and a redelivered webhook sends nothing.
- The template receives only the plan's billing cycle, the instance's domain and whether a cancellation takes effect at period end. The plan object never reaches the template, so amounts, provider identifiers and decline details cannot leak into one.
- The action link is the account funding plan settings leaf ([DEC-021](dec-021-client-settings-information-architecture.md)), carrying no token.

This is an account-holder disclosure boundary in the family of [DEC-016](dec-016-health-report-disclosure-boundary.md) and [DEC-017](dec-017-operational-telemetry-exposure.md), **not a [DEC-004](dec-004-privacy-first-public-access.md) matter**: no attendee data is involved.

## Context

The funding integration shipped checkout, webhooks, period-end cancellation and grace-period suspension before these rules were written down. Three gaps surfaced when lifecycle emails were added and the plan model was reviewed end to end:

- `getStatus` returned the newest plan regardless of status, so an account holding a cancelled row and a live plan could see — and cancel — the wrong one.
- The checkout gate counted only `active` plans. A suspended account could start a second subscription while the provider still retried the first; a suspension email pointing at "update your payment details" linked to a page that hid the payment button and said "contact support", while the calendar page invited a new checkout.
- An owner who cancelled at period end could not change their mind; the only route back was to wait for coverage to lapse and buy again.

The rule that a calendar sits in at most one open allocation and an account holds one plan was stated by the product owner during period-end cancellation work and lived only in code comments and tracker notes.

## Alternatives Considered

- **Allow a second checkout while a cancellation is pending** (gate on `active` and no `cancel_at`). Rejected: it makes two simultaneously billing plans representable for one account, and "pick the right one of two overlapping plans" entrenches the illegal state rather than preventing it. Resume gives the same outcome on one plan.
- **Count only `active` plans as the account's plan.** Rejected: a past-due or suspended plan is still being collected by the provider; a second plan risks a double charge, and status reporting would disagree with the gate.
- **Tell calendar editors when the covering plan's payment fails.** Rejected for now: it discloses the plan holder's payment state to people who did not take on the plan. Editors see coverage change when it changes.
- **Email only for cancellations made in Pavillion.** Rejected: an owner who cancels in the provider's billing portal — which Pavillion links to — would hear nothing, and the same state would be announced or not depending on where it began.

## Rationale

One unended plan per account keeps billing legible: one standing charge, one place to see it, one place to fix it. Defining "the account's plan" once, in `getStatus`, and making the gate agree with it removes the class of bugs where two code paths answer that question differently. Resume keeps "changing your mind" inside the plan the account already holds, so there is never a window in which two plans bill one account. Disclosing payment state only to the plan holder follows the funding model's own shape: the holder is the person who chose to support the instance, and payment trouble is theirs to see and resolve.

## Consequences

- Any new path that starts, ends, revives or reports a plan must respect rules 1–4; a database-level uniqueness constraint, when added, encodes "unended", not "active".
- A cancellation that begins at the provider and one that begins in Pavillion produce the same single email; the webhook path emits a lifecycle event only for changes Pavillion did not already make.
- A feature that tells calendar editors about funding must stay on the coverage side of rule 6; showing them payment state needs a new decision.
- Lifecycle emails for a plan's creation or recovery (`created`, `reactivated`) are not yet sent; adding them follows rule 6's template and recipient constraints.
