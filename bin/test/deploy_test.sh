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
tmp=$(mktemp -d); trap "rm -rf '${tmp}'" EXIT
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
  perms=$(stat -f "%Lp" "${tmp}/secrets/import_hmac.txt" 2>/dev/null || stat -c "%a" "${tmp}/secrets/import_hmac.txt")
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

report_results
