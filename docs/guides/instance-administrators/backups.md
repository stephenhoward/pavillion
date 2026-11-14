---
description: Back up a Pavillion instance — database, media, secrets, config — and test the restore before you need it.
---

# Backups

A backup you haven't tested isn't a backup. This is the most-skipped piece of admin work and the one that determines whether a server failure is an inconvenience or a community-rebuilding exercise.

Pavillion backs up one thing on its own: the PostgreSQL database. Everything else — media, secrets, your config — is yours to copy somewhere safe. This guide covers all four, and the drill that proves the database backup works.

## What to back up

In order of importance:

| What | Where it lives | Who backs it up |
|---|---|---|
| The PostgreSQL database | Docker volume `pavillion-db` | Pavillion makes nightly dumps; **you** move them off the server |
| `.env` and `secrets/` | The checkout directory (`/opt/pavillion` if you used `bin/provision.sh`) | You |
| `config/local.yaml` and your reverse-proxy config | The checkout directory (`Caddyfile`, `caddy-extras.d/` for the bundled Caddy) | You |
| Media (event images, avatars) | Docker volume `pavillion-media`, or your S3 bucket | You |

Pavillion's own backup system runs `pg_dump` and nothing else. It produces no media archive and does not copy your secrets or config.

## The database

### What Pavillion does for you

The `worker` container runs `pg_dump` in custom format (`-Fc`) every night at 02:00 by default (`housekeeping.backup.schedule`) and writes a file named like `pavillion_20260315_020000_scheduled.dump` to the `pavillion-backups` volume (`/backups` inside the worker). `docker-compose.yml` binds that volume to `/opt/pavillion/backups` on the host, so the dumps are ordinary files you can see and copy.

Old dumps are pruned on a grandfather-father-son schedule: by default 7 daily, 4 weekly (Sundays) and 6 monthly (the 1st of the month) are kept. The schedule, the retention counts and the path are the `housekeeping.backup.*` keys in `config/default.yaml`; override them in `config/local.yaml`.

Run the commands below from the Pavillion directory. `scripts/backup.sh` runs the Pavillion CLI inside a container. It looks for one named `pavillion-app-1` unless you set `PAVILLION_CONTAINER`, and the container in the shipped `docker-compose.yml` is named `pavillion-app`, so set the variable:

```bash
export PAVILLION_CONTAINER=pavillion-app
./scripts/backup.sh create    # queue a backup now; the worker performs it
./scripts/backup.sh list      # every backup Pavillion knows about
./scripts/backup.sh status    # storage use, last backup, retention, last restore drill
```

`create` only queues the job. Check `list` or `status` for the result.

### "Verified" is a low bar

