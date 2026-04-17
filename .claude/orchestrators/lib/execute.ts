/**
 * Consolidated execution phases (7a epic, 7b leaf, 8 PR).
 *
 * Merges phase-7a-epic.ts, phase-7b-leaf.ts, and phase-8-pr.ts into a
 * single module with a unified ExecuteDeps interface.
 *
 * Exports:
 *  - dispatchImplementer, runAudit, runLeafExecution  (from 7b)
 *  - runWithConcurrencyCap, runEpicExecution           (from 7a)
 *  - parseBeadJson, derivePrTitleFromBead, runPR       (from 8)
 *  - leafPhase, epicPhase, prPhase                     (PhaseRunner wrappers)
 */

import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from 'node:child_process';
import { existsSync as nodeExistsSync } from 'node:fs';
import { resolve } from 'node:path';
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
  runScript,
  spawnCmd,
  DispatchTimeoutError,
  type DispatchOptions,
} from './dispatch.js';

// =============================================================================
// Configuration defaults (overridable via env)
// =============================================================================

const BUDGET_IMPLEMENTER = parseFloat(process.env.ORCH_BUDGET_IMPLEMENTER ?? '5.00');
const BUDGET_AUDITOR = parseFloat(process.env.ORCH_BUDGET_AUDITOR ?? '1.50');
const BUDGET_BUILD_GUARDIAN = parseFloat(process.env.ORCH_BUDGET_BUILD_GUARDIAN ?? '2.00');
const BUDGET_VERIFIER = parseFloat(process.env.ORCH_BUDGET_VERIFIER ?? '1.50');
const TIMEOUT_IMPLEMENTER = parseInt(process.env.ORCH_TIMEOUT_IMPLEMENTER ?? '600000', 10);
const TIMEOUT_AUDITOR = parseInt(process.env.ORCH_TIMEOUT_AUDITOR ?? '300000', 10);
const TIMEOUT_BUILD_GUARDIAN = parseInt(process.env.ORCH_TIMEOUT_BUILD_GUARDIAN ?? '600000', 10);
const TIMEOUT_VERIFIER = parseInt(process.env.ORCH_TIMEOUT_VERIFIER ?? '300000', 10);

// =============================================================================
// Script paths
// =============================================================================

const MATCH_AGENTS_SCRIPT = resolve('.claude/skills/agent-discovery/match-agents.sh');
const ESCALATE_SCRIPT = resolve('.claude/skills/bead-backlog-selection/bd-escalate.sh');
const ENRICHMENT_CHECK_SCRIPT = resolve('.claude/skills/bead-state-assessment/bd-enrichment-check.sh');
const AUDITOR_SCHEMA_PATH = resolve('.claude/orchestrators/schemas/auditor-verdict.json');
const WAVE_VERDICT_SCHEMA = resolve('.claude/orchestrators/schemas/wave-verdict.json');
const PR_BODY_SCRIPT = '.claude/skills/bead-branch-and-pr/pr-body.sh';
const COMMIT_MSG_SCRIPT = '.claude/skills/bead-branch-and-pr/commit-msg.sh';

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
}

/**
 * Unified dependency injection interface for all execution phases.
 */
export interface ExecuteDeps {
  spawnFn?: typeof nodeSpawn;
  scriptSpawnFn?: typeof nodeSpawnSync;
  scriptExistsFn?: (path: string) => boolean;
  changedFiles?: string[];
  changedFilesForBead?: (beadId: string) => string[];
  timeoutMs?: number;
  retryContext?: RetryContext;
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
    `pr-body.sh failed (exit ${code}): ${stderr.trim()}`,
  commitMsgFailed: (code: number, stderr: string) =>
    `commit-msg.sh failed (exit ${code}): ${stderr.trim()}`,
  pushFailed: (branch: string, stderr: string) =>
    `git push failed for branch "${branch}": ${stderr.trim()}`,
  ghPrFailed: (code: number, stderr: string) =>
    `gh pr create failed (exit ${code}): ${stderr.trim()}`,
  branchDetectFailed: (stderr: string) =>
    `git branch --show-current failed: ${stderr.trim()}`,
} as const;

