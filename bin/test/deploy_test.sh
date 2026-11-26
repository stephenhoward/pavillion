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

# ---- application image retention (stateful docker shim) ----
#
# The shim below keeps a fake image store and container list and answers
# the docker calls bin/deploy.sh makes, so each case can check what an
# upgrade leaves behind. Output shapes (12-character short ids, '<none>' tag
# rows for images that keep only a digest, sizes in bytes from image
# inspect, `compose config --images app` listing app's dependency first)
# were taken from Docker 20.10 with the classic (overlay2) image store; every
# value — ids, digests, repository names, sizes — is synthetic. The shim
# models one output shape and does not claim to tell image stores apart.

DOCKER_SHIM="${_MKTEMP_ROOT}/docker-shim"
cat > "$DOCKER_SHIM" <<'SHIM'
#!/usr/bin/env bash
# State lives in $SHIM_STATE:
#   images         id|size|ref,ref,...     (refs are repo:tag or repo@digest)
#   containers     container id|image id|config image|running or exited|service
#   config_images  what `compose config --images app` prints
#   app_ref        the reference `compose up` starts app from
#   pull_plan      ref|image id|size|digest ref, applied by `compose pull`
#   fail           keys that make a call fail: pull, up, ps, inspect,
#                  image_ls, rm:<arg>
#   calls          every call, its arguments joined by '|'
set -u
S="$SHIM_STATE"
{ printf 'docker'; printf '|%s' "$@"; printf '\n'; } >> "$S/calls"

fails() { grep -Fqx -- "$1" "$S/fail" 2>/dev/null; }

ref_repo() {
  local r="${1%%@*}"
  if [[ "${r##*/}" == *:* ]]; then echo "${r%:*}"; else echo "$r"; fi
}

is_id() { [[ "$1" =~ ^(sha256:)?[abcdef0123456789]{12,64}$ ]]; }

# find_image <id, short id or reference> -> stdout: the stored id.
find_image() {
  local want="$1" id size refs
  while IFS='|' read -r id size refs; do
    [[ -n "$id" ]] || continue
    if is_id "$want"; then
      [[ "$id" == "sha256:${want#sha256:}"* ]] && { echo "$id"; return 0; }
    else
      [[ ",${refs}," == *",${want},"* ]] && { echo "$id"; return 0; }
    fi
  done < "$S/images"
  return 1
}

field() { awk -F'|' -v id="$1" -v n="$2" '$1 == id { print $n }' "$S/images"; }

set_refs() {
  awk -F'|' -v OFS='|' -v id="$1" -v refs="$2" '$1 == id { $3 = refs } { print }' \
    "$S/images" > "$S/images.new" && mv "$S/images.new" "$S/images"
}

delete_image() {
  awk -F'|' -v id="$1" '$1 != id' "$S/images" > "$S/images.new" && mv "$S/images.new" "$S/images"
}

