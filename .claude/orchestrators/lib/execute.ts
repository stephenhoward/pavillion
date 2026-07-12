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
import {
  bdEscalate,
  bdEnrichmentCheck,
  discoverAgents,
  commitMsg,
  prBody,
  stackSubmit,
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
 * Combines `git diff --stat` and `git log --oneline` for the branch-vs-main delta.
 */
function buildAuditorContext(
  ctx: RunContext,
  deps: { scriptSpawnFn?: typeof nodeSpawnSync },
): string {
  const spawn = deps.scriptSpawnFn ?? nodeSpawnSync;
  const stat = spawn('git', ['diff', '--stat', 'main...HEAD'], {
    encoding: 'buffer' as never,
    shell: true,
    timeout: 30_000,
  });
  const log = spawn('git', ['log', '--oneline', 'main..HEAD'], {
    encoding: 'buffer' as never,
    shell: true,
    timeout: 30_000,
  });

  const statOut = (stat.stdout?.toString('utf-8') ?? '').trim();
  const logOut = (log.stdout?.toString('utf-8') ?? '').trim();

  return [
    'Changed files (`git diff --stat main...HEAD`):',
    '',
    statOut || '_(no changes)_',
    '',
    'Commits in this branch (`git log --oneline main..HEAD`):',
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
    const raw = await dispatch<unknown>({
      agent: auditor.name,
      prompt,
      timeoutMs: TIMEOUT_AUDITOR,
      ctx,
      logTag: PhaseName.Leaf,
      spawnFn: deps.spawnFn as typeof nodeSpawn,
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

function findNextWaveBeads(
  epicId: string,
  ctx: RunContext,
  deps: ExecuteDeps,
): string[] {
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
    const raw = await dispatch({
      agent: agentName,
      prompt,
      timeoutMs: TIMEOUT_VERIFIER,
      ctx,
      logTag: PhaseName.Epic,
      spawnFn: deps.spawnFn as typeof nodeSpawn,
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

After running the suite, write your prose report, then close your output with
a fenced JSON block containing the structured verdict. The orchestrator parses
this block — without it, the run cannot continue.

\`\`\`json
{
  "verdict": "pass" | "fail",
  "concerns": ["short error description", "..."],
  "beadsFailed": ["pv-xxxx", "..."]
}
\`\`\`

\`verdict\` is "pass" only when lint, tests, and build all succeed. \`concerns\`
should list each failing check (one entry per failure) with file paths and
test names where available. \`beadsFailed\` lists bead IDs whose changes
introduced the failures (empty if you cannot attribute).`;

  let raw: unknown;
  try {
    raw = await dispatch({
      agent: 'build-guardian',
      prompt,
      timeoutMs: TIMEOUT_BUILD_GUARDIAN,
      ctx,
      logTag: PhaseName.Epic,
      spawnFn: deps.spawnFn as typeof nodeSpawn,
    });
  }
  catch (err) {
    ctx.logger.writePhaseLog(PhaseName.Epic, 'err',
      `build-guardian dispatch failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return {
      verdict: 'fail',
      concerns: [`build-guardian dispatch error: ${err instanceof Error ? err.message : String(err)}`],
      beadsFailed: [],
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
      beadsFailed: [],
      parseFailed: true,
    };
  }

  return {
    verdict: result.verdict === 'pass' ? 'pass' : 'fail',
    concerns: result.concerns ?? [],
    beadsFailed: result.beadsFailed ?? [],
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
git log --oneline main...HEAD
git diff main...HEAD
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

    // Build-guardian failed — log and decide whether retry is meaningful.
    ctx.logger.appendRunJson({
      event: 'build-guardian-fail',
      phase: PhaseName.Epic,
      epicId,
      waveNumber,
      attempt: attempt + 1,
      concerns: buildResult.concerns,
      parseFailed: buildResult.parseFailed ?? false,
    });

    // Parse failures are terminal: there is no signal about which bead is
    // responsible, so retrying just spawns implementers with no bead id and
    // loops the orchestrator. Escalate immediately.
    if (buildResult.parseFailed) {
      const failedBeads = buildResult.beadsFailed.length > 0
        ? buildResult.beadsFailed
        : completedBeads;
      for (const beadId of failedBeads) {
        escalateBead(beadId, 'Build-guardian output unparseable; manual investigation required', ctx, deps);
      }
      return { outcome: 'escalated', failedBeads, retries };
    }

    // Build-guardian failed — investigate and retry
    if (attempt < MAX_WAVE_RETRIES) {
      const investigatorResult = await dispatchTestFailureInvestigator(
        epicId, waveNumber, buildResult.concerns, ctx, deps,
      );

      const responsibleBead = investigatorResult.responsibleBead ?? completedBeads[0];

      // Without a responsibleBead we cannot dispatch a meaningful retry;
      // the dispatchImplementer guard would refuse, but we'd still loop
      // through this branch. Escalate instead.
      if (!responsibleBead) {
        const failedBeads = buildResult.beadsFailed.length > 0
          ? buildResult.beadsFailed
          : completedBeads;
        for (const beadId of failedBeads) {
          escalateBead(beadId, 'Build-guardian failed and no responsible bead could be identified', ctx, deps);
        }
        return { outcome: 'escalated', failedBeads, retries };
      }

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
 * (consistent with preflight checks in `helpers.ts`).
 */
export function verifyImplementerCompletion(
  ctx: RunContext,
  deps: ExecuteDeps,
  expectedFiles?: string[],
): VerificationResult {
  const spawnFn = deps.scriptSpawnFn ?? nodeSpawnSync;
  const baseBranch = process.env.GIT_SAFE_MAIN_BRANCH ?? 'main';

  const statusArgs = ['status', '--porcelain'];
  if (expectedFiles && expectedFiles.length > 0) {
    statusArgs.push('--', ...expectedFiles);
  }
  const statusResult = spawnFn('git', statusArgs, {
    encoding: 'buffer' as never,
    shell: false,
    timeout: 10_000,
  });
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

  const revResult = spawnFn('git', ['rev-list', '--count', `${baseBranch}..HEAD`], {
    encoding: 'buffer' as never,
    shell: false,
    timeout: 10_000,
  });
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

  const diffResult = spawnFn('git', ['diff', '--name-only', `${baseBranch}...HEAD`], {
    encoding: 'buffer' as never,
    shell: false,
    timeout: 10_000,
  });
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

      // Verification gate — mirror leaf-path enforcement. Scope ctx.beadId to
      // the child bead so gate/reopen log events identify the bead, not the epic.
      // Pass the bead's expected file set so the dirty-tree check ignores
      // pending edits from parallel siblings on unrelated files.
      // Epic wave loop handles retries at the wave level via MAX_WAVE_RETRIES;
      // here we just mark this bead as failed for this wave and move on.
      const beadCtx: RunContext = { ...ctx, beadId };
      const expectedFiles = extractExpectedFiles(beadId, deps);
      const gate = verifyImplementerCompletion(beadCtx, deps, expectedFiles);
      if (!gate.passed) {
        reopenBead(beadId, beadCtx, deps, 'verification-gate-epic-escalate');
        waveState.beadsFailed.push(beadId);
        continue;
      }

      const auditResult = await runAudit(beadId, ctx, {
        ...deps,
        changedFiles: gate.changedFiles,
      });
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
          const retryAudit = await runAudit(beadId, ctx, {
            ...deps,
            changedFiles: gate.changedFiles,
          });
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

  // Step 2: Generate PR body (pure function)
  const generatedPrBody = prBody(bead.title ?? ctx.beadId, bead.description ?? '');

  // Step 3: Derive PR title
  let prTitle: string;

  if (isEpic) {
    prTitle = derivePrTitleFromBead(bead.title ?? ctx.beadId, 'epic');
  }
  else {
    prTitle = commitMsg(bead.title ?? ctx.beadId, bead.issue_type ?? 'task');
  }

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
 * Epic phase runner: discovers initial beads, runs epic execution, routes to PR.
 */
export const epicPhase: PhaseRunner = async (ctx, deps = {}) => {
  const spawnSync = deps.scriptSpawnFn ?? nodeSpawnSync;

  // Discover initial ready beads for the epic via `bd ready --parent <epic> --json`.
  // The --parent filter is essential: without it, bd ready returns the entire
  // globally-ready set and unrelated beads from other epics get swept into wave 1.
  const result = spawnSync('bd', ['ready', '--parent', ctx.beadId, '--json'], {
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
