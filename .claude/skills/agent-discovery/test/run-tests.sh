#!/usr/bin/env bash
# Fixture tests for agent-discovery scripts.
# Runs every test-*.sh file in this directory, reports pass/fail, and
# exits non-zero if any test fails.

set -u

TEST_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$TEST_DIR/.." && pwd)"
PASS=0
FAIL=0
FAILURES=()

cd "$TEST_DIR"

for test in test-*.sh; do
  [ -f "$test" ] || continue
  printf "  %-50s " "$test"
  if BASH_ENV="" SKILL_DIR="$SKILL_DIR" bash "$test" >/tmp/agent-discovery-test.out 2>&1; then
    echo "PASS"
    PASS=$((PASS + 1))
  else
    echo "FAIL"
    FAIL=$((FAIL + 1))
    FAILURES+=("$test")
    sed 's/^/    /' /tmp/agent-discovery-test.out
  fi
done

echo ""
echo "Summary: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "Failed tests:"
  for t in "${FAILURES[@]}"; do
    echo "  - $t"
  done
  exit 1
fi
