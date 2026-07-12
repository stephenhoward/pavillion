/**
 * Consolidated execution phases (7a epic, 7b leaf, 8 PR).
 *
 * Merges phase-7a-epic.ts, phase-7b-leaf.ts, and phase-8-pr.ts into a
 * single module with a unified ExecuteDeps interface.
 *
 * Exports:
 *  - dispatchImplementer, runAudit, runLeafExecution  (from 7b)
 *  - runWithConcurrencyCap, runEpicExecution           (from 7a)
 *  - parseBeadJson, fetchPrInfo, withStackedPrefix, runPR (from 8)
 *  - leafPhase, epicPhase, prPhase                     (PhaseRunner wrappers)
 */

import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from 'node:child_process';
import {
  PhaseName,
  type RunContext,
  type RunLogger,
  MAX_IMPLEMENTER_SLOTS,
  MAX_WAVE_RETRIES,
  type WaveState,
  type WaveResult,
} from './types.js';
import {
  dispatch,
  spawnCmd,
  DispatchTimeoutError,
  type DispatchOptions,
} from './dispatch.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  bdEscalate,
  bdEnrichmentCheck,
  bdShowJson,
  discoverAgents,
  branchName as deriveBranchName,
  commitMsg,
  prBody,
  stackCreate,
  stackSubmit,
  stackPlan,
  type DependencyEdge,
  type StackPlanResult,
  type MatchedAgent as HelperMatchedAgent,
} from './helpers.js';
import { buildAgentSelectorPrompt, parseAgentSelectorVerdict } from './phases.js';

// =============================================================================
// Configuration defaults (overridable via env)
// =============================================================================

const TIMEOUT_IMPLEMENTER = parseInt(process.env.ORCH_TIMEOUT_IMPLEMENTER ?? '600000', 10);
const TIMEOUT_AUDITOR = parseInt(process.env.ORCH_TIMEOUT_AUDITOR ?? '300000', 10);
const TIMEOUT_BUILD_GUARDIAN = parseInt(process.env.ORCH_TIMEOUT_BUILD_GUARDIAN ?? '600000', 10);
const TIMEOUT_VERIFIER = parseInt(process.env.ORCH_TIMEOUT_VERIFIER ?? '300000', 10);

// =============================================================================
// Types
// =============================================================================

export interface RetryContext {
  concerns: string[];
  attempt: number;
}

export interface ImplementerResult {
  ok: boolean;
  reason?: string;
}

export interface AuditorVerdict {
  agent: string;
  verdict: 'pass' | 'fail' | 'escalate';
  concerns: string[];
  recommendations: string[];
  beadId: string;
}

export interface AuditResult {
  passed: boolean;
  verdicts: AuditorVerdict[];
  concerns: string[];
  warnings: string[];
}

export interface LeafExecutionResult {
  outcome: 'complete' | 'halt';
  reason?: string;
  retryCount: number;
  warnings: string[];
}

export interface EpicExecutionResult {
  outcome: 'complete' | 'escalated';
  wavesCompleted: number;
  beadsCompleted: string[];
  beadsFailed: string[];
  escalatedBeads: string[];
  totalRetries: number;
  warnings: string[];
  /** URLs of the per-level PRs submitted during the wave loop, in submit order. */
  prUrls: string[];
}

/** Result of running one dependency chain to completion (or truncation). */
export interface ChainExecutionResult {
  /** The chain as scheduled (blocker-first bead ids). */
  chain: string[];
  completed: string[];
  failed: string[];
  escalated: string[];
  retries: number;
  warnings: string[];
  prUrls: string[];
}

/**
 * Unified dependency injection interface for all execution phases.
 */
export interface ExecuteDeps {
  spawnFn?: typeof nodeSpawn;
  scriptSpawnFn?: typeof nodeSpawnSync;
  changedFiles?: string[];
  changedFilesForBead?: (beadId: string) => string[];
  timeoutMs?: number;
  retryContext?: RetryContext;
  /**
   * Working directory for spawned agents and git/gt commands. Set by the
   * chain scheduler when a chain runs in its own git worktree (hybrid
   * concurrency model — see git-workflow/stacking.md). Undefined means the
   * main checkout.
   */
  cwd?: string;
  /**
   * Diff base for audit/verification prompts and probes. Defaults to `main`.
   * The chain scheduler sets this to the stack level's parent branch so
   * auditors review only that level's delta.
   */
  diffBase?: string;
  /** Override auditor selection (for testing). */
  selectAuditorsFn?: (
    changedFiles: string[],
    ctx: RunContext,
    deps: ExecuteDeps,
  ) => Promise<HelperMatchedAgent[]>;
}

/**
 * Local context for execution phase runners.
 */
export interface PhaseCtx extends RunContext {
  dryRun: boolean;
  beadId: string;
  prUrl?: string;
  beadsClosed?: string[];
}

/** Return type of every phase runner. */
export type PhaseRunner = (ctx: PhaseCtx, deps?: ExecuteDeps) => Promise<{
  next: PhaseName | 'halt';
  ctx: PhaseCtx;
}>;

// =============================================================================
// PR messages
// =============================================================================

export const PR_MESSAGES = {
  unclosedBead: (beadId: string, status: string) =>
    `UNCLOSED: bead ${beadId} has status "${status}" — expected CLOSED`,
  bdShowFailed: (beadId: string, code: number, stderr: string) =>
    `bd show --json failed for "${beadId}" (exit ${code}): ${stderr.trim()}`,
  prBodyFailed: (code: number, stderr: string) =>
    `prBody helper failed (exit ${code}): ${stderr.trim()}`,
  commitMsgFailed: (code: number, stderr: string) =>
    `commitMsg helper failed (exit ${code}): ${stderr.trim()}`,
  submitFailed: (branch: string, stderr: string) =>
    `gt submit failed for branch "${branch}": ${stderr.trim()}`,
  ghPrViewFailed: (branch: string, code: number, stderr: string) =>
    `gh pr view failed for branch "${branch}" (exit ${code}): ${stderr.trim()}`,
  ghPrEditFailed: (code: number, stderr: string) =>
    `gh pr edit failed (exit ${code}): ${stderr.trim()}`,
  branchDetectFailed: (stderr: string) =>
    `git branch --show-current failed: ${stderr.trim()}`,
} as const;

// =============================================================================
// Private helper types
// =============================================================================

type MatchedAgent = HelperMatchedAgent;

interface BeadJson {
  title?: string;
  description?: string;
  status?: string;
  issue_type?: string;
}

interface BeadReadyEntry {
  id: string;
  issue_type: string;
  status: string;
}

// Note: no beadsFailed field — the per-level build gate knows the
// responsible bead by construction (it is the level under test), so the
// guardian is not asked to attribute failures.
interface BuildGuardianResult {
  verdict: 'pass' | 'fail';
  concerns: string[];
  /** True when the build-guardian response could not be parsed (terminal — do not retry). */
  parseFailed?: boolean;
}

interface InvestigatorResult {
  responsibleBead?: string;
  diagnosis?: string;
  suggestedFix?: string;
}

// =============================================================================
// Private helpers — implementer prompt
// =============================================================================

function buildImplementerPrompt(beadId: string, retryContext?: RetryContext): string {
  const base = `# Implement Bead: ${beadId}

Read your bead for the full task description and implementation context:

\`\`\`bash
bd show ${beadId}
\`\`\`

**IMPORTANT: Check for notes before starting.** The NOTES section must contain
implementation context (files to modify, skills, standards, acceptance criteria).
If the bead has NO notes or no "Implementation Context" section, STOP immediately
and report: "Bead ${beadId} is not enriched. Cannot implement without notes."
Do NOT attempt to research or enrich the bead yourself.

The DESCRIPTION tells you what to build. The NOTES contain your implementation
roadmap. If a spec is referenced, read it for broader context.

Follow TDD. Stay scoped to the files listed.

**Before closing:**

1. Kill any stale vitest processes: \`pkill -f "vitest" 2>/dev/null || true\`
2. Run lint: \`npm run lint\`
3. If the bead notes list specific test files under "Relevant Tests", run those
   targeted tests only (not the full suite):
   \`\`\`bash
   npx vitest run <file1> <file2> --maxThreads=2
   \`\`\`
4. **Commit your work.** Stage only the files this bead was scoped to modify
   (the "Files to Modify" list in your notes), then commit with the bead id
   in the subject:
   \`\`\`bash
   git add <files-from-Files-to-Modify>
   git commit -m "<conventional-prefix>: <short summary> (${beadId})"
   \`\`\`
   Do NOT \`git add -A\` — parallel sibling implementers may have unstaged
   changes on other files; staging them here would attribute their work to
   your commit and break the per-bead verification gate.
5. If lint, targeted tests, and the commit all succeed: \`bd close ${beadId}\`

Do NOT run \`npm test\` or the full test suite — the build-guardian handles that
once per wave after all beads complete. Do NOT close the bead if lint, targeted
tests, or the commit step are failing. If blocked, report back.`;

  if (!retryContext) {
    return base;
  }

  const concernsList = retryContext.concerns.map(c => `- ${c}`).join('\n');
  return `${base}

---

**Previous audit failed with concerns:**

${concernsList}

Please address each concern listed above and re-run the implementation. This is retry attempt ${retryContext.attempt}.`;
}

