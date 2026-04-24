# Pavillion Deploy Script Design

> Created: 2026-04-24
> Status: Approved — pending implementation plan
> Precedes: feat/ics-import-foundation-pv-1qcp (the ICS branch that prompted this work)

## Problem

An instance admin who upgrades with the standard `docker compose pull && docker compose up -d` flow gets a broken install when a new version introduces a required secret. The production startup validator (`src/server/common/helper/production-validation.ts`) hard-fails with a clear message, but by then the admin is in a crash loop and must manually: find the message, generate the secret, edit `.env`, confirm `docker-compose.yml` plumbs the variable into the container, and restart.

This already happened latently for `EMAIL_HASH_SECRET` and `ENCRYPTION_KEY` — nobody noticed because Pavillion is pre-launch and there were no upgraders. The ICS import branch adds a sixth required secret (`CALENDAR_IMPORT_HMAC_SECRET`) and makes the same trap visible again.

The concern is not this one secret. The concern is that every new required secret introduced post-launch will strand every admin who upgrades, unless we commit to an upgrade path that handles the transition.

## Constraints

- Pavillion is pre-launch (roadmap Phase 1, Launch Readiness). The right moment to set the policy is now, before the first external admin deploys.
- The staging server already has a deploy script (`docker/staging/deploy.sh`) — a thin wrapper around `pull && up -d && prune`. Any solution should generalize that wrapper rather than exist alongside it.
- The existing hard-fail at startup (`validateProductionSecrets`) is good and should remain as a backstop. The design adds a preflight layer; it does not weaken the runtime check.
- Admins clone the Pavillion repo on initial install. They keep that clone up to date. The tool can assume a checkout exists and git operations are available.

## Policy

**One supported upgrade path: `bin/deploy.sh`.**

`docker compose pull && docker compose up -d` is explicitly unsupported. `docs/upgrading.md` is rewritten around `bin/deploy.sh`, the "Quick Start" in `docs/deployment.md` uses it, and the staging webhook calls it. Admins who skip the script hit the existing hard-fail at runtime — a strictly-worse experience, but the script is always available as the recovery path.

**Secret classification lives in a manifest file**, not in code. Every new required secret lands with a manifest entry, and CI enforces that the manifest stays in sync with the plumbing.

**Classification rubric:** secrets are `stable` (must be preserved once generated; regeneration has real user-visible impact) or `regenerable` (loss only resets the feature that uses them; no cross-system impact). First install generates everything; upgrade only prompts when a `stable` secret goes missing.

## Design

### `bin/deploy.sh`

The single command an admin runs for install, upgrade, or redeploy. Idempotent — running it with nothing to do is a no-op.

**Execution steps:**

1. **Detect mode** — `install` if `.env` is absent, `upgrade` if present.
2. **Safety checks** — working tree clean (for `git pull`); not running as root unless explicitly allowed; expected files present.
3. **Git pull** — `upgrade` mode only. Skipped if `--skip-git-pull` is passed. Aborts if the pull would create a merge conflict (admin must resolve manually).
4. **Read manifest** — `bin/deploy-manifest.yaml` (see below).
5. **Diff against `.env`** — compute the set of secrets the manifest requires but `.env` does not provide.
6. **Resolve missing secrets** — per-entry behavior keyed on `stability`:
   - `regenerable` missing → generate via the entry's `generator`, append to `.env`, write to `secrets/<name>.txt` with mode 600.
   - `stable` missing and interactive → prompt: paste value, type `GENERATE` to accept the documented impact, or abort.
   - `stable` missing and non-interactive → exit non-zero with a structured error (secret name, one-line description, manifest URL).
7. **First-install only** — prompt for domain (or require `--domain=<value>` in non-interactive mode), copy `config/local.yaml.example` to `config/local.yaml`, substitute domain.
8. **`docker compose pull`** — get the new images.
9. **`docker compose up -d`** — start (or restart) containers.
10. **Poll `/health`** — wait up to `DEPLOY_HEALTH_TIMEOUT` (default 120s) for `curl http://localhost:${APP_PORT:-3000}/health` to return 200. Tail `docker compose logs app` on timeout.
11. **Report** — print a clear success or failure summary.

