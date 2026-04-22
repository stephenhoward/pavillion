import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyImplementerCompletion } from '../../lib/execute.js';
import { type RunLogger } from '../../lib/types.js';
import type { PhaseCtx } from '../../lib/execute.js';

/**
 * Runs the verification gate against a real ephemeral git repo.
 * Catches wrong-flag-to-git bugs that unit stubs miss:
 * `main..HEAD` vs `main...HEAD` semantics, porcelain format drift, etc.
 */
describe('verifyImplementerCompletion — integration', () => {
  let repoDir: string;

  function git(...args: string[]): string {
    const result = spawnSync('git', args, {
      cwd: repoDir,
      encoding: 'utf-8',
    });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  /**
   * spawnFn that injects `cwd: repoDir` into every invocation so the
   * verification gate runs against our ephemeral repo without relying on
   * `process.chdir()` (unsupported in Vitest workers).
   */
  function repoScopedSpawn(
    command: string,
    args: readonly string[],
    options: SpawnSyncOptions,
  ): SpawnSyncReturns<Buffer> {
    return spawnSync(command, args as string[], {
      ...options,
      cwd: repoDir,
    }) as SpawnSyncReturns<Buffer>;
  }

  function makeCtx(): PhaseCtx {
    const runJsonEntries: Record<string, unknown>[] = [];
    const logger: RunLogger = {
      writePhaseLog: () => {},
      appendRunJson: (e) => runJsonEntries.push(e),
      runDir: () => '/tmp/fake',
    };
    return {
      runId: 'integration-run',
      beadId: 'pv-int.1',
      logger,
      phaseHistory: [],
      dryRun: false,
    };
  }

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'verify-gate-'));

    // git 2.28+ supports --initial-branch; fall back to rename if unavailable.
    const initResult = spawnSync('git', ['init', '--initial-branch=main'], {
      cwd: repoDir,
      encoding: 'utf-8',
    });
    if (initResult.status !== 0) {
      git('init');
      git('branch', '-m', 'main');
    }
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    writeFileSync(join(repoDir, 'README.md'), '# test\n');
    git('add', 'README.md');
    git('commit', '-m', 'initial');

    git('checkout', '-b', 'feat/test');
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns passed=false when working tree has a modified file', () => {
    writeFileSync(join(repoDir, 'README.md'), '# test changed\n');

    const result = verifyImplementerCompletion(makeCtx(), { scriptSpawnFn: repoScopedSpawn as never });

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toMatch(/uncommitted or untracked/);
    }
  });

  it('returns passed=false when working tree has an untracked file', () => {
    writeFileSync(join(repoDir, 'new.ts'), 'export {};\n');

    const result = verifyImplementerCompletion(makeCtx(), { scriptSpawnFn: repoScopedSpawn as never });

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toMatch(/\?\? new\.ts/);
    }
  });

  it('returns passed=false when branch has no commits ahead of main', () => {
    const result = verifyImplementerCompletion(makeCtx(), { scriptSpawnFn: repoScopedSpawn as never });

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toBe('no commits on branch ahead of main');
    }
  });

  it('returns passed=true with accurate changedFiles when a commit exists and tree is clean', () => {
    writeFileSync(join(repoDir, 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(repoDir, 'b.ts'), 'export const b = 2;\n');
    git('add', 'a.ts', 'b.ts');
    git('commit', '-m', 'add a and b');

    const result = verifyImplementerCompletion(makeCtx(), { scriptSpawnFn: repoScopedSpawn as never });

    expect(result.passed).toBe(true);
    if (result.passed) {
      expect(result.changedFiles.sort()).toEqual(['a.ts', 'b.ts']);
    }
  });
});
