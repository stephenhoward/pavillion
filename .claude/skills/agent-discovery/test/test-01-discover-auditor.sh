#!/usr/bin/env bash
# Test: discover-agents.sh auditor finds every *-auditor.md in the fixtures dir
# and emits frontmatter name + description.
set -u
. "$(dirname "$0")/helpers.sh"

out="$(bash "$SKILL_DIR/discover-agents.sh" auditor)"
rc=$?

assert_eq 0 "$rc" "discover-agents auditor should exit 0"

# Fixtures contain 9 auditor files.
assert_json_length "$out" 9 "expected 9 auditors in fixtures"

# Spot-check a few entries.
assert_json_contains_name "$out" accessibility-auditor
assert_json_contains_name "$out" stylesheet-auditor
assert_json_contains_name "$out" i18n-auditor

# Descriptions are populated (not empty).
empty_count="$(echo "$out" | jq '[.[] | select(.description == "")] | length')"
assert_eq 0 "$empty_count" "no auditor should have an empty description"
