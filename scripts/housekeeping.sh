#!/bin/bash
#
# Pavillion Housekeeping Status Wrapper
#
# This script wraps the pavillion CLI for housekeeping status when running inside Docker.
# Usage: ./scripts/housekeeping.sh
#
# Shows:
#   - Scheduled jobs and their cron expressions
#   - Configuration settings (enabled/disabled, thresholds)
#   - Next run times for scheduled jobs
#
# Example:
#   ./scripts/housekeeping.sh
#

set -e

# Check if running in Docker or locally
if [ -f /.dockerenv ]; then
  # Inside Docker container - run directly
  node /app/bin/pavillion housekeeping
else
  # Outside Docker - use docker exec
  CONTAINER_NAME="${PAVILLION_CONTAINER:-pavillion-app-1}"

  # Check if container exists
  if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Error: Container '${CONTAINER_NAME}' not found or not running"
    echo "Set PAVILLION_CONTAINER environment variable to specify container name"
    exit 1
  fi

  # Execute command in container
  docker exec -it "${CONTAINER_NAME}" node /app/bin/pavillion housekeeping
fi
