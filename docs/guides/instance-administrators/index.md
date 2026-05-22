---
description: Guides for running a Pavillion server — installation, day-two operations, federation policy, instance moderation, and being the kind of admin people want to host with.
---

# For instance administrators

This guide is for the people who run the server that other people put their calendars on — sysadmins at nonprofits and co-ops, technically inclined organizers running a neighborhood instance, IT staff at regional councils — anyone whose job it is to keep a Pavillion server up and to make the call about who gets a calendar on it.

Your role has two halves:

- **Operating the software** — installation, secrets, backups, upgrades; the infrastructure work that keeps the calendars on your instance reachable.
- **Community Stewardship** — what your instance is *for*, who can host a calendar on it, how you decide which other instances to federate with, what to do when a calendar owner you host steps over a line.

Two ways to read this section:

- **Bringing up a new instance?** Start with the [Quickstart](./quickstart). It takes you from a clean server to running Pavillion instance with one admin account in about thirty minutes. Everything else is reference material to come back to.
- **Already running one?** Browse the sidebar. Each guide answers a specific question — how to restore a backup, when to switch from local media storage to S3, what to do when another admin asks you to defederate. Read the one you need.

## What's in this section

**Get an instance running** — installation, configuration, reverse proxy, email, media storage. The technical baseline.

**Shape your instance** — what your instance is for, who gets a calendar, what the rules are. The decisions that nobody else can make for you.

**Operate your instance** — monitoring, backups, upgrades, secret rotation, troubleshooting. The day-two work.

**Federate with the network** — how federation looks from the admin seat, testing it, deciding who to trust, handling incidents that cross instance boundaries.

**Moderate at the instance level** — the boundary with calendar-owner moderation, removing a calendar, account-level operations.

**Fund your instance** — Stripe setup for community funding, and the harder question of how to talk about money with the people who use what you run.

**Relationship with your community** — communicating with your calendar owners, and the longer-term work of being someone people trust to host with.

## What's not here

- **Running a calendar on Pavillion.** That belongs to the [calendar-owner guides](/guides/calendar-owners/).
- **Contributing to Pavillion itself.** That belongs to the developer guides.
- **The ActivityPub protocol.** Referenced where you need it, not taught here. You don't need to read the spec to administer a federating server — but knowing what protocol your instance uses to talk to others helps when something goes wrong, and the guides will tell you where to look.
