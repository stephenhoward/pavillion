#!/usr/bin/env bash
# Test: when every ready bead carries needs-human, exit 3 with stderr
# "backlog exhausted for automation".
set -u
. "$(dirname "$0")/helpers.sh"

export MOCK_BD_READY_JSON='[
  {"id":"pv-aaaa","priority":2,"created_at":"2026-04-01T00:00:00Z","title":"a"},
  {"id":"pv-bbbb","priority":1,"created_at":"2026-04-05T00:00:00Z","title":"b"}
]'
export MOCK_BD_LABELS_PV_AAAA="needs-human"
export MOCK_BD_LABELS_PV_BBBB="needs-human other-label"

out_stderr=$(bash "$SKILL_DIR/bd-top-ready.sh" 2>&1 >/dev/null)
rc=$?

assert_eq 3 "$rc" "exit code must be 3 when all beads labelled (stderr: $out_stderr)"
assert_contains "$out_stderr" "backlog exhausted for automation" "expected specific stderr message"