// =============================================================================
// Private helpers — auditor selection + dispatch
// =============================================================================

/**
 * Build the context string for auditor selection from git.
 * Combines `git diff --stat` and `git log --oneline` for the branch's delta
 * against its diff base (`main`, or the parent stack level for chain levels).
 */
function buildAuditorContext(
  ctx: RunContext,
  deps: { scriptSpawnFn?: typeof nodeSpawnSync; diffBase?: string; cwd?: string },
): string {
  const spawn = deps.scriptSpawnFn ?? nodeSpawnSync;
  const base = deps.diffBase ?? 'main';
  const spawnOpts = {
    encoding: 'buffer' as never,
    shell: true,
    timeout: 30_000,
    ...(deps.cwd !== undefined ? { cwd: deps.cwd } : {}),
  };
  const stat = spawn('git', ['diff', '--stat', `${base}...HEAD`], spawnOpts);
  const log = spawn('git', ['log', '--oneline', `${base}..HEAD`], spawnOpts);

  const statOut = (stat.stdout?.toString('utf-8') ?? '').trim();
  const logOut = (log.stdout?.toString('utf-8') ?? '').trim();

  return [
    `Changed files (\`git diff --stat ${base}...HEAD\`):`,
    '',
    statOut || '_(no changes)_',
    '',
    `Commits in this branch (\`git log --oneline ${base}..HEAD\`):`,
    '',
    logOut || '_(no commits)_',
    '',
    'You may run `git diff <path>` or read individual files for more context.',
  ].join('\n');
}

/**
 * Dispatch the agent-selector subagent to pick auditors for the current
 * branch's changes. Returns the selected auditors or an empty array on
 * malformed/failed dispatch.
 */
async function selectAuditors(
  changedFiles: string[],
  ctx: RunContext,
  deps: ExecuteDeps,
): Promise<MatchedAgent[]> {
  if (changedFiles.length === 0) {
    return [];
  }

  const candidates = discoverAgents('auditor');
  if (candidates.length === 0) return [];

  const context = buildAuditorContext(ctx, deps);
  const prompt = buildAgentSelectorPrompt('auditor', candidates, context);

  try {
    const raw = await dispatch<unknown>({
      agent: 'agent-selector',
      prompt,
      timeoutMs: 120_000,
      ctx,
      logTag: PhaseName.Leaf,
      spawnFn: deps.spawnFn as typeof nodeSpawn,
      cwd: deps.cwd,
    });

    const verdict = parseAgentSelectorVerdict(raw);
    if (!verdict) {
      ctx.logger.appendRunJson({
        event: 'agent_selector_parse_failed',
        phase: PhaseName.Leaf,
        role: 'auditor',
      });
      return [];
    }

    ctx.logger.writePhaseLog(PhaseName.Leaf, 'out',
      JSON.stringify(verdict, null, 2) + '\n');

    const byName = new Map(candidates.map(c => [c.name, c]));
    const matched: MatchedAgent[] = [];
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
      phase: PhaseName.Leaf,
      role: 'auditor',
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

async function dispatchAuditor(
  beadId: string,
  auditor: MatchedAgent,
  ctx: RunContext,
  deps: { spawnFn?: typeof nodeSpawn; diffBase?: string; cwd?: string },
): Promise<AuditorVerdict> {
  const base = deps.diffBase ?? 'main';
  const prompt = `# Audit changes for bead: ${beadId}

You are the ${auditor.name} running in post-code mode. Review the
changes landed on the current branch:

\`\`\`bash
git diff ${base}...HEAD
\`\`\`

Apply your normal audit process. Emit one of the \`review-mode-auditor\`
verdicts (PASS / PASS WITH WARNINGS / FAIL) per
\`.claude/skills/review-mode-auditor/SKILL.md\`.`;

  try {
    const raw = await dispatch<unknown>({
      agent: auditor.name,
      prompt,
      timeoutMs: TIMEOUT_AUDITOR,
      ctx,
      logTag: PhaseName.Leaf,
      spawnFn: deps.spawnFn as typeof nodeSpawn,
      cwd: deps.cwd,
    });

    // dispatch returns raw string when no schemaPath; parse it ourselves
    if (typeof raw === 'string') {
      return JSON.parse(raw) as AuditorVerdict;
    }
    return raw as AuditorVerdict;
  }
  catch {
    return {
      agent: auditor.name,
      verdict: 'escalate',
      concerns: [`Auditor ${auditor.name} dispatch failed`],
      recommendations: [],
      beadId,
    };
  }
}

// =============================================================================
// Private helpers — epic wave internals
// =============================================================================

function filterEnrichedBeads(
  beadIds: string[],
  ctx: RunContext,
  deps: ExecuteDeps,
): string[] {
  return beadIds.filter(beadId => {
    const enriched = bdEnrichmentCheck(beadId, { spawnFn: deps.scriptSpawnFn });

    ctx.logger.appendRunJson({
      event: 'enrichment-check',
      phase: PhaseName.Epic,
      beadId,
      enriched,
    });

    return enriched;
  });
}

/**
 * Query the currently-ready descendant beads of an epic via
 * `bd ready --parent <epic> --json`.
 *
 * In chain scheduling this remains the source of CROSS-CHAIN unblocking
 * (e.g. a chain head that was blocked by a bead outside its own chain), but
 * scheduling filters the result to chain HEADS only — mid-chain beads are
 * owned by their chain runner and must never be re-injected as standalone
 * wave entries.
 */
function findReadyBeadIds(
  epicId: string,
  ctx: RunContext,
  deps: ExecuteDeps,
): Set<string> {
  const spawnSync = deps.scriptSpawnFn ?? nodeSpawnSync;

  // Scope ready-set to descendants of the current epic; without --parent, bd
  // ready returns every globally-ready bead and unrelated work gets pulled
  // into the wave.
  const result = spawnSync('bd', ['ready', '--parent', epicId, '--json'], {
    encoding: 'buffer' as never,
    shell: true,
    timeout: 30_000,
  });

  const stdout = result.stdout?.toString('utf-8') ?? '';
  const exitCode = result.status ?? 1;

  if (exitCode !== 0 || !stdout.trim()) {
    return new Set();
  }

  try {
    const beads = JSON.parse(stdout) as BeadReadyEntry[];
    ctx.logger.appendRunJson({
      event: 'cascade-ready-check',
      phase: PhaseName.Epic,
      readyCount: beads.length,
    });
    return new Set(beads.map(b => b.id));
  }
  catch {
    ctx.logger.writePhaseLog(PhaseName.Epic, 'err',
      `Failed to parse bd ready output: ${stdout}\n`);
    return new Set();
  }
}

/**
 * Gather an epic's full child set and the blocks-edges among them, then plan
 * dependency-chain stacks via the pure `stackPlan` helper.
 *
 * `bd ready --parent` is NOT sufficient here: it returns only UNBLOCKED
 * children, but chain planning needs the full sibling set including
 * mid-chain (currently blocked) beads. Children already closed are excluded;
 * dropping a closed blocker's edge correctly promotes its dependent to a
 * chain head. Returns null when the epic has no open children (or bd fails).
 */
export function gatherStackPlan(
  epicId: string,
  ctx: RunContext,
  deps: ExecuteDeps,
): StackPlanResult | null {
  const spawnDeps = { spawnFn: deps.scriptSpawnFn };
  const epic = bdShowJson(epicId, spawnDeps);
  if (!epic) return null;

  const childIds = (epic.children ?? [])
    .map(c => c?.id)
    .filter((id): id is string => typeof id === 'string');

  const openChildren: string[] = [];
  const edges: DependencyEdge[] = [];

  for (const childId of childIds) {
    const child = bdShowJson(childId, spawnDeps);
    if (!child) continue;
    const status = (child.status ?? '').toLowerCase();
    if (status.includes('closed') || status.includes('done')) continue;

    openChildren.push(childId);
    for (const dep of child.dependencies ?? []) {
      // Only blocks-edges participate; stackPlan additionally drops edges
      // pointing outside the sibling set (e.g. cross-epic blockers).
      if (dep.dependency_type === 'blocks' && typeof dep.id === 'string') {
        edges.push({ blocker: dep.id, blocked: childId, dependencyType: 'blocks' });
      }
    }
  }

  if (openChildren.length === 0) return null;

  const plan = stackPlan(openChildren, edges);

  ctx.logger.appendRunJson({
    event: 'stack-plan',
    phase: PhaseName.Epic,
    epicId,
    chains: plan.chains,
    flat: plan.flat,
    warnings: plan.warnings,
  });

  return plan;
}

function escalateBead(
  beadId: string,
  reason: string,
  ctx: RunContext,
  deps: ExecuteDeps,
): void {
  try {
    bdEscalate(beadId, reason, '7', { spawnFn: deps.scriptSpawnFn });
  }
  catch (err) {
    ctx.logger.writePhaseLog(PhaseName.Epic, 'err',
      `bd-escalate failed for ${beadId}: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  ctx.logger.appendRunJson({
    event: 'bead-escalated',
    phase: PhaseName.Epic,
    beadId,
    reason,
  });
}

// =============================================================================
// Private helpers — chain verification (epic)
// =============================================================================

function buildVerifierPrompt(
  epicId: string,
  waveNumber: number,
  beadIds: string[],
  kind: 'integration' | 'architecture',
  diffBase = 'main',
): string {
  if (kind === 'integration') {
    return `# Cross-bead integration verification

Epic: ${epicId}, Wave: ${waveNumber}
Beads in this chain: ${beadIds.join(', ')}

Review the combined changes from all beads in this chain:

\`\`\`bash
git diff ${diffBase}...HEAD
\`\`\`

Look for conflicts, duplications, and inconsistencies between the beads'
changes that per-bead auditors miss because each bead was verified in isolation.`;
  }

  return `# Architecture auditor (light pass)

Epic: ${epicId}, Wave: ${waveNumber}
Beads in this chain: ${beadIds.join(', ')}

Review the chain's combined changes for vision drift, decision violations,
and conceptual fragmentation:

\`\`\`bash
git diff ${diffBase}...HEAD
\`\`\`

Read product docs (mission.md, decisions.md, roadmap.md) and flag any issues.`;
}

async function dispatchVerifier(
  agentName: string,
  prompt: string,
  ctx: RunContext,
  deps: ExecuteDeps,
): Promise<unknown> {
  try {
    const raw = await dispatch({
      agent: agentName,
      prompt,
      timeoutMs: TIMEOUT_VERIFIER,
      ctx,
      logTag: PhaseName.Epic,
      spawnFn: deps.spawnFn as typeof nodeSpawn,
      cwd: deps.cwd,
    });
    // dispatch returns raw string when no schemaPath; parse it ourselves
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return raw; }
    }
    return raw;
  }
  catch (err) {
    ctx.logger.writePhaseLog(PhaseName.Epic, 'err',
      `${agentName} dispatch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
}

/**
 * Extract the final fenced JSON block from a markdown response.
 *
 * The build-guardian agent emits a free-form markdown report and is asked to
 * close with a fenced ```json``` block carrying the structured verdict. Some
 * agents drift from the schema; this helper scans for the *last* fenced JSON
 * block (or the last bare `{...}` block as a fallback) and tries to parse it.
 *
 * Returns `null` when no parseable block is found.
 */
export function extractFinalJsonBlock(text: string): unknown | null {
  // Prefer the last ```json fenced block.
  const fencedRegex = /```json\s*([\s\S]*?)```/gi;
  let lastFenced: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = fencedRegex.exec(text)) !== null) {
    lastFenced = m[1];
  }
  if (lastFenced) {
    try { return JSON.parse(lastFenced.trim()); }
    catch { /* fall through to bare-object fallback */ }
  }

  // Fallback: last balanced top-level `{...}` block in the text.
  let depth = 0;
  let start = -1;
  let lastObject: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        lastObject = text.slice(start, i + 1);
        start = -1;
      }
    }
  }
  if (lastObject) {
    try { return JSON.parse(lastObject); }
    catch { /* unparseable */ }
  }
  return null;
}