**Flags:**

- `--non-interactive` — force non-interactive mode (also assumed when stdin is not a TTY).
- `--skip-git-pull` — skip step 3 (for local development on a dirty working tree, or CI contexts).
- `--domain=<value>` — supply domain for non-interactive first install. Ignored on upgrade (domain is already set in `config/local.yaml`).
- `--health-timeout=<seconds>` — override the `/health` poll timeout.

**Exit codes:**

- `0` — success (including "nothing to do").
- `1` — generic failure.
- `2` — missing `stable` secret in non-interactive mode (actionable; admin must provide it).
- `3` — safety check failed (dirty working tree, wrong directory, etc.).
- `4` — `docker compose up -d` succeeded but `/health` did not return 200 within the timeout.

### `bin/deploy-manifest.yaml`

The source of truth for what an operator must have in `.env` for the current checkout to boot.

```yaml
# Pavillion Deploy Manifest
#
# Each entry declares a secret the operator must have set for this checkout
# to boot. New secrets are added in the same PR that introduces the
# production validation requiring them.
#
# Fields:
#   name         — environment variable name
#   generator    — symbolic name for the secret generator. Currently
#                  supported: openssl_rand_base64_32, openssl_rand_hex_32.
#                  Mapped to concrete shell commands inside bin/deploy.sh.
#   stability    — "stable" or "regenerable" (see rubric below)
#   description  — one-line summary of what this secret protects and what
#                  happens if it is lost or rotated
#
# Stability rubric:
#   stable       — value must be preserved once generated. Regeneration has
#                  user-visible or data-visible impact (e.g., invalidated
#                  sessions, broken decryption, re-anonymized reports).
#                  First install generates it; upgrade prompts if missing.
#   regenerable  — value can be regenerated safely at any time. Loss only
#                  resets the feature that uses it (e.g., invalidates
#                  pending verification tokens). Upgrade silently generates.

secrets:
  - name: JWT_SECRET
    generator: openssl_rand_base64_32
    stability: stable
    description: Signs API authentication tokens. Rotation logs out all users.

  - name: SESSION_SECRET
    generator: openssl_rand_base64_32
    stability: stable
    description: Signs browser session cookies. Rotation invalidates all sessions.

  - name: DB_PASSWORD
    generator: openssl_rand_base64_32
    stability: stable
    description: PostgreSQL password. Must match the existing database volume.

  - name: EMAIL_HASH_SECRET
    generator: openssl_rand_base64_32
    stability: stable
    description: Hashes reporter emails for moderation. Rotation de-anonymizes prior reports.

  - name: ENCRYPTION_KEY
    generator: openssl_rand_hex_32
    stability: stable
    description: Encrypts funding provider API keys at rest. Rotation breaks decryption of stored keys.
```

The ICS branch adds `CALENDAR_IMPORT_HMAC_SECRET` with `stability: regenerable` alongside its existing production-validation change. That is the first `regenerable` entry and the first end-to-end exercise of the manifest-driven upgrade flow.

### CI lint

A new check (`bin/check-manifest.sh`, invoked from `.github/workflows/pr.ci.yaml` — either added to an existing step or as a dedicated job) verifies that every manifest entry is also wired into:

1. `config/custom-environment-variables.yaml` — env → config key binding exists for the secret.
2. `docker-compose.yml` — the secret appears in both the `app` and `worker` `environment:` blocks, and a matching `_FILE` entry is present.
3. `bin/entrypoint.sh` — the secret appears in the `file_env` list.
4. `src/server/common/helper/production-validation.ts` — the secret is referenced and has a hard-fail check.

The lint fails the CI build if any of those is missing. This closes the "added a secret but forgot to wire it" loop that caused this design effort in the first place.

Implementation: grep-based for speed (no YAML parser required beyond reading the manifest). The manifest is the input; the four target files are searched for the secret's `name` field. Clear error messages identify which plumbing is missing.

### Consolidation: `bin/setup.sh`

