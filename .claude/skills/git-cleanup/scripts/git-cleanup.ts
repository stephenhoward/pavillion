/**
 * Agent-facing CLI for local branch/worktree cleanup. JSON to stdout.
 *
 * Usage:
 *   npx tsx .claude/skills/git-cleanup/scripts/git-cleanup.ts classify
 *   npx tsx .claude/skills/git-cleanup/scripts/git-cleanup.ts execute --categories=merged-ancestor,merged-pr,empty,superseded \
 *       --worktree-families=superset,agent,chain --plan-id=<id from classify output>
 *   npx tsx .claude/skills/git-cleanup/scripts/git-cleanup.ts execute --branches=old-a,old-b --plan-id=<id>
 *
 * Operator-facing flow: .claude/skills/git-cleanup/SKILL.md
 */

import { classify, execute, parseExecuteArgs } from './lib/git-cleanup.js';

const USAGE = `usage: git-cleanup.ts <command> [args]

commands:
  classify                              fetch --prune, classify all branches/worktrees,
                                        write plan + report to the common git dir,
                                        print the plan's planId
  execute --plan-id=<id>                delete from the saved plan. At least one of
          [--categories=<a,b>]          --categories / --branches is required.
          [--branches=<x,y>]            categories: merged-ancestor, merged-pr, empty,
          [--worktree-families=<x,y>]   superseded ('doubt' is never selectable as a
                                        category — name reviewed doubts with --branches,
                                        which keeps every protection, the sha re-verify,
                                        and the undo log)
                                        families: superset, agent, chain
                                        plan-id: the planId printed by classify — execute
                                        refuses if it doesn't match the saved plan
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'classify': {
    const result = classify();
    const { plan, ...rest } = result;
    console.log(JSON.stringify({
      ...rest,
      planId: plan?.planId,
      protected: plan?.protected,
      worktrees: plan?.worktrees.filter((w) => w.removable),
      doubts: plan?.branches.filter((b) => b.category === 'doubt'),
      worktreeDoubts: plan?.worktrees.filter((w) => !w.removable && w.reason !== 'branch not classified deletable'),
    }, null, 2));
    process.exit(result.ok ? 0 : 1);
    break;
  }
  case 'execute': {
    const parsed = parseExecuteArgs(args);
    if ('error' in parsed) fail(`${parsed.error}\n\n${USAGE}`);
    const result = execute(parsed);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
    break;
  }
  default:
    fail(USAGE);
}
