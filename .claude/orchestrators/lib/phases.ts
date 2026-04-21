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
import { PhaseName, type RunContext, type RunLogger } from './types.js';
import {
  dispatch,
  spawnCmd,
  fanOutAdvisors,
  DispatchMalformedError,
  DispatchTimeoutError,
  type DispatchOptions,
  type MatchedAdvisor,
  type RefinementReport,
  type FanOutDeps,
} from './dispatch.js';
import {
  preflight as runPreflightCheck,
  gitSafeToStart,
  bdTopReady,
  bdState,
  bdSizingCheck,
  bdEnrichmentCheck,
  bdEscalate,
  bdCreateFollowup,
  branchName,
  discoverAgents,
  type StateVerdict,
  type SizingVerdict,
  type BeadJson,
  type PreflightResult as PreflightCheckResult,
  type AgentInfo,
} from './helpers.js';

// =============================================================================
// Types
// =============================================================================

/** Shared context for all phases. */
export interface PhaseCtx extends RunContext {
  dryRun: boolean;
  refinementReport?: RefinementReport;
  /** Per-phase refinement-loop counter, keyed by logTag (e.g. 'phase-3.5-advisors'). */
  refinementRounds?: Record<string, number>;
}

/** Max refinement rounds before an advisor loop triages remaining concerns. */
export const REFINEMENT_ROUND_CAP_DEFAULT = 3;

/** Return type of every phase runner. */
export interface PhaseReturn {
  next: PhaseName | 'halt';
  ctx: PhaseCtx;
}

/** Unified dependency injection interface for all phases. */
export interface PhaseDeps {
  /** Override spawnSync (preflight, escalation, branch, enrichment). */
  spawnFn?: typeof nodeSpawnSync;
  /** Override claude dispatch. */
  dispatchFn?: <T>(opts: DispatchOptions) => Promise<T>;
  /** Override fanOutAdvisors. */
  fanOutFn?: typeof fanOutAdvisors;
  /** Override bead context fetcher for advisors. */
  getBeadContextFn?: (beadId: string) => string;
  /** Override advisor selection (for testing). Returns MatchedAdvisor[]. */
  selectAdvisorsFn?: (
    ctx: PhaseCtx,
    logTag: PhaseName,
    deps: PhaseDeps,
  ) => Promise<MatchedAdvisor[]>;
  /** Override epic detection. */
  isEpicFn?: (beadId: string) => boolean;
  /** Override child bead IDs (for analyze phase). */
  childIds?: string[];
  /** Override fan-out deps. */
  fanOutDeps?: FanOutDeps;
  /**
   * Override the advisor-triage classifier (called when the refinement round
   * cap is exceeded). Returning null triggers the default escalate fallback.
   */
  triageFn?: (
    ctx: PhaseCtx,
    report: RefinementReport,
    logTag: PhaseName,
    deps: PhaseDeps,
  ) => Promise<AdvisorTriageVerdict | null>;
}

// =============================================================================
// Verdict / report types
// =============================================================================

export type { StateVerdict, SizingVerdict, BeadJson };

