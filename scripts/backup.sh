#!/bin/bash
#
# Pavillion Backup Management Wrapper
#
# This script wraps the pavillion CLI for backup operations when running inside Docker.
# Usage: ./scripts/backup.sh <command> [args]
#
# Commands:
#   create              Queue an immediate backup
#   list                List all available backups
#   status              Show backup system health
#   restore <backup-id> Restore from a specific backup (requires confirmation)
#
# Examples:
#   ./scripts/backup.sh create
#   ./scripts/backup.sh list
#   ./scripts/backup.sh status
#   ./scripts/backup.sh restore 123e4567-e89b-12d3-a456-426614174000
#

set -e

# Check if running in Docker or locally
if [ -f /.dockerenv ]; then
  # Inside Docker container - run directly
  node /app/bin/pavillion backup "$@"
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
  docker exec -it "${CONTAINER_NAME}" node /app/bin/pavillion backup "$@"
fi
