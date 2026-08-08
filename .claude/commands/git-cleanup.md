# Git Cleanup

Clean up local branches and worktrees whose work has merged to main or that
carry no new work. Classification and deletion are performed by the
deterministic tool in `.claude/tools/git-cleanup.ts`; this command wraps it
with a report and a category-approval gate. Design spec:
`docs/superpowers/specs/2026-08-08-git-cleanup-command-design.md`.

Doubts are report-only: never delete anything the tool classifies as a
doubt, and never work around a protection the tool enforces.

## Steps

1. **Classify.** Run:

   ```bash
   npx tsx .claude/tools/git-cleanup.ts classify
   ```

   If `ok` is false, report the error and stop. Otherwise capture `planId`
   from the JSON output — it identifies this specific plan and must be
   threaded through to `execute` in step 4.

2. **Report.** From the JSON summary and the report file (path in
   `reportPath`), present in chat:
   - Counts per category (merged-ancestor, merged-pr, empty).
   - Worktree removals grouped by family (superset / agent / chain), with
     branch names.
   - The complete doubts list with each item's reason — do not truncate.
     Branch doubts come from `doubts`; non-removable-worktree doubts come
     from `worktreeDoubts` (the tool already excludes worktrees whose only
     issue is following a non-deletable branch — those are covered by their
     branch's own entry). Show both lists in full; the same data is also in
     the report file.
   - Point at `reportPath` for the full branch tables.

3. **Approve.** One AskUserQuestion call with two questions (both
   multiSelect):
   - Q1 — branch categories to delete: one option per deletable category
     present in the plan, e.g. "Delete `merged-ancestor` branches (N)",
     "Delete `merged-pr` branches (N)", "Delete `empty` branches (N)". At
     most 3 options, so this always fits in one question.
   - Q2 — worktree families to remove: one option per family that has at
     least one removable worktree in the plan (superset / agent / chain).
     Omit this question entirely when no family has any removable
     worktrees.

   Do not offer doubts. If the user selects nothing across both questions,
   stop cleanly.

4. **Execute.** Run with only the approved values and the `planId` from
   step 1:

   ```bash
   npx tsx .claude/tools/git-cleanup.ts execute \
     --categories=<approved categories> \
     --worktree-families=<approved families> \
     --plan-id=<planId from step 1>
   ```

   If `ok` is false, report the error and stop — do not retry blindly.
   - `plan id mismatch`: another session re-ran classify and replaced the
     plan. Re-run classify (step 1) and re-collect approval (step 3).
   - `plan is older than 60 minutes`: re-run classify and re-approve before
     trying again.
   - Any other error: report it verbatim; do not attempt a workaround.

5. **Summarize.** Report: branches deleted, worktrees removed, skipped
   items with reasons (the tool re-verifies every item immediately before
   acting — skips are normal when state changed since classify), and the
   undo log path. Deleted branches are recoverable with
   `git branch <name> <sha>` using that log.
