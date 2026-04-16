#!/usr/bin/env bash
# Test: local main diverged from origin/main -> kind=stale_main.
set -u
. "$(dirname "$0")/helpers.sh"

export MOCK_GIT_STATUS_PORCELAIN=""
export MOCK_GIT_BRANCH="main"
export MOCK_GIT_FETCH_EXIT=0
export MOCK_GIT_DIFF_EXIT=1   # diff returns nonzero when changes present
export MOCK_BD_READY_JSON='[{"id":"pv-aaaa","priority":2,"created_at":"2026-04-01T00:00:00Z","title":"x"}]'

out="$(bash "$SKILL_DIR/preflight.sh")"
rc=$?

assert_eq 1 "$rc"

kinds="$(echo "$out" | jq -r '.failures[].kind' | tr '\n' ',')"
assert_contains "$kinds" "stale_main" "expected stale_main kind"
