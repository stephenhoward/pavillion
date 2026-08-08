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

   If `ok` is false, report the error and stop.

2. **Report.** From the JSON summary and the report file (path in
   `reportPath`), present in chat:
   - Counts per category (merged-ancestor, merged-pr, empty).
   - Worktree removals grouped by family (superset / agent / chain), with
     branch names.
   - The complete doubts list with each item's reason — do not truncate.
     Omit worktree doubts whose reason is exactly 'branch not classified
     deletable' from this chat list — they're covered by their branch's own
     entry, and the full set remains in the report file.
   - Point at `reportPath` for the full branch tables.

3. **Approve.** One AskUserQuestion round (multiSelect), offering exactly:
   - Delete `merged-ancestor` branches (N)
   - Delete `merged-pr` branches (N)
   - Delete `empty` branches (N)
   - Remove worktrees per family present in the plan (one option per family
     with a removable worktree)

   Do not offer doubts. If the user selects nothing, stop cleanly.

4. **Execute.** Run with only the approved values:

   ```bash
   npx tsx .claude/tools/git-cleanup.ts execute \
     --categories=<approved categories> \
     --worktree-families=<approved families>
   ```

5. **Summarize.** Report: branches deleted, worktrees removed, skipped
   items with reasons (the tool re-verifies every item immediately before
   acting — skips are normal when state changed since classify), and the
   undo log path. Deleted branches are recoverable with
   `git branch <name> <sha>` using that log.
