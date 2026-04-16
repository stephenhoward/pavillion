#!/usr/bin/env bash
# Test: missing args -> exit 2.
set -u
. "$(dirname "$0")/helpers.sh"

bash "$SKILL_DIR/bd-escalate.sh" >/dev/null 2>&1
rc=$?
assert_eq 2 "$rc" "no args should exit 2"

bash "$SKILL_DIR/bd-escalate.sh" pv-aaaa >/dev/null 2>&1
rc=$?
assert_eq 2 "$rc" "missing reason should exit 2"
