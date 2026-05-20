---
description: Set up Stripe so the calendar owners on your instance can offer community funding plans — keys, CSP, the difference between funding plans and subscriptions.
---

# Setting up funding plans

> Status: placeholder. This guide will be written before launch.

Pavillion supports community funding plans — voluntary contributions from event-goers and community members to keep a calendar running, closer to public radio than to a software subscription. The plumbing for this is Stripe. As the instance administrator, you're the one who creates the Stripe account and gets the keys into config; the calendar owners are the ones who actually offer plans and talk to their communities about money.

## Planned scope

- Creating a Stripe account for your instance — you, the admin, are the merchant of record. This is not Stripe Connect; you don't onboard your calendar owners into Stripe individually
- The keys you need: publishable key, secret key, webhook signing secret. Where each goes in config, how to rotate them ([secret rotation](./secret-rotation))
- CSP changes for the Stripe embedded checkout iframe — what loads from where, what to allow
- Webhook configuration on the Stripe side — the endpoint, the events to listen for, how to verify Pavillion is receiving them
- Testing the funding flow before announcing it: Stripe's test mode, the test card numbers, what a successful contribution looks like in the database and in Stripe
- The vocabulary boundary, explained once so the admin can explain it later: Pavillion calls these "funding plans" and never "subscriptions." That's because "subscription" already means something specific in ActivityPub (following an actor or calendar). The codebase, UI, and these guides keep the words separate
- The "what about VAT, taxes, 1099s, donations vs. revenue" question — out of scope for this guide, but pointers to where to start
