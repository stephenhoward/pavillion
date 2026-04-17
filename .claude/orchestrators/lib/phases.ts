/**
 * Consolidated pre-execution pipeline (phases 0-6).
 *
 * Replaces 9 separate phase files with parameterized helpers for
 * repeated patterns: escalation, advisor passes, agent dispatch.
 *
 * Every exported phase function matches the PhaseRunner signature:
 *   (ctx, deps?) => Promise<{ next: PhaseName | 'halt'; ctx }>
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PhaseName, type RunContext, type RunLogger } from './types.js';
import {
  dispatch,
  runScript,
  spawnCmd,
  fanOutAdvisors,
  DispatchMalformedError,
  DispatchTimeoutError,
  type DispatchOptions,
  type RunScriptOptions,
  type MatchedAdvisor,
  type RefinementReport,
  type FanOutDeps,
} from './dispatch.js';

// =============================================================================
// Types
// =============================================================================

/** Shared context for all phases. */
export interface PhaseCtx extends RunContext {
  dryRun: boolean;
  refinementReport?: RefinementReport;
}

/** Return type of every phase runner. */
export interface PhaseReturn {
  next: PhaseName | 'halt';
  ctx: PhaseCtx;
}

/** Unified dependency injection interface for all phases. */
export interface PhaseDeps {
  /** Override spawnSync (preflight, escalation, branch, enrichment). */
  spawnFn?: typeof nodeSpawnSync;
  /** Override file-existence check (runScript). */
  existsFn?: (path: string) => boolean;
  /** Override claude dispatch. */
  dispatchFn?: <T>(opts: DispatchOptions) => Promise<T>;
  /** Override fanOutAdvisors. */
  fanOutFn?: typeof fanOutAdvisors;
  /** Override bead context fetcher for advisors. */
  getBeadContextFn?: (beadId: string) => string;
  /** Override file hints extraction. */
  getFileHintsFn?: (beadId: string) => string[];
  /** Override epic detection. */
  isEpicFn?: (beadId: string) => boolean;
  /** Override child bead IDs (for analyze phase). */
  childIds?: string[];
  /** Override fan-out deps. */
  fanOutDeps?: FanOutDeps;
}

// =============================================================================
// Script paths
// =============================================================================

const PREFLIGHT_SCRIPT = '.claude/skills/bead-backlog-selection/preflight.sh';
const GIT_SAFE_SCRIPT = '.claude/skills/bead-branch-and-pr/git-safe-to-start.sh';
const BD_TOP_READY_SCRIPT = '.claude/skills/bead-backlog-selection/bd-top-ready.sh';
const BD_STATE_SCRIPT = '.claude/skills/bead-state-assessment/bd-state.sh';
const BD_SIZING_SCRIPT = '.claude/skills/bead-state-assessment/bd-sizing-check.sh';
const BD_ENRICHMENT_SCRIPT = '.claude/skills/bead-state-assessment/bd-enrichment-check.sh';
const BD_ESCALATE_SCRIPT = '.claude/skills/bead-backlog-selection/bd-escalate.sh';
const MATCH_AGENTS_SCRIPT = '.claude/skills/agent-discovery/match-agents.sh';
const BRANCH_NAME_SCRIPT = '.claude/skills/bead-branch-and-pr/branch-name.sh';

const SHAPE_SCHEMA = resolve('.claude/orchestrators/schemas/shape-verdict.json');
const DECOMPOSE_SCHEMA = resolve('.claude/orchestrators/schemas/decompose-report.json');
const ANALYZE_SCHEMA = resolve('.claude/orchestrators/schemas/analyze-report.json');

// =============================================================================
// Verdict / report types
// =============================================================================

interface PreflightFailure {
  kind: string;
  reason: string;
}

interface PreflightOutput {
  ok: boolean;
  failures: PreflightFailure[];
}

interface BeadJson {
  id: string;
  issue_type?: string;
  priority?: number;
  created_at?: string;
  [key: string]: unknown;
}

