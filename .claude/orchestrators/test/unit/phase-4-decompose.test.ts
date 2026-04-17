import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  runDecompose,
  buildDecomposePrompt,
  type SizingVerdict,
  type DecomposeReport,
  type DecomposeDeps,
} from '../../lib/phase-4-decompose.js';
import { PhaseName, type RunLogger } from '../../lib/context.js';
import {
  DispatchMalformedError,
  DispatchTimeoutError,
  type DispatchOptions,
} from '../../lib/dispatch.js';
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

function makeCtx(
  logStub: ReturnType<typeof stubLogger>,
  overrides: Partial<OrchestratorContext> = {},
): OrchestratorContext {
  return {
    runId: 'test-run-001',
    beadId: 'pv-test-1',
    logger: logStub.logger,
    phaseHistory: [],
    dryRun: false,
    ...overrides,
  };
}

function makeSizingVerdict(overrides: Partial<SizingVerdict> = {}): SizingVerdict {
  return {
    needs_decomposition: false,
    reasons: [],
    ...overrides,
  };
}

function makeDecomposeReport(overrides: Partial<DecomposeReport> = {}): DecomposeReport {
  return {
    parentBeadId: 'pv-test-1',
    childBeadIds: ['pv-test-1.1', 'pv-test-1.2', 'pv-test-1.3'],
    childCount: 3,
    summary: 'Decomposed into backend, frontend, and tests.',
    ...overrides,
  };
}

/**
 * State verdict JSON for bd-state.sh calls.
 * `includesDecomposed: true` means the bead already has children (is epic).
 */
function makeStateJson(hasChildren: boolean): string {
  return JSON.stringify({
    state: hasChildren ? 'decomposed' : 'shaped',
    missing_phases: hasChildren ? ['analyzed'] : ['decomposed', 'analyzed'],
    reasons: [],
  });
}

/**
 * Build deps with separate spawn results for sizing and state scripts.
 * The spawnFn is called first for sizing, then for state (if sizing passes).
 */
function makeDeps(opts: {
  sizingResult: SpawnSyncReturns<Buffer>;
  stateResult?: SpawnSyncReturns<Buffer>;
  dispatchFn?: <T>(opts: DispatchOptions) => Promise<T>;
}): DecomposeDeps {
  const spawnFn = vi.fn();
  spawnFn.mockReturnValueOnce(opts.sizingResult);
  if (opts.stateResult) {
    spawnFn.mockReturnValueOnce(opts.stateResult);
  }
  // Additional calls (e.g., escalate) return success
  spawnFn.mockReturnValue(fakeSpawnResult('{}', '', 0));

  return {
    runScriptOpts: {
      existsFn: () => true,
      spawnFn,
    },
    dispatchFn: opts.dispatchFn,
    schemaPath: '/tmp/fake-schema.json',
    budgetUsd: 3.00,
    timeoutMs: 60000,
  };
}

// ---------------------------------------------------------------------------
// buildDecomposePrompt
// ---------------------------------------------------------------------------

describe('buildDecomposePrompt', () => {
  it('should include the bead id', () => {
    const prompt = buildDecomposePrompt('pv-abc-1', ['too many files']);
    expect(prompt).toContain('pv-abc-1');
  });

  it('should include the sizing reasons', () => {
    const prompt = buildDecomposePrompt('pv-abc-1', ['4+ files', 'spans domains']);
    expect(prompt).toContain('4+ files');
    expect(prompt).toContain('spans domains');
  });

  it('should reference decompose-bead.md', () => {
    const prompt = buildDecomposePrompt('pv-abc-1', []);
    expect(prompt).toContain('.claude/commands/decompose-bead.md');
  });
});

// ---------------------------------------------------------------------------
// runDecompose -- no decomposition needed
// ---------------------------------------------------------------------------

