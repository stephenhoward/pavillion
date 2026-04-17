/**
 * Phase 7a — Epic execution via wave orchestration.
 *
 * Drives the full wave lifecycle for an epic: groups ready beads into
 * waves, spawns ≤3 implementers per wave, runs per-bead auditors,
 * runs the sequential wave-end verification chain, cascades to the
 * next wave, and repeats until all beads are closed or escalation halts.
 *
 * Reuses dispatchImplementer + runAudit from phase-7b-leaf.
 *
 * Consumers:
 *  - process-backlog.ts (Branch A — epic execution)
 */

import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from 'node:child_process';
import { existsSync as nodeExistsSync } from 'node:fs';
import { resolve } from 'node:path';
import { dispatch } from './dispatch.js';
import { runScript } from './run-script.js';
import { PhaseName, type RunContext } from './context.js';
import {
  dispatchImplementer,
  runAudit,
  type LeafDeps,
  type RetryContext,
} from './phase-7b-leaf.js';
import {
  MAX_IMPLEMENTER_SLOTS,
  MAX_WAVE_RETRIES,
  type WaveResult,
  type WaveState,
} from './wave-types.js';

// ---------------------------------------------------------------------------
// Configuration defaults (overridable via env)
// ---------------------------------------------------------------------------

const BUDGET_BUILD_GUARDIAN = parseFloat(process.env.ORCH_BUDGET_BUILD_GUARDIAN ?? '2.00');
const BUDGET_VERIFIER = parseFloat(process.env.ORCH_BUDGET_VERIFIER ?? '1.50');
const TIMEOUT_BUILD_GUARDIAN = parseInt(process.env.ORCH_TIMEOUT_BUILD_GUARDIAN ?? '600000', 10);
const TIMEOUT_VERIFIER = parseInt(process.env.ORCH_TIMEOUT_VERIFIER ?? '300000', 10);

const ENRICHMENT_CHECK_SCRIPT = resolve('.claude/skills/bead-state-assessment/bd-enrichment-check.sh');
const ESCALATE_SCRIPT = resolve('.claude/skills/bead-backlog-selection/bd-escalate.sh');
const WAVE_VERDICT_SCHEMA = resolve('.claude/orchestrators/schemas/wave-verdict.json');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EpicExecutionResult {
  outcome: 'complete' | 'escalated';
  wavesCompleted: number;
  beadsCompleted: string[];
  beadsFailed: string[];
  escalatedBeads: string[];
  totalRetries: number;
  warnings: string[];
}

export interface EpicDeps extends LeafDeps {
  /** Return changed files for a given bead (for auditor matching). */
  changedFilesForBead?: (beadId: string) => string[];
}

// ---------------------------------------------------------------------------
// Concurrency-capped parallel execution
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Execute the full epic wave lifecycle.
 *
 * @param epicId - The epic bead identifier.
 * @param initialBeads - Initial set of ready bead IDs for wave 1.
 * @param ctx - Run context threaded through the orchestrator.
 * @param deps - Injectable dependencies for testing.
 */
