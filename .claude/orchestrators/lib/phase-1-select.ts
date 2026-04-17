/**
 * Phase 1 — Select the top-priority ready bead.
 *
 * Runs bd-top-ready.sh and stores the picked bead id in ctx.beadId.
 * Halts cleanly when no ready beads exist (exit code 3) or on usage
 * error (exit code 2).
 */

import { PhaseName } from './context.js';
import { runScript, type RunScriptOptions } from './run-script.js';
import type { OrchestratorContext, PhaseRunner } from '../process-backlog.js';

// ---------------------------------------------------------------------------
// Script path
// ---------------------------------------------------------------------------

const BD_TOP_READY_SCRIPT = '.claude/skills/bead-backlog-selection/bd-top-ready.sh';

// ---------------------------------------------------------------------------
// Bead JSON shape from bd-top-ready.sh
// ---------------------------------------------------------------------------

interface BeadJson {
  id: string;
  issue_type?: string;
  priority?: number;
  created_at?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// User-visible messages
// ---------------------------------------------------------------------------

export const SELECT_MESSAGES = {
  exhausted: 'backlog exhausted for automation',
  usageError: 'bd-top-ready.sh usage error (bug, not bead problem)',
  noBead: 'No ready beads in backlog.',
} as const;

// ---------------------------------------------------------------------------
// Phase runner
// ---------------------------------------------------------------------------

export interface SelectDeps {
  runScriptOpts?: Partial<RunScriptOptions>;
}

export const run: PhaseRunner = async (ctx) => {
  return runSelect(ctx);
};

/**
 * Inner implementation with injectable deps for testing.
 */
export async function runSelect(
  ctx: OrchestratorContext,
  deps: SelectDeps = {},
): Promise<{ next: PhaseName | 'halt'; ctx: OrchestratorContext }> {

  const baseOpts: RunScriptOptions = {
    logger: ctx.logger,
    logTag: PhaseName.Select,
    ...deps.runScriptOpts,
  };

  const result = runScript<BeadJson>(
    BD_TOP_READY_SCRIPT,
    ['--limit=5'],
    baseOpts,
  );

  // Exit code 3: backlog exhausted for automation
  if (result.exitCode === 3) {
    const msg = SELECT_MESSAGES.exhausted;
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.Select, 'err', msg + '\n');
    return { next: 'halt' as PhaseName.Halt, ctx };
  }

  // Exit code 2: usage error (bug)
  if (result.exitCode === 2) {
    const msg = SELECT_MESSAGES.usageError;
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.Select, 'err', msg + '\n');
    return { next: 'halt' as PhaseName.Halt, ctx };
  }

  // Any other non-zero exit
  if (result.exitCode !== 0) {
    const msg = `bd-top-ready.sh failed with exit code ${result.exitCode}`;
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.Select, 'err', msg + '\n');
    return { next: 'halt' as PhaseName.Halt, ctx };
  }

  // Exit 0 — parse bead JSON
  const bead = result.json;
  if (!bead || !bead.id) {
    const msg = SELECT_MESSAGES.noBead;
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.Select, 'err', msg + '\n');
    return { next: 'halt' as PhaseName.Halt, ctx };
  }

  // Store bead info in context
  ctx.beadId = bead.id;

  ctx.logger.appendRunJson({
    event: 'bead_selected',
    beadId: bead.id,
    issueType: bead.issue_type,
    priority: bead.priority,
    createdAt: bead.created_at,
  });

  return { next: PhaseName.State, ctx };
}
