#!/usr/bin/env bash
# Test: bd ready returns beads but all carry needs-human -> kind=empty_backlog.
# (Backlog non-empty excluding-needs-human-labelled must also be non-empty.)
set -u
. "$(dirname "$0")/helpers.sh"

export MOCK_GIT_STATUS_PORCELAIN=""
export MOCK_GIT_BRANCH="main"
export MOCK_GIT_FETCH_EXIT=0
export MOCK_GIT_DIFF_EXIT=0
export MOCK_BD_READY_JSON='[{"id":"pv-aaaa","priority":2,"created_at":"2026-04-01T00:00:00Z","title":"x"},{"id":"pv-bbbb","priority":3,"created_at":"2026-04-02T00:00:00Z","title":"y"}]'
export MOCK_BD_LABELS_PV_AAAA="needs-human"
export MOCK_BD_LABELS_PV_BBBB="needs-human shape-required"

out="$(bash "$SKILL_DIR/preflight.sh")"
rc=$?

assert_eq 1 "$rc"

kinds="$(echo "$out" | jq -r '.failures[].kind' | tr '\n' ',')"
assert_contains "$kinds" "empty_backlog" "expected empty_backlog when all beads are needs-human"
