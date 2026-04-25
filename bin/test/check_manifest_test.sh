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