async function dispatchBuildGuardian(
  epicId: string,
  waveNumber: number,
  ctx: RunContext,
  deps: ExecuteDeps,
  level?: { beadId: string; branch: string },
): Promise<BuildGuardianResult> {
  const levelContext = level
    ? `\nStack level: branch \`${level.branch}\` (bead ${level.beadId}), validated at its stack position.`
    : '';
  const prompt = `# Build Guardian — Wave ${waveNumber}

Epic: ${epicId}${levelContext}

Run the full sequential verification suite:

\`\`\`bash
pkill -f "vitest" 2>/dev/null || true
npm run lint
npx vitest run --maxThreads=2
npm run build
\`\`\`

After running the suite, write your prose report, then close your output with
a fenced JSON block containing the structured verdict. The orchestrator parses
this block — without it, the run cannot continue.

\`\`\`json
{
  "verdict": "pass" | "fail",
  "concerns": ["short error description", "..."]
}
\`\`\`

\`verdict\` is "pass" only when lint, tests, and build all succeed. \`concerns\`
should list each failing check (one entry per failure) with file paths and
test names where available. No failure attribution is needed — the gate runs
per stack level, so the responsible bead is known by construction.`;

  let raw: unknown;
  try {
    raw = await dispatch({
      agent: 'build-guardian',
      prompt,
      timeoutMs: TIMEOUT_BUILD_GUARDIAN,
      ctx,
      logTag: PhaseName.Epic,
      spawnFn: deps.spawnFn as typeof nodeSpawn,
      cwd: deps.cwd,
    });
  }
  catch (err) {
    ctx.logger.writePhaseLog(PhaseName.Epic, 'err',
      `build-guardian dispatch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return {
      verdict: 'fail',
      concerns: [`build-guardian dispatch error: ${err instanceof Error ? err.message : String(err)}`],
      parseFailed: true,
    };
  }

  // dispatch() returns the parsed object directly when --json-schema was used.
  // Build-guardian dispatches without a schema, so `raw` is the markdown
  // string. Extract the structured verdict from the fenced JSON tail.
  let result: WaveResult | null = null;
  if (typeof raw !== 'string') {
    result = raw as WaveResult;
  }
  else {
    const extracted = extractFinalJsonBlock(raw);
    if (extracted && typeof extracted === 'object') {
      result = extracted as WaveResult;
    }
  }

  if (!result) {
    const tail = typeof raw === 'string' ? raw.slice(-300).replace(/\s+/g, ' ').trim() : '';
    const reason = `build-guardian output missing parseable JSON envelope${tail ? ` (tail: ${tail})` : ''}`;
    ctx.logger.writePhaseLog(PhaseName.Epic, 'err', `${reason}\n`);
    return {
      verdict: 'fail',
      concerns: [reason],
      parseFailed: true,
    };
  }

  return {
    verdict: result.verdict === 'pass' ? 'pass' : 'fail',
    concerns: result.concerns ?? [],
  };
}

async function dispatchTestFailureInvestigator(
  epicId: string,
  waveNumber: number,
  concerns: string[],
  ctx: RunContext,
  deps: ExecuteDeps,
): Promise<InvestigatorResult> {
  const prompt = `# Test Failure Investigation

Epic: ${epicId}, Wave: ${waveNumber}

Build-guardian reported the following failures:
${concerns.map(c => `- ${c}`).join('\n')}

Investigate the failures using:

\`\`\`bash
git log --oneline ${deps.diffBase ?? 'main'}...HEAD
git diff ${deps.diffBase ?? 'main'}...HEAD
\`\`\`

Identify which bead's commit is responsible and suggest a fix.`;

  try {
    const raw = await dispatch({
      agent: 'test-failure-investigator',
      prompt,
      timeoutMs: TIMEOUT_VERIFIER,
      ctx,
      logTag: PhaseName.Epic,
      spawnFn: deps.spawnFn as typeof nodeSpawn,
      cwd: deps.cwd,
    });
    // dispatch returns raw string when no schemaPath; parse it ourselves
    if (typeof raw === 'string') {
      try { return JSON.parse(raw) as InvestigatorResult; } catch { return {}; }
    }
    return raw as InvestigatorResult;
  }
  catch {
    return {};
  }
}

/**
 * Per-level build gate: build-guardian runs once per STACK LEVEL, on that
 * branch at its stack position, BEFORE that level's `gt submit`
 * (independently-green invariant — see git-workflow/stacking.md).
 *
 * On failure the responsible bead is known by construction (it is this
 * level), so the test-failure-investigator is dispatched for diagnosis and
 * the level's implementer retries with the concerns, up to MAX_WAVE_RETRIES.
 * Parse failures are terminal — there is no verdict to retry against.
 */
async function runLevelBuildGate(
  epicId: string,
  waveNumber: number,
  beadId: string,
  branch: string,
  ctx: RunContext,
  deps: ExecuteDeps,
): Promise<{ ok: boolean; reason?: string; retries: number }> {
  let retries = 0;

  for (let attempt = 0; attempt <= MAX_WAVE_RETRIES; attempt++) {
    const buildResult = await dispatchBuildGuardian(
      epicId, waveNumber, ctx, deps, { beadId, branch },
    );

    if (buildResult.verdict === 'pass') {
      return { ok: true, retries };
    }

    ctx.logger.appendRunJson({
      event: 'build-guardian-fail',
      phase: PhaseName.Epic,
      epicId,
      waveNumber,
      beadId,
      branch,
      attempt: attempt + 1,
      concerns: buildResult.concerns,
      parseFailed: buildResult.parseFailed ?? false,
    });

    // Parse failures are terminal: retrying without a verdict just loops.
    if (buildResult.parseFailed) {
      return {
        ok: false,
        reason: 'Build-guardian output unparseable; manual investigation required',
        retries,
      };
    }

    if (attempt < MAX_WAVE_RETRIES) {
      // Diagnosis only — the responsible bead is this level by construction.
      await dispatchTestFailureInvestigator(
        epicId, waveNumber, buildResult.concerns, ctx, deps,
      );

      retries++;
      await dispatchImplementer(beadId, ctx, {
        ...deps,
        retryContext: {
          concerns: buildResult.concerns,
          attempt: attempt + 2,
        },
      });

      const changedFiles = deps.changedFilesForBead?.(beadId) ?? [];
      await runAudit(beadId, ctx, { ...deps, changedFiles });

      continue;
    }

    return {
      ok: false,
      reason: `Build-guardian failed after ${MAX_WAVE_RETRIES} retries`,
      retries,
    };
  }

  // Defensive fallback
  return { ok: false, reason: 'build gate exhausted', retries };
}

// =============================================================================
// Private helpers — leaf escalation
// =============================================================================

function escalateLeaf(
  beadId: string,
  ctx: RunContext,
  deps: ExecuteDeps,
  reason: string,
  retryCount: number,
): LeafExecutionResult {
  try {
    bdEscalate(beadId, reason, '7', { spawnFn: deps.scriptSpawnFn });
  }
  catch (err) {
    ctx.logger.writePhaseLog(PhaseName.Leaf, 'err',
      `bd-escalate failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  ctx.logger.appendRunJson({
    event: 'leaf-escalated',
    phase: PhaseName.Leaf,
    beadId,
    reason,
    retryCount,
  });

  return {
    outcome: 'halt',
    reason: `implementation retry exhausted: ${reason}`,
    retryCount,
    warnings: [],
  };
}

// =============================================================================
// Exported: dispatchImplementer
// =============================================================================

/**
 * Dispatch a single implementer subagent for the given bead.
 *
 * Refuses to dispatch when `beadId` is empty, undefined, or the literal
 * string `"undefined"` (the JS-toString fingerprint of a variable that
 * was never set). Without this guard, upstream attribution failures
 * (e.g. test-failure-investigator returning no responsibleBead) would
 * spawn an implementer with the prompt "Implement Bead: undefined" and
 * the orchestrator would loop on it indefinitely.
 */
export async function dispatchImplementer(
  beadId: string,
  ctx: RunContext,
  deps: ExecuteDeps = {},
): Promise<ImplementerResult> {
  if (!beadId || beadId === 'undefined' || beadId === 'null') {
    const reason = `refused to dispatch implementer with empty/undefined bead id (got ${JSON.stringify(beadId)})`;
    ctx.logger.appendRunJson({
      event: 'implementer-dispatch-refused',
      phase: PhaseName.Leaf,
      reason,
    });
    return { ok: false, reason };
  }

  const prompt = buildImplementerPrompt(beadId, deps.retryContext);
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_IMPLEMENTER;

  try {
    await dispatch({
      agent: 'implementer',
      prompt,
      timeoutMs,
      ctx,
      logTag: PhaseName.Leaf,
      spawnFn: deps.spawnFn as typeof nodeSpawn,
      cwd: deps.cwd,
    });
    return { ok: true };
  }
  catch (err) {
    if (err instanceof DispatchTimeoutError) {
      return { ok: false, reason: `Implementer timed out after ${timeoutMs}ms` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg };
  }
}

// =============================================================================
// Exported: verifyImplementerCompletion
// =============================================================================

/**
 * Verification result returned by `verifyImplementerCompletion`.
 *
 * On success, `changedFiles` is the authoritative list derived from
 * `git diff --name-only <base>...HEAD` — callers must use this in place
 * of any stale `deps.changedFiles`.
 */
export type VerificationResult =
  | { passed: true; changedFiles: string[] }
  | { passed: false; reason: string };

/**
 * Extract the "Files to Modify" path list from a bead's notes.
 *
 * Used by the verification gate in wave mode to scope the dirty-tree check
 * to files the bead was supposed to touch. In a parallel-implementer wave,
 * an unscoped check sees every sibling's pending edit as foreign noise and
 * fails every bead in the wave.
 *
 * Parses `bd show <id> --json` output for the `## Files to Modify` block
 * and pulls backticked paths from each bullet. Returns `[]` for verification-
 * only beads (notes contain `- None`) or when the bead has no notes / parse
 * fails — the caller falls back to the unscoped whole-tree check.
 */
export function extractExpectedFiles(
  beadId: string,
  deps: ExecuteDeps,
): string[] {
  const spawnSync = deps.scriptSpawnFn ?? nodeSpawnSync;
  const result = spawnSync('bd', ['show', beadId, '--json'], {
    encoding: 'buffer' as never,
    shell: false,
    timeout: 10_000,
  });
  if (result.status !== 0) {
    return [];
  }

  let notes: string;
  try {
    const parsed = JSON.parse(result.stdout?.toString('utf-8') ?? '[]') as Array<{ notes?: string }>;
    notes = parsed[0]?.notes ?? '';
  }
  catch {
    return [];
  }

  // Locate `## Files to Modify` heading and grab bullet block until next heading.
  const match = notes.match(/##\s*Files to Modify\s*\n([\s\S]*?)(?:\n##\s|\n#\s|$)/);
  if (!match) {
    return [];
  }

  const block = match[1];
  // "None" or "- None" sentinel for verification-only beads.
  if (/^\s*-?\s*None\b/im.test(block.trim().split('\n')[0] ?? '')) {
    return [];
  }

  const files: string[] = [];
  for (const line of block.split('\n')) {
    // Bullet starting with `-` followed by a backticked path; ignore "Reason:" sub-lines.
    const m = line.match(/^\s*-\s*`([^`]+)`/);
    if (m) files.push(m[1]);
  }
  return files;
}

/**
 * Verify that the implementer subagent actually committed its work.
 *
 * Runs after a successful `dispatchImplementer`, before `runAudit`. Catches
 * the failure mode where an implementer declares success (and may even have
 * called `bd close`) but never committed — producing an empty branch that
 * silently passes through audit and fails at `gh pr create`.
 *
 * Checks, in order:
 *   1. Working tree is clean (`git status --porcelain` returns empty).
 *   2. Branch has commits ahead of base (`git rev-list --count base..HEAD > 0`).
 *   3. Computes authoritative `changedFiles` via `git diff --name-only base...HEAD`.
 *
 * When `expectedFiles` is provided (wave mode), the dirty-tree check is
 * scoped to those paths via `git status --porcelain -- <files>`. This
 * prevents one bead from failing because a parallel sibling left
 * uncommitted edits on a file outside this bead's scope.
 *
 * Base branch defaults to `main`; override via `GIT_SAFE_MAIN_BRANCH` env var
 * (consistent with preflight checks in `helpers.ts`) or the `baseBranch`
 * parameter — the chain scheduler passes the level's parent branch so the
 * gate measures only that level's delta.
 */
export function verifyImplementerCompletion(
  ctx: RunContext,
  deps: ExecuteDeps,
  expectedFiles?: string[],
  baseBranchOverride?: string,
): VerificationResult {
  const spawnFn = deps.scriptSpawnFn ?? nodeSpawnSync;
  const baseBranch = baseBranchOverride ?? process.env.GIT_SAFE_MAIN_BRANCH ?? 'main';
  const spawnOpts = {
    encoding: 'buffer' as never,
    shell: false,
    timeout: 10_000,
    ...(deps.cwd !== undefined ? { cwd: deps.cwd } : {}),
  };

  const statusArgs = ['status', '--porcelain'];
  if (expectedFiles && expectedFiles.length > 0) {
    statusArgs.push('--', ...expectedFiles);
  }
  const statusResult = spawnFn('git', statusArgs, spawnOpts);
  if (statusResult.status !== 0 || statusResult.error) {
    const stderrSnippet = (statusResult.stderr?.toString('utf-8') ?? '').trim()
      || statusResult.error?.message
      || `exit ${statusResult.status}`;
    const reason = `git status --porcelain failed: ${stderrSnippet}`;
    ctx.logger.appendRunJson({
      event: 'implementer-verification-failed',
      phase: PhaseName.Leaf,
      beadId: ctx.beadId,
      reason,
    });
    return { passed: false, reason };
  }
  const statusOutput = (statusResult.stdout?.toString('utf-8') ?? '').trim();
  if (statusOutput !== '') {
    const firstLine = statusOutput.split('\n')[0].trim();
    const reason = `uncommitted or untracked changes present: ${firstLine}`;
    ctx.logger.appendRunJson({
      event: 'implementer-verification-failed',
      phase: PhaseName.Leaf,
      beadId: ctx.beadId,
      reason,
    });
    return { passed: false, reason };
  }

  const revResult = spawnFn('git', ['rev-list', '--count', `${baseBranch}..HEAD`], spawnOpts);
  if (revResult.status !== 0 || revResult.error) {
    const stderrSnippet = (revResult.stderr?.toString('utf-8') ?? '').trim()
      || revResult.error?.message
      || `exit ${revResult.status}`;
    const reason = `git rev-list --count failed: ${stderrSnippet}`;
    ctx.logger.appendRunJson({
      event: 'implementer-verification-failed',
      phase: PhaseName.Leaf,
      beadId: ctx.beadId,
      reason,
    });
    return { passed: false, reason };
  }
  const revCount = (revResult.stdout?.toString('utf-8') ?? '').trim();
  const revCountNum = Number(revCount);
  if (!Number.isFinite(revCountNum) || revCountNum <= 0) {
    const reason = `no commits on branch ahead of ${baseBranch}`;
    ctx.logger.appendRunJson({
      event: 'implementer-verification-failed',
      phase: PhaseName.Leaf,
      beadId: ctx.beadId,
      reason,
    });
    return { passed: false, reason };
  }

  const diffResult = spawnFn('git', ['diff', '--name-only', `${baseBranch}...HEAD`], spawnOpts);
  if (diffResult.status !== 0 || diffResult.error) {
    const stderrSnippet = (diffResult.stderr?.toString('utf-8') ?? '').trim()
      || diffResult.error?.message
      || `exit ${diffResult.status}`;
    const reason = `git diff --name-only failed: ${stderrSnippet}`;
    ctx.logger.appendRunJson({
      event: 'implementer-verification-failed',
      phase: PhaseName.Leaf,
      beadId: ctx.beadId,
      reason,
    });
    return { passed: false, reason };
  }
  const diffOutput = (diffResult.stdout?.toString('utf-8') ?? '').trim();
  const changedFiles = diffOutput === '' ? [] : diffOutput.split('\n');

  ctx.logger.appendRunJson({
    event: 'implementer-verification-passed',
    phase: PhaseName.Leaf,
    beadId: ctx.beadId,
    changedFilesCount: changedFiles.length,
  });

  return { passed: true, changedFiles };
}

/**
 * Reset a bead's status to `in_progress`.
 *
 * Used when the implementer subagent closed its own bead prematurely
 * (e.g., before committing), so that retry or escalation finds an
 * accurate bead state rather than a falsely-closed one.
 *
 * Idempotent — safe to call regardless of current bead status. Failures
 * of the `bd` command itself are logged but never throw: we don't want
 * to block an escalation path because a beads CLI call hiccupped.
 */
export function reopenBead(
  beadId: string,
  ctx: RunContext,
  deps: ExecuteDeps,
  reasonTag: string,
): void {
  const spawnFn = deps.scriptSpawnFn ?? nodeSpawnSync;
  const result = spawnFn('bd', ['update', beadId, '--status=in_progress'], {
    encoding: 'buffer' as never,
    shell: false,
    timeout: 10_000,
  });
  const success = result.status === 0;
  ctx.logger.appendRunJson({
    event: 'bead-reopened',
    beadId,
    reason: reasonTag,
    success,
  });
}

// =============================================================================
// Exported: runAudit
// =============================================================================

/**
 * Run per-bead auditors selected by the agent-selector subagent.
 *
 * Empty selection is treated as a failed audit (not a silent skip): the
 * selector returns empty only when dispatch failed, output was malformed,
 * or it genuinely could not identify any applicable auditor — none of
 * which should let the bead advance without review.
 */
export async function runAudit(
  beadId: string,
  ctx: RunContext,
  deps: ExecuteDeps = {},
): Promise<AuditResult> {
  const changedFiles = deps.changedFiles ?? [];
  const spawnFn = deps.spawnFn ?? nodeSpawn;

  // No changes at all -> nothing to audit, pass through.
  if (changedFiles.length === 0) {
    ctx.logger.appendRunJson({
      event: 'audit-skip',
      phase: PhaseName.Leaf,
      reason: 'no changed files to audit',
    });
    return { passed: true, verdicts: [], concerns: [], warnings: [] };
  }

  const matchedAuditors = deps.selectAuditorsFn
    ? await deps.selectAuditorsFn(changedFiles, ctx, deps)
    : await selectAuditors(changedFiles, ctx, deps);

  // Changes present but selector produced no auditors -> fail (do not silently
  // pass). The caller's retry/escalate logic takes over from here.
  if (matchedAuditors.length === 0) {
    const reason = 'agent-selector returned empty auditor selection';
    ctx.logger.appendRunJson({
      event: 'audit-empty-selection',
      phase: PhaseName.Leaf,
      reason,
    });
    return {
      passed: false,
      verdicts: [],
      concerns: [reason],
      warnings: [],
    };
  }

  const verdictPromises = matchedAuditors.map(auditor =>
    dispatchAuditor(beadId, auditor, ctx, { spawnFn, diffBase: deps.diffBase, cwd: deps.cwd }),
  );

  const verdicts = await Promise.all(verdictPromises);

  const concerns: string[] = [];
  const warnings: string[] = [];
  let passed = true;

  for (const v of verdicts) {
    if (v.verdict === 'fail' || v.verdict === 'escalate') {
      passed = false;
      concerns.push(...v.concerns);
    }
    if (v.verdict === 'pass' && v.recommendations.length > 0) {
      warnings.push(...v.recommendations);
    }
  }

  ctx.logger.appendRunJson({
    event: 'audit-complete',
    phase: PhaseName.Leaf,
    auditorCount: matchedAuditors.length,
    passed,
    failedAuditors: verdicts.filter(v => v.verdict !== 'pass').map(v => v.agent),
  });

  return { passed, verdicts, concerns, warnings };
}

// =============================================================================
// Exported: runLeafExecution
// =============================================================================

/**
 * Execute the full Branch B flow for a single leaf bead:
 *   Implementer -> Auditors -> (retry once on failure) -> Escalate or Complete
 */
export async function runLeafExecution(
  beadId: string,
  ctx: RunContext,
  deps: ExecuteDeps = {},
): Promise<LeafExecutionResult> {
  const warnings: string[] = [];

  // --- Attempt 1: Implementer ---
  const implResult = await dispatchImplementer(beadId, ctx, deps);

  if (!implResult.ok) {
    // Retry implementer once
    const retryResult = await retryAfterFailure(beadId, ctx, deps, implResult.reason ?? 'implementer failure');
    if (retryResult) return retryResult;
    return escalateLeaf(beadId, ctx, deps, `implementer failure: ${implResult.reason}`, 1);
  }

  // --- Attempt 1: Verification gate ---
  const gate1 = verifyImplementerCompletion(ctx, deps);
  if (!gate1.passed) {
    reopenBead(beadId, ctx, deps, 'verification-gate-retry');
    const retryResult = await retryAfterVerificationFailure(beadId, ctx, deps, gate1.reason);
    if (retryResult) return retryResult;
    reopenBead(beadId, ctx, deps, 'verification-gate-escalate');
    return escalateLeaf(beadId, ctx, deps, `verification gate exhausted: ${gate1.reason}`, 1);
  }

  // --- Attempt 1: Auditors (with gate-authoritative changedFiles) ---
  const auditDeps: ExecuteDeps = { ...deps, changedFiles: gate1.changedFiles };
  const auditResult = await runAudit(beadId, ctx, auditDeps);
  warnings.push(...auditResult.warnings);

  if (auditResult.passed) {
    return { outcome: 'complete', retryCount: 0, warnings };
  }

  // --- Retry: re-dispatch implementer with audit concerns ---
  const retryImplResult = await dispatchImplementer(beadId, ctx, {
    ...deps,
    retryContext: { concerns: auditResult.concerns, attempt: 2 },
  });

  if (!retryImplResult.ok) {
    return escalateLeaf(beadId, ctx, deps, `retry implementer failure: ${retryImplResult.reason}`, 1);
  }

  // --- Retry: Verification gate (second pass) ---
  const gate2 = verifyImplementerCompletion(ctx, deps);
  if (!gate2.passed) {
    reopenBead(beadId, ctx, deps, 'verification-gate-escalate');
    return escalateLeaf(beadId, ctx, deps, `verification gate exhausted after retry: ${gate2.reason}`, 1);
  }

  // --- Retry: re-run auditors (with fresh changedFiles) ---
  const retryAuditDeps: ExecuteDeps = { ...deps, changedFiles: gate2.changedFiles };
  const retryAuditResult = await runAudit(beadId, ctx, retryAuditDeps);
  warnings.push(...retryAuditResult.warnings);

  if (retryAuditResult.passed) {
    return { outcome: 'complete', retryCount: 1, warnings };
  }

  return escalateLeaf(
    beadId, ctx, deps,
    `audit retry exhausted: ${retryAuditResult.concerns.join('; ')}`,
    1,
  );
}

/**
 * Attempt a retry after an implementer failure.
 */
async function retryAfterFailure(
  beadId: string,
  ctx: RunContext,
  deps: ExecuteDeps,
  failureReason: string,
): Promise<LeafExecutionResult | null> {
  const retryResult = await dispatchImplementer(beadId, ctx, {
    ...deps,
    retryContext: { concerns: [failureReason], attempt: 2 },
  });

  if (!retryResult.ok) {
    return null;
  }

  const auditResult = await runAudit(beadId, ctx, deps);
  if (auditResult.passed) {
    return { outcome: 'complete', retryCount: 1, warnings: auditResult.warnings };
  }

  return null;
}

/**
 * Attempt a retry after a verification-gate failure.
 *
 * Mirrors `retryAfterFailure` but scoped to the gate-trip case:
 * the implementer declared success but git state refuted it.
 * Feeds a specific correction into `retryContext.concerns`.
 */
async function retryAfterVerificationFailure(
  beadId: string,
  ctx: RunContext,
  deps: ExecuteDeps,
  reason: string,
): Promise<LeafExecutionResult | null> {
  const concern = `Verification failed: ${reason}. You must commit ALL changes (including new/untracked files) to the current branch before declaring completion. Do not call 'bd close' until the commit exists on the branch.`;

  const retryImplResult = await dispatchImplementer(beadId, ctx, {
    ...deps,
    retryContext: { concerns: [concern], attempt: 2 },
  });

  if (!retryImplResult.ok) {
    return null;
  }

  const gateRetry = verifyImplementerCompletion(ctx, deps);
  if (!gateRetry.passed) {
    return null;
  }

  const auditDeps: ExecuteDeps = { ...deps, changedFiles: gateRetry.changedFiles };
  const auditResult = await runAudit(beadId, ctx, auditDeps);
  if (auditResult.passed) {
    return { outcome: 'complete', retryCount: 1, warnings: auditResult.warnings };
  }

  return null;
}

// =============================================================================
// Exported: runWithConcurrencyCap
// =============================================================================

/**
 * Run async tasks in parallel with a hard concurrency cap.
 * Returns results in the same order as the input tasks array.
 */
export async function runWithConcurrencyCap<T>(
  tasks: (() => Promise<T>)[],
  cap: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from(
    { length: Math.min(cap, tasks.length) },
    () => runNext(),
  );

  await Promise.all(workers);
  return results;
}

// =============================================================================
// Private helpers — chain worktree lifecycle (hybrid concurrency model)
// =============================================================================
//
// Per-bead stack branches mean parallel chains can no longer share one
// checkout (gt create checks out the new branch, yanking HEAD out from under
// a sibling). Hybrid model: the FIRST chain of a wave runs in the main
// checkout (the common single-chain case pays no worktree overhead); each
// ADDITIONAL concurrent chain gets its own git worktree, with agents and
// git/gt commands dispatched at that cwd (gt-in-worktrees is the permanent
// mode — see git-workflow/stacking.md). The orchestrator owns the worktree
// lifecycle: create before the chain starts, remove when it finishes.

interface ChainWorktree {
  path: string;
  /** Throwaway checkout branch the worktree starts on; never a stack level. */
  worktreeBranch: string;
}

function createChainWorktree(
  waveNumber: number,
  chainIndex: number,
  ctx: RunContext,
  deps: ExecuteDeps,
): ChainWorktree | null {
  const spawnFn = deps.scriptSpawnFn ?? nodeSpawnSync;
  const base = process.env.GIT_SAFE_MAIN_BRANCH ?? 'main';
  const slug = `orch-wt-${ctx.runId}-w${waveNumber}-c${chainIndex}`;
  const path = join(tmpdir(), slug);

  // The auto-created branch is only the worktree's initial checkout; chain
  // levels are created directly on their parent via `gt create --onto`.
  const result = spawnCmd(
    'git', ['worktree', 'add', '-b', slug, path, base],
    ctx.logger, PhaseName.Epic, spawnFn,
  );

  const ok = result.exitCode === 0;
  ctx.logger.appendRunJson({
    event: ok ? 'chain-worktree-created' : 'chain-worktree-create-failed',
    phase: PhaseName.Epic,
    waveNumber,
    chainIndex,
    path,
    ...(ok ? {} : { stderr: result.stderr }),
  });

  return ok ? { path, worktreeBranch: slug } : null;
}

function removeChainWorktree(
  worktree: ChainWorktree,
  ctx: RunContext,
  deps: ExecuteDeps,
): void {
  const spawnFn = deps.scriptSpawnFn ?? nodeSpawnSync;
  const removeResult = spawnCmd(
    'git', ['worktree', 'remove', '--force', worktree.path],
    ctx.logger, PhaseName.Epic, spawnFn,
  );
  // Drop the throwaway checkout branch too (it has no commits of its own).
  spawnCmd(
    'git', ['branch', '-D', worktree.worktreeBranch],
    ctx.logger, PhaseName.Epic, spawnFn,
  );
  ctx.logger.appendRunJson({
    event: 'chain-worktree-removed',
    phase: PhaseName.Epic,
    path: worktree.path,
    success: removeResult.exitCode === 0,
  });
}

// =============================================================================
// Private helpers — chain execution
// =============================================================================

interface ChainLevelOutcome {
  ok: boolean;
  reason?: string;
  branch?: string;
  prUrl?: string;
  prNumber?: number;
  retries: number;
  warnings: string[];
}

/**
 * Execute one stack level of a chain:
 *
 *   stackCreate(branch, parent) → implementer → verification gate (base =
 *   parent) → per-bead audit (one retry) → per-level build-guardian gate →
 *   stackSubmit → gh pr edit (canonical title/body, "Stacked on #N." for
 *   upstack levels).
 *
 * The build gate runs BEFORE submit — no level is pushed until it is green
 * at its own stack position.
 */
async function runChainLevel(
  epicId: string,
  waveNumber: number,
  beadId: string,
  parentBranch: string,
  parentPrNumber: number | null,
  ctx: RunContext,
  deps: ExecuteDeps,
): Promise<ChainLevelOutcome> {
  const warnings: string[] = [];
  let retries = 0;
  const scriptSpawnFn = deps.scriptSpawnFn ?? nodeSpawnSync;
  const spawnDeps = { spawnFn: deps.scriptSpawnFn, cwd: deps.cwd };
  const beadCtx: RunContext = { ...ctx, beadId };
  // Audits and gates for this level measure the delta against the parent
  // stack level, not main.
  const levelDeps: ExecuteDeps = { ...deps, diffBase: parentBranch };
  const fail = (reason: string): ChainLevelOutcome => {
    ctx.logger.appendRunJson({
      event: 'chain-level-failed',
      phase: PhaseName.Epic,
      epicId,
      waveNumber,
      beadId,
      reason,
    });
    return { ok: false, reason, retries, warnings };
  };

  // Belt-and-braces enrichment check: wave entry only vets chain heads;
  // mid-chain beads are checked here at dispatch time.
  if (!bdEnrichmentCheck(beadId, { spawnFn: deps.scriptSpawnFn })) {
    return fail('bead is not enriched (no Implementation Context)');
  }

  const bead = bdShowJson(beadId, { spawnFn: deps.scriptSpawnFn });
  if (!bead) {
    return fail('bd show --json failed; cannot derive branch name');
  }

  const title = typeof bead.title === 'string' ? bead.title : beadId;
  const issueType = bead.issue_type ?? 'task';
  const branch = deriveBranchName(title, issueType);

  // 1. Create this level's branch on its parent (main for the chain bottom).
  const created = stackCreate(branch, parentBranch, spawnDeps);
  if (!created.ok) {
    return fail(`gt create ${branch} --onto ${parentBranch} failed: ${created.stderr}`);
  }
  ctx.logger.appendRunJson({
    event: 'chain-level-branch-created',
    phase: PhaseName.Epic,
    beadId,
    branchName: branch,
    baseBranch: parentBranch,
  });

  // 2. Implementer + verification gate + per-bead audit (single retry).
  const implResult = await dispatchImplementer(beadId, ctx, levelDeps);
  if (!implResult.ok) {
    // Deliberately stricter than runLeafExecution's retry-once: chain
    // truncation is the retry-equivalent here — a failed level is cheaper
    // to reschedule than to retry in place while sibling chains wait.
    return fail(`implementer failure: ${implResult.reason}`);
  }

  const expectedFiles = extractExpectedFiles(beadId, deps);
  const gate = verifyImplementerCompletion(beadCtx, levelDeps, expectedFiles, parentBranch);
  if (!gate.passed) {
    reopenBead(beadId, beadCtx, deps, 'verification-gate-epic-escalate');
    // Deliberate asymmetry with the leaf path (no gate retry) — see above.
    return fail(`verification gate failed: ${gate.reason}`);
  }

  let auditResult = await runAudit(beadId, ctx, {
    ...levelDeps,
    changedFiles: gate.changedFiles,
  });
  warnings.push(...auditResult.warnings);

  if (!auditResult.passed) {
    const retryResult = await dispatchImplementer(beadId, ctx, {
      ...levelDeps,
      retryContext: { concerns: auditResult.concerns, attempt: 2 },
    });
    if (!retryResult.ok) {
      return fail(`retry implementer failure: ${retryResult.reason}`);
    }

    const retryGate = verifyImplementerCompletion(beadCtx, levelDeps, expectedFiles, parentBranch);
    if (!retryGate.passed) {
      reopenBead(beadId, beadCtx, deps, 'verification-gate-epic-escalate');
      return fail(`verification gate failed after retry: ${retryGate.reason}`);
    }

    retries++;
    auditResult = await runAudit(beadId, ctx, {
      ...levelDeps,
      changedFiles: retryGate.changedFiles,
    });
    warnings.push(...auditResult.warnings);

    if (!auditResult.passed) {
      return fail(`audit retry exhausted: ${auditResult.concerns.join('; ')}`);
    }
  }

  // 3. Per-level build gate BEFORE submit (independently-green invariant).
  const buildOutcome = await runLevelBuildGate(epicId, waveNumber, beadId, branch, ctx, levelDeps);
  retries += buildOutcome.retries;
  if (!buildOutcome.ok) {
    return fail(buildOutcome.reason ?? 'build gate failed');
  }

  // 4. Submit this level, then canonicalize the PR via gh.
  const submitted = stackSubmit(branch, spawnDeps);
  if (!submitted.ok) {
    return fail(`gt submit failed: ${submitted.stderr}`);
  }

  const prInfo = fetchPrInfo(branch, ctx.logger, PhaseName.Epic, scriptSpawnFn);
  if (!prInfo) {
    return fail(`could not resolve PR number/url for branch ${branch} after gt submit`);
  }

  const prTitle = commitMsg(title, issueType);
  let generatedBody = prBody(title, typeof bead.description === 'string' ? bead.description : '');
  if (parentPrNumber !== null) {
    generatedBody = withStackedPrefix(generatedBody, parentPrNumber);
  }

  const editResult = spawnCmd(
    'gh', ['pr', 'edit', String(prInfo.number), '--title', prTitle, '--body', generatedBody],
    ctx.logger, PhaseName.Epic, scriptSpawnFn,
  );
  if (editResult.exitCode !== 0) {
    return fail(`gh pr edit failed (exit ${editResult.exitCode}): ${editResult.stderr}`);
  }

  ctx.logger.appendRunJson({
    event: 'chain-level-complete',
    phase: PhaseName.Epic,
    epicId,
    waveNumber,
    beadId,
    branchName: branch,
    prUrl: prInfo.url,
    prNumber: prInfo.number,
  });

  return {
    ok: true,
    branch,
    prUrl: prInfo.url,
    prNumber: prInfo.number,
    retries,
    warnings,
  };
}

/**
 * Run one dependency chain: beads strictly sequentially, each level branching
 * from its predecessor. A failed level halts the chain — downstream levels
 * build on the broken branch and cannot proceed past it, so the remainder is
 * escalated (chain truncation) rather than retried at wave granularity.
 */
async function runChain(
  epicId: string,
  waveNumber: number,
  chain: string[],
  ctx: RunContext,
  deps: ExecuteDeps,
): Promise<ChainExecutionResult> {
  const result: ChainExecutionResult = {
    chain,
    completed: [],
    failed: [],
    escalated: [],
    retries: 0,
    warnings: [],
    prUrls: [],
  };

  let parentBranch = process.env.GIT_SAFE_MAIN_BRANCH ?? 'main';
  let parentPrNumber: number | null = null;

  for (let level = 0; level < chain.length; level++) {
    const beadId = chain[level];
    const outcome = await runChainLevel(
      epicId, waveNumber, beadId, parentBranch, parentPrNumber, ctx, deps,
    );
    result.retries += outcome.retries;
    result.warnings.push(...outcome.warnings);

    if (!outcome.ok) {
      const reason = outcome.reason ?? 'chain level failed';
      escalateBead(beadId, reason, ctx, deps);
      result.failed.push(beadId);
      result.escalated.push(beadId);

      // Truncate the chain: escalate the un-run remainder instead of
      // skipping past a broken parent. (bd blocking already prevents these
      // beads from becoming ready, but the escalation records why.)
      for (const remainder of chain.slice(level + 1)) {
        escalateBead(
          remainder,
          `chain truncated: upstream level ${beadId} failed (${reason})`,
          ctx, deps,
        );
        result.failed.push(remainder);
        result.escalated.push(remainder);
      }

      ctx.logger.appendRunJson({
        event: 'chain-halted',
        phase: PhaseName.Epic,
        epicId,
        waveNumber,
        failedBead: beadId,
        truncatedBeads: chain.slice(level + 1),
      });
      return result;
    }

    result.completed.push(beadId);
    if (outcome.prUrl) result.prUrls.push(outcome.prUrl);
    parentBranch = outcome.branch ?? parentBranch;
    parentPrNumber = outcome.prNumber ?? null;
  }

  // Per-chain verification pass (advisory, matching prior wave-end behavior:
  // verdicts are logged, not gated on). Runs from the chain's checkout, where
  // HEAD sits at the chain top, so `main...HEAD` covers the whole chain delta
  // — the right base for reviewing cross-bead integration within the chain.
  if (result.completed.length > 1) {
    await dispatchVerifier(
      'cross-bead-integration-verifier',
      buildVerifierPrompt(epicId, waveNumber, result.completed, 'integration'),
      ctx,
      deps,
    );
  }
  if (result.completed.length > 0) {
    await dispatchVerifier(
      'architecture-auditor',
      buildVerifierPrompt(epicId, waveNumber, result.completed, 'architecture'),
      ctx,
      deps,
    );
  }

  return result;
}

// =============================================================================
// Exported: runEpicExecution
// =============================================================================

/**
 * Execute the full epic wave lifecycle over a stackPlan chain forest.
 *
 * Waves are built from CHAINS, not beads: each wave schedules every
 * remaining chain whose head bead is currently ready (per
 * `bd ready --parent`), the 3-implementer cap (MAX_IMPLEMENTER_SLOTS)
 * applies to chains, and independent chains run in parallel under the
 * hybrid worktree model. Within a chain, beads run strictly sequentially
 * with per-level branches, build gates, and PR submission (see runChain).
 */
export async function runEpicExecution(
  epicId: string,
  plan: StackPlanResult,
  ctx: RunContext,
  deps: ExecuteDeps = {},
): Promise<EpicExecutionResult> {
  const allCompleted: string[] = [];
  const allFailed: string[] = [];
  const escalated: string[] = [];
  const allWarnings: string[] = [];
  const prUrls: string[] = [];
  let wavesCompleted = 0;
  let totalRetries = 0;

  let remainingChains = plan.chains.map(chain => [...chain]);

  ctx.logger.appendRunJson({
    event: 'epic-execution-start',
    phase: PhaseName.Epic,
    epicId,
    chainCount: remainingChains.length,
    flat: plan.flat,
    planWarnings: plan.warnings,
  });

  while (remainingChains.length > 0) {
    const readyIds = findReadyBeadIds(epicId, ctx, deps);

    // Schedule chains whose HEAD is ready. bd remains the cross-chain
    // unblocking source; mid-chain beads are owned by their chain runner
    // and are never scheduled directly even when bd reports them ready.
    const readyChains = remainingChains.filter(chain => readyIds.has(chain[0]));
    if (readyChains.length === 0) {
      break;
    }

    // Enrichment pre-filter on chain heads (mid-chain beads are re-checked
    // at dispatch time inside runChainLevel).
    const waveChains = readyChains.filter(
      chain => filterEnrichedBeads([chain[0]], ctx, deps).length > 0,
    );

    if (waveChains.length === 0) {
      ctx.logger.appendRunJson({
        event: 'wave-skip-no-enriched',
        phase: PhaseName.Epic,
        waveNumber: wavesCompleted + 1,
      });
      break;
    }

    remainingChains = remainingChains.filter(chain => !waveChains.includes(chain));
    const waveNumber = wavesCompleted + 1;

    const waveState: WaveState = {
      epicId,
      waveNumber,
      chains: waveChains.map(chain => [...chain]),
      beadsInProgress: waveChains.flat(),
      beadsCompleted: [],
      beadsFailed: [],
      implementerSlots: [],
      cascadeQueue: [],
    };

    ctx.logger.appendRunJson({
      event: 'wave-start',
      phase: PhaseName.Epic,
      epicId,
      waveNumber,
      chainCount: waveChains.length,
      chains: waveState.chains,
    });

    // Hybrid concurrency: chain 0 runs in the main checkout; each additional
    // chain gets its own worktree for the duration of the chain.
    const chainTasks = waveChains.map((chain, chainIndex) => async () => {
      let worktree: ChainWorktree | null = null;

      if (chainIndex > 0) {
        worktree = createChainWorktree(waveNumber, chainIndex, ctx, deps);
        if (!worktree) {
          const result: ChainExecutionResult = {
            chain,
            completed: [],
            failed: [...chain],
            escalated: [...chain],
            retries: 0,
            warnings: [],
            prUrls: [],
          };
          for (const beadId of chain) {
            escalateBead(beadId, 'could not create git worktree for parallel chain', ctx, deps);
          }
          return result;
        }
      }

      const chainDeps: ExecuteDeps = worktree ? { ...deps, cwd: worktree.path } : deps;
      try {
        return await runChain(epicId, waveNumber, chain, ctx, chainDeps);
      }
      finally {
        if (worktree) removeChainWorktree(worktree, ctx, deps);
      }
    });

    const chainResults = await runWithConcurrencyCap(chainTasks, MAX_IMPLEMENTER_SLOTS);

    const waveEscalated: string[] = [];
    for (const chainResult of chainResults) {
      waveState.beadsCompleted.push(...chainResult.completed);
      waveState.beadsFailed.push(...chainResult.failed);
      waveEscalated.push(...chainResult.escalated);
      totalRetries += chainResult.retries;
      allWarnings.push(...chainResult.warnings);
      prUrls.push(...chainResult.prUrls);
    }

    allCompleted.push(...waveState.beadsCompleted);
    allFailed.push(...waveState.beadsFailed);
    escalated.push(...waveEscalated);

    ctx.logger.appendRunJson({
      event: 'wave-complete',
      phase: PhaseName.Epic,
      epicId,
      waveNumber,
      beadsCompleted: waveState.beadsCompleted,
      beadsFailed: waveState.beadsFailed,
    });

    if (waveEscalated.length > 0) {
      ctx.logger.appendRunJson({
        event: 'epic-escalated',
        phase: PhaseName.Epic,
        epicId,
        waveNumber,
        escalatedBeads: waveEscalated,
      });

      return {
        outcome: 'escalated',
        wavesCompleted,
        beadsCompleted: allCompleted,
        beadsFailed: allFailed,
        escalatedBeads: escalated,
        totalRetries,
        warnings: allWarnings,
        prUrls,
      };
    }

    wavesCompleted++;
  }

  ctx.logger.appendRunJson({
    event: 'epic-execution-complete',
    phase: PhaseName.Epic,
    epicId,
    wavesCompleted,
    totalBeadsCompleted: allCompleted.length,
  });

  return {
    outcome: 'complete',
    wavesCompleted,
    beadsCompleted: allCompleted,
    beadsFailed: allFailed,
    escalatedBeads: escalated,
    totalRetries,
    warnings: allWarnings,
    prUrls,
  };
}

// =============================================================================
// Exported: parseBeadJson, fetchPrInfo, withStackedPrefix
// =============================================================================

/**
 * Parse bd show --json output. Returns the first element of the array.
 */
export function parseBeadJson(raw: string): BeadJson | null {
  try {
    const parsed = JSON.parse(raw) as BeadJson[];
    return parsed[0] ?? null;
  }
  catch {
    return null;
  }
}

/**
 * Resolve a branch's PR number and URL via `gh pr view <branch> --json url,number`.
 *
 * Used after `stackSubmit` — gt creates/updates the PR but the orchestrator
 * needs the PR number for `gh pr edit` and the URL for reporting. Returns
 * null when gh fails or its output is unparseable.
 */
export function fetchPrInfo(
  branch: string,
  logger: RunLogger,
  logTag: PhaseName,
  spawnFn: typeof nodeSpawnSync,
): { url: string; number: number } | null {
  const result = spawnCmd(
    'gh', ['pr', 'view', branch, '--json', 'url,number'], logger, logTag, spawnFn,
  );
  if (result.exitCode !== 0 || !result.stdout) return null;

  try {
    const parsed = JSON.parse(result.stdout) as { url?: unknown; number?: unknown };
    if (typeof parsed.url !== 'string' || typeof parsed.number !== 'number') return null;
    return { url: parsed.url, number: parsed.number };
  }
  catch {
    return null;
  }
}

/**
 * Insert the stacked-PR marker at the top of a PR body's Motivation section.
 *
 * Per git-workflow/stacking.md, stacked PRs open Motivation with a one-line
 * "Stacked on #N." pointing at the parent PR; bottom-of-stack PRs omit it.
 */
export function withStackedPrefix(body: string, parentPrNumber: number): string {
  const heading = '## Motivation\n\n';
  if (body.startsWith(heading)) {
    return `${heading}Stacked on #${parentPrNumber}.\n\n${body.slice(heading.length)}`;
  }
  return `Stacked on #${parentPrNumber}.\n\n${body}`;
}

// =============================================================================
// Exported: runPR
// =============================================================================

/**
 * PR finalization phase for LEAF beads: verify the bead closed, generate PR
 * body/title, submit via gt, canonicalize via gh pr edit.
 *
 * Epics never reach this phase — epicPhase routes to Report because chain
 * levels submit their own per-level PRs inside the wave loop.
 */
export async function runPR(
  ctx: PhaseCtx,
  deps: ExecuteDeps = {},
): Promise<{ next: PhaseName | 'halt'; ctx: PhaseCtx }> {
  const spawnFn = deps.scriptSpawnFn ?? nodeSpawnSync;
  const logger = ctx.logger;

  logger.appendRunJson({
    event: 'pr_finalize_start',
    beadId: ctx.beadId,
  });

  // Step 0: Get current branch name
  const branchCmd = spawnCmd(
    'git', ['branch', '--show-current'], logger, PhaseName.PR, spawnFn,
  );

  if (branchCmd.exitCode !== 0) {
    const msg = PR_MESSAGES.branchDetectFailed(branchCmd.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const branchName = branchCmd.stdout;

  // Step 0.5: Backstop — refuse to PR an empty branch. The leaf/epic
  // verification gates should have caught this, but if any code path
  // slips past them we still won't push empty branches or call gh.
  const baseBranch = process.env.GIT_SAFE_MAIN_BRANCH ?? 'main';
  const revCountCmd = spawnCmd(
    'git', ['rev-list', '--count', `${baseBranch}..HEAD`],
    logger, PhaseName.PR, spawnFn,
  );

  if (revCountCmd.exitCode !== 0 || revCountCmd.stdout.trim() === '0') {
    logger.appendRunJson({
      event: 'pr_finalize_aborted',
      reason: 'no commits on branch',
    });
    logger.writePhaseLog(
      PhaseName.PR, 'err',
      `Branch ${branchName} has no commits ahead of ${baseBranch} — refusing to create empty PR\n`,
    );
    return { next: 'halt', ctx };
  }

  // Step 1: Verify bead(s) are CLOSED
  const bdResult = spawnCmd(
    'bd', ['show', '--json', ctx.beadId], logger, PhaseName.PR, spawnFn,
  );

  if (bdResult.exitCode !== 0) {
    const msg = PR_MESSAGES.bdShowFailed(ctx.beadId, bdResult.exitCode, bdResult.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const bead = parseBeadJson(bdResult.stdout);
  if (!bead) {
    const msg = PR_MESSAGES.bdShowFailed(ctx.beadId, 0, 'unparseable JSON');
    console.error(msg);
    return { next: 'halt', ctx };
  }

  const beadsClosed: string[] = [ctx.beadId];

  const beadStatus = (bead.status ?? '').toLowerCase();
  if (!beadStatus.includes('closed') && !beadStatus.includes('done')) {
    const msg = PR_MESSAGES.unclosedBead(ctx.beadId, bead.status ?? 'unknown');
    console.error(msg);
    logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  // Step 2: Generate PR body (pure function)
  const generatedPrBody = prBody(bead.title ?? ctx.beadId, bead.description ?? '');

  // Step 3: Derive PR title
  const prTitle = commitMsg(bead.title ?? ctx.beadId, bead.issue_type ?? 'task');

  // Step 4: Submit branch via gt (pushes and creates the PR; command
  // conventions live in git-workflow/stacking.md, operations in helpers.ts).
  const submitResult = stackSubmit(branchName, { spawnFn: spawnFn as never, cwd: deps.cwd });

  if (!submitResult.ok) {
    const msg = PR_MESSAGES.submitFailed(branchName, submitResult.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  // Step 5: Resolve the PR number/URL, then canonicalize title + body via
  // gh pr edit (gt submit does not know the project's PR template).
  const prInfo = fetchPrInfo(branchName, logger, PhaseName.PR, spawnFn);

  if (!prInfo) {
    const msg = PR_MESSAGES.ghPrViewFailed(branchName, 1, 'could not resolve PR number/url after gt submit');
    console.error(msg);
    logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const editResult = spawnCmd(
    'gh', ['pr', 'edit', String(prInfo.number), '--title', prTitle, '--body', generatedPrBody],
    logger, PhaseName.PR, spawnFn,
  );

  if (editResult.exitCode !== 0) {
    const msg = PR_MESSAGES.ghPrEditFailed(editResult.exitCode, editResult.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const prUrl = prInfo.url;

  logger.appendRunJson({
    event: 'pr_finalize_complete',
    branchName,
    prTitle,
    prUrl,
    beadsClosed,
  });

  ctx.prUrl = prUrl;
  ctx.beadsClosed = beadsClosed;

  return { next: PhaseName.Report, ctx };
}

// =============================================================================
// PhaseRunner wrappers for the state machine
// =============================================================================

/**
 * Leaf phase runner: runs leaf execution, routes to PR on complete.
 */
export const leafPhase: PhaseRunner = async (ctx, deps = {}) => {
  const result = await runLeafExecution(ctx.beadId, ctx, deps);

  if (result.outcome === 'complete') {
    return { next: PhaseName.PR, ctx };
  }

  return { next: 'halt', ctx };
};

/**
 * Epic phase runner: gathers the epic's full child set + dependency edges,
 * plans dependency-chain stacks via stackPlan, and runs the chain-based
 * wave lifecycle.
 *
 * On completion it routes to Report, NOT to the PR phase: chain levels
 * submit their own per-level PRs inside the wave loop, so a trailing
 * epic-wide PR would be both redundant and wrong.
 */
export const epicPhase: PhaseRunner = async (ctx, deps = {}) => {
  const plan = gatherStackPlan(ctx.beadId, ctx, deps);

  if (!plan) {
    ctx.logger.writePhaseLog(PhaseName.Epic, 'err',
      'No open child beads found for epic execution\n');
    return { next: 'halt', ctx };
  }

  const epicResult = await runEpicExecution(ctx.beadId, plan, ctx, deps);

  if (epicResult.outcome === 'complete') {
    if (epicResult.prUrls.length > 0) {
      ctx.prUrl = epicResult.prUrls.join(', ');
    }
    ctx.beadsClosed = [ctx.beadId, ...epicResult.beadsCompleted];
    return { next: PhaseName.Report, ctx };
  }

  return { next: 'halt', ctx };
};

/**
 * PR phase runner: wraps runPR.
 */
export const prPhase: PhaseRunner = async (ctx, deps = {}) => {
  return runPR(ctx, deps);
};
