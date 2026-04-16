#!/usr/bin/env bash
# Test: dirty working tree yields ok=false with kind=dirty_tree.
set -u
. "$(dirname "$0")/helpers.sh"

export MOCK_GIT_STATUS_PORCELAIN=" M src/foo.ts"
export MOCK_GIT_BRANCH="main"
export MOCK_GIT_FETCH_EXIT=0
export MOCK_GIT_DIFF_EXIT=0
export MOCK_BD_READY_JSON='[{"id":"pv-aaaa","priority":2,"created_at":"2026-04-01T00:00:00Z","title":"x"}]'

out="$(bash "$SKILL_DIR/preflight.sh")"
rc=$?

assert_eq 1 "$rc" "preflight should exit 1 when dirty"

ok="$(echo "$out" | jq -r .ok)"
assert_eq "false" "$ok"

kinds="$(echo "$out" | jq -r '.failures[].kind' | sort | tr '\n' ',')"
assert_contains "$kinds" "dirty_tree" "expected dirty_tree kind in failures ($kinds)"
