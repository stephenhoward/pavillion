#!/usr/bin/env bash
# Test: wrong branch yields kind=wrong_branch.
set -u
. "$(dirname "$0")/helpers.sh"

export MOCK_GIT_STATUS_PORCELAIN=""
export MOCK_GIT_BRANCH="feature/foo"
export MOCK_GIT_FETCH_EXIT=0
export MOCK_GIT_DIFF_EXIT=0
export MOCK_BD_READY_JSON='[{"id":"pv-aaaa","priority":2,"created_at":"2026-04-01T00:00:00Z","title":"x"}]'

out="$(bash "$SKILL_DIR/preflight.sh")"
rc=$?

assert_eq 1 "$rc" "preflight should exit 1 on wrong branch"

ok="$(echo "$out" | jq -r .ok)"
assert_eq "false" "$ok"

kinds="$(echo "$out" | jq -r '.failures[].kind' | sort | tr '\n' ',')"
assert_contains "$kinds" "wrong_branch" "expected wrong_branch kind"

# Reason should include the actual branch name so the orchestrator can report
reason="$(echo "$out" | jq -r '.failures[] | select(.kind=="wrong_branch").reason')"
assert_contains "$reason" "feature/foo" "reason should name actual branch"
