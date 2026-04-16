#!/usr/bin/env bash
# Test: escalate accepts an optional phase argument and records it.
set -u
. "$(dirname "$0")/helpers.sh"

export MOCK_BD_LABEL_ADD_LOG="$MOCK_DIR/label-add.log"
export MOCK_BD_APPEND_NOTES_LOG="$MOCK_DIR/append-notes.log"
export MOCK_BD_NOTES_PV_AAAA=""

bash "$SKILL_DIR/bd-escalate.sh" pv-aaaa "advisor REQUEST CHANGES after refinement" "3.5"
assert_eq 0 "$?"

notes_log="$(cat "$MOCK_BD_APPEND_NOTES_LOG")"
assert_contains "$notes_log" "Phase: 3.5" "phase should appear in notes"
assert_contains "$notes_log" "advisor REQUEST CHANGES" "reason should appear in notes"