export interface StateVerdict {
  state: 'unshaped' | 'shaped' | 'decomposed' | 'analyzed' | 'executing' | 'complete';
  missing_phases: string[];
  reasons: string[];
}

export interface ShapeVerdict {
  beadId: string;
  status: 'shaped' | 'escalate';
  summary: string;
}

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

export interface AnalyzeReport {
  beadId: string;
  mode: 'hierarchy' | 'single';
  leavesEnriched: string[];
  summary: string;
  waves?: string[][];
}

// =============================================================================
// User-visible messages
// =============================================================================

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

// =============================================================================
// Shared helpers
// =============================================================================

/** Build RunScriptOptions from ctx + deps. */
function scriptOpts(ctx: PhaseCtx, logTag: PhaseName, deps: PhaseDeps): RunScriptOptions {
  return {
    logger: ctx.logger,
    logTag,
    ...(deps.spawnFn ? { spawnFn: deps.spawnFn } : {}),
    ...(deps.existsFn ? { existsFn: deps.existsFn } : {}),
  };
}

/**
 * Escalate a bead by running bd-escalate.sh. One copy replaces 4 identical
 * copies across phases 3, 3.5, 5.5, and 4.
 */
function escalate(
  beadId: string,
  reason: string,
  phaseTag: string,
  logPhase: PhaseName,
  deps: PhaseDeps,
  ctx: PhaseCtx,
): void {
  const spawn = deps.spawnFn ?? nodeSpawnSync;

  const result = spawn(
    BD_ESCALATE_SCRIPT,
    [beadId, reason, phaseTag],
    { shell: true, encoding: 'utf-8' as never, timeout: 30_000 },
  );

  const stderr = result.stderr?.toString() ?? '';
  const exitCode = result.status ?? 1;

  if (stderr) {
    ctx.logger.writePhaseLog(logPhase, 'err', stderr);
  }
  if (exitCode !== 0) {
    ctx.logger.writePhaseLog(logPhase, 'err',
      `bd-escalate.sh exited with code ${exitCode}\n`);
  }
}

/**
 * Extract file hints from a bead's `bd show` output.
 * One copy replaces extractFileHints (3.5) and extractLeafFileHints (5.5).
 */
function extractFileHints(beadId: string, deps: PhaseDeps): string[] {
  const spawn = deps.spawnFn ?? nodeSpawnSync;

  const result = spawn(
    'bd', ['show', beadId],
    { shell: true, encoding: 'utf-8' as never, timeout: 15_000 },
  );

  const stdout = result.stdout?.toString() ?? '';
  const files: string[] = [];

  const filePatterns = /^\s*-\s*[`']?([^\s`']+\.[a-z]{1,5})[`']?/gm;
  let match: RegExpExecArray | null;
  while ((match = filePatterns.exec(stdout)) !== null) {
    const path = match[1].replace(/^`|`$/g, '');
    if (path.includes('/') || path.includes('.')) {
      files.push(path);
    }
  }

  return [...new Set(files)];
}

/**
 * Get bead context string for advisor prompts via `bd show`.
 */
function getBeadContext(beadId: string, deps: PhaseDeps): string {
  const spawn = deps.spawnFn ?? nodeSpawnSync;

  const result = spawn(
    'bd', ['show', beadId],
    { shell: true, encoding: 'utf-8' as never, timeout: 15_000 },
  );

  return result.stdout?.toString() ?? '';
}

/**
 * Match advisors by piping file hints into match-agents.sh.
 */
