#!/bin/bash
#
# Pavillion Container Entrypoint Script (Unified)
#
# This script handles the startup sequence for all Pavillion container modes:
# - Development web: Hot-reload with Vite frontend + backend
# - Development worker: Hot-reload worker with tsx watch
# - Production web: Run migrations, then start Node.js server
# - Production worker: Start worker for background job processing
#
# Environment Variables:
#   NODE_ENV        - "development" or "production" (required)
#   DB_HOST         - PostgreSQL host (required)
#   DB_PORT         - PostgreSQL port (default: 5432)
#   DB_USER         - PostgreSQL user (required)
#   DB_PASSWORD     - PostgreSQL password (required, or DB_PASSWORD_FILE in production)
#   DB_NAME         - PostgreSQL database name (default: pavillion)
#   DB_WAIT_TIMEOUT - Seconds to wait for database (default: 30)
#
# Docker Secrets Support (Production only):
#   The following environment variables support the _FILE suffix pattern
#   for Docker secrets integration:
#   - DB_PASSWORD_FILE      -> DB_PASSWORD
#   - JWT_SECRET_FILE       -> JWT_SECRET
#   - SESSION_SECRET_FILE   -> SESSION_SECRET
#   - S3_SECRET_KEY_FILE    -> S3_SECRET_KEY
#   - SMTP_PASSWORD_FILE    -> SMTP_PASSWORD
#
# Worker Mode:
#   When the --worker flag is present in the command, the container runs in
#   worker mode and does not start the HTTP server. Worker mode is used for
#   processing background jobs including database backups and monitoring.
#
# Usage:
#   Development web:    NODE_ENV=development ./entrypoint.sh
#   Development worker: NODE_ENV=development ./entrypoint.sh --worker
#   Production web:     NODE_ENV=production ./entrypoint.sh
#   Production worker:  NODE_ENV=production ./entrypoint.sh --worker
#

set -e

# Default values
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-pavillion}"
DB_WAIT_TIMEOUT="${DB_WAIT_TIMEOUT:-30}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Detect if running in development mode
is_development() {
  [ "$NODE_ENV" = "development" ] || [ "$NODE_ENV" = "federation" ]
}

is_federation() {
  [ "$NODE_ENV" = "federation" ]
}

# Detect if running in worker mode
is_worker_mode() {
  # Check if --worker flag is present in arguments
  for arg in "$@"; do
    if [ "$arg" = "--worker" ]; then
      return 0
    fi
  done
  return 1
}

# Get log prefix based on mode
get_log_prefix() {
  if is_development; then
    if is_worker_mode "$@"; then
      echo "WORKER"
    else
      echo "DEV"
    fi
  else
    if is_worker_mode "$@"; then
      echo "Worker"
    else
      echo "INFO"
    fi
  fi
}

# Logging functions
log_info() {
  local prefix
  prefix=$(get_log_prefix "$@")
  echo -e "${GREEN}[${prefix}]${NC} $1"
}

log_warn() {
  local prefix
  prefix=$(get_log_prefix "$@")
  echo -e "${YELLOW}[${prefix}]${NC} $1"
}

log_error() {
  local prefix
  prefix=$(get_log_prefix "$@")
  echo -e "${RED}[${prefix}]${NC} $1"
}

# Function to read secrets from Docker secrets files (production only)
# Usage: file_env 'VAR_NAME'
# If VAR_NAME_FILE is set, reads the file contents into VAR_NAME
# Then unsets VAR_NAME_FILE for security
file_env() {
  local var="$1"
  local fileVar="${var}_FILE"
  local fileValue="${!fileVar:-}"

  # If _FILE variable is set, read the secret from the file
  if [ -n "$fileValue" ]; then
    if [ -f "$fileValue" ]; then
      # Read the secret from file (trim trailing newlines)
      local secretValue
      secretValue="$(cat "$fileValue")"
      export "$var"="$secretValue"
      log_info "Loaded ${var} from Docker secret file"
    else
      log_warn "Secret file not found: ${fileValue} (for ${var})"
    fi
    # Unset the _FILE variable for security
    unset "$fileVar"
  fi
  # If _FILE is not set, leave the existing env var unchanged (backward compatibility)
}

