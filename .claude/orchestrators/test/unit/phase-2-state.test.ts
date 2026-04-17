import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  routeByState,
  runState,
  type StateVerdict,
  type StateDeps,
} from '../../lib/phase-2-state.js';
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

function makeVerdict(overrides: Partial<StateVerdict> = {}): StateVerdict {
  return {
    state: 'unshaped',
    missing_phases: ['shaped', 'decomposed', 'analyzed'],
    reasons: ['missing DESIGN section'],
    ...overrides,
  };
}

function makeDeps(spawnResult: SpawnSyncReturns<Buffer>): StateDeps {
  return {
    runScriptOpts: {
      existsFn: () => true,
      spawnFn: vi.fn().mockReturnValue(spawnResult),
    },
  };
}

// ---------------------------------------------------------------------------
// routeByState — pure routing function
// ---------------------------------------------------------------------------

describe('routeByState', () => {

  it('should route unshaped to Phase 3 (Shape)', () => {
    const verdict = makeVerdict({ state: 'unshaped' });
    expect(routeByState(verdict)).toBe(PhaseName.Shape);
  });

  it('should route shaped to Phase 3.5 (ShapeAdvisors)', () => {
    const verdict = makeVerdict({
      state: 'shaped',
      missing_phases: ['decomposed', 'analyzed'],
    });
    expect(routeByState(verdict)).toBe(PhaseName.ShapeAdvisors);
  });

  it('should route decomposed to Phase 5 (Analyze)', () => {
    const verdict = makeVerdict({
      state: 'decomposed',
      missing_phases: ['analyzed'],
    });
    expect(routeByState(verdict)).toBe(PhaseName.Analyze);
  });

  it('should route analyzed leaf (no children) to Phase 6 (Branch)', () => {
    // A leaf bead is analyzed but "decomposed" is still in missing_phases
    // because it has no children.
    const verdict = makeVerdict({
      state: 'analyzed',
      missing_phases: ['decomposed'],
    });
    expect(routeByState(verdict)).toBe(PhaseName.Branch);
  });

  it('should route analyzed epic (has children) to Phase 5.5 (AnalyzeAdvisors)', () => {
    // An epic bead is analyzed and "decomposed" is NOT in missing_phases
    // because it has children.
    const verdict = makeVerdict({
      state: 'analyzed',
      missing_phases: [],
    });
    expect(routeByState(verdict)).toBe(PhaseName.AnalyzeAdvisors);
  });

  it('should halt for executing state', () => {
    const verdict = makeVerdict({ state: 'executing', missing_phases: [] });
    expect(routeByState(verdict)).toBe('halt');
  });

  it('should halt for complete state', () => {
    const verdict = makeVerdict({ state: 'complete', missing_phases: [] });
    expect(routeByState(verdict)).toBe('halt');
  });

  it('should halt for unknown state', () => {
    const verdict = makeVerdict({ state: 'bogus' as StateVerdict['state'] });
    expect(routeByState(verdict)).toBe('halt');
  });
});

// ---------------------------------------------------------------------------
// runState — full phase runner
// ---------------------------------------------------------------------------