# drop_ref <ref>: remove <ref> from every image.
drop_ref() {
  local id size refs out r
  while IFS='|' read -r id size refs; do
    out=""
    for r in ${refs//,/ }; do [[ "$r" == "$1" ]] || out="${out:+${out},}${r}"; done
    printf '%s|%s|%s\n' "$id" "$size" "$out"
  done < "$S/images" > "$S/images.new" && mv "$S/images.new" "$S/images"
}

add_ref() {
  local refs
  refs=$(field "$1" 3)
  set_refs "$1" "${refs:+${refs},}$2"
}

in_use() { awk -F'|' -v id="$1" '$2 == id { found = 1 } END { exit !found }' "$S/containers"; }

json_refs() {
  local kind="$1" refs="$2" out="" r
  for r in ${refs//,/ }; do
    if [[ "$kind" == tags && "$r" != *@* ]] || [[ "$kind" == digests && "$r" == *@* ]]; then
      out="${out:+${out},}\"${r}\""
    fi
  done
  printf '[%s]' "$out"
}

image_inspect() {
  local format="$1"; shift
  local rc=0 ref id out
  for ref in "$@"; do
    if ! id=$(find_image "$ref"); then
      echo "Error: No such image: ${ref}" >&2
      rc=1
      continue
    fi
    out="$format"
    out="${out//\{\{.Id\}\}/$id}"
    out="${out//\{\{.Size\}\}/$(field "$id" 2)}"
    out="${out//\{\{json .RepoTags\}\}/$(json_refs tags "$(field "$id" 3)")}"
    out="${out//\{\{json .RepoDigests\}\}/$(json_refs digests "$(field "$id" 3)")}"
    echo "$out"
  done
  return "$rc"
}

container_inspect() {
  local format="$1"; shift
  [[ "$format" == '{{.Image}}' ]] && fails inspect && { echo "inspect failed" >&2; exit 1; }
  local want cid img cfg state svc out
  for want in "$@"; do
    while IFS='|' read -r cid img cfg state svc; do
      [[ "$cid" == "$want" ]] || continue
      out="${format//\{\{.Image\}\}/$img}"
      echo "${out//\{\{.Config.Image\}\}/$cfg}"
    done < "$S/containers"
  done
}

image_ls() {
  fails image_ls && { echo "image ls failed" >&2; exit 1; }
  local repo="$1" id size refs r tags digest short
  while IFS='|' read -r id size refs; do
    [[ -n "$id" ]] || continue
    tags=""; digest=""
    for r in ${refs//,/ }; do
      [[ "$(ref_repo "$r")" == "$repo" ]] || continue
      if [[ "$r" == *@* ]]; then digest=1; else tags="${tags} ${r##*:}"; fi
    done
    short="${id#sha256:}"; short="${short:0:12}"
    if [[ -n "$tags" ]]; then
      for r in $tags; do echo "${short} ${r}"; done
    elif [[ -n "$digest" ]]; then
      echo "${short} <none>"
    fi
  done < "$S/images"
}

image_rm() {
  local x="$1" id
  fails "rm:${x}" && { echo "Error response from daemon: conflict: unable to remove ${x}" >&2; exit 1; }
  id=$(find_image "$x") || { echo "Error: No such image: ${x}" >&2; exit 1; }
  local refs r repo kept=""
  refs=$(field "$id" 3)
  if is_id "$x"; then
    in_use "$id" && { echo "Error response from daemon: conflict: image is being used by a container" >&2; exit 1; }
    local repos=""
    for r in ${refs//,/ }; do repo=$(ref_repo "$r"); [[ " $repos " == *" $repo "* ]] || repos="${repos} ${repo}"; done
    [[ "$(echo $repos | wc -w)" -le 1 ]] || { echo "Error response from daemon: conflict: image is referenced in multiple repositories" >&2; exit 1; }
    delete_image "$id"
    echo "Deleted: ${id}"
    return 0
  fi
  repo=$(ref_repo "$x")
  local tag_left=""
  for r in ${refs//,/ }; do
    [[ "$r" == "$x" ]] && continue
    [[ "$r" != *@* && "$(ref_repo "$r")" == "$repo" ]] && tag_left=1
    kept="${kept:+${kept},}${r}"
  done
  if [[ -z "$tag_left" ]]; then
    local rest=""
    for r in ${kept//,/ }; do
      [[ "$r" == *@* && "$(ref_repo "$r")" == "$repo" ]] || rest="${rest:+${rest},}${r}"
    done
    kept="$rest"
  fi
  echo "Untagged: ${x}"
  if [[ -z "$kept" ]] && ! in_use "$id"; then
    delete_image "$id"
    echo "Deleted: ${id}"
  else
    set_refs "$id" "$kept"
  fi
}

compose() {
  case "${1:-}" in
    config) cat "$S/config_images" ;;
    ps)
      local cid img cfg state svc
      while IFS='|' read -r cid img cfg state svc; do
        [[ "$svc" == app && "$state" == running ]] && echo "$cid"
      done < "$S/containers"
      return 0
      ;;
    pull)
      fails pull && { echo "Error: pull failed" >&2; exit 1; }
      local ref id size digest
      while IFS='|' read -r ref id size digest; do
        [[ -n "$ref" ]] || continue
        drop_ref "$ref"
        if find_image "$id" >/dev/null; then
          add_ref "$id" "$ref"
        else
          printf '%s|%s|%s,%s\n' "$id" "$size" "$ref" "$digest" >> "$S/images"
        fi
      done < "$S/pull_plan"
      ;;
    up)
      fails up && { echo "Error: up failed" >&2; exit 1; }
      local ref id
      ref=$(cat "$S/app_ref")
      id=$(find_image "$ref") || exit 1
      awk -F'|' '$5 != "app"' "$S/containers" > "$S/containers.new"
      printf '%s|%s|%s|running|app\n' "$(printf 'a%.0s' $(seq 1 64))" "$id" "$ref" >> "$S/containers.new"
      mv "$S/containers.new" "$S/containers"
      ;;
  esac
  return 0
}

case "${1:-}" in
  compose) shift; compose "$@" ;;
  inspect) shift; [[ "$1" == --format ]] && shift; f="$1"; shift; container_inspect "$f" "$@" ;;
  ps) fails ps && { echo "ps failed" >&2; exit 1; }; cut -d'|' -f1 "$S/containers" | grep -v '^$' || true ;;
  image)
    case "${2:-}" in
      inspect) shift 2; [[ "$1" == --format ]] && shift; f="$1"; shift; image_inspect "$f" "$@" ;;
      ls) image_ls "$3" ;;
      rm) image_rm "$3" ;;
    esac
    ;;
  tag)
    id=$(find_image "$2") || { echo "Error: No such image: $2" >&2; exit 1; }
    drop_ref "$3"
    add_ref "$id" "$3"
    ;;
