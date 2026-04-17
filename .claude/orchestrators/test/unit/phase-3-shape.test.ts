import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  runShape,
  buildShapePrompt,
  SHAPE_BUDGET_DEFAULT,
  SHAPE_TIMEOUT_MS,
  type ShapeDeps,
  type ShapeVerdict,
} from '../../lib/phase-3-shape.js';
import { PhaseName, type RunLogger } from '../../lib/context.js';
import type { OrchestratorContext } from '../../process-backlog.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// buildShapePrompt
// ---------------------------------------------------------------------------

describe('buildShapePrompt', () => {
  it('should include the bead id in the prompt', () => {
    const prompt = buildShapePrompt('pv-abc-42');
    expect(prompt).toContain('pv-abc-42');
  });

  it('should reference shape-bead.md', () => {
    const prompt = buildShapePrompt('pv-abc-42');
    expect(prompt).toContain('shape-bead.md');
  });

  it('should instruct no user questions', () => {
    const prompt = buildShapePrompt('pv-abc-42');
    expect(prompt).toContain('Do NOT use AskUserQuestion');
  });

  it('should mention ESCALATE response format', () => {
    const prompt = buildShapePrompt('pv-abc-42');
    expect(prompt).toContain('escalate');
  });
});

// ---------------------------------------------------------------------------
// runShape — happy path: shaped verdict
// ---------------------------------------------------------------------------

