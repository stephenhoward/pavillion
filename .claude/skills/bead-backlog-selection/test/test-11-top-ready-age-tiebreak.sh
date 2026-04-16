#!/usr/bin/env bash
# Test: age tiebreak — same priority, oldest created_at wins.
set -u
. "$(dirname "$0")/helpers.sh"

export MOCK_BD_READY_JSON='[
  {"id":"pv-newer","priority":2,"created_at":"2026-04-10T00:00:00Z","title":"newer"},
  {"id":"pv-older","priority":2,"created_at":"2026-04-01T00:00:00Z","title":"older"},
  {"id":"pv-middle","priority":2,"created_at":"2026-04-05T00:00:00Z","title":"middle"}
]'

out="$(bash "$SKILL_DIR/bd-top-ready.sh")"
rc=$?

assert_eq 0 "$rc"

id="$(echo "$out" | jq -r .id)"
assert_eq "pv-older" "$id" "expected oldest created_at to win on priority tie"
