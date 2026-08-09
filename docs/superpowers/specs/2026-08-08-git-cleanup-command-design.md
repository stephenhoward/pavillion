# /git-cleanup Command Design

**Date:** 2026-08-08
**Status:** Approved

## Overview

A `/git-cleanup` slash command that removes local branches and worktrees whose
work has landed on `main` or that contain no new work. It reports everything it
intends to do, lists items it has doubts about (with reasons), and gates all
destructive action behind a single AskUserQuestion category-approval round.
Doubts are reported only — never acted on.

Architecture follows the `/restack` pattern: all deterministic work
(classification, verification, deletion) lives in a script,
`.claude/tools/git-cleanup.ts`; the command file
`.claude/commands/git-cleanup.md` is a thin wrapper that runs the script,
renders its output, and collects approvals.

## Current scale (for calibration)

At design time the repo has 427 local branches (305 tracking a deleted
upstream, 78 with no upstream) and three worktree families:

- **Superset worktrees** — `~/.superset/worktrees/<uuid>/<name>`
- **Claude agent worktrees** — `<repo>/.claude/worktrees/agent-*`
- **Chain worktrees** — `~/pavillion/pv-jdot-chains/chain-*`

All three families are in scope for removal, subject to the safety checks
below.

## Classification rules

The script's `classify` mode runs `git fetch --prune origin` first, then
assigns every local branch to exactly one category:

| Category | Rule | Action |
|---|---|---|
| `merged-ancestor` | Branch tip is an ancestor of `origin/main` | delete (`git branch -D`, after live ancestry re-verify) |
| `merged-pr` | Not an ancestor, but GitHub reports the branch's PR as MERGED | delete (`git branch -D`) |
| `empty` | No upstream and zero commits not already on `main` | delete (`git branch -D`, after live ancestry re-verify) |

`git branch -d` is deliberately **not** used for the two ancestry-proven
categories. `-d` measures merged-ness against the branch's own upstream, not
against main, so it refuses any branch whose local tip is ahead of a stale
remote-tracking ref even when every commit it carries is already in
`origin/main`. Since that is a different question from the one classify
answers, `execute` re-asserts the real predicate immediately before deleting
(`git merge-base --is-ancestor <sha> origin/main`, any non-zero exit skips)
and then uses `-D`. This is strictly stronger than `-d`: it proves
merged-to-main rather than merged-to-upstream.
| `doubt` | Anything unproven (see below) | report only |

**GitHub verification** uses batched GraphQL via `gh api graphql`
(`associatedPullRequests` on branch head refs, ~50 branches per query) to
resolve squash-merged and rebase-merged branches that git alone cannot prove.
Measured at design time: 375 of 425 branches resolve via the cheap ancestor
check; only 50 need GitHub lookup — one batched query at current scale. Keep
the chunking logic trivial (a plain array-chunk loop); it exists so the query
never exceeds GraphQL alias limits, not for throughput.

**Doubt reasons** (each reported item carries its specific reason):

- Upstream gone but branch has commits not on `main` and no merged PR
- PR exists but was closed without merging
- No upstream and branch has unique commits
- Branch is ahead of its merged PR (extra commits after merge)
- Branch checked out in a dirty worktree
- Branch checked out in an active worktree (see protections)
- GitHub lookup failed for the branch (network/auth error — never assume
  merged on failure)

## Protections (hard-coded in the script, not overridable by approval)

Never delete or remove:

- `main`, and any branch checked out in the primary checkout
  (`~/pavillion/code`)
- The current session's worktree and its branch
- Any worktree with a live process whose cwd is inside it (checked via
  `lsof`)
- Any worktree with a `.git` worktree lock (`git worktree list --porcelain`
  `locked` attribute)
- Any worktree modified within the last 30 minutes (mtime threshold — guards
  the race where an agent worktree was just created but work has not started)

The `lsof` and mtime checks overlap but are not redundant: `lsof` catches a
process working in the tree *right now*; the mtime threshold catches a
worktree that was just provisioned for an agent that has not started (no
process yet, nothing dirty). Neither covers the other's gap — both stay.
- Any worktree with uncommitted changes (dirty trees are never removed;
  `git worktree remove` is used without `--force`)

