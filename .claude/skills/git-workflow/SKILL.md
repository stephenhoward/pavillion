---
name: git-workflow
description: Pavillion git and GitHub conventions for branches, commits, pushes, pull requests, and releases. Use when naming a branch, drafting a commit message, pushing a branch to origin, opening a pull request, or cutting a release.
---

# Git Workflow

Pavillion's git and GitHub conventions. This skill is the canonical source for branch naming, commit format, pull-request shape, and release-notes format and procedure.

## Foundational principle

GitHub artifacts must be self-contained for GitHub readers. Local-only references (bead IDs, personal tracker IDs) do not appear in branch names, commits, PR titles or bodies, or release notes. Only GitHub-referenceable identifiers — PR numbers, issue numbers, commit SHAs, release tags — appear in GitHub-visible artifacts.

## Reference files

| Operation | File |
|---|---|
| Naming a branch | [branches.md](branches.md) |
| Writing a commit | [commits.md](commits.md) |
| Pushing a branch to origin | [pull-requests.md](pull-requests.md) (also see local-vs-remote in [branches.md](branches.md)) |
| Opening a pull request | [pull-requests.md](pull-requests.md) |
| Working with a stacked branch / restacking | [stacking.md](stacking.md) |
| Cutting a release | [releases.md](releases.md) |

Read the relevant reference file for the operation you are doing. Each is self-contained — you do not need to read the others.

## Related

The `bead-branch-and-pr` skill provides orchestrator-internal helper scripts (`branch-name.sh`, `commit-msg.sh`, `pr-body.sh`), the `gitSafeToStart` working-tree check, and the build-guardian-before-push gate. It consumes the conventions defined here; it is not a parallel source of truth.
