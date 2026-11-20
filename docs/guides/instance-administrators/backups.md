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

Run the commands below from the Pavillion directory; [Run a backup by hand](#run-a-backup-by-hand) lists them all:

```bash
./scripts/backup.sh create    # queue a backup now; the worker performs it
./scripts/backup.sh list      # every backup Pavillion knows about
./scripts/backup.sh status    # storage use, last backup, retention, last restore drill
```

`create` only queues the job. Check `list` or `status` for the result.

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

Both scripts run the Pavillion CLI inside the `pavillion-worker` container, the only one that can see the backup files. Set `PAVILLION_CONTAINER` to point them at a different container.

`restore` replaces the current database: everything written since that backup is gone. It asks you to confirm first, and it needs a terminal to ask in, so it refuses input piped from another command or a script. It rolls a running instance back to an earlier backup; it does not recover a lost server or an empty database. For those, see [Restoring for real](#restoring-for-real).

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

The restore drill answers one question: if you had to restore your newest database backup today, would it work?

Run it from the Pavillion directory once a month, and again after any upgrade:

```bash
cd /opt/pavillion
./scripts/restore-drill.sh
```

You can run it on the production server while the instance is busy. The throwaway database the drill restores into has no network access, so it can't reach your real database even by mistake, and it mounts the backups read-only. It's removed when the drill ends, whether the drill passed, failed or was interrupted, and if removing it fails, the drill tells you [how to remove it yourself](#if-the-drill-leaves-its-container-behind). The one thing the drill writes to your live database is a single row recording that it ran and what it found.

### What the drill does

The drill picks the newest of the [nightly dumps](#what-pavillion-does-for-you), starts a throwaway database in its own container, restores the dump into it, and checks three things about the result:

- **Schema present.** The tables every Pavillion database has are there: accounts, calendars, events, and the record of which upgrades have been applied.
- **Migrations consistent.** The backup was taken from the same version of Pavillion as the code on this server. Every upgrade that changes the database ships a *migration*, and the drill compares the backup's list of applied migrations with the `migrations/` folder in `/opt/pavillion`.
- **Core tables non-empty.** The backup holds at least one account, one calendar and one event.

Then it prints row counts, deletes the throwaway container, and records the result. A pass ends like this:

```
Checking the restored database...
  PASS  schema present
  PASS  migrations consistent (52 migrations)
  PASS  core tables non-empty

Row counts:
  account      14
  calendar     9
  event        1203

RESTORE DRILL PASSED for pavillion_20261101_020000_scheduled.dump

Note: this drill covers the database only. Pavillion's backup system
runs pg_dump and produces no media archive, so media backup remains
an operator-owned volume snapshot and is not verified here.
```

Read the row counts as well as the verdict. If you know your instance has around a thousand events and the drill restored twelve, the drill passed and your backup is still wrong.

### What a pass does not tell you

A passing drill means your newest database backup is a complete backup of this instance, and it restores. It doesn't mean you can survive losing the server, and it says nothing about your images.

**It is not a disaster-recovery test.** The drill runs on the server it protects, using the dumps on that server's disk, and a server that dies usually takes its disk with it. The drill doesn't use your [off-host copy](#copy-backups-off-the-server) unless you point it there, and it doesn't use the `.env` file and `secrets/` folder a rebuilt server needs, set up a new machine, or move your domain's DNS. The rehearsal that covers those is the fresh-server recovery in [Restoring for real](#restoring-for-real), run on a spare machine.

**It does not check media.** Pavillion's automatic backups are database-only, and the drill never looks at the [media](#media) volume or bucket. A drill on a server whose media has never been backed up passes every month until the disk fails, and then you have every event and none of the pictures.

### Two commands that look alike

`scripts/backup.sh` also has a `restore` command. It is not the drill, and running it by mistake replaces your live database.

| | `./scripts/restore-drill.sh` | `./scripts/backup.sh restore <backup-id>` |
|---|---|---|
| What it restores into | A throwaway database it creates and deletes | **Your live database** |
| Your instance's data | Untouched | **Deleted and replaced** with the backup's contents |
| When to run it | Monthly, and after upgrades | Only when you are recovering from a loss |
| What it takes | Nothing, or a backup's filename | A backup's ID from `./scripts/backup.sh list` |

The restore command asks you to confirm once, then drops and recreates every table in the backup. Anything written to the instance since that backup was taken is gone: new events, new accounts, federation activity. If you want to know whether your backup works, run the drill.

### Drilling a different backup

To drill a specific backup instead of the newest, pass its filename:

```bash
./scripts/restore-drill.sh pavillion_20261025_020000_scheduled.dump
```

Give the filename only. The drill refuses a path. To see the filenames, list the backups through the worker container:

```bash
docker compose exec worker ls -1 /backups
```

To drill a dump that lives somewhere else, such as one you pulled back from your [off-host copy](#restoring-from-the-bucket), point `PAVILLION_BACKUP_DIR` at the folder holding it, as an absolute path. That also tests the copy:

```bash
PAVILLION_BACKUP_DIR=/home/you/restored-backups ./scripts/restore-drill.sh
```

The drill compares the dump with the `migrations/` folder of the checkout you run it from, so on another machine, run it from a Pavillion checkout at the version that made the dump.

`./scripts/restore-drill.sh --help` lists every setting the drill reads. Two others matter on some servers:

- `PAVILLION_DRILL_IMAGE` is the database image the throwaway container runs, `postgres:17` by default. It must match the `db` service in your `docker-compose.yml`. If you've changed that, set this to the same image.
- `PAVILLION_CONTAINER` is the app container the drill records its result through. It's the same variable `backup.sh` reads, so set it to `pavillion-app` as described in [What Pavillion does for you](#what-pavillion-does-for-you). If it's unset, the drill looks for a container named `pavillion-app-1`, finds none, and warns that the app container isn't running.

### When to run it

**Once your first backup exists.** Until a drill passes, nothing has shown that your backups restore.

**Monthly.** Nothing runs the drill for you. Put it on a calendar, or have your monitor alert when `pavillion_restore_drill_last_success_timestamp_seconds` is more than a month old (see [Monitoring and logs](./monitoring-and-logs)).

**After every upgrade that changes the database.** Unless the release notes say otherwise, assume every upgrade does. Wait for the first backup taken *after* the upgrade before you drill: the next nightly backup, or one you start yourself with `./scripts/backup.sh create` and see appear in `./scripts/backup.sh list`. A backup taken before the upgrade fails the migrations check, correctly: the upgraded code can't run that database without migrating it again.

### When did it last pass?

Each drill records its result in your instance's database. To see the most recent pass:

```bash
./scripts/backup.sh status
```

The status report has a section for it:

```
Last Successful Restore Drill:
  Date: 2026-11-01 04:12:09
  Restored backup: pavillion_20261101_020000_scheduled.dump
  ("Verified" on a backup means its file was written; only a drill proves it restores)
```

If it says *No successful restore drill recorded*, no backup on this instance has ever been shown to restore. Fix that first.

This section shows passes only. A failed drill is recorded too, but the drill's own output at the time is where to read why it failed.

If the app container isn't running when the drill finishes, the drill warns that the result wasn't recorded. The verdict it printed still stands. Don't run `backup record-drill` yourself: a row entered by hand would claim a drill passed when none did.

### Reading a failure

A failed drill means one of two things: something is wrong with the backup, or something on the server stopped the drill from testing it. Work out which first. The messages below are grouped that way.

When the backup restores but fails a check, the drill runs the remaining checks too, and ends with a line naming every check that failed:

```
RESTORE DRILL FAILED: 2 check(s) failed: migrations consistent core tables non-empty
```

#### The backup doesn't restore

```
FAIL: pg_restore could not restore pavillion_20261101_020000_scheduled.dump into the scratch database.
      The dump is corrupt, truncated, or not a pg_dump -Fc archive.
      pg_restore reported:
        pg_restore: error: input file does not appear to be a valid archive (too short?)
```

This is the failure the drill exists to catch. That backup file can't be restored, and on the day you need it, it won't be.

Drill the backup before it by name. If the older one passes, the problem is that one file. The most common cause is the backup disk filling up partway through writing it, so check the free space in `./scripts/backup.sh status`. If every recent backup fails the same way, the nightly backup job itself is broken, and the worker's log is the place to look: `docker compose logs worker`.

Some error lines end in `[redacted]`. That's deliberate. A database error can quote the contents of the row it failed on, and the drill's output often ends up in a log file or a support request, so the drill keeps the operation and the table name and cuts the rest. The output names tables and counts, never what's in a row, so it's safe to paste into a support request.

#### The backup restores but isn't what you think it is

```
FAIL: restored schema is missing expected tables: SequelizeMeta account calendar event
```

The file restored, but it isn't a full backup of a Pavillion database. Either it's a backup of some other database, or it holds only part of one. If you set `PAVILLION_BACKUP_DIR`, check that it points at the folder you meant.

```
FAIL: core tables are empty or unreadable in the restored database: event
      An empty event table in a live instance's backup means the
      dump does not hold the data the operator expects.
```

The backup holds a Pavillion database with nothing in that table: a backup of a different instance, or one taken right after a reinstall. Compare the row counts with what you know is on your instance.

On a brand-new instance with no events yet, `event` is empty and this check fails. Once your first event is in a nightly backup, it passes.

#### The backup and the code disagree about the version

The migrations check fails in one of two directions, and the drill tells you which.

```
FAIL: migration mismatch between the dump and migrations/
      Applied in migrations/ but absent from the dump (dump predates this checkout):
        0052_add_source_fingerprint_to_event_import_origin.ts
```

**The backup is older than the code.** If you've just upgraded, that's expected: the backup was taken before the upgrade. Take a fresh one and drill again (see [When to run it](#when-to-run-it)). If you *haven't* upgraded recently, look at the date of the last backup in `./scripts/backup.sh status`. Backups that stopped running weeks ago look like this too.

```
FAIL: migration mismatch between the dump and migrations/
      Present in the dump but absent from migrations/ (dump is newer than this checkout):
        0053_add_some_newer_feature.ts
```

**The backup is newer than the code.** Restoring it on this server would quietly take your database back a version. The usual cause is the server: the code in `/opt/pavillion` is behind the version you're running. Run `git status` and `git log -1` in `/opt/pavillion` and bring the checkout up to date before you conclude anything about the backup.

#### The drill couldn't test a backup at all

These messages say nothing about your backups. Fix the cause and run the drill again.

- **`Error: no backup files found in the backup source.`** Either no backup has ever been taken, or the drill is looking in the wrong place. `./scripts/backup.sh status` shows the last backup. If there isn't one, the worker isn't taking them. If there is, check `PAVILLION_BACKUP_DIR` or `PAVILLION_BACKUP_VOLUME`, if you set either.
- **`Error: backup file not found in the backup source: <name>`** The filename you passed is misspelled, or the retention schedule has since deleted that backup.
- **`Error: PAVILLION_BACKUP_VOLUME must be a docker volume name, not a path`** You set the volume setting to a folder, usually `/opt/pavillion/backups`. Use `PAVILLION_BACKUP_DIR` for a folder.
- **`FAIL: could not start the scratch database container.`** or **`Error: docker is not on PATH.`** Docker isn't running, the database image couldn't be downloaded, or your user can't run Docker commands.
- **`FAIL: the scratch database did not accept connections within 90s.`** The server is slow or busy. Run the drill again with a longer wait, for example `PAVILLION_DRILL_TIMEOUT=300 ./scripts/restore-drill.sh`. The drill refuses a wait over 3600 seconds, because the throwaway container holds a full copy of your database for as long as it waits.

### If the drill leaves its container behind

```
WARNING: the drill container pavillion-restore-drill-41827-20311 could not be removed.
         It still holds a full copy of the restored database. Remove it with:
           docker rm -fv pavillion-restore-drill-41827-20311
```

Run the command it gives you, now. The container is a running database holding an unencrypted copy of everything on your instance, and it stays there until you remove it.

If every check passed, the drill still says `RESTORE DRILL PASSED` and the backup is fine. It exits with code 3 instead of 0, so that a script watching the exit code doesn't record a clean pass while the container is still running.

If you interrupt the drill with Ctrl-C, it removes its container before it stops, and warns you if it couldn't. To check that nothing was left behind:

```bash
docker ps -a --filter name=pavillion-restore-drill
```

If it prints only the column headings, nothing is left.

### Exit codes

For anyone running the drill from a script or monitor:

| Code | Meaning |
|---|---|
| `0` | Every check passed and the throwaway container was removed |
| `1` | A check failed, or the drill couldn't run; the reason is in the error output |
| `3` | Every check passed, but the throwaway container couldn't be removed and needs removing by hand |
| `130` | Interrupted. The drill tried to clean up; read the error output to learn whether it did |

### Things that trip people up

**`ls /opt/pavillion/backups` says *Permission denied*.** The folder belongs to the user the containers run as, uid 1001, which is the `pavillion` user if you used `bin/provision.sh`. Logged in as anyone else, it looks as if your backups are missing. The drill reads them through Docker, so it doesn't need that access, and `docker compose exec worker ls -1 /backups` lists them.

**Drilling the morning after an upgrade.** The newest backup is from before the upgrade, so the migrations check fails. Nothing is wrong with your backups. Wait for the next one.

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