export interface ShapeVerdict {
  beadId: string;
  status: 'shaped' | 'escalate';
  summary: string;
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

export interface AdvisorTriageVerdict {
  verdict: 'followup' | 'escalate';
  reason: string;
  followup?: {
    title: string;
    description: string;
    labels?: string[];
  };
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

/**
 * Escalate a bead via bdEscalate(). One copy replaces 4 identical
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
  bdEscalate(beadId, reason, phaseTag, { spawnFn: deps.spawnFn });
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
 * Build the prompt for the agent-selector subagent.
 */
export function buildAgentSelectorPrompt(
  role: 'advisor' | 'auditor',
  candidates: AgentInfo[],
  context: string,
): string {
  const candidateBlock = candidates.length === 0
    ? '_(no candidates found)_'
    : candidates.map(c => `- **${c.name}**: ${c.description}`).join('\n');

  return [
    `# Agent selection`,
    '',
    `role: ${role}`,
    '',
    '## Candidates',
    '',
    candidateBlock,
    '',
    '## Context',
    '',
    context,
    '',
    '## Output format',
    '',
    'Respond with ONLY a single JSON object matching the agent-selector schema.',
    'Do not include prose, explanations, or markdown fences — the orchestrator parses your full stdout as JSON.',
    '',
    '```json',
    '{',
    '  "role": "advisor" | "auditor",',
    '  "selected": [ { "name": "<agent name>", "rationale": "<one line>" } ],',
    '  "reasoning": "<short paragraph>"',
    '}',
    '```',
  ].join('\n');
}

interface AgentSelectorVerdict {
  role: 'advisor' | 'auditor';
  selected: Array<{ name: string; rationale: string }>;
  reasoning?: string;
}

/**
 * Parse an AgentSelectorVerdict from raw dispatch output. Tolerates either
 * a pre-parsed object or a string with JSON optionally wrapped in a fenced
 * code block.
 */
export function parseAgentSelectorVerdict(raw: unknown): AgentSelectorVerdict | null {
  const fromObject = (obj: Record<string, unknown>): AgentSelectorVerdict | null => {
    if (obj.role !== 'advisor' && obj.role !== 'auditor') return null;
    if (!Array.isArray(obj.selected)) return null;
    const selected: Array<{ name: string; rationale: string }> = [];
    for (const entry of obj.selected) {
      if (!entry || typeof entry !== 'object') return null;
      const e = entry as Record<string, unknown>;
      if (typeof e.name !== 'string' || !e.name.trim()) return null;
      const rationale = typeof e.rationale === 'string' ? e.rationale : '';
      selected.push({ name: e.name.trim(), rationale });
    }
    const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';
    return { role: obj.role, selected, reasoning };
  };

  if (raw && typeof raw === 'object') {
    return fromObject(raw as Record<string, unknown>);
  }
  if (typeof raw !== 'string') return null;

  const candidates: string[] = [];
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(raw)) !== null) {
    candidates.push(match[1].trim());
  }
  candidates.push(raw.trim());

  for (const candidate of candidates.reverse()) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object') {
        const verdict = fromObject(parsed as Record<string, unknown>);
        if (verdict) return verdict;
      }
    }
    catch {
      continue;
    }
  }
  return null;
}

/**
 * Dispatch the agent-selector subagent to pick advisors for a bead.
 * Returns the selected advisors as MatchedAdvisor[] (rationale from the
 * selector's output), or an empty array on malformed/failed dispatch.
 */
