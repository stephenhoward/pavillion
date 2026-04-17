/**
 * Wrapper for invoking .sh helper scripts from the orchestrator.
 *
 * Parses strict JSON from stdout, surfaces exit codes, and threads
 * stderr through the logger. Uses child_process.spawnSync by default;
 * accepts an injectable spawn function for testing.
 *
 * No external dependencies beyond Node built-ins.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync as nodeExistsSync } from 'node:fs';
import type { PhaseName, RunLogger } from './context.js';

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