describe('runShape', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
    vi.restoreAllMocks();
  });

  it('should route to ShapeAdvisors on shaped verdict', async () => {
    const shapeVerdict: ShapeVerdict = {
      beadId: 'pv-test-1',
      status: 'shaped',
      summary: 'Added design and acceptance criteria',
    };

    const stateVerdict = JSON.stringify({
      state: 'shaped',
      missing_phases: ['decomposed', 'analyzed'],
      reasons: [],
    });

    const ctx = makeCtx(logStub);
    const deps: ShapeDeps = {
      dispatchFn: vi.fn().mockResolvedValue(shapeVerdict),
      runScriptOpts: {
        existsFn: () => true,
        spawnFn: vi.fn().mockReturnValue(
          fakeSpawnResult(stateVerdict, '', 0),
        ),
      },
    };

    const result = await runShape(ctx, deps);

    expect(result.next).toBe(PhaseName.ShapeAdvisors);
    expect(deps.dispatchFn).toHaveBeenCalledOnce();
  });

  it('should re-run bd-state.sh after shaped verdict', async () => {
    const shapeVerdict: ShapeVerdict = {
      beadId: 'pv-test-1',
      status: 'shaped',
      summary: 'Shaped it',
    };

    const stateVerdict = JSON.stringify({
      state: 'shaped',
      missing_phases: ['decomposed', 'analyzed'],
      reasons: [],
    });

    const spawnFn = vi.fn().mockReturnValue(
      fakeSpawnResult(stateVerdict, '', 0),
    );

    const ctx = makeCtx(logStub);
    const deps: ShapeDeps = {
      dispatchFn: vi.fn().mockResolvedValue(shapeVerdict),
      runScriptOpts: {
        existsFn: () => true,
        spawnFn,
      },
    };

    await runShape(ctx, deps);

    expect(spawnFn).toHaveBeenCalledWith(
      '.claude/skills/bead-state-assessment/bd-state.sh',
      ['pv-test-1'],
      expect.objectContaining({ shell: true }),
    );
  });

  it('should log shape_dispatched event', async () => {
    const shapeVerdict: ShapeVerdict = {
      beadId: 'pv-test-1',
      status: 'shaped',
      summary: 'Done',
    };

    const stateVerdict = JSON.stringify({
      state: 'shaped',
      missing_phases: [],
      reasons: [],
    });

    const ctx = makeCtx(logStub);
    const deps: ShapeDeps = {
      dispatchFn: vi.fn().mockResolvedValue(shapeVerdict),
      runScriptOpts: {
        existsFn: () => true,
        spawnFn: vi.fn().mockReturnValue(fakeSpawnResult(stateVerdict, '', 0)),
      },
    };

    await runShape(ctx, deps);

    const entry = logStub.runJsonEntries.find(e => e.event === 'shape_dispatched');
    expect(entry).toBeDefined();
    expect(entry!.beadId).toBe('pv-test-1');
  });

  // -----------------------------------------------------------------------
  // Escalation path
  // -----------------------------------------------------------------------

  it('should escalate and halt on escalate verdict', async () => {
    const shapeVerdict: ShapeVerdict = {
      beadId: 'pv-test-1',
      status: 'escalate',
      summary: 'Description has no actionable signal',
    };

    const escalateSpawnFn = vi.fn().mockReturnValue(
      fakeSpawnResult('', '', 0),
    );

    const ctx = makeCtx(logStub);
    const deps: ShapeDeps = {
      dispatchFn: vi.fn().mockResolvedValue(shapeVerdict),
      escalateSpawnFn,
    };

    const result = await runShape(ctx, deps);

    expect(result.next).toBe('halt');
    // Should have called bd-escalate.sh
    expect(escalateSpawnFn).toHaveBeenCalledWith(
      '.claude/skills/bead-backlog-selection/bd-escalate.sh',
      ['pv-test-1', 'Description has no actionable signal', '3'],
      expect.objectContaining({ shell: true }),
    );
  });

  it('should log shape_escalated event on escalate', async () => {
    const shapeVerdict: ShapeVerdict = {
      beadId: 'pv-test-1',
      status: 'escalate',
      summary: 'No signal',
    };

    const ctx = makeCtx(logStub);
    const deps: ShapeDeps = {
      dispatchFn: vi.fn().mockResolvedValue(shapeVerdict),
      escalateSpawnFn: vi.fn().mockReturnValue(fakeSpawnResult('', '', 0)),
    };

    await runShape(ctx, deps);

    const entry = logStub.runJsonEntries.find(e => e.event === 'shape_escalated');
    expect(entry).toBeDefined();
    expect(entry!.reason).toBe('No signal');
  });

  // -----------------------------------------------------------------------
  // DispatchMalformedError → escalate + halt
  // -----------------------------------------------------------------------

  it('should escalate and halt on DispatchMalformedError', async () => {
    const { DispatchMalformedError } = await import('../../lib/dispatch.js');

    const escalateSpawnFn = vi.fn().mockReturnValue(
      fakeSpawnResult('', '', 0),
    );

    const ctx = makeCtx(logStub);
    const deps: ShapeDeps = {
      dispatchFn: vi.fn().mockRejectedValue(
        new DispatchMalformedError('shape-bead', 'garbage', 'not json'),
      ),
      escalateSpawnFn,
    };

    const result = await runShape(ctx, deps);

    expect(result.next).toBe('halt');
    expect(escalateSpawnFn).toHaveBeenCalledWith(
      '.claude/skills/bead-backlog-selection/bd-escalate.sh',
      expect.arrayContaining(['pv-test-1']),
      expect.objectContaining({ shell: true }),
    );
  });

  // -----------------------------------------------------------------------
  // DispatchTimeoutError → escalate + halt
  // -----------------------------------------------------------------------

  it('should escalate and halt on DispatchTimeoutError', async () => {
    const { DispatchTimeoutError } = await import('../../lib/dispatch.js');

    const escalateSpawnFn = vi.fn().mockReturnValue(
      fakeSpawnResult('', '', 0),
    );

    const ctx = makeCtx(logStub);
    const deps: ShapeDeps = {
      dispatchFn: vi.fn().mockRejectedValue(
        new DispatchTimeoutError('shape-bead', 120000),
      ),
      escalateSpawnFn,
    };

    const result = await runShape(ctx, deps);

    expect(result.next).toBe('halt');
    expect(escalateSpawnFn).toHaveBeenCalledWith(
      '.claude/skills/bead-backlog-selection/bd-escalate.sh',
      expect.arrayContaining(['pv-test-1']),
      expect.objectContaining({ shell: true }),
    );
  });

  // -----------------------------------------------------------------------
  // Unexpected dispatch error → rethrow (Safeguard 6)
  // -----------------------------------------------------------------------

  it('should rethrow unexpected errors (Safeguard 6)', async () => {
    const ctx = makeCtx(logStub);
    const deps: ShapeDeps = {
      dispatchFn: vi.fn().mockRejectedValue(new Error('unexpected boom')),
      runScriptOpts: {
        existsFn: () => true,
        spawnFn: vi.fn(),
      },
    };

    await expect(runShape(ctx, deps)).rejects.toThrow('unexpected boom');
  });

  // -----------------------------------------------------------------------
  // State re-check failure after shaped → halt (Safeguard 6)
  // -----------------------------------------------------------------------

  it('should halt when bd-state.sh fails after shaped verdict', async () => {
    const shapeVerdict: ShapeVerdict = {
      beadId: 'pv-test-1',
      status: 'shaped',
      summary: 'Done',
    };

    const ctx = makeCtx(logStub);
    const deps: ShapeDeps = {
      dispatchFn: vi.fn().mockResolvedValue(shapeVerdict),
      runScriptOpts: {
        existsFn: () => true,
        spawnFn: vi.fn().mockReturnValue(fakeSpawnResult('', 'error', 1)),
      },
    };

    const result = await runShape(ctx, deps);

    expect(result.next).toBe('halt');
  });

  // -----------------------------------------------------------------------
  // Budget env var override
  // -----------------------------------------------------------------------

  it('should export default budget and timeout constants', () => {
    expect(SHAPE_BUDGET_DEFAULT).toBeGreaterThan(0);
    expect(SHAPE_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
