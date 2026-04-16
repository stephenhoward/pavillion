#!/usr/bin/env bash
#
# branch-name.sh <bead-id> [--type-override=<feat|fix|refactor|chore>]
#
# Derive a branch name from a bead's type + title.
#
# Output: <prefix>/<kebab-title>-<bead-id-lastseg>
# Example: pv-9cfj.3 (task) "Build bead-branch-and-pr skill..." ->
#          chore/build-bead-branch-and-pr-skill-pv-9cfj-3
#
# Exit codes:
#   0 - success, branch name on stdout
#   2 - missing or invalid bead id
#   3 - bd lookup failed / bead not found
#
# Testing hook: set BD_SHOW_CMD to a shell command that emits the same
# JSON shape as `bd show --json <id>` (used by the fixture tests).

set -euo pipefail

BEAD_ID="${1:-}"
TYPE_OVERRIDE=""
for arg in "${@:2}"; do
  case "$arg" in
    --type-override=*) TYPE_OVERRIDE="${arg#--type-override=}" ;;
  esac
done

if [ -z "$BEAD_ID" ]; then
  echo "usage: branch-name.sh <bead-id> [--type-override=<prefix>]" >&2
  exit 2
fi

# Max branch name length target (spec: <=60 chars).
MAX_LEN=60

# Run bd show via the configured command (supports fixture injection).
BD_CMD="${BD_SHOW_CMD:-bd show --json}"
if ! json="$($BD_CMD "$BEAD_ID" 2>/dev/null)"; then
  echo "branch-name.sh: bd lookup failed for '$BEAD_ID'" >&2
  exit 3
fi

title="$(printf '%s' "$json" | jq -r '.[0].title // ""')"
issue_type="$(printf '%s' "$json" | jq -r '.[0].issue_type // ""')"

if [ -z "$title" ]; then
  echo "branch-name.sh: no title found for '$BEAD_ID'" >&2
  exit 3
fi

# Map issue type -> branch prefix (conventional-commits compatible).
if [ -n "$TYPE_OVERRIDE" ]; then
  prefix="$TYPE_OVERRIDE"
else
  case "$issue_type" in
    bug)     prefix="fix" ;;
    feature) prefix="feat" ;;
    epic)    prefix="feat" ;;
    task|"") prefix="chore" ;;
    *)       prefix="chore" ;;
  esac
fi

# Kebab-case the title:
#  1. lowercase everything
#  2. replace any run of non-alphanumeric chars with a single hyphen
#  3. trim leading/trailing hyphens
kebab="$(printf '%s' "$title" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"

# Last segment of the bead id, with dots replaced by hyphens so it is
# branch-name safe (git allows dots but they clash with rev-parse globs).
id_slug="$(printf '%s' "$BEAD_ID" | tr '.' '-')"

# Compose: <prefix>/<kebab>-<id-slug>
# Reserve space for the prefix and the id-slug so we truncate the kebab part.
reserved=$((${#prefix} + 1 + ${#id_slug} + 1))  # prefix + "/" + id + "-"
budget=$((MAX_LEN - reserved))
if [ "$budget" -lt 8 ]; then
  budget=8
fi

if [ "${#kebab}" -gt "$budget" ]; then
  kebab="${kebab:0:$budget}"
  kebab="${kebab%-}"
fi

branch="${prefix}/${kebab}-${id_slug}"
printf '%s\n' "$branch"
