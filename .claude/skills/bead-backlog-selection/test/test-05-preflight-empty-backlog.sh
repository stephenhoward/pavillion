#!/usr/bin/env bash
# Test: bd ready returns [] -> kind=empty_backlog.
set -u
. "$(dirname "$0")/helpers.sh"

export MOCK_GIT_STATUS_PORCELAIN=""
export MOCK_GIT_BRANCH="main"
export MOCK_GIT_FETCH_EXIT=0
export MOCK_GIT_DIFF_EXIT=0
export MOCK_BD_READY_JSON='[]'

out="$(bash "$SKILL_DIR/preflight.sh")"
rc=$?

assert_eq 1 "$rc"

kinds="$(echo "$out" | jq -r '.failures[].kind' | tr '\n' ',')"
assert_contains "$kinds" "empty_backlog" "expected empty_backlog kind"
