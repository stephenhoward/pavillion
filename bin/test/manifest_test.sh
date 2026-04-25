#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"
source "${SCRIPT_DIR}/../lib/manifest.sh"

FIXTURES="${SCRIPT_DIR}/fixtures"

echo "manifest_test.sh"

echo "test: TSV fixtures contain literal tabs"
# Catches editor-induced tab-to-space corruption. `grep -q $'\t'` uses a
# bash-quoted literal tab so it works on both macOS (BSD grep, no -P) and Linux.
tab_check_failed=0
for f in "${FIXTURES}"/manifest_*.tsv; do
  if ! grep -q $'\t' "$f"; then
    fail "fixture has no tabs: $f"
    tab_check_failed=1
  fi
done
if (( tab_check_failed == 0 )); then
  echo "  PASS: every manifest_*.tsv fixture has at least one literal tab"
  _TESTS=$((_TESTS+1))
fi

echo "test: parse_manifest reads a single entry"
out=$(parse_manifest "${FIXTURES}/manifest_basic.tsv")
assert_eq "ONE_SECRET|openssl_rand_base64_32|stable|First secret." "$out" "single entry as pipe-delimited record"

echo "test: parse_manifest reads multiple entries"
out=$(parse_manifest "${FIXTURES}/manifest_mixed.tsv")
expected="ALPHA|openssl_rand_base64_32|stable|Alpha secret.
BETA|openssl_rand_hex_32|regenerable|Beta secret."
assert_eq "$expected" "$out" "two entries separated by newlines"

echo "test: manifest_names lists just names"
out=$(manifest_names "${FIXTURES}/manifest_mixed.tsv")
expected="ALPHA
BETA"
assert_eq "$expected" "$out" "names only, one per line"

echo "test: manifest_field reads a named field"
out=$(manifest_field "${FIXTURES}/manifest_mixed.tsv" "BETA" "stability")
assert_eq "regenerable" "$out" "stability field of BETA entry"

out=$(manifest_field "${FIXTURES}/manifest_mixed.tsv" "ALPHA" "generator")
assert_eq "openssl_rand_base64_32" "$out" "generator field of ALPHA entry"

echo "test: parse_manifest skips comment and blank lines"
out=$(parse_manifest "${FIXTURES}/manifest_with_comments.tsv")
expected="GAMMA|openssl_rand_base64_32|stable|Gamma secret.
DELTA|openssl_rand_hex_32|regenerable|Delta secret."
assert_eq "$expected" "$out" "comments and blank lines are stripped, data rows preserved"

echo "test: manifest_field rejects unknown field name"
err_output=$(manifest_field "${FIXTURES}/manifest_mixed.tsv" "ALPHA" "bogus" 2>&1; echo "EXIT:$?") || true
err_exit="${err_output##*EXIT:}"
err_msg="${err_output%EXIT:*}"
if [[ "$err_exit" != "0" ]]; then
  echo "  PASS: manifest_field exits non-zero on unknown field"
  _TESTS=$((_TESTS+1))
else
  fail "manifest_field should exit non-zero on unknown field (got ${err_exit})"
fi
assert_contains "$err_msg" "unknown field" "stderr mentions 'unknown field'"

echo "test: manifest_field returns empty output and exit 0 for missing secret name"
out=$(manifest_field "${FIXTURES}/manifest_mixed.tsv" "NONEXISTENT" "stability"; echo "EXIT:$?")
field_exit="${out##*EXIT:}"
field_value="${out%EXIT:*}"
# Strip trailing newline that command-substitution + literal newline introduces.
field_value="${field_value%$'\n'}"
assert_eq "0" "$field_exit" "manifest_field exits 0 when name is not found"
assert_eq "" "$field_value" "manifest_field produces empty output for missing name"

report_results
