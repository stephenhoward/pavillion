# Stacked Branches (Graphite)

All branch creation and PR submission goes through the Graphite CLI (`gt`), including single, unstacked beads. `gh` remains the tool for PR body edits, merging, and CI queries.

This file is the **sole source of truth** for gt command patterns and stacking rules. Other skills (`bead-branch-and-pr`, `bead-backlog-selection`, `bead-wave-orchestration`, etc.) cross-reference this file; they do not restate its contents. The corresponding gt operations for orchestrators are implemented only in `.claude/orchestrators/lib/helpers.ts` (`stackCreate`, `stackSubmit`, `syncAndRestack`).

## When a stack exists

A stack exists when:

- **Dependency-driven:** a bd dependency chain among sibling beads — each bead's branch builds on its predecessor's.
- **Size-driven:** an oversized single piece of work split at working checkpoints into reviewable levels.

Independent pieces of work are **not** a stack: they stay as parallel branches off `main`, each created via gt.

## gt command patterns

| Old | New |
|---|---|
| `git checkout -b <name>` | `gt create <name> -m "<msg>"` (or `gt create <name> --onto <parent>` before work starts) |
| `git push` + `gh pr create` | `gt submit --no-interactive --publish` |
| post-merge cleanup + rebase | `gt sync -f` then `gt submit --stack --no-interactive --publish` |

Rules:

- **Branch names are always passed explicitly** — never auto-generated from commit messages, never `--ai`. Naming rules are unchanged: `<type>.<kebab-title>`, ≤60 chars, per [branches.md](branches.md).
- `gt create <name> --onto <parent>` creates a branch on top of `<parent>` without checking the parent out first. With a clean tree it creates an empty branch — the normal pre-work state.
- `--publish` on submit is **load-bearing**: on gt 1.8.6, `--no-interactive` creates new PRs in **draft** mode unless `--publish` is passed ("new PRs will be created in draft mode" is printed explicitly). The no-draft-PRs rule in [pull-requests.md](pull-requests.md) stands, so always pass `--publish`.
- `gt submit` submits the current branch and its downstack; `gt submit --stack` also includes descendants. `--branch <name>` targets a branch without checking it out.
- `gt submit --dry-run` previews what would be pushed/created without side effects — use it when unsure.

## Independently-green invariant

**Every PR is independently green.** No stack level is submitted until it passes validation at its own stack position. Consequence: split points are working checkpoints — each level builds, lints, and passes its tests on its own — not arbitrary diff slices. Broken builds never merge to `main`.

## PR shape

`gt submit` creates the PR; it does not know the project's PR template. Immediately after submitting, set title and body with `gh pr edit` so the Motivation/Approach/Validation template from [pull-requests.md](pull-requests.md) stays canonical:

```bash
gt submit --no-interactive --publish
gh pr edit <num> --title "<type>(<scope>): <summary>" --body "$(cat pr-body.md)"
```

Stacked PRs open their Motivation section with a one-line "Stacked on #N." pointing at the parent PR. Bottom-of-stack PRs (parented on `main`) omit it.

## Merge + restack ritual

Merges are manual, bottom-up, in GitHub:

1. **Squash-merge the bottom PR** in the GitHub UI.
2. **`gt sync -f`** — pulls trunk, detects the merged PR, deletes the merged local branch, restacks children onto `main`. `-f` skips the delete-confirmation prompt.
3. **`gt submit --stack --no-interactive --publish`** — retargets and updates the remaining PRs (`--publish` per the load-bearing rule above). GitHub CI re-validates each retargeted PR.
4. Repeat from step 1 for the next-lowest PR.

The `/restack` command wraps steps 2–3 (via the `syncAndRestack` helper) and reports what moved: run it after merging one or more PRs. It is loop-friendly for a bottom-up merge session; there is no standing automation because merges are manual.

Conflict handling: `gt sync` never leaves the repo mid-rebase — branches that cannot be restacked cleanly are **skipped** with `WARNING: <branch> could not be restacked cleanly.` Resolve those with `gt restack` from the checkout that holds the branch, fixing conflicts as prompted (`gt add` + `gt continue`, or `gt abort`). A direct `gt restack` that hits a conflict *does* stop mid-rebase; in non-interactive contexts `gt abort` requires `-f`.

## Worktree mode: gt-in-worktrees (permanent decision)

Verified empirically on gt 1.8.6 (2026-07-11) inside a superset.sh-style worktree (gitfile `.git`, auto-generated branch name, Graphite metadata in the common gitdir):

- `gt log`, `gt track`, `gt create`, `gt restack`, and `gt submit` all work from inside the worktree. Graphite state is shared through the common gitdir, so every checkout sees one branch graph.
- `gt create` **fails from an untracked branch** ("Cannot perform this operation on untracked branch"). A worktree's auto-generated branch is untracked; either adopt it (`gt track <branch> --parent main`) or bypass it.
- **Bypass it:** never make the auto-generated worktree branch a stack level. It has no commits, and `gt submit` refuses empty branches — blocking the entire upstack ("GitHub does not allow empty PRs"). Instead create the real branch directly on its parent from inside the worktree: `gt create <name> --onto main` (or `--onto <parent-level>`).
- **Cross-worktree restack constraint:** gt silently skips (exit 0) restacking any branch checked out in *another* worktree ("Did not restack branch X because it is checked out in worktree Y"). Run restack/sync from the checkout that holds the branch, and keep stack branches checked out in at most one place.

**Decision: gt-in-worktrees everywhere.** All gt operations run from whichever checkout holds the branch being operated on. The hybrid alternative (plain git in worktrees, gt track/restack/submit from the main checkout) is rejected: it guarantees the silent-skip problem — the worktrees hold the branches, so restacks from the main checkout silently do nothing — and it creates two branch-creation code paths. One mode, everywhere.

## Verified gt 1.8.6 behavior (recorded findings)

- **`gt submit --no-interactive` draft default:** new PRs are created as drafts unless `--publish` is passed (verified via `--dry-run`, 2026-07-11). With `--publish`, PRs are published. Title/body prompts are skipped in non-interactive mode; the exact default title (expected: commit subject) is confirmed at first real submit — irrelevant to the design, since `gh pr edit` sets title and body regardless.
- **`gt sync` squash-merge detection:** deletion targets are selected by **PR state** (merged/closed, via the Graphite/GitHub API), not commit ancestry, so squash merges are detected by design. This repo allows squash merge (`allow_squash_merge: true`, `delete_branch_on_merge: false`). Live confirmation happens at the first real squash-merge + `gt sync`; if gt ever fails to detect one, `gt delete -f <branch>` is the manual fallback.
- **`gt sync` output** (parsed by `syncAndRestack`): `Restacked X on Y.` (clean), `WARNING: X could not be restacked cleanly.` (conflict, skipped), `Did not restack branch X because it is checked out in worktree ...` (worktree skip).

## Preflight requirement

Autonomous work requires gt present, authenticated (`gt auth` shows "Authenticated as: ..."), and trunk configured to `main` (`gt trunk`). Missing or misconfigured gt is a hard stop — there is no silent fallback to plain git. See `bead-backlog-selection` for the failure kinds.
