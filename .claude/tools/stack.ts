/**
 * Agent-facing CLI for git / gh-stack operations. JSON to stdout.
 *
 * Usage:
 *   npx tsx .claude/tools/stack.ts safe-to-start [parent-branch]   # exit 0 ok, 1 not
 *   npx tsx .claude/tools/stack.ts plan '<json>'                   # {"beads":[...],"edges":[{"blocker","blocked"}]}
 *   npx tsx .claude/tools/stack.ts create <branch> <parent> --chained|--single
 *   npx tsx .claude/tools/stack.ts submit <branch> --chained|--single
 *   npx tsx .claude/tools/stack.ts sync
 *
 * Conventions live in git-workflow/stacking.md; these commands are the only
 * implementation of gh-stack operations (anti-drift rule).
 */

import {
  gitSafeToStart,
  stackPlan,
  stackCreate,
  stackSubmit,
  syncAndRestack,
  type DependencyEdge,
} from './lib/stack.js';

const USAGE = `usage: stack.ts <command> [args]

commands:
  safe-to-start [parent-branch]        clean-tree + HEAD-at-base check; exit 0 ok, 1 not
  plan '<json>'                        chain plan from {"beads":[...],"edges":[{"blocker","blocked","dependencyType"?}]}
  create <branch> <parent> --chained|--single   create a stack level or plain branch
  submit <branch> --chained|--single   submit a stack level or plain branch + PR
  sync                                 gh stack sync --prune with structured result
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function parseChained(flag: string | undefined): boolean {
  if (flag === '--chained') return true;
  if (flag === '--single') return false;
  fail(USAGE);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'safe-to-start': {
    const [parent] = args;
    const result = gitSafeToStart(parent);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
    break;
  }
  case 'plan': {
    const [input] = args;
    if (!input) fail(USAGE);
    let parsed: { beads?: string[]; edges?: DependencyEdge[] };
    try {
      parsed = JSON.parse(input);
    }
    catch {
      fail(`plan input is not valid JSON\n\n${USAGE}`);
    }
    if (!Array.isArray(parsed.beads)) fail(`plan input needs a "beads" array\n\n${USAGE}`);
    console.log(JSON.stringify(stackPlan(parsed.beads, parsed.edges ?? []), null, 2));
    break;
  }
  case 'create': {
    const [branch, parent, flag] = args;
    if (!branch || !parent) fail(USAGE);
    const result = stackCreate(branch, parent, parseChained(flag));
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
    break;
  }
  case 'submit': {
    const [branch, flag] = args;
    if (!branch) fail(USAGE);
    const result = stackSubmit(branch, parseChained(flag));
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
    break;
  }
  case 'sync': {
    const result = syncAndRestack();
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
    break;
  }
  default:
    fail(USAGE);
}
