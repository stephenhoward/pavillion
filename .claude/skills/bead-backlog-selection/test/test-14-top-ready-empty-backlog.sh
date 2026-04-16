#!/usr/bin/env bash
# Test: empty backlog (bd ready returns []) also exits 3 so the
# orchestrator can treat "nothing to do" and "only labelled beads"
# uniformly.
set -u
. "$(dirname "$0")/helpers.sh"

export MOCK_BD_READY_JSON='[]'

out_stderr=$(bash "$SKILL_DIR/bd-top-ready.sh" 2>&1 >/dev/null)
rc=$?

assert_eq 3 "$rc" "empty backlog should also exit 3"
assert_contains "$out_stderr" "backlog exhausted for automation"
