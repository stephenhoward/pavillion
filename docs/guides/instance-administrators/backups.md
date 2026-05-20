---
description: Back up a Pavillion instance — database, media, secrets, config — and test the restore before you need it.
---

# Backups

> Status: placeholder. This guide will be written before launch.

A backup you haven't tested isn't a backup. This is the most-skipped piece of admin work and the one that determines whether a server failure is an inconvenience or a community-rebuilding exercise.

## Planned scope

- What to back up, in order of importance: the PostgreSQL database (everything irreplaceable), the media volume or S3 bucket (event images and avatars), `.env` and `secrets/` (without these the restored database is encrypted noise), `config/local.yaml`, your reverse-proxy config
- How to back up each piece: `pg_dump` for the database, volume snapshots or rsync for media, copying the secrets to a password manager
- Where to store backups: not on the same disk as the instance, not in the same region if your provider is your only redundancy, encrypted at rest
- How often: depends on the rate at which events get created. For most community instances, nightly database, weekly media. Higher-volume instances should think harder
- The restore drill: stand up a fresh server, restore from backup, verify you can log in and see events. Do this *before* you need it. The first time you try to restore should not be the day after a disk failure
- The "I lost the secrets but I have the database backup" recovery posture — what's recoverable, what isn't, and why your password manager matters