function matchAdvisors(
  fileHints: string[],
  ctx: PhaseCtx,
  logTag: PhaseName,
  deps: PhaseDeps,
): MatchedAdvisor[] {
  if (fileHints.length === 0) return [];

  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const input = fileHints.join('\n') + '\n';

  const result = spawn(
    MATCH_AGENTS_SCRIPT,
    ['advisor'],
    { shell: true, encoding: 'utf-8' as never, timeout: 15_000, input },
  );

  const stdout = result.stdout?.toString() ?? '';
  const stderr = result.stderr?.toString() ?? '';
  const exitCode = result.status ?? 1;

  if (stdout) ctx.logger.writePhaseLog(logTag, 'out', stdout);
  if (stderr) ctx.logger.writePhaseLog(logTag, 'err', stderr);

  if (exitCode !== 0) {
    ctx.logger.writePhaseLog(logTag, 'err',
      `match-agents.sh exited with code ${exitCode}\n`);
    return [];
  }

  try {
    return JSON.parse(stdout) as MatchedAdvisor[];
  }
  catch {
    ctx.logger.writePhaseLog(logTag, 'err',
      'Failed to parse match-agents.sh output as JSON\n');
    return [];
  }
}

/**
 * Dispatch a subagent with standard error handling.
 * Replaces 3 nearly-identical dispatch+catch patterns in phases 3, 4, 5.
 */
async function dispatchAgent<T>(
  ctx: PhaseCtx,
  config: {
    agent: string;
    schemaPath: string;
    prompt: string;
    budgetEnvVar: string;
    defaultBudget: number;
    defaultTimeout: number;
    logTag: PhaseName;
    escalateTag: string;
  },
  deps: PhaseDeps,
): Promise<{ result: T | null; escalated: boolean }> {
  const dispatchFn = deps.dispatchFn ?? dispatch;
  const budgetUsd = parseFloat(process.env[config.budgetEnvVar] ?? '') || config.defaultBudget;

  try {
    const result = await dispatchFn<T>({
      agent: config.agent,
      schemaPath: config.schemaPath,
      prompt: config.prompt,
      budgetUsd,
      timeoutMs: config.defaultTimeout,
      ctx,
      logTag: config.logTag,
    });
    return { result, escalated: false };
  }
  catch (err) {
    if (err instanceof DispatchMalformedError || err instanceof DispatchTimeoutError) {
      const reason = err instanceof DispatchTimeoutError
        ? `${config.agent} subagent timed out: ${err.message}`
        : `${config.agent} subagent returned malformed output: ${err.message}`;

      ctx.logger.appendRunJson({
        event: `${config.agent.replace(/-/g, '_')}_escalated`,
        beadId: ctx.beadId,
        reason,
      });

      escalate(ctx.beadId, reason, config.escalateTag, config.logTag, deps, ctx);
      return { result: null, escalated: true };
    }
    throw err;
  }
}

/**
 * Parameterized advisor pass. Replaces the structurally identical
 * phases 3.5 (shapeAdvisors) and 5.5 (analyzeAdvisors).
 */
