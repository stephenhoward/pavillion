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
