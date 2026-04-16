#!/usr/bin/env bash
# Test: discover-agents.sh rejects invalid/missing suffix with exit 2.
set -u
. "$(dirname "$0")/helpers.sh"

# No args → exit 2.
rc=0
bash "$SKILL_DIR/discover-agents.sh" >/dev/null 2>&1 || rc=$?
assert_eq 2 "$rc" "no-args should exit 2"

# Invalid suffix → exit 2.
rc=0
bash "$SKILL_DIR/discover-agents.sh" guardian >/dev/null 2>&1 || rc=$?
assert_eq 2 "$rc" "invalid suffix 'guardian' should exit 2"

# Usage message goes to stderr.
stderr="$(bash "$SKILL_DIR/discover-agents.sh" bogus 2>&1 1>/dev/null || true)"
assert_contains "$stderr" "usage:" "stderr must include usage message"