async function runAdvisorPass(
  ctx: PhaseCtx,
  config: {
    logTag: PhaseName;
    escalateTag: string;
    fanOutPhase: 'phase-3-shape' | 'phase-5-analyze';
    nextOnClean: PhaseName;
    nextOnRefinement: PhaseName;
    skipCondition?: () => boolean;
    skipReason?: string;
  },
  deps: PhaseDeps,
): Promise<PhaseReturn> {
  // Optional skip condition (e.g., leaf bead in analyzeAdvisors)
  if (config.skipCondition?.()) {
    ctx.logger.appendRunJson({
      event: `${config.logTag.replace(/\./g, '_')}_skipped`,
      beadId: ctx.beadId,
      reason: config.skipReason ?? 'skip condition met',
    });
    return { next: config.nextOnClean, ctx };
  }

  // 1. Extract file hints
  const getHints = deps.getFileHintsFn ?? ((id: string) => extractFileHints(id, deps));
  const fileHints = getHints(ctx.beadId);

  ctx.logger.appendRunJson({
    event: `${config.logTag.replace(/\./g, '_')}_file_hints`,
    beadId: ctx.beadId,
    fileCount: fileHints.length,
    files: fileHints,
  });

  // 2. No file hints -> skip
  if (fileHints.length === 0) {
    ctx.logger.appendRunJson({
      event: `${config.logTag.replace(/\./g, '_')}_skipped`,
      beadId: ctx.beadId,
      reason: 'no file hints in bead',
    });
    return { next: config.nextOnClean, ctx };
  }

  // 3. Match advisors
  const advisors = matchAdvisors(fileHints, ctx, config.logTag, deps);

  ctx.logger.appendRunJson({
    event: `${config.logTag.replace(/\./g, '_')}_matched`,
    beadId: ctx.beadId,
    advisorCount: advisors.length,
    advisorNames: advisors.map(a => a.name),
  });

  // 4. No matched advisors -> skip
  if (advisors.length === 0) {
    ctx.logger.appendRunJson({
      event: `${config.logTag.replace(/\./g, '_')}_skipped`,
      beadId: ctx.beadId,
      reason: 'no advisors matched file set',
    });
    return { next: config.nextOnClean, ctx };
  }

  // 5. Get bead context
  const getCtx = deps.getBeadContextFn ?? ((id: string) => getBeadContext(id, deps));
  const beadContext = getCtx(ctx.beadId);

  // 6. Fan out advisors
  const fanOut = deps.fanOutFn ?? fanOutAdvisors;
  const report: RefinementReport = await fanOut(
    advisors,
    ctx.beadId,
    beadContext,
    config.fanOutPhase,
    ctx,
    config.logTag,
    deps.fanOutDeps,
  );

  // 7. Route based on verdict
  if (report.overallVerdict === 'clean') {
    ctx.logger.appendRunJson({
      event: `${config.logTag.replace(/\./g, '_')}_passed`,
      beadId: ctx.beadId,
      summary: report.summary,
    });
    return { next: config.nextOnClean, ctx };
  }

  // Escalate verdicts -> halt
  const hasEscalate = report.advisors.some(v => v.verdict === 'escalate');
  if (hasEscalate) {
    const reason = `advisor REQUEST CHANGES after review: ${report.summary}`;
    ctx.logger.appendRunJson({
      event: `${config.logTag.replace(/\./g, '_')}_escalated`,
      beadId: ctx.beadId,
      reason,
    });
    escalate(ctx.beadId, reason, config.escalateTag, config.logTag, deps, ctx);
    return { next: 'halt', ctx };
  }

  // Refinement needed -> loop back
  ctx.logger.appendRunJson({
    event: `${config.logTag.replace(/\./g, '_')}_refinement_needed`,
    beadId: ctx.beadId,
    summary: report.summary,
  });
  ctx.refinementReport = report;
  return { next: config.nextOnRefinement, ctx };
}

// =============================================================================
// Pure routing functions (exported for direct testing)
// =============================================================================

/**
 * Map a bd-state.sh verdict to the next orchestrator phase.
 *
 * Routing table:
 *   unshaped   -> Shape
 *   shaped     -> ShapeAdvisors
 *   decomposed -> Analyze
 *   analyzed   -> AnalyzeAdvisors (epic) or Branch (leaf)
 *   executing  -> halt
 *   complete   -> halt
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

/**
 * Route to phase-7a-epic or phase-7b-leaf based on issue_type.
 */
export function routeToExecution(issueType: string): PhaseName {
  return issueType === 'epic' ? PhaseName.Epic : PhaseName.Leaf;
}

// =============================================================================
// Prompt builders
// =============================================================================

export function buildShapePrompt(beadId: string): string {
  return [
    `# Shape bead: ${beadId}`,
    '',
    'Read `.claude/commands/shape-bead.md` and run Steps 2-8',
    '(scope / references / standards / technical design / acceptance)',
    `for bead \`${beadId}\`.`,
    '',
    'Populate DESCRIPTION, DESIGN, ACCEPTANCE, and NOTES via separate',
    '`bd update` calls, then add the `shaped` label.',
    '',
    '## Autonomous-mode rules',
    '',
    '- Do NOT use AskUserQuestion. Make best-guess choices and record',
    '  assumptions under an `## Assumptions` heading in notes.',
    '- If the original description provides fewer than ~50 characters of',
    '  actionable signal (no verb, no object, no clear outcome), do NOT',
    '  fabricate a design. Return status `escalate` with the reason.',
    '- On success, return status `shaped` with a one-line summary.',
    '',
    '## Output format',
    '',
    'Respond with JSON matching the shape-verdict schema:',
    '```json',
    '{',
    `  "beadId": "${beadId}",`,
    '  "status": "shaped" | "escalate",',
    '  "summary": "<one line>"',
    '}',
    '```',
  ].join('\n');
}

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

