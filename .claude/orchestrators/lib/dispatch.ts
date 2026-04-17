/**
 * All external-process execution primitives for the orchestrator.
 *
 * Merges:
 *   - dispatch()        — async claude CLI subagent invocation with timeout + retry
 *   - runScript()       — sync .sh helper script runner with JSON output
 *   - spawnCmd()        — thin sync command wrapper for git/gh/bd calls
 *   - fanOutAdvisors()  — parallel advisor dispatch + verdict aggregation
 *
 * No external dependencies beyond Node built-ins.
 */

import { spawn as nodeSpawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'node:child_process';
import { existsSync as nodeExistsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PhaseName, RunContext, RunLogger } from './types.js';

const DEFAULT_CLAUDE_BIN = 'claude';

/**
 * Error thrown when a dispatch exceeds its timeout.
 */
export class DispatchTimeoutError extends Error {
  constructor(agent: string, timeoutMs: number) {
    super(`Dispatch to agent "${agent}" timed out after ${timeoutMs}ms`);
    this.name = 'DispatchTimeoutError';
  }
}

/**
 * Error thrown when output fails JSON parse/schema validation on both attempts.
 */
export class DispatchMalformedError extends Error {
  readonly stdout: string;
  readonly parseError: string;

  constructor(agent: string, stdout: string, parseError: string) {
    super(`Dispatch to agent "${agent}" returned malformed output after retry`);
    this.name = 'DispatchMalformedError';
    this.stdout = stdout;
    this.parseError = parseError;
  }
}

/**
 * Error thrown when the claude process exits with a non-zero code
 * (not a timeout or malformed-output scenario).
 */
export class DispatchSpawnError extends Error {
  readonly exitCode: number;
  readonly stderr: string;

  constructor(agent: string, exitCode: number, stderr: string) {
    super(`Dispatch to agent "${agent}" failed with exit code ${exitCode}`);
    this.name = 'DispatchSpawnError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * Options for a single dispatch invocation.
 */
export interface DispatchOptions {
  /** Agent name (maps to .claude/agents/<name>.md). */
  agent: string;
  /** Absolute path to the JSON schema file for --json-schema. Omit for prose-output agents. */
  schemaPath?: string;
  /** Prompt text sent to the agent via stdin. */
  prompt: string;
  /** Max budget in USD for this dispatch. */
  budgetUsd: number;
  /** Timeout in ms; kills process if exceeded. */
  timeoutMs: number;
  /** Run context threaded through the orchestrator. */
  ctx: RunContext;
  /** Phase name for log tagging. */
  logTag: PhaseName;
  /** Whether to pass --fallback-model. */
  fallbackModel?: boolean;
  /** Override spawn function (for testing). */
  spawnFn?: typeof nodeSpawn;
}

/**
 * Invoke a claude subagent with the canonical flag set.
 *
 * - Passes prompt on stdin (via -p flag for retry, stdin for initial).
 * - Races the child process against a timeout.
 * - On malformed JSON output, retries once with a nudge prompt.
 * - Logs stdout + stderr to the run's log directory.
 *
 * @returns Parsed JSON output from the agent, typed as T.
 */
export async function dispatch<T = unknown>(opts: DispatchOptions): Promise<T> {
  const { agent, ctx, logTag } = opts;
  const logger = ctx.logger;

  // Log dispatch start (truncate prompt for privacy)
  logger.appendRunJson({
    event: 'dispatch-start',
    agent,
    phase: logTag,
    promptLength: opts.prompt.length,
    promptPreview: opts.prompt.length > 200
      ? opts.prompt.slice(0, 200) + '...'
      : opts.prompt,
    budgetUsd: opts.budgetUsd,
    timeoutMs: opts.timeoutMs,
  });

  try {
    return await runSingleDispatch<T>(opts, opts.prompt, false);
  }
  catch (err) {
    // Only retry on malformed output, not on timeout or spawn errors
    if (isMalformedError(err)) {
      const parseErr = (err as { parseError: string }).parseError;
      logger.writePhaseLog(logTag, 'err',
        `Malformed output from "${agent}", retrying with nudge...\n`);

      const nudge = buildNudgePrompt(opts.prompt, parseErr, opts.schemaPath);

      try {
        return await runSingleDispatch<T>(opts, nudge, true);
      }
      catch (retryErr) {
        if (isMalformedError(retryErr)) {
          const finalErr = retryErr as MalformedInternal;
          throw new DispatchMalformedError(agent, finalErr.stdout, finalErr.parseError);
        }
        throw retryErr;
      }
    }
    throw err;
  }
}

/**
 * Internal malformed-output sentinel used between first attempt and retry.
 */
interface MalformedInternal {
  _malformed: true;
  stdout: string;
  parseError: string;
}

function isMalformedError(err: unknown): err is MalformedInternal {
  return (
    typeof err === 'object' &&
    err !== null &&
    '_malformed' in err &&
    (err as MalformedInternal)._malformed === true
  );
}

/**
 * Build a nudge prompt that includes the original prompt + validation error.
 */
function buildNudgePrompt(
  originalPrompt: string,
  parseError: string,
  schemaPath?: string,
): string {
  return [
    originalPrompt,
    '',
    '---',
    'IMPORTANT: Your previous response was not valid JSON matching the required schema.',
    ...(schemaPath ? [`Schema: ${schemaPath}`] : []),
    `Validation error: ${parseError}`,
    '',
    'Please respond with ONLY valid JSON that conforms to the schema. No extra text.',
  ].join('\n');
}

/**
 * Run a single claude CLI invocation and return parsed JSON.
 *
 * Throws MalformedInternal (sentinel) on JSON parse failure,
 * DispatchTimeoutError on timeout, DispatchSpawnError on non-zero exit.
 */
function runSingleDispatch<T>(
  opts: DispatchOptions,
  prompt: string,
  isRetry: boolean,
): Promise<T> {
  const {
    agent,
    schemaPath,
    budgetUsd,
    timeoutMs,
    ctx,
    logTag,
    fallbackModel,
    spawnFn = nodeSpawn,
  } = opts;
  const logger = ctx.logger;
  const claudeBin = process.env.CLAUDE_BIN ?? DEFAULT_CLAUDE_BIN;

  const args = buildArgs({
    agent,
    schemaPath,
    budgetUsd,
    fallbackModel,
    prompt,
    isRetry,
  });

  const child: ChildProcess = spawnFn(claudeBin, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  // Write prompt to stdin for initial dispatch
  if (!isRetry && child.stdin) {
    child.stdin.write(prompt);
    child.stdin.end();
  }

  return new Promise<T>((resolve, reject) => {
    let stdoutBuf = '';
    let stderrBuf = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function settle(): void {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      settled = true;
    }

    // Collect stdout
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf-8');
    });

    // Collect stderr
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf-8');
    });

    // Timeout handler
    timer = setTimeout(() => {
      if (settled) return;
      settle();
      child.kill('SIGTERM');
      // Log before rejecting
      logStreams(logger, logTag, stdoutBuf, stderrBuf);
      reject(new DispatchTimeoutError(agent, timeoutMs));
    }, timeoutMs);

    // Process close handler
    child.on('close', (code: number | null) => {
      if (settled) return;
      settle();

      // Log streams
      logStreams(logger, logTag, stdoutBuf, stderrBuf);

      const exitCode = code ?? 1;

      // Non-zero exit: spawn error
      if (exitCode !== 0) {
        reject(new DispatchSpawnError(agent, exitCode, stderrBuf));
        return;
      }

      // When no schema was provided, return raw stdout (prose agent)
      if (!schemaPath) {
        logger.appendRunJson({
          event: isRetry ? 'dispatch-retry-success' : 'dispatch-success',
          agent,
          phase: logTag,
        });
        resolve(stdoutBuf as unknown as T);
        return;
      }

      // Attempt JSON parse
      try {
        const json = JSON.parse(stdoutBuf) as T;
        logger.appendRunJson({
          event: isRetry ? 'dispatch-retry-success' : 'dispatch-success',
          agent,
          phase: logTag,
        });
        resolve(json);
      }
      catch (parseErr) {
        const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        const sentinel: MalformedInternal = {
          _malformed: true,
          stdout: stdoutBuf,
          parseError: errMsg,
        };
        reject(sentinel);
      }
    });
  });
}

