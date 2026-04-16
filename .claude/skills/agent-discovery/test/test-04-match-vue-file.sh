#!/usr/bin/env bash
# Test: match-agents.sh auditor with a single .vue file produces the expected
# matching set (accessibility, stylesheet, frontend standards context ...).
set -u
. "$(dirname "$0")/helpers.sh"

out="$(printf 'src/client/components/foo.vue\n' | bash "$SKILL_DIR/match-agents.sh" auditor)"

# Must include these frontend-relevant auditors:
assert_json_contains_name "$out" accessibility-auditor
assert_json_contains_name "$out" stylesheet-auditor
assert_json_contains_name "$out" i18n-auditor
assert_json_contains_name "$out" consistency-auditor

# Must NOT include backend-only auditors.
assert_json_not_contains_name "$out" security-auditor
assert_json_not_contains_name "$out" privacy-auditor

# Every matched agent must carry a rationale string mentioning the vue path
# and the matched tag.
vue_rationales="$(echo "$out" | jq '[.[] | select(.rationale | contains("foo.vue"))] | length')"
total="$(echo "$out" | jq 'length')"
assert_eq "$total" "$vue_rationales" "every rationale should reference the vue file"

tag_rationales="$(echo "$out" | jq '[.[] | select(.rationale | contains("tag: vue"))] | length')"
assert_eq "$total" "$tag_rationales" "every rationale should cite the vue tag"
