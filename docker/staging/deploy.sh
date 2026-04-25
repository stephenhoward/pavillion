#!/bin/bash
#
# Pavillion Staging Deploy Script
#
# Webhook-triggered wrapper around bin/deploy.sh. Calls the unified deploy
# tool in non-interactive mode. flock guards against concurrent deploys.
#

set -euo pipefail

APP_DIR="/opt/pavillion"
LOG_FILE="${APP_DIR}/deploy.log"
LOCK_FILE="/tmp/pavillion-deploy.lock"

log() {
  echo "$(date -Iseconds) $1" >> "$LOG_FILE"
}

(
  if ! flock -n 200; then
    log "ERROR: Deploy already in progress, skipping"
    exit 1
  fi

  log "Staging deploy started"

  cd "$APP_DIR"

  if ! bash bin/deploy.sh --non-interactive >> "$LOG_FILE" 2>&1; then
    log "ERROR: bin/deploy.sh failed (exit $?)"
    exit 1
  fi

  log "Pruning old images..."
  docker image prune -f >> "$LOG_FILE" 2>&1 || true

  log "Staging deploy complete"

) 200>"$LOCK_FILE"
