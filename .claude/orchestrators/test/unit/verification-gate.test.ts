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
});
