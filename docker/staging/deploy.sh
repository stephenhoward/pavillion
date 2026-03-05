#!/bin/bash
#
# Pavillion Staging Deploy Script
#
# Executed by the webhook listener when a valid deploy request is received.
# Pulls updated images, restarts containers, and prunes old images.
#
# This script uses a lockfile to prevent concurrent execution.
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

  log "Deploy started"

  cd "$APP_DIR"

  log "Pulling images..."
  docker compose pull >> "$LOG_FILE" 2>&1

  log "Restarting containers..."
  docker compose up -d --remove-orphans >> "$LOG_FILE" 2>&1

  log "Pruning old images..."
  docker image prune -f >> "$LOG_FILE" 2>&1

  log "Deploy complete"

) 200>"$LOCK_FILE"
