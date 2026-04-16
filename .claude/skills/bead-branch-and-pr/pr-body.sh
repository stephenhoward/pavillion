#!/usr/bin/env bash
#
# pr-body.sh <bead-id> [additional-bead-id ...]
#
# Render a PR body in markdown for bead work. First id is the primary
# target (title + description drive the summary); remaining ids are
# listed in the "Beads" section (for epic-closing PRs).
#
# Sections emitted:
#   ## Summary         - first sentence of the primary bead's description
#   ## Beads closed    - bulleted list of `- <id> - <title>`
#   ## Test plan       - default checklist (lint, unit, integration, build, e2e)
#
# Exit codes:
#   0 - success, markdown on stdout
#   2 - missing bead id
#   3 - bd lookup failed for any referenced bead
#
# Testing hook: BD_SHOW_CMD overrides `bd show --json`.

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: pr-body.sh <bead-id> [additional-bead-id ...]" >&2
  exit 2
fi

BD_CMD="${BD_SHOW_CMD:-bd show --json}"

fetch_bead() {
  local id="$1"
  local out
  if ! out="$($BD_CMD "$id" 2>/dev/null)"; then
    echo "pr-body.sh: bd lookup failed for '$id'" >&2
    exit 3
  fi
  printf '%s' "$out"
}

# Extract the first sentence from a paragraph: read up to the first period
# followed by whitespace, or the first newline, or the full string.
first_sentence() {
  local text="$1"
  # Flatten newlines to spaces so a period-bounded sentence can span wraps.
  text="$(printf '%s' "$text" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
  # Strip anything after the first ". " boundary. If none, keep the whole thing.
  local sentence
  sentence="$(printf '%s' "$text" | awk 'BEGIN{RS="\\. "} NR==1{print; exit}')"
  # awk's RS consumes the ". ", so restore a trailing period if it looks unterminated.
  case "$sentence" in
    *.) printf '%s' "$sentence" ;;
    *)  printf '%s.' "$sentence" ;;
  esac
}

primary_id="$1"
shift || true

primary_json="$(fetch_bead "$primary_id")"
primary_title="$(printf '%s' "$primary_json" | jq -r '.[0].title // ""')"
primary_desc="$(printf '%s' "$primary_json" | jq -r '.[0].description // ""')"

if [ -z "$primary_title" ]; then
  echo "pr-body.sh: no title for '$primary_id'" >&2
  exit 3
fi

summary_sentence=""
if [ -n "$primary_desc" ]; then
  summary_sentence="$(first_sentence "$primary_desc")"
fi

printf '## Summary\n\n'
printf -- '- %s\n' "$primary_title"
if [ -n "$summary_sentence" ]; then
  printf -- '- %s\n' "$summary_sentence"
fi
printf '\n## Beads closed\n\n'
printf -- '- %s - %s\n' "$primary_id" "$primary_title"
for extra_id in "$@"; do
  extra_json="$(fetch_bead "$extra_id")"
  extra_title="$(printf '%s' "$extra_json" | jq -r '.[0].title // ""')"
  printf -- '- %s - %s\n' "$extra_id" "$extra_title"
done
printf '\n## Test plan\n\n'
printf -- '- [ ] `npm run lint`\n'
printf -- '- [ ] `npm run test:unit`\n'
printf -- '- [ ] `npm run test:integration`\n'
printf -- '- [ ] `npm run build`\n'
printf -- '- [ ] Relevant e2e specs passing via build-guardian\n'
