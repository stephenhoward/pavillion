# Stripe Fixture Maintenance

Pavillion's Stripe webhook parser is tested against fixtures — payload literals
copied from real test-mode Stripe events. Fixtures do not change when Stripe
changes the shape of the payloads they were copied from, so a fixture that has
gone stale keeps the test suite green while the parser silently stops matching
production traffic.

This document is the manual procedure for catching that drift. There is no
automated equivalent, and no test-clock automation: nothing in `npm test`
reaches Stripe.

## When to run this

**On every `stripe` npm package version bump.** That is the trigger. A version
bump is the moment the SDK's types, and usually the API version the adapter
pins, move underneath fixtures that were captured against the old shape.

Run it as part of the bump, before the dependency change is merged — not on a
schedule, and not only when something looks broken. Drift is silent by
construction; by the time a symptom appears in production the fixtures have
already been lying for a release or two.

The precedent is the pre-Basil breakage this procedure exists to prevent. SDK
v20 (Basil) moved `invoice.subscription` to
`invoice.parent.subscription_details.subscription`, and
`subscription.current_period_*` to
`subscription.items.data[0].current_period_*`. Both fields are load-bearing for
the funding-plan lifecycle. Every unit test stayed green throughout, because
every fixture still carried the old shape.

## What is under test

The parser is `parseWebhookEvent` in
`src/server/funding/service/provider/stripe.ts`, together with its two shape
helpers, `extractInvoiceSubscriptionId` and `extractBillingPeriod`.

The handled event types — the set the `switch` in `parseWebhookEvent` has a
case for — are:

| Event type | Fields the parser reads |
|---|---|
| `checkout.session.completed` | `subscription`, `customer`, `metadata.pavillion_account_id`, `metadata.pavillion_calendar_ids` |
| `invoice.paid` | `parent.subscription_details.subscription`, `customer` |
| `invoice.payment_succeeded` | `parent.subscription_details.subscription`, `customer` |
| `invoice.payment_failed` | `parent.subscription_details.subscription`, `customer` |
| `customer.subscription.updated` | `id`, `customer`, `status`, `items.data[0].current_period_start`/`_end` |
| `customer.subscription.deleted` | `id`, `customer` |

The adapter pins `apiVersion: '2026-02-25.clover'` for its own outbound calls.
Webhook payloads are serialized with the API version configured on the
*endpoint*, which an instance administrator sets independently, so the parser
also honours the legacy shapes as fallbacks. Both paths need fixtures.

The fixtures themselves are inline payload literals in the test files, not a
separate fixtures directory:

- `src/server/funding/test/adapter.test.ts` — the `parseWebhookEvent`
  fixtures, in modern (post-Basil) shape.
- `src/server/funding/test/webhooks.test.ts` — end-to-end webhook fixtures
  mounted through `FundingApiV1.install`; several are in the legacy shape,
  exercising the fallback branches.

## Procedure

### 1. Re-harvest, don't re-drive

Stripe's Events API re-renders a *stored* event into the API version of the
retrieving request. This is verified behaviour, not an assumption: events
harvested with `-H "Stripe-Version: 2026-02-25.clover"` from an account whose
endpoint version was never changed came back in post-Basil shape —
`parent.subscription_details.subscription` populated, and
`items.data[0].current_period_*` present on both subscription events.

That makes the ordinary drift check a re-harvest and a diff. You do not need to
re-drive any checkout flows to find out whether a version bump changed a
payload shape. Pull the same historical event ids at the old version and the
new one and compare:

```bash
curl -s "https://api.stripe.com/v1/events?limit=100" \
  -u "$STRIPE_SK:" -H "Stripe-Version: <version>" | jq -c '.data[]'
```

Harvest twice — once at the API version the fixtures were captured under, once
at the version the bump moves to — and diff the two, narrowed to the fields in
the table above. A full manual capture (step 3) is only necessary when a **new**
event type enters the handled set, or when the test account no longer holds an
event of a type you need.

### 2. Diff against the committed fixtures

For each handled event type, compare the freshly harvested payload against the
fixture literal in `adapter.test.ts`:

- A field the parser reads that has **moved** — update the fixture to the new
  shape, then update the parser to read it. Keep a fixture in the old shape
  too, so the fallback branch stays covered.
