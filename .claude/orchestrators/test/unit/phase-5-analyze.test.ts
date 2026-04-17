import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  runAnalyze,
  buildAnalyzePrompt,
  type AnalyzeReport,
  type AnalyzeDeps,
  type SpawnSyncFn,
} from '../../lib/phase-5-analyze.js';
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

function makeAnalyzeReport(overrides: Partial<AnalyzeReport> = {}): AnalyzeReport {
  return {
    beadId: 'pv-test-1',
    mode: 'hierarchy',
    leavesEnriched: ['pv-test-1.1', 'pv-test-1.2', 'pv-test-1.3'],
    summary: 'Enriched 3 leaves across 2 waves.',
    waves: [['pv-test-1.1'], ['pv-test-1.2', 'pv-test-1.3']],
    ...overrides,
  };
}

/**
 * Create a mock enrichment spawn function that returns sequential exit codes.
 * Each call pops the next exit code from the array.
 */
function makeEnrichmentSpawnFn(exitCodes: number[]): SpawnSyncFn {
  const fn = vi.fn() as ReturnType<typeof vi.fn> & SpawnSyncFn;
  for (const code of exitCodes) {
    fn.mockReturnValueOnce(fakeSpawnResult('', '', code));
  }
  // Fallback for any extra calls
  fn.mockReturnValue(fakeSpawnResult('', '', 0));
  return fn;
}

/**
 * Build deps with enrichment exit codes and optional dispatch mock.
 *
 * @param enrichmentExitCodes - exit codes for pre-dispatch enrichment checks.
 * @param postEnrichmentExitCodes - exit codes for post-dispatch belt-and-braces checks.
 */
function makeDeps(opts: {
  enrichmentExitCodes: number[];
  postEnrichmentExitCodes?: number[];
  dispatchFn?: <T>(opts: DispatchOptions) => Promise<T>;
  childIds?: string[];
}): AnalyzeDeps {
  const allCodes = [
    ...opts.enrichmentExitCodes,
    ...(opts.postEnrichmentExitCodes
      ?? new Array(opts.enrichmentExitCodes.length).fill(0)),
  ];

  // Escalate script uses runScript, so provide a separate mock for that
  const escalateSpawnFn = vi.fn();
  escalateSpawnFn.mockReturnValue(fakeSpawnResult('{}', '', 0));

  return {
    runScriptOpts: {
      existsFn: () => true,
      spawnFn: escalateSpawnFn,
    },
    enrichmentSpawnFn: makeEnrichmentSpawnFn(allCodes),
    dispatchFn: opts.dispatchFn,
    childIds: opts.childIds ?? ['pv-test-1.1', 'pv-test-1.2', 'pv-test-1.3'],
    schemaPath: '/tmp/fake-schema.json',
    budgetUsd: 3.00,
    timeoutMs: 60000,
  };
}

// ---------------------------------------------------------------------------
// buildAnalyzePrompt
// ---------------------------------------------------------------------------

describe('buildAnalyzePrompt', () => {
  it('should include the epic id', () => {
    const prompt = buildAnalyzePrompt('pv-abc-1', ['pv-abc-1.1', 'pv-abc-1.2']);
    expect(prompt).toContain('pv-abc-1');
  });

  it('should include unenriched leaf ids', () => {
    const prompt = buildAnalyzePrompt('pv-abc-1', ['pv-abc-1.1', 'pv-abc-1.2']);
    expect(prompt).toContain('pv-abc-1.1');
    expect(prompt).toContain('pv-abc-1.2');
  });

  it('should reference analyze-bead.md', () => {
    const prompt = buildAnalyzePrompt('pv-abc-1', []);
    expect(prompt).toContain('.claude/commands/analyze-bead.md');
  });

  it('should instruct to skip Phase 1.5 (decomposition)', () => {
    const prompt = buildAnalyzePrompt('pv-abc-1', ['pv-abc-1.1']);
    expect(prompt).toContain('Skip Phase 1.5');
  });
});

// ---------------------------------------------------------------------------
// runAnalyze -- skip cases
// ---------------------------------------------------------------------------

