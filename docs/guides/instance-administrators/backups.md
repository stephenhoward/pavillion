---
description: Back up a Pavillion instance — database, media, secrets, config — and test the restore before you need it.
---

# Backups

Backups are the most-skipped piece of admin work and the one that determines whether a server failure is an inconvenience or a community-rebuilding exercise.

Pavillion backs up one thing on its own: the PostgreSQL database. Everything else — media, secrets, your config — is yours to copy somewhere safe. This guide covers all four, and describes the drill that proves the database backup works.

## What to back up

In order of importance:

| What | Where it lives | Who backs it up |
|---|---|---|
| The PostgreSQL database | Docker volume `pavillion-db` | Pavillion makes nightly dumps automatically; **you** get them off the server, with the [off-host copy](#copy-backups-off-the-server) or your own tool |
| `.env` and `secrets/` | The checkout directory (`/opt/pavillion` if you used `bin/provision.sh`) | You |
| `config/local.yaml` and your reverse-proxy config | The checkout directory (`Caddyfile`, `caddy-extras.d/` for the bundled Caddy) | You |
| Media (event images, avatars) | Docker volume `pavillion-media`, or your S3 bucket | You |

Pavillion's own backup system runs `pg_dump` and, if you set it up, copies each dump to an off-site bucket. It produces no media archive and does not copy your secrets or config.

## The database

### What Pavillion does for you

The `worker` container runs `pg_dump` in custom format (`-Fc`) every night at 02:00 by default (`housekeeping.backup.schedule`) and writes a file named like `pavillion_20260315_020000_scheduled.dump` to the `pavillion-backups` volume (`/backups` inside the worker). `docker-compose.yml` binds that volume to `/opt/pavillion/backups` on the host, so the dumps are ordinary files you can see and copy.

Old dumps are pruned on a grandparent-parent-child schedule: by default 7 daily, 4 weekly (Sundays) and 6 monthly (the 1st of the month) are kept. The schedule, the retention counts and the path are the `housekeeping.backup.*` keys in `config/default.yaml`; override them in `config/local.yaml`.

To make a backup now, or to see the ones Pavillion has made, use the commands in [Run a backup by hand](#run-a-backup-by-hand).

### "Verified" is a low bar

`list` and `status` show a Verified column. It means the dump file exists and is at least 1 KB. It does not mean the dump restores. Only a [restore drill](#the-restore-drill) proves that.

### Get the dumps off the server

The dumps live on the same machine as the database they protect. A failed disk takes both. You have two ways to get them somewhere else:

- **Let the worker do it.** Give Pavillion a bucket on an object-storage service and it uploads each verified dump right after writing it. That's the off-host copy, set up in [Copy backups off the server](#copy-backups-off-the-server) below.
- **Use what you already know.** `rsync` or `scp` to another host, your provider's snapshot feature on `/opt/pavillion/backups`, or an object-storage sync tool, on a schedule.

Either works. The off-host copy has nothing to schedule and nothing to forget, and with the bucket settings below it survives someone breaking into the server, not just the server dying. A tool you already run for other machines is fine if it gives you the same safety.

Some guidance that isn't about tooling:

- Not on the same disk as the instance, and not in the same region if your provider is your only redundancy.
- Encrypted at rest. A dump is your whole community's data, including account email addresses and the private keys your calendars sign federation traffic with. Treat it like the secrets below.
- Frequency follows how fast events get created. For most community instances the nightly dump plus a nightly copy is enough. If losing a day of edits would be painful, copy more often, or run `./scripts/backup.sh create` before risky changes like upgrades.

## Run a backup by hand

Run these from the Pavillion directory (`/opt/pavillion` if you used `bin/provision.sh`):

```bash
./scripts/backup.sh create          # queue a backup now; the worker performs it
./scripts/backup.sh list            # every backup Pavillion knows about, with its ID
./scripts/backup.sh status          # storage use, last backup, retention, last restore drill
./scripts/backup.sh restore <id>    # replace the database with backup <id>
./scripts/housekeeping.sh           # scheduled jobs, their settings and next run times
```

`create` only queues the job. Check `list` or `status` for the result.

`scripts/backup.sh` and `scripts/housekeeping.sh` run the Pavillion CLI inside the `pavillion-worker` container, the only one that can see the backup files. Set `PAVILLION_CONTAINER` to point them at a different container. If you followed an earlier version of this guide, which had you export `PAVILLION_CONTAINER=pavillion-app`, run `unset PAVILLION_CONTAINER` and remove that line from your shell profile: the app container can't see the backup files, so a restore sent there fails.

`restore` replaces the current database: everything written since that backup is gone. Before it does, it names the database and host it will replace and asks you to confirm; check that they are this instance's before you answer. It needs a terminal to ask in, so it refuses input piped from another command or a script. Afterward, restart the app with `docker compose restart app`. It rolls a running instance back to an earlier backup; it does not recover a lost server or an empty database. For those, see [Restoring for real](#restoring-for-real).

## Copy backups off the server

This section is for an admin who has never set up object storage. By the end, every dump the worker writes also lands in a bucket somewhere else, under a key that can add files but not delete them, and you'll have seen one arrive.

Object storage is a service that keeps files ("objects") in named containers ("buckets") and lets you reach them over HTTPS. Amazon S3 is the original. Many providers offer the same interface ("S3-compatible"), and the off-host copy should work with any S3-compatible service. Whichever you choose must offer every one of the [required bucket settings](#required-bucket-settings) below; check that before you sign up. Pick one that isn't the company hosting your server, or at least not the same data center, so that one account problem or one outage can't take both copies.

### What leaves your server

The dump is the whole database: everything Pavillion stores, not only the examples here. That includes every account's email address and password hash, moderation reports and the hashed reporter emails and IPs kept with them, the funding provider credentials you entered in the admin settings (stored encrypted, with the key in your `.env`), the private keys your calendars and user actors sign federation traffic with, and what your instance knows about other servers: followers, followed calendars and the remote actors behind them. Anyone who can read the bucket can read all of that.

Pavillion does not encrypt the dump before uploading it. There is no client-side encryption option. The protection comes from the bucket settings below and from who holds the keys to read it, so don't skip them.

### Create the bucket

The steps are the same on every provider:

1. Create a bucket. Choose a region that suits your community's data: if your members are in the EU, keep the bucket in the EU. Name it something you'll recognize, like `riverbend-pavillion-backups`.
2. Apply the [required bucket settings](#required-bucket-settings).
3. Create a [write-only key](#a-write-only-key) for the server, and a separate read key for restores that never goes on the server.

**Worked example: AWS S3.** In the S3 console, create a bucket in your chosen region. Leave **Block all public access** on, which is the default for new buckets. Under **Bucket Versioning**, choose **Enable**. Under **Advanced settings**, enable **Object Lock** now if you want it, in compliance mode (see [Versioning or Object Lock](#versioning-or-object-lock)). Default encryption (SSE-S3) is already on for new AWS buckets. Create the bucket, then add the lifecycle rule from the next section under **Management**.

On any other provider, look for the same settings under similar names, and note the endpoint URL your provider gives for the bucket's region. You'll set it as `BACKUP_S3_ENDPOINT`. On AWS leave it empty.

### Required bucket settings

All four, not a selection:

- **Block all public access.** The bucket is never served to anyone. If your provider has a "public" or "CDN" toggle, it stays off.
- **Server-side encryption on.** The provider encrypts objects on its disks. This protects against a lost drive at the provider, not against someone holding a read key, which is why the keys matter.
- **Versioning, with expiry of noncurrent versions, or Object Lock.** A write-only key can't delete, but it can overwrite: uploading a new file under an existing name replaces it. Versioning keeps the replaced file as an older version that the write-only key can't touch. Without versioning or Object Lock, someone who breaks into your server can overwrite every copy with junk, and the copy only protects you against losing the server, not against losing control of it. All of this assumes the server's key can't delete; see [A write-only key](#a-write-only-key) for what changes when it can.
- **A lifecycle rule that expires backups.** Expire objects under the `pavillion-backups/` prefix after 180 days, which matches the default local retention of six monthly backups. With versioning on, also expire noncurrent versions after 60 days and remove expired delete markers.

::: tip <Lightbulb /> A note on remote retention.
Pavillion never deletes anything from the bucket, and the local pruning schedule (7 daily, 4 weekly, 6 monthly) doesn't apply to it. That's deliberate. If the server's key could delete remote copies, a break-in on the server, or a bug in pruning, could destroy both copies at once. So expiry is the bucket's job. Without the lifecycle rule, every nightly dump is kept forever, and so is the data of every account deleted since.
:::

### Versioning or Object Lock

Both stop an overwrite from destroying a backup. Versioning keeps the overwritten object as a noncurrent version for as long as your noncurrent-version rule allows. Object Lock goes further and refuses to remove an object until its retention period ends.

- **Versioning** is enough for most instances, provided the server's key can't delete. The noncurrent-version expiry, 60 days in the lifecycle rule above, must be longer than the longest time an overwrite could go unnoticed. 60 days covers checking the bucket monthly; if you check less often, raise it, and raise it everywhere this guide uses the figure.
- **Object Lock in compliance mode** is for an instance that wants protection even against someone who gets hold of your provider account, and it is required when the server's key can delete. On AWS, turn it on when you create the bucket; that's the simple path, and some providers allow it only then. Set a default retention shorter than your 180-day expiry, such as 30 days.

Object Lock comes in two modes, and only one holds against everyone. **Compliance mode** refuses removal by anyone, including the account owner, until retention ends, and its retention period can't be shortened once set: a longer period keeps backups past the expiry you chose, with no way to undo it. **Governance mode** can be bypassed by any user or key with the right permission, so it doesn't protect against someone who gets hold of such a key. Wherever this guide says Object Lock, it means compliance mode.

### A write-only key

The key you put on the server should be able to add backups and do nothing else: not list the bucket, not read a backup, not delete one. On AWS, create an IAM user (for example `pavillion-backup-writer`), attach this policy with your bucket name in place of `<bucket>`, and create an access key for it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::<bucket>/pavillion-backups/*"
    }
  ]
}
```

AWS shows the secret once. Copy the access key ID and the secret now.

Create a second key that can read the bucket, for restores, and keep it off the server, in your password manager. The write-only key can't download anything, by design.

Not every provider can make a key this narrow. Before you rely on one, check whether your provider can make a key that can upload but not delete. If it can't, two things change:

- Versioning no longer protects you. A key that can delete objects can usually delete their older versions too, so someone who breaks into the server can remove every copy. Only Object Lock in compliance mode still holds. If your provider has no compliance-mode Object Lock, choose another provider.
- The server's key can then usually read every remote backup as well, so a break-in on the server also exposes every dump in the bucket, not just the one on disk.

### Set the variables

The off-host copy is on when `BACKUP_S3_BUCKET` is set, and off when it's empty. There's no separate switch. These variables are read by the worker only, and are separate from the `S3_*` variables for [media storage](./media-storage), even if both point at the same provider.

Add the non-secret settings to `.env`:

```bash
BACKUP_S3_BUCKET=riverbend-pavillion-backups
BACKUP_S3_REGION=eu-central-1
BACKUP_S3_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
# BACKUP_S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com   # S3-compatible providers only
```

Put the secret in a file rather than in `.env`. A value passed as a plain `BACKUP_S3_SECRET_KEY` variable shows up in `docker inspect pavillion-worker` to anyone who can run Docker commands on the host. A file mounted as a Docker secret doesn't. Write the secret into `secrets/`:

```bash
cd /opt/pavillion
read -rs BACKUP_SECRET            # paste the secret, then press Enter; nothing is shown
printf '%s' "$BACKUP_SECRET" > secrets/backup_s3_secret_key.txt
unset BACKUP_SECRET
chmod 600 secrets/backup_s3_secret_key.txt
```

Reading the secret into a variable keeps it out of your shell history, which a secret typed on the command line would land in.

The file must be readable by the user the containers run as, uid 1001. If you used `bin/provision.sh` and ran the commands above as its `pavillion` user, which has uid 1001, it already is. Otherwise run `sudo chown 1001 secrets/backup_s3_secret_key.txt`. If the worker can't read the file, it exits at startup, which stops local backups too, not just the copy.

Then mount it on the worker, and only the worker, with a `docker-compose.override.yml` in the checkout. If you already have one (for example from [Monitoring and logs](./monitoring-and-logs)), add these entries to it:

```yaml
services:
  worker:
    environment:
      - BACKUP_S3_SECRET_KEY_FILE=/run/secrets/backup_s3_secret_key
    secrets:
      - backup_s3_secret_key

secrets:
  backup_s3_secret_key:
    file: ./secrets/backup_s3_secret_key.txt
```

```bash
echo docker-compose.override.yml >> .git/info/exclude
```

The last line keeps `./bin/deploy.sh` from treating the override as an uncommitted change. Skip it if the file is already excluded.

Set both the access key and the secret, or neither. One without the other is a configuration error. If the path in `BACKUP_S3_SECRET_KEY_FILE` is wrong, the worker logs `Secret file not found` at startup and carries on with an empty secret, which is that same error.

::: tip <Lightbulb /> A note on leaving the keys out.
With neither key set, the worker uses whatever credentials its environment provides, the same way the AWS command-line tool does. That's useful on an AWS server with an instance role. Anywhere else, set the keys: with a custom endpoint and no keys, the worker could sign requests to that provider with credentials meant for something else.
:::

### Check the setup

1. Recreate the worker so it picks up the new settings, and check that it stayed up:

   ```bash
   docker compose up -d worker
   docker compose ps worker
   ```

   If `ps` shows the worker restarting or exited, read `docker compose logs worker`. An unreadable secret file is the usual cause; see the ownership note above.

2. Look for the startup line:

   ```bash
   docker compose logs worker | grep 'Off-host'
   ```

   You want `Off-host backup copy enabled`, with your bucket, the endpoint host (`AWS` when no endpoint is set) and the credential source: `static keys` if you set them. If you see `Off-host backup copy is misconfigured; copies will fail`, the `configError` field on that line says what to fix. No line at all means `BACKUP_S3_BUCKET` didn't reach the worker.

3. Make a backup now:

   ```bash
   ./scripts/backup.sh create
   ```

4. Wait for `Manual backup completed` in the worker log. The upload happens before that line, so once it appears the copy is either in the bucket or has failed.
5. Open the bucket in your provider's console, using your read access, not the server's key. You should see `pavillion-backups/pavillion_<date>_<time>_manual.dump`, the same size as the file in `/opt/pavillion/backups`.

From then on, every backup the worker makes, the nightly one and any you queue by hand, is copied the same way. A dump that fails the "verified" check isn't copied.

### What a failure looks like

A failed copy never fails the backup. The local dump is kept and recorded as usual, the failure is logged, and the next backup is copied as usual. The failed one is not tried again; if you want it in the bucket, copy it by hand or run `./scripts/backup.sh create`.

For now, failures appear only in the worker log. There is no email and no admin-panel warning, so check the log or the bucket now and then. Search for the exact message:

```bash
docker compose logs worker | grep 'Off-host backup copy failed'
```

The line carries the file name, the bucket, the endpoint host and the provider's error name, code, HTTP status and message. Just before it you may see `An error was encountered in a non-retryable streaming request.` That line comes from the storage library, describes the same failure, and isn't a second problem.

Common causes:

- **`AccessDenied`, 403.** The key's policy doesn't allow `s3:PutObject` on `pavillion-backups/*` in this bucket, or the bucket name or region is wrong.
- **`BadDigest`, 400.** The bytes the provider received didn't match the dump, so it refused the copy and kept nothing corrupt. The next backup is copied as usual. If every copy fails this way, something between the server and the provider is altering uploads, such as a proxy, or the provider mishandles the `Content-MD5` check the worker sends with each upload.
- **A timeout.** The worker gives up on a connection after 10 seconds, on an upload that goes quiet for a minute, and on any upload still running after 45 minutes. The whole backup job, dump and copy together, has an hour. A dump that can't upload in 45 minutes on your connection needs a closer region or a faster uplink.
- **An endpoint that isn't https.** Plain `http://` is refused, except for `localhost` and `127.0.0.1`, which are there for testing. That also rules out a MinIO container next to Pavillion, at `http://minio:9000`: a copy on the same server isn't an off-host copy.

### Restoring from the bucket

A copy in the bucket restores only together with your `.env` and `secrets/`, and those must be kept somewhere other than the server, such as your password manager. If the server is gone and they were only on it, the dump still restores, with the losses described in [What each secret does if you lose it](#what-each-secret-does-if-you-lose-it).

To restore, download the dump with your read key, from a machine that isn't the server:

```bash
aws s3 cp s3://riverbend-pavillion-backups/pavillion-backups/pavillion_20260315_020000_scheduled.dump ./restore/
```

(Add `--endpoint-url` for an S3-compatible provider.) From there it's an ordinary dump. Run the [restore drill](#the-restore-drill) against it, which proves the copy restores, then follow [Restoring for real](#restoring-for-real). `PAVILLION_BACKUP_DIR` must be an absolute path:

```bash
PAVILLION_BACKUP_DIR="$PWD/restore" ./scripts/restore-drill.sh
```

#### Restoring after a suspected compromise

If someone may have had the server's key, don't trust the newest object under a name. The write-only key can't read or delete, but it can overwrite a dump with another file under the same name, or upload new files with plausible names. A restore runs the dump's SQL against your database, so a planted dump is not harmless.

1. List every version under the prefix, with your read key:

   ```bash
   aws s3api list-object-versions --bucket riverbend-pavillion-backups --prefix pavillion-backups/
   ```

2. Pick a version whose `LastModified` is before the earliest time the server could have been compromised. Ignore files whose names or times don't match the backup schedule.
3. Download that exact version:

   ```bash
   aws s3api get-object --bucket riverbend-pavillion-backups \
     --key pavillion-backups/pavillion_20260315_020000_scheduled.dump \
     --version-id <VersionId> ./restore/pavillion_20260315_020000_scheduled.dump
   ```

4. If you still have the server's backup listing (`./scripts/backup.sh list`) or a copy of `/opt/pavillion/backups`, compare the file's size with the one recorded there.
5. Run the restore drill against it, as above, before restoring for real.

This works only with versioning or Object Lock on, which is one more reason they're required.

### Deleted accounts

When an account is deleted, its data stays in every backup made before the deletion, local and remote, until those backups expire. Restoring an old dump brings the account back. With the lifecycle rule above, a deleted account is gone from the bucket after at most 180 days plus the 60-day noncurrent-version window, about eight months, plus any Object Lock retention still running and up to about a day while the provider applies the rule. If someone asks when their data is fully gone, that's the honest answer, and if you restore an old dump, delete again any accounts that had been deleted since it was made.

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

It prints row counts, then deletes the container. The drill needs Docker on the host. By default it reads the `pavillion-backups` volume; set `PAVILLION_BACKUP_DIR` to point it at a directory of dumps instead, for example a dump you pulled back from your off-host copy, which also tests that copy. It uses the `postgres:17` image to match the deployed database; override with `PAVILLION_DRILL_IMAGE` if you changed that.

When it finishes it records the outcome in your database, through the `pavillion-worker` container, like the other scripts; set `PAVILLION_CONTAINER` to point it at a different container. `./scripts/backup.sh status` then shows the last successful drill. If the worker isn't running the result isn't recorded, but the verdict is unaffected. Don't call `backup record-drill` yourself; a hand-entered row would claim a drill passed when none did.

Exit codes: `0` all checks passed; `1` a check failed or something was missing; `3` the checks passed but the scratch container couldn't be removed and is still holding an unencrypted copy of your database, so remove the container named in the warning by hand.

Run it after setting up your backups, and again after upgrades and every few months. The drill covers the database only. It says nothing about your media or secrets.

## Restoring for real

Pavillion ships a restore command, with limits:

```bash
./scripts/backup.sh restore <backup-id>
```

It runs `pg_restore -c` against the configured database after a confirmation prompt. `-c` drops existing objects first, so **all current data is replaced**. Restart the app afterward. Two limits to know about:

- It looks the backup up by ID in the database it is about to replace, so it works for rolling back a running instance, not for recovering onto an empty server where that record doesn't exist.
- It reads the dump from the backup directory, which only the `worker` container mounts, so don't point `PAVILLION_CONTAINER` at the app container for a restore. This guide has not exercised it against a live deployment, so try it on a copy before you rely on it.

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
