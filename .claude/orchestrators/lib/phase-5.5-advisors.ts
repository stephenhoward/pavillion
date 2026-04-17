/**
 * Phase 5.5 -- Advisory Review of the Analyzed Plan (delegated, parallel).
 *
 * Runs after Phase 5 (analyze). Structurally identical to Phase 3.5 but:
 * - Condition: epic only -- skip if target is a single leaf.
 * - File hints: union of every leaf's "Files to Modify" (from enriched notes).
 * - Phase tag: "5.5" for escalation.
 * - Clean verdict routes to Phase 6 (Branch) instead of Phase 4 (Decompose).
 * - Refinement routes back to Phase 5 (Analyze) instead of Phase 3 (Shape).
 *
 * Uses match-agents.sh via spawnSync for advisor discovery, and the
 * shared fanOutAdvisors() helper for parallel dispatch + aggregation.
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { PhaseName } from './context.js';
import type { RunScriptOptions } from './run-script.js';
import {
  fanOutAdvisors,
  type FanOutDeps,
  type MatchedAdvisor,
  type RefinementReport,
} from './fan-out-advisors.js';
import {
  matchAdvisors,
  getBeadContext,
} from './phase-3.5-advisors.js';
import type { OrchestratorContext, PhaseRunner } from '../process-backlog.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BD_ESCALATE_SCRIPT = '.claude/skills/bead-backlog-selection/bd-escalate.sh';

// ---------------------------------------------------------------------------
// Deps injection for testing
// ---------------------------------------------------------------------------

export interface AnalyzeAdvisorsDeps {
  /** Override runScript options (for match-agents.sh). */
  runScriptOpts?: Partial<RunScriptOptions>;
  /** Override fan-out dispatch deps. */
  fanOutDeps?: FanOutDeps;
  /** Override fanOutAdvisors itself (for testing). */
  fanOutFn?: typeof fanOutAdvisors;
  /** Override spawnSync for escalation. */
  escalateSpawnFn?: typeof nodeSpawnSync;
  /** Override bead context fetcher. */
  getBeadContextFn?: (beadId: string) => string;
  /** Override leaf file hints extractor (union of all leaves' Files to Modify). */
  getLeafFileHintsFn?: (beadId: string) => string[];
  /** Override epic check. */
  isEpicFn?: (beadId: string) => boolean;
}

// ---------------------------------------------------------------------------
// Default leaf file hints extractor
// ---------------------------------------------------------------------------

/**
 * Extract the union of "Files to Modify" / "Files to Create" from all
 * leaf children's enriched notes. Falls back to parsing `bd show` output.
 */
function extractLeafFileHints(
  beadId: string,
  opts?: Partial<RunScriptOptions>,
): string[] {
  const spawnFn = opts?.spawnFn ?? nodeSpawnSync;

  // Get the epic's full output which includes child leaf info
  const result = spawnFn(
    'bd', ['show', beadId],
    { shell: true, encoding: 'utf-8' as never, timeout: 15_000 },
  );

  const stdout = result.stdout?.toString() ?? '';
  const files: string[] = [];

  // Match lines that look like file paths (start with . or src/ or similar)
  const filePatterns = /^\s*-\s*[`']?([^\s`']+\.[a-z]{1,5})[`']?/gm;
  let match: RegExpExecArray | null;
  while ((match = filePatterns.exec(stdout)) !== null) {
    const path = match[1].replace(/^`|`$/g, '');
    if (path.includes('/') || path.includes('.')) {
      files.push(path);
    }
  }

  // Deduplicate
  return [...new Set(files)];
}

/**
 * Default epic check: runs `bd show` and looks for CHILDREN section.
 */
function isEpic(
  beadId: string,
  opts?: Partial<RunScriptOptions>,
): boolean {
  const spawnFn = opts?.spawnFn ?? nodeSpawnSync;

  const result = spawnFn(
    'bd', ['show', beadId],
    { shell: true, encoding: 'utf-8' as never, timeout: 15_000 },
  );

  const stdout = result.stdout?.toString() ?? '';
  return /CHILDREN|children/i.test(stdout);
}

// ---------------------------------------------------------------------------
// Escalation helper
// ---------------------------------------------------------------------------

function escalate(
  ctx: OrchestratorContext,
  reason: string,
  deps: AnalyzeAdvisorsDeps,
): void {
  const spawnFn = deps.escalateSpawnFn ?? nodeSpawnSync;

  const result = spawnFn(
    BD_ESCALATE_SCRIPT,
    [ctx.beadId, reason, '5.5'],
    { shell: true, encoding: 'utf-8' as never, timeout: 30_000 },
  );

  const stderr = result.stderr?.toString() ?? '';
  const exitCode = result.status ?? 1;

  if (stderr) {
    ctx.logger.writePhaseLog(PhaseName.AnalyzeAdvisors, 'err', stderr);
  }

  if (exitCode !== 0) {
    ctx.logger.writePhaseLog(PhaseName.AnalyzeAdvisors, 'err',
      `bd-escalate.sh exited with code ${exitCode}\n`);
  }
}

// ---------------------------------------------------------------------------
// Phase runner
// ---------------------------------------------------------------------------