esac
exit $?
SHIM
chmod +x "$DOCKER_SHIM"

# rep <char> <count> -> stdout: <char> repeated <count> times.
rep() { local out="" i; for ((i = 0; i < $2; i++)); do out="${out}$1"; done; printf '%s' "$out"; }
# Synthetic ids: image n is sha256:nnnn…, its digest sha256:ffff…nnnn…,
# container n is cccc…n.
img_id() { printf 'sha256:%s' "$(rep "$1" 64)"; }
img_digest() { printf 'sha256:%s%s' "$(rep f 32)" "$(rep "$1" 32)"; }
ctr_id() { printf '%s%s' "$(rep c 63)" "$1"; }

IMG_SIZE=400000000
APP_REPO="ghcr.example.test/pavillion"

# image_ws <repo> <configured tag> -> stdout: a workspace whose shim state
# has a running database container, the app's dependency listed first in
# `compose config --images app`, and an unrelated repository's image.
image_ws() {
  local repo="$1" tag="$2" ws
  ws=$(mktemp_dir)
  setup_workspace "$ws" "${FIXTURES}/env_complete"
  mkdir -p "${ws}/shim" "${ws}/state"
  cp "$DOCKER_SHIM" "${ws}/shim/docker"
  printf '#!/usr/bin/env bash\nexit 0\n' > "${ws}/shim/curl"
  chmod +x "${ws}/shim/curl"
  printf 'postgres:17\n%s:%s\n' "$repo" "$tag" > "${ws}/state/config_images"
  printf '%s:%s\n' "$repo" "$tag" > "${ws}/state/app_ref"
  {
    printf '%s|300000000|postgres:17,postgres@%s\n' "$(img_id 9)" "$(img_digest 9)"
    printf '%s|90000000|other.example.test/tool:1\n' "$(img_id 8)"
  } > "${ws}/state/images"
  printf '%s|%s|postgres:17|running|db\n' "$(ctr_id 9)" "$(img_id 9)" > "${ws}/state/containers"
  : > "${ws}/state/pull_plan"
  : > "${ws}/state/fail"
  : > "${ws}/state/calls"
  echo "$ws"
}

# add_image <ws> <n> <refs> — refs comma-separated.
add_image() { printf '%s|%s|%s\n' "$(img_id "$2")" "$IMG_SIZE" "$3" >> "$1/state/images"; }
# add_container <ws> <n> <image n> <config image> <running|exited> <service>
add_container() {
  printf '%s|%s|%s|%s|%s\n' "$(ctr_id "$2")" "$(img_id "$3")" "$4" "$5" "$6" >> "$1/state/containers"
}
# plan_pull <ws> <ref> <image n> — the next pull moves <ref> to image n.
plan_pull() { printf '%s|%s|%s|%s\n' "$2" "$(img_id "$3")" "$IMG_SIZE" "${2%:*}@$(img_digest "$3")" > "$1/state/pull_plan"; }

# deploy_images <ws> [NAME=value ...] -> stdout: the run's output, then EXIT:<code>.
deploy_images() {
  local ws="$1"
  shift
  (
    unset PAVILLION_IMAGE_TAG APP_PORT
    cd "$ws" && env "$@" PATH="${ws}/shim:${PATH}" SHIM_STATE="${ws}/state" \
      bash bin/deploy.sh --non-interactive --docker-only --health-timeout=3 2>&1
    echo "EXIT:$?"
  ) || true
}

