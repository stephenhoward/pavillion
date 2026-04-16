#!/usr/bin/env bash
# preflight.sh — gate that verifies autonomous backlog processing is safe to
# start. Emits JSON on stdout: {ok: bool, failures: [{kind, reason}, ...]}.
# Exit 0 if ok, 1 if any failure. No auto-fix; the orchestrator decides.
#
# Checks:
#   - working tree clean (git status --porcelain empty)         kind=dirty_tree
#   - current branch is main                                    kind=wrong_branch
#   - local main is in sync with origin/main                    kind=stale_main
#   - bd ready has at least one bead without needs-human label  kind=empty_backlog
#
# No flags. Reads ambient git + bd state.

set -euo pipefail

MAIN_BRANCH="${PREFLIGHT_MAIN_BRANCH:-main}"
READY_LIMIT="${PREFLIGHT_READY_LIMIT:-50}"

# failures is a JSON array built up via jq
failures='[]'

add_failure() {
  local kind="$1"
  local reason="$2"
  failures="$(jq -c --arg kind "$kind" --arg reason "$reason" \
    '. + [{kind: $kind, reason: $reason}]' <<< "$failures")"
}

# 1. Clean working tree
porcelain="$(git status --porcelain 2>/dev/null || true)"
if [ -n "$porcelain" ]; then
  add_failure "dirty_tree" "working tree has uncommitted changes; commit or stash before /process-backlog"
fi

# 2. On main branch
current_branch="$(git branch --show-current 2>/dev/null || true)"
if [ "$current_branch" != "$MAIN_BRANCH" ]; then
  add_failure "wrong_branch" "expected to be on '$MAIN_BRANCH' but currently on '$current_branch'"
fi

# 3. Local main in sync with origin/main
# Only meaningful when we are actually on main; still check so orchestrator
# sees the full picture. Ignore fetch network errors (reported as stale).
if ! git fetch origin "$MAIN_BRANCH" >/dev/null 2>&1; then
  add_failure "stale_main" "could not fetch origin/$MAIN_BRANCH; check network or remote"
elif ! git diff "origin/$MAIN_BRANCH" --quiet 2>/dev/null; then
  add_failure "stale_main" "local $MAIN_BRANCH differs from origin/$MAIN_BRANCH; pull or reset before /process-backlog"
fi

# 4. Backlog is non-empty excluding needs-human-labelled beads
ready_json="$(bd ready --limit="$READY_LIMIT" --json 2>/dev/null || echo '[]')"
total_count="$(jq 'length' <<< "$ready_json")"
unlabelled_count=0
if [ "$total_count" -gt 0 ]; then
  # Iterate and check label list per bead
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    if ! bd label list "$id" 2>/dev/null | grep -q '^  - needs-human$'; then
      unlabelled_count=$((unlabelled_count + 1))
    fi
  done < <(jq -r '.[].id' <<< "$ready_json")
fi

if [ "$unlabelled_count" -eq 0 ]; then
  add_failure "empty_backlog" "no ready beads available (excluding needs-human-labelled)"
fi

# Assemble final JSON
if [ "$(jq 'length' <<< "$failures")" -eq 0 ]; then
  jq -n '{ok: true, failures: []}'
  exit 0
else
  jq -n --argjson failures "$failures" '{ok: false, failures: $failures}'
  exit 1
fi
