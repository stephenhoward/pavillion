#!/usr/bin/env bash
# Test: match-agents.sh auditor with backend API + entity changes brings the
# backend-oriented auditors into scope (privacy, security, architecture,
# consistency, complexity).
set -u
. "$(dirname "$0")/helpers.sh"

out="$(printf 'src/server/accounts/api/v1/auth.ts\nsrc/server/calendar/entity/calendar.ts\n' \
  | bash "$SKILL_DIR/match-agents.sh" auditor)"

assert_json_contains_name "$out" privacy-auditor
assert_json_contains_name "$out" security-auditor
assert_json_contains_name "$out" architecture-auditor
assert_json_contains_name "$out" consistency-auditor
assert_json_contains_name "$out" complexity-auditor

# Frontend-only auditors should not be in scope.
assert_json_not_contains_name "$out" accessibility-auditor
assert_json_not_contains_name "$out" stylesheet-auditor
assert_json_not_contains_name "$out" i18n-auditor