export const run: PhaseRunner = async (ctx) => {
  return runAnalyzeAdvisors(ctx);
};

/**
 * Inner implementation with injectable deps for testing.
 */
export async function runAnalyzeAdvisors(
  ctx: OrchestratorContext,
  deps: AnalyzeAdvisorsDeps = {},
): Promise<{ next: PhaseName | 'halt'; ctx: OrchestratorContext }> {

  // 1. Check if bead is an epic; skip for leaves
  const checkEpic = deps.isEpicFn ?? ((id: string) =>
    isEpic(id, deps.runScriptOpts));

  if (!checkEpic(ctx.beadId)) {
    ctx.logger.appendRunJson({
      event: 'analyze_advisors_skipped',
      beadId: ctx.beadId,
      reason: 'leaf bead — advisory review only applies to epics',
    });
    ctx.logger.writePhaseLog(PhaseName.AnalyzeAdvisors, 'out',
      'Bead is a leaf; skipping post-analyze advisory review.\n');
    return { next: PhaseName.Branch, ctx };
  }

  // 2. Extract file hints (union of all leaves' Files to Modify)
  const getFileHints = deps.getLeafFileHintsFn ?? ((id: string) =>
    extractLeafFileHints(id, deps.runScriptOpts));
  const fileHints = getFileHints(ctx.beadId);

  ctx.logger.appendRunJson({
    event: 'analyze_advisors_file_hints',
    beadId: ctx.beadId,
    fileCount: fileHints.length,
    files: fileHints,
  });

  // 3. No file hints → skip advisors, proceed to Phase 6
  if (fileHints.length === 0) {
    ctx.logger.appendRunJson({
      event: 'analyze_advisors_skipped',
      beadId: ctx.beadId,
      reason: 'no file hints in bead',
    });
    ctx.logger.writePhaseLog(PhaseName.AnalyzeAdvisors, 'out',
      'No file hints found in bead leaves; skipping advisory review.\n');
    return { next: PhaseName.Branch, ctx };
  }

  // 4. Match advisors via match-agents.sh
  const baseOpts: RunScriptOptions = {
    logger: ctx.logger,
    logTag: PhaseName.AnalyzeAdvisors,
    ...deps.runScriptOpts,
  };

  const advisors = matchAdvisors(fileHints, baseOpts);

  ctx.logger.appendRunJson({
    event: 'analyze_advisors_matched',
    beadId: ctx.beadId,
    advisorCount: advisors.length,
    advisorNames: advisors.map(a => a.name),
  });

  // 5. No matched advisors → skip, proceed to Phase 6
  if (advisors.length === 0) {
    ctx.logger.appendRunJson({
      event: 'analyze_advisors_skipped',
      beadId: ctx.beadId,
      reason: 'no advisors matched file set',
    });
    ctx.logger.writePhaseLog(PhaseName.AnalyzeAdvisors, 'out',
      'No advisors matched the bead\'s implied file set; proceeding without planning review.\n');
    return { next: PhaseName.Branch, ctx };
  }

  // 6. Get bead context for advisor prompts
  const getContext = deps.getBeadContextFn ?? ((id: string) =>
    getBeadContext(id, deps.runScriptOpts));
  const beadContext = getContext(ctx.beadId);

  // 7. Fan out advisors in parallel
  const fanOut = deps.fanOutFn ?? fanOutAdvisors;
  const report: RefinementReport = await fanOut(
    advisors,
    ctx.beadId,
    beadContext,
    'phase-5-analyze',
    ctx,
    PhaseName.AnalyzeAdvisors,
    deps.fanOutDeps,
  );

  // 8. Route based on overall verdict
  if (report.overallVerdict === 'clean') {
    ctx.logger.appendRunJson({
      event: 'analyze_advisors_passed',
      beadId: ctx.beadId,
      summary: report.summary,
    });
    ctx.logger.writePhaseLog(PhaseName.AnalyzeAdvisors, 'out',
      `Advisory review passed: ${report.summary}\n`);
    return { next: PhaseName.Branch, ctx };
  }

  // Check if any advisor escalated
  const hasEscalate = report.advisors.some(v => v.verdict === 'escalate');

  if (hasEscalate) {
    // Escalate: label needs-human and halt
    const reason = `advisor REQUEST CHANGES after review: ${report.summary}`;
    ctx.logger.appendRunJson({
      event: 'analyze_advisors_escalated',
      beadId: ctx.beadId,
      reason,
    });
    escalate(ctx, reason, deps);
    return { next: 'halt', ctx };
  }

  // Refinement needed: route back to Phase 5 (Analyze) with report
  ctx.logger.appendRunJson({
    event: 'analyze_advisors_refinement_needed',
    beadId: ctx.beadId,
    summary: report.summary,
  });
  ctx.logger.writePhaseLog(PhaseName.AnalyzeAdvisors, 'out',
    `Advisory review requires refinement: ${report.summary}\n`);

  // Attach report to context for the analyze phase to consume
  (ctx as OrchestratorContext & { refinementReport?: RefinementReport }).refinementReport = report;

  return { next: PhaseName.Analyze, ctx };
}
