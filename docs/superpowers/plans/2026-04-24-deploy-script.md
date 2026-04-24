# Pavillion Deploy Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `bin/deploy.sh` as Pavillion's single entry point for install/upgrade, backed by a secret manifest and a CI lint that keeps the manifest in sync with runtime plumbing. Replaces `bin/setup.sh`, replaces `docker/staging/deploy.sh`, rewrites admin-facing docs.

**Architecture:** Bash scripts only — no new runtime dependencies for hosts. The manifest is a flat YAML file parsed by awk. The deploy script is idempotent: install and upgrade are two modes of one script, distinguished by `.env` presence. The CI lint verifies that every manifest entry is wired into four plumbing files (env-vars yaml, docker-compose, entrypoint, production-validation).

**Tech Stack:** bash (host), awk/sed/grep (parsing), openssl (secret generation), docker compose (runtime), GitHub Actions (CI).

**Design reference:** `docs/superpowers/specs/2026-04-24-deploy-script-design.md`

**Branch:** `deploy-script-design` (rooted at `origin/main`). This PR must merge **before** `feat/ics-import-foundation-pv-1qcp`, so that the ICS branch can add its `CALENDAR_IMPORT_HMAC_SECRET` entry to the manifest.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `bin/deploy.sh` | Single entry point. Mode detection, manifest diff, secret resolution, git pull, docker compose pull/up, `/health` polling. |
| `bin/deploy-manifest.yaml` | Source of truth for required secrets. Flat YAML list. Updated by PRs that add new required secrets. |
| `bin/check-manifest.sh` | CI lint. Reads manifest; verifies each secret is wired into the four plumbing files. |
| `bin/lib/manifest.sh` | Shared helper: parse the manifest into pipe-delimited records. Sourced by both `deploy.sh` and `check-manifest.sh`. |
| `bin/test/lib.sh` | Shared test helpers (`assert_eq`, `assert_contains`, temp-dir setup). |
| `bin/test/manifest_test.sh` | Tests for `lib/manifest.sh`. |
| `bin/test/check_manifest_test.sh` | Tests for `check-manifest.sh`. |
| `bin/test/deploy_test.sh` | Tests for `deploy.sh`. |
| `bin/test/fixtures/` | YAML/env/plumbing fixtures used by tests. |
| `.github/workflows/manifest_lint.yaml` | Reusable workflow that runs `bin/check-manifest.sh`. |

**Modified files:**

| Path | Change |
|---|---|
| `.github/workflows/pr.ci.yaml` | Add `manifest_lint` job. |
| `bin/setup.sh` | Replace body with deprecation stub that calls `bin/deploy.sh`. |
| `docker/staging/deploy.sh` | Replace body with one-liner invoking `bin/deploy.sh --non-interactive`. |
| `docker/staging/README.md` | Update to reflect new call path. |
| `src/server/common/helper/production-validation.ts` | Error messages reference `bin/deploy.sh` instead of `bin/setup.sh`. |
| `docs/upgrading.md` | Rewrite around `bin/deploy.sh`. |
| `docs/deployment.md` | Quick Start uses `bin/deploy.sh`. |
| `docs/configuration.md` | Update references to setup script. |
| `docs/secret-rotation.md` | Note that `bin/deploy.sh` handles missing-secret-on-upgrade; rotation remains manual. |
| `README.md` | If it references `bin/setup.sh`, update to `bin/deploy.sh`. |

---

## Testing Strategy

Bash tests live in `bin/test/*_test.sh`. Each test script:
- Sources `bin/test/lib.sh` for helpers (`assert_eq`, `assert_contains`, `fail`).
- Uses `set -euo pipefail`.
- Exits 0 on success, non-zero on failure.
- Creates a temp dir with `mktemp -d` and cleans up via `trap`.

No external test framework is introduced — the project has no existing bash testing convention, and bash test frameworks (bats-core) add install friction without proportional value for this small surface.

Test scripts are invoked directly: `./bin/test/manifest_test.sh`. A small runner (`bin/test/run.sh`) runs all `*_test.sh` files and reports aggregate results. The CI job for manifest lint also runs `bin/test/run.sh` so regressions in helpers are caught.

---

## Task 1: Create the deploy manifest

**Files:**
- Create: `bin/deploy-manifest.yaml`

- [ ] **Step 1: Create the manifest file**

Create `bin/deploy-manifest.yaml`:

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

- [ ] **Step 2: Verify the file**

Run: `cat bin/deploy-manifest.yaml | head -5`
Expected: First lines match the header comment.

Run: `grep -c "^  - name:" bin/deploy-manifest.yaml`
Expected: `5`

- [ ] **Step 3: Add `.deploy-state` to .gitignore**

Read the current `.gitignore`:

Run: `cat .gitignore`

Append a section for the deploy-state file (use a heredoc to match existing style):

```bash
cat >> .gitignore <<'EOF'

# Per-instance deploy state managed by bin/deploy.sh
# Lists secrets ever provisioned on this instance. Not for version control.
.deploy-state
EOF
```

Verify:

Run: `grep -n "deploy-state" .gitignore`
Expected: a single line: `.deploy-state`.

- [ ] **Step 4: Commit**

```bash
git add bin/deploy-manifest.yaml .gitignore
git commit -m "feat(deploy): add deploy manifest and .deploy-state gitignore entry"
```

---

## Task 2: Manifest parser helper + tests

**Files:**
- Create: `bin/lib/manifest.sh`
- Create: `bin/test/lib.sh`
- Create: `bin/test/manifest_test.sh`
- Create: `bin/test/fixtures/manifest_basic.yaml`
- Create: `bin/test/fixtures/manifest_mixed.yaml`

- [ ] **Step 1: Write shared test helpers**

Create `bin/test/lib.sh`:

```bash
#!/usr/bin/env bash
# Shared test helpers. Source this file from *_test.sh scripts.
# Tests increment _FAILS on failure; test scripts exit with that count.

_FAILS=0
_TESTS=0

assert_eq() {
  # assert_eq <expected> <actual> <message>
  local expected="$1"
  local actual="$2"
  local msg="${3:-assertion}"
  _TESTS=$((_TESTS+1))
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS: ${msg}"
  else
    echo "  FAIL: ${msg}"
    echo "    expected: ${expected}"
    echo "    actual:   ${actual}"
    _FAILS=$((_FAILS+1))
  fi
}

assert_contains() {
  # assert_contains <haystack> <needle> <message>
  local haystack="$1"
  local needle="$2"
  local msg="${3:-assertion}"
  _TESTS=$((_TESTS+1))
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "  PASS: ${msg}"
  else
    echo "  FAIL: ${msg}"
    echo "    haystack: ${haystack}"
    echo "    needle:   ${needle}"
    _FAILS=$((_FAILS+1))
  fi
}

assert_exit_code() {
  # assert_exit_code <expected_code> <actual_code> <message>
  local expected="$1"
  local actual="$2"
  local msg="${3:-assertion}"
  _TESTS=$((_TESTS+1))
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS: ${msg}"
  else
    echo "  FAIL: ${msg} (expected exit ${expected}, got ${actual})"
    _FAILS=$((_FAILS+1))
  fi
}

report_results() {
  echo ""
  echo "Results: $((_TESTS - _FAILS))/${_TESTS} passed"
  exit "$_FAILS"
}

mktemp_dir() {
  # Create temp dir and register cleanup.
  local dir
  dir=$(mktemp -d)
  trap "rm -rf '${dir}'" EXIT
  echo "$dir"
}
```

- [ ] **Step 2: Write failing parser tests**

Create `bin/test/fixtures/manifest_basic.yaml`:

```yaml
secrets:
  - name: ONE_SECRET
    generator: openssl_rand_base64_32
    stability: stable
    description: First secret.
```

Create `bin/test/fixtures/manifest_mixed.yaml`:

```yaml
secrets:
  - name: ALPHA
    generator: openssl_rand_base64_32
    stability: stable
    description: Alpha secret.

  - name: BETA
    generator: openssl_rand_hex_32
    stability: regenerable
    description: Beta secret.
```