// =============================================================================
// Private helper types
// =============================================================================

interface MatchedAgent {
  name: string;
  path: string;
  description: string;
  rationale: string;
}

interface BeadJson {
  title?: string;
  status?: string;
  issue_type?: string;
  children?: Array<{ id?: string }>;
}

interface BeadReadyEntry {
  id: string;
  issue_type: string;
  status: string;
}

interface WaveEndResult {
  outcome: 'pass' | 'escalated';
  failedBeads: string[];
  retries: number;
}

interface BuildGuardianResult {
  verdict: 'pass' | 'fail';
  concerns: string[];
  beadsFailed: string[];
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
4. If lint and targeted tests pass: \`bd close ${beadId}\`

Do NOT run \`npm test\` or the full test suite — the build-guardian handles that
once per wave after all beads complete. Do NOT close the bead if lint or
targeted tests are failing. If blocked, report back.`;

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
// Private helpers — auditor discovery + dispatch
// =============================================================================

function discoverAuditors(
  changedFiles: string[],
  ctx: RunContext,
  opts: { spawnSync: typeof nodeSpawnSync; existsFn: (path: string) => boolean },
): MatchedAgent[] {
  if (changedFiles.length === 0) {
    return [];
  }

  const input = changedFiles.join('\n');

  const result = runScript<MatchedAgent[]>(
    MATCH_AGENTS_SCRIPT,
    ['auditor'],
    {
      logger: ctx.logger,
      logTag: PhaseName.Leaf,
      spawnFn: ((cmd: string, args: string[], spawnOpts: Record<string, unknown>) => {
        return opts.spawnSync(cmd, args, {
          ...spawnOpts,
          input: Buffer.from(input),
        });
      }) as typeof nodeSpawnSync,
      existsFn: opts.existsFn,
    },
  );

  if (result.exitCode !== 0) {
    ctx.logger.writePhaseLog(PhaseName.Leaf, 'err',
      `match-agents.sh auditor exited ${result.exitCode}\n`);
    return [];
  }

  return result.json ?? [];
}

async function dispatchAuditor(
  beadId: string,
  auditor: MatchedAgent,
  ctx: RunContext,
  deps: { spawnFn?: typeof nodeSpawn },
): Promise<AuditorVerdict> {
  const prompt = `# Audit changes for bead: ${beadId}

You are the ${auditor.name} running in post-code mode. Review the
changes landed on the current branch:

\`\`\`bash
git diff main...HEAD
\`\`\`

Apply your normal audit process. Emit one of the \`review-mode-auditor\`
verdicts (PASS / PASS WITH WARNINGS / FAIL) per
\`.claude/skills/review-mode-auditor/SKILL.md\`.`;

  try {
    return await dispatch<AuditorVerdict>({
      agent: auditor.name,
      schemaPath: AUDITOR_SCHEMA_PATH,
      prompt,
      budgetUsd: BUDGET_AUDITOR,
      timeoutMs: TIMEOUT_AUDITOR,
      ctx,
      logTag: PhaseName.Leaf,
      spawnFn: deps.spawnFn as typeof nodeSpawn,
    });
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
  const spawnSync = deps.scriptSpawnFn ?? nodeSpawnSync;
  const existsFn = deps.scriptExistsFn ?? nodeExistsSync;

  if (!existsFn(ENRICHMENT_CHECK_SCRIPT)) {
    ctx.logger.writePhaseLog(PhaseName.Epic, 'err',
      `Enrichment check script not found: ${ENRICHMENT_CHECK_SCRIPT}\n`);
    return [];
  }

  return beadIds.filter(beadId => {
    const result = spawnSync(ENRICHMENT_CHECK_SCRIPT, [beadId], {
      encoding: 'buffer' as never,
      shell: true,
      timeout: 30_000,
    });

    const exitCode = result.status ?? 1;
    ctx.logger.appendRunJson({
      event: 'enrichment-check',
      phase: PhaseName.Epic,
      beadId,
      enriched: exitCode === 0,
    });

    return exitCode === 0;
  });
}

function findNextWaveBeads(
  _epicId: string,
  ctx: RunContext,
  deps: ExecuteDeps,
): string[] {
  const spawnSync = deps.scriptSpawnFn ?? nodeSpawnSync;

  const result = spawnSync('bd', ['ready', '--json'], {
    encoding: 'buffer' as never,
    shell: true,
    timeout: 30_000,
  });

  const stdout = result.stdout?.toString('utf-8') ?? '';
  const exitCode = result.status ?? 1;

  if (exitCode !== 0 || !stdout.trim()) {
    return [];
  }

  try {
    const beads = JSON.parse(stdout) as BeadReadyEntry[];
    ctx.logger.appendRunJson({
      event: 'cascade-ready-check',
      phase: PhaseName.Epic,
      readyCount: beads.length,
    });
    return beads.map(b => b.id);
  }
  catch {
    ctx.logger.writePhaseLog(PhaseName.Epic, 'err',
      `Failed to parse bd ready output: ${stdout}\n`);
    return [];
  }
}

function escalateBead(
  beadId: string,
  reason: string,
  ctx: RunContext,
  deps: ExecuteDeps,
): void {
  const spawnSync = deps.scriptSpawnFn ?? nodeSpawnSync;
  const existsFn = deps.scriptExistsFn ?? nodeExistsSync;

  try {
    runScript(
      ESCALATE_SCRIPT,
      [beadId, reason, '7'],
      {
        logger: ctx.logger,
        logTag: PhaseName.Epic,
        spawnFn: spawnSync,
        existsFn,
      },
    );
  }
  catch (err) {
    ctx.logger.writePhaseLog(PhaseName.Epic, 'err',
      `bd-escalate.sh failed for ${beadId}: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  ctx.logger.appendRunJson({
    event: 'bead-escalated',
    phase: PhaseName.Epic,
    beadId,
    reason,
  });
}

// =============================================================================
// Private helpers — wave-end chain (epic)
// =============================================================================

function buildVerifierPrompt(
  epicId: string,
  waveNumber: number,
  beadIds: string[],
  kind: 'integration' | 'architecture',
): string {
  if (kind === 'integration') {
    return `# Cross-bead integration verification

Epic: ${epicId}, Wave: ${waveNumber}
Beads in this wave: ${beadIds.join(', ')}

Review the combined changes from all beads in this wave:

\`\`\`bash
git diff main...HEAD
\`\`\`

Look for conflicts, duplications, and inconsistencies between the beads'
changes that per-bead auditors miss because each bead was verified in isolation.`;
  }

  return `# Architecture auditor (light pass)

Epic: ${epicId}, Wave: ${waveNumber}
Beads in this wave: ${beadIds.join(', ')}

Review the wave's combined changes for vision drift, decision violations,
and conceptual fragmentation:

\`\`\`bash
git diff main...HEAD
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
    return await dispatch({
      agent: agentName,
      schemaPath: WAVE_VERDICT_SCHEMA,
      prompt,
      budgetUsd: BUDGET_VERIFIER,
      timeoutMs: TIMEOUT_VERIFIER,
      ctx,
      logTag: PhaseName.Epic,
      spawnFn: deps.spawnFn as typeof nodeSpawn,
    });
  }
  catch (err) {
    ctx.logger.writePhaseLog(PhaseName.Epic, 'err',
      `${agentName} dispatch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
}

async function dispatchBuildGuardian(
  epicId: string,
  waveNumber: number,
  ctx: RunContext,
  deps: ExecuteDeps,
): Promise<BuildGuardianResult> {
  const prompt = `# Build Guardian — Wave ${waveNumber}

Epic: ${epicId}

Run the full sequential verification suite:

\`\`\`bash
pkill -f "vitest" 2>/dev/null || true
npm run lint
npx vitest run --maxThreads=2
npm run build
\`\`\`

Report results using the wave-verdict schema.`;

  try {
    const result = await dispatch<WaveResult>({
      agent: 'build-guardian',
      schemaPath: WAVE_VERDICT_SCHEMA,
      prompt,
      budgetUsd: BUDGET_BUILD_GUARDIAN,
      timeoutMs: TIMEOUT_BUILD_GUARDIAN,
      ctx,
      logTag: PhaseName.Epic,
      spawnFn: deps.spawnFn as typeof nodeSpawn,
    });

    return {
      verdict: result.verdict === 'pass' ? 'pass' : 'fail',
      concerns: result.concerns ?? [],
      beadsFailed: result.beadsFailed ?? [],
    };
  }
  catch (err) {
    ctx.logger.writePhaseLog(PhaseName.Epic, 'err',
      `build-guardian dispatch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return {
      verdict: 'fail',
      concerns: [`build-guardian dispatch error: ${err instanceof Error ? err.message : String(err)}`],
      beadsFailed: [],
    };
  }
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
git log --oneline main...HEAD
git diff main...HEAD
\`\`\`

Identify which bead's commit is responsible and suggest a fix.`;

  try {
    return await dispatch<InvestigatorResult>({
      agent: 'test-failure-investigator',
      schemaPath: WAVE_VERDICT_SCHEMA,
      prompt,
      budgetUsd: BUDGET_VERIFIER,
      timeoutMs: TIMEOUT_VERIFIER,
      ctx,
      logTag: PhaseName.Epic,
      spawnFn: deps.spawnFn as typeof nodeSpawn,
    });
  }
  catch {
    return {};
  }
}

async function runWaveEndChain(
  epicId: string,
  waveNumber: number,
  waveState: WaveState,
  ctx: RunContext,
  deps: ExecuteDeps,
): Promise<WaveEndResult> {
  const completedBeads = waveState.beadsCompleted;
  let retries = 0;

  for (let attempt = 0; attempt <= MAX_WAVE_RETRIES; attempt++) {
    // Step A: cross-bead-integration-verifier (conditional)
    if (completedBeads.length > 1) {
      await dispatchVerifier(
        'cross-bead-integration-verifier',
        buildVerifierPrompt(epicId, waveNumber, completedBeads, 'integration'),
        ctx,
        deps,
      );
    }

    // Step B: architecture-auditor (light pass)
    await dispatchVerifier(
      'architecture-auditor',
      buildVerifierPrompt(epicId, waveNumber, completedBeads, 'architecture'),
      ctx,
      deps,
    );

    // Step C: build-guardian
    const buildResult = await dispatchBuildGuardian(epicId, waveNumber, ctx, deps);

    if (buildResult.verdict === 'pass') {
      return { outcome: 'pass', failedBeads: [], retries };
    }

    // Build-guardian failed — investigate and retry
    if (attempt < MAX_WAVE_RETRIES) {
      ctx.logger.appendRunJson({
        event: 'build-guardian-fail',
        phase: PhaseName.Epic,
        epicId,
        waveNumber,
        attempt: attempt + 1,
        concerns: buildResult.concerns,
      });

      const investigatorResult = await dispatchTestFailureInvestigator(
        epicId, waveNumber, buildResult.concerns, ctx, deps,
      );

      const responsibleBead = investigatorResult.responsibleBead ?? completedBeads[0];

      retries++;
      await dispatchImplementer(responsibleBead, ctx, {
        ...deps,
        retryContext: {
          concerns: buildResult.concerns,
          attempt: attempt + 2,
        },
      });

      const changedFiles = deps.changedFilesForBead?.(responsibleBead) ?? [];
      await runAudit(responsibleBead, ctx, { ...deps, changedFiles });

      continue;
    }

    // Exhausted retries — escalate
    const failedBeads = buildResult.beadsFailed.length > 0
      ? buildResult.beadsFailed
      : completedBeads;

    for (const beadId of failedBeads) {
      escalateBead(beadId, `Build-guardian failed after ${MAX_WAVE_RETRIES} retries`, ctx, deps);
    }

    return { outcome: 'escalated', failedBeads, retries };
  }

  // Defensive fallback
  return { outcome: 'escalated', failedBeads: completedBeads, retries };
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
  const spawnSync = deps.scriptSpawnFn ?? nodeSpawnSync;
  const existsFn = deps.scriptExistsFn ?? nodeExistsSync;

  try {
    runScript(
      ESCALATE_SCRIPT,
      [beadId, reason, '7'],
      {
        logger: ctx.logger,
        logTag: PhaseName.Leaf,
        spawnFn: spawnSync,
        existsFn,
      },
    );
  }
  catch (err) {
    ctx.logger.writePhaseLog(PhaseName.Leaf, 'err',
      `bd-escalate.sh failed: ${err instanceof Error ? err.message : String(err)}\n`);
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
 */
export async function dispatchImplementer(
  beadId: string,
  ctx: RunContext,
  deps: ExecuteDeps = {},
): Promise<ImplementerResult> {
  const prompt = buildImplementerPrompt(beadId, deps.retryContext);
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_IMPLEMENTER;

  try {
    await dispatch({
      agent: 'implementer',
      prompt,
      budgetUsd: BUDGET_IMPLEMENTER,
      timeoutMs,
      ctx,
      logTag: PhaseName.Leaf,
      spawnFn: deps.spawnFn as typeof nodeSpawn,
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
// Exported: runAudit
// =============================================================================

/**
 * Run per-bead auditors matched to the changed files.
 */
export async function runAudit(
  beadId: string,
  ctx: RunContext,
  deps: ExecuteDeps = {},
): Promise<AuditResult> {
  const changedFiles = deps.changedFiles ?? [];
  const spawnSync = deps.scriptSpawnFn ?? nodeSpawnSync;
  const existsFn = deps.scriptExistsFn ?? nodeExistsSync;
  const spawnFn = deps.spawnFn ?? nodeSpawn;

  const matchedAuditors = discoverAuditors(changedFiles, ctx, { spawnSync, existsFn });

  if (matchedAuditors.length === 0) {
    ctx.logger.appendRunJson({
      event: 'audit-skip',
      phase: PhaseName.Leaf,
      reason: 'no auditors matched',
    });
    return { passed: true, verdicts: [], concerns: [], warnings: [] };
  }

  const verdictPromises = matchedAuditors.map(auditor =>
    dispatchAuditor(beadId, auditor, ctx, { spawnFn }),
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

  // --- Attempt 1: Auditors ---
  const auditResult = await runAudit(beadId, ctx, deps);
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

  // --- Retry: re-run auditors ---
  const retryAuditResult = await runAudit(beadId, ctx, deps);
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
// Exported: runEpicExecution
// =============================================================================

/**
 * Execute the full epic wave lifecycle.
 */
export async function runEpicExecution(
  epicId: string,
  initialBeads: string[],
  ctx: RunContext,
  deps: ExecuteDeps = {},
): Promise<EpicExecutionResult> {
  const allCompleted: string[] = [];
  const allFailed: string[] = [];
  const escalated: string[] = [];
  const allWarnings: string[] = [];
  let wavesCompleted = 0;
  let totalRetries = 0;

  let readyBeads = [...initialBeads];

  ctx.logger.appendRunJson({
    event: 'epic-execution-start',
    phase: PhaseName.Epic,
    epicId,
    initialBeadCount: initialBeads.length,
  });

  while (readyBeads.length > 0) {
    const waveNumber = wavesCompleted + 1;

    ctx.logger.appendRunJson({
      event: 'wave-start',
      phase: PhaseName.Epic,
      epicId,
      waveNumber,
      beadCount: readyBeads.length,
      beadIds: readyBeads,
    });

    const enrichedBeads = filterEnrichedBeads(readyBeads, ctx, deps);

    if (enrichedBeads.length === 0) {
      ctx.logger.appendRunJson({
        event: 'wave-skip-no-enriched',
        phase: PhaseName.Epic,
        waveNumber,
      });
      break;
    }

    // Spawn implementers (max 3 in parallel)
    const waveState: WaveState = {
      epicId,
      waveNumber,
      beadsInProgress: [...enrichedBeads],
      beadsCompleted: [],
      beadsFailed: [],
      implementerSlots: [],
      cascadeQueue: [],
    };

    const implementerTasks = enrichedBeads.map(beadId => async () => {
      const result = await dispatchImplementer(beadId, ctx, deps);
      return { beadId, result };
    });

    const implementerResults = await runWithConcurrencyCap(
      implementerTasks,
      MAX_IMPLEMENTER_SLOTS,
    );

    // Per-bead auditor cascade
    for (const { beadId, result } of implementerResults) {
      if (!result.ok) {
        waveState.beadsFailed.push(beadId);
        continue;
      }

      const changedFiles = deps.changedFilesForBead?.(beadId) ?? [];
      const auditResult = await runAudit(beadId, ctx, { ...deps, changedFiles });
      allWarnings.push(...auditResult.warnings);

      if (auditResult.passed) {
        waveState.beadsCompleted.push(beadId);
      }
      else {
        const retryResult = await dispatchImplementer(beadId, ctx, {
          ...deps,
          retryContext: { concerns: auditResult.concerns, attempt: 2 },
        });

        if (retryResult.ok) {
          const retryAudit = await runAudit(beadId, ctx, { ...deps, changedFiles });
          allWarnings.push(...retryAudit.warnings);

          if (retryAudit.passed) {
            waveState.beadsCompleted.push(beadId);
            totalRetries++;
          }
          else {
            waveState.beadsFailed.push(beadId);
          }
        }
        else {
          waveState.beadsFailed.push(beadId);
        }
      }
    }

    // Wave-end verification chain
    const waveEndResult = await runWaveEndChain(epicId, waveNumber, waveState, ctx, deps);

    if (waveEndResult.outcome === 'escalated') {
      escalated.push(...waveEndResult.failedBeads);
      allFailed.push(...waveEndResult.failedBeads);
      allCompleted.push(...waveState.beadsCompleted);

      ctx.logger.appendRunJson({
        event: 'epic-escalated',
        phase: PhaseName.Epic,
        epicId,
        waveNumber,
        escalatedBeads: waveEndResult.failedBeads,
      });

      return {
        outcome: 'escalated',
        wavesCompleted,
        beadsCompleted: allCompleted,
        beadsFailed: allFailed,
        escalatedBeads: escalated,
        totalRetries: totalRetries + waveEndResult.retries,
        warnings: allWarnings,
      };
    }

    totalRetries += waveEndResult.retries;
    wavesCompleted++;
    allCompleted.push(...waveState.beadsCompleted);
    allFailed.push(...waveState.beadsFailed);

    ctx.logger.appendRunJson({
      event: 'wave-complete',
      phase: PhaseName.Epic,
      epicId,
      waveNumber,
      beadsCompleted: waveState.beadsCompleted,
      beadsFailed: waveState.beadsFailed,
    });

    // Cascade — find newly unblocked beads
    readyBeads = findNextWaveBeads(epicId, ctx, deps);
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
  };
}

// =============================================================================
// Exported: parseBeadJson, derivePrTitleFromBead
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
 * Derive PR title from the bead.
 */
export function derivePrTitleFromBead(
  title: string,
  issueType: string,
): string {
  if (issueType === 'epic') {
    return title.replace(/^Epic:\s*/i, '').trim();
  }
  return title;
}

// =============================================================================
// Exported: runPR
// =============================================================================

/**
 * PR finalization phase: verify beads closed, generate PR body/title, push, create PR.
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

  const isEpic = bead.issue_type === 'epic';
  const beadsClosed: string[] = [ctx.beadId];

  const beadStatus = (bead.status ?? '').toLowerCase();
  if (!beadStatus.includes('closed') && !beadStatus.includes('done')) {
    const msg = PR_MESSAGES.unclosedBead(ctx.beadId, bead.status ?? 'unknown');
    console.error(msg);
    logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  // For epics: verify all children are also closed
  if (isEpic && bead.children && bead.children.length > 0) {
    for (const child of bead.children) {
      const childId = child.id;
      if (!childId) continue;

      beadsClosed.push(childId);

      const childResult = spawnCmd(
        'bd', ['show', '--json', childId], logger, PhaseName.PR, spawnFn,
      );

      if (childResult.exitCode !== 0) {
        const msg = PR_MESSAGES.bdShowFailed(childId, childResult.exitCode, childResult.stderr);
        console.error(msg);
        return { next: 'halt', ctx };
      }

      const childBead = parseBeadJson(childResult.stdout);
      const childStatus = (childBead?.status ?? '').toLowerCase();
      if (!childStatus.includes('closed') && !childStatus.includes('done')) {
        const msg = PR_MESSAGES.unclosedBead(childId, childBead?.status ?? 'unknown');
        console.error(msg);
        logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
        return { next: 'halt', ctx };
      }
    }
  }

  // Step 2: Generate PR body via pr-body.sh
  const prBodyResult = spawnCmd(
    PR_BODY_SCRIPT, beadsClosed, logger, PhaseName.PR, spawnFn,
  );

  if (prBodyResult.exitCode !== 0) {
    const msg = PR_MESSAGES.prBodyFailed(prBodyResult.exitCode, prBodyResult.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const prBody = prBodyResult.stdout;

  // Step 3: Derive PR title
  let prTitle: string;

  if (isEpic) {
    prTitle = derivePrTitleFromBead(bead.title ?? ctx.beadId, 'epic');
  }
  else {
    const titleResult = spawnCmd(
      COMMIT_MSG_SCRIPT,
      [ctx.beadId, bead.title ?? ctx.beadId],
      logger,
      PhaseName.PR,
      spawnFn,
    );

    if (titleResult.exitCode !== 0) {
      const msg = PR_MESSAGES.commitMsgFailed(titleResult.exitCode, titleResult.stderr);
      console.error(msg);
      logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
      return { next: 'halt', ctx };
    }

    prTitle = titleResult.stdout;
  }

  // Step 4: Push branch
  const pushResult = spawnCmd(
    'git', ['push', '-u', 'origin', branchName], logger, PhaseName.PR, spawnFn,
  );

  if (pushResult.exitCode !== 0) {
    const msg = PR_MESSAGES.pushFailed(branchName, pushResult.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  // Step 5: Create PR via gh
  const ghResult = spawnCmd(
    'gh', ['pr', 'create', '--title', prTitle, '--body', prBody],
    logger, PhaseName.PR, spawnFn,
  );

  if (ghResult.exitCode !== 0) {
    const msg = PR_MESSAGES.ghPrFailed(ghResult.exitCode, ghResult.stderr);
    console.error(msg);
    logger.writePhaseLog(PhaseName.PR, 'err', msg + '\n');
    return { next: 'halt', ctx };
  }

  const prUrl = ghResult.stdout;

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
 * Epic phase runner: discovers initial beads, runs epic execution, routes to PR.
 */
export const epicPhase: PhaseRunner = async (ctx, deps = {}) => {
  const spawnSync = deps.scriptSpawnFn ?? nodeSpawnSync;

  // Discover initial ready beads for the epic via `bd ready --json`
  const result = spawnSync('bd', ['ready', '--json'], {
    encoding: 'buffer' as never,
    shell: true,
    timeout: 30_000,
  });

  const stdout = result.stdout?.toString('utf-8') ?? '';
  const exitCode = result.status ?? 1;

  if (exitCode !== 0 || !stdout.trim()) {
    ctx.logger.writePhaseLog(PhaseName.Epic, 'err',
      'No ready beads found for epic execution\n');
    return { next: 'halt', ctx };
  }

  let initialBeads: string[];
  try {
    const beads = JSON.parse(stdout) as BeadReadyEntry[];
    initialBeads = beads.map(b => b.id);
  }
  catch {
    ctx.logger.writePhaseLog(PhaseName.Epic, 'err',
      `Failed to parse bd ready output: ${stdout}\n`);
    return { next: 'halt', ctx };
  }

  if (initialBeads.length === 0) {
    ctx.logger.writePhaseLog(PhaseName.Epic, 'err',
      'No ready beads found for epic execution\n');
    return { next: 'halt', ctx };
  }

  const epicResult = await runEpicExecution(ctx.beadId, initialBeads, ctx, deps);

  if (epicResult.outcome === 'complete') {
    return { next: PhaseName.PR, ctx };
  }

  return { next: 'halt', ctx };
};

/**
 * PR phase runner: wraps runPR.
 */
export const prPhase: PhaseRunner = async (ctx, deps = {}) => {
  return runPR(ctx, deps);
};
