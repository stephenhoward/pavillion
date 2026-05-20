---
description: Upgrade a Pavillion instance — release cadence, the changelog discipline, the upgrade ritual, and how to roll back when an upgrade goes wrong.
---

# Upgrading

> Status: placeholder. This guide will be written before launch.

Pavillion releases regularly, with most releases being safe to pull and restart. The work of upgrading is mostly: read the changelog, take a backup, restart the containers, verify. This guide covers the ritual, the breaking-change handling, and the rollback path when something goes wrong.

## Planned scope

- The release model: image tags (`latest`, `main`, version pins), where the changelog lives, which release notes you actually have to read
- Reading the changelog with an admin's eye: what counts as breaking (config schema, migration with no rollback, federation behavior change), what doesn't (UI, bug fixes, performance)
- The upgrade ritual: take a backup *first* (see [backups](./backups)), pull the new image, run `bin/deploy.sh` in upgrade mode, watch the migration logs, verify with `/health`
- Pinning the image tag for predictable production deploys vs. tracking `main` on staging
- Rolling back: switch the image tag back, restart, restore the database from the pre-upgrade backup if migrations changed the schema. Why "just downgrade the container" rarely works if migrations ran
- The "I upgraded and something broke" debugging path before you reach for rollback
- Major-version upgrades when they happen — read the migration guide, take two backups, do it in staging first
