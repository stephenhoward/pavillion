#!/usr/bin/env bash
# bd-enrichment-check.sh - exits 0 if the bead's notes contain
# "Implementation Context", exits 1 otherwise.
#
# Usage:
#   bd-enrichment-check.sh <bead-id>
#   bd-enrichment-check.sh --fixture <path-to-bd-show-output>
#
# Exit codes:
#   0  Notes contain "Implementation Context" (enriched / analyzed)
#   1  Notes do not contain "Implementation Context" (unenriched)
#   2  Usage error (missing argument, unreadable fixture, missing bd CLI)
#
# No output on success. Prints a single diagnostic line to stderr on usage error.

set -euo pipefail

usage() {
  printf 'Usage: %s <bead-id>\n       %s --fixture <path>\n' "$0" "$0" >&2
  exit 2
}

if [[ $# -lt 1 ]]; then
  usage
fi

source="$1"
if [[ "$source" == "--fixture" ]]; then
  if [[ $# -lt 2 ]]; then
    usage
  fi
  fixture="$2"
  if [[ ! -r "$fixture" ]]; then
    printf 'bd-enrichment-check.sh: fixture not readable: %s\n' "$fixture" >&2
    exit 2
  fi
  content="$(cat -- "$fixture")"
else
  if ! command -v bd >/dev/null 2>&1; then
    printf 'bd-enrichment-check.sh: bd CLI not found on PATH\n' >&2
    exit 2
  fi
  content="$(bd show "$source" 2>&1)" || {
    printf 'bd-enrichment-check.sh: bd show %s failed\n' "$source" >&2
    exit 2
  }
fi

if printf '%s\n' "$content" | grep -q "Implementation Context"; then
  exit 0
fi
exit 1
