#!/usr/bin/env bash
# Unit tests for bin/check-branch-overlap.sh.
#
# Every case builds its own throwaway git repository under a mktemp_dir, so
# the refs under test never touch this repository's history.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

CHECKER="${SCRIPT_DIR}/../check-branch-overlap.sh"

echo "check_branch_overlap_test.sh"

# Create a repository with one commit on main touching shared.txt and
# migrations/0001_init.ts, and echo its path. Identity and default branch are
# pinned so the test does not depend on the runner's git configuration.
make_repo() {
  local dir
  dir=$(mktemp_dir)
  git -C "$dir" init -q
  git -C "$dir" symbolic-ref HEAD refs/heads/main
  git -C "$dir" config user.email test@example.com
  git -C "$dir" config user.name Test
  git -C "$dir" config commit.gpgsign false
  mkdir -p "${dir}/migrations"
  echo base > "${dir}/shared.txt"
  echo init > "${dir}/migrations/0001_init.ts"
  git -C "$dir" add -A
  git -C "$dir" commit -q -m "initial"
  echo "$dir"
}

# commit_file <repo> <path> <content> <message>
commit_file() {
  local repo="$1" path="$2" content="$3" msg="$4"
  mkdir -p "$(dirname "${repo}/${path}")"
  echo "$content" > "${repo}/${path}"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "$msg"
}

# run_check <repo> <base> <head> — prints combined output then EXIT:<code>.
run_check() {
  local repo="$1" base="$2" head="$3"
  (cd "$repo" && "$CHECKER" "$base" "$head" 2>&1; echo "EXIT:$?")
}

echo "test: a file changed on both sides is reported with the base commit"
repo=$(make_repo)
git -C "$repo" checkout -q -b feature
commit_file "$repo" shared.txt feature "feature edits shared"
git -C "$repo" checkout -q main
commit_file "$repo" shared.txt main "main edits shared"
base_sha=$(git -C "$repo" rev-parse --short HEAD)
output=$(run_check "$repo" main feature)
assert_eq "1" "${output##*EXIT:}" "exits 1 when a path changed on both sides"
assert_contains "$output" "shared.txt" "names the overlapping path"
assert_contains "$output" "$base_sha" "names the base commit that touched it"
assert_contains "$output" "main edits shared" "includes the base commit subject"

echo "test: disjoint changes are not an overlap"
repo=$(make_repo)
git -C "$repo" checkout -q -b feature
commit_file "$repo" feature.txt feature "feature adds its own file"
git -C "$repo" checkout -q main
commit_file "$repo" other.txt main "main adds another file"
output=$(run_check "$repo" main feature)
assert_eq "0" "${output##*EXIT:}" "exits 0 when the change sets are disjoint"

echo "test: a head already merged into the base is not an overlap"
repo=$(make_repo)
git -C "$repo" checkout -q -b feature
commit_file "$repo" shared.txt feature "feature edits shared"
git -C "$repo" checkout -q main
git -C "$repo" merge -q --no-ff -m "merge feature" feature
commit_file "$repo" shared.txt later "main edits shared again"
output=$(run_check "$repo" main feature)
assert_eq "0" "${output##*EXIT:}" "exits 0 when head is an ancestor of base"

echo "test: a head that has merged the base in is not an overlap"
repo=$(make_repo)
git -C "$repo" checkout -q -b feature
commit_file "$repo" shared.txt feature "feature edits shared"
git -C "$repo" checkout -q main
commit_file "$repo" shared.txt main "main edits shared"
git -C "$repo" checkout -q feature
# Resolve the conflict in the head's favour; the base is now in its history.
git -C "$repo" merge -q -s ours -m "merge main" main
output=$(run_check "$repo" main feature)
assert_eq "0" "${output##*EXIT:}" "exits 0 when base is an ancestor of head"

echo "test: additions to migrations/ on both sides overlap despite different names"
repo=$(make_repo)
git -C "$repo" checkout -q -b feature
commit_file "$repo" migrations/0002_feature_column.ts f "feature adds a migration"
git -C "$repo" checkout -q main
commit_file "$repo" migrations/0002_main_column.ts m "main adds a migration"
base_sha=$(git -C "$repo" rev-parse --short HEAD)
output=$(run_check "$repo" main feature)
assert_eq "1" "${output##*EXIT:}" "exits 1 when both sides add to migrations/"
assert_contains "$output" "migrations/0002_feature_column.ts" "names the head's addition"
assert_contains "$output" "migrations/0002_main_column.ts" "names the base's addition"
assert_contains "$output" "$base_sha" "names the base commit that added the migration"

echo "test: an addition to migrations/ on one side only is not an overlap"
repo=$(make_repo)
git -C "$repo" checkout -q -b feature
commit_file "$repo" migrations/0002_feature_column.ts f "feature adds a migration"
git -C "$repo" checkout -q main
commit_file "$repo" migrations/0001_init.ts edited "main edits an existing migration"
output=$(run_check "$repo" main feature)
assert_eq "0" "${output##*EXIT:}" "exits 0 when only the head adds to migrations/"

echo "test: additions on both sides outside the configured directories are not an overlap"
repo=$(make_repo)
git -C "$repo" checkout -q -b feature
commit_file "$repo" src/feature.ts f "feature adds a source file"
git -C "$repo" checkout -q main
commit_file "$repo" src/main.ts m "main adds a source file"
output=$(run_check "$repo" main feature)
assert_eq "0" "${output##*EXIT:}" "exits 0 for differently-named additions elsewhere"

echo "test: an unknown ref is a usage error"
repo=$(make_repo)
output=$(run_check "$repo" main no-such-branch)
assert_eq "2" "${output##*EXIT:}" "exits 2 when a ref does not resolve"
assert_contains "$output" "no-such-branch" "names the unresolved ref"

echo "test: missing arguments are a usage error"
repo=$(make_repo)
output=$(cd "$repo" && "$CHECKER" main 2>&1; echo "EXIT:$?")
assert_eq "2" "${output##*EXIT:}" "exits 2 without both refs"

report_results
