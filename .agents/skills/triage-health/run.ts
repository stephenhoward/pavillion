/**
 * Command plumbing for the triage-health CLI shell.
 *
 * A local copy of the `run()` helper in .agents/tools/lib/shared.ts, kept here
 * so this skill's script is self-contained — the same propagation that produced
 * .agents/skills/git-cleanup/scripts/lib/run.ts, and for the same reason.
 *
 * Three deliberate differences from the shared original:
 *
 *   1. `shell` is hard-coded to false rather than defaulting to true. The
 *      triage shell passes reporter- and manifest-authored strings as argv —
 *      CVE ids, package names, bead content — and a shell between this process
 *      and `gh`/`bd` would make those strings executable. No caller here wants
 *      a shell, so the option does not exist.
 *   2. `maxBuffer` is caller-supplied. A whole Trivy scan report arrives on one
 *      stdout, and Node's 1 MiB default would truncate it into a parse error
 *      that reads like a corrupt scan.
 *   3. `timeout` is applied only when the caller asks for one, rather than
 *      defaulting to 30 s. `gh run download` fetches a scan artifact over the
 *      network and routinely outruns any default worth setting.
 *
 * A spawn-level failure (the command is not installed, the timeout fired) sets
 * `error` rather than `status`; its message is folded into `stderr` so the
 * caller's diagnostic still says `spawnSync gh ENOENT` rather than a bare exit
 * code.
 *
 * CLI-calling functions accept an injectable `spawnFn` for testing; pure
 * functions have no I/O at all.
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process';

export type SpawnFn = typeof nodeSpawnSync;

export interface SpawnDeps {
  spawnFn?: SpawnFn;
}

/**
 * Run a command synchronously via spawnSync and return trimmed stdout/stderr.
 */
export function run(
  cmd: string,
  args: string[],
  spawnFn: SpawnFn,
  opts: { input?: string; timeout?: number; cwd?: string; maxBuffer?: number } = {},
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnFn(cmd, args, {
    encoding: 'buffer' as never,
    shell: false,
    ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
    ...(opts.maxBuffer !== undefined ? { maxBuffer: opts.maxBuffer } : {}),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    ...(opts.input !== undefined ? { input: Buffer.from(opts.input) } : {}),
  });
  const stderr = (result.stderr?.toString('utf-8') ?? '').trim();
  const spawnError = result.error?.message;
  return {
    stdout: (result.stdout?.toString('utf-8') ?? '').trim(),
    stderr: spawnError ? [stderr, spawnError].filter(Boolean).join(': ') : stderr,
    exitCode: result.status ?? 1,
  };
}
