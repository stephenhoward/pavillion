/**
 * Phase 7b — Single-leaf bead execution.
 *
 * Dispatches an implementer subagent, runs per-bead auditors, and handles
 * the max-1-retry protocol. Exports reusable helpers so phase-7a-epic can
 * share the same implementer/audit logic.
 *
 * Consumers:
 *  - process-backlog.ts (Branch B — leaf execution)
 *  - phase-7a-epic.ts (reuses dispatchImplementer + runAudit per wave bead)
 */

import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from 'node:child_process';
import { existsSync as nodeExistsSync } from 'node:fs';
import { resolve } from 'node:path';
import { dispatch, DispatchTimeoutError } from './dispatch.js';
import { runScript } from './run-script.js';
import { PhaseName, type RunContext } from './context.js';

// ---------------------------------------------------------------------------
// Configuration defaults (overridable via env)
// ---------------------------------------------------------------------------

const BUDGET_IMPLEMENTER = parseFloat(process.env.ORCH_BUDGET_IMPLEMENTER ?? '5.00');
const BUDGET_AUDITOR = parseFloat(process.env.ORCH_BUDGET_AUDITOR ?? '1.50');
const TIMEOUT_IMPLEMENTER = parseInt(process.env.ORCH_TIMEOUT_IMPLEMENTER ?? '600000', 10);
const TIMEOUT_AUDITOR = parseInt(process.env.ORCH_TIMEOUT_AUDITOR ?? '300000', 10);

const MATCH_AGENTS_SCRIPT = resolve('.claude/skills/agent-discovery/match-agents.sh');
const ESCALATE_SCRIPT = resolve('.claude/skills/bead-backlog-selection/bd-escalate.sh');
const AUDITOR_SCHEMA_PATH = resolve('.claude/orchestrators/schemas/auditor-verdict.json');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditorVerdict {
  agent: string;
  verdict: 'pass' | 'fail' | 'escalate';
  concerns: string[];
  recommendations: string[];
  beadId: string;
}

interface MatchedAgent {
  name: string;
  path: string;
  description: string;
  rationale: string;
}