async function selectAdvisors(
  ctx: PhaseCtx,
  logTag: PhaseName,
  deps: PhaseDeps,
): Promise<MatchedAdvisor[]> {
  const candidates = discoverAgents('advisor');
  if (candidates.length === 0) return [];

  const getCtx = deps.getBeadContextFn ?? ((id: string) => getBeadContext(id, deps));
  const beadContext = getCtx(ctx.beadId);

  const prompt = buildAgentSelectorPrompt('advisor', candidates, beadContext);
  const dispatchFn = deps.dispatchFn ?? dispatch;

  try {
    const raw = await dispatchFn<unknown>({
      agent: 'agent-selector',
      prompt,
      timeoutMs: 120_000,
      ctx,
      logTag,
    });

    const verdict = parseAgentSelectorVerdict(raw);
    if (!verdict) {
      ctx.logger.appendRunJson({
        event: 'agent_selector_parse_failed',
        beadId: ctx.beadId,
        phase: logTag,
        role: 'advisor',
      });
      return [];
    }

    ctx.logger.writePhaseLog(logTag, 'out',
      JSON.stringify(verdict, null, 2) + '\n');

    const byName = new Map(candidates.map(c => [c.name, c]));
    const matched: MatchedAdvisor[] = [];
    for (const entry of verdict.selected) {
      const agent = byName.get(entry.name);
      if (!agent) continue;
      matched.push({
        name: agent.name,
        path: agent.path,
        description: agent.description,
        rationale: entry.rationale,
      });
    }
    return matched;
  }
  catch (err) {
    ctx.logger.appendRunJson({
      event: 'agent_selector_dispatch_failed',
      beadId: ctx.beadId,
      phase: logTag,
      role: 'advisor',
      error: err instanceof Error ? err.message : String(err),
    });
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
    prompt: string;
    defaultTimeout: number;
    logTag: PhaseName;
    escalateTag: string;
  },
  deps: PhaseDeps,
): Promise<{ result: T | null; escalated: boolean }> {
  const dispatchFn = deps.dispatchFn ?? dispatch;

  try {
    const result = await dispatchFn<T>({
      agent: config.agent,
      prompt: config.prompt,
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
 * Build the prompt fed to the advisor-triage classifier.
 *
 * Given the non-clean advisor verdicts that remain after the refinement cap,
 * ask the model to decide whether the concerns should block (escalate) or can
 * be deferred to a follow-up bead so the parent can proceed.
 */
export function buildAdvisorTriagePrompt(
  beadId: string,
  report: RefinementReport,
): string {
  const nonClean = report.advisors.filter(v => v.verdict !== 'clean');
  const findingsBlock = nonClean.length === 0
    ? '_(no non-clean advisor verdicts captured)_'
    : nonClean.map(v => {
      const lines = [`### [${v.agent}] verdict: ${v.verdict}`];
      if (v.concerns.length > 0) {
        lines.push('', 'Concerns:');
        for (const c of v.concerns) lines.push(`- ${c}`);
      }
      if (v.recommendations.length > 0) {
        lines.push('', 'Recommendations:');
        for (const r of v.recommendations) lines.push(`- ${r}`);
      }
      return lines.join('\n');
    }).join('\n\n');

  return [
    `# Advisor triage: ${beadId}`,
    '',
    `Bead \`${beadId}\` has exhausted its advisor refinement rounds. The`,
    'remaining advisor concerns are listed below. Decide whether they should',
    'block the bead (escalate to a human) or can be deferred to a follow-up',
    'bead so the parent proceeds.',
    '',
    '## Remaining advisor concerns',
    '',
    findingsBlock,
    '',
    '## Decision guidance',
    '',
    '- `escalate` when the concerns indicate the bead itself is unsound —',
    '  missing acceptance criteria, mis-scoped design, structural ambiguity',
    '  that would make implementation unsafe.',
    '- `followup` when the concerns are real but can be addressed separately —',
    '  extra test coverage, adjacent refactors, documentation gaps, or',
    '  follow-on quality work that does not block the current bead.',
    '',
    'When returning `followup`, write a single aggregated follow-up bead that',
    'summarizes every deferred concern (one bead per triage, not per advisor).',
    'The parent bead will be advanced as if the advisor pass were clean; the',
    'follow-up bead will be filed with a `followup-from:' + beadId + '` label.',
    '',
    '## Output format',
    '',
    'Respond with ONLY a single JSON object. No prose, no markdown fences.',
    '',
    '```json',
    '{',
    '  "verdict": "followup" | "escalate",',
    '  "reason": "<one line>",',
    '  "followup": {',
    '    "title": "<short imperative title>",',
    '    "description": "<multi-line summary of the deferred concerns>",',
    '    "labels": ["needs-shape"]',
    '  }',
    '}',
    '```',
    '',
    'Omit the `followup` object when verdict is `escalate`.',
  ].join('\n');
}

/**
 * Parse an AdvisorTriageVerdict from raw dispatch output. Tolerates either
 * a pre-parsed object (when dispatch used --json-schema) or a string with
 * JSON — optionally wrapped in a fenced code block.
 */
export function parseAdvisorTriageVerdict(raw: unknown): AdvisorTriageVerdict | null {
  const fromObject = (obj: Record<string, unknown>): AdvisorTriageVerdict | null => {
    if (obj.verdict !== 'followup' && obj.verdict !== 'escalate') return null;
    const reason = typeof obj.reason === 'string' ? obj.reason : '';
    const result: AdvisorTriageVerdict = { verdict: obj.verdict, reason };
    if (obj.verdict === 'followup' && obj.followup && typeof obj.followup === 'object') {
      const f = obj.followup as Record<string, unknown>;
      const title = typeof f.title === 'string' ? f.title.trim() : '';
      const description = typeof f.description === 'string' ? f.description : '';
      if (!title || !description) return null;
      const labels = Array.isArray(f.labels)
        ? f.labels.filter((x): x is string => typeof x === 'string')
        : [];
      result.followup = { title, description, labels };
    }
    if (result.verdict === 'followup' && !result.followup) return null;
    return result;
  };

  if (raw && typeof raw === 'object') {
    return fromObject(raw as Record<string, unknown>);
  }
  if (typeof raw !== 'string') return null;

  const candidates: string[] = [];
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(raw)) !== null) {
    candidates.push(match[1].trim());
  }
  candidates.push(raw.trim());

  for (const candidate of candidates.reverse()) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object') {
        const verdict = fromObject(parsed as Record<string, unknown>);
        if (verdict) return verdict;
      }
    }
    catch {
      continue;
    }
  }
  return null;
}

