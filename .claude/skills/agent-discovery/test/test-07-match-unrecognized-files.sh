#!/usr/bin/env bash
# Test: match-agents.sh auditor with files that don't match any tag returns [].
set -u
. "$(dirname "$0")/helpers.sh"

out="$(printf 'README.txt\nCHANGELOG\nrandom/path/file.log\n' | bash "$SKILL_DIR/match-agents.sh" auditor)"
rc=$?

assert_eq 0 "$rc" "unrecognized files should not error"
assert_eq "[]" "$out" "unrecognized files should match zero agents"