describe('runState', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
    vi.restoreAllMocks();
  });

  it('should route unshaped bead to Shape phase', async () => {
    const verdict = makeVerdict({ state: 'unshaped' });
    const ctx = makeCtx(logStub);
    const deps = makeDeps(fakeSpawnResult(JSON.stringify(verdict), '', 0));

    const result = await runState(ctx, deps);

    expect(result.next).toBe(PhaseName.Shape);
  });

  it('should route shaped bead to ShapeAdvisors phase', async () => {
    const verdict = makeVerdict({
      state: 'shaped',
      missing_phases: ['decomposed', 'analyzed'],
    });
    const ctx = makeCtx(logStub);
    const deps = makeDeps(fakeSpawnResult(JSON.stringify(verdict), '', 0));

    const result = await runState(ctx, deps);

    expect(result.next).toBe(PhaseName.ShapeAdvisors);
  });

  it('should route decomposed bead to Analyze phase', async () => {
    const verdict = makeVerdict({
      state: 'decomposed',
      missing_phases: ['analyzed'],
    });
    const ctx = makeCtx(logStub);
    const deps = makeDeps(fakeSpawnResult(JSON.stringify(verdict), '', 0));

    const result = await runState(ctx, deps);

    expect(result.next).toBe(PhaseName.Analyze);
  });

  it('should route analyzed leaf to Branch phase', async () => {
    const verdict = makeVerdict({
      state: 'analyzed',
      missing_phases: ['decomposed'],
    });
    const ctx = makeCtx(logStub);
    const deps = makeDeps(fakeSpawnResult(JSON.stringify(verdict), '', 0));

    const result = await runState(ctx, deps);

    expect(result.next).toBe(PhaseName.Branch);
  });

  it('should route analyzed epic to AnalyzeAdvisors phase', async () => {
    const verdict = makeVerdict({
      state: 'analyzed',
      missing_phases: [],
    });
    const ctx = makeCtx(logStub);
    const deps = makeDeps(fakeSpawnResult(JSON.stringify(verdict), '', 0));

    const result = await runState(ctx, deps);

    expect(result.next).toBe(PhaseName.AnalyzeAdvisors);
  });

  it('should halt for executing state with Safeguard 6 message', async () => {
    const verdict = makeVerdict({ state: 'executing', missing_phases: [] });
    const ctx = makeCtx(logStub);
    const deps = makeDeps(fakeSpawnResult(JSON.stringify(verdict), '', 0));

    const result = await runState(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('unexpected'),
    )).toBe(true);
  });

  it('should halt for complete state with Safeguard 6 message', async () => {
    const verdict = makeVerdict({ state: 'complete', missing_phases: [] });
    const ctx = makeCtx(logStub);
    const deps = makeDeps(fakeSpawnResult(JSON.stringify(verdict), '', 0));

    const result = await runState(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('unexpected'),
    )).toBe(true);
  });

  // -----------------------------------------------------------------------
  // --dry-run behavior
  // -----------------------------------------------------------------------

  it('should halt after state assessment when dryRun is true', async () => {
    const verdict = makeVerdict({ state: 'unshaped' });
    const ctx = makeCtx(logStub, { dryRun: true });
    const deps = makeDeps(fakeSpawnResult(JSON.stringify(verdict), '', 0));

    const result = await runState(ctx, deps);

    expect(result.next).toBe('halt');
  });

  it('should log dry_run_halt with the would-be next phase', async () => {
    const verdict = makeVerdict({
      state: 'shaped',
      missing_phases: ['decomposed', 'analyzed'],
    });
    const ctx = makeCtx(logStub, { dryRun: true });
    const deps = makeDeps(fakeSpawnResult(JSON.stringify(verdict), '', 0));

    await runState(ctx, deps);

    const dryRunEntry = logStub.runJsonEntries.find(
      (e) => e.event === 'dry_run_halt',
    );
    expect(dryRunEntry).toBeDefined();
    expect(dryRunEntry!.next).toBe(PhaseName.ShapeAdvisors);
    expect(dryRunEntry!.dryRun).toBe(true);
  });

  it('should log dry_run_halt for analyzed epic under dryRun', async () => {
    const verdict = makeVerdict({
      state: 'analyzed',
      missing_phases: [],
    });
    const ctx = makeCtx(logStub, { dryRun: true });
    const deps = makeDeps(fakeSpawnResult(JSON.stringify(verdict), '', 0));

    await runState(ctx, deps);

    const dryRunEntry = logStub.runJsonEntries.find(
      (e) => e.event === 'dry_run_halt',
    );
    expect(dryRunEntry).toBeDefined();
    expect(dryRunEntry!.next).toBe(PhaseName.AnalyzeAdvisors);
  });

  // -----------------------------------------------------------------------
  // Script error handling
  // -----------------------------------------------------------------------

  it('should halt on exit code 2 (usage error)', async () => {
    const ctx = makeCtx(logStub);
    const deps = makeDeps(fakeSpawnResult('', 'usage error', 2));

    const result = await runState(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('usage error'),
    )).toBe(true);
  });

  it('should halt on unexpected non-zero exit code', async () => {
    const ctx = makeCtx(logStub);
    const deps = makeDeps(fakeSpawnResult('', 'something broke', 1));

    const result = await runState(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('exit code 1'),
    )).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Logging
  // -----------------------------------------------------------------------

  it('should log state_assessed event to run.json on success', async () => {
    const verdict = makeVerdict({
      state: 'shaped',
      missing_phases: ['decomposed', 'analyzed'],
      reasons: ['has DESIGN section'],
    });
    const ctx = makeCtx(logStub);
    const deps = makeDeps(fakeSpawnResult(JSON.stringify(verdict), '', 0));

    await runState(ctx, deps);

    const entry = logStub.runJsonEntries.find(
      (e) => e.event === 'state_assessed',
    );
    expect(entry).toBeDefined();
    expect(entry!.beadId).toBe('pv-test-1');
    expect(entry!.state).toBe('shaped');
    expect(entry!.missingPhases).toEqual(['decomposed', 'analyzed']);
  });

  it('should pass beadId as arg to bd-state.sh', async () => {
    const verdict = makeVerdict({ state: 'unshaped' });
    const spawnFn = vi.fn().mockReturnValue(
      fakeSpawnResult(JSON.stringify(verdict), '', 0),
    );
    const ctx = makeCtx(logStub, { beadId: 'pv-abc-42' });
    const deps: StateDeps = {
      runScriptOpts: {
        existsFn: () => true,
        spawnFn,
      },
    };

    await runState(ctx, deps);

    expect(spawnFn).toHaveBeenCalledWith(
      '.claude/skills/bead-state-assessment/bd-state.sh',
      ['pv-abc-42'],
      expect.objectContaining({ shell: true }),
    );
  });
});