/** Default advisor-triage dispatcher. Null return → caller falls back to escalate. */
async function defaultAdvisorTriage(
  ctx: PhaseCtx,
  report: RefinementReport,
  logTag: PhaseName,
  deps: PhaseDeps,
): Promise<AdvisorTriageVerdict | null> {
  const prompt = buildAdvisorTriagePrompt(ctx.beadId, report);
  const dispatchFn = deps.dispatchFn ?? dispatch;

  try {
    const raw = await dispatchFn<unknown>({
      agent: 'advisor-triage',
      prompt,
      timeoutMs: 90_000,
      ctx,
      logTag,
    });
    return parseAdvisorTriageVerdict(raw);
  }
  catch (err) {
    ctx.logger.appendRunJson({
      event: 'advisor_triage_dispatch_failed',
      beadId: ctx.beadId,
      phase: logTag,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * When the advisor refinement cap is exceeded, run an LLM triage step to
 * decide whether remaining concerns should escalate to a human or can be
 * deferred to a follow-up bead so the parent advances.
 *
 * - `followup` + successful `bd create` → advance to `nextOnClean`.
 * - `followup` with failed `bd create` → fall back to escalate.
 * - `escalate` → call bdEscalate + halt.
 * - triage returned null (dispatch failed or malformed) → escalate + halt.
 */
export async function applyAdvisorTriage(
  ctx: PhaseCtx,
  report: RefinementReport,
  fallbackReason: string,
  config: {
    logTag: PhaseName;
    escalateTag: string;
    nextOnClean: PhaseName;
  },
  deps: PhaseDeps,
): Promise<PhaseReturn> {
  const tagKey = config.logTag.replace(/\./g, '_');
  const triageFn = deps.triageFn ?? defaultAdvisorTriage;
  const triage = await triageFn(ctx, report, config.logTag, deps);

  if (triage?.verdict === 'followup' && triage.followup) {
    const followup = bdCreateFollowup(
      {
        parentBeadId: ctx.beadId,
        title: triage.followup.title,
        description: triage.followup.description,
        labels: triage.followup.labels ?? ['needs-shape'],
      },
      { spawnFn: deps.spawnFn },
    );

    if (followup.beadId) {
      ctx.logger.appendRunJson({
        event: `${tagKey}_triaged_followup`,
        beadId: ctx.beadId,
        followupBeadId: followup.beadId,
        reason: triage.reason,
      });
      return { next: config.nextOnClean, ctx };
    }

    ctx.logger.appendRunJson({
      event: `${tagKey}_triage_followup_failed`,
      beadId: ctx.beadId,
      rawOutput: followup.rawOutput,
    });
  }

  const escalateReason = triage?.verdict === 'escalate'
    ? `advisor triage escalated: ${triage.reason || fallbackReason}`
    : fallbackReason;
  escalate(ctx.beadId, escalateReason, config.escalateTag, config.logTag, deps, ctx);
  return { next: 'halt', ctx };
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

  // 1. Select advisors via the agent-selector subagent
  const selectFn = deps.selectAdvisorsFn ?? selectAdvisors;
  const advisors = await selectFn(ctx, config.logTag, deps);

  ctx.logger.appendRunJson({
    event: `${config.logTag.replace(/\./g, '_')}_selected`,
    beadId: ctx.beadId,
    advisorCount: advisors.length,
    advisorNames: advisors.map(a => a.name),
  });

  // 2. Empty selection -> escalate (not silent skip).
  // The selector returns empty only when it cannot identify any applicable
  // reviewer, or when its dispatch failed/returned malformed output. Either
  // way the bead should not advance without review.
  if (advisors.length === 0) {
    const reason = 'agent-selector returned empty advisor selection';
    ctx.logger.appendRunJson({
      event: `${config.logTag.replace(/\./g, '_')}_escalated`,
      beadId: ctx.beadId,
      reason,
    });
    escalate(ctx.beadId, reason, config.escalateTag, config.logTag, deps, ctx);
    return { next: 'halt', ctx };
  }

  // 3. Get bead context for the advisor fan-out
  const getCtx = deps.getBeadContextFn ?? ((id: string) => getBeadContext(id, deps));
  const beadContext = getCtx(ctx.beadId);

  // 4. Fan out advisors
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

  // 5. Route based on verdict
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

  // Refinement needed -> increment round counter, escalate if cap exceeded.
  const cap = parseInt(process.env.ORCH_REFINEMENT_ROUND_CAP ?? '', 10) || REFINEMENT_ROUND_CAP_DEFAULT;
  ctx.refinementRounds = ctx.refinementRounds ?? {};
  const previousRounds = ctx.refinementRounds[config.logTag] ?? 0;
  const nextRound = previousRounds + 1;
  ctx.refinementRounds[config.logTag] = nextRound;

  if (nextRound >= cap) {
    const reason = `unresolved after ${nextRound} refinement round(s): ${report.summary}`;
    ctx.logger.appendRunJson({
      event: `${config.logTag.replace(/\./g, '_')}_cap_exceeded`,
      beadId: ctx.beadId,
      round: nextRound,
      cap,
      reason,
    });

    return await applyAdvisorTriage(ctx, report, reason, {
      logTag: config.logTag,
      escalateTag: config.escalateTag,
      nextOnClean: config.nextOnClean,
    }, deps);
  }

  ctx.logger.appendRunJson({
    event: `${config.logTag.replace(/\./g, '_')}_refinement_needed`,
    beadId: ctx.beadId,
    round: nextRound,
    cap,
    summary: report.summary,
  });
  ctx.refinementReport = report;
  return { next: config.nextOnRefinement, ctx };
}

// =============================================================================
// Pure routing functions (exported for direct testing)
// =============================================================================

/**
 * Map a bdState() verdict to the next orchestrator phase.
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

/**
 * Render a RefinementReport as a markdown section to splice into a re-dispatch
 * prompt. Returns empty string when the report is absent or clean (belt +
 * braces — callers only pass non-clean reports).
 */
export function formatRefinementFeedback(report?: RefinementReport): string {
  if (!report || report.overallVerdict === 'clean') return '';
  const nonClean = report.advisors.filter(v => v.verdict !== 'clean');
  if (nonClean.length === 0) return '';

  const lines: string[] = ['## Refinement feedback from prior review', ''];
  lines.push(
    'Your previous output was reviewed by advisors and flagged for refinement.',
    'Address each concern below when re-running — update the relevant `bd` fields',
    '(design, acceptance, notes) so the next advisor pass can approve.',
    '',
  );
  for (const v of nonClean) {
    lines.push(`### [${v.agent}] verdict: ${v.verdict}`);
    if (v.concerns.length > 0) {
      lines.push('', 'Concerns:');
      for (const c of v.concerns) lines.push(`- ${c}`);
    }
    if (v.recommendations.length > 0) {
      lines.push('', 'Recommendations:');
      for (const r of v.recommendations) lines.push(`- ${r}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function buildShapePrompt(beadId: string, refinementReport?: RefinementReport): string {
  const feedback = formatRefinementFeedback(refinementReport);
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
    ...(feedback ? ['', feedback] : []),
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

export function buildAnalyzePrompt(
  epicId: string,
  unenrichedIds: string[],
  refinementReport?: RefinementReport,
): string {
  const feedback = formatRefinementFeedback(refinementReport);
  return [
    `Read \`.claude/commands/analyze-bead.md\` and run its full process for \`${epicId}\` autonomously.`,
    '',
    `Unenriched leaves: ${JSON.stringify(unenrichedIds)}`,
    '',
    'Skip Phase 1.5 (decomposition is already complete); start from Phase 2 (Map Hierarchy) through Phase 5 (Store Analysis).',
    '',
    'No AskUserQuestion -- flag issues rather than pausing.',
    ...(feedback ? ['', feedback] : []),
    '',
    'Report execution waves and confirm every leaf\'s notes contains an `Implementation Context` block.',
  ].join('\n');
}

// =============================================================================
// Phase runners
// =============================================================================

/**
 * Phase 0 — Preflight.
 * Runs preflight checks + git-safe-to-start. Both must pass to proceed.
 */
export async function preflight(ctx: PhaseCtx, deps: PhaseDeps = {}): Promise<PhaseReturn> {
  const explicitBead = ctx.beadId !== '';

  // Step 1: Run preflight checks
  const preflightResult = runPreflightCheck({ spawnFn: deps.spawnFn });

  // When an explicit bead is given, backlog emptiness is not a blocker:
  // the user may be picking up a partially-processed or non-ready bead.
  const blockingFailures = explicitBead
    ? preflightResult.failures.filter(f => f.kind !== 'empty_backlog')
    : preflightResult.failures;

  if (blockingFailures.length > 0) {
    for (const f of blockingFailures) {
      const msg = PREFLIGHT_MESSAGES[f.kind] ?? f.reason;
      console.error(msg);
      ctx.logger.writePhaseLog(PhaseName.Preflight, 'err', msg + '\n');
    }
    return { next: 'halt', ctx };
  }

  // Step 2: Git safety check
  const gitSafe = gitSafeToStart({ spawnFn: deps.spawnFn });
  if (!gitSafe.ok) {
    const msg = gitSafe.reason ?? 'git safety check failed';
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.Preflight, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  return { next: PhaseName.Select, ctx };
}

/**
 * Phase 1 — Select the top-priority ready bead.
 *
 * If ctx.beadId is already populated (explicit --bead-id), skip bdTopReady
 * and route straight to state assessment.
 */
export async function select(ctx: PhaseCtx, deps: PhaseDeps = {}): Promise<PhaseReturn> {
  if (ctx.beadId) {
    ctx.logger.appendRunJson({
      event: 'bead_explicit',
      beadId: ctx.beadId,
    });
    return { next: PhaseName.State, ctx };
  }

  const topReady = bdTopReady({ spawnFn: deps.spawnFn });

  if (topReady.exhausted || !topReady.bead) {
    const msg = 'backlog exhausted for automation';
    console.error(msg);
    ctx.logger.writePhaseLog(PhaseName.Select, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const bead = topReady.bead;
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
  const verdict = bdState(ctx.beadId, { spawnFn: deps.spawnFn });

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
  const prompt = buildShapePrompt(ctx.beadId, ctx.refinementReport);

  ctx.logger.appendRunJson({
    event: 'shape_dispatched',
    beadId: ctx.beadId,
  });

  const { result: verdict, escalated } = await dispatchAgent<ShapeVerdict>(ctx, {
    agent: 'shape-bead',
    prompt,
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

  // Shaped — re-run bdState to verify state advanced
  ctx.logger.appendRunJson({
    event: 'shape_success',
    beadId: ctx.beadId,
    summary: verdict!.summary,
  });

  const stateVerdict = bdState(ctx.beadId, { spawnFn: deps.spawnFn });

  const next = routeByState(stateVerdict);

  ctx.logger.appendRunJson({
    event: 'shape_state_recheck',
    beadId: ctx.beadId,
    newState: stateVerdict.state,
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
  // Step 1: Run sizing check
  const sizing = bdSizingCheck(ctx.beadId, { spawnFn: deps.spawnFn });

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
  const stateVerdict = bdState(ctx.beadId, { spawnFn: deps.spawnFn });
  const isEpic = !stateVerdict.missing_phases.includes('decomposed');

  if (isEpic) {
    ctx.logger.appendRunJson({
      event: 'decompose_skipped',
      beadId: ctx.beadId,
      reason: 'bead already has children',
    });
    return { next: PhaseName.Analyze, ctx };
  }

  // Step 3: Dispatch decompose subagent
  const prompt = buildDecomposePrompt(ctx.beadId, sizing.reasons);

  const { result: report, escalated } = await dispatchAgent<DecomposeReport>(ctx, {
    agent: 'decompose-bead',
    prompt,
    defaultTimeout: 5 * 60 * 1000,
    logTag: PhaseName.Decompose,
    escalateTag: '4',
  }, deps);

  if (escalated) return { next: 'halt', ctx };

  // Re-read bead state to verify whether decomposition actually happened.
  // decompose-bead is dispatched without a JSON schema, so `report` is raw
  // stdout — its fields are unreliable. `bd show` is the source of truth.
  const postDecomposeState = bdState(ctx.beadId, { spawnFn: deps.spawnFn });
  const actuallyDecomposed = !postDecomposeState.missing_phases.includes('decomposed');

  if (actuallyDecomposed) {
    ctx.logger.appendRunJson({
      event: 'decompose_complete',
      beadId: ctx.beadId,
      parentBeadId: report!.parentBeadId,
      childCount: report!.childCount,
      childBeadIds: report!.childBeadIds,
      summary: report!.summary,
    });
  }
  else {
    // Agent judged the bead a leaf despite the sizer's heuristic. Trust it,
    // log the decision for observability, and proceed without re-dispatch.
    ctx.logger.appendRunJson({
      event: 'decompose_declined',
      beadId: ctx.beadId,
      reason: 'decompose-bead left bead without children; treating as leaf per agent judgment',
    });
  }

  return { next: PhaseName.Analyze, ctx };
}

/**
 * Phase 5 — Analyze if needed (enriches leaf children).
 */
export async function analyze(ctx: PhaseCtx, deps: PhaseDeps = {}): Promise<PhaseReturn> {
  const childIds = deps.childIds ?? [];

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
    const enriched = bdEnrichmentCheck(leafId, { spawnFn: deps.spawnFn });
    if (!enriched) {
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
  const prompt = buildAnalyzePrompt(ctx.beadId, unenrichedIds, ctx.refinementReport);

  const { result: report, escalated } = await dispatchAgent<AnalyzeReport>(ctx, {
    agent: 'analyze-bead',
    prompt,
    defaultTimeout: 5 * 60 * 1000,
    logTag: PhaseName.Analyze,
    escalateTag: '5',
  }, deps);

  if (escalated) return { next: 'halt', ctx };

  // Step 5: Belt-and-braces re-check
  const stillUnenriched: string[] = [];
  for (const leafId of childIds) {
    const enriched = bdEnrichmentCheck(leafId, { spawnFn: deps.spawnFn });
    if (!enriched) {
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
  const logger = ctx.logger;

  logger.appendRunJson({
    event: 'branch_setup_start',
    beadId: ctx.beadId,
  });

  // Step 1: Safety re-check
  const gitSafe = gitSafeToStart({ spawnFn: deps.spawnFn });
  if (!gitSafe.ok) {
    const msg = `UNSAFE: git-safe-to-start failed \u2014 ${gitSafe.reason ?? 'working tree is dirty or not on main'}`;
    console.error(msg);
    logger.writePhaseLog(PhaseName.Branch, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  // Step 2: Fetch bead title + type for branch name derivation
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const bdCmd = spawnCmd('bd', ['show', '--json', ctx.beadId], logger, PhaseName.Branch, spawn);

  if (bdCmd.exitCode !== 0) {
    const msg = `bd show --json failed (exit ${bdCmd.exitCode}): ${bdCmd.stderr.trim()}`;
    console.error(msg);
    logger.writePhaseLog(PhaseName.Branch, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  let issueType = 'task';
  let title = ctx.beadId;

  if (bdCmd.stdout) {
    try {
      const parsed = JSON.parse(bdCmd.stdout) as Array<{ issue_type?: string; title?: string }>;
      issueType = parsed[0]?.issue_type ?? 'task';
      title = parsed[0]?.title ?? ctx.beadId;
    }
    catch { /* default to task */ }
  }

  // Step 3: Derive branch name (pure function)
  const derivedBranchName = branchName(ctx.beadId, title, issueType);

  // Step 4: Check if already on target branch
  const currentCmd = spawnCmd('git', ['branch', '--show-current'], logger, PhaseName.Branch, spawn);

  if (currentCmd.exitCode !== 0) {
    const msg = `git branch --show-current failed: ${currentCmd.stderr.trim()}`;
    console.error(msg);
    logger.writePhaseLog(PhaseName.Branch, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  // Step 5: Create branch if not already on it
  if (currentCmd.stdout !== derivedBranchName) {
    const checkoutCmd = spawnCmd('git', ['checkout', '-b', derivedBranchName], logger, PhaseName.Branch, spawn);

    if (checkoutCmd.exitCode !== 0) {
      const msg = `git checkout -b "${derivedBranchName}" failed: ${checkoutCmd.stderr.trim()}`;
      console.error(msg);
      logger.writePhaseLog(PhaseName.Branch, 'err', msg + '\n');
      return { next: 'halt', ctx };
    }

    logger.appendRunJson({
      event: 'branch_created',
      branchName: derivedBranchName,
      baseBranch: 'main',
    });
  }
  else {
    logger.appendRunJson({
      event: 'branch_already_current',
      branchName: derivedBranchName,
    });
  }

  const next = routeToExecution(issueType);

  logger.appendRunJson({
    event: 'branch_setup_complete',
    branchName: derivedBranchName,
    issueType,
    next,
  });

  return { next, ctx };
}