## Worktree handling

A worktree is removed only when **all** hold:

1. Its checked-out branch classified as deletable (`merged-ancestor`,
   `merged-pr`, or `empty`)
2. Working tree is clean
3. It passes every protection check above
4. Its category was approved by the user

Removal order per item: `git worktree remove <path>` → `git branch -D
<branch>`. After all removals, run `git worktree prune`.

Worktrees whose branch is deletable but which fail a safety check are listed
as doubts with the failing check named.

## Command flow

1. Run `npx tsx .claude/tools/git-cleanup.ts classify`. The script writes a
   JSON plan to `.git/git-cleanup-plan.json` and a human-readable report to
   `.git/git-cleanup-report.md` (per-branch/per-worktree reasons), and prints
   a compact summary. The Markdown report is rendered from the JSON plan by a
   single shared formatter (`report = render(plan)`) — never built as an
   independent second serialization, so the two files cannot disagree.
2. The command presents in chat: counts per category, the worktree removals
   per family, and the full doubts list with reasons. Point at the report
   file for the complete branch lists.
3. One AskUserQuestion round (multiSelect): which deletable categories to
   execute — `merged-ancestor`, `merged-pr`, `empty`, and worktree removal
   per family (Superset / agent / chain). Doubts are not offered as an
   option.
4. Run `npx tsx .claude/tools/git-cleanup.ts execute
   --categories=<approved>`. The script reads the saved plan and, for each
   item, **re-verifies immediately before acting** (branch SHA unchanged,
   worktree still clean/inactive); anything that changed since classify is
   skipped and reported.
5. Final summary: deleted branches, removed worktrees, skipped items with
   reasons, undo log location.

## Undo

Before each branch deletion the script appends `branch-name SHA` to
`.git/git-cleanup-undo-<YYYY-MM-DD>.log`. Any deleted branch is recoverable
with `git branch <name> <sha>`. Worktrees are only ever removed when clean,
so no uncommitted work can be lost.

## Script interface

```
npx tsx .claude/tools/git-cleanup.ts classify
npx tsx .claude/tools/git-cleanup.ts execute --categories=merged-ancestor,merged-pr,empty \
    --worktree-families=superset,agent,chain
```

- `classify` — no side effects beyond `git fetch --prune` and writing the
  plan/report files. Exit non-zero on `gh` auth failure with a clear message
  (command then reports git-only categories and marks PR-dependent branches
  as doubts).
- `execute` — refuses to run without a plan file; refuses if the plan is
  older than 60 minutes. Per-item re-verify already guards against changed
  items; the staleness gate exists for what re-verify cannot see — the plan
  the user approved no longer reflects the repo (new branches/worktrees, an
  approval given from stale context). Stale plan → re-classify.

**Shared predicates (named constraint):** `execute`'s re-verify step calls
the *same* predicate functions `classify` uses (deletability, protections,
clean/inactive checks) — one source of truth for "safe to delete." A parallel
re-implementation of any check in the execute path is a design violation.

The script lives alongside `stack.ts` and `bead.ts` in `.claude/tools/` and
follows their conventions (TypeScript, tsx runner, tests under
`.claude/tools/test/`).

## Testing

Unit tests, following the existing `.claude/tools/test/` pattern with git/gh
calls stubbed, cover:

- Pure classification logic: parsing `git for-each-ref` / `git worktree list
  --porcelain` output, category assignment, doubt reasons
- **Protection predicates as pure/stubbable functions**: dirty-tree, lock
  detection, mtime threshold, `lsof` liveness — fed fake command output.
  These are the safety-critical half and get the same test rigor as
  classification; only the actual `git worktree remove` / `git branch -D`
  invocations are left to manual verification.

## Out of scope

- Remote branch deletion (CI already deletes branches on merge)
- Scheduled or automatic runs
- Cross-repo support
- Acting on doubts (always report-only)
