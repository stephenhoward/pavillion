/**
 * Agent-facing CLI for local branch/worktree cleanup. JSON to stdout.
 *
 * Usage:
 *   npx tsx .claude/tools/git-cleanup.ts classify
 *   npx tsx .claude/tools/git-cleanup.ts execute --categories=merged-ancestor,merged-pr,empty \
 *       --worktree-families=superset,agent,chain
 *
 * Design spec: docs/superpowers/specs/2026-08-08-git-cleanup-command-design.md
 */

import { classify, execute, parseExecuteArgs } from './lib/git-cleanup.js';

const USAGE = `usage: git-cleanup.ts <command> [args]

commands:
  classify                              fetch --prune, classify all branches/worktrees,
                                        write plan + report to the common git dir
  execute --categories=<a,b>            delete approved categories from the saved plan
          [--worktree-families=<x,y>]   (categories: merged-ancestor, merged-pr, empty;
                                        families: superset, agent, chain)
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
      protected: plan?.protected,
      worktrees: plan?.worktrees.filter((w) => w.removable),
      doubts: plan?.branches.filter((b) => b.category === 'doubt'),
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