/**
 * Build the CLI argument array.
 */
function buildArgs(params: {
  agent: string;
  schemaPath?: string;
  budgetUsd: number;
  fallbackModel?: boolean;
  prompt: string;
  isRetry: boolean;
}): string[] {
  const args = [
    '--bare',
    '--permission-mode', 'bypassPermissions',
    '--no-session-persistence',
    '--agent', params.agent,
    '--max-budget-usd', String(params.budgetUsd),
  ];

  if (params.schemaPath) {
    args.push('--json-schema', params.schemaPath);
  }

  if (params.fallbackModel) {
    args.push('--fallback-model');
  }

  // For retry, pass the nudge prompt via -p flag
  if (params.isRetry) {
    args.push('-p', params.prompt);
  } else {
    // Initial dispatch uses -p with stdin read
    args.push('-p', '-');
  }

  return args;
}

/**
 * Write captured stdout/stderr to the logger.
 */
function logStreams(
  logger: RunLogger,
  logTag: PhaseName,
  stdout: string,
  stderr: string,
): void {
  if (stdout) {
    logger.writePhaseLog(logTag, 'out', stdout);
  }
  if (stderr) {
    logger.writePhaseLog(logTag, 'err', stderr);
  }
}

// =============================================================================
// runScript — synchronous .sh helper script runner
// =============================================================================

/**
 * Typed result returned by runScript on success (exit code 0).
 */
export interface RunScriptSuccess<T = unknown> {
  json: T;
  exitCode: 0;
  stderr: string;
}

/**
 * Typed result returned by runScript on non-zero exit.
 */
export interface RunScriptFailure {
  json: null;
  exitCode: number;
  stderr: string;
  stdout: string;
}

export type RunScriptResult<T = unknown> = RunScriptSuccess<T> | RunScriptFailure;

