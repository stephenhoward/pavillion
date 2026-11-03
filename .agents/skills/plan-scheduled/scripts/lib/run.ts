/**
 * Command plumbing for the plan-scheduled scripts.
 *
 * A local copy of the `run()` helper in .agents/tools/lib/shared.ts, kept here
 * so this skill's scripts are self-contained.
 *
 * CLI-calling functions accept an injectable `spawnFn` for testing; pure
 * functions have no I/O at all.
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process';

export type SpawnFn = typeof nodeSpawnSync;

export interface SpawnDeps {
  spawnFn?: SpawnFn;
  /** Working directory for spawned commands. */
  cwd?: string;
}

/**
 * Run a command synchronously via spawnSync and return trimmed stdout/stderr.
 */
export function run(
  cmd: string,
  args: string[],
  spawnFn: SpawnFn,
  opts: { input?: string; timeout?: number; cwd?: string } = {},
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnFn(cmd, args, {
    encoding: 'buffer' as never,
    shell: true,
    timeout: opts.timeout ?? 30_000,
    // `bd list --all --json` with notes exceeds spawnSync's 1 MiB default;
    // an overflow kills the child with an empty stderr and no status.
    maxBuffer: 256 * 1024 * 1024,
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    ...(opts.input !== undefined ? { input: Buffer.from(opts.input) } : {}),
  });
  return {
    stdout: (result.stdout?.toString('utf-8') ?? '').trim(),
    stderr: (result.stderr?.toString('utf-8') ?? '').trim(),
    exitCode: result.status ?? 1,
  };
}
