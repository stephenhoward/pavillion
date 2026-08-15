---
name: git-cleanup
description: Delete local branches and worktrees whose work has already merged to main, and triage the ones nothing could prove either way. Use when the local checkout has accumulated stale branches or worktrees and they need clearing safely. User-invoked only.
disable-model-invocation: true
---

# Git Cleanup

Clean up local branches and worktrees whose work has merged to main or that
carry no new work. Classification and deletion are performed by the
deterministic tool in `scripts/git-cleanup.ts`; this skill wraps it with a
report, a category-approval gate, and a review pass over the branches the
tool could not prove either way.

Everything the flow needs lives in this directory:

| Path | What it is |
|---|---|
| `scripts/git-cleanup.ts` | the CLI invoked in the steps below (`classify`, `execute`) |
| `scripts/lib/git-cleanup.ts` | classification, protections, and execution logic |
| `scripts/lib/run.ts` | command plumbing, `shell: false` on every spawn |
| `scripts/test/` | unit tests over stubbed spawn, plus integration tests against real git |

Tests run with `npx vitest run --config .claude/tools/vitest.config.ts`.

What each category proves, and how the tool acts on it:

| Category | Proof | Action |
|---|---|---|
| `merged-ancestor` | Tip is an ancestor of `origin/main` | delete, after a live ancestry re-verify |
| `merged-pr` | GitHub reports the branch's PR merged at the tip (catches squash/rebase merges) | delete |
| `empty` | No upstream, no commits beyond main | delete, after a live ancestry re-verify |
| `superseded` | No open PR, and no file the branch touched still differs from `origin/main` | delete, after a live content re-verify |
| `doubt` | Nothing proved it either way | never deletable by category — see step 5 |

Protections are hard-coded and no approval overrides them: `main`, the
primary checkout's branch, and the current session's worktree and branch are
never touched; a worktree is removed only when it is clean, unlocked, has no
live process inside it, and has not been modified in the last 30 minutes.
Before every branch deletion the tool appends `<branch> <sha>` to
`.git/git-cleanup-undo-<date>.log`, so any deletion is reversible with
`git branch <name> <sha>`.

Two rules that no step below overrides:

- **Never work around a protection the tool enforces.** If it refuses, that
  is the answer — do not reach for `git branch -D`, `git worktree remove`,
  or a shell loop.
- **Every deletion goes through `execute`.** That is what re-verifies state
  and writes the undo log. A branch deleted outside the tool is
  unrecoverable.

## Steps

1. **Classify.** Run:

   ```bash
   npx tsx .claude/skills/git-cleanup/scripts/git-cleanup.ts classify
   ```

   If `ok` is false, report the error and stop. Otherwise capture `planId`
   from the JSON output — it identifies this specific plan and must be
   threaded through to every `execute` call below. The plan expires 60
   minutes after classify; if the session runs long, re-classify and
   re-approve rather than retrying with a stale id.

2. **Report.** From the JSON summary and the report file (path in
   `reportPath`), present in chat:
   - Counts per deletable category: `merged-ancestor`, `merged-pr`, `empty`,
     `superseded` (its work is already in main — every file it touched is
     byte-identical to `origin/main`).
   - Worktree removals grouped by family (superset / agent / chain), with
     branch names.
   - The doubts, in the two buckets the plan assigns them:
     - **Review** (`doubtClass: 'review'`) — nothing proved either way.
       These are the subject of step 5. Show them all, with last commit date
       and ahead count.
     - **Keep** (`doubtClass: 'keep'`) — open PR, unreadable GitHub state,
       or a worktree still in use. Summarize as a count with one line per
       item; these are never deletion candidates.
   - Non-removable worktrees from `worktreeDoubts`.
   - Point at `reportPath` for the full tables.

3. **Approve categories.** One AskUserQuestion call with two questions (both
   multiSelect):
   - Q1 — branch categories to delete: one option per deletable category
     present in the plan, e.g. "Delete `superseded` branches (N)". At most 4
     options, so this always fits in one question.
   - Q2 — worktree families to remove: one option per family that has at
     least one removable worktree in the plan (superset / agent / chain).
     Omit this question entirely when no family has any removable worktree.

   Do not offer doubts here — a doubt is never deletable by category. If the
   user selects nothing across both questions, skip to step 5.

4. **Execute the approved categories.**

   ```bash
   npx tsx .claude/skills/git-cleanup/scripts/git-cleanup.ts execute \
     --categories=<approved categories> \
     --worktree-families=<approved families> \
     --plan-id=<planId from step 1>
   ```

   If `ok` is false, report the error and stop — do not retry blindly.
   - `plan id mismatch`: another session re-ran classify and replaced the
     plan. Re-run classify (step 1) and re-collect approval.
   - `plan is older than 60 minutes`: re-run classify and re-approve.
   - Any other error: report it verbatim; do not attempt a workaround.

5. **Review the doubts.** This step is judgment, not arithmetic — the tool
   has already done everything that can be decided deterministically, and
   what is left needs someone to look. Skip it only if the review bucket is
   empty or the user declines.

   For each branch in the **review** bucket, gather enough to have an
   opinion — cheaply, in batch where possible:

   ```bash
   git log --oneline origin/main..<branch>        # what work is on it
   git diff --stat origin/main...<branch>          # how much, and where
   ```

   Useful signals: age of the tip; whether the subject lines describe work
   that visibly landed under another name (squash-merged with a different
   message, reimplemented, superseded by a later approach); whether the
   files it touches still exist on main; whether it looks like an
   abandoned experiment, a scratch/agent branch, or real unfinished work.
   Related beads (`bd show`) and closed PR history are fair game when a
   branch name points at one.

   Then present your read as a short table — branch, age, what's on it, your
   recommendation (delete / keep / unsure) and the reason in a few words.
   Group obvious cohorts (e.g. a run of agent scratch branches) so the user
   is not asked twenty separate questions. Say plainly which ones you are
   unsure about rather than padding the recommendation.

   Discuss. The user may accept the batch, take some and leave others, or
   ask about specific branches — answer from the evidence above. Then
   confirm the final list with AskUserQuestion before acting. When in doubt,
   leave the branch: a branch kept costs nothing, and the next run will
   surface it again.

6. **Execute the reviewed branches** with only the names the user confirmed:

   ```bash
   npx tsx .claude/skills/git-cleanup/scripts/git-cleanup.ts execute \
     --branches=<confirmed branch names> \
     --plan-id=<planId from step 1>
   ```

   Naming a branch does not bypass anything: it must still be in the plan
   (so protected branches are unreachable), its sha must still match what
   classify saw, and a branch checked out in a worktree still requires that
   worktree to pass the full removal assessment — plus its family must be
   approved via `--worktree-families`. Skips here are normal; report them.

7. **Summarize.** Report: branches deleted (by category and by name),
   worktrees removed, skipped items with reasons (the tool re-verifies every
   item immediately before acting — skips are normal when state changed
   since classify), and the undo log path. Deleted branches are recoverable
   with `git branch <name> <sha>` using that log.
