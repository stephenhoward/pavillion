/**
 * Agent-facing CLI for /upgrade-dependencies. JSON to stdout. Run from the repo root.
 *
 * Usage:
 *   npx tsx .agents/tools/upgrade-dependencies.ts dashboard
 *   npx tsx .agents/tools/upgrade-dependencies.ts prs
 *   npx tsx .agents/tools/upgrade-dependencies.ts tick <approve-branch key>
 *   npx tsx .agents/tools/upgrade-dependencies.ts renovate [timeout-minutes]
 *   npx tsx .agents/tools/upgrade-dependencies.ts worktree <renovate/* branch>
 *   npx tsx .agents/tools/upgrade-dependencies.ts annotate <pr> <ruling-file> <file>...
 *
 * `dashboard` and `prs` are read-only. `tick` edits the dashboard issue body,
 * `renovate` dispatches the Renovate workflow, `worktree` checks out and
 * installs in .agents/worktrees/upgrade-dependencies, `annotate` edits a PR body.
 */

import { annotate, dashboard, prepareWorktree, prs, tick, triggerRenovate } from './lib/upgrade-dependencies.js';

const USAGE = `usage: upgrade-dependencies.ts <command>

  dashboard                         admission queue, candidates, ticked keys awaiting Renovate, already-applied keys
  prs                               open major renovate/* PRs (not security), classified from commits and CI
  tick <key>                        tick exactly one approve-branch checkbox on the dashboard
  renovate [minutes]                dispatch renovate.yaml and wait for that run (default 15 minutes)
  worktree <branch>                 check a renovate/* branch out in .agents/worktrees/upgrade-dependencies and npm ci
  annotate <pr> <ruling-file> <f>…  append "## Migration made on your behalf" to the PR body
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case 'dashboard':
      console.log(JSON.stringify(dashboard(), null, 2));
      break;
    case 'prs':
      console.log(JSON.stringify(prs(), null, 2));
      break;
    case 'tick': {
      const [key] = args;
      if (!key) fail(USAGE);
      tick(key);
      console.log(JSON.stringify({ ok: true, ticked: key }));
      break;
    }
    case 'renovate': {
      const minutes = Number(args[0] ?? 15);
      if (!Number.isFinite(minutes) || minutes <= 0) fail(USAGE);
      console.log(JSON.stringify(triggerRenovate(minutes * 60_000)));
      break;
    }
    case 'worktree': {
      const [branch] = args;
      if (!branch) fail(USAGE);
      console.log(JSON.stringify(prepareWorktree(branch)));
      break;
    }
    case 'annotate': {
      const [pr, rulingFile, ...files] = args;
      if (!pr || !rulingFile || files.length === 0 || !/^\d+$/.test(pr)) fail(USAGE);
      annotate(Number(pr), rulingFile, files);
      console.log(JSON.stringify({ ok: true, pr: Number(pr), files }));
      break;
    }
    default:
      fail(USAGE);
  }
}
catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
