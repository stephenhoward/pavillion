#!/bin/bash
# Wrapper script for starting the federation testing environment
# Automatically generates SSL certificates if they don't exist

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSL_DIR="${SCRIPT_DIR}/ssl"

# Check if certificates exist, generate if missing
if [ ! -f "${SSL_DIR}/alpha.federation.local.crt" ] || [ ! -f "${SSL_DIR}/beta.federation.local.crt" ]; then
    echo "SSL certificates not found. Generating..."
    "${SSL_DIR}/generate-certs.sh"
fi

# Start federation environment
docker compose -f docker-compose.federation.yml up -d