export async function runEpicExecution(
  epicId: string,
  initialBeads: string[],
  ctx: RunContext,
  deps: EpicDeps = {},
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

  // --- Wave loop ---
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

    // Filter to enriched beads only
    const enrichedBeads = filterEnrichedBeads(readyBeads, ctx, deps);

    if (enrichedBeads.length === 0) {
      ctx.logger.appendRunJson({
        event: 'wave-skip-no-enriched',
        phase: PhaseName.Epic,
        waveNumber,
      });
      break;
    }

    // --- Step 2: Spawn implementers (max 3 in parallel) ---
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

    // --- Step 3: Per-bead auditor cascade ---
    for (const { beadId, result } of implementerResults) {
      if (!result.ok) {
        waveState.beadsFailed.push(beadId);
        continue;
      }

      const changedFiles = deps.changedFilesForBead?.(beadId) ?? [];
      const auditResult = await runAudit(beadId, ctx, {
        ...deps,
        changedFiles,
      });
      allWarnings.push(...auditResult.warnings);

      if (auditResult.passed) {
        waveState.beadsCompleted.push(beadId);
      }
      else {
        // Retry with audit concerns
        const retryResult = await dispatchImplementer(beadId, ctx, {
          ...deps,
          retryContext: {
            concerns: auditResult.concerns,
            attempt: 2,
          } as RetryContext,
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

    // --- Step 4: Wave-end verification chain (sequential) ---
    const waveEndResult = await runWaveEndChain(
      epicId,
      waveNumber,
      waveState,
      ctx,
      deps,
    );

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

    // --- Step 5: Cascade — find newly unblocked beads ---
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

// ---------------------------------------------------------------------------
// Wave-end verification chain
// ---------------------------------------------------------------------------

interface WaveEndResult {
  outcome: 'pass' | 'escalated';
  failedBeads: string[];
  retries: number;
}

/**
 * Run the sequential wave-end verification chain:
 *   1. cross-bead-integration-verifier (if wave size > 1)
 *   2. architecture-auditor (light pass)
 *   3. build-guardian (exactly one)
 *
 * On build-guardian fail: test-failure-investigator → retry implementer →
 * re-run chain. After MAX_WAVE_RETRIES, escalate.
 */
async function runWaveEndChain(
  epicId: string,
  waveNumber: number,
  waveState: WaveState,
  ctx: RunContext,
  deps: EpicDeps,
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

      // Dispatch test-failure-investigator
      const investigatorResult = await dispatchTestFailureInvestigator(
        epicId,
        waveNumber,
        buildResult.concerns,
        ctx,
        deps,
      );

      const responsibleBead = investigatorResult.responsibleBead ?? completedBeads[0];

      // Retry implementer for the responsible bead
      retries++;
      await dispatchImplementer(responsibleBead, ctx, {
        ...deps,
        retryContext: {
          concerns: buildResult.concerns,
          attempt: attempt + 2,
        } as RetryContext,
      });

      // Re-run per-bead auditor for the fixed bead
      const changedFiles = deps.changedFilesForBead?.(responsibleBead) ?? [];
      await runAudit(responsibleBead, ctx, { ...deps, changedFiles });

      // Loop back to re-run the entire wave-end chain
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

  // Should not reach here, but handle defensively
  return { outcome: 'escalated', failedBeads: completedBeads, retries };
}

// ---------------------------------------------------------------------------
// Verifier dispatch helpers
// ---------------------------------------------------------------------------

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
  deps: EpicDeps,
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

interface BuildGuardianResult {
  verdict: 'pass' | 'fail';
  concerns: string[];
  beadsFailed: string[];
}

async function dispatchBuildGuardian(
  epicId: string,
  waveNumber: number,
  ctx: RunContext,
  deps: EpicDeps,
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

// ---------------------------------------------------------------------------
// Test-failure investigator
// ---------------------------------------------------------------------------

interface InvestigatorResult {
  responsibleBead?: string;
  diagnosis?: string;
  suggestedFix?: string;
}

async function dispatchTestFailureInvestigator(
  epicId: string,
  waveNumber: number,
  concerns: string[],
  ctx: RunContext,
  deps: EpicDeps,
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

// ---------------------------------------------------------------------------
// Helper: filter enriched beads
// ---------------------------------------------------------------------------

function filterEnrichedBeads(
  beadIds: string[],
  ctx: RunContext,
  deps: EpicDeps,
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

// ---------------------------------------------------------------------------
// Helper: find next wave beads via `bd ready`
// ---------------------------------------------------------------------------

interface BeadReadyEntry {
  id: string;
  issue_type: string;
  status: string;
}

function findNextWaveBeads(
  _epicId: string,
  ctx: RunContext,
  deps: EpicDeps,
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

// ---------------------------------------------------------------------------
// Helper: escalate a bead
// ---------------------------------------------------------------------------

function escalateBead(
  beadId: string,
  reason: string,
  ctx: RunContext,
  deps: EpicDeps,
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