has_image() {
  if awk -F'|' -v id="$(img_id "$2")" '$1 == id { found = 1 } END { exit !found }' "$1/state/images"; then
    echo yes
  else
    echo no
  fi
}
refs_of() { awk -F'|' -v id="$(img_id "$2")" '$1 == id { print $3 }' "$1/state/images"; }
# tagged <ws> <image n> <ref> -> yes if image n carries <ref>.
tagged() { if [[ ",$(refs_of "$1" "$2")," == *",$3,"* ]]; then echo yes; else echo no; fi; }
count_lines() { printf '%s\n' "$1" | grep -c -- "$2" || true; }

# assert_safe_calls <ws> <repo> <label> [expected image rm argument ...]
# The shared check every image case runs: each docker call is one of the
# allowlisted subcommands; every `image rm` has exactly one, non-empty,
# expected argument; every `tag` targets exactly <repo>:previous; and no call
# forces, touches a volume, or prunes.
assert_safe_calls() {
  local ws="$1" repo="$2" label="$3"
  shift 3
  local expected=" $* "
  local problems="" line
  local -a a
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    case "$line" in
      *--force*|*'|-f|'*|*'|-f'|*volume*|*'system|prune'*|*'image|prune'*|*'down|-v'*)
        problems="${problems} forbidden:[${line}]" ;;
    esac
    IFS='|' read -r -a a <<< "$line"
    case "${a[1]:-}|${a[2]:-}" in
      compose\|config|compose\|ps|compose\|pull|compose\|up|compose\|logs) ;;
      inspect\|*|ps\|*|image\|inspect|image\|ls) ;;
      image\|rm)
        if [[ ${#a[@]} -ne 4 || -z "${a[3]:-}" || "$expected" != *" ${a[3]:-} "* ]]; then
          problems="${problems} unexpected-rm:[${line}]"
        fi
        ;;
      tag\|*)
        if [[ ${#a[@]} -ne 4 || "${a[3]:-}" != "${repo}:previous" ]]; then
          problems="${problems} unexpected-tag:[${line}]"
        fi
        ;;
      *) problems="${problems} not-allowlisted:[${line}]" ;;
    esac
  done < "${ws}/state/calls"
  assert_eq "" "$problems" "${label}: docker calls stay inside the cleanup allowlist"
}

echo "test: two successive healthy upgrades remove the oldest image and keep the running and :previous ones"
ws=$(image_ws "$APP_REPO" latest)
add_image "$ws" 1 "${APP_REPO}:latest,${APP_REPO}@$(img_digest 1)"
add_container "$ws" 1 1 "${APP_REPO}:latest" running app
plan_pull "$ws" "${APP_REPO}:latest" 2
output=$(deploy_images "$ws")
assert_eq "0" "${output##*EXIT:}" "first upgrade exits 0"
assert_eq "yes" "$(tagged "$ws" 1 "${APP_REPO}:previous")" "first upgrade tags the replaced image :previous"
assert_eq "yes" "$(has_image "$ws" 2)" "first upgrade keeps the new image"
assert_contains "$output" "Removed 0 old application images, reclaimed 0 B" "first upgrade has nothing older to remove"
assert_safe_calls "$ws" "$APP_REPO" "first upgrade"
: > "${ws}/state/calls"
plan_pull "$ws" "${APP_REPO}:latest" 3
output=$(deploy_images "$ws")
assert_eq "0" "${output##*EXIT:}" "second upgrade exits 0"
assert_eq "no" "$(has_image "$ws" 1)" "second upgrade removes the oldest application image"
assert_eq "yes" "$(tagged "$ws" 2 "${APP_REPO}:previous")" "second upgrade moves :previous to the image it replaced"
assert_eq "yes" "$(tagged "$ws" 3 "${APP_REPO}:latest")" "the running image keeps the configured tag"
assert_eq "yes" "$(has_image "$ws" 9)" "the database image is untouched"
assert_eq "yes" "$(has_image "$ws" 8)" "another repository's image is untouched"
assert_eq "1" "$(count_lines "$output" 'Removed ')" "the reclaim line is logged once"
assert_contains "$output" "Removed 1 old application images, reclaimed 400.0 MB" "the reclaim line names the count and the size"
assert_safe_calls "$ws" "$APP_REPO" "second upgrade" "$(img_id 1)"
assert_eq "" "$(grep -F "|image|rm|" "${ws}/state/calls" | grep -F -e "$(img_id 2)" -e "$(img_id 3)" || true)" \
  "full keep-set ids match the short ids image ls prints, so kept images are never removed"

echo "test: a healthy redeploy with no new image leaves :previous alone and still removes superseded images"
add_image "$ws" 4 "${APP_REPO}@$(img_digest 4)"
: > "${ws}/state/calls"
plan_pull "$ws" "${APP_REPO}:latest" 3
output=$(deploy_images "$ws")
assert_eq "0" "${output##*EXIT:}" "redeploy exits 0"
assert_contains "$output" "No new application image" "redeploy reports no new image"
assert_eq "yes" "$(tagged "$ws" 2 "${APP_REPO}:previous")" "redeploy leaves :previous where it was"
assert_eq "no" "$(has_image "$ws" 4)" "redeploy removes a superseded <none> image"
assert_eq "" "$(grep -F '|tag|' "${ws}/state/calls" || true)" "redeploy tags nothing"
assert_safe_calls "$ws" "$APP_REPO" "redeploy" "$(img_id 4)"

echo "test: with a pinned PAVILLION_IMAGE_TAG a superseded image still carrying its version tag is removed"
ws=$(image_ws "$APP_REPO" v3)
add_image "$ws" 1 "${APP_REPO}:v1,${APP_REPO}@$(img_digest 1)"
add_image "$ws" 2 "${APP_REPO}:v2,${APP_REPO}@$(img_digest 2)"
add_container "$ws" 2 2 "${APP_REPO}:v2" running app
plan_pull "$ws" "${APP_REPO}:v3" 3
output=$(deploy_images "$ws" PAVILLION_IMAGE_TAG=v3)
assert_eq "0" "${output##*EXIT:}" "pinned upgrade exits 0"
assert_eq "no" "$(has_image "$ws" 1)" "the v1 image is removed"
assert_eq "yes" "$(tagged "$ws" 2 "${APP_REPO}:previous")" "the replaced v2 image is tagged :previous"
assert_eq "yes" "$(tagged "$ws" 2 "${APP_REPO}:v2")" "the replaced image keeps its own version tag"
assert_safe_calls "$ws" "$APP_REPO" "pinned upgrade" "${APP_REPO}:v1" "$(img_id 1)"

echo "test: cleanup keeps stopped containers' images, other repositories and shared ids, and skips invalid tags"
ws=$(image_ws "$APP_REPO" latest)
add_image "$ws" 2 "${APP_REPO}:previous,${APP_REPO}@$(img_digest 2)"
add_image "$ws" 3 "${APP_REPO}:latest,${APP_REPO}@$(img_digest 3)"
add_container "$ws" 3 3 "${APP_REPO}:latest" running app
add_image "$ws" 4 "${APP_REPO}@$(img_digest 4)"
add_container "$ws" 4 4 "${APP_REPO}:latest" exited migrate
add_image "$ws" 5 "${APP_REPO}:old,mirror.example.test/pavillion:old"
add_image "$ws" 6 "${APP_REPO}@$(img_digest 6),other.example.test/pavillion@$(img_digest 6)"
add_image "$ws" 7 "${APP_REPO}:-bad,${APP_REPO}@$(img_digest 7)"
plan_pull "$ws" "${APP_REPO}:latest" 3
output=$(deploy_images "$ws")
assert_eq "0" "${output##*EXIT:}" "cleanup run exits 0"
assert_eq "yes" "$(has_image "$ws" 4)" "an image used only by a stopped container is kept"
assert_eq "yes" "$(has_image "$ws" 8)" "another repository's image is kept"
assert_eq "yes" "$(has_image "$ws" 5)" "an id also tagged in another repository is not removed"
assert_eq "mirror.example.test/pavillion:old" "$(refs_of "$ws" 5)" "an id shared by tag loses only this repository's tag"
assert_eq "yes" "$(has_image "$ws" 6)" "an id shared by digest is not removed by id"
assert_eq "no" "$(has_image "$ws" 7)" "an image with a tag failing Docker's tag grammar is still removed by id"
assert_contains "$output" "not a valid Docker tag" "the invalid tag is skipped with a warning"
assert_contains "$output" "Removed 1 old application images" "only the one removable image is counted"
assert_safe_calls "$ws" "$APP_REPO" "cleanup neighbours" "${APP_REPO}:old" "$(img_id 7)"

echo "test: a registry with a port keeps the port in the repository"
port_repo="registry.example.test:5000/pavillion"
ws=$(image_ws "$port_repo" latest)
add_image "$ws" 1 "${port_repo}@$(img_digest 1)"
add_image "$ws" 2 "${port_repo}:latest,${port_repo}@$(img_digest 2)"
add_container "$ws" 2 2 "${port_repo}:latest" running app
add_image "$ws" 5 "${port_repo}-extra:latest"
plan_pull "$ws" "${port_repo}:latest" 3
output=$(deploy_images "$ws")
assert_eq "0" "${output##*EXIT:}" "port-registry upgrade exits 0"
assert_eq "yes" "$(tagged "$ws" 2 "${port_repo}:previous")" "the replaced image is tagged <registry:port>/<name>:previous"
assert_eq "no" "$(has_image "$ws" 1)" "the superseded image is removed"
assert_eq "yes" "$(has_image "$ws" 5)" "a repository sharing the name as a prefix is untouched"
assert_safe_calls "$ws" "$port_repo" "port registry" "$(img_id 1)"

# failing_ws -> stdout: a workspace mid-upgrade with a superseded image (4).
failing_ws() {
  local ws
  ws=$(image_ws "$APP_REPO" latest)
  add_image "$ws" 2 "${APP_REPO}:latest,${APP_REPO}@$(img_digest 2)"
  add_container "$ws" 2 2 "${APP_REPO}:latest" running app
  add_image "$ws" 4 "${APP_REPO}@$(img_digest 4)"
  plan_pull "$ws" "${APP_REPO}:latest" 3
  echo "$ws"
}

echo "test: health-check timeout, failed pull, failed up and fresh install remove nothing"
ws=$(failing_ws)
printf '#!/usr/bin/env bash\nexit 7\n' > "${ws}/shim/curl"
output=$(deploy_images "$ws")
assert_eq "4" "${output##*EXIT:}" "health-check timeout exits 4"
assert_eq "yes" "$(has_image "$ws" 4)" "health-check timeout removes nothing"
assert_eq "yes" "$(tagged "$ws" 2 "${APP_REPO}:previous")" "health-check timeout leaves the replaced image tagged :previous"
assert_safe_calls "$ws" "$APP_REPO" "health-check timeout"

ws=$(failing_ws)
echo pull > "${ws}/state/fail"
output=$(deploy_images "$ws")
assert_eq "1" "${output##*EXIT:}" "failed pull exits 1"
assert_eq "yes" "$(has_image "$ws" 4)" "failed pull removes nothing"
assert_contains "$output" "monitoring-and-logs#when-the-disk-alert-arrives" "failed pull points at the disk alert guide"
assert_safe_calls "$ws" "$APP_REPO" "failed pull"

ws=$(failing_ws)
echo up > "${ws}/state/fail"
output=$(deploy_images "$ws")
assert_eq "1" "${output##*EXIT:}" "failed up exits 1"
assert_eq "yes" "$(has_image "$ws" 4)" "failed up removes nothing"
assert_safe_calls "$ws" "$APP_REPO" "failed up"

ws=$(image_ws "$APP_REPO" latest)
add_image "$ws" 4 "${APP_REPO}@$(img_digest 4)"
plan_pull "$ws" "${APP_REPO}:latest" 3
output=$(deploy_images "$ws")
assert_eq "0" "${output##*EXIT:}" "fresh install exits 0"
assert_eq "yes" "$(has_image "$ws" 4)" "fresh install removes nothing"
assert_contains "$output" "No running app container" "fresh install says why nothing is tagged or removed"
assert_eq "" "$(grep -F -e '|tag|' -e '|image|rm|' "${ws}/state/calls" || true)" "fresh install tags and removes nothing"
assert_safe_calls "$ws" "$APP_REPO" "fresh install"

echo "test: PAVILLION_IMAGE_TAG=previous refuses before pulling"
for source in shell env; do
  ws=$(failing_ws)
  if [[ "$source" == env ]]; then
    printf 'PAVILLION_IMAGE_TAG=previous\n' >> "${ws}/.env"
    output=$(deploy_images "$ws")
  else
    output=$(deploy_images "$ws" PAVILLION_IMAGE_TAG=previous)
  fi
  assert_eq "3" "${output##*EXIT:}" "previous from the ${source} exits 3"
  assert_contains "$output" "To resume upgrades" "previous from the ${source} says how to resume upgrades"
  assert_eq "" "$(grep -F '|compose|pull' "${ws}/state/calls" || true)" "previous from the ${source} does not pull"
  assert_eq "yes" "$(has_image "$ws" 4)" "previous from the ${source} removes nothing"
  assert_safe_calls "$ws" "$APP_REPO" "previous from the ${source}"
done

echo "test: an empty, multi-line or invalid application repository skips cleanup"
for variant in empty multi-line invalid; do
  ws=$(failing_ws)
  case "$variant" in
    empty) printf 'postgres:17\n' > "${ws}/state/config_images" ;;
    multi-line) printf 'postgres:17\n%s:latest\n%s:v2\n' "$APP_REPO" "$APP_REPO" > "${ws}/state/config_images" ;;
    invalid)
      printf 'postgres:17\nGhcr.Example.test/Pavillion:latest\n' > "${ws}/state/config_images"
      awk -F'|' -v OFS='|' '$5 == "app" { $3 = "Ghcr.Example.test/Pavillion:latest" } { print }' \
        "${ws}/state/containers" > "${ws}/state/containers.new"
      mv "${ws}/state/containers.new" "${ws}/state/containers"
      ;;
  esac
  output=$(deploy_images "$ws")
  assert_eq "0" "${output##*EXIT:}" "${variant} repository: deploy still exits 0"
  assert_contains "$output" "old application images will not be removed" "${variant} repository: cleanup is skipped with a warning"
  assert_eq "yes" "$(has_image "$ws" 4)" "${variant} repository: nothing is removed"
  assert_eq "" "$(grep -F -e '|tag|' -e '|image|rm|' "${ws}/state/calls" || true)" "${variant} repository: nothing is tagged or removed"
  assert_safe_calls "$ws" "$APP_REPO" "${variant} repository"