Create `bin/test/manifest_test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"
source "${SCRIPT_DIR}/../lib/manifest.sh"

FIXTURES="${SCRIPT_DIR}/fixtures"

echo "manifest_test.sh"

echo "test: parse_manifest reads a single entry"
out=$(parse_manifest "${FIXTURES}/manifest_basic.yaml")
assert_eq "ONE_SECRET|openssl_rand_base64_32|stable|First secret." "$out" "single entry as pipe-delimited record"

echo "test: parse_manifest reads multiple entries"
out=$(parse_manifest "${FIXTURES}/manifest_mixed.yaml")
expected="ALPHA|openssl_rand_base64_32|stable|Alpha secret.
BETA|openssl_rand_hex_32|regenerable|Beta secret."
assert_eq "$expected" "$out" "two entries separated by newlines"

echo "test: manifest_names lists just names"
out=$(manifest_names "${FIXTURES}/manifest_mixed.yaml")
expected="ALPHA
BETA"
assert_eq "$expected" "$out" "names only, one per line"

echo "test: manifest_field reads a named field"
out=$(manifest_field "${FIXTURES}/manifest_mixed.yaml" "BETA" "stability")
assert_eq "regenerable" "$out" "stability field of BETA entry"

out=$(manifest_field "${FIXTURES}/manifest_mixed.yaml" "ALPHA" "generator")
assert_eq "openssl_rand_base64_32" "$out" "generator field of ALPHA entry"

report_results
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `chmod +x bin/test/*.sh && bash bin/test/manifest_test.sh`
Expected: FAIL with "bin/lib/manifest.sh: No such file or directory"

- [ ] **Step 4: Implement the parser**

Create `bin/lib/manifest.sh`:

```bash
#!/usr/bin/env bash
# Manifest parser helpers. Source from deploy.sh and check-manifest.sh.
#
# The manifest schema is flat and controlled — each entry is exactly four
# fields at fixed indentation. That lets us parse with awk instead of
# bringing in a YAML library.

# parse_manifest <path> -> stdout: one pipe-delimited record per entry
#   name|generator|stability|description
parse_manifest() {
  local path="$1"
  awk '
    BEGIN { name=""; generator=""; stability=""; description="" }

    function emit() {
      if (name != "") {
        print name "|" generator "|" stability "|" description
      }
      name=""; generator=""; stability=""; description=""
    }

    /^  - name:[[:space:]]+/ {
      emit()
      sub(/^  - name:[[:space:]]+/, "")
      name=$0
      next
    }
    /^    generator:[[:space:]]+/ {
      sub(/^    generator:[[:space:]]+/, "")
      generator=$0
      next
    }
    /^    stability:[[:space:]]+/ {
      sub(/^    stability:[[:space:]]+/, "")
      stability=$0
      next
    }
    /^    description:[[:space:]]+/ {
      sub(/^    description:[[:space:]]+/, "")
      description=$0
      next
    }

    END { emit() }
  ' "$path"
}

# manifest_names <path> -> stdout: one secret name per line
manifest_names() {
  parse_manifest "$1" | cut -d'|' -f1
}

# manifest_field <path> <name> <field> -> stdout: the field value
#   field ∈ { generator, stability, description }
manifest_field() {
  local path="$1"
  local wanted="$2"
  local field="$3"
  local col
  case "$field" in
    generator)   col=2 ;;
    stability)   col=3 ;;
    description) col=4 ;;
    *) echo "manifest_field: unknown field '${field}'" >&2; return 1 ;;
  esac
  parse_manifest "$path" | awk -F'|' -v want="$wanted" -v c="$col" '$1 == want { print $c }'
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bash bin/test/manifest_test.sh`
Expected: All 5 assertions PASS, exit 0.

- [ ] **Step 6: Verify the real manifest parses cleanly**

Run: `source bin/lib/manifest.sh && manifest_names bin/deploy-manifest.yaml`
Expected:
```
JWT_SECRET
SESSION_SECRET
DB_PASSWORD
EMAIL_HASH_SECRET
ENCRYPTION_KEY
```

- [ ] **Step 7: Commit**

```bash
git add bin/lib/manifest.sh bin/test/lib.sh bin/test/manifest_test.sh bin/test/fixtures/
git commit -m "feat(deploy): add manifest parser with tests"
```

---

## Task 3: check-manifest.sh — CI lint

**Files:**
- Create: `bin/check-manifest.sh`
- Create: `bin/test/check_manifest_test.sh`
- Create: `bin/test/fixtures/plumbing_complete/` (with four files)
- Create: `bin/test/fixtures/plumbing_missing_envvars/`
- Create: `bin/test/fixtures/plumbing_missing_compose/`
- Create: `bin/test/fixtures/plumbing_missing_entrypoint/`
- Create: `bin/test/fixtures/plumbing_missing_validator/`

- [ ] **Step 1: Write fixture: complete plumbing**

Create `bin/test/fixtures/plumbing_complete/custom-environment-variables.yaml`:

```yaml
jwt:
  secret: JWT_SECRET
session:
  secret: SESSION_SECRET
```

Create `bin/test/fixtures/plumbing_complete/docker-compose.yml`:

```yaml
services:
  app:
    environment:
      - JWT_SECRET=${JWT_SECRET:-}
      - SESSION_SECRET=${SESSION_SECRET:-}
      - JWT_SECRET_FILE=${JWT_SECRET_FILE:-}
      - SESSION_SECRET_FILE=${SESSION_SECRET_FILE:-}
  worker:
    environment:
      - JWT_SECRET=${JWT_SECRET:-}
      - SESSION_SECRET=${SESSION_SECRET:-}
      - JWT_SECRET_FILE=${JWT_SECRET_FILE:-}
      - SESSION_SECRET_FILE=${SESSION_SECRET_FILE:-}
```

Create `bin/test/fixtures/plumbing_complete/entrypoint.sh`:

```bash
#!/bin/bash
file_env 'JWT_SECRET'
file_env 'SESSION_SECRET'
```

Create `bin/test/fixtures/plumbing_complete/production-validation.ts`:

```typescript
export function validateProductionSecrets(): void {
  const jwt = config.get('jwt.secret');
  const session = config.get('session.secret');
  if (!jwt) throw new Error('JWT_SECRET must be set');
  if (!session) throw new Error('SESSION_SECRET must be set');
}
```

Create `bin/test/fixtures/plumbing_complete/manifest.yaml`:

```yaml
secrets:
  - name: JWT_SECRET
    generator: openssl_rand_base64_32
    stability: stable
    description: Signs API tokens.

  - name: SESSION_SECRET
    generator: openssl_rand_base64_32
    stability: stable
    description: Signs cookies.
```

- [ ] **Step 2: Write fixtures for each missing-plumbing case**

For each of the four missing cases, copy `plumbing_complete/` and delete/omit one reference. Use these exact commands:

```bash
mkdir -p bin/test/fixtures/plumbing_missing_envvars
cp bin/test/fixtures/plumbing_complete/{docker-compose.yml,entrypoint.sh,production-validation.ts,manifest.yaml} bin/test/fixtures/plumbing_missing_envvars/
# Omit JWT_SECRET from custom-environment-variables.yaml:
cat > bin/test/fixtures/plumbing_missing_envvars/custom-environment-variables.yaml <<'EOF'
session:
  secret: SESSION_SECRET
EOF

mkdir -p bin/test/fixtures/plumbing_missing_compose
cp bin/test/fixtures/plumbing_complete/{custom-environment-variables.yaml,entrypoint.sh,production-validation.ts,manifest.yaml} bin/test/fixtures/plumbing_missing_compose/
# Omit JWT_SECRET from app environment (remove two lines):
cat > bin/test/fixtures/plumbing_missing_compose/docker-compose.yml <<'EOF'
services:
  app:
    environment:
      - SESSION_SECRET=${SESSION_SECRET:-}
      - SESSION_SECRET_FILE=${SESSION_SECRET_FILE:-}
  worker:
    environment:
      - JWT_SECRET=${JWT_SECRET:-}
      - SESSION_SECRET=${SESSION_SECRET:-}
      - JWT_SECRET_FILE=${JWT_SECRET_FILE:-}
      - SESSION_SECRET_FILE=${SESSION_SECRET_FILE:-}
EOF

mkdir -p bin/test/fixtures/plumbing_missing_entrypoint
cp bin/test/fixtures/plumbing_complete/{custom-environment-variables.yaml,docker-compose.yml,production-validation.ts,manifest.yaml} bin/test/fixtures/plumbing_missing_entrypoint/
cat > bin/test/fixtures/plumbing_missing_entrypoint/entrypoint.sh <<'EOF'
#!/bin/bash
file_env 'SESSION_SECRET'
EOF

mkdir -p bin/test/fixtures/plumbing_missing_validator
cp bin/test/fixtures/plumbing_complete/{custom-environment-variables.yaml,docker-compose.yml,entrypoint.sh,manifest.yaml} bin/test/fixtures/plumbing_missing_validator/
cat > bin/test/fixtures/plumbing_missing_validator/production-validation.ts <<'EOF'
export function validateProductionSecrets(): void {
  const session = config.get('session.secret');
  if (!session) throw new Error('SESSION_SECRET must be set');
}
EOF
```

- [ ] **Step 3: Write failing check-manifest tests**

Create `bin/test/check_manifest_test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

CHECKER="${SCRIPT_DIR}/../check-manifest.sh"
FIXTURES="${SCRIPT_DIR}/fixtures"

echo "check_manifest_test.sh"

run_check() {
  local fixture_dir="$1"
  "${CHECKER}" \
    --manifest="${fixture_dir}/manifest.yaml" \
    --envvars="${fixture_dir}/custom-environment-variables.yaml" \
    --compose="${fixture_dir}/docker-compose.yml" \
    --entrypoint="${fixture_dir}/entrypoint.sh" \
    --validator="${fixture_dir}/production-validation.ts" 2>&1
}

echo "test: complete plumbing passes"
output=$(run_check "${FIXTURES}/plumbing_complete"; echo "EXIT:$?")
exit_code="${output##*EXIT:}"
assert_eq "0" "$exit_code" "exits 0 when all four plumbing files reference both secrets"

echo "test: missing envvars mapping fails"
output=$(run_check "${FIXTURES}/plumbing_missing_envvars"; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "1" "$exit_code" "exits 1 when envvars mapping is missing"
assert_contains "$output" "JWT_SECRET" "error names the missing secret"
assert_contains "$output" "custom-environment-variables.yaml" "error names the missing file"

echo "test: missing compose environment fails"
output=$(run_check "${FIXTURES}/plumbing_missing_compose"; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "1" "$exit_code" "exits 1 when compose app env is missing"
assert_contains "$output" "JWT_SECRET" "error names the missing secret"
assert_contains "$output" "docker-compose.yml" "error names the missing file"

echo "test: missing entrypoint file_env fails"
output=$(run_check "${FIXTURES}/plumbing_missing_entrypoint"; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "1" "$exit_code" "exits 1 when entrypoint file_env is missing"
assert_contains "$output" "JWT_SECRET" "error names the missing secret"
assert_contains "$output" "entrypoint.sh" "error names the missing file"

echo "test: missing validator fails"
output=$(run_check "${FIXTURES}/plumbing_missing_validator"; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "1" "$exit_code" "exits 1 when validator is missing"
assert_contains "$output" "JWT_SECRET" "error names the missing secret"
assert_contains "$output" "production-validation.ts" "error names the missing file"

report_results
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `bash bin/test/check_manifest_test.sh`
Expected: FAIL — `check-manifest.sh` does not exist.

- [ ] **Step 5: Implement check-manifest.sh**

Create `bin/check-manifest.sh`:

```bash
#!/usr/bin/env bash
# check-manifest.sh — CI lint for bin/deploy-manifest.yaml.
#
# Verifies that every secret declared in the manifest is wired into the
# four plumbing files:
#   1. config/custom-environment-variables.yaml  (env → config key binding)
#   2. docker-compose.yml                        (app + worker environment)
#   3. bin/entrypoint.sh                         (file_env list)
#   4. src/server/common/helper/production-validation.ts  (hard-fail check)
#
# Flags (override defaults; used by tests):
#   --manifest=<path>
#   --envvars=<path>
#   --compose=<path>
#   --entrypoint=<path>
#   --validator=<path>
#
# Exit codes:
#   0  all secrets are fully wired
#   1  at least one plumbing reference is missing
#   2  the manifest itself could not be read

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/manifest.sh"

MANIFEST="${REPO_ROOT}/bin/deploy-manifest.yaml"
ENVVARS="${REPO_ROOT}/config/custom-environment-variables.yaml"
COMPOSE="${REPO_ROOT}/docker-compose.yml"
ENTRYPOINT="${REPO_ROOT}/bin/entrypoint.sh"
VALIDATOR="${REPO_ROOT}/src/server/common/helper/production-validation.ts"

for arg in "$@"; do
  case "$arg" in
    --manifest=*)   MANIFEST="${arg#*=}" ;;
    --envvars=*)    ENVVARS="${arg#*=}" ;;
    --compose=*)    COMPOSE="${arg#*=}" ;;
    --entrypoint=*) ENTRYPOINT="${arg#*=}" ;;
    --validator=*)  VALIDATOR="${arg#*=}" ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "check-manifest: unknown argument: ${arg}" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$MANIFEST" ]]; then
  echo "check-manifest: manifest not found: ${MANIFEST}" >&2
  exit 2
fi

errors=0
report_missing() {
  local name="$1"
  local file="$2"
  local hint="$3"
  echo "ERROR: ${name} missing from ${file} — ${hint}" >&2
  errors=$((errors+1))
}

# Read all secret names once.
mapfile -t names < <(manifest_names "$MANIFEST")

for name in "${names[@]}"; do
  # 1. custom-environment-variables.yaml
  # Must appear as a mapped value (right-hand side of a YAML mapping).
  if ! grep -qE "^[[:space:]]+[a-zA-Z_]+:[[:space:]]+${name}$" "$ENVVARS"; then
    report_missing "$name" "$ENVVARS" "add an entry mapping a config key to ${name}"
  fi

  # 2. docker-compose.yml — must appear in both app and worker environment blocks,
  # once as the plain env var and once as the _FILE variant.
  if ! grep -qE "^[[:space:]]+- ${name}=\\\$\\{${name}:-" "$COMPOSE"; then
    report_missing "$name" "$COMPOSE" "add '- ${name}=\${${name}:-}' to both app and worker environment blocks"
  fi
  if ! grep -qE "^[[:space:]]+- ${name}_FILE=\\\$\\{${name}_FILE:-" "$COMPOSE"; then
    report_missing "${name}_FILE" "$COMPOSE" "add '- ${name}_FILE=\${${name}_FILE:-}' to both app and worker environment blocks"
  fi

  # 3. entrypoint.sh — must appear in the file_env list.
  if ! grep -qE "file_env '${name}'" "$ENTRYPOINT"; then
    report_missing "$name" "$ENTRYPOINT" "add \"file_env '${name}'\" to the production secrets block"
  fi

  # 4. production-validation.ts — must be referenced somewhere.
  if ! grep -q "${name}" "$VALIDATOR"; then
    report_missing "$name" "$VALIDATOR" "add a production-validation check for ${name}"
  fi
done

if [[ $errors -gt 0 ]]; then
  echo "" >&2
  echo "check-manifest: ${errors} plumbing issue(s). Every manifest entry must be wired into all four plumbing files." >&2
  exit 1
fi

echo "check-manifest: all ${#names[@]} manifest entries are fully wired."
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `chmod +x bin/check-manifest.sh && bash bin/test/check_manifest_test.sh`
Expected: All assertions PASS, exit 0.

- [ ] **Step 7: Run check-manifest against the real repo**

Run: `bash bin/check-manifest.sh`
Expected: `check-manifest: all 5 manifest entries are fully wired.`

Note: If this fails, it means the current docker-compose.yml, entrypoint.sh, custom-environment-variables.yaml, or production-validation.ts is missing one of the five secrets. This is a real bug that needs fixing before this plan can proceed. Fix the plumbing (add the missing lines), then re-run.

- [ ] **Step 8: Commit**

```bash
git add bin/check-manifest.sh bin/test/check_manifest_test.sh bin/test/fixtures/plumbing_*/
git commit -m "feat(deploy): add check-manifest CI lint with tests"
```

---

## Task 4: Wire check-manifest into CI

**Files:**
- Create: `.github/workflows/manifest_lint.yaml`
- Create: `bin/test/run.sh`
- Modify: `.github/workflows/pr.ci.yaml`

- [ ] **Step 1: Create the test runner**

Create `bin/test/run.sh`:

```bash
#!/usr/bin/env bash
# Run all bash test scripts. Fails fast if any individual script fails.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

