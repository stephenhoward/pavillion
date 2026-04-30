import { describe, it, expect, vi } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { PhaseName, type RunLogger } from '../../lib/types.js';
import type { PhaseCtx } from '../../lib/execute.js';
import { verifyImplementerCompletion, reopenBead, extractExpectedFiles } from '../../lib/execute.js';

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

  it('returns passed=false when branch has zero commits ahead of main', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub);

    const scriptSpawnFn = vi.fn()
      .mockReturnValueOnce(fakeSpawnResult(''))
      .mockReturnValueOnce(fakeSpawnResult('0\n'));

    const result = verifyImplementerCompletion(ctx, { scriptSpawnFn });

    expect(result).toEqual({
      passed: false,
      reason: 'no commits on branch ahead of main',
    });

    expect(scriptSpawnFn).toHaveBeenCalledTimes(2);

    expect(logStub.runJsonEntries).toContainEqual(
      expect.objectContaining({
        event: 'implementer-verification-failed',
        reason: 'no commits on branch ahead of main',
      }),
    );
  });

  it('honors GIT_SAFE_MAIN_BRANCH override in the reason string', () => {
    const prev = process.env.GIT_SAFE_MAIN_BRANCH;
    process.env.GIT_SAFE_MAIN_BRANCH = 'develop';
    try {
      const logStub = stubLogger();
      const ctx = makeCtx(logStub);

      const scriptSpawnFn = vi.fn()
        .mockReturnValueOnce(fakeSpawnResult(''))
        .mockReturnValueOnce(fakeSpawnResult('0\n'));

      const result = verifyImplementerCompletion(ctx, { scriptSpawnFn });

      expect(result).toEqual({
        passed: false,
        reason: 'no commits on branch ahead of develop',
      });

      expect(scriptSpawnFn).toHaveBeenNthCalledWith(
        2,
        'git',
        ['rev-list', '--count', 'develop..HEAD'],
        expect.any(Object),
      );
    }
    finally {
      if (prev === undefined) delete process.env.GIT_SAFE_MAIN_BRANCH;
      else process.env.GIT_SAFE_MAIN_BRANCH = prev;
    }
  });
});

describe('verifyImplementerCompletion expectedFiles scoping', () => {
  it('scopes git status to expectedFiles when provided', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub);

    // Sibling implementer left b.ts dirty in the shared tree, but this bead
    // owns only a.ts — git status -- a.ts comes back clean.
    const scriptSpawnFn = vi.fn()
      .mockReturnValueOnce(fakeSpawnResult(''))
      .mockReturnValueOnce(fakeSpawnResult('1\n'))
      .mockReturnValueOnce(fakeSpawnResult('src/a.ts\n'));

    const result = verifyImplementerCompletion(ctx, { scriptSpawnFn }, ['src/a.ts']);

    expect(result.passed).toBe(true);
    expect(scriptSpawnFn).toHaveBeenNthCalledWith(
      1,
      'git',
      ['status', '--porcelain', '--', 'src/a.ts'],
      expect.any(Object),
    );
  });

  it('falls back to whole-tree check when expectedFiles is empty', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub);

    const scriptSpawnFn = vi.fn()
      .mockReturnValueOnce(fakeSpawnResult(''))
      .mockReturnValueOnce(fakeSpawnResult('1\n'))
      .mockReturnValueOnce(fakeSpawnResult('src/a.ts\n'));

    verifyImplementerCompletion(ctx, { scriptSpawnFn }, []);

    expect(scriptSpawnFn).toHaveBeenNthCalledWith(
      1,
      'git',
      ['status', '--porcelain'],
      expect.any(Object),
    );
  });

  it('still flags scoped files as dirty when status output is non-empty', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub);

    const scriptSpawnFn = vi.fn()
      .mockReturnValueOnce(fakeSpawnResult(' M src/a.ts\n'));

    const result = verifyImplementerCompletion(ctx, { scriptSpawnFn }, ['src/a.ts']);

    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.reason).toContain('src/a.ts');
    }
  });
});

describe('extractExpectedFiles', () => {
  function fakeBdShow(notes: string): SpawnSyncReturns<Buffer> {
    const json = JSON.stringify([{ id: 'pv-test.1', notes }]);
    return fakeSpawnResult(json);
  }

  it('extracts backticked paths from a Files to Modify block', () => {
    const notes = `
# Implementation Context

## Files to Modify
- \`src/foo.ts\`
  Reason: Add new helper.
- \`src/bar.vue\`
  Reason: Use the helper.

## Relevant Tests
- \`src/test/foo.test.ts\`
`;
    const scriptSpawnFn = vi.fn().mockReturnValueOnce(fakeBdShow(notes));
    const files = extractExpectedFiles('pv-test.1', { scriptSpawnFn });
    expect(files).toEqual(['src/foo.ts', 'src/bar.vue']);
  });

  it('returns [] for verification-only beads with "- None" sentinel', () => {
    const notes = `
## Files to Modify
- None (verification-only bead).

## Relevant Tests
- \`src/test/foo.test.ts\`
`;
    const scriptSpawnFn = vi.fn().mockReturnValueOnce(fakeBdShow(notes));
    expect(extractExpectedFiles('pv-test.6', { scriptSpawnFn })).toEqual([]);
  });

  it('returns [] when bd show fails', () => {
    const scriptSpawnFn = vi.fn().mockReturnValueOnce(fakeSpawnResult('', 1));
    expect(extractExpectedFiles('pv-bogus', { scriptSpawnFn })).toEqual([]);
  });

  it('returns [] when notes have no Files to Modify section', () => {
    const scriptSpawnFn = vi.fn().mockReturnValueOnce(fakeBdShow('# No structure here\n'));
    expect(extractExpectedFiles('pv-test.1', { scriptSpawnFn })).toEqual([]);
  });
});

describe('reopenBead', () => {
  it('runs bd update --status=in_progress and logs a bead-reopened event', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub, 'pv-psum.2');

    const scriptSpawnFn = vi.fn()
      .mockReturnValueOnce(fakeSpawnResult('', 0));

    reopenBead('pv-psum.2', ctx, { scriptSpawnFn }, 'verification-gate-retry');

    expect(scriptSpawnFn).toHaveBeenCalledWith(
      'bd',
      ['update', 'pv-psum.2', '--status=in_progress'],
      expect.any(Object),
    );

    expect(logStub.runJsonEntries).toContainEqual(
      expect.objectContaining({
        event: 'bead-reopened',
        beadId: 'pv-psum.2',
        reason: 'verification-gate-retry',
        success: true,
      }),
    );
  });

  it('logs success=false when bd update exits non-zero but does not throw', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub, 'pv-psum.2');

    const scriptSpawnFn = vi.fn()
      .mockReturnValueOnce(fakeSpawnResult('', 1));

    expect(() =>
      reopenBead('pv-psum.2', ctx, { scriptSpawnFn }, 'verification-gate-escalate'),
    ).not.toThrow();

    expect(logStub.runJsonEntries).toContainEqual(
      expect.objectContaining({
        event: 'bead-reopened',
        beadId: 'pv-psum.2',
        success: false,
      }),
    );
  });
});
