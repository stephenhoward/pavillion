#!/usr/bin/env bash
# bd-state.sh - classify a bead's lifecycle state by parsing `bd show`.
#
# Usage:
#   bd-state.sh <bead-id>
#   bd-state.sh --fixture <path-to-bd-show-output>
#
# Emits JSON on stdout:
#   {
#     "state": "unshaped|shaped|decomposed|analyzed|executing|complete",
#     "missing_phases": ["shaped", "decomposed", ...],
#     "reasons": ["short human-readable signal strings", ...]
#   }
#
# State progression (monotonic):
#   unshaped  -> shaped  -> decomposed  -> analyzed  -> executing  -> complete
# A bead's state is the highest milestone it has reached; closed and
# in_progress statuses short-circuit the section-based detection.
#
# Exit codes:
#   0  Classification succeeded; JSON written to stdout
#   2  Usage error or unreadable fixture / failing bd CLI

set -euo pipefail

usage() {
  printf 'Usage: %s <bead-id>\n       %s --fixture <path>\n' "$0" "$0" >&2
  exit 2
}

if [[ $# -lt 1 ]]; then
  usage
fi

load_content() {
  local source="$1"
  if [[ "$source" == "--fixture" ]]; then
    if [[ $# -lt 2 ]]; then
      usage
    fi
    local fixture="$2"
    if [[ ! -r "$fixture" ]]; then
      printf 'bd-state.sh: fixture not readable: %s\n' "$fixture" >&2
      exit 2
    fi
    cat -- "$fixture"
    return
  fi
  if ! command -v bd >/dev/null 2>&1; then
    printf 'bd-state.sh: bd CLI not found on PATH\n' >&2
    exit 2
  fi
  if ! bd show "$source" 2>/dev/null; then
    printf 'bd-state.sh: bd show %s failed\n' "$source" >&2
    exit 2
  fi
}

content="$(load_content "$@")"

# Detect the header status from the bracketed indicator on the first line,
# e.g. "[● P3 · IN_PROGRESS]" or "[● P1 · CLOSED]".
header="$(printf '%s\n' "$content" | head -n 1)"
status="unknown"
case "$header" in
  *CLOSED*)      status="closed" ;;
  *IN_PROGRESS*) status="in_progress" ;;
  *OPEN*)        status="open" ;;
esac

# Section presence: bd show prints top-level section headers in ALL CAPS on
# their own line, so anchoring on ^ is safe.
has_section() {
  printf '%s\n' "$content" | grep -qE "^$1$"
}

# Description text is non-empty only if we can find at least one non-blank
# line between the "DESCRIPTION" header and the next header or EOF.
description_nonempty() {
  printf '%s\n' "$content" \
    | awk '
        /^DESCRIPTION$/ { inblock = 1; next }
        inblock && /^[A-Z][A-Z ]+$/ { exit }
        inblock && NF > 0 { print; exit }
      ' \
    | grep -q '.'
}

# Children section lists at least one bead (lines starting with "  ↳ ").
has_child_bead() {
  printf '%s\n' "$content" | grep -qE '^[[:space:]]+↳ '
}

# Notes block must explicitly carry the "Implementation Context" marker that
# /analyze-bead writes when enriching a leaf.
has_implementation_context() {
  printf '%s\n' "$content" | grep -q 'Implementation Context'
}

reasons=()
missing=()

has_desc=0
has_design=0
has_accept=0
has_children=0
has_impl_ctx=0

if has_section 'DESCRIPTION' && description_nonempty; then
  has_desc=1
  reasons+=('has non-empty DESCRIPTION')
else
  reasons+=('missing or empty DESCRIPTION')
fi

if has_section 'DESIGN'; then
  has_design=1
  reasons+=('has DESIGN section')
else
  reasons+=('missing DESIGN section')
fi

if has_section 'ACCEPTANCE CRITERIA'; then
  has_accept=1
  reasons+=('has ACCEPTANCE CRITERIA section')
else
  reasons+=('missing ACCEPTANCE CRITERIA section')
fi

if has_section 'CHILDREN' && has_child_bead; then
  has_children=1
  reasons+=('has CHILDREN with at least one child bead')
fi

if has_implementation_context; then
  has_impl_ctx=1
  reasons+=('notes contain Implementation Context')
fi

# Build missing_phases (the ladder of milestones yet to be reached).
if [[ $has_desc -ne 1 || $has_design -ne 1 || $has_accept -ne 1 ]]; then
  missing+=('shaped')
fi
if [[ $has_children -ne 1 ]]; then
  missing+=('decomposed')
fi
if [[ $has_impl_ctx -ne 1 ]]; then
  missing+=('analyzed')
fi

# Decide state. Status takes precedence; otherwise walk the milestone ladder.
state="unshaped"
if [[ "$status" == "closed" ]]; then
  state="complete"
  reasons+=('bead status is CLOSED')
elif [[ "$status" == "in_progress" ]]; then
  state="executing"
  reasons+=('bead status is IN_PROGRESS')
elif [[ $has_impl_ctx -eq 1 ]]; then
  state="analyzed"
elif [[ $has_children -eq 1 ]]; then
  state="decomposed"
elif [[ $has_desc -eq 1 && $has_design -eq 1 && $has_accept -eq 1 ]]; then
  state="shaped"
fi

# Build JSON arrays for missing_phases and reasons via jq, which safely
# re-quotes every element. Never string-concatenate bd output into JSON.
to_json_array() {
  if [[ $# -eq 0 ]]; then
    printf '[]'
    return
  fi
  printf '%s\n' "$@" | jq -R . | jq -s .
}

missing_json="$(to_json_array "${missing[@]+"${missing[@]}"}")"
reasons_json="$(to_json_array "${reasons[@]+"${reasons[@]}"}")"

jq -n \
  --arg state "$state" \
  --argjson missing_phases "$missing_json" \
  --argjson reasons "$reasons_json" \
  '{state: $state, missing_phases: $missing_phases, reasons: $reasons}'