total_scripts=0
failed_scripts=0

for test in "${SCRIPT_DIR}"/*_test.sh; do
  total_scripts=$((total_scripts+1))
  echo ""
  echo "========================================"
  echo "Running: $(basename "$test")"
  echo "========================================"
  if ! bash "$test"; then
    failed_scripts=$((failed_scripts+1))
  fi
done

echo ""
echo "========================================"
echo "Overall: $((total_scripts - failed_scripts))/${total_scripts} test scripts passed"
echo "========================================"

if [[ $failed_scripts -gt 0 ]]; then
  exit 1
fi
```

Run: `chmod +x bin/test/run.sh && bash bin/test/run.sh`
Expected: `Overall: 2/2 test scripts passed` (manifest_test + check_manifest_test).

- [ ] **Step 2: Create the manifest lint reusable workflow**

Create `.github/workflows/manifest_lint.yaml`:

```yaml
name: Manifest Lint
on:
  workflow_call:

jobs:
  manifest_lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run bash tests
        run: bash bin/test/run.sh
      - name: Check manifest wiring
        run: bash bin/check-manifest.sh
```

- [ ] **Step 3: Add manifest_lint to pr.ci.yaml**

Read the existing file first:

Run: `cat .github/workflows/pr.ci.yaml`

Then modify `.github/workflows/pr.ci.yaml` — add a new job after `x86_tests` (and before `arm_e2e`). The new job reference:

```yaml
  manifest_lint:
    uses: ./.github/workflows/manifest_lint.yaml
```

- [ ] **Step 4: Verify the CI workflow is syntactically valid**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/pr.ci.yaml')); print('OK')"`
Expected: `OK`

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/manifest_lint.yaml')); print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add bin/test/run.sh .github/workflows/manifest_lint.yaml .github/workflows/pr.ci.yaml
git commit -m "ci(deploy): run manifest lint on every PR"
```

---

## Task 5: deploy.sh scaffold — mode detection, flag parsing, help

**Files:**
- Create: `bin/deploy.sh`
- Create: `bin/test/deploy_test.sh`
- Create: `bin/test/fixtures/env_complete`
- Create: `bin/test/fixtures/env_missing_one`

- [ ] **Step 1: Create env fixtures**

Create `bin/test/fixtures/env_complete` (this is a `.env`-style file):

```
JWT_SECRET=aaaaa
SESSION_SECRET=bbbbb
DB_PASSWORD=ccccc
EMAIL_HASH_SECRET=ddddd
ENCRYPTION_KEY=eeeee
```

Create `bin/test/fixtures/env_missing_one`:

```
JWT_SECRET=aaaaa
SESSION_SECRET=bbbbb
DB_PASSWORD=ccccc
EMAIL_HASH_SECRET=ddddd
```

- [ ] **Step 2: Write failing tests for scaffold behavior**

Create `bin/test/deploy_test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

DEPLOY="${SCRIPT_DIR}/../deploy.sh"
FIXTURES="${SCRIPT_DIR}/fixtures"

echo "deploy_test.sh"

echo "test: --help prints usage"
output=$("${DEPLOY}" --help 2>&1)
assert_contains "$output" "deploy.sh" "help output mentions the script name"
assert_contains "$output" "--non-interactive" "help output mentions --non-interactive"
assert_contains "$output" "--skip-git-pull" "help output lists --skip-git-pull"
assert_contains "$output" "--domain" "help output lists --domain"

echo "test: unknown flag exits non-zero"
output=$("${DEPLOY}" --bogus 2>&1; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "1" "$exit_code" "unknown flag exits 1"
assert_contains "$output" "unknown" "error message mentions unknown flag"

report_results
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bash bin/test/deploy_test.sh`
Expected: FAIL — `deploy.sh` does not exist.

- [ ] **Step 4: Implement scaffold**

Create `bin/deploy.sh`:

```bash
#!/usr/bin/env bash
# bin/deploy.sh — Pavillion's single entry point for install, upgrade, and redeploy.
#
# Modes (auto-detected):
#   install   — no .env present. Generates all secrets, prompts for domain,
#               creates config/local.yaml, runs docker compose up.
#   upgrade   — .env present. Optionally git pulls, generates any missing
#               'regenerable' secrets, prompts (or bails) for missing
#               'stable' secrets, runs docker compose pull + up.
#
# Flags:
#   --non-interactive
#       Do not prompt. Fail fast with an actionable error if a 'stable'
#       secret is missing or if --domain is required but absent.
#   --skip-git-pull
#       Skip the git pull step in upgrade mode.
#   --domain=<value>
#       First-install domain. Ignored on upgrade.
#   --health-timeout=<seconds>
#       How long to poll /health before declaring failure. Default 120.
#   --help
#       Print this help and exit 0.
#
# Exit codes:
#   0  success (including "nothing to do")
#   1  generic failure
#   2  missing 'stable' secret in non-interactive mode
#   3  safety check failed (dirty tree, wrong directory, etc.)
#   4  docker compose up succeeded but /health never returned 200

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/manifest.sh"

# Defaults
NON_INTERACTIVE=0
SKIP_GIT_PULL=0
DOMAIN=""
HEALTH_TIMEOUT=120
MANIFEST="${REPO_ROOT}/bin/deploy-manifest.yaml"
ENV_FILE="${REPO_ROOT}/.env"
SECRETS_DIR="${REPO_ROOT}/secrets"

# ANSI colors (only when stdout is a TTY)
if [[ -t 1 ]]; then
  C_RED=$'\033[0;31m'
  C_GREEN=$'\033[0;32m'
  C_YELLOW=$'\033[1;33m'
  C_BLUE=$'\033[0;34m'
  C_BOLD=$'\033[1m'
  C_RESET=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_RESET=""
fi

log_info()    { echo -e "${C_BLUE}[INFO]${C_RESET} $*"; }
log_success() { echo -e "${C_GREEN}[OK]${C_RESET} $*"; }
log_warn()    { echo -e "${C_YELLOW}[WARN]${C_RESET} $*"; }
log_error()   { echo -e "${C_RED}[ERROR]${C_RESET} $*" >&2; }

print_help() {
  sed -n '/^# bin\/deploy.sh/,/^$/p' "$0" | sed 's/^# \{0,1\}//'
}

parse_args() {
  for arg in "$@"; do
    case "$arg" in
      --non-interactive) NON_INTERACTIVE=1 ;;
      --skip-git-pull)   SKIP_GIT_PULL=1 ;;
      --domain=*)        DOMAIN="${arg#*=}" ;;
      --health-timeout=*) HEALTH_TIMEOUT="${arg#*=}" ;;
      -h|--help)         print_help; exit 0 ;;
      *)
        log_error "unknown argument: ${arg}"
        echo "Run '$(basename "$0") --help' for usage." >&2
        exit 1
        ;;
    esac
  done

  # Non-TTY implies non-interactive even if flag not passed.
  if [[ ! -t 0 ]]; then
    NON_INTERACTIVE=1
  fi
}

detect_mode() {
  if [[ -f "$ENV_FILE" ]]; then
    echo "upgrade"
  else
    echo "install"
  fi
}

main() {
  parse_args "$@"

  local mode
  mode=$(detect_mode)
  log_info "Detected mode: ${mode}"

  # Subsequent tasks fill in the real behavior. For now, scaffold only.
  log_info "Scaffold-only: nothing to do yet."
}

main "$@"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `chmod +x bin/deploy.sh && bash bin/test/deploy_test.sh`
Expected: All assertions PASS.

- [ ] **Step 6: Smoke-test in a temp dir**

Run (from repo root):
```bash
bash bin/deploy.sh --help | head -10
```
Expected: Help output with "bin/deploy.sh — Pavillion's single entry point ...".

Run:
```bash
bash bin/deploy.sh --bogus 2>&1 || echo "exit=$?"
```
Expected: `[ERROR] unknown argument: --bogus` followed by `exit=1`.

- [ ] **Step 7: Commit**

```bash
git add bin/deploy.sh bin/test/deploy_test.sh bin/test/fixtures/env_*
git commit -m "feat(deploy): deploy.sh scaffold with flag parsing and mode detection"
```

---

## Task 6: deploy.sh — secret resolution (with `.deploy-state` ledger)

**Files:**
- Modify: `bin/deploy.sh`
- Modify: `bin/test/deploy_test.sh`

**Key behavior:** the script tracks which secrets have ever been provisioned on this instance via `.deploy-state` (one name per line). On upgrade-missing, the script distinguishes:

- **Newly-introduced secret** (name NOT in `.deploy-state`): auto-generate regardless of stability. This is the normal path when a release adds a new required secret — every existing admin would otherwise hit a spurious prompt.
- **Previously-provisioned secret that's gone missing** (name IN `.deploy-state`): for `regenerable`, auto-gen; for `stable`, prompt or bail. This is the original protection against losing JWT_SECRET / EMAIL_HASH_SECRET / etc.

If `.deploy-state` is absent but `.env` exists (one-time migration for pre-`bin/deploy.sh` admins), seed `.deploy-state` from the names currently in `.env` before processing missing secrets.

- [ ] **Step 1: Write failing tests for secret resolution**

Append to `bin/test/deploy_test.sh` (after the existing tests, before `report_results`):

```bash
# ---- secret resolution tests ----

# Create a temp workspace that mimics a repo root.
setup_workspace() {
  local ws="$1"
  local env_fixture="$2"
  mkdir -p "${ws}/bin/lib" "${ws}/secrets"
  cp "${SCRIPT_DIR}/../lib/manifest.sh" "${ws}/bin/lib/"
  cp "${SCRIPT_DIR}/../deploy.sh" "${ws}/bin/"
  chmod +x "${ws}/bin/deploy.sh"
  if [[ -n "$env_fixture" ]]; then
    cp "${env_fixture}" "${ws}/.env"
  fi
}

echo "test: diff_missing_secrets reports missing names"
tmp=$(mktemp -d); trap "rm -rf '${tmp}'" EXIT
setup_workspace "$tmp" "${FIXTURES}/env_missing_one"
# Write a 5-secret manifest (same as real) into the workspace.
cat > "${tmp}/bin/deploy-manifest.yaml" <<'EOF'
secrets:
  - name: JWT_SECRET
    generator: openssl_rand_base64_32
    stability: stable
    description: A.
  - name: SESSION_SECRET
    generator: openssl_rand_base64_32
    stability: stable
    description: B.
  - name: DB_PASSWORD
    generator: openssl_rand_base64_32
    stability: stable
    description: C.
  - name: EMAIL_HASH_SECRET
    generator: openssl_rand_base64_32
    stability: stable
    description: D.
  - name: ENCRYPTION_KEY
    generator: openssl_rand_hex_32
    stability: stable
    description: E.
EOF
# Source deploy.sh in dry-run mode via a helper: run a tiny probe script.
output=$(cd "$tmp" && bash -c "source bin/deploy.sh --help >/dev/null 2>&1 || true; source bin/lib/manifest.sh; source bin/deploy.sh --help >/dev/null 2>&1 || true" 2>&1 || true)
# Instead of sourcing, invoke a --diff flag (added below) for testability.
output=$(cd "$tmp" && bash bin/deploy.sh --diff-only 2>&1 || true)
assert_contains "$output" "ENCRYPTION_KEY" "diff reports the missing secret"

echo "test: generate_secret emits base64-32 for openssl_rand_base64_32"
out=$(cd "$tmp" && bash -c "source bin/lib/manifest.sh; source bin/deploy.sh --help >/dev/null 2>&1; exit 0")
# The actual generator test: invoke it directly via a helper flag.
out=$(cd "$tmp" && bash bin/deploy.sh --generate=openssl_rand_base64_32 2>&1)
# base64-32 secrets are ~44 characters long.
len=${#out}
if (( len < 40 || len > 48 )); then
  fail "base64-32 length out of range: ${len} (${out})"
else
  echo "  PASS: base64-32 generator emits a ~44-char string"
  _TESTS=$((_TESTS+1))
fi

echo "test: generate_secret emits hex-64 for openssl_rand_hex_32"
out=$(cd "$tmp" && bash bin/deploy.sh --generate=openssl_rand_hex_32 2>&1)
len=${#out}
# hex-64 is exactly 64 hex chars.
if (( len != 64 )); then
  fail "hex-64 length should be 64, got ${len}"
else
  echo "  PASS: hex-64 generator emits a 64-char string"
  _TESTS=$((_TESTS+1))
fi

echo "test: resolve_missing auto-generates 'regenerable' silently"
# Use a fixture manifest with one regenerable secret missing from .env.
cat > "${tmp}/bin/deploy-manifest.yaml" <<'EOF'
secrets:
  - name: JWT_SECRET
    generator: openssl_rand_base64_32
    stability: stable
    description: A.
  - name: IMPORT_HMAC
    generator: openssl_rand_base64_32
    stability: regenerable
    description: B.
EOF
cat > "${tmp}/.env" <<'EOF'
JWT_SECRET=existing
EOF
output=$(cd "$tmp" && bash bin/deploy.sh --resolve-only 2>&1)
assert_contains "$output" "IMPORT_HMAC" "output mentions the auto-generated secret"
# Verify .env now contains the new secret.
grep -q "^IMPORT_HMAC=" "${tmp}/.env" && echo "  PASS: .env updated with IMPORT_HMAC" || fail ".env should contain IMPORT_HMAC after resolve"
_TESTS=$((_TESTS+1))
# Verify secrets/import_hmac.txt exists with mode 600.
if [[ -f "${tmp}/secrets/import_hmac.txt" ]]; then
  perms=$(stat -f "%Lp" "${tmp}/secrets/import_hmac.txt" 2>/dev/null || stat -c "%a" "${tmp}/secrets/import_hmac.txt")
  assert_eq "600" "$perms" "secrets/import_hmac.txt is mode 600"
else
  fail "secrets/import_hmac.txt should exist"
  _TESTS=$((_TESTS+1))
fi

echo "test: resolve_missing auto-generates a NEWLY-INTRODUCED 'stable' secret (not in .deploy-state)"
# Pre-seed .deploy-state with one secret; the manifest declares two; the second
# is stable but has never been provisioned. It should auto-generate without prompting.
rm -rf "${tmp}/secrets" "${tmp}/.deploy-state"
mkdir -p "${tmp}/secrets"
cat > "${tmp}/.env" <<'EOF'
JWT_SECRET=existing
EOF
cat > "${tmp}/.deploy-state" <<'EOF'
# managed by bin/deploy.sh
JWT_SECRET
EOF
cat > "${tmp}/bin/deploy-manifest.yaml" <<'EOF'
secrets:
  - name: JWT_SECRET
    generator: openssl_rand_base64_32
    stability: stable
    description: A.
  - name: NEW_STABLE_SECRET
    generator: openssl_rand_base64_32
    stability: stable
    description: Newly introduced this release.
EOF
output=$(cd "$tmp" && bash bin/deploy.sh --non-interactive --resolve-only 2>&1; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "0" "$exit_code" "exit 0 when missing stable secret is newly-introduced (not in .deploy-state)"
assert_contains "$output" "newly-introduced" "log message identifies it as newly-introduced"
grep -q "^NEW_STABLE_SECRET=" "${tmp}/.env" && echo "  PASS: .env updated with NEW_STABLE_SECRET" || fail ".env should contain NEW_STABLE_SECRET"
_TESTS=$((_TESTS+1))
grep -qx "NEW_STABLE_SECRET" "${tmp}/.deploy-state" && echo "  PASS: .deploy-state recorded NEW_STABLE_SECRET" || fail ".deploy-state should now include NEW_STABLE_SECRET"
_TESTS=$((_TESTS+1))

echo "test: resolve_missing bails on PREVIOUSLY-PROVISIONED 'stable' missing in non-interactive mode"
# Seed .deploy-state with the secret name to simulate "admin had it but lost it".
rm -rf "${tmp}/secrets"
mkdir -p "${tmp}/secrets"
cat > "${tmp}/.env" <<'EOF'
EOF
cat > "${tmp}/.deploy-state" <<'EOF'
# managed by bin/deploy.sh
JWT_SECRET
EOF
cat > "${tmp}/bin/deploy-manifest.yaml" <<'EOF'
secrets:
  - name: JWT_SECRET
    generator: openssl_rand_base64_32
    stability: stable
    description: A.
EOF
output=$(cd "$tmp" && bash bin/deploy.sh --non-interactive --resolve-only 2>&1; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "2" "$exit_code" "exit 2 when previously-provisioned stable secret is missing in non-interactive mode"
assert_contains "$output" "JWT_SECRET" "error names the missing stable secret"
assert_contains "$output" "previously provisioned" "error explains the secret was previously provisioned"

echo "test: deploy_state_init seeds from .env when .deploy-state is absent (one-time migration)"
rm -rf "${tmp}/secrets" "${tmp}/.deploy-state"
mkdir -p "${tmp}/secrets"
cat > "${tmp}/.env" <<'EOF'
JWT_SECRET=existing
SESSION_SECRET=existing
EOF
cat > "${tmp}/bin/deploy-manifest.yaml" <<'EOF'
secrets:
  - name: JWT_SECRET
    generator: openssl_rand_base64_32
    stability: stable
    description: A.
  - name: SESSION_SECRET
    generator: openssl_rand_base64_32
    stability: stable
    description: B.
EOF
output=$(cd "$tmp" && bash bin/deploy.sh --non-interactive --resolve-only 2>&1; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "0" "$exit_code" "exit 0: nothing missing, deploy-state seeded silently"
[[ -f "${tmp}/.deploy-state" ]] && echo "  PASS: .deploy-state created" || fail ".deploy-state should exist"
_TESTS=$((_TESTS+1))
grep -qx "JWT_SECRET" "${tmp}/.deploy-state" && echo "  PASS: .deploy-state seeded with JWT_SECRET" || fail "JWT_SECRET should be in seeded .deploy-state"
_TESTS=$((_TESTS+1))
grep -qx "SESSION_SECRET" "${tmp}/.deploy-state" && echo "  PASS: .deploy-state seeded with SESSION_SECRET" || fail "SESSION_SECRET should be in seeded .deploy-state"
_TESTS=$((_TESTS+1))
```

The test helpers need `fail`. Add to `bin/test/lib.sh` (if not already added):

```bash
fail() {
  local msg="${1:-failure}"
  echo "  FAIL: ${msg}"
  _FAILS=$((_FAILS+1))
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash bin/test/deploy_test.sh`
Expected: FAIL — `--diff-only`, `--generate`, `--resolve-only` flags not implemented.

- [ ] **Step 3: Implement secret resolution**

Modify `bin/deploy.sh`. Add the following inside the script (after `detect_mode` and before `main`).

Also add a default near the other DEFAULTS at the top of the script:

```bash
DEPLOY_STATE_FILE="${REPO_ROOT}/.deploy-state"
```

Then the helpers and resolution logic:

```bash
# ---- Secret generators ----

generate_secret() {
  local generator="$1"
  case "$generator" in
    openssl_rand_base64_32) openssl rand -base64 32 ;;
    openssl_rand_hex_32)    openssl rand -hex 32 ;;
    *)
      log_error "unknown generator: ${generator}"
      return 1
      ;;
  esac
}

# ---- .env helpers ----

# env_has <env_file> <name> -> exit 0 if the var is set to a non-empty value
env_has() {
  local file="$1"
  local name="$2"
  [[ -f "$file" ]] || return 1
  # Match "NAME=value" where value is non-empty.
  grep -qE "^${name}=.+\$" "$file"
}

# env_names <env_file> -> stdout: one variable name per line (anything before '=')
env_names() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  # Skip blank lines and comments.
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$file" | cut -d'=' -f1
}

# env_append <env_file> <name> <value>
env_append() {
  local file="$1"
  local name="$2"
  local value="$3"
  # Append to .env, creating it if missing, with 600 permissions.
  if [[ ! -f "$file" ]]; then
    touch "$file"
    chmod 600 "$file"
  fi
  echo "${name}=${value}" >> "$file"
}

# write_secret_file <name> <value>
write_secret_file() {
  local name="$1"
  local value="$2"
  mkdir -p "$SECRETS_DIR"
  # secrets/<lowercase_name>.txt
  local filename
  filename=$(echo "$name" | tr '[:upper:]' '[:lower:]').txt
  local path="${SECRETS_DIR}/${filename}"
  printf '%s' "$value" > "$path"
  chmod 600 "$path"
}

# ---- Deploy-state helpers ----

# deploy_state_init: ensure the file exists with a header comment.
# If absent and .env exists, seed from .env names (one-time migration).
deploy_state_init() {
  if [[ -f "$DEPLOY_STATE_FILE" ]]; then
    return 0
  fi
  log_info "Creating ${DEPLOY_STATE_FILE}..."
  {
    echo "# Pavillion deploy state — managed by bin/deploy.sh"
    echo "# Do not edit by hand. Lists secrets ever provisioned on this instance."
  } > "$DEPLOY_STATE_FILE"
  chmod 600 "$DEPLOY_STATE_FILE"
  # One-time migration: if .env already has secrets, treat them as previously-provisioned.
  if [[ -f "$ENV_FILE" ]]; then
    local seeded=0
    while IFS= read -r name; do
      [[ -z "$name" ]] && continue
      echo "$name" >> "$DEPLOY_STATE_FILE"
      seeded=$((seeded+1))
    done < <(env_names "$ENV_FILE")
    if (( seeded > 0 )); then
      log_info "Seeded ${seeded} existing secret name(s) from .env into .deploy-state."
    fi
  fi
}

# deploy_state_has <name> -> exit 0 if name is recorded
deploy_state_has() {
  local name="$1"
  [[ -f "$DEPLOY_STATE_FILE" ]] || return 1
  grep -qxE "${name}" "$DEPLOY_STATE_FILE"
}

# deploy_state_record <name>
deploy_state_record() {
  local name="$1"
  if ! deploy_state_has "$name"; then
    echo "$name" >> "$DEPLOY_STATE_FILE"
  fi
}

# ---- Manifest diff ----

# missing_secrets -> stdout: one NAME|STABILITY per line for each manifest entry
#                             whose NAME is not set in .env.
missing_secrets() {
  while IFS='|' read -r name generator stability description; do
    if ! env_has "$ENV_FILE" "$name"; then
      echo "${name}|${stability}"
    fi
  done < <(parse_manifest "$MANIFEST")
}

# provision_secret <name> <generator> — generate a value, write to .env + secrets/, record in state.
provision_secret() {
  local name="$1"
  local generator="$2"
  local value
  value=$(generate_secret "$generator")
  env_append "$ENV_FILE" "$name" "$value"
  write_secret_file "$name" "$value"
  deploy_state_record "$name"
}

# resolve_missing: handle each missing secret per the deploy-state-aware rubric.
# Returns 0 on success, 2 if a 'stable' previously-provisioned secret is missing in non-interactive mode.
resolve_missing() {
  deploy_state_init

  local failures=0
  while IFS='|' read -r name stability; do
    [[ -z "$name" ]] && continue
    local generator
    generator=$(manifest_field "$MANIFEST" "$name" "generator")
    local description
    description=$(manifest_field "$MANIFEST" "$name" "description")

    # Case 1: name is NOT in .deploy-state — newly-introduced secret. Auto-gen regardless of stability.
    if ! deploy_state_has "$name"; then
      log_info "Generating ${name} (newly-introduced this version)..."
      provision_secret "$name" "$generator"
      log_success "Generated ${name}"
      continue
    fi

    # Case 2: name IS in .deploy-state — previously-provisioned. Apply stability rubric.
    case "$stability" in
      regenerable)
        log_warn "Regenerating ${name} (previously provisioned, but missing from .env)..."
        provision_secret "$name" "$generator"
        log_success "Regenerated ${name}"
        ;;
      stable)
        if [[ $NON_INTERACTIVE -eq 1 ]]; then
          log_error "Required secret ${name} was previously provisioned but is missing from .env."
          log_error "  ${description}"
          log_error "  Restore the value from your password manager and add ${name}=<value> to ${ENV_FILE},"
          log_error "  or re-run interactively to choose between paste and regenerate."
          failures=$((failures+1))
        else
          echo ""
          echo "${C_YELLOW}${C_BOLD}Secret ${name} was previously provisioned, but is missing from .env.${C_RESET}"
          echo "  ${description}"
          echo ""
          echo "Options:"
          echo "  1. Paste the existing value (from your password manager)"
          echo "  2. Type GENERATE to accept the documented impact and create a new one"
          echo "  3. Press Ctrl-C to abort"
          echo ""
          read -r -p "Value or GENERATE: " response
          local value
          if [[ "$response" == "GENERATE" ]]; then
            value=$(generate_secret "$generator")
            log_success "Generated new ${name}"
          elif [[ -z "$response" ]]; then
            log_error "Empty response. Aborting."
            failures=$((failures+1))
            continue
          else
            value="$response"
          fi
          env_append "$ENV_FILE" "$name" "$value"
          write_secret_file "$name" "$value"
          deploy_state_record "$name"
        fi
        ;;
      *)
        log_error "unknown stability '${stability}' for ${name}"
        failures=$((failures+1))
        ;;
    esac
  done < <(missing_secrets)

  if [[ $failures -gt 0 ]]; then
    return 2
  fi
  return 0
}

# ---- Debug/test flags (before the normal main flow) ----

run_debug_flags() {
  # --diff-only: print missing secrets and exit.
  # --generate=<name>: print a fresh secret for the given generator and exit.
  # --resolve-only: resolve missing secrets then exit.
  for arg in "$@"; do
    case "$arg" in
      --diff-only)
        missing_secrets
        exit 0
        ;;
      --generate=*)
        generate_secret "${arg#*=}"
        exit 0
        ;;
      --resolve-only)
        resolve_missing
        exit $?
        ;;
    esac
  done
}
```

Update `parse_args` to accept the new debug flags (add cases):

```bash
      --diff-only)       DEBUG_DIFF=1 ;;
      --generate=*)      DEBUG_GENERATE="${arg#*=}" ;;
      --resolve-only)    DEBUG_RESOLVE=1 ;;
```

Add default declarations near the top of the script (after the other defaults):

```bash
DEBUG_DIFF=0
DEBUG_GENERATE=""
DEBUG_RESOLVE=0
```

Update `main` to dispatch debug flags first:

```bash
main() {
  parse_args "$@"

  if [[ $DEBUG_DIFF -eq 1 ]]; then
    missing_secrets
    exit 0
  fi
  if [[ -n "$DEBUG_GENERATE" ]]; then
    generate_secret "$DEBUG_GENERATE"
    exit 0
  fi
  if [[ $DEBUG_RESOLVE -eq 1 ]]; then
    resolve_missing
    exit $?
  fi

  local mode
  mode=$(detect_mode)
  log_info "Detected mode: ${mode}"

  # Subsequent tasks fill in install/upgrade flow.
  log_info "Scaffold-only: nothing to do yet."
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash bin/test/deploy_test.sh`
Expected: All assertions PASS.

- [ ] **Step 5: Smoke test**

Run:
```bash
bash bin/deploy.sh --generate=openssl_rand_base64_32
```
Expected: A ~44-character base64 string.

Run:
```bash
bash bin/deploy.sh --generate=openssl_rand_hex_32
```
Expected: A 64-character hex string.

- [ ] **Step 6: Commit**

```bash
git add bin/deploy.sh bin/test/deploy_test.sh bin/test/lib.sh
git commit -m "feat(deploy): secret resolution — generate, prompt, or bail"
```

---

## Task 7: deploy.sh — first-install flow (domain + local.yaml)

**Files:**
- Modify: `bin/deploy.sh`
- Modify: `bin/test/deploy_test.sh`

- [ ] **Step 1: Write failing test**

Append to `bin/test/deploy_test.sh` (before `report_results`):

```bash
echo "test: install mode non-interactive requires --domain"
tmp2=$(mktemp -d)
setup_workspace "$tmp2" ""
cp "${SCRIPT_DIR}/../deploy-manifest.yaml" "${tmp2}/bin/"
# Provide a local.yaml.example with the substitution target.
mkdir -p "${tmp2}/config"
echo 'domain: "pavillion.example.org"' > "${tmp2}/config/local.yaml.example"

output=$(cd "$tmp2" && bash bin/deploy.sh --non-interactive --install-only 2>&1; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "1" "$exit_code" "install mode without --domain fails in non-interactive mode"
assert_contains "$output" "--domain" "error message mentions --domain"

echo "test: install mode non-interactive with --domain succeeds"
output=$(cd "$tmp2" && bash bin/deploy.sh --non-interactive --domain=test.example.org --install-only 2>&1; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "0" "$exit_code" "install with --domain succeeds (exit 0)"
# Verify local.yaml was created with the domain substituted.
grep -q "test.example.org" "${tmp2}/config/local.yaml" && echo "  PASS: local.yaml contains substituted domain" || fail "local.yaml should contain test.example.org"
_TESTS=$((_TESTS+1))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash bin/test/deploy_test.sh`
Expected: FAIL — `--install-only` flag not implemented.

- [ ] **Step 3: Implement install flow**

Add to `bin/deploy.sh` (near the other helpers):

```bash
# ---- Install-mode helpers ----

prompt_domain() {
  # If DOMAIN is already set (via --domain=), return it.
  # Otherwise, interactive: prompt. Non-interactive: fail.
  if [[ -n "$DOMAIN" ]]; then
    echo "$DOMAIN"
    return 0
  fi
  if [[ $NON_INTERACTIVE -eq 1 ]]; then
    log_error "Install mode requires --domain=<value> in non-interactive mode."
    return 1
  fi
  local response
  read -r -p "Enter your domain name (e.g., events.example.org): " response
  if [[ -z "$response" ]]; then
    log_error "Domain name is required."
    return 1
  fi
  echo "$response"
}

write_local_yaml() {
  local domain="$1"
  local example="${REPO_ROOT}/config/local.yaml.example"
  local target="${REPO_ROOT}/config/local.yaml"

  if [[ -f "$target" ]]; then
    log_warn "config/local.yaml already exists. Leaving it untouched."
    return 0
  fi

  if [[ ! -f "$example" ]]; then
    log_error "config/local.yaml.example not found at ${example}"
    return 1
  fi

  # Substitute the placeholder domain. Use | as sed delimiter to avoid
  # conflict with domains containing slashes.
  sed "s|pavillion.example.org|${domain}|g" "$example" > "$target"
  log_success "Created config/local.yaml with domain '${domain}'"
}

run_install() {
  log_info "First-install mode. Generating secrets, configuring local.yaml."

  # Resolve all secrets (all will be missing, all will be generated).
  resolve_missing || return $?

  # Configure local.yaml.
  local domain
  if ! domain=$(prompt_domain); then
    return 1
  fi
  write_local_yaml "$domain" || return $?

  log_success "Install phase complete."
  return 0
}
```

Add a debug flag `--install-only` for testability. Add to defaults:

```bash
DEBUG_INSTALL=0
```

Add to `parse_args` cases:

```bash
      --install-only)    DEBUG_INSTALL=1 ;;
```

Add to `main` (before the mode-detect / scaffold code):

```bash
  if [[ $DEBUG_INSTALL -eq 1 ]]; then
    run_install
    exit $?
  fi
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash bin/test/deploy_test.sh`
Expected: All assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add bin/deploy.sh bin/test/deploy_test.sh
git commit -m "feat(deploy): first-install flow — domain prompt and local.yaml setup"
```

---

## Task 8: deploy.sh — upgrade-mode git pull

**Files:**
- Modify: `bin/deploy.sh`
- Modify: `bin/test/deploy_test.sh`

- [ ] **Step 1: Write failing test**

Append to `bin/test/deploy_test.sh`:

```bash
echo "test: upgrade mode fails on dirty working tree"
tmp3=$(mktemp -d)
setup_workspace "$tmp3" "${FIXTURES}/env_complete"
cp "${SCRIPT_DIR}/../deploy-manifest.yaml" "${tmp3}/bin/"
# Init a git repo with an uncommitted change.
(cd "$tmp3" && git init -q && git config user.email "t@e.co" && git config user.name "t" && \
   echo "initial" > file.txt && git add . && git commit -qm "initial" && \
   echo "change" >> file.txt)

output=$(cd "$tmp3" && bash bin/deploy.sh --non-interactive --git-pull-only 2>&1; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "3" "$exit_code" "dirty tree fails with exit 3"
assert_contains "$output" "working tree" "error mentions the dirty tree"

echo "test: upgrade mode honors --skip-git-pull"
# Reset the dirty tree fixture to a clean one first for this test.
(cd "$tmp3" && git checkout -q -- file.txt)
output=$(cd "$tmp3" && bash bin/deploy.sh --non-interactive --skip-git-pull --git-pull-only 2>&1; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "0" "$exit_code" "--skip-git-pull bypasses the pull and the dirty-tree check (exit 0)"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash bin/test/deploy_test.sh`
Expected: FAIL — `--git-pull-only` not implemented.

- [ ] **Step 3: Implement git pull**

Add to `bin/deploy.sh`:

```bash
# ---- Upgrade-mode helpers ----

check_working_tree_clean() {
  # Exit 0 if clean, non-zero if dirty or not a git repo.
  if ! git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    log_error "${REPO_ROOT} is not a git repository."
    return 1
  fi
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
    log_error "Working tree is not clean. Commit or stash changes before upgrading:"
    git -C "$REPO_ROOT" status --short >&2
    return 1
  fi
  return 0
}

run_git_pull() {
  if [[ $SKIP_GIT_PULL -eq 1 ]]; then
    log_info "Skipping git pull (--skip-git-pull)."
    return 0
  fi
  if ! check_working_tree_clean; then
    return 3
  fi
  log_info "Running git pull..."
  if ! git -C "$REPO_ROOT" pull --ff-only; then
    log_error "git pull failed. Resolve the conflict manually and re-run."
    return 1
  fi
  log_success "git pull complete."
  return 0
}
```

Add debug flag `--git-pull-only`. Defaults:

```bash
DEBUG_GIT_PULL=0
```

parse_args cases:

```bash
      --git-pull-only)   DEBUG_GIT_PULL=1 ;;
```

main dispatch (before mode-detect scaffold):

```bash
  if [[ $DEBUG_GIT_PULL -eq 1 ]]; then
    run_git_pull
    exit $?
  fi
```

Important: the error path from `check_working_tree_clean` returns 1, but the script's exit code contract says exit 3 for safety failures. Update `run_git_pull`:

```bash
run_git_pull() {
  if [[ $SKIP_GIT_PULL -eq 1 ]]; then
    log_info "Skipping git pull (--skip-git-pull)."
    return 0
  fi
  if ! check_working_tree_clean; then
    return 3    # safety check failure
  fi
  log_info "Running git pull..."
  if ! git -C "$REPO_ROOT" pull --ff-only; then
    log_error "git pull failed. Resolve the conflict manually and re-run."
    return 1
  fi
  log_success "git pull complete."
  return 0
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash bin/test/deploy_test.sh`
Expected: All assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add bin/deploy.sh bin/test/deploy_test.sh
git commit -m "feat(deploy): upgrade-mode git pull with safety checks"
```

---

## Task 9: deploy.sh — docker operations and health check

**Files:**
- Modify: `bin/deploy.sh`
- Modify: `bin/test/deploy_test.sh`

Docker operations are hard to unit-test in isolation. We write shell-only tests that stub `docker` via a shim, plus a smoke test for the real docker path behind a `PAVILLION_SKIP_DOCKER=1` environment guard used only in the automated tests.

- [ ] **Step 1: Write failing test using a docker shim**

Append to `bin/test/deploy_test.sh`:

```bash
echo "test: docker ops call the expected commands (shim)"
tmp4=$(mktemp -d)
setup_workspace "$tmp4" "${FIXTURES}/env_complete"
cp "${SCRIPT_DIR}/../deploy-manifest.yaml" "${tmp4}/bin/"
# Create a docker shim that records its arguments.
mkdir -p "${tmp4}/shim"
cat > "${tmp4}/shim/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> /tmp/deploy_test_docker.log
if [[ "${1:-}" == "compose" && "${2:-}" == "pull" ]]; then
  exit 0
fi
if [[ "${1:-}" == "compose" && "${2:-}" == "up" ]]; then
  exit 0
fi
exit 0
EOF
chmod +x "${tmp4}/shim/docker"
# Create a curl shim that immediately succeeds (simulating /health OK).
cat > "${tmp4}/shim/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> /tmp/deploy_test_curl.log
# Simulate 200 OK.
exit 0
EOF
chmod +x "${tmp4}/shim/curl"

rm -f /tmp/deploy_test_docker.log /tmp/deploy_test_curl.log

output=$(cd "$tmp4" && PATH="${tmp4}/shim:${PATH}" bash bin/deploy.sh --non-interactive --docker-only --health-timeout=5 2>&1; echo "EXIT:$?")
exit_code="${output##*EXIT:}"
assert_eq "0" "$exit_code" "docker-only path exits 0 with successful shims"
assert_contains "$(cat /tmp/deploy_test_docker.log)" "compose pull" "docker compose pull was invoked"
assert_contains "$(cat /tmp/deploy_test_docker.log)" "compose up -d" "docker compose up -d was invoked"

echo "test: health check polls until success"
# Simulate curl failing twice then succeeding.
cat > "${tmp4}/shim/curl" <<'EOF'
#!/usr/bin/env bash
STATE_FILE=/tmp/deploy_test_curl_state
count=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
count=$((count+1))
echo "$count" > "$STATE_FILE"
if (( count < 3 )); then
  exit 7   # connection refused
fi
exit 0
EOF
rm -f /tmp/deploy_test_curl_state /tmp/deploy_test_docker.log
output=$(cd "$tmp4" && PATH="${tmp4}/shim:${PATH}" bash bin/deploy.sh --non-interactive --docker-only --health-timeout=10 2>&1; echo "EXIT:$?")
exit_code="${output##*EXIT:}"
assert_eq "0" "$exit_code" "health check succeeds after initial failures"

echo "test: health check times out with exit 4"
cat > "${tmp4}/shim/curl" <<'EOF'
#!/usr/bin/env bash
exit 7
EOF
output=$(cd "$tmp4" && PATH="${tmp4}/shim:${PATH}" bash bin/deploy.sh --non-interactive --docker-only --health-timeout=3 2>&1; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "4" "$exit_code" "health-check timeout exits with code 4"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash bin/test/deploy_test.sh`
Expected: FAIL — `--docker-only` not implemented.

- [ ] **Step 3: Implement docker operations and health check**

Add to `bin/deploy.sh`:

```bash
# ---- Docker-mode helpers ----

run_docker_pull() {
  log_info "Pulling images..."
  if ! (cd "$REPO_ROOT" && docker compose pull); then
    log_error "docker compose pull failed."
    return 1
  fi
  log_success "Images pulled."
  return 0
}

run_docker_up() {
  log_info "Starting containers..."
  if ! (cd "$REPO_ROOT" && docker compose up -d --remove-orphans); then
    log_error "docker compose up failed."
    return 1
  fi
  log_success "Containers started."
  return 0
}

poll_health() {
  local timeout="$1"
  local port="${APP_PORT:-3000}"
  local url="http://localhost:${port}/health"
  log_info "Polling ${url} for up to ${timeout}s..."

  local elapsed=0
  local interval=2
  while (( elapsed < timeout )); do
    if curl -sS -f -o /dev/null "${url}"; then
      log_success "Health check passed."
      return 0
    fi
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done
  log_error "Health check timed out after ${timeout}s."
  log_error "Tail of 'docker compose logs app':"
  (cd "$REPO_ROOT" && docker compose logs --tail=50 app) || true
  return 4
}

run_docker() {
  run_docker_pull || return 1
  run_docker_up || return 1
  poll_health "$HEALTH_TIMEOUT" || return $?
  return 0
}
```

Add debug flag `--docker-only`. Defaults:

```bash
DEBUG_DOCKER=0
```

parse_args cases:

```bash
      --docker-only)     DEBUG_DOCKER=1 ;;
```

main dispatch:

```bash
  if [[ $DEBUG_DOCKER -eq 1 ]]; then
    run_docker
    exit $?
  fi
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash bin/test/deploy_test.sh`
Expected: All assertions PASS.

- [ ] **Step 5: Wire the main flow end-to-end**

Replace the placeholder scaffold in `main()` with the real flow:

```bash
main() {
  parse_args "$@"

  # Debug dispatches (kept for testability).
  if [[ $DEBUG_DIFF -eq 1 ]];    then missing_secrets;                          exit 0; fi
  if [[ -n "$DEBUG_GENERATE" ]]; then generate_secret "$DEBUG_GENERATE";        exit 0; fi
  if [[ $DEBUG_RESOLVE -eq 1 ]]; then resolve_missing;                          exit $?; fi
  if [[ $DEBUG_INSTALL -eq 1 ]]; then run_install;                              exit $?; fi
  if [[ $DEBUG_GIT_PULL -eq 1 ]]; then run_git_pull;                            exit $?; fi
  if [[ $DEBUG_DOCKER -eq 1 ]];  then run_docker;                               exit $?; fi

  local mode
  mode=$(detect_mode)
  log_info "Detected mode: ${mode}"

  if [[ "$mode" == "install" ]]; then
    run_install || exit $?
  else
    run_git_pull || exit $?
    resolve_missing || exit $?
  fi

  run_docker || exit $?

  log_success "Deploy complete."
}
```

- [ ] **Step 6: Run all tests**

Run: `bash bin/test/run.sh`
Expected: `Overall: 3/3 test scripts passed`.

- [ ] **Step 7: Commit**

```bash
git add bin/deploy.sh bin/test/deploy_test.sh
git commit -m "feat(deploy): docker operations, health polling, end-to-end main flow"
```

---

## Task 10: Retire bin/setup.sh

**Files:**
- Modify: `bin/setup.sh`

- [ ] **Step 1: Replace the body with a deprecation stub**

Read the current file first: `cat bin/setup.sh | head -10`

Then overwrite `bin/setup.sh` entirely with:

```bash
#!/usr/bin/env bash
# bin/setup.sh — DEPRECATED. Use bin/deploy.sh instead.
#
# This script used to bootstrap a new Pavillion install. Its behavior
# has been folded into bin/deploy.sh, which is now the single entry
# point for install, upgrade, and redeploy.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cat >&2 <<'EOF'
[DEPRECATED] bin/setup.sh has been replaced by bin/deploy.sh.

bin/deploy.sh is the single entry point for:
  - first install         (when .env is absent)
  - upgrade               (when .env is present)
  - redeploy / restart    (idempotent re-runs)

Run:
  bin/deploy.sh              # interactive
  bin/deploy.sh --help       # see all flags

Forwarding this invocation to bin/deploy.sh...
EOF

exec "${SCRIPT_DIR}/deploy.sh" "$@"
```

- [ ] **Step 2: Verify the stub is executable**

Run: `bash bin/setup.sh --help 2>&1 | head -5`
Expected:
```
[DEPRECATED] bin/setup.sh has been replaced by bin/deploy.sh.
...
```
followed by the `deploy.sh --help` output.

- [ ] **Step 3: Commit**

```bash
git add bin/setup.sh
git commit -m "refactor(deploy): retire bin/setup.sh to a forwarding stub"
```

---

## Task 11: Rewrite docker/staging/deploy.sh

**Files:**
- Modify: `docker/staging/deploy.sh`
- Modify: `docker/staging/README.md`

- [ ] **Step 1: Replace the staging deploy script**

Overwrite `docker/staging/deploy.sh` entirely:

```bash
#!/bin/bash
#
# Pavillion Staging Deploy Script
#
# Webhook-triggered wrapper around bin/deploy.sh. Calls the unified deploy
# tool in non-interactive mode. flock guards against concurrent deploys.
#

set -euo pipefail

APP_DIR="/opt/pavillion"
LOG_FILE="${APP_DIR}/deploy.log"
LOCK_FILE="/tmp/pavillion-deploy.lock"

log() {
  echo "$(date -Iseconds) $1" >> "$LOG_FILE"
}

(
  if ! flock -n 200; then
    log "ERROR: Deploy already in progress, skipping"
    exit 1
  fi

  log "Staging deploy started"

  cd "$APP_DIR"

  if ! bash bin/deploy.sh --non-interactive >> "$LOG_FILE" 2>&1; then
    log "ERROR: bin/deploy.sh failed (exit $?)"
    exit 1
  fi

  log "Pruning old images..."
  docker image prune -f >> "$LOG_FILE" 2>&1 || true

  log "Staging deploy complete"

) 200>"$LOCK_FILE"
```

- [ ] **Step 2: Update docker/staging/README.md**

Read it first: `cat docker/staging/README.md`

Replace any references to the old `docker compose pull && up` pattern with a note that the script now calls `bin/deploy.sh --non-interactive`. The README should describe the wrapper's responsibilities (flock, image prune, log file) and note that all secret management and container lifecycle lives in `bin/deploy.sh`.

Target content for the "What this script does" section (rewrite whatever exists):

```markdown
## What this script does

The staging deploy webhook fires `docker/staging/deploy.sh`, which is a thin
wrapper around `bin/deploy.sh --non-interactive`. The wrapper adds:

1. **flock-based concurrency** — prevents overlapping deploys on the same
   machine.
2. **Log file** — writes all output to `/opt/pavillion/deploy.log` for
   post-hoc inspection.
3. **Image prune** — removes dangling images after a successful deploy.

All secret management, migrations, container lifecycle, and health checks
live in `bin/deploy.sh`. See `docs/upgrading.md` for the admin-facing
story.
```

- [ ] **Step 3: Smoke test (no actual deploy)**

Run: `bash -n docker/staging/deploy.sh && echo "syntax OK"`
Expected: `syntax OK`.

- [ ] **Step 4: Commit**

```bash
git add docker/staging/deploy.sh docker/staging/README.md
git commit -m "refactor(deploy): staging webhook calls bin/deploy.sh"
```

---

## Task 12: Update production-validation error messages

**Files:**
- Modify: `src/server/common/helper/production-validation.ts`

- [ ] **Step 1: Read the current file**

Read `src/server/common/helper/production-validation.ts` in full.

- [ ] **Step 2: Replace setup.sh references with deploy.sh**

For each `throw new Error(...)` in `validateProductionSecrets`, update the message to reference `bin/deploy.sh` instead of `bin/setup.sh`.

Example change (apply to all five throw statements):

```typescript
// Before:
throw new Error(
  'JWT_SECRET must be set in production. Run bin/setup.sh to generate secure secrets, ' +
  'or set the JWT_SECRET environment variable to a cryptographically secure value.',
);

// After:
throw new Error(
  'JWT_SECRET must be set in production. Run bin/deploy.sh to generate secure secrets, ' +
  'or set the JWT_SECRET environment variable to a cryptographically secure value.',
);
```

For `CALENDAR_IMPORT_HMAC_SECRET` the current message does not mention setup.sh (just gives `openssl rand`); leave that message as-is unless you want to standardize. Optional standardization:

```typescript
throw new Error(
  'CALENDAR_IMPORT_HMAC_SECRET must be set in production. Run bin/deploy.sh to generate secure secrets, ' +
  'or set the CALENDAR_IMPORT_HMAC_SECRET environment variable to a cryptographically secure value.',
);
```

(Note: `CALENDAR_IMPORT_HMAC_SECRET` validation exists on `feat/ics-import-foundation-pv-1qcp`, not on `main`. If the current branch does not have it, skip that change here — it lands with the ICS branch.)

- [ ] **Step 3: Verify tests still pass**

Run: `npx vitest run src/server/test/jwt-externalization.test.ts`
Expected: Any test that matches on the exact error string needs to be updated. Check the test file; if it uses substring matching (`.toMatch(/Run bin\/.*\.sh/)` or similar), it will still pass. If it matches the exact string, update it.

Run: `npx vitest run src/server/calendar/service/import/test/hmac.test.ts` (if on the ICS branch)
Expected: Same consideration.

If any test fails, update the assertion to match the new message.

- [ ] **Step 4: Run the full unit test suite**

Run: `npm run test:unit`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/common/helper/production-validation.ts src/server/test/
git commit -m "refactor(deploy): error messages point to bin/deploy.sh"
```

---

## Task 13: Rewrite docs/upgrading.md

**Files:**
- Modify: `docs/upgrading.md`

- [ ] **Step 1: Replace the file content**

Overwrite `docs/upgrading.md` with:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/upgrading.md
git commit -m "docs(upgrade): rewrite around bin/deploy.sh as the only supported path"
```

---

## Task 14: Update remaining docs

**Files:**
- Modify: `docs/deployment.md`
- Modify: `docs/configuration.md`
- Modify: `docs/secret-rotation.md`
- Modify: `README.md` (if it references setup.sh)

- [ ] **Step 1: Update docs/deployment.md**

Find and replace all references to `bin/setup.sh` with `bin/deploy.sh` in `docs/deployment.md`. Key sections to update:

- "Quick Start (5-Minute Deployment)" — replace the setup.sh step with:

  ```bash
  # 1. Clone the repository
  git clone https://github.com/stephenhoward/pavillion.git
  cd pavillion

  # 2. Run the deploy script (generates secrets, prompts for domain, starts containers)
  bin/deploy.sh
  ```

- "Step-by-Step First Deployment" — replace "Step 2: Generate Secrets with Setup Script" with:

  ```markdown
  ### Step 2: Run bin/deploy.sh

  ```bash
  bin/deploy.sh
  ```

  The deploy script will:

  1. Detect that `.env` is absent → install mode.
  2. Generate all required secrets.
  3. Prompt for your domain name.
  4. Create `config/local.yaml` from the example.
  5. Pull the latest container images.
  6. Start the containers.
  7. Poll `/health` until the app is ready.

  Save the generated secrets to your password manager. They are written
  to `.env` with mode 600 (owner-only), and also to individual files
  under `secrets/` for Docker secrets integration.
  ```

- Remove Step 4 ("Start the Application") — `bin/deploy.sh` handles that.

Run a full-file grep to catch anything missed:

```bash
grep -n "setup.sh" docs/deployment.md
```

Replace any remaining hits with `deploy.sh`.

- [ ] **Step 2: Update docs/configuration.md**

```bash
grep -n "setup.sh" docs/configuration.md
```

Replace each hit with `deploy.sh`. Key updates:

- "Quick Configuration" section — change step 1 to `bin/deploy.sh`.
- "Recommended: Run the setup script" → "Recommended: Run the deploy script".
- Remove/update any setup.sh-specific text.

- [ ] **Step 3: Update docs/secret-rotation.md**

Read it first:

```bash
cat docs/secret-rotation.md | head -30
```

Add a note near the top (after the introduction):

```markdown
## Missing secret after an upgrade

If a new Pavillion version adds a required secret that your `.env` does
not have, `bin/deploy.sh` handles it automatically:

- **`regenerable`** secrets — silently generated.
- **`stable`** secrets — prompted (interactive) or hard-failed
  (non-interactive) with an actionable error.

See `docs/upgrading.md` for the full flow.

This document covers a different case: **intentional rotation of an
existing secret**. That remains a manual procedure, described below.
```

Replace any `bin/setup.sh` references in the existing body with `bin/deploy.sh`.

- [ ] **Step 4: Update README.md if needed**

```bash
grep -n "setup.sh" README.md
```

If hits exist, replace with `deploy.sh`. If no hits, skip this step.

- [ ] **Step 5: Verify no stale references remain**

```bash
grep -rn "bin/setup.sh" docs/ README.md 2>/dev/null
```

Expected: no output (all references updated).

- [ ] **Step 6: Commit**

```bash
git add docs/deployment.md docs/configuration.md docs/secret-rotation.md README.md
git commit -m "docs(deploy): update references from setup.sh to deploy.sh"
```

---

## Task 15: Run full test suite and check-manifest as a final gate

**Files:** none (verification only)

- [ ] **Step 1: Run all bash tests**

Run: `bash bin/test/run.sh`
Expected: `Overall: 3/3 test scripts passed`.

- [ ] **Step 2: Run the manifest lint against the real repo**

Run: `bash bin/check-manifest.sh`
Expected: `check-manifest: all 5 manifest entries are fully wired.`

- [ ] **Step 3: Run ESLint and TypeScript unit tests**

Run: `npm run lint`
Expected: zero errors (warnings OK if pre-existing).

Run: `npm run test:unit`
Expected: all tests pass.

- [ ] **Step 4: Smoke test in a throwaway dir**

Create a scratch copy of the repo to verify the install flow without polluting the real `.env`:

```bash
tmp=$(mktemp -d)
git worktree add "${tmp}/pavillion-scratch" deploy-script-design
cd "${tmp}/pavillion-scratch"
# Verify --help works.
bash bin/deploy.sh --help | head -5
# Clean up.
cd -
git worktree remove "${tmp}/pavillion-scratch"
rm -rf "$tmp"
```

Expected: Help text prints, worktree removed cleanly.

- [ ] **Step 5: No commit in this task**

This task is a verification gate only.

---

## Task 16: Open the pull request

**Files:** none (PR only)

- [ ] **Step 1: Push the branch**

Run:

```bash
git push -u origin deploy-script-design
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(deploy): add bin/deploy.sh as single entry point for install/upgrade" --body "$(cat <<'EOF'
## Summary

Introduces `bin/deploy.sh` as Pavillion's single entry point for install, upgrade, and redeploy, replacing the previous `bin/setup.sh` + `docker compose pull && up -d` split.

A new `bin/deploy-manifest.yaml` declares every required secret. `bin/check-manifest.sh` (wired into CI) verifies each manifest entry is plumbed through `config/custom-environment-variables.yaml`, `docker-compose.yml`, `bin/entrypoint.sh`, and `src/server/common/helper/production-validation.ts`.

Admins who upgrade with a missing `regenerable` secret get it generated silently. Admins who upgrade with a missing `stable` secret get prompted (interactive) or a clear actionable error (non-interactive). The runtime hard-fail stays as a backstop for admins who bypass the script.

Design doc: `docs/superpowers/specs/2026-04-24-deploy-script-design.md`

## Scope

**In:**
- `bin/deploy.sh`, `bin/deploy-manifest.yaml`, `bin/check-manifest.sh`, `bin/lib/manifest.sh`
- Bash test suite under `bin/test/`
- CI workflow `manifest_lint.yaml` wired into `pr.ci.yaml`
- `bin/setup.sh` retired to a forwarding stub
- `docker/staging/deploy.sh` rewritten to call `bin/deploy.sh --non-interactive`
- `production-validation.ts` error messages updated
- `docs/upgrading.md` rewritten; other docs updated to reference `bin/deploy.sh`

**Deferred (explicit non-goals):**
- Automatic pre-upgrade DB backup
- Automatic rollback on failed `up`
- Migration preview / dry-run
- Config-file drift detection beyond the secret manifest

## Test plan

- [ ] `bash bin/test/run.sh` passes locally
- [ ] `bash bin/check-manifest.sh` passes locally
- [ ] `npm run test:unit` passes
- [ ] `npm run lint` produces no new errors
- [ ] Manual: run `bin/deploy.sh --help` in a clean worktree
- [ ] CI: `manifest_lint` job runs and passes
- [ ] After merge: `feat/ics-import-foundation-pv-1qcp` rebases on main, adds `CALENDAR_IMPORT_HMAC_SECRET` as the first `regenerable` entry, and benefits from the CI lint catching any missing plumbing.
EOF
)"
```

- [ ] **Step 3: Return the PR URL**

The `gh pr create` command prints the URL. Capture it for the final summary.

---

## Success Criteria

1. A new admin can run `git clone && cd pavillion && bin/deploy.sh` and get a working instance with one command.
2. `bash bin/check-manifest.sh` returns exit 0 against the current `main` (all 5 manifest entries wired).
3. A PR that adds a manifest entry without updating all four plumbing files fails CI with a clear error naming the missing plumbing.
4. The staging webhook (`docker/staging/deploy.sh`) continues to deploy successfully after this lands.
5. The ICS branch, after rebasing on top of this PR, adds one manifest entry for `CALENDAR_IMPORT_HMAC_SECRET` (stability: regenerable) and inherits auto-generation behavior on upgrade for every existing admin.
