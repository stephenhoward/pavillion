#!/usr/bin/env bash
# Test: top-ready filters out beads carrying the needs-human label.
set -u
. "$(dirname "$0")/helpers.sh"

# pv-bbbb would win on priority, but it carries needs-human.
# pv-aaaa is next (P2, older than pv-cccc).
export MOCK_BD_READY_JSON='[
  {"id":"pv-aaaa","priority":2,"created_at":"2026-04-01T00:00:00Z","title":"clean"},
  {"id":"pv-bbbb","priority":1,"created_at":"2026-04-05T00:00:00Z","title":"labelled"},
  {"id":"pv-cccc","priority":2,"created_at":"2026-04-03T00:00:00Z","title":"other"}
]'
export MOCK_BD_LABELS_PV_BBBB="needs-human"

out="$(bash "$SKILL_DIR/bd-top-ready.sh")"
rc=$?

assert_eq 0 "$rc" "should succeed when at least one unlabelled bead exists"

id="$(echo "$out" | jq -r .id)"
assert_eq "pv-aaaa" "$id" "expected filtered-in bead to win (labelled one skipped)"