export interface ImplementerResult {
  ok: boolean;
  reason?: string;
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

export interface RetryContext {
  concerns: string[];
  attempt: number;
}

/**
 * Injectable dependencies for testing.
 */
export interface LeafDeps {
  spawnFn?: typeof nodeSpawn;
  scriptSpawnFn?: typeof nodeSpawnSync;
  scriptExistsFn?: (path: string) => boolean;
  changedFiles?: string[];
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Implementer prompt (canonical, from implementer-prompt-template skill)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// dispatchImplementer — exported for reuse in phase-7a-epic
// ---------------------------------------------------------------------------

/**
 * Dispatch a single implementer subagent for the given bead.
 *
 * Returns { ok: true } when the implementer completes without error,
 * or { ok: false, reason } on timeout or dispatch failure.
 */
export async function dispatchImplementer(
  beadId: string,
  ctx: RunContext,
  deps: LeafDeps & { retryContext?: RetryContext } = {},
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

// ---------------------------------------------------------------------------
// runAudit — exported for reuse in phase-7a-epic
// ---------------------------------------------------------------------------

/**
 * Run per-bead auditors matched to the changed files.
 *
 * 1. Discover auditors via match-agents.sh.
 * 2. Dispatch all matched auditors in parallel.
 * 3. Aggregate verdicts: any fail/escalate → overall failed.
 */
export async function runAudit(
  beadId: string,
  ctx: RunContext,
  deps: LeafDeps = {},
): Promise<AuditResult> {
  const changedFiles = deps.changedFiles ?? [];
  const spawnSync = deps.scriptSpawnFn ?? nodeSpawnSync;
  const existsFn = deps.scriptExistsFn ?? nodeExistsSync;
  const spawnFn = deps.spawnFn ?? nodeSpawn;

  // Discover matched auditors
  const matchedAuditors = discoverAuditors(changedFiles, ctx, { spawnSync, existsFn });

  if (matchedAuditors.length === 0) {
    ctx.logger.appendRunJson({
      event: 'audit-skip',
      phase: PhaseName.Leaf,
      reason: 'no auditors matched',
    });
    return { passed: true, verdicts: [], concerns: [], warnings: [] };
  }

  // Dispatch all auditors in parallel
  const verdictPromises = matchedAuditors.map(auditor =>
    dispatchAuditor(beadId, auditor, ctx, { spawnFn }),
  );

  const verdicts = await Promise.all(verdictPromises);

  // Aggregate results
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

// ---------------------------------------------------------------------------
// runLeafExecution — full Branch B flow with retry protocol
// ---------------------------------------------------------------------------

/**
 * Execute the full Branch B flow for a single leaf bead:
 *
 *   Implementer → Auditors → (retry once on failure) → Escalate or Complete
 *
 * Build-guardian is NOT included here — it runs after this function returns
 * 'complete', driven by the main orchestrator.
 */
export async function runLeafExecution(
  beadId: string,
  ctx: RunContext,
  deps: LeafDeps = {},
): Promise<LeafExecutionResult> {
  const warnings: string[] = [];

  // --- Attempt 1: Implementer ---
  const implResult = await dispatchImplementer(beadId, ctx, deps);

  if (!implResult.ok) {
    // Implementer failed on first attempt — try once more
    const retryResult = await retryAfterFailure(
      beadId, ctx, deps, implResult.reason ?? 'implementer failure',
    );
    if (retryResult) return retryResult;

    // If retryAfterFailure returned null, it means we should escalate
    return escalate(beadId, ctx, deps, `implementer failure: ${implResult.reason}`, 1);
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
    retryContext: {
      concerns: auditResult.concerns,
      attempt: 2,
    },
  });

  if (!retryImplResult.ok) {
    return escalate(beadId, ctx, deps, `retry implementer failure: ${retryImplResult.reason}`, 1);
  }

  // --- Retry: re-run auditors ---
  const retryAuditResult = await runAudit(beadId, ctx, deps);
  warnings.push(...retryAuditResult.warnings);

  if (retryAuditResult.passed) {
    return { outcome: 'complete', retryCount: 1, warnings };
  }

  // Second audit failure — escalate
  return escalate(
    beadId, ctx, deps,
    `audit retry exhausted: ${retryAuditResult.concerns.join('; ')}`,
    1,
  );
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Discover auditors matched to the changed files via match-agents.sh.
 */
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

/**
 * Dispatch a single auditor and return its verdict.
 */
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
    // On dispatch failure, treat as escalate
    return {
      agent: auditor.name,
      verdict: 'escalate',
      concerns: [`Auditor ${auditor.name} dispatch failed`],
      recommendations: [],
      beadId,
    };
  }
}

/**
 * Attempt a retry after an implementer failure. Returns null if the retry
 * itself fails (caller should escalate).
 */
async function retryAfterFailure(
  beadId: string,
  ctx: RunContext,
  deps: LeafDeps,
  failureReason: string,
): Promise<LeafExecutionResult | null> {
  const retryResult = await dispatchImplementer(beadId, ctx, {
    ...deps,
    retryContext: {
      concerns: [failureReason],
      attempt: 2,
    },
  });

  if (!retryResult.ok) {
    return null; // Caller should escalate
  }

  // Re-run auditors after retry
  const auditResult = await runAudit(beadId, ctx, deps);

  if (auditResult.passed) {
    return { outcome: 'complete', retryCount: 1, warnings: auditResult.warnings };
  }

  return null; // Caller should escalate
}

/**
 * Escalate the bead via bd-escalate.sh and return a halt result.
 */
function escalate(
  beadId: string,
  ctx: RunContext,
  deps: LeafDeps,
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
