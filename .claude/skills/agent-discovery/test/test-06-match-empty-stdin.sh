#!/usr/bin/env bash
# Test: match-agents.sh auditor with empty stdin returns [] cleanly.
set -u
. "$(dirname "$0")/helpers.sh"

out="$(printf '' | bash "$SKILL_DIR/match-agents.sh" auditor)"
rc=$?

assert_eq 0 "$rc" "empty stdin should exit 0"
assert_eq "[]" "$out" "empty stdin should produce literal empty array"
