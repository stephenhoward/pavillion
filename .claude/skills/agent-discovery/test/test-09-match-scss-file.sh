#!/usr/bin/env bash
# Test: match-agents.sh auditor with a .scss file matches the stylesheet
# auditor but not the Vue-specific accessibility auditor.
set -u
. "$(dirname "$0")/helpers.sh"

out="$(printf 'src/client/assets/main.scss\n' | bash "$SKILL_DIR/match-agents.sh" auditor)"

assert_json_contains_name "$out" stylesheet-auditor
assert_json_not_contains_name "$out" accessibility-auditor
