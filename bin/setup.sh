#!/usr/bin/env bash
# bin/setup.sh — DEPRECATED. Use bin/deploy.sh instead.
#
# This script used to bootstrap a new Pavillion install. Its behavior
# has been folded into bin/deploy.sh, which is now the single entry
# point for install, upgrade, and redeploy.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cat >&2 <<'EOF'
[DEPRECATED] bin/setup.sh has been replaced by bin/deploy.sh.

bin/deploy.sh is the single entry point for:
  - first install         (when .env is absent)
  - upgrade               (when .env is present)
  - redeploy / restart    (idempotent re-runs)

Run:
  bin/deploy.sh              # interactive
  bin/deploy.sh --help       # see all flags

Forwarding this invocation to bin/deploy.sh...
EOF

exec "${SCRIPT_DIR}/deploy.sh" "$@"
