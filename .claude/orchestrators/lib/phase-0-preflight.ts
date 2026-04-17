/**
 * Phase 0 — Preflight.
 *
 * Runs two deterministic scripts:
 *   1. preflight.sh (bead-backlog-selection) — verifies clean tree, main branch,
 *      sync with origin, and non-empty backlog.
 *   2. git-safe-to-start.sh (bead-branch-and-pr) — narrow safety re-check for
 *      clean tree + main branch.
 *
 * On any failure, halts with a verbatim user-visible message. No auto-fix.
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { PhaseName } from './context.js';
import { runScript, type RunScriptOptions } from './run-script.js';
import type { OrchestratorContext, PhaseRunner } from '../process-backlog.js';

// ---------------------------------------------------------------------------
// Verbatim hard-stop messages (copied from .claude/commands/process-backlog.md)
// ---------------------------------------------------------------------------

export const PREFLIGHT_MESSAGES: Record<string, string> = {
  dirty_tree:
    'Working tree is dirty \u2014 commit or stash before re-running /process-backlog.',
  wrong_branch:
    'Not on main \u2014 return to main (or finish your current branch\u2019s PR) before re-running /process-backlog.',
  stale_main:
    'Local main is out of sync with origin/main \u2014 `git pull` (or fix remote access) before re-running /process-backlog.',
  empty_backlog:
    'No ready beads available (or every ready bead is labelled `needs-human`) \u2014 shape or unlabel a bead before re-running /process-backlog.',
};

export const GIT_SAFE_MESSAGES: Record<number, string> = {
  1: 'Not on main \u2014 return to main (or finish your current branch\u2019s PR) before re-running /process-backlog.',
  2: 'Not on main \u2014 return to main (or finish your current branch\u2019s PR) before re-running /process-backlog.',
};

// ---------------------------------------------------------------------------
// Script paths
// ---------------------------------------------------------------------------

const PREFLIGHT_SCRIPT = '.claude/skills/bead-backlog-selection/preflight.sh';
const GIT_SAFE_SCRIPT = '.claude/skills/bead-branch-and-pr/git-safe-to-start.sh';

// ---------------------------------------------------------------------------
// Preflight JSON shape from preflight.sh
// ---------------------------------------------------------------------------

interface PreflightFailure {
  kind: string;
  reason: string;
}

interface PreflightOutput {
  ok: boolean;
  failures: PreflightFailure[];
}

// ---------------------------------------------------------------------------
// Phase runner
// ---------------------------------------------------------------------------

/**
 * Run options factory — allows tests to inject spawnFn/existsFn via ctx.
 */
export interface PreflightDeps {
  runScriptOpts?: Partial<RunScriptOptions>;
  gitSafeSpawnFn?: typeof nodeSpawnSync;
}

export const run: PhaseRunner = async (ctx) => {
  return runPreflight(ctx);
};

/**
 * Inner implementation with injectable deps for testing.
 */
export async function runPreflight(
  ctx: OrchestratorContext,
  deps: PreflightDeps = {},
): Promise<{ next: PhaseName | 'halt'; ctx: OrchestratorContext }> {

  const baseOpts: RunScriptOptions = {
    logger: ctx.logger,
    logTag: PhaseName.Preflight,
    ...deps.runScriptOpts,
  };

  // Step 1: Run preflight.sh
  const preflightResult = runScript<PreflightOutput>(
    PREFLIGHT_SCRIPT,
    [],
    baseOpts,
  );

  // On non-zero exit, parse stdout for failure JSON if available; otherwise
  // use the exit code to derive a message.
  if (preflightResult.exitCode !== 0) {
    // preflight.sh exits 1 with JSON on stdout containing failures
    let failures: PreflightFailure[] = [];
    try {
      const parsed = JSON.parse(preflightResult.stdout) as PreflightOutput;
      failures = parsed.failures ?? [];
    }
    catch {
      // Couldn't parse; use generic message
    }

    if (failures.length > 0) {
      for (const f of failures) {
        const msg = PREFLIGHT_MESSAGES[f.kind] ?? f.reason;
        console.error(msg);
        ctx.logger.writePhaseLog(PhaseName.Preflight, 'err', msg + '\n');
      }
    }
    else {
      const msg = `Preflight failed with exit code ${preflightResult.exitCode}`;
      console.error(msg);
      ctx.logger.writePhaseLog(PhaseName.Preflight, 'err', msg + '\n');
    }

    return { next: 'halt' as PhaseName.Halt, ctx };
  }

  // Exit 0 but check JSON payload for ok: false (belt-and-braces)
  if (preflightResult.json && !preflightResult.json.ok) {
    for (const f of preflightResult.json.failures) {
      const msg = PREFLIGHT_MESSAGES[f.kind] ?? f.reason;
      console.error(msg);
      ctx.logger.writePhaseLog(PhaseName.Preflight, 'err', msg + '\n');
    }
    return { next: 'halt' as PhaseName.Halt, ctx };
  }

  // Step 2: Run git-safe-to-start.sh (exit-code-only, no JSON output)
  const gitSafeSpawn = deps.gitSafeSpawnFn ?? nodeSpawnSync;
  const gitSafeResult = gitSafeSpawn(GIT_SAFE_SCRIPT, [], {
    encoding: 'buffer' as never,
    shell: true,
    timeout: 30_000,
  });
  const gitSafeExit = gitSafeResult.status ?? 1;
  const gitSafeStderr = gitSafeResult.stderr?.toString('utf-8') ?? '';

  if (gitSafeStderr) {
    ctx.logger.writePhaseLog(PhaseName.Preflight, 'err', gitSafeStderr);
  }

  if (gitSafeExit !== 0) {
    const msg = GIT_SAFE_MESSAGES[gitSafeExit]
      ?? `git-safe-to-start failed: ${gitSafeStderr.trim()}`;
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.Preflight, 'err', msg + '\n');
    return { next: 'halt' as PhaseName.Halt, ctx };
  }

  // Both passed — proceed to Phase 1
  return { next: PhaseName.Select, ctx };
}
