#!/usr/bin/env bash
# check-branch-overlap.sh — report where a branch and its base have both
# moved since they forked.
#
# Usage: bin/check-branch-overlap.sh <base-ref> <head-ref>
#
# Computes `git merge-base <base> <head>`, then compares what the base has
# changed since that fork point with what the head has changed since it.
# Every overlapping path is printed with the base commit that last touched
# it, so the output says what to rebase onto and why. Must be run inside the
# repository that holds both refs.
#
# A head already merged into the base, or a head that has merged the base
# in, has nothing on one side of the fork point and so never overlaps.
#
# Exit codes:
#   0  no overlap
#   1  at least one overlap
#   2  usage error, unresolvable ref, or no common ancestor

set -euo pipefail

# Two rules decide what counts as an overlap:
#
#   1. Same path. A file changed on both sides since the fork point overlaps,
#      whatever directory it lives in.
#   2. Same directory, additions only. In the directories below, a file
#      *added* on each side overlaps even when the filenames differ, because
#      the collision there is over the numeric prefix (0046_*.ts on both
#      branches) rather than over any one file — rule 1 cannot see it.
#
# Entries are repo-relative directory prefixes with a trailing slash.
ADDITION_OVERLAP_DIRS=(
  "migrations/"
)

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

if [[ $# -ne 2 ]]; then
  echo "usage: check-branch-overlap.sh <base-ref> <head-ref>" >&2
  exit 2
fi

BASE_REF="$1"
HEAD_REF="$2"

for ref in "$BASE_REF" "$HEAD_REF"; do
  if ! git rev-parse --verify --quiet "${ref}^{commit}" > /dev/null; then
    echo "check-branch-overlap: cannot resolve ref: ${ref}" >&2
    exit 2
  fi
done

base_sha=$(git rev-parse "${BASE_REF}^{commit}")
head_sha=$(git rev-parse "${HEAD_REF}^{commit}")

if ! fork_point=$(git merge-base "$base_sha" "$head_sha"); then
  echo "check-branch-overlap: ${BASE_REF} and ${HEAD_REF} share no history" >&2
  exit 2
fi

# Pathspecs below are repo-relative; run from the top level.
cd "$(git rev-parse --show-toplevel)"

# changed_since <commit> [<dir>] — net paths changed from the fork point to
# <commit>, one per line, sorted; with <dir>, only paths added under it.
# Renames are split into a delete and an add so both the old and new path
# take part in the comparison.
changed_since() {
  local commit="$1"
  if [[ $# -ge 2 ]]; then
    git diff --name-only --no-renames --diff-filter=A "$fork_point" "$commit" -- "$2"
  else
    git diff --name-only --no-renames "$fork_point" "$commit"
  fi | LC_ALL=C sort -u
}

# base_commit_for <path> — the base commit since the fork point that last
# touched <path>, as "<short-sha> <subject>".
base_commit_for() {
  git log -1 --format='%h %s' "${fork_point}..${base_sha}" -- "$1"
}

found=0
report_header() {
  if [[ $found -eq 0 ]]; then
    echo "check-branch-overlap: ${HEAD_REF} overlaps ${BASE_REF} since their fork point $(git rev-parse --short "$fork_point")."
  fi
  found=1
}

# Rule 1: same path.
same_path=$(LC_ALL=C comm -12 <(changed_since "$base_sha") <(changed_since "$head_sha"))
if [[ -n "$same_path" ]]; then
  report_header
  echo ""
  echo "Changed on both sides:"
  while IFS= read -r path; do
    echo "  ${path}"
    echo "    base: $(base_commit_for "$path")"
  done <<< "$same_path"
fi

# Rule 2: additions on both sides of a configured directory.
for dir in "${ADDITION_OVERLAP_DIRS[@]}"; do
  base_added=$(changed_since "$base_sha" "$dir")
  head_added=$(changed_since "$head_sha" "$dir")
  if [[ -z "$base_added" || -z "$head_added" ]]; then
    continue
  fi
  report_header
  echo ""
  echo "Added on both sides of ${dir} (names may differ; the prefixes can collide):"
  while IFS= read -r path; do
    echo "  head adds: ${path}"
  done <<< "$head_added"
  while IFS= read -r path; do
    echo "  base adds: ${path}"
    echo "    base: $(base_commit_for "$path")"
  done <<< "$base_added"
done

if [[ $found -eq 1 ]]; then
  echo ""
  echo "Rebase ${HEAD_REF} onto ${BASE_REF} and resolve the paths above."
  exit 1
fi

echo "check-branch-overlap: no overlap between ${HEAD_REF} and ${BASE_REF} since their fork point."
