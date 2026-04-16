#!/usr/bin/env bash
# Test: match-agents.sh auditor with i18n resource file matches i18n-auditor.
set -u
. "$(dirname "$0")/helpers.sh"

out="$(printf 'src/client/locales/en/calendar.json\n' | bash "$SKILL_DIR/match-agents.sh" auditor)"

assert_json_contains_name "$out" i18n-auditor
assert_json_contains_name "$out" consistency-auditor
