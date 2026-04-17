/**
 * Shared parallel advisor dispatch and verdict aggregation.
 *
 * Extracted so that both phase-3.5-advisors and phase-5.5-advisors
 * can reuse the same fan-out + aggregation logic with different context.
 *
 * No external dependencies beyond Node built-ins + sibling modules.
 */

import { resolve } from 'node:path';
import { PhaseName, type RunContext } from './context.js';
import {
  dispatch,
  DispatchMalformedError,
  DispatchTimeoutError,
  DispatchSpawnError,
  type DispatchOptions,
} from './dispatch.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADVISOR_VERDICT_SCHEMA = resolve(
  '.claude/orchestrators/schemas/advisor-verdict.json',
);

/** Default per-advisor budget in USD. Override via ORCH_BUDGET_ADVISOR env var. */
export const ADVISOR_BUDGET_DEFAULT = 0.75;

/** Default per-advisor timeout in ms. */
export const ADVISOR_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Types (mirrors JSON schemas)
// ---------------------------------------------------------------------------

export interface AdvisorVerdict {
  agent: string;
  verdict: 'clean' | 'refinement-needed' | 'escalate';
  concerns: string[];
  recommendations: string[];
  shapedBeadId?: string;
}

export interface RefinementReport {
  beadId: string;
  phase: 'phase-3-shape' | 'phase-5-analyze';
  advisors: AdvisorVerdict[];
  overallVerdict: 'clean' | 'refinement-needed';
  summary: string;
}

export interface MatchedAdvisor {
  name: string;
  path: string;
  description: string;
  rationale: string;
}

// ---------------------------------------------------------------------------
// Deps injection for testing
// ---------------------------------------------------------------------------

export interface FanOutDeps {
  /** Override the dispatch function (for testing). */
  dispatchFn?: (opts: DispatchOptions) => Promise<AdvisorVerdict>;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the prompt for a single advisor dispatch.
 */
export function buildAdvisorPrompt(
  advisorName: string,
  beadId: string,
  beadContext: string,
): string {
  return [
    `# Advisory review: ${advisorName}`,
    '',
    `Review bead \`${beadId}\` using your domain-specific standards.`,
    '',
    '## Bead Context',
    '',
    beadContext,
    '',
    '## Output format',
    '',
    'Respond with JSON matching the advisor-verdict schema:',
    '```json',
    '{',
    `  "agent": "${advisorName}",`,
    '  "verdict": "clean" | "refinement-needed" | "escalate",',
    '  "concerns": ["..."],',
    '  "recommendations": ["..."],',
    `  "shapedBeadId": "${beadId}"`,
    '}',
    '```',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Core fan-out function
// ---------------------------------------------------------------------------

/**
 * Dispatch all matched advisors in parallel, collect verdicts,
 * and aggregate into a RefinementReport.
 *
 * A single advisor failure (timeout, malformed output, spawn error)
 * becomes a "concern" entry in the report rather than a catastrophic abort.
 */
export async function fanOutAdvisors(
  advisors: MatchedAdvisor[],
  beadId: string,
  beadContext: string,
  phase: 'phase-3-shape' | 'phase-5-analyze',
  ctx: RunContext,
  logTag: PhaseName,
  deps: FanOutDeps = {},
): Promise<RefinementReport> {
  const dispatchFn = deps.dispatchFn ?? dispatch;
  const budgetUsd = parseFloat(process.env.ORCH_BUDGET_ADVISOR ?? '') || ADVISOR_BUDGET_DEFAULT;
  const timeoutMs = parseInt(process.env.ORCH_TIMEOUT_ADVISOR ?? '', 10) || ADVISOR_TIMEOUT_MS;

  ctx.logger.appendRunJson({
    event: 'advisors_fan_out_start',
    beadId,
    phase: logTag,
    advisorCount: advisors.length,
    advisorNames: advisors.map(a => a.name),
  });

  // Dispatch all advisors in parallel
  const settledResults = await Promise.allSettled(
    advisors.map(async (advisor): Promise<AdvisorVerdict> => {
      const prompt = buildAdvisorPrompt(advisor.name, beadId, beadContext);

      return dispatchFn({
        agent: advisor.name,
        schemaPath: ADVISOR_VERDICT_SCHEMA,
        prompt,
        budgetUsd,
        timeoutMs,
        ctx,
        logTag,
      });
    }),
  );

  // Collect verdicts, turning failures into concern entries
  const verdicts: AdvisorVerdict[] = settledResults.map((result, i) => {
    const advisorName = advisors[i].name;

    if (result.status === 'fulfilled') {
      ctx.logger.appendRunJson({
        event: 'advisor_verdict_received',
        agent: advisorName,
        verdict: result.value.verdict,
      });
      return result.value;
    }

    // Failed dispatch: create a synthetic escalate verdict
    const err = result.reason;
    let reason: string;

    if (err instanceof DispatchTimeoutError) {
      reason = `Advisor "${advisorName}" timed out`;
    }
    else if (err instanceof DispatchMalformedError) {
      reason = `Advisor "${advisorName}" returned malformed output`;
    }
    else if (err instanceof DispatchSpawnError) {
      reason = `Advisor "${advisorName}" failed with exit code ${err.exitCode}`;
    }
    else {
      reason = `Advisor "${advisorName}" failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    ctx.logger.appendRunJson({
      event: 'advisor_dispatch_failed',
      agent: advisorName,
      reason,
    });

    return {
      agent: advisorName,
      verdict: 'escalate' as const,
      concerns: [reason],
      recommendations: [],
    };
  });

  // Aggregate into report
  const allClean = verdicts.every(v => v.verdict === 'clean');
  const overallVerdict: 'clean' | 'refinement-needed' = allClean ? 'clean' : 'refinement-needed';

  const concerns = verdicts
    .filter(v => v.verdict !== 'clean')
    .flatMap(v => v.concerns.map(c => `[${v.agent}] ${c}`));

  const summary = allClean
    ? `All ${verdicts.length} advisor(s) approved the bead plan.`
    : `${concerns.length} concern(s) from ${verdicts.filter(v => v.verdict !== 'clean').length} advisor(s): ${concerns.slice(0, 3).join('; ')}${concerns.length > 3 ? ` (+${concerns.length - 3} more)` : ''}`;

  const report: RefinementReport = {
    beadId,
    phase,
    advisors: verdicts,
    overallVerdict,
    summary,
  };

  ctx.logger.appendRunJson({
    event: 'advisors_fan_out_complete',
    beadId,
    overallVerdict,
    advisorCount: verdicts.length,
    summary,
  });

  return report;
}
