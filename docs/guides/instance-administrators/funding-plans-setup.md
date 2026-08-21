---
description: Set up Stripe so calendar owners can support your instance with voluntary funding plans — keys, CSP, webhooks, and testing the flow.
---

# Setting up funding plans

> Status: placeholder. This guide will be written before launch.

Pavillion supports voluntary funding plans — recurring contributions from the calendar owners on your instance that help you keep it online, closer to public radio than to a paywall. The plumbing for this is Stripe. As the instance administrator, you're the merchant of record: you create the Stripe account, get the keys into config, and the contributions support your operating costs. How to talk to your community about it is its own guide: [asking your community for money](./asking-your-community-for-money).

## Planned scope

- Creating a Stripe account for your instance — you, the admin, are the merchant of record. This is not Stripe Connect; calendar owners don't onboard into Stripe individually
- The keys you need: publishable key, secret key, webhook signing secret. Where each goes in config, how to rotate them ([secret rotation](./secret-rotation))
- CSP changes for the Stripe embedded checkout iframe — what loads from where, what to allow
- Webhook configuration on the Stripe side — the endpoint, the events to listen for, how to verify Pavillion is receiving them
- Testing the funding flow before announcing it: Stripe's test mode, the test card numbers, what a successful contribution looks like in the database and in Stripe
- The vocabulary, explained once so you can explain it later: a funding plan supports the instance — the money never goes to a calendar, and calendars are "covered by" a plan, not funded by anyone. "Subscription" is the word for the payment mechanics (renewal, billing, cancellation), which is also what Stripe's dashboard calls it
- The "what about VAT, taxes, 1099s, donations vs. revenue" question — out of scope for this guide, but pointers to where to start
