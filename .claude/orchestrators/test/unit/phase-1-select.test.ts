import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { runSelect, SELECT_MESSAGES, type SelectDeps } from '../../lib/phase-1-select.js';
import { PhaseName, type RunLogger } from '../../lib/context.js';
import type { OrchestratorContext } from '../../process-backlog.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeSpawnResult(
  stdout: string,
  stderr: string,
  status: number,
): SpawnSyncReturns<Buffer> {
  return {
    stdout: Buffer.from(stdout, 'utf-8'),
    stderr: Buffer.from(stderr, 'utf-8'),
    status,
    signal: null,
    pid: 1234,
    output: [null, Buffer.from(stdout), Buffer.from(stderr)],
  };
}

function stubLogger() {
  const logs: { phase: PhaseName; kind: 'out' | 'err'; data: string }[] = [];
  const runJsonEntries: Record<string, unknown>[] = [];

  const logger: RunLogger = {
    writePhaseLog(phase, kind, data) {
      logs.push({ phase, kind, data });
    },
    appendRunJson(entry) {
      runJsonEntries.push(entry);
    },
    runDir() {
      return '/tmp/fake-run-dir';
    },
  };

  return { logger, logs, runJsonEntries };
}

function makeCtx(logStub: ReturnType<typeof stubLogger>): OrchestratorContext {
  return {
    runId: 'test-run-002',
    beadId: '',
    logger: logStub.logger,
    phaseHistory: [],
    dryRun: false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('phase-1-select', () => {
  let logStub: ReturnType<typeof stubLogger>;
  let ctx: OrchestratorContext;

  beforeEach(() => {
    logStub = stubLogger();
    ctx = makeCtx(logStub);
    vi.restoreAllMocks();
  });

  function makeDeps(spawnResult: SpawnSyncReturns<Buffer>): SelectDeps {
    return {
      runScriptOpts: {
        existsFn: () => true,
        spawnFn: (() => spawnResult) as unknown as typeof import('node:child_process').spawnSync,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('should proceed to phase-2-state and set beadId on success', async () => {
    const bead = {
      id: 'pv-abc.1',
      issue_type: 'task',
      priority: 2,
      created_at: '2026-04-15',
    };
    const deps = makeDeps(fakeSpawnResult(JSON.stringify(bead), '', 0));

    const result = await runSelect(ctx, deps);

    expect(result.next).toBe(PhaseName.State);
    expect(result.ctx.beadId).toBe('pv-abc.1');
  });

  it('should log bead_selected event to run JSON', async () => {
    const bead = {
      id: 'pv-xyz.3',
      issue_type: 'epic',
      priority: 1,
      created_at: '2026-04-10',
    };
    const deps = makeDeps(fakeSpawnResult(JSON.stringify(bead), '', 0));

    await runSelect(ctx, deps);

    expect(logStub.runJsonEntries).toContainEqual(
      expect.objectContaining({
        event: 'bead_selected',
        beadId: 'pv-xyz.3',
        issueType: 'epic',
        priority: 1,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Exit code 3: backlog exhausted
  // -------------------------------------------------------------------------

  it('should halt with exhausted message on exit code 3', async () => {
    const deps = makeDeps(
      fakeSpawnResult('', 'backlog exhausted for automation', 3),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runSelect(ctx, deps);

    expect(result.next).toBe('halt');
    expect(consoleSpy).toHaveBeenCalledWith(SELECT_MESSAGES.exhausted);
    consoleSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Exit code 2: usage error
  // -------------------------------------------------------------------------

  it('should halt with usage error message on exit code 2', async () => {
    const deps = makeDeps(
      fakeSpawnResult('', 'unknown flag --bad', 2),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runSelect(ctx, deps);

    expect(result.next).toBe('halt');
    expect(consoleSpy).toHaveBeenCalledWith(SELECT_MESSAGES.usageError);
    consoleSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Other non-zero exit
  // -------------------------------------------------------------------------

  it('should halt on unexpected non-zero exit code', async () => {
    const deps = makeDeps(
      fakeSpawnResult('', 'something went wrong', 127),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runSelect(ctx, deps);

    expect(result.next).toBe('halt');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('exit code 127'),
    );
    consoleSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Exit 0 but no bead id
  // -------------------------------------------------------------------------

  it('should halt when JSON has no id field', async () => {
    const deps = makeDeps(
      fakeSpawnResult(JSON.stringify({ issue_type: 'task' }), '', 0),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runSelect(ctx, deps);

    expect(result.next).toBe('halt');
    expect(consoleSpy).toHaveBeenCalledWith(SELECT_MESSAGES.noBead);
    consoleSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Logging on failure
  // -------------------------------------------------------------------------

  it('should log exhausted message to phase log', async () => {
    const deps = makeDeps(
      fakeSpawnResult('', 'backlog exhausted for automation', 3),
    );

    vi.spyOn(console, 'error').mockImplementation(() => {});
    await runSelect(ctx, deps);

    const errLogs = logStub.logs.filter(l => l.kind === 'err' && l.phase === PhaseName.Select);
    expect(errLogs.some(l => l.data.includes(SELECT_MESSAGES.exhausted))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Context is not mutated on failure
  // -------------------------------------------------------------------------

  it('should not set beadId on failure', async () => {
    const deps = makeDeps(
      fakeSpawnResult('', 'backlog exhausted for automation', 3),
    );

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runSelect(ctx, deps);

    expect(result.ctx.beadId).toBe('');
  });
});
