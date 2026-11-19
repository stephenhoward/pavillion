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
assert_contains "$output" "--health-timeout" "help output lists --health-timeout, the flag after the settings text"
assert_contains "$output" "never sourced or evaled" "help output states the .env parsing rule"

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
# Note: use `printf` not `echo` — `\t` interpretation in echo varies by shell/platform.
{
  printf 'JWT_SECRET\topenssl_rand_base64_32\tstable\tA.\n'
  printf 'SESSION_SECRET\topenssl_rand_base64_32\tstable\tB.\n'
  printf 'DB_PASSWORD\topenssl_rand_base64_32\tstable\tC.\n'
  printf 'EMAIL_HASH_SECRET\topenssl_rand_base64_32\tstable\tD.\n'
  printf 'ENCRYPTION_KEY\topenssl_rand_hex_32\tstable\tE.\n'
} > "${tmp}/bin/deploy-manifest.tsv"
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
{
  printf 'JWT_SECRET\topenssl_rand_base64_32\tstable\tA.\n'
  printf 'IMPORT_HMAC\topenssl_rand_base64_32\tregenerable\tB.\n'
} > "${tmp}/bin/deploy-manifest.tsv"
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
{
  printf 'JWT_SECRET\topenssl_rand_base64_32\tstable\tA.\n'
  printf 'NEW_STABLE_SECRET\topenssl_rand_base64_32\tstable\tNewly introduced this release.\n'
} > "${tmp}/bin/deploy-manifest.tsv"
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
{
  printf 'JWT_SECRET\topenssl_rand_base64_32\tstable\tA.\n'
} > "${tmp}/bin/deploy-manifest.tsv"
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
  printf 'JWT_SECRET\topenssl_rand_base64_32\tstable\tTest JWT secret.\n' \
    > "${ws}/bin/deploy-manifest.tsv"
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
{
  printf 'JWT_SECRET\topenssl_rand_base64_32\tstable\tA.\n'
  printf 'SESSION_SECRET\topenssl_rand_base64_32\tstable\tB.\n'
} > "${tmp}/bin/deploy-manifest.tsv"
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
cp "${SCRIPT_DIR}/../deploy-manifest.tsv" "${tmp2}/bin/"
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
cp "${SCRIPT_DIR}/../deploy-manifest.tsv" "${tmp2b}/bin/"
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
cp "${SCRIPT_DIR}/../deploy-manifest.tsv" "${tmp2c}/bin/"
# Intentionally do NOT create config/local.yaml.example
output=$(cd "$tmp2c" && bash bin/deploy.sh --non-interactive --domain=test.example.org --install-only 2>&1; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "1" "$exit_code" "install fails when local.yaml.example is missing"
assert_contains "$output" "local.yaml.example" "error mentions local.yaml.example"

# ---- upgrade-mode git pull tests ----

echo "test: upgrade mode fails on dirty working tree"
tmp3=$(mktemp_dir)
setup_workspace "$tmp3" "${FIXTURES}/env_complete"
cp "${SCRIPT_DIR}/../deploy-manifest.tsv" "${tmp3}/bin/"
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
cp "${SCRIPT_DIR}/../deploy-manifest.tsv" "${tmp4}/bin/"
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

echo "test: health check URL follows APP_PORT (bare port, host:port, default)"
cat > "${tmp4}/shim/curl" <<EOF
#!/usr/bin/env bash
echo "curl \$*" >> "${CURL_LOG}"
exit 0
EOF
chmod +x "${tmp4}/shim/curl"
rm -f "${CURL_LOG}"
(cd "$tmp4" && APP_PORT=8080 PATH="${tmp4}/shim:${PATH}" bash bin/deploy.sh --non-interactive --docker-only --health-timeout=5 >/dev/null 2>&1)
assert_contains "$(cat "${CURL_LOG}")" "http://localhost:8080/health" "bare APP_PORT polls localhost on that port"
rm -f "${CURL_LOG}"
(cd "$tmp4" && APP_PORT=127.0.0.1:3000 PATH="${tmp4}/shim:${PATH}" bash bin/deploy.sh --non-interactive --docker-only --health-timeout=5 >/dev/null 2>&1)
assert_contains "$(cat "${CURL_LOG}")" "http://127.0.0.1:3000/health" "host:port APP_PORT polls that host and port"
rm -f "${CURL_LOG}"
(cd "$tmp4" && unset APP_PORT && PATH="${tmp4}/shim:${PATH}" bash bin/deploy.sh --non-interactive --docker-only --health-timeout=5 >/dev/null 2>&1)
assert_contains "$(cat "${CURL_LOG}")" "http://127.0.0.1:3000/health" "unset APP_PORT polls the loopback default"

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

# ---- helper table tests (deploy.sh sourced; main is guarded) ----

# with_deploy <root> [NAME=value ...] <function> [args...]
# Sources deploy.sh in a subshell rooted at <root>, exports each leading
# NAME=value into the shell environment, and calls <function>. The settings
# deploy.sh resolves are unset first, since a developer's shell may export them.
with_deploy() {
  local root="$1"
  shift
  (
    unset DOMAIN APP_PORT COMPOSE_PROFILES BACKUP_HOST_DIR
    # shellcheck source=../deploy.sh
    source "${DEPLOY}"
    REPO_ROOT="$root"
    ENV_FILE="${root}/.env"
    while [[ "${1:-}" == [A-Z_]*=* ]]; do
      export "$1"
      shift
    done
    "$@"
  )
}

# outcome <command...> -> prints "yes" if the command succeeds, "no" otherwise
outcome() {
  if "$@" >/dev/null 2>&1; then echo yes; else echo no; fi
}

ws_helpers=$(mktemp_dir)

echo "test: standalone_active reads COMPOSE_PROFILES as a comma list"
while IFS='|' read -r profiles expected label; do
  printf 'COMPOSE_PROFILES=%s\n' "$profiles" > "${ws_helpers}/.env"
  assert_eq "$expected" "$(outcome with_deploy "$ws_helpers" standalone_active)" "standalone_active: ${label}"
done <<'TABLE'
standalone|yes|standalone alone
foo,standalone|yes|standalone among others
standalone-x|no|a name that only starts with standalone
|no|empty value
TABLE
printf 'COMPOSE_PROFILES=foo\n' > "${ws_helpers}/.env"
assert_eq "yes" "$(outcome with_deploy "$ws_helpers" COMPOSE_PROFILES=standalone standalone_active)" \
  "standalone_active: shell value wins over .env"
printf 'COMPOSE_PROFILES=standalone\n' > "${ws_helpers}/.env"
assert_eq "no" "$(outcome with_deploy "$ws_helpers" COMPOSE_PROFILES=foo standalone_active)" \
  "standalone_active: shell value without standalone wins over .env with it"

echo "test: local_yaml_domain reads the top-level domain key"
mkdir -p "${ws_helpers}/config"
while IFS='|' read -r content expected label; do
  printf '%b' "$content" > "${ws_helpers}/config/local.yaml"
  assert_eq "$expected" "$(with_deploy "$ws_helpers" local_yaml_domain)" "local_yaml_domain: ${label}"
done <<'TABLE'
# comment\ndomain: "events.example.org"\n|events.example.org|quoted
domain: events.example.org\n|events.example.org|unquoted
domain: 'events.example.org' # note\n|events.example.org|single-quoted with a trailing comment
db:\n  host: x\n||absent
federation:\n  domain: "nested.example.org"\n||indented under a nested key
TABLE
rm -f "${ws_helpers}/config/local.yaml"
assert_eq "" "$(with_deploy "$ws_helpers" local_yaml_domain)" "local_yaml_domain: no file prints nothing"

echo "test: env_get parses .env without sourcing it"
cat > "${ws_helpers}/.env" <<'ENVEOF'
DQ="double quoted"
SQ='single quoted'
MIXED="unmatched'
TWICE=first
TWICE=second
COMMENTED=x.example.org # note
EMPTY=
INJECT=$(touch injected)
ENVEOF
while IFS='|' read -r name expected label; do
  assert_eq "$expected" "$(with_deploy "$ws_helpers" env_get "${ws_helpers}/.env" "$name")" "env_get: ${label}"
done <<'TABLE'
DQ|double quoted|double quotes removed
SQ|single quoted|single quotes removed
MIXED|"unmatched'|unmatched quotes kept
TWICE|second|last of two lines wins
COMMENTED|x.example.org|unquoted inline comment stripped, as Compose does
EMPTY||empty value
MISSING||missing name prints nothing
INJECT|$(touch injected)|command substitution is returned literally
TABLE
if [[ ! -e "${ws_helpers}/injected" ]]; then
  echo "  PASS: env_get never evaluates a value"
  _TESTS=$((_TESTS+1))
else
  fail "env_get evaluated a value"
fi

echo "test: resolve_setting precedence is shell, then .env, then default"
printf 'APP_PORT=9000\n' > "${ws_helpers}/.env"
assert_eq "8080" "$(with_deploy "$ws_helpers" APP_PORT=8080 resolve_setting APP_PORT 3000)" "resolve_setting: shell value wins"
assert_eq "9000" "$(with_deploy "$ws_helpers" resolve_setting APP_PORT 3000)" "resolve_setting: .env value next"
assert_eq "3000" "$(with_deploy "$ws_helpers" APP_PORT= resolve_setting APP_PORT 3000)" \
  "resolve_setting: a variable exported empty wins over .env and falls to the default"
: > "${ws_helpers}/.env"
assert_eq "3000" "$(with_deploy "$ws_helpers" resolve_setting APP_PORT 3000)" "resolve_setting: default last"
printf 'APP_PORT=\n' > "${ws_helpers}/.env"
assert_eq "3000" "$(with_deploy "$ws_helpers" resolve_setting APP_PORT 3000)" "resolve_setting: an empty .env value is absent"
rm -f "${ws_helpers}/.env"
assert_eq "3000" "$(with_deploy "$ws_helpers" resolve_setting APP_PORT 3000)" "resolve_setting: no .env falls to the default"

echo "test: env_append keeps a last line that has no trailing newline"
printf 'JWT_SECRET=abc' > "${ws_helpers}/.env"
with_deploy "$ws_helpers" env_append "${ws_helpers}/.env" DOMAIN events.example.org
assert_eq "$(printf 'JWT_SECRET=abc\nDOMAIN=events.example.org')" "$(cat "${ws_helpers}/.env")" \
  "env_append writes a newline before appending to an unterminated file"
with_deploy "$ws_helpers" env_append "${ws_helpers}/.env" APP_PORT 8080
assert_eq "$(printf 'JWT_SECRET=abc\nDOMAIN=events.example.org\nAPP_PORT=8080')" "$(cat "${ws_helpers}/.env")" \
  "env_append adds no blank line to a terminated file"
rm -f "${ws_helpers}/.env"
with_deploy "$ws_helpers" env_append "${ws_helpers}/.env" DOMAIN events.example.org
assert_eq "DOMAIN=events.example.org" "$(cat "${ws_helpers}/.env")" "env_append creates a missing file with no leading blank line"
if [[ "$(uname)" == "Darwin" ]]; then
  perms=$(stat -f "%Lp" "${ws_helpers}/.env")
else
  perms=$(stat -c "%a" "${ws_helpers}/.env")
fi
assert_eq "600" "$perms" "env_append creates a missing .env with mode 600"

echo "test: validate_domain applies the lowercase RFC 1123 rule"
label63=$(printf 'a%.0s' $(seq 1 63))
label64=$(printf 'a%.0s' $(seq 1 64))
too_long="${label63}.${label63}.${label63}.${label63}"
while IFS='|' read -r value expected label; do
  assert_eq "$expected" "$(outcome with_deploy "$ws_helpers" validate_domain "$value")" "validate_domain: ${label}"
done <<TABLE
events.example.org|yes|accepts a normal subdomain
a-b.example.org|yes|accepts an interior hyphen
${label63}.example.org|yes|accepts a 63-character label
https://events.example.org|no|rejects a scheme
events.example.org:443|no|rejects a port
events.example.org/path|no|rejects a path
admin@events.example.org|no|rejects userinfo
Events.example.org|no|rejects uppercase letters
events example.org|no|rejects a space
${too_long}|no|rejects input over 253 characters
${label64}.example.org|no|rejects a label over 63 characters
-events.example.org|no|rejects a leading hyphen in a label
events-.example.org|no|rejects a trailing hyphen in a label
events.example.org.|no|rejects a trailing dot
events..example.org|no|rejects an empty label
203.0.113.10|no|rejects an all-numeric name
|no|rejects empty input
TABLE

echo "test: validate_app_port accepts a port or address:port"
while IFS='|' read -r value expected label; do
  assert_eq "$expected" "$(outcome with_deploy "$ws_helpers" validate_app_port "$value")" "validate_app_port: ${label}"
done <<'TABLE'
8080|yes|accepts a bare port
127.0.0.1:3000|yes|accepts address:port
|no|rejects empty input
abc|no|rejects letters
127.0.0.1:|no|rejects a missing port
:3000|no|rejects a missing address
localhost:3000|no|rejects a hostname
8080 |no|rejects trailing whitespace
3000/tcp|no|rejects a protocol suffix
TABLE

echo "test: an exported DOMAIN reaches child processes unchanged"
tmp5=$(mktemp_dir)
setup_workspace "$tmp5" "${FIXTURES}/env_complete"
mkdir -p "${tmp5}/shim"
cat > "${tmp5}/shim/docker" <<EOF
#!/usr/bin/env bash
echo "DOMAIN=\${DOMAIN-<unset>}" >> "${tmp5}/docker_env.log"
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "${tmp5}/shim/curl"
chmod +x "${tmp5}/shim/docker" "${tmp5}/shim/curl"
(cd "$tmp5" && DOMAIN=operator.example.org PATH="${tmp5}/shim:${PATH}" \
  bash bin/deploy.sh --non-interactive --domain=flag.example.org --docker-only --health-timeout=5 >/dev/null 2>&1)
assert_eq "DOMAIN=operator.example.org" "$(head -n1 "${tmp5}/docker_env.log")" "--domain does not clobber an exported DOMAIN"
rm -f "${tmp5}/docker_env.log"
(cd "$tmp5" && unset DOMAIN && PATH="${tmp5}/shim:${PATH}" \
  bash bin/deploy.sh --non-interactive --domain=flag.example.org --docker-only --health-timeout=5 >/dev/null 2>&1)
assert_eq "DOMAIN=<unset>" "$(head -n1 "${tmp5}/docker_env.log")" "--domain is never exported as DOMAIN"

report_results
