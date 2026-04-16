#!/usr/bin/env bash
# bd-escalate.sh — durable escalation marker for a bead that the autonomous
# loop cannot handle. Adds the `needs-human` label and appends an
# `## Escalation (<date>)` section to the bead's notes describing why.
#
# Usage: bd-escalate.sh <bead-id> <reason> [phase]
#   bead-id  required; e.g. pv-aaaa or pv-aaaa.2
#   reason   required; free-form string describing what went wrong
#   phase    optional; the /process-backlog phase that escalated (e.g. "3",
#            "3.5", "7"). Defaults to "unspecified".
#
# Exit codes:
#   0  escalation recorded (or already present for today)
#   2  usage error
#
# Idempotent: if today's `## Escalation (<date>)` section already appears in
# the bead's notes, the script skips the append but still issues the label
# add (cheap; bd treats labels as a set).

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: bd-escalate.sh <bead-id> <reason> [phase]" >&2
  exit 2
fi

BEAD_ID="$1"
REASON="$2"
PHASE="${3:-unspecified}"
TODAY="$(date +%Y-%m-%d)"

# Always (re-)add the label. bd's label add is set-based, so this is
# effectively idempotent.
bd label add "$BEAD_ID" needs-human >/dev/null 2>&1 || \
  bd update "$BEAD_ID" --add-label needs-human >/dev/null 2>&1 || true

# Idempotency check: look for an existing "## Escalation (<today>)" section
# in the bead's current notes. If present, skip the append.
notes="$(bd show "$BEAD_ID" --json 2>/dev/null | jq -r '.[0].notes // ""')"

if printf '%s' "$notes" | grep -qF "## Escalation ($TODAY)"; then
  # Already escalated today; nothing more to do.
  exit 0
fi

# Build the escalation block. Newlines in the value are preserved.
ESC_BLOCK="
## Escalation ($TODAY)

Phase: $PHASE
Reason: $REASON
"

bd update "$BEAD_ID" --append-notes "$ESC_BLOCK" >/dev/null 2>&1 || true

exit 0
