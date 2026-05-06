#!/usr/bin/env tsx
/**
 * Main entry for the process-backlog orchestrator.
 *
 * Parses CLI args, initializes RunContext + logger, runs the phase
 * state-machine loop, and prints a final summary. Supports --dry-run
 * (terminates after Phase 2).
 *
 * All phase runners are imported statically — no dynamic imports, no stubs.
 */

import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { PhaseName, createRunLogger, type RunContext, type PhaseResult } from './lib/types.js';
import {
  preflight,
  select,
  assessState,
  shape,
  shapeAdvisors,
  decompose,
  analyze,
  analyzeAdvisors,
  branch,
} from './lib/phases.js';
import { leafPhase, epicPhase, prPhase, type PhaseRunner } from './lib/execute.js';

// ---------------------------------------------------------------------------
// Extended context for the orchestrator
// ---------------------------------------------------------------------------

/**
 * Full context carried through every phase of an orchestrator run.
 * Extends RunContext with the dryRun flag and optional output fields
 * set by later phases (prUrl, beadsClosed).
 */
export interface OrchestratorCtx extends RunContext {
  dryRun: boolean;
  prUrl?: string;
  beadsClosed?: string[];
}

// ---------------------------------------------------------------------------
// Phase registry — simple map, no dynamic imports, no stubs
// ---------------------------------------------------------------------------

/**
 * All phases are statically imported and registered here.
 * The Report phase is not in the registry; buildSummary is called inline
 * after the state machine loop completes.
 */
const PHASES: Record<string, PhaseRunner> = {
  [PhaseName.Preflight]:       preflight as PhaseRunner,
  [PhaseName.Select]:          select as PhaseRunner,
  [PhaseName.State]:           assessState as PhaseRunner,
  [PhaseName.Shape]:           shape as PhaseRunner,
  [PhaseName.ShapeAdvisors]:   shapeAdvisors as PhaseRunner,
  [PhaseName.Decompose]:       decompose as PhaseRunner,
  [PhaseName.Analyze]:         analyze as PhaseRunner,
  [PhaseName.AnalyzeAdvisors]: analyzeAdvisors as PhaseRunner,
  [PhaseName.Branch]:          branch as PhaseRunner,
  [PhaseName.Epic]:            epicPhase,
  [PhaseName.Leaf]:            leafPhase,
  [PhaseName.PR]:              prPhase,
};

// ---------------------------------------------------------------------------
// State machine loop
// ---------------------------------------------------------------------------

/**
 * Run the phase state machine starting from `startPhase`.
 *
 * Each phase returns `{ next, ctx }`. The loop continues until `next`
 * is `'halt'` or an unknown phase is encountered.
 */