`bin/setup.sh` is retired. It is replaced with a stub that prints a deprecation message and suggests `bin/deploy.sh`. Its generation logic moves into `bin/deploy.sh`'s first-install branch.

Rationale: two entry points with overlapping responsibilities is a maintenance trap. One tool with mode detection is the story the docs tell; the code should match.

### Staging webhook integration

`docker/staging/deploy.sh` becomes:

```bash
#!/bin/bash
set -euo pipefail
cd /opt/pavillion
exec bin/deploy.sh --non-interactive --domain=staging.pavillion.events
```

The `flock`-based concurrency guard from the current staging script stays (moved into `bin/deploy.sh` or kept in the wrapper — implementation choice). `docker/staging/README.md` is updated to reflect the new call path.

### Related documentation changes

- `docs/upgrading.md` — rewritten around `bin/deploy.sh`. The "Standard Upgrade Process" section becomes a single step. The step-by-step section becomes a description of what `bin/deploy.sh` does, not what the admin types.
- `docs/deployment.md` — "Quick Start (5-Minute Deployment)" uses `bin/deploy.sh`. The "Step-by-Step First Deployment" section is shortened to reflect the single command.
- `docs/configuration.md` — references to `bin/setup.sh` become `bin/deploy.sh`.
- `docs/secret-rotation.md` — note that `bin/deploy.sh` handles "secret went missing after upgrade," but rotation itself remains a manual operator procedure (stop, edit, restart).
- `validateProductionSecrets` error messages — point to `bin/deploy.sh` instead of `bin/setup.sh`.

## Scope

### In scope for this PR (lands before the ICS branch)

- `bin/deploy.sh`
- `bin/deploy-manifest.yaml` with the five current secrets
- `bin/check-manifest.sh` + CI lint job
- `bin/setup.sh` retired to a deprecation stub
- `docker/staging/deploy.sh` rewritten
- Documentation rewrites enumerated above
- Error-message updates in `validateProductionSecrets`

### Deferred (explicit non-goals)

- Automatic pre-upgrade DB backup. `docs/upgrading.md` continues to recommend it manually.
- Automatic rollback on failed `up -d`. The script reports failure and leaves the admin to recover.
- Migration preview / dry-run.
- Drift detection for `config/default.yaml` → `config/local.yaml` additions (beyond the secret manifest).
- Handling `docker-compose.override.yml` conflicts during `git pull`.
- Auto-rotation tooling for `stable` secrets.

### Follow-up work enabled by this PR

- The ICS import branch adds a `regenerable` manifest entry for `CALENDAR_IMPORT_HMAC_SECRET`, wires the env var through `docker-compose.yml` and `entrypoint.sh`, and benefits from the CI lint catching any missed plumbing.
- Future features that introduce required secrets land one manifest entry in the same PR. The CI lint enforces wiring in all four places.

## Open questions (resolved)

- **Runtime vs preflight:** preflight wins. Runtime stays as backstop.
- **One tool or two (setup + upgrade):** one tool, mode detection.
- **Who does `git pull`:** the script does, in upgrade mode, with a skip flag.
- **Where classification lives:** manifest file, not code.
- **CI enforcement:** included in v1.
- **Script name:** `bin/deploy.sh` (neutral for install, upgrade, redeploy).
- **Field name for classification:** `stability: stable | regenerable` (enum leaves room for a third tier).

## Success criteria

1. An admin can run `git clone && cd pavillion && bin/deploy.sh` and get a working instance from a clean machine.
2. An admin can run `bin/deploy.sh` on an existing install after pulling the ICS branch, and the new `CALENDAR_IMPORT_HMAC_SECRET` is generated silently — no crash loop, no manual editing.
3. The staging webhook calls `bin/deploy.sh --non-interactive` and works for every upgrade that does not add a `stable` secret.
4. A PR that adds a new required secret without updating all four plumbing locations is rejected by CI with a clear message.
5. The old `docker compose pull && docker compose up -d` path continues to work for releases that don't add a new secret, and hard-fails with an actionable error for releases that do. The admin's escape hatch is always `bin/deploy.sh`.
