/**
 * Phase 5 -- Analyze if Needed.
 *
 * Checks whether the bead is an epic with unenriched leaf children.
 * If any leaves lack Implementation Context, dispatches the analyze-bead
 * subagent to enrich them. After dispatch, re-runs enrichment checks on
 * every leaf as a belt-and-braces safeguard.
 *
 * If the bead is a leaf (no children), skips directly to Phase 6 (Branch).
 * If all leaves are already enriched, skips to Phase 5.5 (AnalyzeAdvisors).
 */

import { resolve } from 'node:path';
import { spawnSync as nodeSpawnSync, type SpawnSyncReturns } from 'node:child_process';
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

const BD_ENRICHMENT_SCRIPT = '.claude/skills/bead-state-assessment/bd-enrichment-check.sh';
const BD_ESCALATE_SCRIPT = '.claude/skills/bead-backlog-selection/bd-escalate.sh';
const ANALYZE_SCHEMA = resolve('.claude/orchestrators/schemas/analyze-report.json');

// ---------------------------------------------------------------------------
// Report type
// ---------------------------------------------------------------------------

export interface AnalyzeReport {
  beadId: string;
  mode: 'hierarchy' | 'single';
  leavesEnriched: string[];
  summary: string;
  waves?: string[][];
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
 * Build the inline prompt for the analyze-bead subagent.
 */
export function buildAnalyzePrompt(epicId: string, unenrichedIds: string[]): string {
  return [
    `Read \`.claude/commands/analyze-bead.md\` and run its full process for \`${epicId}\` autonomously.`,
    '',
    `Unenriched leaves: ${JSON.stringify(unenrichedIds)}`,
    '',
    'Skip Phase 1.5 (decomposition is already complete); start from Phase 2 (Map Hierarchy) through Phase 5 (Store Analysis).',
    '',
    'No AskUserQuestion -- flag issues rather than pausing.',
    '',
    'Report execution waves and confirm every leaf\'s notes contains an `Implementation Context` block.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Deps injection for testing
// ---------------------------------------------------------------------------

export type SpawnSyncFn = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
) => SpawnSyncReturns<Buffer>;

export interface AnalyzeDeps {
  runScriptOpts?: Partial<RunScriptOptions>;
  dispatchFn?: <T>(opts: DispatchOptions) => Promise<T>;
  /** Override spawnSync for enrichment checks (exit-code-only scripts). */
  enrichmentSpawnFn?: SpawnSyncFn;
  childIds?: string[];
  schemaPath?: string;
  budgetUsd?: number;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Phase runner
// ---------------------------------------------------------------------------

export const run: PhaseRunner = async (ctx) => {
  return runAnalyze(ctx);
};

/**
 * Check enrichment status of a single leaf via bd-enrichment-check.sh.
 *
 * This script uses exit codes only (0 = enriched, 1 = unenriched),
 * so we call spawnSync directly rather than runScript (which expects JSON).
 */
function checkEnrichment(
  leafId: string,
  spawnFn: SpawnSyncFn,
  logger: OrchestratorContext['logger'],
): boolean {
  const result = spawnFn(BD_ENRICHMENT_SCRIPT, [leafId], {
    encoding: 'buffer',
    shell: true,
    timeout: 30_000,
  });

  const exitCode = result.status ?? 1;

  if (result.stderr?.length) {
    logger.writePhaseLog(PhaseName.Analyze, 'err', result.stderr.toString('utf-8'));
  }

  return exitCode === 0;
}

/**
 * Inner implementation with injectable deps for testing.
 */
export async function runAnalyze(
  ctx: OrchestratorContext,
  deps: AnalyzeDeps = {},
): Promise<{ next: PhaseName | 'halt'; ctx: OrchestratorContext }> {
  const baseOpts: RunScriptOptions = {
    logger: ctx.logger,
    logTag: PhaseName.Analyze,
    ...deps.runScriptOpts,
  };

  const spawnFn: SpawnSyncFn = deps.enrichmentSpawnFn
    ?? ((cmd, args, opts) => nodeSpawnSync(cmd, args, opts as Parameters<typeof nodeSpawnSync>[2]));
  const childIds = deps.childIds ?? [];

  // Step 1: If bead is a leaf (no children), skip to Branch
  if (childIds.length === 0) {
    ctx.logger.appendRunJson({
      event: 'analyze_skipped',
      beadId: ctx.beadId,
      reason: 'bead is a leaf, skip to Branch',
    });
    return { next: PhaseName.Branch, ctx };
  }

  // Step 2: Check enrichment status of each leaf child
  const unenrichedIds: string[] = [];

  for (const leafId of childIds) {
    if (!checkEnrichment(leafId, spawnFn, ctx.logger)) {
      unenrichedIds.push(leafId);
    }
  }

  // Step 3: If all leaves are already enriched, skip to AnalyzeAdvisors
  if (unenrichedIds.length === 0) {
    ctx.logger.appendRunJson({
      event: 'analyze_skipped',
      beadId: ctx.beadId,
      reason: 'all leaves already enriched',
    });
    return { next: PhaseName.AnalyzeAdvisors, ctx };
  }

  // Step 4: Dispatch analyze-bead subagent
  const dispatchFn = deps.dispatchFn ?? dispatch;
  const schemaPath = deps.schemaPath ?? ANALYZE_SCHEMA;
  const budgetUsd = deps.budgetUsd
    ?? (process.env.ORCH_BUDGET_ANALYZE
      ? parseFloat(process.env.ORCH_BUDGET_ANALYZE)
      : DEFAULT_BUDGET_USD);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const prompt = buildAnalyzePrompt(ctx.beadId, unenrichedIds);

  let report: AnalyzeReport;
  try {
    report = await dispatchFn<AnalyzeReport>({
      agent: 'analyze-bead',
      schemaPath,
      prompt,
      budgetUsd,
      timeoutMs,
      ctx,
      logTag: PhaseName.Analyze,
    });
  }
  catch (err) {
    if (err instanceof DispatchMalformedError || err instanceof DispatchTimeoutError) {
      const reason = err instanceof DispatchTimeoutError
        ? `analyze subagent timed out: ${err.message}`
        : `analyze subagent returned malformed output: ${err.message}`;

      ctx.logger.writePhaseLog(PhaseName.Analyze, 'err', reason + '\n');

      // Escalate the bead
      runScript(BD_ESCALATE_SCRIPT, [ctx.beadId, reason, '5'], baseOpts);

      ctx.logger.appendRunJson({
        event: 'analyze_escalated',
        beadId: ctx.beadId,
        reason,
      });

      return { next: 'halt', ctx };
    }
    throw err;
  }

  // Step 5: Belt-and-braces -- re-check every leaf
  const stillUnenriched: string[] = [];

  for (const leafId of childIds) {
    if (!checkEnrichment(leafId, spawnFn, ctx.logger)) {
      stillUnenriched.push(leafId);
    }
  }

  if (stillUnenriched.length > 0) {
    const msg = `Belt-and-braces check failed: leaves still unenriched after analyze: ${stillUnenriched.join(', ')}`;
    ctx.logger.writePhaseLog(PhaseName.Analyze, 'err', msg + '\n');
    ctx.logger.appendRunJson({
      event: 'analyze_belt_and_braces_failed',
      beadId: ctx.beadId,
      stillUnenriched,
    });
    return { next: 'halt', ctx };
  }

  // Step 6: Log success and route to AnalyzeAdvisors
  ctx.logger.appendRunJson({
    event: 'analyze_complete',
    beadId: ctx.beadId,
    mode: report.mode,
    leavesEnriched: report.leavesEnriched,
    summary: report.summary,
    waves: report.waves,
  });

  return { next: PhaseName.AnalyzeAdvisors, ctx };
}
