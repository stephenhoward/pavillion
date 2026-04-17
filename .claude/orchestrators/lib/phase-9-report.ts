/**
 * Phase 9 — Final Report.
 *
 * Pure orchestrator logic — no subagents, no scripts. Reads
 * ctx.phaseHistory and any extra context fields set by earlier phases
 * to assemble and print a structured run summary. Always returns halt.
 */

import type { OrchestratorContext, PhaseRunner } from '../process-backlog.js';

// ---------------------------------------------------------------------------
// Extended context fields set by earlier phases
// ---------------------------------------------------------------------------

interface ReportContext extends OrchestratorContext {
  prUrl?: string;
  beadsClosed?: string[];
}

// ---------------------------------------------------------------------------
// Summary assembly
// ---------------------------------------------------------------------------

/**
 * Build the structured markdown summary from the run context.
 *
 * Exported for testing.
 */
export function buildSummary(ctx: ReportContext): string {
  const phasesExecuted = ctx.phaseHistory.map((p) => p.phase);
  const totalMs = ctx.phaseHistory.reduce((sum, p) => sum + p.durationMs, 0);
  const prUrl = ctx.prUrl ?? '(none)';
  const beadsClosed = ctx.beadsClosed ?? [ctx.beadId].filter(Boolean);
  const failed = ctx.phaseHistory.filter((p) => !p.ok);

  const lines: string[] = [
    '',
    '=== Process Backlog Run Summary ===',
    `Run ID: ${ctx.runId}`,
    `Bead: ${ctx.beadId || '(none selected)'}`,
    `Phases Executed: ${phasesExecuted.join(' \u2192 ') || '(none)'}`,
    `Beads Touched: ${beadsClosed.join(', ') || '(none)'}`,
    `PR: ${prUrl}`,
    `Total Duration: ${totalMs}ms`,
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
// Phase runner
// ---------------------------------------------------------------------------

export const run: PhaseRunner = async (ctx) => {
  return runReport(ctx as ReportContext);
};

/**
 * Inner implementation for testing.
 */
export async function runReport(
  ctx: ReportContext,
): Promise<{ next: 'halt'; ctx: OrchestratorContext }> {

  const summary = buildSummary(ctx);

  // Print to stdout
  console.log(summary);

  // Log to run.json
  ctx.logger.appendRunJson({
    event: 'run_summary',
    runId: ctx.runId,
    beadId: ctx.beadId,
    prUrl: ctx.prUrl ?? null,
    beadsClosed: ctx.beadsClosed ?? [ctx.beadId].filter(Boolean),
    phasesExecuted: ctx.phaseHistory.map((p) => p.phase),
    totalDurationMs: ctx.phaseHistory.reduce((sum, p) => sum + p.durationMs, 0),
    errors: ctx.phaseHistory
      .filter((p) => !p.ok)
      .map((p) => ({ phase: p.phase, error: p.error })),
  });

  return { next: 'halt', ctx };
}
