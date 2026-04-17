/**
 * Canonical wrapper for invoking claude CLI as a subagent.
 *
 * Handles the standard flag set, per-dispatch timeout with process kill,
 * and one-retry-on-malformed-output with a nudge prompt.
 *
 * No external dependencies beyond Node built-ins.
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import type { PhaseName, RunContext, RunLogger } from './context.js';

const DEFAULT_CLAUDE_BIN = '/Users/stephen/.local/bin/claude';

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
  /** Absolute path to the JSON schema file for --json-schema. */
  schemaPath: string;
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
  schemaPath: string,
): string {
  return [
    originalPrompt,
    '',
    '---',
    'IMPORTANT: Your previous response was not valid JSON matching the required schema.',
    `Schema: ${schemaPath}`,
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
  schemaPath: string;
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
    '--json-schema', params.schemaPath,
    '--max-budget-usd', String(params.budgetUsd),
  ];

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
