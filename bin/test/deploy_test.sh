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

echo "test: --diff-only reports missing secret names"
tmp=$(mktemp_dir)
setup_workspace "$tmp" "${FIXTURES}/env_missing_one"
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
output=$(cd "$tmp" && bash bin/deploy.sh --diff-only 2>&1 || true)
assert_contains "$output" "ENCRYPTION_KEY" "diff reports the missing secret"

echo "test: generate_secret emits base64-32 for openssl_rand_base64_32"
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
# Ensure prior state from earlier tests is cleared.
rm -f "${tmp}/.deploy-state"
rm -rf "${tmp}/secrets"
mkdir -p "${tmp}/secrets"
output=$(cd "$tmp" && bash bin/deploy.sh --resolve-only 2>&1)
assert_contains "$output" "IMPORT_HMAC" "output mentions the auto-generated secret"
# Verify .env now contains the new secret.
if grep -q "^IMPORT_HMAC=" "${tmp}/.env"; then
  echo "  PASS: .env updated with IMPORT_HMAC"
  _TESTS=$((_TESTS+1))
else
  fail ".env should contain IMPORT_HMAC after resolve"
fi
# Verify secrets/import_hmac.txt exists with mode 600.
if [[ -f "${tmp}/secrets/import_hmac.txt" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    perms=$(stat -f "%Lp" "${tmp}/secrets/import_hmac.txt")
  else
    perms=$(stat -c "%a" "${tmp}/secrets/import_hmac.txt")
  fi
  assert_eq "600" "$perms" "secrets/import_hmac.txt is mode 600"
else
  fail "secrets/import_hmac.txt should exist"
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
if grep -q "^NEW_STABLE_SECRET=" "${tmp}/.env"; then
  echo "  PASS: .env updated with NEW_STABLE_SECRET"
  _TESTS=$((_TESTS+1))
else
  fail ".env should contain NEW_STABLE_SECRET"
fi
if grep -qx "NEW_STABLE_SECRET" "${tmp}/.deploy-state"; then
  echo "  PASS: .deploy-state recorded NEW_STABLE_SECRET"
  _TESTS=$((_TESTS+1))
else
  fail ".deploy-state should now include NEW_STABLE_SECRET"
fi

echo "test: resolve_missing bails on PREVIOUSLY-PROVISIONED 'stable' missing in non-interactive mode"
# Seed .deploy-state with the secret name to simulate "admin had it but lost it".
rm -rf "${tmp}/secrets"
mkdir -p "${tmp}/secrets"
: > "${tmp}/.env"
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

# ---- interactive stable-secret recovery tests ----
#
# These tests cover the highest-risk path in deploy.sh: when a 'stable' secret
# is missing from .env but recorded in .deploy-state, an interactive operator
# is prompted to either paste the original value or type GENERATE. A bug here
# silently destroys encrypted credentials in production, so the path needs
# explicit coverage.
#
# bin/deploy.sh auto-flips to NON_INTERACTIVE when stdin is not a TTY (for
# safety in CI). To exercise the interactive branch from a test we set
# DEPLOY_FORCE_INTERACTIVE=1, which is the test-only escape hatch documented
# alongside that auto-flip in deploy.sh.

setup_recovery_workspace() {
  # Build a workspace where JWT_SECRET is recorded as previously-provisioned
  # but missing from .env, forcing the resolve_missing 'stable' interactive
  # prompt. Echoes the workspace dir on stdout.
  local ws
  ws=$(mktemp_dir)
  setup_workspace "$ws" ""
  : > "${ws}/.env"
  cat > "${ws}/.deploy-state" <<DSEOF
# managed by bin/deploy.sh
JWT_SECRET
DSEOF
  cat > "${ws}/bin/deploy-manifest.yaml" <<MFEOF
secrets:
  - name: JWT_SECRET
    generator: openssl_rand_base64_32
    stability: stable
    description: Test JWT secret.
MFEOF
  echo "$ws"
}

echo "test: resolve_missing interactive: typing GENERATE creates a fresh secret"
tmp_recover_gen=$(setup_recovery_workspace)
output=$(cd "$tmp_recover_gen" && \
  printf 'GENERATE\n' | DEPLOY_FORCE_INTERACTIVE=1 bash bin/deploy.sh --resolve-only 2>&1; \
  echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "0" "$exit_code" "GENERATE keyword causes resolve_missing to exit 0"
assert_contains "$output" "Generated new JWT_SECRET" "log records that a new value was generated"
if grep -q "^JWT_SECRET=" "${tmp_recover_gen}/.env"; then
  echo "  PASS: .env now contains JWT_SECRET"
  _TESTS=$((_TESTS+1))
else
  fail ".env should contain JWT_SECRET after GENERATE"
fi
# Recovered value must be non-empty and not the literal sentinel.
recovered_gen=$(grep '^JWT_SECRET=' "${tmp_recover_gen}/.env" | head -n1 | cut -d= -f2-)
if [[ -n "$recovered_gen" && "$recovered_gen" != "GENERATE" ]]; then
  echo "  PASS: generated JWT_SECRET is a real value (not the GENERATE keyword)"
  _TESTS=$((_TESTS+1))
else
  fail "generated JWT_SECRET should be a real value, got: ${recovered_gen}"
fi

echo "test: resolve_missing interactive: pasted value is stored verbatim"
tmp_recover_paste=$(setup_recovery_workspace)
PASTED='pasted-secret-12345'
output=$(cd "$tmp_recover_paste" && \
  printf '%s\n' "$PASTED" | DEPLOY_FORCE_INTERACTIVE=1 bash bin/deploy.sh --resolve-only 2>&1; \
  echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "0" "$exit_code" "pasted value causes resolve_missing to exit 0"
recovered_paste=$(grep '^JWT_SECRET=' "${tmp_recover_paste}/.env" | head -n1 | cut -d= -f2-)
assert_eq "$PASTED" "$recovered_paste" "pasted value lands verbatim in .env"
# The paste path must NOT log "Generated new" — that would mean we silently
# regenerated when the operator was trying to restore.
if [[ "$output" != *"Generated new JWT_SECRET"* ]]; then
  echo "  PASS: paste path did not regenerate the secret"
  _TESTS=$((_TESTS+1))
else
  fail "paste path should not have generated a new secret"
fi

echo "test: resolve_missing interactive: empty input aborts with non-zero exit"
tmp_recover_empty=$(setup_recovery_workspace)
output=$(cd "$tmp_recover_empty" && \
  printf '\n' | DEPLOY_FORCE_INTERACTIVE=1 bash bin/deploy.sh --resolve-only 2>&1; \
  echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
# resolve_missing returns 2 on stable-secret failure (any non-zero is a
# correct fail-safe; we assert the documented code).
assert_eq "2" "$exit_code" "empty input aborts with exit 2"
assert_contains "$output" "Empty response" "error message identifies the empty input"
# .env must NOT contain JWT_SECRET — the script has to fail closed rather
# than write garbage.
if ! grep -q "^JWT_SECRET=" "${tmp_recover_empty}/.env"; then
  echo "  PASS: .env unchanged after empty-input abort"
  _TESTS=$((_TESTS+1))
else
  fail ".env should NOT contain JWT_SECRET after empty-input abort"
fi

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
if [[ -f "${tmp}/.deploy-state" ]]; then
  echo "  PASS: .deploy-state created"
  _TESTS=$((_TESTS+1))
else
  fail ".deploy-state should exist"
fi
if grep -qx "JWT_SECRET" "${tmp}/.deploy-state"; then
  echo "  PASS: .deploy-state seeded with JWT_SECRET"
  _TESTS=$((_TESTS+1))
else
  fail "JWT_SECRET should be in seeded .deploy-state"
fi
if grep -qx "SESSION_SECRET" "${tmp}/.deploy-state"; then
  echo "  PASS: .deploy-state seeded with SESSION_SECRET"
  _TESTS=$((_TESTS+1))
else
  fail "SESSION_SECRET should be in seeded .deploy-state"
fi

# ---- install-mode tests ----

echo "test: install mode non-interactive requires --domain"
tmp2=$(mktemp_dir)
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
if grep -q "test.example.org" "${tmp2}/config/local.yaml"; then
  echo "  PASS: local.yaml contains substituted domain"
  _TESTS=$((_TESTS+1))
else
  fail "local.yaml should contain test.example.org"
fi

echo "test: install mode leaves existing config/local.yaml untouched"
tmp2b=$(mktemp_dir)
setup_workspace "$tmp2b" ""
cp "${SCRIPT_DIR}/../deploy-manifest.yaml" "${tmp2b}/bin/"
mkdir -p "${tmp2b}/config"
echo 'domain: "pavillion.example.org"' > "${tmp2b}/config/local.yaml.example"
echo 'domain: "preexisting.example.org"' > "${tmp2b}/config/local.yaml"
output=$(cd "$tmp2b" && bash bin/deploy.sh --non-interactive --domain=test.example.org --install-only 2>&1; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "0" "$exit_code" "install with existing local.yaml succeeds (exit 0)"
assert_contains "$output" "already exists" "warns that local.yaml already exists"
if grep -q "preexisting.example.org" "${tmp2b}/config/local.yaml"; then
  echo "  PASS: existing local.yaml left untouched"
  _TESTS=$((_TESTS+1))
else
  fail "existing local.yaml should not have been overwritten"
fi

echo "test: install mode errors when local.yaml.example is missing"
tmp2c=$(mktemp_dir)
setup_workspace "$tmp2c" ""
cp "${SCRIPT_DIR}/../deploy-manifest.yaml" "${tmp2c}/bin/"
# Intentionally do NOT create config/local.yaml.example
output=$(cd "$tmp2c" && bash bin/deploy.sh --non-interactive --domain=test.example.org --install-only 2>&1; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "1" "$exit_code" "install fails when local.yaml.example is missing"
assert_contains "$output" "local.yaml.example" "error mentions local.yaml.example"

# ---- upgrade-mode git pull tests ----

echo "test: upgrade mode fails on dirty working tree"
tmp3=$(mktemp_dir)
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

# ---- docker / health-check tests (using shims) ----

echo "test: docker ops call the expected commands (shim)"
tmp4=$(mktemp_dir)
setup_workspace "$tmp4" "${FIXTURES}/env_complete"
cp "${SCRIPT_DIR}/../deploy-manifest.yaml" "${tmp4}/bin/"
# Per-test workspace paths for shim state. Keeping these inside ${tmp4} (as
# opposed to a fixed /tmp path) avoids cross-talk between parallel CI runs and
# leaves no residue between local invocations.
DOCKER_LOG="${tmp4}/deploy_test_docker.log"
CURL_LOG="${tmp4}/deploy_test_curl.log"
CURL_STATE="${tmp4}/deploy_test_curl_state"
# Create a docker shim that records its arguments. The heredoc is unquoted so
# that DOCKER_LOG is interpolated into the shim script itself.
mkdir -p "${tmp4}/shim"
cat > "${tmp4}/shim/docker" <<EOF
#!/usr/bin/env bash
echo "docker \$*" >> "${DOCKER_LOG}"
exit 0
EOF
chmod +x "${tmp4}/shim/docker"
# Create a curl shim that immediately succeeds (simulating /health OK).
cat > "${tmp4}/shim/curl" <<EOF
#!/usr/bin/env bash
echo "curl \$*" >> "${CURL_LOG}"
# Simulate 200 OK.
exit 0
EOF
chmod +x "${tmp4}/shim/curl"

rm -f "${DOCKER_LOG}" "${CURL_LOG}"

output=$(cd "$tmp4" && PATH="${tmp4}/shim:${PATH}" bash bin/deploy.sh --non-interactive --docker-only --health-timeout=5 2>&1; echo "EXIT:$?")
exit_code="${output##*EXIT:}"
assert_eq "0" "$exit_code" "docker-only path exits 0 with successful shims"
assert_contains "$(cat "${DOCKER_LOG}")" "compose pull" "docker compose pull was invoked"
assert_contains "$(cat "${DOCKER_LOG}")" "compose up -d" "docker compose up -d was invoked"

echo "test: health check polls until success"
# Simulate curl failing twice then succeeding. CURL_STATE is interpolated
# into the heredoc so each test gets its own counter file.
cat > "${tmp4}/shim/curl" <<EOF
#!/usr/bin/env bash
STATE_FILE="${CURL_STATE}"
count=\$(cat "\$STATE_FILE" 2>/dev/null || echo 0)
count=\$((count+1))
echo "\$count" > "\$STATE_FILE"
if (( count < 3 )); then
  exit 7   # connection refused
fi
exit 0
EOF
chmod +x "${tmp4}/shim/curl"
rm -f "${CURL_STATE}" "${DOCKER_LOG}"
output=$(cd "$tmp4" && PATH="${tmp4}/shim:${PATH}" bash bin/deploy.sh --non-interactive --docker-only --health-timeout=10 2>&1; echo "EXIT:$?")
exit_code="${output##*EXIT:}"
assert_eq "0" "$exit_code" "health check succeeds after initial failures"

echo "test: health check times out with exit 4"
cat > "${tmp4}/shim/curl" <<'EOF'
#!/usr/bin/env bash
exit 7
EOF
chmod +x "${tmp4}/shim/curl"
output=$(cd "$tmp4" && PATH="${tmp4}/shim:${PATH}" bash bin/deploy.sh --non-interactive --docker-only --health-timeout=3 2>&1; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "4" "$exit_code" "health-check timeout exits with code 4"

# tmp4 (and its shim state files) is cleaned up by mktemp_dir's EXIT trap.

report_results
