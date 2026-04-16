#!/usr/bin/env bash
# bd-top-ready.sh — pick the top-priority ready bead, filtering out any bead
# carrying the `needs-human` label. Emits the selected bead's JSON on stdout.
#
# Usage: bd-top-ready.sh [--limit N]
#   --limit N   how many ready beads to sample (default 5)
#
# Exit codes:
#   0  success; bead JSON on stdout
#   2  usage error (bad flag or missing value)
#   3  no eligible bead — either `bd ready` is empty or every returned
#      bead carries the needs-human label. stderr carries
#      "backlog exhausted for automation" so the orchestrator can classify.
#
# Selection: sort by priority ascending (0/P0 = highest) then created_at
# ascending (oldest wins tiebreaks).

set -euo pipefail

LIMIT=5

while [ "$#" -gt 0 ]; do
  case "$1" in
    --limit)
      if [ "$#" -lt 2 ]; then
        echo "bd-top-ready.sh: --limit requires a value" >&2
        exit 2
      fi
      LIMIT="$2"
      shift 2
      ;;
    --limit=*)
      LIMIT="${1#--limit=}"
      shift
      ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "bd-top-ready.sh: unknown flag '$1'" >&2
      exit 2
      ;;
  esac
done

# Fetch ready beads as JSON
ready_json="$(bd ready --limit="$LIMIT" --json 2>/dev/null || echo '[]')"
count="$(jq 'length' <<< "$ready_json")"

if [ "$count" -eq 0 ]; then
  echo "backlog exhausted for automation" >&2
  exit 3
fi

# Filter out beads with the needs-human label. Build a JSON array of
# eligible beads by iterating over ids and calling `bd label list`.
eligible='[]'
while IFS= read -r id; do
  [ -z "$id" ] && continue
  if bd label list "$id" 2>/dev/null | grep -q '^  - needs-human$'; then
    continue
  fi
  bead="$(jq --arg id "$id" '.[] | select(.id == $id)' <<< "$ready_json")"
  eligible="$(jq -c --argjson bead "$bead" '. + [$bead]' <<< "$eligible")"
done < <(jq -r '.[].id' <<< "$ready_json")

eligible_count="$(jq 'length' <<< "$eligible")"
if [ "$eligible_count" -eq 0 ]; then
  echo "backlog exhausted for automation" >&2
  exit 3
fi

# Sort: priority ascending, then created_at ascending. jq's sort_by is stable.
jq '.[0]' <<< "$(jq -c 'sort_by(.priority, .created_at)' <<< "$eligible")"
