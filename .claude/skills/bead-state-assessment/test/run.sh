#!/usr/bin/env bash
# test/run.sh - runs the fixture-based tests for bead-state-assessment.
#
# For each script (bd-state, bd-sizing-check) we drive it against every
# fixture in test/fixtures/ and diff the JSON against the canonical
# expected output in test/expected/. bd-enrichment-check has no JSON, so
# we just assert its exit code matches an expectation encoded by fixture.
#
# Exits 0 on success, 1 on any test failure. Prints a summary line per test.

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"

pass=0
fail=0

report_pass() {
  pass=$((pass + 1))
  printf '  PASS  %s\n' "$1"
}

report_fail() {
  fail=$((fail + 1))
  printf '  FAIL  %s\n' "$1"
  if [[ $# -gt 1 ]]; then
    printf '        %s\n' "$2"
  fi
}

diff_json() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if diff -u "$expected" <(printf '%s\n' "$actual") >/dev/null 2>&1; then
    report_pass "$label"
  else
    report_fail "$label" "JSON output does not match $(basename "$expected")"
    diff -u "$expected" <(printf '%s\n' "$actual") || true
  fi
}

run_state_cases() {
  printf '\n[bd-state.sh]\n'
  local cases=(unshaped shaped decomposed analyzed executing complete missing-description)
  for name in "${cases[@]}"; do
    local fixture="$here/fixtures/${name}.txt"
    local expected="$here/expected/state-${name}.json"
    local actual
    actual="$("$root/bd-state.sh" --fixture "$fixture")"
    diff_json "$actual" "$expected" "state:$name"
  done
  # Usage error contract: exit code 2 when called without args.
  local rc=0
  "$root/bd-state.sh" >/dev/null 2>&1 || rc=$?
  if [[ $rc -eq 2 ]]; then
    report_pass "state:usage"
  else
    report_fail "state:usage" "expected exit code 2, got $rc"
  fi
}

run_sizing_cases() {
  printf '\n[bd-sizing-check.sh]\n'
  # Each entry: label=fixture-basename. The label is also the expected JSON's
  # name under test/expected/. bash 3.2 has no associative arrays, so we use
  # two parallel lists here.
  local labels=(sizing-large sizing-small sizing-shaped)
  local fixtures=(sizing-large.txt sizing-small.txt shaped.txt)
  local i
  for i in 0 1 2; do
    local fixture="$here/fixtures/${fixtures[$i]}"
    local expected="$here/expected/${labels[$i]}.json"
    local actual
    actual="$("$root/bd-sizing-check.sh" --fixture "$fixture")"
    diff_json "$actual" "$expected" "sizing:${labels[$i]}"
  done
  # Contract: sizing-large must return needs_decomposition=true with at
  # least 2 reasons (per pv-9cfj.1 acceptance criterion).
  local large_reasons
  large_reasons="$("$root/bd-sizing-check.sh" --fixture "$here/fixtures/sizing-large.txt" \
    | jq '.reasons | length')"
  if [[ "$large_reasons" -ge 2 ]]; then
    report_pass "sizing:large-reason-count ($large_reasons >= 2)"
  else
    report_fail "sizing:large-reason-count" "expected >= 2 reasons, got $large_reasons"
  fi
  # Usage error contract.
  local rc=0
  "$root/bd-sizing-check.sh" >/dev/null 2>&1 || rc=$?
  if [[ $rc -eq 2 ]]; then
    report_pass "sizing:usage"
  else
    report_fail "sizing:usage" "expected exit code 2, got $rc"
  fi
}

run_enrichment_cases() {
  printf '\n[bd-enrichment-check.sh]\n'
  local rc
  # Fixtures that have Implementation Context → exit 0.
  for name in analyzed executing complete; do
    local fixture="$here/fixtures/${name}.txt"
    rc=0
    "$root/bd-enrichment-check.sh" --fixture "$fixture" >/dev/null 2>&1 || rc=$?
    if [[ $rc -eq 0 ]]; then
      report_pass "enrichment:${name}-exit-0"
    else
      report_fail "enrichment:${name}-exit-0" "expected exit 0, got $rc"
    fi
  done
  # Fixtures that lack it → exit 1.
  for name in unshaped shaped decomposed missing-description; do
    local fixture="$here/fixtures/${name}.txt"
    rc=0
    "$root/bd-enrichment-check.sh" --fixture "$fixture" >/dev/null 2>&1 || rc=$?
    if [[ $rc -eq 1 ]]; then
      report_pass "enrichment:${name}-exit-1"
    else
      report_fail "enrichment:${name}-exit-1" "expected exit 1, got $rc"
    fi
  done
  # Usage error contract.
  rc=0
  "$root/bd-enrichment-check.sh" >/dev/null 2>&1 || rc=$?
  if [[ $rc -eq 2 ]]; then
    report_pass "enrichment:usage"
  else
    report_fail "enrichment:usage" "expected exit code 2, got $rc"
  fi
}

run_state_cases
run_sizing_cases
run_enrichment_cases

printf '\nResults: %d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
