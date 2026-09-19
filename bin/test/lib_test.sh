#!/usr/bin/env bash
# Unit tests for the shared helpers in lib.sh.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

echo "lib_test.sh"

echo "test: mktemp_dir returns a directory that exists in the caller"
tmp=$(mktemp_dir)
if [[ -d "$tmp" ]]; then
  echo "  PASS: directory exists after command substitution"
  _TESTS=$((_TESTS+1))
else
  fail "mktemp_dir directory was deleted before the caller received it (${tmp})"
fi

echo "test: successive mktemp_dir calls return distinct live directories"
tmp_b=$(mktemp_dir)
if [[ -d "$tmp_b" && "$tmp_b" != "$tmp" ]]; then
  echo "  PASS: second directory is distinct and exists"
  _TESTS=$((_TESTS+1))
else
  fail "second mktemp_dir call did not return a distinct live directory"
fi

echo "test: every mktemp_dir directory is removed when the calling script exits"
# The child only reports paths that were alive before it exited, so a helper
# that deletes its directory early cannot pass this test vacuously.
paths=$(bash -c '
  source "$1"
  a=$(mktemp_dir); b=$(mktemp_dir)
  [[ -d "$a" && -d "$b" ]] && { echo "$a"; echo "$b"; }
' _ "${SCRIPT_DIR}/lib.sh")
first=$(sed -n 1p <<< "$paths")
second=$(sed -n 2p <<< "$paths")
if [[ -n "$first" && -n "$second" && ! -e "$first" && ! -e "$second" ]]; then
  echo "  PASS: both directories removed at caller exit"
  _TESTS=$((_TESTS+1))
else
  fail "directories survived caller exit (${first}, ${second})"
fi

report_results
