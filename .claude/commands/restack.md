# Restack

Post-merge local catch-up. Run after one or more stacked PRs have been merged
in GitHub: sync local state against the reworked stack and report what moved
or conflicted. Nothing more — GitHub performs the restack server-side at
merge time (`VERIFY:` per `git-workflow/stacking.md`; local build-guardian
re-validation of the retargeted level is the conservative default until that
cascade behavior is confirmed), so this command does not re-submit the stack
or drive a merge session.

Conventions and command semantics live in the `git-workflow` skill's
`stacking.md` — that file is the source of truth; this command is a thin
wrapper over the stack sync tool in `.claude/tools/stack.ts`. It does not
restate `gh stack` syntax.

## Steps

1. **Sync.** Run the sync tool:

   ```bash
   npx tsx .claude/tools/stack.ts sync
   ```

2. **Report what moved and what conflicted**, from the structured result:
   - Branches synced cleanly.
   - Branches that conflicted and need manual resolution — for each, resolve
     from the checkout that owns the branch, per the merge/sync ritual in
     `git-workflow/stacking.md`. Re-run local build-guardian validation on any
     branch that had conflicts resolved.
   - Any branches pruned as part of the sync (merged PRs cleaned up locally).

3. **Summarize.** Report: branches synced, branches needing manual conflict
   resolution, branches pruned. If the cascade-retarget claim in
   `stacking.md` is still unconfirmed, note that build-guardian re-validation
   of the retargeted level(s) is recommended before further work on the
   stack.

There is no re-submit step and no merge-session loop here — see
`stacking.md` for the merge ritual itself (web-UI-only, bottom-up default,
whole-stack atomic option).
