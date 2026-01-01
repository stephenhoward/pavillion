#!/bin/bash
#
# Pavillion Development Container Entrypoint Script
#
# This script handles the startup sequence for the development container:
# 1. Wait for PostgreSQL database to be ready
# 2. Start the development servers (frontend + backend)
#
# Environment Variables:
#   DB_HOST     - PostgreSQL host (required)
#   DB_PORT     - PostgreSQL port (default: 5432)
#   DB_USER     - PostgreSQL user (required)
#   DB_PASSWORD - PostgreSQL password (required)
#   DB_NAME     - PostgreSQL database name (default: pavillion_dev)
#

set -e

# Default values
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-pavillion_dev}"
DB_WAIT_TIMEOUT="${DB_WAIT_TIMEOUT:-30}"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${GREEN}[DEV]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[DEV]${NC} $1"
}

log_error() {
  echo -e "${RED}[DEV]${NC} $1"
}

# Wait for database to be ready
wait_for_db() {
  log_info "Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."

  local elapsed=0
  local interval=2

  while [ $elapsed -lt $DB_WAIT_TIMEOUT ]; do
    # Try to connect using Node.js
    if node -e "
      const { Sequelize } = require('sequelize');
      const sequelize = new Sequelize({
        dialect: 'postgres',
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'pavillion_dev',
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        logging: false,
      });
      sequelize.authenticate()
        .then(() => { sequelize.close(); process.exit(0); })
        .catch(() => process.exit(1));
    " 2>/dev/null; then
      log_info "PostgreSQL is ready!"
      return 0
    fi

    elapsed=$((elapsed + interval))
    log_info "Database not ready, waiting... (${elapsed}s/${DB_WAIT_TIMEOUT}s)"
    sleep $interval
  done

  log_error "Timeout waiting for PostgreSQL after ${DB_WAIT_TIMEOUT} seconds"
  return 1
}

# Main entrypoint logic
main() {
  log_info "========================================"
  log_info "Pavillion Development Container"
  log_info "========================================"

  # Validate required environment variables
  if [ -z "$DB_HOST" ]; then
    log_error "DB_HOST environment variable is required"
    exit 1
  fi

  if [ -z "$DB_USER" ]; then
    log_error "DB_USER environment variable is required"
    exit 1
  fi

  if [ -z "$DB_PASSWORD" ]; then
    log_error "DB_PASSWORD environment variable is required"
    exit 1
  fi

  # Wait for database
  if ! wait_for_db; then
    exit 1
  fi

  log_info "Starting development servers..."
  log_info "  Backend:  http://localhost:3000"
  log_info "  Vite HMR: http://localhost:5173"
  log_info "========================================"

  # Start development servers
  exec npm run dev
}

# Allow sourcing for testing individual functions
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
