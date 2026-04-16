#!/usr/bin/env bash
# Test: clean preflight passes with ok=true and no failures.
set -u
. "$(dirname "$0")/helpers.sh"

# Clean working tree, on main, in sync with remote, non-empty backlog
export MOCK_GIT_STATUS_PORCELAIN=""
export MOCK_GIT_BRANCH="main"
export MOCK_GIT_FETCH_EXIT=0
export MOCK_GIT_DIFF_EXIT=0
export MOCK_BD_READY_JSON='[{"id":"pv-aaaa","priority":2,"created_at":"2026-04-01T00:00:00Z","title":"x"}]'
# No labels on pv-aaaa

out="$(bash "$SKILL_DIR/preflight.sh" 2>&1)"
rc=$?

assert_eq 0 "$rc" "preflight should exit 0 on clean state (stdout: $out)"

ok="$(echo "$out" | jq -r .ok)"
assert_eq "true" "$ok" "expected ok=true"

failures_len="$(echo "$out" | jq '.failures | length')"
assert_eq "0" "$failures_len" "expected no failures"
