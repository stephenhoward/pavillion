#!/usr/bin/env tsx
/**
 * Main entry for the process-backlog orchestrator.
 *
 * Parses CLI args, initializes RunContext + logger, runs the phase
 * state-machine loop, and assembles a final summary. Supports --dry-run
 * (terminates after Phase 2).
 *
 * Phases are loaded lazily via dynamic import so that phases not yet
 * implemented do not break the build. Stub phases return a "not
 * implemented" halt until sibling leaves replace them.
 */

import { parseArgs } from 'node:util';
import { createRunLogger } from './lib/logger.js';
import { PhaseName, type PhaseResult, type RunContext } from './lib/context.js';

// ---------------------------------------------------------------------------
// Phase runner contract
// ---------------------------------------------------------------------------

/**
 * Every phase module must export a `run` function matching this signature.
 */
export type PhaseRunner = (ctx: RunContext & { dryRun: boolean }) => Promise<{
  next: PhaseName | 'halt';
  ctx: RunContext & { dryRun: boolean };
}>;

/**
 * Extended context carrying the dryRun flag for the state machine.
 */
export interface OrchestratorContext extends RunContext {
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Phase registry — dynamic imports keyed by PhaseName
// ---------------------------------------------------------------------------

/**
 * Registry mapping each phase name to a lazy loader that returns
 * `{ run: PhaseRunner }`. Phases not yet implemented use the stub.
 */
type PhaseLoader = () => Promise<{ run: PhaseRunner }>;

function stubPhase(name: string): PhaseLoader {
  return async () => ({
    run: async (ctx) => {
      const msg = `Phase "${name}" is not yet implemented — halting.`;
      ctx.logger.writePhaseLog(PhaseName.Report, 'err', msg + '\n');
      console.error(msg);
      return { next: 'halt' as const, ctx };
    },
  });
}

/**
 * The phase routing table. Stub entries are replaced by real modules
 * as sibling leaves land.
 */
export const PHASE_REGISTRY: Record<Exclude<PhaseName, PhaseName.Halt>, PhaseLoader> = {
  [PhaseName.Preflight]:       () => import('./lib/phase-0-preflight.js'),
  [PhaseName.Select]:          () => import('./lib/phase-1-select.js'),
  [PhaseName.State]:           stubPhase(PhaseName.State),
  [PhaseName.Shape]:           () => import('./lib/phase-3-shape.js'),
  [PhaseName.ShapeAdvisors]:   () => import('./lib/phase-3.5-advisors.js'),
  [PhaseName.Decompose]:       () => import('./lib/phase-4-decompose.js'),
  [PhaseName.Analyze]:         () => import('./lib/phase-5-analyze.js'),
  [PhaseName.AnalyzeAdvisors]: () => import('./lib/phase-5.5-advisors.js'),
  [PhaseName.Branch]:          () => import('./lib/phase-6-branch.js'),
  [PhaseName.Epic]:            stubPhase(PhaseName.Epic),
  [PhaseName.Leaf]:            stubPhase(PhaseName.Leaf),
  [PhaseName.PR]:              () => import('./lib/phase-8-pr.js'),
  [PhaseName.Report]:          () => import('./lib/phase-9-report.js'),
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
  ctx: OrchestratorContext,
  startPhase: PhaseName,
  registry: Record<string, PhaseLoader> = PHASE_REGISTRY,
): Promise<OrchestratorContext> {
  let currentPhase: PhaseName | 'halt' = startPhase;

  while (currentPhase !== 'halt') {
    const loader = registry[currentPhase];
    if (!loader) {
      const msg = `Unknown phase "${currentPhase}" — halting.`;
      ctx.logger.appendRunJson({ event: 'unknown_phase', phase: currentPhase, error: msg });
      console.error(msg);
      break;
    }

    const startMs = Date.now();
    let result: { next: PhaseName | 'halt'; ctx: OrchestratorContext };

    try {
      const mod = await loader();
      result = await mod.run(ctx);
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
// Summary printer
// ---------------------------------------------------------------------------

/**
 * Print a structured run summary to stdout.
 */
function printSummary(ctx: OrchestratorContext): void {
  const phasesExecuted = ctx.phaseHistory.map((p) => p.phase);
  const totalMs = ctx.phaseHistory.reduce((sum, p) => sum + p.durationMs, 0);

  console.log('\n--- Run Summary ---');
  console.log(`Run ID:           ${ctx.runId}`);
  console.log(`Bead:             ${ctx.beadId || '(none selected)'}`);
  console.log(`Dry run:          ${ctx.dryRun}`);
  console.log(`Phases executed:  ${phasesExecuted.join(' → ') || '(none)'}`);
  console.log(`Total duration:   ${totalMs}ms`);

  const failed = ctx.phaseHistory.filter((p) => !p.ok);
  if (failed.length > 0) {
    console.log('Failures:');
    for (const f of failed) {
      console.log(`  ${f.phase}: ${f.error}`);
    }
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'verbose': { type: 'boolean', default: false },
    },
    strict: true,
  });

  const dryRun = values['dry-run'] ?? false;
  const loggerInstance = createRunLogger();

  const ctx: OrchestratorContext = {
    runId: loggerInstance.runId,
    beadId: '',
    logger: loggerInstance,
    phaseHistory: [],
    dryRun,
  };

  ctx.logger.appendRunJson({
    event: 'run_start',
    runId: ctx.runId,
    dryRun,
    startedAt: new Date().toISOString(),
  });

  try {
    await runStateMachine(ctx, PhaseName.Preflight);
    printSummary(ctx);
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
// When tsx runs this file, process.argv[1] is the .ts path; import.meta.url
// is a file:// URL of the same path.
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && thisFile === process.argv[1]) {
  main();
}
