# Pavillion Docker Image
# Multi-stage build for production deployment
#
# Stages:
#   - development: For docker-compose.dev.yml with hot-reload
#   - builder: Builds frontend assets for production
#   - production: Final production image

# ==============================================================================
# Stage: Development (for docker-compose.dev.yml)
# ==============================================================================
FROM node:22-bookworm AS development

WORKDIR /app

# Install dumb-init for proper signal handling and postgresql-client for backups
# Add PostgreSQL APT repository to get version 17 client tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql-archive-keyring.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    postgresql-client-17 \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install ALL dependencies (including devDependencies)
COPY package*.json ./
RUN npm ci

# Copy unified entrypoint script
COPY bin/entrypoint.sh ./entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Source code will be mounted as volume - no COPY needed
# Config files mounted separately for flexibility

ENV NODE_ENV=development

# Backend (3000) and Vite dev server (5173)
EXPOSE 3000 5173

# Use dumb-init for proper signal handling, then unified entrypoint
ENTRYPOINT ["dumb-init", "--", "/app/entrypoint.sh"]

# ==============================================================================
# Stage 1: Build stage
# ==============================================================================
FROM node:22-bookworm AS builder

WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./

# Install all dependencies (including devDependencies for building frontend)
RUN npm ci

# Copy source code and configuration
COPY src/ ./src/
COPY migrations/ ./migrations/
COPY config/default.yaml config/production.yaml config/custom-environment-variables.yaml ./config/
COPY tsconfig.json vite.config.ts ./

# Build frontend assets with Vite
RUN npm run build:frontend

# ==============================================================================
# Stage 2: Production runtime
# ==============================================================================
FROM node:22-slim AS production

# Install required system packages
# - dumb-init: proper signal handling for Node.js in containers
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd --gid 1001 pavillion \
    && useradd --uid 1001 --gid pavillion --shell /bin/bash --create-home pavillion

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only (tsx is now in dependencies)
RUN npm ci --omit=dev && npm cache clean --force

# Copy built frontend assets from builder stage
COPY --from=builder /app/dist ./dist

# Copy TypeScript source files (tsx runs TypeScript directly)
COPY --from=builder /app/src ./src

# Copy migrations (TypeScript files - dynamically imported by tsx)
COPY --from=builder /app/migrations ./migrations

# Copy configuration files
COPY --from=builder /app/config ./config
COPY --from=builder /app/tsconfig.json ./

# Copy entrypoint script and make it executable
COPY bin/entrypoint.sh ./
RUN chmod +x /app/entrypoint.sh

# Create directories for runtime data
RUN mkdir -p /app/storage/media /app/logs \
    && chown -R pavillion:pavillion /app

# Switch to non-root user
USER pavillion

# Environment variables (can be overridden at runtime)
ENV NODE_ENV=production
ENV PORT=3000

# Expose the application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Use dumb-init as entrypoint for proper signal handling
# The entrypoint script handles database wait, migrations, and app startup
ENTRYPOINT ["dumb-init", "--", "/app/entrypoint.sh"]

# No CMD needed - entrypoint.sh starts the application
