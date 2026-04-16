#!/usr/bin/env bash
#
# git-safe-to-start.sh
#
# Cheap check that the working tree is clean and we are on the main branch.
# A "safe to start" state means we can branch off main without losing
# work. This is intentionally a subset of the full preflight in
# bead-backlog-selection; it exists so phase-6 orchestration can
# re-verify the narrow invariant right before creating a branch.
#
# Exit codes:
#   0 - safe (clean tree, on main)
#   1 - unsafe (dirty tree, wrong branch, or other git failure)
#   2 - git itself failed unexpectedly
#
# Output: a one-line reason on stderr when exit is non-zero.
#
# Testing hook: set GIT_SAFE_MAIN_BRANCH to override the expected branch
# name (default: main). Set GIT_CMD to override the `git` invocation for
# fixture-style tests (rarely needed; most tests use a real temp repo).

set -euo pipefail

MAIN_BRANCH="${GIT_SAFE_MAIN_BRANCH:-main}"
GIT_BIN="${GIT_CMD:-git}"

if ! "$GIT_BIN" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "git-safe-to-start: not inside a git work tree" >&2
  exit 2
fi

current_branch="$("$GIT_BIN" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
if [ "$current_branch" != "$MAIN_BRANCH" ]; then
  echo "git-safe-to-start: on '$current_branch', expected '$MAIN_BRANCH'" >&2
  exit 1
fi

# Porcelain output is empty iff the working tree is clean (no staged,
# unstaged, or untracked changes).
if [ -n "$("$GIT_BIN" status --porcelain 2>/dev/null)" ]; then
  echo "git-safe-to-start: working tree is dirty" >&2
  exit 1
fi

exit 0
