/**
 * Command plumbing for the git-cleanup scripts.
 *
 * A local copy of the `run()` helper in .claude/tools/lib/shared.ts, kept here
 * so this skill's scripts are self-contained. The one deliberate difference:
 * `shell` is hard-coded to false rather than defaulting to true. git-cleanup
 * passes attacker-influenced strings — branch names, worktree paths — as
 * argv, and a shell between this process and git would make those strings
 * executable. There is no caller here that wants a shell, so the option does
 * not exist.
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
    shell: false,
    timeout: opts.timeout ?? 30_000,
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    ...(opts.input !== undefined ? { input: Buffer.from(opts.input) } : {}),
  });
  return {
    stdout: (result.stdout?.toString('utf-8') ?? '').trim(),
    stderr: (result.stderr?.toString('utf-8') ?? '').trim(),
    exitCode: result.status ?? 1,
  };
}
