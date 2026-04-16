#!/usr/bin/env bash
# Test: escalate is idempotent. Second call on the same day with the
# same reason must NOT append a duplicate Escalation section.
# Label add is inherently set-based in bd so we only assert notes here.
set -u
. "$(dirname "$0")/helpers.sh"

export MOCK_BD_LABEL_ADD_LOG="$MOCK_DIR/label-add.log"
export MOCK_BD_APPEND_NOTES_LOG="$MOCK_DIR/append-notes.log"
export MOCK_BD_NOTES_PV_AAAA=""

# First call: creates Escalation section
bash "$SKILL_DIR/bd-escalate.sh" pv-aaaa "reason one"
assert_eq 0 "$?"

# Simulate bd now storing the escalation in notes (so second call sees it)
TODAY="$(date +%Y-%m-%d)"
export MOCK_BD_NOTES_PV_AAAA="
## Escalation ($TODAY)

Phase: unspecified
Reason: reason one
"

# Second call: should see today's section already exists and NOT append again
bash "$SKILL_DIR/bd-escalate.sh" pv-aaaa "reason two"
assert_eq 0 "$?"

# Notes log should have exactly ONE entry (from the first call)
line_count="$(wc -l < "$MOCK_BD_APPEND_NOTES_LOG" | tr -d ' ')"
assert_eq "1" "$line_count" "notes should be appended exactly once"

# Label-add should have been called twice (idempotent on bd side, cheap to re-add)
# OR should be deduped. Either behaviour is acceptable; we just assert at least one call.
label_count="$(wc -l < "$MOCK_BD_LABEL_ADD_LOG" | tr -d ' ')"
if [ "$label_count" -lt 1 ]; then
  fail "expected at least one label-add call, got $label_count"
fi
