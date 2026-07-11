# Restack

Post-merge stack maintenance. Runs after one or more stacked PRs have been
squash-merged in GitHub: syncs trunk, deletes merged branches, restacks the
remaining stack, reports what moved, and re-submits the updated stack.

Conventions and command semantics live in the `git-workflow` skill's
`stacking.md` — that file is the source of truth; this command is a thin
wrapper. Loop-friendly: during a bottom-up merge session, run it after each
merge (may be driven via `/loop`). There is no standing automation because
merges are manual.

## Steps

1. **Sync and restack.** Run the `syncAndRestack` helper from
   `.claude/orchestrators/lib/helpers.ts` (wraps `gt sync -f --no-interactive`):

   ```bash
   npx tsx -e "import { syncAndRestack } from './.claude/orchestrators/lib/helpers.js'; console.log(JSON.stringify(syncAndRestack(), null, 2));"
   ```

2. **Report what moved.** From the structured result:
   - `restacked` — branches restacked cleanly onto their new parent.
   - `conflicted` — branches gt skipped because restacking would conflict.
     For each, resolve from the checkout that holds the branch:
     `gt restack --branch <name>`, fix conflicts, `gt add` + `gt continue`
     (or `gt abort -f` to back out). Re-run build validation on any branch
     that had conflicts resolved before re-submitting it.
   - `skippedWorktree` — branches checked out in another worktree; re-run
     the sync (or `gt restack`) from that worktree.
   - Also note any merged branches gt deleted (visible in `rawOutput`).

3. **Re-submit the stack.** Retarget and update the remaining PRs:

   ```bash
   gt submit --stack --no-interactive --publish
   ```

   GitHub CI re-validates each retargeted PR. Local build-guardian re-runs
   are only needed for branches that had conflicts (step 2).

4. **Summarize.** Report: branches deleted (merged), branches restacked,
   branches needing manual conflict resolution, PRs updated/retargeted.
