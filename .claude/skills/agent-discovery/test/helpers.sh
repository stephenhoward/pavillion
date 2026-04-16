#!/usr/bin/env bash
# Shared helpers for agent-discovery fixture tests.
#
# Each test sources this file, points AGENTS_DIR at the fixtures dir, and
# calls the scripts under test directly. No git/bd shims needed — these
# scripts only touch files and jq.

set -u

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="$SKILL_DIR/test"
FIXTURES_DIR="$TEST_DIR/fixtures/agents"

export AGENTS_DIR="$FIXTURES_DIR"

fail() {
  echo "ASSERTION FAILED: $*" >&2
  exit 1
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local msg="${3:-}"
  if [ "$expected" != "$actual" ]; then
    fail "${msg:-values differ}
  expected: $expected
  actual:   $actual"
  fi
}

assert_json_length() {
  local json="$1"
  local expected="$2"
  local msg="${3:-}"
  local actual
  actual="$(echo "$json" | jq 'length')"
  if [ "$expected" != "$actual" ]; then
    fail "${msg:-length differs}
  expected length: $expected
  actual length:   $actual
  json:            $json"
  fi
}

assert_json_contains_name() {
  local json="$1"
  local name="$2"
  local msg="${3:-}"
  local found
  found="$(echo "$json" | jq -r --arg n "$name" '[.[] | select(.name == $n)] | length')"
  if [ "$found" = "0" ]; then
    fail "${msg:-agent name not in matches}
  name: $name
  json: $json"
  fi
}

assert_json_not_contains_name() {
  local json="$1"
  local name="$2"
  local msg="${3:-}"
  local found
  found="$(echo "$json" | jq -r --arg n "$name" '[.[] | select(.name == $n)] | length')"
  if [ "$found" != "0" ]; then
    fail "${msg:-agent name unexpectedly present}
  name: $name
  json: $json"
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local msg="${3:-}"
  case "$haystack" in
    *"$needle"*) ;;
    *) fail "${msg:-string missing}
  haystack: $haystack
  needle:   $needle" ;;
  esac
}
