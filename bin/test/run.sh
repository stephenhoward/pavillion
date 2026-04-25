#!/usr/bin/env bash
# Run all bash test scripts. Fails fast if any individual script fails.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

total_scripts=0
failed_scripts=0

for test in "${SCRIPT_DIR}"/*_test.sh; do
  total_scripts=$((total_scripts+1))
  echo ""
  echo "========================================"
  echo "Running: $(basename "$test")"
  echo "========================================"
  if ! bash "$test"; then
    failed_scripts=$((failed_scripts+1))
  fi
done

echo ""
echo "========================================"
echo "Overall: $((total_scripts - failed_scripts))/${total_scripts} test scripts passed"
echo "========================================"

if [[ $failed_scripts -gt 0 ]]; then
  exit 1
fi
