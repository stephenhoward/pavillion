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