describe('runAnalyze -- skip cases', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
    vi.restoreAllMocks();
  });

  it('should skip to AnalyzeAdvisors when all leaves are already enriched', async () => {
    const deps = makeDeps({
      enrichmentExitCodes: [0, 0, 0], // all enriched
    });
    const ctx = makeCtx(logStub);

    const result = await runAnalyze(ctx, deps);

    expect(result.next).toBe(PhaseName.AnalyzeAdvisors);
    expect(logStub.runJsonEntries.some(
      e => e.event === 'analyze_skipped' && e.reason === 'all leaves already enriched',
    )).toBe(true);
  });

  it('should skip to Branch when bead is a leaf (no children)', async () => {
    const deps = makeDeps({
      enrichmentExitCodes: [],
      childIds: [], // no children = leaf
    });
    const ctx = makeCtx(logStub);

    const result = await runAnalyze(ctx, deps);

    expect(result.next).toBe(PhaseName.Branch);
    expect(logStub.runJsonEntries.some(
      e => e.event === 'analyze_skipped' && e.reason === 'bead is a leaf, skip to Branch',
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runAnalyze -- successful dispatch
// ---------------------------------------------------------------------------

describe('runAnalyze -- success', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
    vi.restoreAllMocks();
  });

  it('should dispatch analyze-bead and route to AnalyzeAdvisors on success', async () => {
    const report = makeAnalyzeReport();
    const mockDispatch = vi.fn().mockResolvedValue(report);

    const deps = makeDeps({
      enrichmentExitCodes: [1, 0, 1], // leaves 1 and 3 unenriched
      postEnrichmentExitCodes: [0, 0, 0], // all pass after dispatch
      dispatchFn: mockDispatch,
    });
    const ctx = makeCtx(logStub);

    const result = await runAnalyze(ctx, deps);

    expect(result.next).toBe(PhaseName.AnalyzeAdvisors);
    expect(mockDispatch).toHaveBeenCalledTimes(1);

    // Verify dispatch options
    const callOpts = mockDispatch.mock.calls[0][0] as DispatchOptions;
    expect(callOpts.agent).toBe('analyze-bead');
    expect(callOpts.schemaPath).toBe('/tmp/fake-schema.json');
    expect(callOpts.budgetUsd).toBe(3.00);
    expect(callOpts.logTag).toBe(PhaseName.Analyze);

    // Verify prompt includes epic id and unenriched leaf ids
    expect(callOpts.prompt).toContain('pv-test-1');
    expect(callOpts.prompt).toContain('pv-test-1.1');
    expect(callOpts.prompt).toContain('pv-test-1.3');
  });

  it('should log analyze_complete with report details', async () => {
    const report = makeAnalyzeReport({
      leavesEnriched: ['pv-test-1.1', 'pv-test-1.2'],
      summary: 'Enriched 2 leaves.',
    });
    const mockDispatch = vi.fn().mockResolvedValue(report);

    const deps = makeDeps({
      enrichmentExitCodes: [1, 1, 0], // 2 unenriched
      postEnrichmentExitCodes: [0, 0, 0],
      dispatchFn: mockDispatch,
    });
    const ctx = makeCtx(logStub);

    await runAnalyze(ctx, deps);

    const entry = logStub.runJsonEntries.find(e => e.event === 'analyze_complete');
    expect(entry).toBeDefined();
    expect(entry!.beadId).toBe('pv-test-1');
    expect(entry!.leavesEnriched).toEqual(['pv-test-1.1', 'pv-test-1.2']);
    expect(entry!.summary).toBe('Enriched 2 leaves.');
  });
});

// ---------------------------------------------------------------------------
// runAnalyze -- belt-and-braces failure (Safeguard 6)
// ---------------------------------------------------------------------------

describe('runAnalyze -- belt-and-braces post-dispatch check', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
    vi.restoreAllMocks();
  });

  it('should halt if any leaf is still unenriched after dispatch', async () => {
    const report = makeAnalyzeReport();
    const mockDispatch = vi.fn().mockResolvedValue(report);

    const deps = makeDeps({
      enrichmentExitCodes: [1, 0, 1], // 2 unenriched
      postEnrichmentExitCodes: [0, 1, 0], // leaf 2 still fails
      dispatchFn: mockDispatch,
    });
    const ctx = makeCtx(logStub);

    const result = await runAnalyze(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.runJsonEntries.some(
      e => e.event === 'analyze_belt_and_braces_failed',
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runAnalyze -- dispatch errors (escalation)
// ---------------------------------------------------------------------------

describe('runAnalyze -- dispatch errors', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
    vi.restoreAllMocks();
  });

  it('should escalate and halt on DispatchMalformedError', async () => {
    const mockDispatch = vi.fn().mockRejectedValue(
      new DispatchMalformedError('analyze-bead', '{ broken', 'Unexpected token'),
    );

    const deps = makeDeps({
      enrichmentExitCodes: [1, 0, 0], // 1 unenriched
      dispatchFn: mockDispatch,
    });
    const ctx = makeCtx(logStub);

    const result = await runAnalyze(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.runJsonEntries.some(
      e => e.event === 'analyze_escalated',
    )).toBe(true);
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('malformed output'),
    )).toBe(true);
  });

  it('should escalate and halt on DispatchTimeoutError', async () => {
    const mockDispatch = vi.fn().mockRejectedValue(
      new DispatchTimeoutError('analyze-bead', 300000),
    );

    const deps = makeDeps({
      enrichmentExitCodes: [1, 0, 0],
      dispatchFn: mockDispatch,
    });
    const ctx = makeCtx(logStub);

    const result = await runAnalyze(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.runJsonEntries.some(
      e => e.event === 'analyze_escalated',
    )).toBe(true);
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('timed out'),
    )).toBe(true);
  });

  it('should rethrow non-dispatch errors (not escalate)', async () => {
    const mockDispatch = vi.fn().mockRejectedValue(
      new Error('unexpected crash'),
    );

    const deps = makeDeps({
      enrichmentExitCodes: [1, 0, 0],
      dispatchFn: mockDispatch,
    });
    const ctx = makeCtx(logStub);

    await expect(runAnalyze(ctx, deps)).rejects.toThrow('unexpected crash');
    expect(logStub.runJsonEntries.some(
      e => e.event === 'analyze_escalated',
    )).toBe(false);
  });

  it('should call bd-escalate.sh with bead id, reason, and phase "5"', async () => {
    const mockDispatch = vi.fn().mockRejectedValue(
      new DispatchTimeoutError('analyze-bead', 300000),
    );

    // Enrichment spawn (exit-code-only)
    const enrichmentSpawnFn = vi.fn() as ReturnType<typeof vi.fn> & SpawnSyncFn;
    enrichmentSpawnFn.mockReturnValueOnce(fakeSpawnResult('', '', 1)); // leaf 1 unenriched
    enrichmentSpawnFn.mockReturnValueOnce(fakeSpawnResult('', '', 0)); // leaf 2 enriched
    enrichmentSpawnFn.mockReturnValueOnce(fakeSpawnResult('', '', 0)); // leaf 3 enriched

    // Escalate spawn (JSON, via runScript)
    const escalateSpawnFn = vi.fn();
    escalateSpawnFn.mockReturnValue(fakeSpawnResult('{}', '', 0));

    const deps: AnalyzeDeps = {
      runScriptOpts: {
        existsFn: () => true,
        spawnFn: escalateSpawnFn,
      },
      enrichmentSpawnFn,
      dispatchFn: mockDispatch,
      childIds: ['pv-test-1.1', 'pv-test-1.2', 'pv-test-1.3'],
      schemaPath: '/tmp/fake-schema.json',
      budgetUsd: 3.00,
      timeoutMs: 60000,
    };
    const ctx = makeCtx(logStub);

    await runAnalyze(ctx, deps);

    // Verify enrichment checks ran
    expect(enrichmentSpawnFn).toHaveBeenCalledTimes(3);

    // Verify escalate was called via runScript's spawnFn
    expect(escalateSpawnFn).toHaveBeenCalledTimes(1);
    const escalateCall = escalateSpawnFn.mock.calls[0];
    expect(escalateCall[0]).toContain('bd-escalate.sh');
    expect(escalateCall[1][0]).toBe('pv-test-1'); // bead id
    expect(escalateCall[1][2]).toBe('5');          // phase number
  });
});