done

echo "test: a failing keep-set command aborts cleanup"
for key in ps inspect image_ls; do
  ws=$(failing_ws)
  echo "$key" > "${ws}/state/fail"
  output=$(deploy_images "$ws")
  assert_eq "0" "${output##*EXIT:}" "failing ${key}: deploy still exits 0"
  assert_contains "$output" "no images removed" "failing ${key}: cleanup aborts with a warning"
  assert_eq "yes" "$(has_image "$ws" 4)" "failing ${key}: nothing is removed"
  assert_safe_calls "$ws" "$APP_REPO" "failing ${key}"
done

echo "test: an image id that is not a full sha256: id aborts cleanup"
ws=$(failing_ws)
printf 'sha256:%s|%s|%s@%s\n' "$(rep 5 40)" "$IMG_SIZE" "$APP_REPO" "$(img_digest 5)" >> "${ws}/state/images"
output=$(deploy_images "$ws")
assert_eq "0" "${output##*EXIT:}" "short id: deploy still exits 0"
assert_contains "$output" "no images removed" "short id: cleanup aborts with a warning"
assert_eq "yes" "$(has_image "$ws" 4)" "short id: nothing is removed"
assert_safe_calls "$ws" "$APP_REPO" "short id"

echo "test: a running image with no tag or digest in the repository is not tagged :previous"
ws=$(image_ws "$APP_REPO" latest)
add_image "$ws" 2 ""
add_container "$ws" 2 2 "${APP_REPO}:latest" running app
plan_pull "$ws" "${APP_REPO}:latest" 3
output=$(deploy_images "$ws")
assert_eq "0" "${output##*EXIT:}" "untagged running image: deploy exits 0"
assert_contains "$output" "not tagging it previous" "untagged running image: tagging is skipped with a warning"
assert_eq "" "$(grep -F '|tag|' "${ws}/state/calls" || true)" "untagged running image: no tag call"
assert_eq "yes" "$(has_image "$ws" 2)" "untagged running image: it is not removed"
assert_safe_calls "$ws" "$APP_REPO" "untagged running image"

echo "test: a removal Docker refuses warns and the deploy exits 0"
ws=$(failing_ws)
echo "rm:$(img_id 4)" > "${ws}/state/fail"
output=$(deploy_images "$ws")
assert_eq "0" "${output##*EXIT:}" "refused removal: deploy exits 0"
assert_contains "$output" "Could not remove $(img_id 4)" "refused removal: a warning names the image"
assert_eq "yes" "$(has_image "$ws" 4)" "refused removal: the image is kept"
assert_contains "$output" "Removed 0 old application images" "refused removal: it is not counted"
assert_safe_calls "$ws" "$APP_REPO" "refused removal" "$(img_id 4)"

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
