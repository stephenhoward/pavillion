/**
 * Phase 3 -- Auto-Shape if Needed (delegated).
 *
 * Dispatches the shape-bead subagent via `dispatch()` to fill the bead's
 * structured fields. The subagent output is validated against
 * `schemas/shape-verdict.json` CLI-side via `--json-schema`.
 *
 * On SHAPED: re-runs bd-state.sh to verify state advanced, then routes
 * to Phase 3.5 (ShapeAdvisors).
 *
 * On ESCALATE: calls bd-escalate.sh and returns halt (Safeguard 3).
 *
 * On DispatchMalformedError or DispatchTimeoutError: escalates and halts.
 */

import { resolve } from 'node:path';
import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { PhaseName } from './context.js';
import {
  dispatch,
  DispatchMalformedError,
  DispatchTimeoutError,
  type DispatchOptions,
} from './dispatch.js';
import { runScript, type RunScriptOptions } from './run-script.js';
import { routeByState, type StateVerdict } from './phase-2-state.js';
import type { OrchestratorContext, PhaseRunner } from '../process-backlog.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BD_STATE_SCRIPT = '.claude/skills/bead-state-assessment/bd-state.sh';
const BD_ESCALATE_SCRIPT = '.claude/skills/bead-backlog-selection/bd-escalate.sh';
const SCHEMA_PATH = resolve('.claude/orchestrators/schemas/shape-verdict.json');

/** Default budget in USD for the shape subagent. Override via ORCH_BUDGET_SHAPE env var. */
export const SHAPE_BUDGET_DEFAULT = 2.00;

/** Timeout in ms for the shape dispatch. */
export const SHAPE_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------------------
// Shape verdict type (mirrors the JSON schema)
// ---------------------------------------------------------------------------

export interface ShapeVerdict {
  beadId: string;
  status: 'shaped' | 'escalate';
  summary: string;
}

// ---------------------------------------------------------------------------
// Subagent prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the prompt for the shape-bead subagent.
 *
 * This inlines the autonomous-mode instructions from process-backlog.md
 * Phase 3 rather than referencing an agent definition (there is no
 * `.claude/agents/shape-bead.md`; the behavior is defined in the
 * `.claude/commands/shape-bead.md` slash command).
 */
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

// ---------------------------------------------------------------------------
// Deps injection for testing
// ---------------------------------------------------------------------------

export interface ShapeDeps {
  /** Override the dispatch function (for testing). */
  dispatchFn?: (opts: DispatchOptions) => Promise<ShapeVerdict>;
  /** Override runScript options (for bd-state.sh). */
  runScriptOpts?: Partial<RunScriptOptions>;
  /** Override spawnSync for escalation (bd-escalate.sh outputs no JSON). */
  escalateSpawnFn?: typeof nodeSpawnSync;
}

// ---------------------------------------------------------------------------
// Phase runner
// ---------------------------------------------------------------------------

export const run: PhaseRunner = async (ctx) => {
  return runShape(ctx);
};

/**
 * Inner implementation with injectable deps for testing.
 */
export async function runShape(
  ctx: OrchestratorContext,
  deps: ShapeDeps = {},
): Promise<{ next: PhaseName | 'halt'; ctx: OrchestratorContext }> {

  const dispatchFn = deps.dispatchFn ?? dispatch;
  const budgetUsd = parseFloat(process.env.ORCH_BUDGET_SHAPE ?? '') || SHAPE_BUDGET_DEFAULT;

  const prompt = buildShapePrompt(ctx.beadId);

  ctx.logger.appendRunJson({
    event: 'shape_dispatched',
    beadId: ctx.beadId,
    budgetUsd,
  });

  let verdict: ShapeVerdict;

  try {
    verdict = await dispatchFn({
      agent: 'shape-bead',
      schemaPath: SCHEMA_PATH,
      prompt,
      budgetUsd,
      timeoutMs: SHAPE_TIMEOUT_MS,
      ctx,
      logTag: PhaseName.Shape,
    });
  }
  catch (err) {
    // DispatchMalformedError or DispatchTimeoutError → escalate + halt
    if (err instanceof DispatchMalformedError || err instanceof DispatchTimeoutError) {
      const reason = err instanceof DispatchTimeoutError
        ? `Shape subagent timed out: ${err.message}`
        : `Shape subagent returned malformed output: ${err.message}`;

      ctx.logger.appendRunJson({
        event: 'shape_escalated',
        beadId: ctx.beadId,
        reason,
      });

      escalate(ctx, reason, deps);
      return { next: 'halt', ctx };
    }
    // Unexpected error → rethrow (Safeguard 6)
    throw err;
  }

  // Route based on verdict status
  if (verdict.status === 'escalate') {
    ctx.logger.appendRunJson({
      event: 'shape_escalated',
      beadId: ctx.beadId,
      reason: verdict.summary,
    });

    escalate(ctx, verdict.summary, deps);
    return { next: 'halt', ctx };
  }

  // Status is 'shaped' — re-run bd-state.sh to verify state advanced
  ctx.logger.appendRunJson({
    event: 'shape_success',
    beadId: ctx.beadId,
    summary: verdict.summary,
  });

  const baseOpts: RunScriptOptions = {
    logger: ctx.logger,
    logTag: PhaseName.Shape,
    ...deps.runScriptOpts,
  };

  const stateResult = runScript<StateVerdict>(
    BD_STATE_SCRIPT,
    [ctx.beadId],
    baseOpts,
  );

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

// ---------------------------------------------------------------------------
// Escalation helper
// ---------------------------------------------------------------------------

/**
 * Run bd-escalate.sh to label the bead needs-human and record the reason.
 *
 * Uses spawnSync directly because bd-escalate.sh does not produce JSON
 * on stdout — it only writes to the bead's notes and adds a label.
 */
function escalate(
  ctx: OrchestratorContext,
  reason: string,
  deps: ShapeDeps,
): void {
  const spawnFn = deps.escalateSpawnFn ?? nodeSpawnSync;

  const result = spawnFn(
    BD_ESCALATE_SCRIPT,
    [ctx.beadId, reason, '3'],
    { shell: true, encoding: 'utf-8' as never, timeout: 30_000 },
  );

  const stderr = result.stderr?.toString() ?? '';
  const exitCode = result.status ?? 1;

  if (stderr) {
    ctx.logger.writePhaseLog(PhaseName.Shape, 'err', stderr);
  }

  if (exitCode !== 0) {
    ctx.logger.writePhaseLog(PhaseName.Shape, 'err',
      `bd-escalate.sh exited with code ${exitCode}\n`);
  }
}
