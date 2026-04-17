/**
 * Phase 4 -- Decompose if Needed.
 *
 * Runs bd-sizing-check.sh to decide whether the bead needs decomposition.
 * If yes (and the bead is a leaf), dispatches the decompose-bead subagent
 * via the canonical dispatch wrapper.  After decomposition completes,
 * re-runs bd-state.sh on the (possibly promoted) epic id and routes to
 * Phase 1 (Select) so the orchestrator picks a newly-created leaf.
 *
 * If decomposition is not needed (or the bead already has children),
 * skips directly to Phase 5 (Analyze).
 */

import { resolve } from 'node:path';
import { PhaseName } from './context.js';
import { runScript, type RunScriptOptions } from './run-script.js';
import {
  dispatch,
  DispatchMalformedError,
  DispatchTimeoutError,
  type DispatchOptions,
} from './dispatch.js';
import type { OrchestratorContext, PhaseRunner } from '../process-backlog.js';

// ---------------------------------------------------------------------------
// Script paths
// ---------------------------------------------------------------------------

const BD_SIZING_SCRIPT = '.claude/skills/bead-state-assessment/bd-sizing-check.sh';
const BD_STATE_SCRIPT = '.claude/skills/bead-state-assessment/bd-state.sh';
const BD_ESCALATE_SCRIPT = '.claude/skills/bead-backlog-selection/bd-escalate.sh';
const DECOMPOSE_SCHEMA = resolve('.claude/orchestrators/schemas/decompose-report.json');

// ---------------------------------------------------------------------------
// Script output types
// ---------------------------------------------------------------------------

export interface SizingVerdict {
  needs_decomposition: boolean;
  reasons: string[];
}

export interface DecomposeReport {
  parentBeadId: string;
  childBeadIds: string[];
  childCount: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BUDGET_USD = 3.00;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the inline prompt for the decompose subagent.
 */
export function buildDecomposePrompt(beadId: string, reasons: string[]): string {
  return [
    `Read \`.claude/commands/decompose-bead.md\` and run its full process for \`${beadId}\` autonomously.`,
    '',
    `Reasons from sizing check: ${JSON.stringify(reasons)}`,
    '',
    'No AskUserQuestion -- flag genuinely ambiguous work areas in the report rather than stopping.',
    '',
    'Report: new epic id (if promoted), child-bead count, ASCII hierarchy.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Deps injection for testing
// ---------------------------------------------------------------------------

export interface DecomposeDeps {
  runScriptOpts?: Partial<RunScriptOptions>;
  dispatchFn?: <T>(opts: DispatchOptions) => Promise<T>;
  schemaPath?: string;
  budgetUsd?: number;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Phase runner
// ---------------------------------------------------------------------------

export const run: PhaseRunner = async (ctx) => {
  return runDecompose(ctx);
};

/**
 * Inner implementation with injectable deps for testing.
 */
export async function runDecompose(
  ctx: OrchestratorContext,
  deps: DecomposeDeps = {},
): Promise<{ next: PhaseName | 'halt'; ctx: OrchestratorContext }> {
  const baseOpts: RunScriptOptions = {
    logger: ctx.logger,
    logTag: PhaseName.Decompose,
    ...deps.runScriptOpts,
  };

  // Step 1: Run sizing check
  const sizingResult = runScript<SizingVerdict>(
    BD_SIZING_SCRIPT,
    [ctx.beadId],
    baseOpts,
  );

  // Exit code 2: usage error
  if (sizingResult.exitCode === 2) {
    const msg = 'bd-sizing-check.sh usage error (exit code 2)';
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.Decompose, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  // Any other non-zero exit
  if (sizingResult.exitCode !== 0) {
    const msg = `bd-sizing-check.sh failed with exit code ${sizingResult.exitCode}`;
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.Decompose, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const sizing = sizingResult.json;

  ctx.logger.appendRunJson({
    event: 'sizing_checked',
    beadId: ctx.beadId,
    needsDecomposition: sizing.needs_decomposition,
    reasons: sizing.reasons,
  });

  // Step 2: Check if decomposition is needed
  // Skip to Phase 5 if not needed OR bead already has children
  if (!sizing.needs_decomposition) {
    ctx.logger.appendRunJson({
      event: 'decompose_skipped',
      beadId: ctx.beadId,
      reason: 'sizing check says no decomposition needed',
    });
    return { next: PhaseName.Analyze, ctx };
  }

  // Check if bead already has children (already an epic) by re-running state
  const stateResult = runScript<{ state: string; missing_phases: string[] }>(
    BD_STATE_SCRIPT,
    [ctx.beadId],
    baseOpts,
  );

  if (stateResult.exitCode === 0 && stateResult.json) {
    const isEpic = !stateResult.json.missing_phases.includes('decomposed');
    if (isEpic) {
      ctx.logger.appendRunJson({
        event: 'decompose_skipped',
        beadId: ctx.beadId,
        reason: 'bead already has children',
      });
      return { next: PhaseName.Analyze, ctx };
    }
  }

  // Step 3: Dispatch decompose subagent
  const dispatchFn = deps.dispatchFn ?? dispatch;
  const schemaPath = deps.schemaPath ?? DECOMPOSE_SCHEMA;
  const budgetUsd = deps.budgetUsd
    ?? (process.env.ORCH_BUDGET_DECOMPOSE
      ? parseFloat(process.env.ORCH_BUDGET_DECOMPOSE)
      : DEFAULT_BUDGET_USD);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const prompt = buildDecomposePrompt(ctx.beadId, sizing.reasons);

  let report: DecomposeReport;
  try {
    report = await dispatchFn<DecomposeReport>({
      agent: 'decompose-bead',
      schemaPath,
      prompt,
      budgetUsd,
      timeoutMs,
      ctx,
      logTag: PhaseName.Decompose,
    });
  }
  catch (err) {
    if (err instanceof DispatchMalformedError || err instanceof DispatchTimeoutError) {
      const reason = err instanceof DispatchTimeoutError
        ? `decompose subagent timed out: ${err.message}`
        : `decompose subagent returned malformed output: ${err.message}`;

      ctx.logger.writePhaseLog(PhaseName.Decompose, 'err', reason + '\n');

      // Escalate the bead
      runScript(BD_ESCALATE_SCRIPT, [ctx.beadId, reason, '4'], baseOpts);

      ctx.logger.appendRunJson({
        event: 'decompose_escalated',
        beadId: ctx.beadId,
        reason,
      });

      return { next: 'halt', ctx };
    }
    throw err;
  }

  // Step 4: Log success and route to Phase 1 (Select)
  // After decomposition, ctx.beadId is stale -- the parent is now an epic
  // and a new leaf should be picked by phase-1-select.
  ctx.logger.appendRunJson({
    event: 'decompose_complete',
    beadId: ctx.beadId,
    parentBeadId: report.parentBeadId,
    childCount: report.childCount,
    childBeadIds: report.childBeadIds,
    summary: report.summary,
  });

  return { next: PhaseName.Select, ctx };
}
