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
- **Chain worktrees** — `~/pavillion/pv-<epic>-chains/chain-*`, one directory
  per epic (`pv-jdot-chains`, `pv-federation-chains`, …). The family is
  matched by that pattern, not by a fixed directory name: a hard-coded name
  silently strands every other epic's worktrees in `other`, where nothing can
  act on them.

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
| `superseded` | No open PR, and no file the branch touched still differs from `origin/main` | delete (`git branch -D`, after live content re-verify) |
| `doubt` | Anything unproven (see below) | never deletable by category; see "Reviewing doubts" |

`git branch -d` is deliberately **not** used for the two ancestry-proven
categories. `-d` measures merged-ness against the branch's own upstream, not
against main, so it refuses any branch whose local tip is ahead of a stale
remote-tracking ref even when every commit it carries is already in
`origin/main`. Since that is a different question from the one classify
answers, `execute` re-asserts the real predicate immediately before deleting
(`git merge-base --is-ancestor <sha> origin/main`, any non-zero exit skips)
and then uses `-D`. This is strictly stronger than `-d`: it proves
merged-to-main rather than merged-to-upstream.

**`superseded`** is decided by two name-only diffs:
`origin/main...<branch>` gives the files the branch changed since its merge
base; `origin/main..<branch>` gives the files whose content differs between
the two tips. When no touched file appears in the second set, every file the
branch changed is byte-identical to main's copy — the work is in main
(squash-merged under a different message, cherry-picked, or independently
reimplemented) and only the commit history would be lost. It fails closed:
any git error, or a branch that touched nothing, is not superseded.
`execute` recomputes the same predicate against the re-verified sha, because
`origin/main` can move between classify and execute.

Decision order is load-bearing: an **open PR outranks content equivalence**
(deleting the branch would close a PR someone is using), and so does a failed
GitHub lookup (an open PR could be invisible). Both stay doubts however the
files compare.

**GitHub verification** uses batched GraphQL via `gh api graphql`
(`associatedPullRequests` on branch head refs, ~50 branches per query) to
resolve squash-merged and rebase-merged branches that git alone cannot prove.
Measured at design time: 375 of 425 branches resolve via the cheap ancestor
check; only 50 need GitHub lookup — one batched query at current scale. Keep
the chunking logic trivial (a plain array-chunk loop); it exists so the query
never exceeds GraphQL alias limits, not for throughput.

**Doubt reasons** (each reported item carries its specific reason) and the
triage bucket each falls into:

| Reason | Bucket |
|---|---|
| Upstream gone but branch has commits not on `main` and no merged PR | review |
| PR exists but was closed without merging | review |
| No upstream and branch has unique commits | review |
| Branch is ahead of its merged PR (extra commits after merge) | review |
| Open PR on the branch | keep |
| GitHub lookup failed (network/auth — never assume merged on failure) | keep |
| Branch checked out in a dirty, active, or otherwise unremovable worktree | keep |

`review` means nothing proved the branch either way and a person has to look.
`keep` means the branch names live work or unreadable state — re-reading
those rows every run is noise, so the report separates them and sorts review
oldest-first. Every branch also carries its tip date and ahead count, which
is what triage actually asks for first.

The bucket is a presentation aid with no authority: `doubt` is never
deletable by category, whichever bucket it lands in.

## Reviewing doubts

The review bucket is where the work is on a real repo — on the first live run
it held 54 of 55 classified branches. Leaving it entirely to the operator
means the session ends in a hand-rolled `git branch -D` loop, which is
exactly the unsafe path the tool exists to replace: no re-verify, no
protections, no undo log.

So the command reviews it with judgment (branch age, what `git log
origin/main..<branch>` and `git diff --stat` show, whether the work visibly
landed under another name, related beads or closed PRs), recommends per
branch or per cohort, discusses with the user, and then acts through:

```
execute --branches=<names> --plan-id=<id>
```

The invariant is narrowed, not dropped: a doubt is never deletable **by
category** — only by explicit name, after review. Naming a branch bypasses
nothing else. It must still be present in the plan (protected branches never
are, so `--branches=main` is refused), its sha must still match what classify
saw, and a branch checked out in a worktree still requires that worktree to
pass the full removal assessment and its family to be approved. Every named
deletion is written to the undo log like any other.

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
   `merged-pr`, `empty`, or `superseded`) — or was named explicitly in
   `--branches`, which is the operator making the same call
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
   per family, and the doubts in their two buckets with reasons, tip dates,
   and ahead counts. Point at the report file for the complete branch lists.
3. One AskUserQuestion round (multiSelect): which deletable categories to
   execute — `merged-ancestor`, `merged-pr`, `empty`, `superseded` — and
   worktree removal per family (Superset / agent / chain). Doubts are not
   offered as an option.
4. Run `npx tsx .claude/tools/git-cleanup.ts execute
   --categories=<approved>`. The script reads the saved plan and, for each
   item, **re-verifies immediately before acting** (branch SHA unchanged,
   ancestry or content proof still holding, worktree still clean/inactive);
   anything that changed since classify is skipped and reported.
5. Review the `review`-bucket doubts with the user (see "Reviewing doubts"),
   then run `execute --branches=<confirmed>` with the same plan id.
6. Final summary: deleted branches, removed worktrees, skipped items with
   reasons, undo log location.

## Undo

Before each branch deletion the script appends `branch-name SHA` to
`.git/git-cleanup-undo-<YYYY-MM-DD>.log`. Any deleted branch is recoverable
with `git branch <name> <sha>`. Worktrees are only ever removed when clean,
so no uncommitted work can be lost.

## Script interface

```
npx tsx .claude/tools/git-cleanup.ts classify
npx tsx .claude/tools/git-cleanup.ts execute --plan-id=<id> \
    --categories=merged-ancestor,merged-pr,empty,superseded \
    --worktree-families=superset,agent,chain
npx tsx .claude/tools/git-cleanup.ts execute --plan-id=<id> --branches=old-a,old-b
```

`execute` requires at least one of `--categories` / `--branches`. `doubt` is
rejected as a category value; reviewed doubts go through `--branches`.

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

Two suites, both under `.claude/tools/test/`.

**Unit** (`git-cleanup.test.ts`), git/gh calls stubbed:

- Pure classification logic: parsing `git for-each-ref` / `git worktree list
  --porcelain` output, category assignment, decision order, doubt reasons and
  buckets, content-equivalence verdicts
- **Protection predicates as pure/stubbable functions**: dirty-tree, lock
  detection, mtime threshold, `lsof` liveness — fed fake command output.
  These are the safety-critical half and get the same test rigor as
  classification.

**Integration** (`git-cleanup.integration.test.ts`), real git binary and real
temp repositories, only `gh` (and the origin URL) faked:

- classify and execute end-to-end over a repo containing a merged branch with
  a stale remote-tracking ref, a squash-merged branch, and live unmerged work
- the `--branches` round trip, including restoring from the undo log
- the skip paths: branch moved since classify, content no longer matching

This suite exists because a stubbed spawn can only assert which commands were
issued, never how git answers them. That gap shipped a real bug: `git branch
-d` refused every `merged-ancestor` branch whose tip was ahead of a stale
upstream ref, so the first live run deleted nothing while every unit test
passed. Any change to a destructive invocation or to a proof predicate needs
a case here, not only in the unit suite.

## Out of scope

- Remote branch deletion (CI already deletes branches on merge)
- Scheduled or automatic runs
- Cross-repo support
- Bulk action on doubts (never selectable as a category — only by explicit
  name after review)
