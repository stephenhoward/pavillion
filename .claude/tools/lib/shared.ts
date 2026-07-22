/**
 * Shared plumbing for the agent-facing CLI tools in .claude/tools/.
 *
 * CLI-calling functions accept an injectable `spawnFn` for testing; pure
 * functions have no I/O at all.
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process';

export type SpawnFn = typeof nodeSpawnSync;

export interface SpawnDeps {
  spawnFn?: SpawnFn;
  /**
   * Working directory for spawned commands. Used by the gh-stack helpers
   * when a chain runs in its own git worktree (see git-workflow/stacking.md,
   * "native gh-stack-in-worktrees" — decision memo D2): gh-stack state is a
   * per-git-dir JSON file, NOT shared across worktrees, so stack operations
   * must run from the checkout that holds the branch being operated on.
   */
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
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    ...(opts.input !== undefined ? { input: Buffer.from(opts.input) } : {}),
  });
  return {
    stdout: (result.stdout?.toString('utf-8') ?? '').trim(),
    stderr: (result.stderr?.toString('utf-8') ?? '').trim(),
    exitCode: result.status ?? 1,
  };
}