/**
 * Error thrown when a script produces malformed JSON on stdout.
 */
export class RunScriptError extends Error {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;

  constructor(message: string, opts: { exitCode: number; stderr: string; stdout: string; cause?: unknown }) {
    super(message, { cause: opts.cause });
    this.name = 'RunScriptError';
    this.exitCode = opts.exitCode;
    this.stderr = opts.stderr;
    this.stdout = opts.stdout;
  }
}

/**
 * Options for runScript, including the injectable spawn function.
 */
export interface RunScriptOptions {
  /** Logger to write stdout/stderr to the run-id log dir. */
  logger: RunLogger;
  /** Phase name used as the log-file tag. */
  logTag: PhaseName;
  /** Override the spawn implementation (for testing). */
  spawnFn?: typeof spawnSync;
  /** Override the file-existence check (for testing). */
  existsFn?: (path: string) => boolean;
}

/**
 * Invoke a .sh helper script synchronously and return parsed JSON output.
 *
 * - On exit 0: parses stdout as JSON, returns { json, exitCode: 0, stderr }.
 * - On non-zero exit: returns { json: null, exitCode, stderr, stdout } without
 *   attempting JSON parse.
 * - On exit 0 with malformed JSON: throws RunScriptError.
 * - If scriptPath does not exist: throws RunScriptError.
 *
 * Both stdout and stderr are written to the logger regardless of outcome.
 */
export function runScript<T = unknown>(
  scriptPath: string,
  args: string[],
  opts: RunScriptOptions,
): RunScriptResult<T> {
  const { logger, logTag, spawnFn = spawnSync, existsFn = nodeExistsSync } = opts;

  // Verify script exists before spawning
  if (!existsFn(scriptPath)) {
    const err = new RunScriptError(
      `Script not found: ${scriptPath}`,
      { exitCode: -1, stderr: '', stdout: '' },
    );
    logger.writePhaseLog(logTag, 'err', `RunScriptError: ${err.message}\n`);
    throw err;
  }

  const result: SpawnSyncReturns<Buffer> = spawnFn(scriptPath, args, {
    encoding: 'buffer' as never,
    shell: true,
    timeout: 60_000,
  });

  const stdout = result.stdout?.toString('utf-8') ?? '';
  const stderr = result.stderr?.toString('utf-8') ?? '';
  const exitCode = result.status ?? 1;

  // Log both streams
  if (stdout) {
    logger.writePhaseLog(logTag, 'out', stdout);
  }
  if (stderr) {
    logger.writePhaseLog(logTag, 'err', stderr);
  }

  // Non-zero exit: return failure without parsing JSON
  if (exitCode !== 0) {
    return { json: null, exitCode, stderr, stdout };
  }

  // Exit 0: parse strict JSON from stdout
  try {
    const json = JSON.parse(stdout) as T;
    return { json, exitCode: 0, stderr };
  }
  catch (cause) {
    throw new RunScriptError(
      `Malformed JSON from ${scriptPath}: ${(cause as Error).message}`,
      { exitCode, stderr, stdout, cause },
    );
  }
}

// =============================================================================
// spawnCmd — thin synchronous command wrapper (git/gh/bd calls)
// =============================================================================

/**
 * Result of a synchronous command invocation.
 */
export interface CmdResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a command synchronously and return stdout/stderr/exitCode.
 *
 * Logs output to the run logger. Used for short-lived commands like
 * git, gh, and bd where async is unnecessary overhead.
 */
export function spawnCmd(
  cmd: string,
  args: string[],
  logger: RunLogger,
  logTag: PhaseName,
  spawnFn: typeof spawnSync = spawnSync,
  env?: Record<string, string>,
): CmdResult {
  const result: SpawnSyncReturns<Buffer> = spawnFn(cmd, args, {
    encoding: 'buffer' as never,
    shell: true,
    timeout: 120_000,
    env: env ? { ...process.env, ...env } : undefined,
  });
  const stdout = (result.stdout?.toString('utf-8') ?? '').trim();
  const stderr = (result.stderr?.toString('utf-8') ?? '').trim();
  const exitCode = result.status ?? 1;
  if (stdout) logger.writePhaseLog(logTag, 'out', stdout + '\n');
  if (stderr) logger.writePhaseLog(logTag, 'err', stderr + '\n');
  return { stdout, stderr, exitCode };
}

// =============================================================================
// fanOutAdvisors — parallel advisor dispatch + verdict aggregation
// =============================================================================

const ADVISOR_VERDICT_SCHEMA = resolve(
  '.claude/orchestrators/schemas/advisor-verdict.json',
);

/** Default per-advisor budget in USD. Override via ORCH_BUDGET_ADVISOR env var. */
export const ADVISOR_BUDGET_DEFAULT = 0.75;

/** Default per-advisor timeout in ms. */
export const ADVISOR_TIMEOUT_MS = 120_000;

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

export interface FanOutDeps {
  /** Override the dispatch function (for testing). */
  dispatchFn?: (opts: DispatchOptions) => Promise<AdvisorVerdict>;
}

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
