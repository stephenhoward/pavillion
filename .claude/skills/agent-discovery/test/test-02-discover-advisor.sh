#!/usr/bin/env bash
# Test: discover-agents.sh advisor lists only advisor files.
set -u
. "$(dirname "$0")/helpers.sh"

out="$(bash "$SKILL_DIR/discover-agents.sh" advisor)"

assert_json_length "$out" 2 "expected 2 advisor fixtures"
assert_json_contains_name "$out" architecture-advisor
assert_json_contains_name "$out" privacy-advisor

# Advisors must not accidentally include auditors.
assert_json_not_contains_name "$out" accessibility-auditor
