/**
 * Phase 2 -- State Assessment.
 *
 * Calls bd-state.sh to classify the bead's lifecycle state, then routes
 * to the next phase based on the deterministic routing table defined in
 * process-backlog.md Phase 2.
 *
 * The routing function is pure (no side effects) so unit tests can cover
 * every branch without spawning scripts.
 */

import { PhaseName } from './context.js';
import { runScript, type RunScriptOptions } from './run-script.js';
import type { OrchestratorContext, PhaseRunner } from '../process-backlog.js';

// ---------------------------------------------------------------------------
// Script path
// ---------------------------------------------------------------------------

const BD_STATE_SCRIPT = '.claude/skills/bead-state-assessment/bd-state.sh';

// ---------------------------------------------------------------------------
// Script output types
// ---------------------------------------------------------------------------

export interface StateVerdict {
  state: 'unshaped' | 'shaped' | 'decomposed' | 'analyzed' | 'executing' | 'complete';
  missing_phases: string[];
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Pure routing function
// ---------------------------------------------------------------------------

/**
 * Map a bd-state.sh verdict to the next orchestrator phase.
 *
 * Routing table (from process-backlog.md Phase 2):
 *   unshaped   -> Phase 3  (Shape)
 *   shaped     -> Phase 3.5 (ShapeAdvisors)
 *   decomposed -> Phase 5  (Analyze)
 *   analyzed   -> Phase 5.5 (AnalyzeAdvisors) if epic, Phase 6 (Branch) if leaf
 *   executing  -> halt (unexpected; safeguard 6)
 *   complete   -> halt (unexpected; safeguard 6)
 *
 * An "epic" is detected when `missing_phases` does NOT include "decomposed",
 * meaning the bead has children.
 */
export function routeByState(verdict: StateVerdict): PhaseName | 'halt' {
  switch (verdict.state) {
    case 'unshaped':
      return PhaseName.Shape;

    case 'shaped':
      return PhaseName.ShapeAdvisors;

    case 'decomposed':
      return PhaseName.Analyze;

    case 'analyzed': {
      const isEpic = !verdict.missing_phases.includes('decomposed');
      return isEpic ? PhaseName.AnalyzeAdvisors : PhaseName.Branch;
    }

    case 'executing':
    case 'complete':
      return 'halt';

    default:
      return 'halt';
  }
}

// ---------------------------------------------------------------------------
// User-visible messages
// ---------------------------------------------------------------------------

export const STATE_MESSAGES = {
  unexpectedState: (state: string) =>
    `Bead state "${state}" is unexpected — this bead should not have appeared in bd ready. Halting (Safeguard 6).`,
  usageError: 'bd-state.sh usage error (exit code 2)',
  scriptFailed: (code: number) => `bd-state.sh failed with exit code ${code}`,
} as const;

// ---------------------------------------------------------------------------
// Deps injection for testing
// ---------------------------------------------------------------------------

export interface StateDeps {
  runScriptOpts?: Partial<RunScriptOptions>;
}

// ---------------------------------------------------------------------------
// Phase runner
// ---------------------------------------------------------------------------

export const run: PhaseRunner = async (ctx) => {
  return runState(ctx);
};

/**
 * Inner implementation with injectable deps for testing.
 */
export async function runState(
  ctx: OrchestratorContext,
  deps: StateDeps = {},
): Promise<{ next: PhaseName | 'halt'; ctx: OrchestratorContext }> {

  const baseOpts: RunScriptOptions = {
    logger: ctx.logger,
    logTag: PhaseName.State,
    ...deps.runScriptOpts,
  };

  const result = runScript<StateVerdict>(
    BD_STATE_SCRIPT,
    [ctx.beadId],
    baseOpts,
  );

  // Exit code 2: usage error
  if (result.exitCode === 2) {
    const msg = STATE_MESSAGES.usageError;
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.State, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  // Any other non-zero exit
  if (result.exitCode !== 0) {
    const msg = STATE_MESSAGES.scriptFailed(result.exitCode);
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.State, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const verdict = result.json;

  // Log the verdict
  ctx.logger.appendRunJson({
    event: 'state_assessed',
    beadId: ctx.beadId,
    state: verdict.state,
    missingPhases: verdict.missing_phases,
    reasons: verdict.reasons,
  });

  // Route based on state
  const next = routeByState(verdict);

  // Handle unexpected states (executing, complete) with a clear message
  if (verdict.state === 'executing' || verdict.state === 'complete') {
    const msg = STATE_MESSAGES.unexpectedState(verdict.state);
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.State, 'err', msg + '\n');
  }

  // --dry-run short circuit: emit verdict and halt
  if (ctx.dryRun) {
    ctx.logger.appendRunJson({
      event: 'dry_run_halt',
      next,
      dryRun: true,
      state: verdict.state,
      missingPhases: verdict.missing_phases,
    });
    return { next: 'halt', ctx };
  }

  return { next, ctx };
}
