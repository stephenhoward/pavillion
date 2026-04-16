#!/usr/bin/env bash
# Test: escalate adds needs-human label and appends ## Escalation section.
set -u
. "$(dirname "$0")/helpers.sh"

export MOCK_BD_LABEL_ADD_LOG="$MOCK_DIR/label-add.log"
export MOCK_BD_APPEND_NOTES_LOG="$MOCK_DIR/append-notes.log"
# Empty notes to start
export MOCK_BD_NOTES_PV_AAAA=""

bash "$SKILL_DIR/bd-escalate.sh" pv-aaaa "auto-shape insufficient description"
rc=$?
assert_eq 0 "$rc" "escalate should exit 0"

# Label add log should contain "pv-aaaa needs-human"
assert_eq "pv-aaaa needs-human" "$(cat "$MOCK_BD_LABEL_ADD_LOG")" "should add needs-human label exactly once"

# Append notes log should contain the Escalation section
notes_log="$(cat "$MOCK_BD_APPEND_NOTES_LOG")"
assert_contains "$notes_log" "## Escalation" "notes should contain Escalation header"
assert_contains "$notes_log" "auto-shape insufficient description" "notes should include reason"
