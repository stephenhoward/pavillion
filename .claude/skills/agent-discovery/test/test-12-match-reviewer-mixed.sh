#!/usr/bin/env bash
# Test: match-agents.sh reviewer with a mix of .vue and backend files;
# only frontend-standards-reviewer matches on the .vue tag.
set -u
. "$(dirname "$0")/helpers.sh"

out="$(printf 'src/client/components/list.vue\nsrc/server/calendar/service/foo.ts\n' \
  | bash "$SKILL_DIR/match-agents.sh" reviewer)"

assert_json_contains_name "$out" frontend-standards-reviewer
