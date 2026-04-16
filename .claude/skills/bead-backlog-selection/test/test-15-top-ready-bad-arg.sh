#!/usr/bin/env bash
# Test: unknown flag / missing --limit value -> exit 2.
set -u
. "$(dirname "$0")/helpers.sh"

export MOCK_BD_READY_JSON='[]'

bash "$SKILL_DIR/bd-top-ready.sh" --limit >/dev/null 2>&1
rc=$?
assert_eq 2 "$rc" "missing --limit value should exit 2"

bash "$SKILL_DIR/bd-top-ready.sh" --bogus >/dev/null 2>&1
rc=$?
assert_eq 2 "$rc" "unknown flag should exit 2"