// =============================================================================
// Phase runners
// =============================================================================

/**
 * Phase 0 — Preflight.
 * Runs preflight.sh + git-safe-to-start.sh. Both must pass to proceed.
 */
export async function preflight(ctx: PhaseCtx, deps: PhaseDeps = {}): Promise<PhaseReturn> {
  const opts = scriptOpts(ctx, PhaseName.Preflight, deps);

  // Step 1: Run preflight.sh
  const preflightResult = runScript<PreflightOutput>(PREFLIGHT_SCRIPT, [], opts);

  if (preflightResult.exitCode !== 0) {
    let failures: PreflightFailure[] = [];
    try {
      const parsed = JSON.parse(preflightResult.stdout) as PreflightOutput;
      failures = parsed.failures ?? [];
    }
    catch { /* not JSON */ }

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
    return { next: 'halt', ctx };
  }

  // Belt-and-braces: exit 0 but ok: false
  if (preflightResult.json && !preflightResult.json.ok) {
    for (const f of preflightResult.json.failures) {
      const msg = PREFLIGHT_MESSAGES[f.kind] ?? f.reason;
      console.error(msg);
      ctx.logger.writePhaseLog(PhaseName.Preflight, 'err', msg + '\n');
    }
    return { next: 'halt', ctx };
  }

  // Step 2: Run git-safe-to-start.sh
  const gitSpawn = deps.spawnFn ?? nodeSpawnSync;
  const gitSafeResult = gitSpawn(GIT_SAFE_SCRIPT, [], {
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
    return { next: 'halt', ctx };
  }

  return { next: PhaseName.Select, ctx };
}

/**
 * Phase 1 — Select the top-priority ready bead.
 */
export async function select(ctx: PhaseCtx, deps: PhaseDeps = {}): Promise<PhaseReturn> {
  const opts = scriptOpts(ctx, PhaseName.Select, deps);

  const result = runScript<BeadJson>(BD_TOP_READY_SCRIPT, ['--limit=5'], opts);

  // Exit code 3: backlog exhausted
  if (result.exitCode === 3) {
    const msg = 'backlog exhausted for automation';
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.Select, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  // Exit code 2: usage error
  if (result.exitCode === 2) {
    const msg = 'bd-top-ready.sh usage error (bug, not bead problem)';
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.Select, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  // Any other non-zero exit
  if (result.exitCode !== 0) {
    const msg = `bd-top-ready.sh failed with exit code ${result.exitCode}`;
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.Select, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const bead = result.json;
  if (!bead || !bead.id) {
    const msg = 'No ready beads in backlog.';
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.Select, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

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

/**
 * Phase 2 — Assess bead state and route.
 */
export async function assessState(ctx: PhaseCtx, deps: PhaseDeps = {}): Promise<PhaseReturn> {
  const opts = scriptOpts(ctx, PhaseName.State, deps);

  const result = runScript<StateVerdict>(BD_STATE_SCRIPT, [ctx.beadId], opts);

  if (result.exitCode === 2) {
    const msg = 'bd-state.sh usage error (exit code 2)';
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.State, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  if (result.exitCode !== 0) {
    const msg = `bd-state.sh failed with exit code ${result.exitCode}`;
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.State, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const verdict = result.json;

  ctx.logger.appendRunJson({
    event: 'state_assessed',
    beadId: ctx.beadId,
    state: verdict.state,
    missingPhases: verdict.missing_phases,
    reasons: verdict.reasons,
  });

  const next = routeByState(verdict);

  if (verdict.state === 'executing' || verdict.state === 'complete') {
    const msg = `Bead state "${verdict.state}" is unexpected — this bead should not have appeared in bd ready. Halting (Safeguard 6).`;
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.State, 'err', msg + '\n');
  }

  // --dry-run short circuit
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

/**
 * Phase 3 — Auto-shape if needed (dispatches shape-bead subagent).
 */
export async function shape(ctx: PhaseCtx, deps: PhaseDeps = {}): Promise<PhaseReturn> {
  const prompt = buildShapePrompt(ctx.beadId);

  ctx.logger.appendRunJson({
    event: 'shape_dispatched',
    beadId: ctx.beadId,
  });

  const { result: verdict, escalated } = await dispatchAgent<ShapeVerdict>(ctx, {
    agent: 'shape-bead',
    schemaPath: SHAPE_SCHEMA,
    prompt,
    budgetEnvVar: 'ORCH_BUDGET_SHAPE',
    defaultBudget: 2.00,
    defaultTimeout: 180_000,
    logTag: PhaseName.Shape,
    escalateTag: '3',
  }, deps);

  if (escalated) return { next: 'halt', ctx };

  if (verdict!.status === 'escalate') {
    ctx.logger.appendRunJson({
      event: 'shape_escalated',
      beadId: ctx.beadId,
      reason: verdict!.summary,
    });
    escalate(ctx.beadId, verdict!.summary, '3', PhaseName.Shape, deps, ctx);
    return { next: 'halt', ctx };
  }

  // Shaped — re-run bd-state.sh to verify state advanced
  ctx.logger.appendRunJson({
    event: 'shape_success',
    beadId: ctx.beadId,
    summary: verdict!.summary,
  });

  const opts = scriptOpts(ctx, PhaseName.Shape, deps);
  const stateResult = runScript<StateVerdict>(BD_STATE_SCRIPT, [ctx.beadId], opts);

  if (stateResult.exitCode !== 0) {
    const msg = `bd-state.sh failed after shaping (exit ${stateResult.exitCode}) — halting (Safeguard 6).`;
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.Shape, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const next = routeByState(stateResult.json);

  ctx.logger.appendRunJson({
    event: 'shape_state_recheck',
    beadId: ctx.beadId,
    newState: stateResult.json.state,
    next,
  });

  return { next, ctx };
}

/**
 * Phase 3.5 — Advisory review of the shaped bead.
 */
export async function shapeAdvisors(ctx: PhaseCtx, deps: PhaseDeps = {}): Promise<PhaseReturn> {
  return runAdvisorPass(ctx, {
    logTag: PhaseName.ShapeAdvisors,
    escalateTag: '3.5',
    fanOutPhase: 'phase-3-shape',
    nextOnClean: PhaseName.Decompose,
    nextOnRefinement: PhaseName.Shape,
  }, deps);
}

/**
 * Phase 4 — Decompose if needed.
 */
export async function decompose(ctx: PhaseCtx, deps: PhaseDeps = {}): Promise<PhaseReturn> {
  const opts = scriptOpts(ctx, PhaseName.Decompose, deps);

  // Step 1: Run sizing check
  const sizingResult = runScript<SizingVerdict>(BD_SIZING_SCRIPT, [ctx.beadId], opts);

  if (sizingResult.exitCode === 2) {
    const msg = 'bd-sizing-check.sh usage error (exit code 2)';
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.Decompose, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

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

  if (!sizing.needs_decomposition) {
    ctx.logger.appendRunJson({
      event: 'decompose_skipped',
      beadId: ctx.beadId,
      reason: 'sizing check says no decomposition needed',
    });
    return { next: PhaseName.Analyze, ctx };
  }

  // Check if bead already has children (already an epic)
  const stateResult = runScript<{ state: string; missing_phases: string[] }>(
    BD_STATE_SCRIPT, [ctx.beadId], opts,
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
  const prompt = buildDecomposePrompt(ctx.beadId, sizing.reasons);

  const { result: report, escalated } = await dispatchAgent<DecomposeReport>(ctx, {
    agent: 'decompose-bead',
    schemaPath: DECOMPOSE_SCHEMA,
    prompt,
    budgetEnvVar: 'ORCH_BUDGET_DECOMPOSE',
    defaultBudget: 3.00,
    defaultTimeout: 5 * 60 * 1000,
    logTag: PhaseName.Decompose,
    escalateTag: '4',
  }, deps);

  if (escalated) return { next: 'halt', ctx };

  ctx.logger.appendRunJson({
    event: 'decompose_complete',
    beadId: ctx.beadId,
    parentBeadId: report!.parentBeadId,
    childCount: report!.childCount,
    childBeadIds: report!.childBeadIds,
    summary: report!.summary,
  });

  return { next: PhaseName.Select, ctx };
}

/**
 * Phase 5 — Analyze if needed (enriches leaf children).
 */
export async function analyze(ctx: PhaseCtx, deps: PhaseDeps = {}): Promise<PhaseReturn> {
  const childIds = deps.childIds ?? [];
  const spawn = deps.spawnFn ?? nodeSpawnSync;

  // Step 1: If leaf (no children), skip to Branch
  if (childIds.length === 0) {
    ctx.logger.appendRunJson({
      event: 'analyze_skipped',
      beadId: ctx.beadId,
      reason: 'bead is a leaf, skip to Branch',
    });
    return { next: PhaseName.Branch, ctx };
  }

  // Step 2: Check enrichment of each child
  const unenrichedIds: string[] = [];
  for (const leafId of childIds) {
    const result = spawn(BD_ENRICHMENT_SCRIPT, [leafId], {
      encoding: 'buffer' as never,
      shell: true,
      timeout: 30_000,
    });
    if ((result.status ?? 1) !== 0) {
      unenrichedIds.push(leafId);
    }
  }

  // Step 3: All enriched -> skip to AnalyzeAdvisors
  if (unenrichedIds.length === 0) {
    ctx.logger.appendRunJson({
      event: 'analyze_skipped',
      beadId: ctx.beadId,
      reason: 'all leaves already enriched',
    });
    return { next: PhaseName.AnalyzeAdvisors, ctx };
  }

  // Step 4: Dispatch analyze-bead subagent
  const prompt = buildAnalyzePrompt(ctx.beadId, unenrichedIds);

  const { result: report, escalated } = await dispatchAgent<AnalyzeReport>(ctx, {
    agent: 'analyze-bead',
    schemaPath: ANALYZE_SCHEMA,
    prompt,
    budgetEnvVar: 'ORCH_BUDGET_ANALYZE',
    defaultBudget: 3.00,
    defaultTimeout: 5 * 60 * 1000,
    logTag: PhaseName.Analyze,
    escalateTag: '5',
  }, deps);

  if (escalated) return { next: 'halt', ctx };

  // Step 5: Belt-and-braces re-check
  const stillUnenriched: string[] = [];
  for (const leafId of childIds) {
    const result = spawn(BD_ENRICHMENT_SCRIPT, [leafId], {
      encoding: 'buffer' as never,
      shell: true,
      timeout: 30_000,
    });
    if ((result.status ?? 1) !== 0) {
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

  ctx.logger.appendRunJson({
    event: 'analyze_complete',
    beadId: ctx.beadId,
    mode: report!.mode,
    leavesEnriched: report!.leavesEnriched,
    summary: report!.summary,
    waves: report!.waves,
  });

  return { next: PhaseName.AnalyzeAdvisors, ctx };
}

/**
 * Phase 5.5 — Advisory review of the analyzed plan (epics only).
 */
export async function analyzeAdvisors(ctx: PhaseCtx, deps: PhaseDeps = {}): Promise<PhaseReturn> {
  const checkEpic = deps.isEpicFn ?? (() => {
    const spawn = deps.spawnFn ?? nodeSpawnSync;
    const result = spawn('bd', ['show', ctx.beadId], {
      shell: true, encoding: 'utf-8' as never, timeout: 15_000,
    });
    return /CHILDREN|children/i.test(result.stdout?.toString() ?? '');
  });

  return runAdvisorPass(ctx, {
    logTag: PhaseName.AnalyzeAdvisors,
    escalateTag: '5.5',
    fanOutPhase: 'phase-5-analyze',
    nextOnClean: PhaseName.Branch,
    nextOnRefinement: PhaseName.Analyze,
    skipCondition: () => !checkEpic(ctx.beadId),
    skipReason: 'leaf bead — advisory review only applies to epics',
  }, deps);
}

/**
 * Phase 6 — Branch setup (deterministic, no LLM dispatch).
 */
export async function branch(ctx: PhaseCtx, deps: PhaseDeps = {}): Promise<PhaseReturn> {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const logger = ctx.logger;

  logger.appendRunJson({
    event: 'branch_setup_start',
    beadId: ctx.beadId,
  });

  // Step 1: Safety re-check
  const safeResult = spawnCmd(GIT_SAFE_SCRIPT, [], logger, PhaseName.Branch, spawn);

  if (safeResult.exitCode === 2) {
    const msg = `UNSAFE: git failure \u2014 ${safeResult.stderr.trim() || 'unexpected git error'}`;
    console.error(msg);
    logger.writePhaseLog(PhaseName.Branch, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  if (safeResult.exitCode !== 0) {
    const msg = `UNSAFE: git-safe-to-start failed \u2014 ${safeResult.stderr.trim() || 'working tree is dirty or not on main'}`;
    console.error(msg);
    logger.writePhaseLog(PhaseName.Branch, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  // Step 2: Derive branch name
  const branchCmd = spawnCmd(BRANCH_NAME_SCRIPT, [ctx.beadId], logger, PhaseName.Branch, spawn);

  if (branchCmd.exitCode !== 0) {
    const msg = `branch-name.sh failed (exit ${branchCmd.exitCode}): ${branchCmd.stderr.trim()}`;
    console.error(msg);
    logger.writePhaseLog(PhaseName.Branch, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const branchName = branchCmd.stdout;

  // Step 3: Check if already on target branch
  const currentCmd = spawnCmd('git', ['branch', '--show-current'], logger, PhaseName.Branch, spawn);

  if (currentCmd.exitCode !== 0) {
    const msg = `git branch --show-current failed: ${currentCmd.stderr.trim()}`;
    console.error(msg);
    logger.writePhaseLog(PhaseName.Branch, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  // Step 4: Create branch if not already on it
  if (currentCmd.stdout !== branchName) {
    const checkoutCmd = spawnCmd('git', ['checkout', '-b', branchName], logger, PhaseName.Branch, spawn);

    if (checkoutCmd.exitCode !== 0) {
      const msg = `git checkout -b "${branchName}" failed: ${checkoutCmd.stderr.trim()}`;
      console.error(msg);
      logger.writePhaseLog(PhaseName.Branch, 'err', msg + '\n');
      return { next: 'halt', ctx };
    }

    logger.appendRunJson({
      event: 'branch_created',
      branchName,
      baseBranch: 'main',
    });
  }
  else {
    logger.appendRunJson({
      event: 'branch_already_current',
      branchName,
    });
  }

  // Step 5: Determine issue_type for routing
  const bdCmd = spawnCmd('bd', ['show', '--json', ctx.beadId], logger, PhaseName.Branch, spawn);

  let issueType = 'task';

  if (bdCmd.exitCode === 0 && bdCmd.stdout) {
    try {
      const parsed = JSON.parse(bdCmd.stdout) as Array<{ issue_type?: string }>;
      issueType = parsed[0]?.issue_type ?? 'task';
    }
    catch { /* default to task */ }
  }
  else if (bdCmd.exitCode !== 0) {
    const msg = `bd show --json failed (exit ${bdCmd.exitCode}): ${bdCmd.stderr.trim()}`;
    console.error(msg);
    logger.writePhaseLog(PhaseName.Branch, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const next = routeToExecution(issueType);

  logger.appendRunJson({
    event: 'branch_setup_complete',
    branchName,
    issueType,
    next,
  });

  return { next, ctx };
}