describe('runDecompose -- skip cases', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
    vi.restoreAllMocks();
  });

  it('should skip to Analyze when needs_decomposition is false', async () => {
    const sizing = makeSizingVerdict({ needs_decomposition: false });
    const deps = makeDeps({
      sizingResult: fakeSpawnResult(JSON.stringify(sizing), '', 0),
    });
    const ctx = makeCtx(logStub);

    const result = await runDecompose(ctx, deps);

    expect(result.next).toBe(PhaseName.Analyze);
    expect(logStub.runJsonEntries.some(
      e => e.event === 'decompose_skipped' && e.reason === 'sizing check says no decomposition needed',
    )).toBe(true);
  });

  it('should skip to Analyze when bead already has children', async () => {
    const sizing = makeSizingVerdict({
      needs_decomposition: true,
      reasons: ['4+ files'],
    });
    const deps = makeDeps({
      sizingResult: fakeSpawnResult(JSON.stringify(sizing), '', 0),
      stateResult: fakeSpawnResult(makeStateJson(true), '', 0),
    });
    const ctx = makeCtx(logStub);

    const result = await runDecompose(ctx, deps);

    expect(result.next).toBe(PhaseName.Analyze);
    expect(logStub.runJsonEntries.some(
      e => e.event === 'decompose_skipped' && e.reason === 'bead already has children',
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runDecompose -- sizing script errors
// ---------------------------------------------------------------------------

describe('runDecompose -- sizing script errors', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
    vi.restoreAllMocks();
  });

  it('should halt on sizing script exit code 2 (usage error)', async () => {
    const deps = makeDeps({
      sizingResult: fakeSpawnResult('', 'usage error', 2),
    });
    const ctx = makeCtx(logStub);

    const result = await runDecompose(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('usage error'),
    )).toBe(true);
  });

  it('should halt on sizing script unexpected non-zero exit', async () => {
    const deps = makeDeps({
      sizingResult: fakeSpawnResult('', 'fail', 1),
    });
    const ctx = makeCtx(logStub);

    const result = await runDecompose(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('exit code 1'),
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runDecompose -- successful decomposition
// ---------------------------------------------------------------------------

describe('runDecompose -- success', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
    vi.restoreAllMocks();
  });

  it('should dispatch decompose subagent and route to Select on success', async () => {
    const sizing = makeSizingVerdict({
      needs_decomposition: true,
      reasons: ['4+ files', 'spans backend and frontend'],
    });
    const report = makeDecomposeReport();
    const mockDispatch = vi.fn().mockResolvedValue(report);

    const deps = makeDeps({
      sizingResult: fakeSpawnResult(JSON.stringify(sizing), '', 0),
      stateResult: fakeSpawnResult(makeStateJson(false), '', 0),
      dispatchFn: mockDispatch,
    });
    const ctx = makeCtx(logStub);

    const result = await runDecompose(ctx, deps);

    expect(result.next).toBe(PhaseName.Select);
    expect(mockDispatch).toHaveBeenCalledTimes(1);

    // Verify dispatch options
    const callOpts = mockDispatch.mock.calls[0][0] as DispatchOptions;
    expect(callOpts.agent).toBe('decompose-bead');
    expect(callOpts.schemaPath).toBe('/tmp/fake-schema.json');
    expect(callOpts.budgetUsd).toBe(3.00);
    expect(callOpts.logTag).toBe(PhaseName.Decompose);

    // Verify prompt includes bead id and reasons
    expect(callOpts.prompt).toContain('pv-test-1');
    expect(callOpts.prompt).toContain('4+ files');
  });

  it('should log decompose_complete with report details', async () => {
    const sizing = makeSizingVerdict({
      needs_decomposition: true,
      reasons: ['too large'],
    });
    const report = makeDecomposeReport({
      parentBeadId: 'pv-test-1',
      childBeadIds: ['pv-test-1.1', 'pv-test-1.2'],
      childCount: 2,
      summary: 'Split into two leaves.',
    });
    const mockDispatch = vi.fn().mockResolvedValue(report);

    const deps = makeDeps({
      sizingResult: fakeSpawnResult(JSON.stringify(sizing), '', 0),
      stateResult: fakeSpawnResult(makeStateJson(false), '', 0),
      dispatchFn: mockDispatch,
    });
    const ctx = makeCtx(logStub);

    await runDecompose(ctx, deps);

    const entry = logStub.runJsonEntries.find(e => e.event === 'decompose_complete');
    expect(entry).toBeDefined();
    expect(entry!.parentBeadId).toBe('pv-test-1');
    expect(entry!.childCount).toBe(2);
    expect(entry!.childBeadIds).toEqual(['pv-test-1.1', 'pv-test-1.2']);
  });
});

// ---------------------------------------------------------------------------
// runDecompose -- dispatch errors (escalation)
// ---------------------------------------------------------------------------

describe('runDecompose -- dispatch errors', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
    vi.restoreAllMocks();
  });

  it('should escalate and halt on DispatchMalformedError', async () => {
    const sizing = makeSizingVerdict({
      needs_decomposition: true,
      reasons: ['too large'],
    });
    const mockDispatch = vi.fn().mockRejectedValue(
      new DispatchMalformedError('decompose-bead', '{ broken', 'Unexpected token'),
    );

    const deps = makeDeps({
      sizingResult: fakeSpawnResult(JSON.stringify(sizing), '', 0),
      stateResult: fakeSpawnResult(makeStateJson(false), '', 0),
      dispatchFn: mockDispatch,
    });
    const ctx = makeCtx(logStub);

    const result = await runDecompose(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.runJsonEntries.some(
      e => e.event === 'decompose_escalated',
    )).toBe(true);
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('malformed output'),
    )).toBe(true);
  });

  it('should escalate and halt on DispatchTimeoutError', async () => {
    const sizing = makeSizingVerdict({
      needs_decomposition: true,
      reasons: ['too large'],
    });
    const mockDispatch = vi.fn().mockRejectedValue(
      new DispatchTimeoutError('decompose-bead', 300000),
    );

    const deps = makeDeps({
      sizingResult: fakeSpawnResult(JSON.stringify(sizing), '', 0),
      stateResult: fakeSpawnResult(makeStateJson(false), '', 0),
      dispatchFn: mockDispatch,
    });
    const ctx = makeCtx(logStub);

    const result = await runDecompose(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.runJsonEntries.some(
      e => e.event === 'decompose_escalated',
    )).toBe(true);
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('timed out'),
    )).toBe(true);
  });

  it('should rethrow non-dispatch errors (not escalate)', async () => {
    const sizing = makeSizingVerdict({
      needs_decomposition: true,
      reasons: ['too large'],
    });
    const mockDispatch = vi.fn().mockRejectedValue(
      new Error('unexpected crash'),
    );

    const deps = makeDeps({
      sizingResult: fakeSpawnResult(JSON.stringify(sizing), '', 0),
      stateResult: fakeSpawnResult(makeStateJson(false), '', 0),
      dispatchFn: mockDispatch,
    });
    const ctx = makeCtx(logStub);

    await expect(runDecompose(ctx, deps)).rejects.toThrow('unexpected crash');
    expect(logStub.runJsonEntries.some(
      e => e.event === 'decompose_escalated',
    )).toBe(false);
  });

  it('should call bd-escalate.sh with bead id, reason, and phase "4"', async () => {
    const sizing = makeSizingVerdict({
      needs_decomposition: true,
      reasons: ['too large'],
    });
    const mockDispatch = vi.fn().mockRejectedValue(
      new DispatchTimeoutError('decompose-bead', 300000),
    );

    const spawnFn = vi.fn();
    // First call: sizing check
    spawnFn.mockReturnValueOnce(fakeSpawnResult(JSON.stringify(sizing), '', 0));
    // Second call: state check (leaf)
    spawnFn.mockReturnValueOnce(fakeSpawnResult(makeStateJson(false), '', 0));
    // Third call: escalate
    spawnFn.mockReturnValueOnce(fakeSpawnResult('{}', '', 0));

    const deps: DecomposeDeps = {
      runScriptOpts: {
        existsFn: () => true,
        spawnFn,
      },
      dispatchFn: mockDispatch,
      schemaPath: '/tmp/fake-schema.json',
      budgetUsd: 3.00,
      timeoutMs: 60000,
    };
    const ctx = makeCtx(logStub);

    await runDecompose(ctx, deps);

    // Verify escalate was called (third spawnFn call)
    expect(spawnFn).toHaveBeenCalledTimes(3);
    const escalateCall = spawnFn.mock.calls[2];
    expect(escalateCall[0]).toContain('bd-escalate.sh');
    expect(escalateCall[1][0]).toBe('pv-test-1'); // bead id
    expect(escalateCall[1][2]).toBe('4');          // phase number
  });
});
