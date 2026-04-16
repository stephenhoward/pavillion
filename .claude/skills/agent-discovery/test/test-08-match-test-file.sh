#!/usr/bin/env bash
# Test: match-agents.sh auditor with a *.test.ts file matches testing-auditor
# (and the broad-scope auditors consistency, complexity).
set -u
. "$(dirname "$0")/helpers.sh"

out="$(printf 'src/server/calendar/test/service.test.ts\n' | bash "$SKILL_DIR/match-agents.sh" auditor)"

assert_json_contains_name "$out" testing-auditor
assert_json_contains_name "$out" consistency-auditor
assert_json_contains_name "$out" complexity-auditor

# Should NOT match API/entity-only auditors (privacy, security) because the
# path is under test/ rather than api/service/entity/model/migration.
assert_json_not_contains_name "$out" privacy-auditor
assert_json_not_contains_name "$out" security-auditor
assert_json_not_contains_name "$out" architecture-auditor
