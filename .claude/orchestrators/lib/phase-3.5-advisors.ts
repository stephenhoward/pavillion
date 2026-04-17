/**
 * Phase 3.5 -- Advisory Review of the Shaped Bead (delegated, parallel).
 *
 * Runs after Phase 3 (shape). Discovers matched advisors from the bead's
 * file hints, dispatches them in parallel via fanOutAdvisors(), collects
 * verdicts, and routes:
 *
 * - All clean → proceed to Phase 4 (Decompose).
 * - Any refinement-needed/escalate → return to Phase 3 (Shape) with
 *   the refinement report attached to ctx.
 *
 * Uses match-agents.sh via runScript() for advisor discovery, and the
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
import type { OrchestratorContext, PhaseRunner } from '../process-backlog.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MATCH_AGENTS_SCRIPT = '.claude/skills/agent-discovery/match-agents.sh';
const BD_ESCALATE_SCRIPT = '.claude/skills/bead-backlog-selection/bd-escalate.sh';

// ---------------------------------------------------------------------------
// Deps injection for testing
// ---------------------------------------------------------------------------

export interface ShapeAdvisorsDeps {
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
  /** Override file hints extractor. */
  getFileHintsFn?: (beadId: string) => string[];
}

// ---------------------------------------------------------------------------
// File hints extraction
// ---------------------------------------------------------------------------

/**
 * Extract file hints from the bead's design field (Key Files section)
 * or notes (Files to Modify section).
 *
 * In practice this would parse `bd show <id>` output, but the
 * orchestrator context should already have this data. For now,
 * this runs `bd show` and extracts file paths.
 */
export function extractFileHints(
  beadId: string,
  opts?: Partial<RunScriptOptions>,
): string[] {
  const baseOpts: RunScriptOptions = {
    logger: { writePhaseLog: () => {}, appendRunJson: () => {}, runDir: () => '/tmp' },
    logTag: PhaseName.ShapeAdvisors,
    ...opts,
  };

  // bd show outputs structured text; we parse "Files to Create" / "Key Files" / "Files to Modify"
  // Using a lightweight spawnSync since bd show doesn't output strict JSON
  const spawnFn = baseOpts.spawnFn ?? nodeSpawnSync;
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

  return files;
}

/**
 * Get bead context string for advisor prompts.
 * Runs `bd show <id>` and returns the full output.
 */
export function getBeadContext(
  beadId: string,
  opts?: Partial<RunScriptOptions>,
): string {
  const spawnFn = opts?.spawnFn ?? nodeSpawnSync;
  const result = spawnFn(
    'bd', ['show', beadId],
    { shell: true, encoding: 'utf-8' as never, timeout: 15_000 },
  );

  return result.stdout?.toString() ?? '';
}

// ---------------------------------------------------------------------------
// Match advisors via match-agents.sh
// ---------------------------------------------------------------------------

/**
 * Pipe file hints into match-agents.sh advisor and parse the result.
 */