# Function to wait for database to be ready
wait_for_db() {
  log_info "Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."

  local elapsed=0
  local interval=2

  while [ $elapsed -lt $DB_WAIT_TIMEOUT ]; do
    # Try to connect using Node.js with a simple connection test
    if node -e "
      const { Sequelize } = require('sequelize');
      const sequelize = new Sequelize({
        dialect: 'postgres',
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'pavillion',
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
  log_error "Please check that the database is running and accessible at ${DB_HOST}:${DB_PORT}"
  return 1
}

# Function to run database migrations (production only)
run_migrations() {
  log_info "Running database migrations..."

  # Run migrations using the migration runner
  if npx tsx -e "
    import { runMigrations } from './src/server/common/migrations/runner.ts';
    import db from './src/server/common/entity/db.ts';
    import path from 'path';

    async function main() {
      try {
        const migrationsPath = path.join(process.cwd(), 'migrations');
        const result = await runMigrations(db, migrationsPath);

        if (!result.success) {
          console.error('Migration failed:', result.error?.message);
          process.exit(1);
        }

        if (result.executed.length > 0) {
          console.log('Successfully executed migrations:', result.executed.join(', '));
        } else {
          console.log('No pending migrations to run.');
        }

        await db.close();
        process.exit(0);
      } catch (error) {
        console.error('Migration error:', error.message);
        process.exit(1);
      }
    }

    main();
  "; then
    log_info "Migrations completed successfully"
    return 0
  else
    log_error "Migration failed! Container will exit."
    log_error "Please check the migration logs above for details."
    return 1
  fi
}

# Function to start the application
start_app() {
  if is_federation; then
    # Federation testing mode - backend only with hot-reload
    log_info "Starting federation instance..."
    log_info "  Backend:  http://localhost:3000"
    log_info "========================================"
    exec npx tsx watch src/server/app.ts
  elif is_development; then
    # Development mode
    if is_worker_mode "$@"; then
      log_info "Starting worker process with hot-reload..."
      log_info "  Processing jobs from pg-boss queue"
      log_info "  Scheduled jobs:"
      log_info "    - backup:daily (2:00 AM)"
      log_info "    - disk:check (hourly)"
      log_info "========================================"
      # Use unified app.ts entry point with --worker flag
      exec npx tsx watch src/server/app.ts -- --worker
    else
      log_info "Starting development servers..."
      log_info "  Backend:  http://localhost:3000"
      log_info "  Vite HMR: http://localhost:5173"
      log_info "========================================"
      exec npm run dev
    fi
  else
    # Production mode
    if is_worker_mode "$@"; then
      log_info "[Worker] Starting Pavillion worker..."
      log_info "[Worker] HTTP server disabled in worker mode"
      exec npm start -- --worker
    else
      log_info "Starting Pavillion application (web mode)..."
      exec npm start
    fi
  fi
}

# Main entrypoint logic
main() {
  log_info "========================================"
  if is_development; then
    if is_worker_mode "$@"; then
      log_info "Pavillion Worker Container (Development)"
    else
      log_info "Pavillion Development Container"
    fi
  else
    if is_worker_mode "$@"; then
      log_info "Pavillion Worker Container Startup"
    else
      log_info "Pavillion Container Startup"
    fi
  fi
  log_info "========================================"

  # Process Docker secrets from _FILE environment variables (production only)
  # This must happen before validation and database connection
  if ! is_development; then
    file_env 'DB_PASSWORD'
    file_env 'JWT_SECRET'
    file_env 'SESSION_SECRET'
    file_env 'S3_SECRET_KEY'
    file_env 'SMTP_PASSWORD'
  fi

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

  # Step 1: Wait for database
  if ! wait_for_db; then
    exit 1
  fi

  # Step 2: Run migrations (production web mode only)
  # - Development: app.ts handles database reset/seed
  # - Production worker: Skips migrations (web container handles them)
  if ! is_development && ! is_worker_mode "$@"; then
    if ! run_migrations; then
      exit 1
    fi
  elif ! is_development && is_worker_mode "$@"; then
    log_info "[Worker] Skipping migrations (handled by web container)"
  fi

  # Step 3: Start application
  start_app "$@"
}

# Allow sourcing for testing individual functions
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