- A field that has been **removed or nulled** — see the note below on
  unreachable fallbacks.
- A field that is merely **new** and unread — no change needed. Fixtures are
  trimmed to what the parser touches; they are not full payload dumps.

Then run the parser tests:

```bash
npx vitest run src/server/funding/test/adapter.test.ts
npx vitest run src/server/funding/test/webhooks.test.ts
```

Green tests here mean the parser matches the fixtures. They mean the parser
matches Stripe only if the fixtures were refreshed first — which is the whole
point of doing the harvest before the test run.

**Fallbacks that a harvest cannot cover.** At `2026-02-25.clover` the legacy
top-level `invoice.subscription` is `null`, not merely deprecated. The
fallback branch in `extractInvoiceSubscriptionId` that reads it is therefore
unreachable from any freshly harvested fixture. Its coverage can only come from
a hand-built fixture, or from a harvest pinned to an older API version. Anyone
maintaining that branch needs to know the harvest will never exercise it.

### 3. Full capture (new event types only)

When a new event type joins the handled set, the payload has to be produced by
driving the real flow in test mode. Three findings from the last full capture
run, recorded so they are not rediscovered:

1. **A successful subscription checkout emits `customer.subscription.created`,
   never `.updated`.** The happy path yields only three of the six handled
   types: `checkout.session.completed`, `invoice.paid`, and
   `invoice.payment_succeeded`.
2. **Both cancel paths are required, and they are not alternatives.**
   `customer.subscription.updated` comes from a cancel-at-period-end performed
   in the UI; `customer.subscription.deleted` comes from an immediate cancel
   via the Stripe CLI.
3. **`invoice.payment_failed` on a subscription-backed invoice cannot be
   produced through embedded Checkout with any test card.** Checkout validates
   payment before creating the subscription, so `4000 0000 0000 0341` behaves
   identically to `4000 0000 0000 9995`. The event must be built API-side, with
   `pm_card_chargeCustomerFail` and `payment_behavior=allow_incomplete`.

Driving the real flow is also worth the cost for its own sake. The last capture
run surfaced two production bugs — a cancel-at-period-end reverted by the
webhook it triggers, and `funding_event` rows accruing for unhandled event
types — that neither source reading nor the unit suite had found. That is the
argument for the version-bump trigger being a live re-capture rather than a
desk review of the fixtures.

### 4. Scrub before committing

Captured payloads carry real data from the test account. Before a fixture is
committed, replace every email address, personal name, and free-text field with
a synthetic value, and keep object ids in the existing `sub_`/`cus_`/`evt_`
placeholder style used by the surrounding fixtures. Commit only the fields the
parser reads.

### 5. Verify the scrub against what you actually committed

The judgement half of the scrub — *is this free-text field identifying?* — is
yours, and the sweeps documented alongside the fixture module are how you make
it. Run them, and the automated redaction guard, against the **committed**
files, never against the raw harvest. A capture that is clean in your working
tree and dirty in the commit is the failure this step exists to catch.

The guard is enforced by PR CI. This repository has no git hooks, so nothing
stops the bad commit locally — it blocks the merge instead. That ordering
matters for how you fix a hit: an unscrubbed capture already in a commit has to
be corrected by amending or rewriting that commit, not by adding a scrubbing
commit on top, because the secret stays readable in the branch history either
way.

For the same reason the guard reports only a boolean and the offending
filename, never the matched value: a failing run is published to a public
Actions log, which — unlike a local commit — cannot be amended away.

## If test-clock automation is ever built

Stripe test clocks would let a scheduled job advance a subscription through
renewal and dunning and assert on the resulting events. Nothing of the sort
exists today, and this document is the deliberate substitute for it.

If it is ever built, two constraints hold:

- It is a **separate, scheduled script** — something like an
  `npm run test:stripe-live` target, run on its own cadence.
- It is **never part of the default `npm test`.** The default suite must stay
  hermetic: no live Stripe credentials, no network, no wall-clock dependence,
  no failures caused by the state of a shared test account.

A live-Stripe job would supplement this runbook, not retire it. The version-bump
diff is what catches payload *shape* drift; a test clock exercises lifecycle
*timing*.
