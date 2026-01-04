#!/bin/bash
# Generate self-signed SSL certificates for federation testing
#
# This script creates SSL certificates for:
#   - alpha.federation.local
#   - beta.federation.local
#
# The certificates are used by nginx to serve HTTPS for federation testing.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="${SCRIPT_DIR}"

echo "Generating self-signed SSL certificates for federation testing..."
echo "Certificate directory: ${CERT_DIR}"

# Generate certificate for alpha.federation.local
echo ""
echo "==> Generating certificate for alpha.federation.local"
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "${CERT_DIR}/alpha.federation.local.key" \
  -out "${CERT_DIR}/alpha.federation.local.crt" \
  -subj "/C=US/ST=Test/L=Test/O=Pavillion/OU=Testing/CN=alpha.federation.local" \
  -addext "subjectAltName=DNS:alpha.federation.local"

# Generate certificate for beta.federation.local
echo ""
echo "==> Generating certificate for beta.federation.local"
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "${CERT_DIR}/beta.federation.local.key" \
  -out "${CERT_DIR}/beta.federation.local.crt" \
  -subj "/C=US/ST=Test/L=Test/O=Pavillion/OU=Testing/CN=beta.federation.local" \
  -addext "subjectAltName=DNS:beta.federation.local"

# Set appropriate permissions
chmod 644 "${CERT_DIR}"/*.crt
chmod 600 "${CERT_DIR}"/*.key

echo ""
echo "✅ SSL certificates generated successfully!"
echo ""
echo "Certificate files:"
echo "  - alpha.federation.local.crt"
echo "  - alpha.federation.local.key"
echo "  - beta.federation.local.crt"
echo "  - beta.federation.local.key"
echo ""
echo "⚠️  Note: These are self-signed certificates for testing only."
echo "    Node.js containers will be configured to trust them via NODE_EXTRA_CA_CERTS."
