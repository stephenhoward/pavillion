#!/usr/bin/env bash
#
# commit-msg.sh <bead-id> <summary> [scope]
#
# Format a conventional commit message for bead work:
#   <type>(<scope>): <summary> (<bead-id>)
# If no scope is provided, emits:
#   <type>: <summary> (<bead-id>)
#
# The `<type>` is derived from the bead's issue_type (bug->fix,
# feature->feat, epic->feat, task->chore). The id suffix matches
# the existing git history convention (e.g. commit a810e16).
#
# Exit codes:
#   0 - success, commit subject line on stdout
#   2 - missing args / invalid input
#   3 - bd lookup failed
#
# Testing hook: BD_SHOW_CMD overrides `bd show --json`.

set -euo pipefail

BEAD_ID="${1:-}"
SUMMARY="${2:-}"
SCOPE="${3:-}"

if [ -z "$BEAD_ID" ] || [ -z "$SUMMARY" ]; then
  echo "usage: commit-msg.sh <bead-id> <summary> [scope]" >&2
  exit 2
fi

BD_CMD="${BD_SHOW_CMD:-bd show --json}"
if ! json="$($BD_CMD "$BEAD_ID" 2>/dev/null)"; then
  echo "commit-msg.sh: bd lookup failed for '$BEAD_ID'" >&2
  exit 3
fi

issue_type="$(printf '%s' "$json" | jq -r '.[0].issue_type // ""')"

case "$issue_type" in
  bug)     commit_type="fix" ;;
  feature) commit_type="feat" ;;
  epic)    commit_type="feat" ;;
  task|"") commit_type="chore" ;;
  *)       commit_type="chore" ;;
esac

# Collapse any accidental newlines in the summary; keep it a single line.
clean_summary="$(printf '%s' "$SUMMARY" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"

if [ -n "$SCOPE" ]; then
  printf '%s(%s): %s (%s)\n' "$commit_type" "$SCOPE" "$clean_summary" "$BEAD_ID"
else
  printf '%s: %s (%s)\n' "$commit_type" "$clean_summary" "$BEAD_ID"
fi