export function matchAdvisors(
  fileHints: string[],
  opts: RunScriptOptions,
): MatchedAdvisor[] {
  if (fileHints.length === 0) {
    return [];
  }

  // match-agents.sh reads from stdin, but runScript doesn't support stdin.
  // Use spawnSync directly with stdin piped.
  const spawnFn = opts.spawnFn ?? nodeSpawnSync;
  const input = fileHints.join('\n') + '\n';

  const result = spawnFn(
    MATCH_AGENTS_SCRIPT,
    ['advisor'],
    {
      shell: true,
      encoding: 'utf-8' as never,
      timeout: 15_000,
      input,
    },
  );

  const stdout = result.stdout?.toString() ?? '';
  const stderr = result.stderr?.toString() ?? '';
  const exitCode = result.status ?? 1;

  if (stdout) {
    opts.logger.writePhaseLog(opts.logTag, 'out', stdout);
  }
  if (stderr) {
    opts.logger.writePhaseLog(opts.logTag, 'err', stderr);
  }

  if (exitCode !== 0) {
    opts.logger.writePhaseLog(opts.logTag, 'err',
      `match-agents.sh exited with code ${exitCode}\n`);
    return [];
  }

  try {
    return JSON.parse(stdout) as MatchedAdvisor[];
  }
  catch {
    opts.logger.writePhaseLog(opts.logTag, 'err',
      `Failed to parse match-agents.sh output as JSON\n`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Escalation helper
// ---------------------------------------------------------------------------

function escalate(
  ctx: OrchestratorContext,
  reason: string,
  deps: ShapeAdvisorsDeps,
): void {
  const spawnFn = deps.escalateSpawnFn ?? nodeSpawnSync;

  const result = spawnFn(
    BD_ESCALATE_SCRIPT,
    [ctx.beadId, reason, '3.5'],
    { shell: true, encoding: 'utf-8' as never, timeout: 30_000 },
  );

  const stderr = result.stderr?.toString() ?? '';
  const exitCode = result.status ?? 1;

  if (stderr) {
    ctx.logger.writePhaseLog(PhaseName.ShapeAdvisors, 'err', stderr);
  }

  if (exitCode !== 0) {
    ctx.logger.writePhaseLog(PhaseName.ShapeAdvisors, 'err',
      `bd-escalate.sh exited with code ${exitCode}\n`);
  }
}

// ---------------------------------------------------------------------------
// Phase runner
// ---------------------------------------------------------------------------

export const run: PhaseRunner = async (ctx) => {
  return runShapeAdvisors(ctx);
};

/**
 * Inner implementation with injectable deps for testing.
 */
export async function runShapeAdvisors(
  ctx: OrchestratorContext,
  deps: ShapeAdvisorsDeps = {},
): Promise<{ next: PhaseName | 'halt'; ctx: OrchestratorContext }> {

  // 1. Extract file hints from bead
  const getFileHints = deps.getFileHintsFn ?? ((id: string) =>
    extractFileHints(id, deps.runScriptOpts));
  const fileHints = getFileHints(ctx.beadId);

  ctx.logger.appendRunJson({
    event: 'shape_advisors_file_hints',
    beadId: ctx.beadId,
    fileCount: fileHints.length,
    files: fileHints,
  });

  // 2. No file hints → skip advisors, proceed to Phase 4
  if (fileHints.length === 0) {
    ctx.logger.appendRunJson({
      event: 'shape_advisors_skipped',
      beadId: ctx.beadId,
      reason: 'no file hints in bead',
    });
    ctx.logger.writePhaseLog(PhaseName.ShapeAdvisors, 'out',
      'No file hints found in bead; skipping advisory review.\n');
    return { next: PhaseName.Decompose, ctx };
  }

  // 3. Match advisors via match-agents.sh
  const baseOpts: RunScriptOptions = {
    logger: ctx.logger,
    logTag: PhaseName.ShapeAdvisors,
    ...deps.runScriptOpts,
  };

  const advisors = matchAdvisors(fileHints, baseOpts);

  ctx.logger.appendRunJson({
    event: 'shape_advisors_matched',
    beadId: ctx.beadId,
    advisorCount: advisors.length,
    advisorNames: advisors.map(a => a.name),
  });

  // 4. No matched advisors → skip, proceed to Phase 4
  if (advisors.length === 0) {
    ctx.logger.appendRunJson({
      event: 'shape_advisors_skipped',
      beadId: ctx.beadId,
      reason: 'no advisors matched file set',
    });
    ctx.logger.writePhaseLog(PhaseName.ShapeAdvisors, 'out',
      'No advisors matched the bead\'s implied file set; proceeding without planning review.\n');
    return { next: PhaseName.Decompose, ctx };
  }

  // 5. Get bead context for advisor prompts
  const getContext = deps.getBeadContextFn ?? ((id: string) =>
    getBeadContext(id, deps.runScriptOpts));
  const beadContext = getContext(ctx.beadId);

  // 6. Fan out advisors in parallel
  const fanOut = deps.fanOutFn ?? fanOutAdvisors;
  const report: RefinementReport = await fanOut(
    advisors,
    ctx.beadId,
    beadContext,
    'phase-3-shape',
    ctx,
    PhaseName.ShapeAdvisors,
    deps.fanOutDeps,
  );

  // 7. Route based on overall verdict
  if (report.overallVerdict === 'clean') {
    ctx.logger.appendRunJson({
      event: 'shape_advisors_passed',
      beadId: ctx.beadId,
      summary: report.summary,
    });
    ctx.logger.writePhaseLog(PhaseName.ShapeAdvisors, 'out',
      `Advisory review passed: ${report.summary}\n`);
    return { next: PhaseName.Decompose, ctx };
  }

  // Check if any advisor escalated (as opposed to refinement-needed)
  const hasEscalate = report.advisors.some(v => v.verdict === 'escalate');

  if (hasEscalate) {
    // Escalate: label needs-human and halt
    const reason = `advisor REQUEST CHANGES after review: ${report.summary}`;
    ctx.logger.appendRunJson({
      event: 'shape_advisors_escalated',
      beadId: ctx.beadId,
      reason,
    });
    escalate(ctx, reason, deps);
    return { next: 'halt', ctx };
  }

  // Refinement needed: route back to Phase 3 (Shape) with report
  ctx.logger.appendRunJson({
    event: 'shape_advisors_refinement_needed',
    beadId: ctx.beadId,
    summary: report.summary,
  });
  ctx.logger.writePhaseLog(PhaseName.ShapeAdvisors, 'out',
    `Advisory review requires refinement: ${report.summary}\n`);

  // Attach report to context for the shape phase to consume
  (ctx as OrchestratorContext & { refinementReport?: RefinementReport }).refinementReport = report;

  return { next: PhaseName.Shape, ctx };
}
