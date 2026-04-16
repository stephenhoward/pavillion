#!/usr/bin/env bash
# Test: top-ready picks highest priority (lowest number).
set -u
. "$(dirname "$0")/helpers.sh"

# pv-bbbb is P1, pv-aaaa is P3. Expected winner: pv-bbbb.
export MOCK_BD_READY_JSON='[
  {"id":"pv-aaaa","priority":3,"created_at":"2026-04-01T00:00:00Z","title":"low"},
  {"id":"pv-bbbb","priority":1,"created_at":"2026-04-05T00:00:00Z","title":"high"},
  {"id":"pv-cccc","priority":2,"created_at":"2026-04-03T00:00:00Z","title":"mid"}
]'

out="$(bash "$SKILL_DIR/bd-top-ready.sh" --limit 5)"
rc=$?

assert_eq 0 "$rc" "top-ready should exit 0 (stdout: $out)"

id="$(echo "$out" | jq -r .id)"
assert_eq "pv-bbbb" "$id" "expected highest priority (P1) to win"
