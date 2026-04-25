#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

CHECKER="${SCRIPT_DIR}/../check-manifest.sh"
FIXTURES="${SCRIPT_DIR}/fixtures"
BASE="${FIXTURES}/plumbing_complete"

# One parent temp dir shared by every "missing" test; cleaned up on EXIT.
WORK=$(mktemp_dir)

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

# Copy the complete fixture into WORK/<name> so the test can mutate one file.
make_variant() {
  local name="$1"
  local dir="${WORK}/${name}"
  mkdir -p "$dir"
  cp "${BASE}/"* "${dir}/"
  echo "$dir"
}

# Remove every line that matches a fixed string. Portable across BSD/GNU sed
# by writing to a sibling temp file and renaming.
remove_lines() {
  local file="$1"
  shift
  local tmp="${file}.tmp"
  cp "$file" "$tmp"
  for needle in "$@"; do
    grep -vF "$needle" "$tmp" > "${tmp}.next"
    mv "${tmp}.next" "$tmp"
  done
  mv "$tmp" "$file"
}

# Remove only the first occurrence of a fixed-string line. Used for the
# docker-compose case where the line appears in both app and worker blocks
# and we want to drop just the app-block copy.
remove_first_line() {
  local file="$1"
  local needle="$2"
  local tmp="${file}.tmp"
  awk -v n="$needle" 'BEGIN{seen=0} { if (!seen && index($0, n)) { seen=1; next } print }' "$file" > "$tmp"
  mv "$tmp" "$file"
}

echo "test: complete plumbing passes"
output=$(run_check "${BASE}"; echo "EXIT:$?")
exit_code="${output##*EXIT:}"
assert_eq "0" "$exit_code" "exits 0 when all four plumbing files reference both secrets"

echo "test: missing envvars mapping fails"
dir=$(make_variant "missing_envvars")
remove_lines "${dir}/custom-environment-variables.yaml" \
  "jwt:" \
  "  secret: JWT_SECRET"
output=$(run_check "$dir"; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "1" "$exit_code" "exits 1 when envvars mapping is missing"
assert_contains "$output" "JWT_SECRET" "error names the missing secret"
assert_contains "$output" "custom-environment-variables.yaml" "error names the missing file"

echo "test: missing compose environment fails"
dir=$(make_variant "missing_compose")
# Only the app-block lines; worker block keeps both so file_count stays at 1
# (still below the required 2 occurrences) and we exercise the "< 2" branch.
remove_first_line "${dir}/docker-compose.yml" "- JWT_SECRET=\${JWT_SECRET:-}"
remove_first_line "${dir}/docker-compose.yml" "- JWT_SECRET_FILE=\${JWT_SECRET_FILE:-}"
output=$(run_check "$dir"; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "1" "$exit_code" "exits 1 when compose app env is missing"
assert_contains "$output" "JWT_SECRET" "error names the missing secret"
assert_contains "$output" "docker-compose.yml" "error names the missing file"

echo "test: missing entrypoint file_env fails"
dir=$(make_variant "missing_entrypoint")
remove_lines "${dir}/entrypoint.sh" "file_env 'JWT_SECRET'"
output=$(run_check "$dir"; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "1" "$exit_code" "exits 1 when entrypoint file_env is missing"
assert_contains "$output" "JWT_SECRET" "error names the missing secret"
assert_contains "$output" "entrypoint.sh" "error names the missing file"

echo "test: missing validator fails"
dir=$(make_variant "missing_validator")
remove_lines "${dir}/production-validation.ts" \
  "  const jwt = config.get('jwt.secret');" \
  "  if (!jwt) throw new Error('JWT_SECRET must be set');"
output=$(run_check "$dir"; echo "EXIT:$?") || true
exit_code="${output##*EXIT:}"
assert_eq "1" "$exit_code" "exits 1 when validator is missing"
assert_contains "$output" "JWT_SECRET" "error names the missing secret"
assert_contains "$output" "production-validation.ts" "error names the missing file"

report_results
