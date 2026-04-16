#!/usr/bin/env bash
# Test: advisors match on migration paths too (pre-code spec review uses the
# same keyword table). Fixture has architecture-advisor and privacy-advisor.
set -u
. "$(dirname "$0")/helpers.sh"

out="$(printf 'src/server/calendar/migrations/2026-04-16-new-column.ts\n' \
  | bash "$SKILL_DIR/match-agents.sh" advisor)"

assert_json_contains_name "$out" architecture-advisor
assert_json_contains_name "$out" privacy-advisor

# Rationale must reference the migration tag.
any="$(echo "$out" | jq '[.[] | select(.rationale | contains("tag: migration"))] | length')"
total="$(echo "$out" | jq 'length')"
assert_eq "$total" "$any" "every advisor rationale should cite migration tag"