`list` and `status` show a Verified column. It means the dump file exists and is at least 1 KB. It does not mean the dump restores. Only a [restore drill](#the-restore-drill) proves that.

### Get the dumps off the server

The dumps live on the same machine as the database they protect. A failed disk takes both. Copy `/opt/pavillion/backups` somewhere else on a schedule, using whatever you already trust: `rsync` or `scp` to another host, your provider's snapshot feature on the backup directory, or an object-storage sync tool. Pavillion does not do this for you. The `housekeeping.backup.s3` block in `config/default.yaml` is commented out and the code only logs that S3 upload is not implemented, so don't count on it.

Some guidance that isn't about tooling:

- Not on the same disk as the instance, and not in the same region if your provider is your only redundancy.
- Encrypted at rest. A dump is your whole community's data, including account email addresses and the private keys your calendars sign federation traffic with. Treat it like the secrets below.
- Frequency follows how fast events get created. For most community instances the nightly dump plus a nightly copy is enough. If losing a day of edits would be painful, copy more often, or run `./scripts/backup.sh create` before risky changes like upgrades.

## Secrets and config

A restored database is not enough on its own. Back these up from the Pavillion directory:

- `.env`: your secrets and settings (mode 600).
- `secrets/`: the same secrets as files, which the containers read as Docker secrets.
- `.deploy-state`: records which secrets have ever been provisioned. `bin/deploy.sh` uses it on upgrade to tell a new secret from a lost one.
- `config/local.yaml`: your instance-specific configuration.
- Your reverse-proxy configuration: `Caddyfile` and `caddy-extras.d/` if you use the bundled Caddy, or your own proxy's config otherwise. See [Reverse proxy and TLS](./reverse-proxy-and-tls).

Keep these in a password manager or an encrypted store, never in the same place as the database dumps. Together they are everything someone needs to impersonate your instance.

### What each secret does if you lose it

The deploy manifest (`bin/deploy-manifest.tsv`) classifies each secret. Losing one is not equally bad:

| Secret | If lost or replaced |
|---|---|
| `DB_PASSWORD` | Must match the password the existing database volume was created with. A new value won't unlock the old volume. |
| `ENCRYPTION_KEY` | Funding provider API keys (your Stripe keys), stored encrypted in the database, can no longer be decrypted. Re-enter them in the admin settings. |
| `JWT_SECRET` | Everyone is logged out. |
| `SESSION_SECRET` | All browser sessions are invalidated. |
| `EMAIL_HASH_SECRET` | Existing hashes of reporter emails and IPs stop matching: blocked reporters, email rate limits and report-pattern history reset. |
| `CALENDAR_IMPORT_HMAC_SECRET` | Only pending ICS-import verification challenges are invalidated. `bin/deploy.sh` regenerates it. |

If you use S3 for media, `S3_ACCESS_KEY` and `S3_SECRET_KEY` are in the same place; keep them with the rest. Federation signing keys are not in `.env` at all. They are stored in the database (the `calendar_actor` table has a `private_key` column), so the database dump carries your federation identity. That is one more reason to encrypt the dumps.

So the recovery posture for "I have the database backup but lost the secrets" is: you can't use the old `DB_PASSWORD` against the old volume, but a dump restores into a new database under any password you choose; users log back in; you re-enter payment provider keys; moderation hash history resets. Without the dump the secrets are worth little. Without the secrets the dump is recoverable, with the losses in the table. Back up both.

## Media

Media is **not** in the database dump, and Pavillion does not archive it.

- **Local storage (the default).** Uploads live in the `pavillion-media` Docker volume, mounted at `/app/storage/media` in the app container. Snapshot it, or copy it with `rsync` or `tar` from a throwaway container that mounts the volume. For many instances a weekly copy is enough: lost media is annoying, but the events themselves are in the database.
- **S3-compatible storage.** If `media.storage.driver` is `s3` in `config/local.yaml`, the files are in your bucket, not on the server. Use your provider's versioning or replication; Pavillion does nothing to back the bucket up. In that case there is no media volume to copy. See [Media storage](./media-storage).

Restore the media before you start the app, or images will be broken until you do. The database holds the references; the files themselves come back only from your media backup.

## The restore drill

The first time you try to restore should not be the day after a disk failure. `scripts/restore-drill.sh` proves a dump can be restored without touching your live database.

```bash
./scripts/restore-drill.sh                      # drill the newest dump
./scripts/restore-drill.sh pavillion_20260315_020000_scheduled.dump   # a specific one
./scripts/restore-drill.sh --help
```

It restores the dump into a throwaway Postgres container with no network access and the backup volume mounted read-only, then checks that:

- the Pavillion tables are present,
- the applied migrations match the migration files in this checkout, and
- the core tables (`account`, `calendar`, `event`) are not empty.

It prints row counts, then deletes the container. The drill needs Docker on the host. By default it reads the `pavillion-backups` volume; set `PAVILLION_BACKUP_DIR` to point it at a directory of dumps instead, for example a copy you pulled back from off-site storage, which also tests that copy. It uses the `postgres:17` image to match the deployed database; override with `PAVILLION_DRILL_IMAGE` if you changed that.

When it finishes it records the outcome in your database, through the app container, using the same `PAVILLION_CONTAINER` variable as above. `./scripts/backup.sh status` then shows the last successful drill. If the app container isn't running the result isn't recorded, but the verdict is unaffected. Don't call `backup record-drill` yourself; a hand-entered row would claim a drill passed when none did.

Exit codes: `0` all checks passed; `1` a check failed or something was missing; `3` the checks passed but the scratch container couldn't be removed and is still holding an unencrypted copy of your database, so remove the container named in the warning by hand.

Run it after setting up your backups, and again after upgrades and every few months. The drill covers the database only. It says nothing about your media or secrets.

## Restoring for real

Pavillion ships a restore command, with limits:

```bash
PAVILLION_CONTAINER=pavillion-worker ./scripts/backup.sh restore <backup-id>
```

It runs `pg_restore -c` against the configured database after a confirmation prompt. `-c` drops existing objects first, so **all current data is replaced**. Restart the app afterward. Two limits to know about:

- It looks the backup up by ID in the database it is about to replace, so it works for rolling back a running instance, not for recovering onto an empty server where that record doesn't exist.
- It reads the dump from the backup directory, which only the `worker` container mounts, hence the `pavillion-worker` above. The default `pavillion-app` container can't see the files. This guide has not exercised it against a live deployment, so try it on a copy before you rely on it.

To recover onto a fresh server, the repository does not ship a procedure. The outline, using plain PostgreSQL tooling:

1. Install Pavillion on the new server (see the [Quickstart](./quickstart)), but put your backed-up `.env`, `secrets/` and `config/local.yaml` in place first, so the app comes up with your original secrets rather than newly generated ones.
2. Start only the `db` service and wait for it to be healthy.
3. Restore the dump into the database, with the app and worker stopped. The drill's check on migrations is a good model: the dump and the code version should match, so check out the same Pavillion version that produced the dump.
4. Restore your media.
5. Start everything and verify you can log in and see events.

Do this at least once, on a spare machine, before you need it.

## Related

- [Monitoring and logs](./monitoring-and-logs) covers the metrics that report when the last verified backup finished and how full the backup disk is, so you hear about a failing backup before you need one.
- [Quickstart](./quickstart) generates the secrets files this guide tells you to protect.
- [Media storage](./media-storage) covers choosing local versus S3 storage.
