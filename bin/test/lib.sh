#!/usr/bin/env bash
# Shared test helpers. Source this file from *_test.sh scripts.
# Tests increment _FAILS on failure; test scripts exit with that count.

_FAILS=0
_TESTS=0

assert_eq() {
  # assert_eq <expected> <actual> <message>
  local expected="$1"
  local actual="$2"
  local msg="${3:-assertion}"
  _TESTS=$((_TESTS+1))
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS: ${msg}"
  else
    echo "  FAIL: ${msg}"
    echo "    expected: ${expected}"
    echo "    actual:   ${actual}"
    _FAILS=$((_FAILS+1))
  fi
}

assert_contains() {
  # assert_contains <haystack> <needle> <message>
  local haystack="$1"
  local needle="$2"
  local msg="${3:-assertion}"
  _TESTS=$((_TESTS+1))
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "  PASS: ${msg}"
  else
    echo "  FAIL: ${msg}"
    echo "    haystack: ${haystack}"
    echo "    needle:   ${needle}"
    _FAILS=$((_FAILS+1))
  fi
}

assert_exit_code() {
  # assert_exit_code <expected_code> <actual_code> <message>
  local expected="$1"
  local actual="$2"
  local msg="${3:-assertion}"
  _TESTS=$((_TESTS+1))
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS: ${msg}"
  else
    echo "  FAIL: ${msg} (expected exit ${expected}, got ${actual})"
    _FAILS=$((_FAILS+1))
  fi
}

fail() {
  # fail <message> — record an unconditional failure
  local msg="${1:-failure}"
  _TESTS=$((_TESTS+1))
  _FAILS=$((_FAILS+1))
  echo "  FAIL: ${msg}"
}

report_results() {
  echo ""
  echo "Results: $((_TESTS - _FAILS))/${_TESTS} passed"
  exit "$_FAILS"
}

mktemp_dir() {
  # Create temp dir and register cleanup.
  local dir
  dir=$(mktemp -d)
  trap "rm -rf '${dir}'" EXIT
  echo "$dir"
}