export async function runStateMachine(
  ctx: OrchestratorCtx,
  startPhase: PhaseName,
  registry: Record<string, PhaseRunner> = PHASES,
): Promise<OrchestratorCtx> {
  let currentPhase: PhaseName | 'halt' = startPhase;

  while (currentPhase !== 'halt') {
    const runner = registry[currentPhase];
    if (!runner) {
      const msg = `Unknown phase "${currentPhase}" — halting.`;
      ctx.logger.appendRunJson({ event: 'unknown_phase', phase: currentPhase, error: msg });
      console.error(msg);
      break;
    }

    const beadLabel = ctx.beadId ? ` [${ctx.beadId}]` : '';
    console.log(`> ${currentPhase}${beadLabel}`);

    const startMs = Date.now();
    let result: { next: PhaseName | 'halt'; ctx: OrchestratorCtx };

    try {
      result = await runner(ctx) as { next: PhaseName | 'halt'; ctx: OrchestratorCtx };
    }
    catch (err) {
      const durationMs = Date.now() - startMs;
      const errorMsg = err instanceof Error ? err.message : String(err);

      const phaseResult: PhaseResult = {
        phase: currentPhase,
        ok: false,
        durationMs,
        error: errorMsg,
      };
      ctx.phaseHistory.push(phaseResult);

      ctx.logger.appendRunJson({
        event: 'phase_error',
        phase: currentPhase,
        error: errorMsg,
        durationMs,
      });
      console.error(`Phase "${currentPhase}" failed: ${errorMsg}`);

      // Rethrow to let the outer handler log to run.json and exit non-zero
      throw err;
    }

    const durationMs = Date.now() - startMs;
    const phaseResult: PhaseResult = {
      phase: currentPhase,
      ok: true,
      durationMs,
    };
    ctx.phaseHistory.push(phaseResult);

    ctx.logger.appendRunJson({
      event: 'phase_complete',
      phase: currentPhase,
      durationMs,
      next: result.next,
    });

    ctx = result.ctx;
    currentPhase = result.next;
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// Summary builder (absorbed from phase-9-report.ts)
// ---------------------------------------------------------------------------

/**
 * Classify how a run ended so /loop consumers and humans can tell recoverable
 * halts from blockers.
 *
 *   `completed`       — a PR was opened; next /process-backlog run should
 *                       pick a different bead.
 *   `transient_halt`  — the run halted on a condition that typically clears
 *                       between invocations (subagent timeout, wrong_branch
 *                       preflight before orphan recovery lands). The same
 *                       bead is still eligible; retry after a delay.
 *   `needs_human`     — the run halted on a condition requiring human input
 *                       (advisor REQUEST CHANGES, verification exhausted,
 *                       dirty tree, stale main, empty backlog).
 *
 * Exported for testing.
 */
export type RunVerdict = 'completed' | 'transient_halt' | 'needs_human';

const TRANSIENT_ERROR_PATTERNS = [
  /timed out/i,
  /timeout/i,
  /behind_main/i,
];

export function classifyVerdict(ctx: OrchestratorCtx): RunVerdict {
  if (ctx.prUrl) return 'completed';

  const failed = ctx.phaseHistory.filter((p) => !p.ok);
  for (const p of failed) {
    const text = p.error ?? '';
    if (TRANSIENT_ERROR_PATTERNS.some((rx) => rx.test(text))) {
      return 'transient_halt';
    }
  }

  return 'needs_human';
}

/**
 * Build the structured markdown summary from the run context.
 *
 * Exported for testing.
 */
export function buildSummary(ctx: OrchestratorCtx): string {
  const phasesExecuted = ctx.phaseHistory.map((p) => p.phase);
  const totalMs = ctx.phaseHistory.reduce((sum, p) => sum + p.durationMs, 0);
  const prUrl = ctx.prUrl ?? '(none)';
  const beadsClosed = ctx.beadsClosed ?? [ctx.beadId].filter(Boolean);
  const failed = ctx.phaseHistory.filter((p) => !p.ok);
  const verdict = classifyVerdict(ctx);

  const lines: string[] = [
    '',
    '=== Process Backlog Run Summary ===',
    `Run ID: ${ctx.runId}`,
    `Bead: ${ctx.beadId || '(none selected)'}`,
    `Phases Executed: ${phasesExecuted.join(' \u2192 ') || '(none)'}`,
    `Beads Touched: ${beadsClosed.join(', ') || '(none)'}`,
    `PR: ${prUrl}`,
    `Total Duration: ${totalMs}ms`,
    `Verdict: ${verdict}`,
    `Status: ${failed.length > 0 ? 'completed with errors' : 'completed'}`,
  ];

  if (failed.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const f of failed) {
      lines.push(`  ${f.phase}: ${f.error}`);
    }
  }

  lines.push('===================================');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Summary printer
// ---------------------------------------------------------------------------

/**
 * Print the run summary to stdout and log to run.json.
 */
function printSummary(ctx: OrchestratorCtx): void {
  const summary = buildSummary(ctx);
  console.log(summary);

  ctx.logger.appendRunJson({
    event: 'run_summary',
    runId: ctx.runId,
    beadId: ctx.beadId,
    prUrl: ctx.prUrl ?? null,
    beadsClosed: ctx.beadsClosed ?? [ctx.beadId].filter(Boolean),
    phasesExecuted: ctx.phaseHistory.map((p) => p.phase),
    totalDurationMs: ctx.phaseHistory.reduce((sum, p) => sum + p.durationMs, 0),
    verdict: classifyVerdict(ctx),
    errors: ctx.phaseHistory
      .filter((p) => !p.ok)
      .map((p) => ({ phase: p.phase, error: p.error })),
  });
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'verbose': { type: 'boolean', default: false },
      'bead-id':  { type: 'string' },
    },
    strict: true,
  });

  const dryRun = values['dry-run'] ?? false;
  const explicitBeadId = (values['bead-id'] ?? '').trim();

  if (values['bead-id'] !== undefined && !explicitBeadId) {
    console.error('--bead-id requires a non-empty value');
    process.exit(1);
  }

  const loggerInstance = createRunLogger();

  const ctx: OrchestratorCtx = {
    runId: loggerInstance.runId,
    beadId: explicitBeadId,
    logger: loggerInstance,
    phaseHistory: [],
    dryRun,
  };

  ctx.logger.appendRunJson({
    event: 'run_start',
    runId: ctx.runId,
    dryRun,
    explicitBeadId: explicitBeadId || null,
    startedAt: new Date().toISOString(),
  });

  const beadSuffix = explicitBeadId ? ` (bead ${explicitBeadId})` : '';
  console.log(`process-backlog run ${ctx.runId}${dryRun ? ' (dry-run)' : ''}${beadSuffix}`);

  try {
    const finalCtx = await runStateMachine(ctx, PhaseName.Preflight);
    printSummary(finalCtx);
  }
  catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    ctx.logger.appendRunJson({
      event: 'run_error',
      error: errorMsg,
    });
    printSummary(ctx);
    console.error(`\nRun failed: ${errorMsg}`);
    process.exit(1);
  }
}

// Only run when executed directly (not when imported by tests).
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && thisFile === process.argv[1]) {
  main();
}
