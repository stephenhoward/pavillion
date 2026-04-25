# Upgrading Pavillion

This guide covers upgrading your Pavillion instance to new versions.

## The Only Upgrade Command

```bash
bin/deploy.sh
```

Run this from your Pavillion checkout. The script is idempotent: it is safe
to run at any time, whether you have changes to apply or not.

`bin/deploy.sh` handles every step of upgrade:

1. Checks that your working tree is clean.
2. Runs `git pull` to fetch the latest code and configuration changes.
3. Reads `bin/deploy-manifest.yaml` to learn what secrets the new version
   requires.
4. Compares against your `.env`. Silently generates any missing
   **regenerable** secrets. Prompts you to paste (or regenerate) any
   missing **stable** secrets.
5. Runs `docker compose pull` to fetch the new image.
6. Runs `docker compose up -d` to start (or restart) containers.
7. Polls `http://localhost:3000/health` until the app responds or the
   timeout expires.
8. Reports success or failure.

## Pre-Upgrade Checklist

Before running `bin/deploy.sh` for a major upgrade:

### 1. Review release notes

Read the [release notes](https://github.com/stephenhoward/pavillion/releases)
for breaking changes, new configuration options, or deprecations.

### 2. Back up your database

Backups are not automated. Run a `pg_dump` before any major upgrade:

```bash
docker compose exec db pg_dump -U pavillion pavillion > \
  backup-pre-upgrade-$(date +%Y%m%d-%H%M%S).sql
```

If you use local media storage (not S3), back up the media volume too:

```bash
docker run --rm -v pavillion-media:/data -v "$(pwd):/backup" alpine \
  tar czf /backup/media-backup-$(date +%Y%m%d).tar.gz -C /data .
```

## Flags

```
bin/deploy.sh --help
```

| Flag | Purpose |
|---|---|
| `--non-interactive` | Do not prompt. Fail fast if a `stable` secret is missing. |
| `--skip-git-pull` | Skip the `git pull` step (for local development). |
| `--domain=<value>` | Supply domain for non-interactive first install. Ignored on upgrade. |
| `--health-timeout=<seconds>` | Override the `/health` poll timeout (default 120s). |

## What happens when a new version adds a required secret

Every required secret is declared in `bin/deploy-manifest.yaml`, tagged
as either `regenerable` or `stable`. The script also tracks every secret
ever provisioned on this instance in `.deploy-state` (per-instance, not
in version control). On upgrade:

- **A new secret is introduced this version** (its name is in the
  manifest but not in `.deploy-state`): the script silently generates
  it, regardless of stability. You couldn't have it; the script gives
  you one. This is the normal path for upgrades that add a new required
  secret.

- **A `regenerable` secret is missing** (was previously provisioned but
  is no longer in `.env`): silently regenerated. The associated feature
  reissues whatever tokens it had — pending DNS verifications get new
  challenges, for example. No cross-system impact.

- **A `stable` secret is missing AND was previously provisioned** (it's
  in `.deploy-state` but not in `.env` — admin lost it): the script
  prompts you (interactive) or exits with a clear error
  (non-interactive). Regenerating a stable secret has real impact
  (invalidated sessions, broken decryption, re-anonymized moderation
  reports); the script requires you to acknowledge the impact or paste
  the existing value from your password manager.

The staging webhook calls `bin/deploy.sh --non-interactive`. Because new
secrets auto-generate on upgrade, the only situation that requires
interactive intervention is recovering a previously-provisioned `stable`
secret that's gone missing — which is a rare manual-recovery scenario,
not a normal upgrade.

### One-time migration for installs that predate `bin/deploy.sh`

If `.deploy-state` is absent on first run of `bin/deploy.sh`, the script
seeds it from the contents of your `.env`. Every secret name currently
defined in `.env` is recorded as previously-provisioned, so subsequent
upgrades that touch existing secrets get the right behavior.

## Rollback

`bin/deploy.sh` does not automate rollback. If an upgrade fails:

1. Stop the containers:

   ```bash
   docker compose down
   ```

2. Restore your database backup (see step 2 of the pre-upgrade checklist).

3. Pin the previous image version in `docker-compose.yml`:

   ```yaml
   services:
     app:
       image: ghcr.io/stephenhoward/pavillion:v1.1.0  # previous version
   ```

4. Start with the previous version:

   ```bash
   docker compose up -d
   ```

5. Verify: `curl http://localhost:3000/health`.

## Troubleshooting

### "Working tree is not clean"

The script requires a clean working tree to run `git pull`. Options:

- Commit or stash your local changes, then re-run.
- Pass `--skip-git-pull` to skip the pull and proceed with what's on disk.

### "Secret X is missing (stable, non-interactive mode)"

A new version added a required `stable` secret that is not in your
`.env`. Options:

- Re-run interactively: `bin/deploy.sh` (without `--non-interactive`).
  The script will prompt you to paste the value or generate a new one.
- Or manually: generate with `openssl rand -base64 32`, append
  `X=<value>` to `.env`, and re-run.

### Health check timed out

The containers started but `/health` did not respond within the timeout.
Check `docker compose logs app` for errors. Common causes: migration
failure, database connection issue, missing configuration in
`config/local.yaml`.

## Getting Help

If you encounter issues:

1. Check the [troubleshooting section](#troubleshooting).
2. Search [existing issues](https://github.com/stephenhoward/pavillion/issues).
3. Open a new issue with:
   - Current version and target version
   - Full output from `bin/deploy.sh` (with secrets redacted)
   - Your `config/local.yaml` (secrets redacted)
