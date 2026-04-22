import { describe, it, expect, vi } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { PhaseName, type RunLogger } from '../../lib/types.js';
import type { PhaseCtx } from '../../lib/execute.js';
import { verifyImplementerCompletion } from '../../lib/execute.js';

function stubLogger(): {
  logger: RunLogger;
  runJsonEntries: Record<string, unknown>[];
} {
  const runJsonEntries: Record<string, unknown>[] = [];
  const logger: RunLogger = {
    writePhaseLog: vi.fn(),
    appendRunJson(entry) { runJsonEntries.push(entry); },
    runDir: () => '/tmp/fake-run-dir',
  };
  return { logger, runJsonEntries };
}

function fakeSpawnResult(stdout: string, status = 0): SpawnSyncReturns<Buffer> {
  return {
    stdout: Buffer.from(stdout, 'utf-8'),
    stderr: Buffer.from('', 'utf-8'),
    status,
    signal: null,
    pid: 1234,
    output: [null, Buffer.from(stdout), Buffer.from('')],
  };
}

function makeCtx(logStub: ReturnType<typeof stubLogger>, beadId = 'pv-test.1'): PhaseCtx {
  return {
    runId: 'test-run',
    beadId,
    logger: logStub.logger,
    phaseHistory: [],
    dryRun: false,
  };
}

describe('verifyImplementerCompletion', () => {
  it('returns passed with changedFiles when tree is clean and commits exist', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub);

    const scriptSpawnFn = vi.fn()
      .mockReturnValueOnce(fakeSpawnResult(''))
      .mockReturnValueOnce(fakeSpawnResult('2\n'))
      .mockReturnValueOnce(fakeSpawnResult('src/a.ts\nsrc/b.ts\n'));

    const result = verifyImplementerCompletion(ctx, { scriptSpawnFn });

    expect(result).toEqual({
      passed: true,
      changedFiles: ['src/a.ts', 'src/b.ts'],
    });

    expect(logStub.runJsonEntries).toContainEqual(
      expect.objectContaining({
        event: 'implementer-verification-passed',
        beadId: 'pv-test.1',
        changedFilesCount: 2,
      }),
    );
  });

  it('fails closed when git status exits non-zero', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub);

    const scriptSpawnFn = vi.fn()
      .mockReturnValueOnce({
        ...fakeSpawnResult(''),
        status: 128,
        stderr: Buffer.from('fatal: not a git repository\n', 'utf-8'),
      });

    const result = verifyImplementerCompletion(ctx, { scriptSpawnFn });

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toMatch(/^git status --porcelain failed:/);
      expect(result.reason).toContain('fatal: not a git repository');
    }
    expect(scriptSpawnFn).toHaveBeenCalledTimes(1);
  });

  it('fails closed when git rev-list exits non-zero', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub);

    const scriptSpawnFn = vi.fn()
      .mockReturnValueOnce(fakeSpawnResult(''))
      .mockReturnValueOnce({
        ...fakeSpawnResult(''),
        status: 128,
        stderr: Buffer.from('fatal: bad revision \'main..HEAD\'\n', 'utf-8'),
      });

    const result = verifyImplementerCompletion(ctx, { scriptSpawnFn });

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toMatch(/^git rev-list --count failed:/);
    }
  });

  it('fails closed when git diff exits non-zero', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub);

    const scriptSpawnFn = vi.fn()
      .mockReturnValueOnce(fakeSpawnResult(''))
      .mockReturnValueOnce(fakeSpawnResult('2\n'))
      .mockReturnValueOnce({
        ...fakeSpawnResult(''),
        status: 1,
        stderr: Buffer.from('something broke\n', 'utf-8'),
      });

    const result = verifyImplementerCompletion(ctx, { scriptSpawnFn });

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toMatch(/^git diff --name-only failed:/);
    }
  });

  it('fails closed when rev-list returns non-numeric garbage', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub);

    const scriptSpawnFn = vi.fn()
      .mockReturnValueOnce(fakeSpawnResult(''))
      .mockReturnValueOnce(fakeSpawnResult('abc\n'));

    const result = verifyImplementerCompletion(ctx, { scriptSpawnFn });

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toBe('no commits on branch ahead of main');
    }
  });

  it('returns passed=false with porcelain reason when tree is dirty', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub);

    const scriptSpawnFn = vi.fn()
      .mockReturnValueOnce(fakeSpawnResult(' M src/a.ts\n'));

    const result = verifyImplementerCompletion(ctx, { scriptSpawnFn });

    expect(result).toEqual({
      passed: false,
      reason: 'uncommitted or untracked changes present: M src/a.ts',
    });

    expect(scriptSpawnFn).toHaveBeenCalledTimes(1);

    expect(logStub.runJsonEntries).toContainEqual(
      expect.objectContaining({
        event: 'implementer-verification-failed',
        beadId: 'pv-test.1',
        reason: 'uncommitted or untracked changes present: M src/a.ts',
      }),
    );
  });

  it('returns passed=false for untracked files only', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub);

    const scriptSpawnFn = vi.fn()
      .mockReturnValueOnce(fakeSpawnResult('?? src/newfile.ts\n'));

    const result = verifyImplementerCompletion(ctx, { scriptSpawnFn });

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toContain('?? src/newfile.ts');
    }
  });
});
