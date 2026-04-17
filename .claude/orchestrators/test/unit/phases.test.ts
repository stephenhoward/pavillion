import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  routeByState,
  routeToExecution,
  preflight,
  select,
  assessState,
  shape,
  shapeAdvisors,
  decompose,
  analyze,
  analyzeAdvisors,
  branch,
  PREFLIGHT_MESSAGES,
  GIT_SAFE_MESSAGES,
  type PhaseCtx,
  type PhaseDeps,
  type StateVerdict,
  type ShapeVerdict,
} from '../../lib/phases.js';
import { PhaseName, type RunLogger } from '../../lib/types.js';
import { DispatchTimeoutError } from '../../lib/dispatch.js';

// =============================================================================
// Shared helpers
// =============================================================================

function fakeSpawn(
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
  const jsonEntries: Record<string, unknown>[] = [];

  const logger: RunLogger = {
    writePhaseLog(phase, kind, data) { logs.push({ phase, kind, data }); },
    appendRunJson(entry) { jsonEntries.push(entry); },
    runDir() { return '/tmp/fake-run-dir'; },
  };

  return { logger, logs, jsonEntries };
}

function makeCtx(overrides: Partial<PhaseCtx> = {}): PhaseCtx {
  const log = stubLogger();
  return {
    runId: 'test-run-001',
    beadId: 'pv-test-1',
    logger: log.logger,
    phaseHistory: [],
    dryRun: false,
    ...overrides,
  };
}

/** Build a sequential spawn mock that returns results in order. */
function seqSpawn(...results: SpawnSyncReturns<Buffer>[]) {
  let i = 0;
  return vi.fn().mockImplementation(() => {
    return results[i++] ?? fakeSpawn('', 'unexpected call', 1);
  });
}

// =============================================================================
// routeByState — pure routing
// =============================================================================

describe('routeByState', () => {
  const cases: [StateVerdict['state'], string[], PhaseName | 'halt'][] = [
    ['unshaped', ['shaped', 'decomposed', 'analyzed'], PhaseName.Shape],
    ['shaped', ['decomposed', 'analyzed'], PhaseName.ShapeAdvisors],
    ['decomposed', ['analyzed'], PhaseName.Analyze],
    ['analyzed', ['decomposed'], PhaseName.Branch],        // leaf
    ['analyzed', [], PhaseName.AnalyzeAdvisors],            // epic
    ['executing', [], 'halt'],
    ['complete', [], 'halt'],
  ];

  for (const [state, missing, expected] of cases) {
    it(`should route "${state}" (missing: [${missing}]) -> ${expected}`, () => {
      expect(routeByState({ state, missing_phases: missing, reasons: [] })).toBe(expected);
    });
  }

  it('should halt for unknown state', () => {
    expect(routeByState({ state: 'bogus' as StateVerdict['state'], missing_phases: [], reasons: [] })).toBe('halt');
  });
});

// =============================================================================
// routeToExecution — pure routing
// =============================================================================

describe('routeToExecution', () => {
  it('should route "epic" to Epic phase', () => {
    expect(routeToExecution('epic')).toBe(PhaseName.Epic);
  });

  it('should route "task" to Leaf phase', () => {
    expect(routeToExecution('task')).toBe(PhaseName.Leaf);
  });

  it('should route unknown type to Leaf phase', () => {
    expect(routeToExecution('feature')).toBe(PhaseName.Leaf);
  });
});

// =============================================================================
// preflight
// =============================================================================

describe('preflight', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('should proceed to Select when both scripts pass', async () => {
    const spawn = seqSpawn(
      fakeSpawn(JSON.stringify({ ok: true, failures: [] }), '', 0),
      fakeSpawn('', '', 0),
    );

    const result = await preflight(makeCtx(), { spawnFn: spawn, existsFn: () => true });
    expect(result.next).toBe(PhaseName.Select);
  });

  it('should halt on dirty tree', async () => {
    const failures = [{ kind: 'dirty_tree', reason: 'uncommitted' }];
    const spawn = seqSpawn(
      fakeSpawn(JSON.stringify({ ok: false, failures }), '', 1),
    );

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await preflight(makeCtx(), { spawnFn: spawn, existsFn: () => true });

    expect(result.next).toBe('halt');
  });

  it('should halt when git-safe-to-start fails', async () => {
    const spawn = seqSpawn(
      fakeSpawn(JSON.stringify({ ok: true, failures: [] }), '', 0),
      fakeSpawn('', 'dirty', 1),
    );

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await preflight(makeCtx(), { spawnFn: spawn, existsFn: () => true });

    expect(result.next).toBe('halt');
  });

  it('should halt with generic message when preflight stdout is not JSON', async () => {
    const spawn = seqSpawn(
      fakeSpawn('not json', '', 1),
    );

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await preflight(makeCtx(), { spawnFn: spawn, existsFn: () => true });

    expect(result.next).toBe('halt');
  });
});

// =============================================================================
// select
// =============================================================================

describe('select', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('should store beadId and route to State on success', async () => {
    const bead = { id: 'pv-abc-42', issue_type: 'task', priority: 1 };
    const spawn = seqSpawn(fakeSpawn(JSON.stringify(bead), '', 0));

    const ctx = makeCtx({ beadId: '' });
    const result = await select(ctx, { spawnFn: spawn, existsFn: () => true });

    expect(result.next).toBe(PhaseName.State);
    expect(result.ctx.beadId).toBe('pv-abc-42');
  });

  it('should halt on exit code 3 (exhausted)', async () => {
    const spawn = seqSpawn(fakeSpawn('', '', 3));

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await select(makeCtx(), { spawnFn: spawn, existsFn: () => true });

    expect(result.next).toBe('halt');
  });

  it('should halt on exit code 2 (usage error)', async () => {
    const spawn = seqSpawn(fakeSpawn('', '', 2));

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await select(makeCtx(), { spawnFn: spawn, existsFn: () => true });

    expect(result.next).toBe('halt');
  });
});

// =============================================================================
// assessState
// =============================================================================

describe('assessState', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('should route unshaped -> Shape', async () => {
    const verdict: StateVerdict = { state: 'unshaped', missing_phases: ['shaped'], reasons: [] };
    const spawn = seqSpawn(fakeSpawn(JSON.stringify(verdict), '', 0));

    const result = await assessState(makeCtx(), { spawnFn: spawn, existsFn: () => true });
    expect(result.next).toBe(PhaseName.Shape);
  });

  it('should halt on dryRun', async () => {
    const verdict: StateVerdict = { state: 'unshaped', missing_phases: ['shaped'], reasons: [] };
    const spawn = seqSpawn(fakeSpawn(JSON.stringify(verdict), '', 0));

    const result = await assessState(makeCtx({ dryRun: true }), { spawnFn: spawn, existsFn: () => true });
    expect(result.next).toBe('halt');
  });

  it('should halt on executing state', async () => {
    const verdict: StateVerdict = { state: 'executing', missing_phases: [], reasons: [] };
    const spawn = seqSpawn(fakeSpawn(JSON.stringify(verdict), '', 0));

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await assessState(makeCtx(), { spawnFn: spawn, existsFn: () => true });
    expect(result.next).toBe('halt');
  });

  it('should halt on script failure', async () => {
    const spawn = seqSpawn(fakeSpawn('', 'error', 1));

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await assessState(makeCtx(), { spawnFn: spawn, existsFn: () => true });
    expect(result.next).toBe('halt');
  });
});

// =============================================================================
// shape
// =============================================================================

describe('shape', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('should re-route via routeByState on shaped verdict', async () => {
    const shapeVerdict: ShapeVerdict = { beadId: 'pv-test-1', status: 'shaped', summary: 'ok' };
    const stateVerdict: StateVerdict = { state: 'shaped', missing_phases: ['decomposed'], reasons: [] };

    const spawn = seqSpawn(fakeSpawn(JSON.stringify(stateVerdict), '', 0));

    const result = await shape(makeCtx(), {
      dispatchFn: async () => shapeVerdict as never,
      spawnFn: spawn,
      existsFn: () => true,
    });

    expect(result.next).toBe(PhaseName.ShapeAdvisors);
  });

  it('should escalate and halt on escalate verdict', async () => {
    const shapeVerdict: ShapeVerdict = { beadId: 'pv-test-1', status: 'escalate', summary: 'too vague' };
    const spawn = seqSpawn(fakeSpawn('', '', 0)); // escalation spawn

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await shape(makeCtx(), {
      dispatchFn: async () => shapeVerdict as never,
      spawnFn: spawn,
    });

    expect(result.next).toBe('halt');
  });

  it('should escalate and halt on dispatch timeout', async () => {
    const spawn = seqSpawn(fakeSpawn('', '', 0)); // escalation spawn

    const result = await shape(makeCtx(), {
      dispatchFn: async () => { throw new DispatchTimeoutError('shape-bead', 180000); },
      spawnFn: spawn,
    });

    expect(result.next).toBe('halt');
  });
});

// =============================================================================
// shapeAdvisors
// =============================================================================

describe('shapeAdvisors', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('should skip to Decompose when no file hints', async () => {
    const result = await shapeAdvisors(makeCtx(), {
      getFileHintsFn: () => [],
    });

    expect(result.next).toBe(PhaseName.Decompose);
  });

  it('should route to Decompose on all-clean verdicts', async () => {
    const result = await shapeAdvisors(makeCtx(), {
      getFileHintsFn: () => ['src/server/foo.ts'],
      getBeadContextFn: () => 'bead context',
      spawnFn: seqSpawn(
        fakeSpawn(JSON.stringify([{ name: 'test-advisor', path: '', description: '', rationale: '' }]), '', 0),
      ),
      fanOutFn: async () => ({
        beadId: 'pv-test-1',
        phase: 'phase-3-shape' as const,
        advisors: [{ agent: 'test-advisor', verdict: 'clean' as const, concerns: [], recommendations: [] }],
        overallVerdict: 'clean' as const,
        summary: 'all clean',
      }),
    });

    expect(result.next).toBe(PhaseName.Decompose);
  });

  it('should halt on escalate verdict from advisor', async () => {
    const spawn = seqSpawn(
      // match-agents.sh
      fakeSpawn(JSON.stringify([{ name: 'test-advisor', path: '', description: '', rationale: '' }]), '', 0),
      // bd-escalate.sh
      fakeSpawn('', '', 0),
    );

    const result = await shapeAdvisors(makeCtx(), {
      getFileHintsFn: () => ['src/server/foo.ts'],
      getBeadContextFn: () => 'bead context',
      spawnFn: spawn,
      fanOutFn: async () => ({
        beadId: 'pv-test-1',
        phase: 'phase-3-shape' as const,
        advisors: [{ agent: 'test-advisor', verdict: 'escalate' as const, concerns: ['bad'], recommendations: [] }],
        overallVerdict: 'refinement-needed' as const,
        summary: 'escalate',
      }),
    });

    expect(result.next).toBe('halt');
  });

  it('should route back to Shape on refinement-needed', async () => {
    const result = await shapeAdvisors(makeCtx(), {
      getFileHintsFn: () => ['src/server/foo.ts'],
      getBeadContextFn: () => 'bead context',
      spawnFn: seqSpawn(
        fakeSpawn(JSON.stringify([{ name: 'test-advisor', path: '', description: '', rationale: '' }]), '', 0),
      ),
      fanOutFn: async () => ({
        beadId: 'pv-test-1',
        phase: 'phase-3-shape' as const,
        advisors: [{ agent: 'test-advisor', verdict: 'refinement-needed' as const, concerns: ['fix X'], recommendations: [] }],
        overallVerdict: 'refinement-needed' as const,
        summary: 'needs work',
      }),
    });

    expect(result.next).toBe(PhaseName.Shape);
    expect(result.ctx.refinementReport).toBeDefined();
  });
});

// =============================================================================
// decompose
// =============================================================================

describe('decompose', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('should skip to Analyze when no decomposition needed', async () => {
    const sizing = { needs_decomposition: false, reasons: [] };
    const spawn = seqSpawn(fakeSpawn(JSON.stringify(sizing), '', 0));

    const result = await decompose(makeCtx(), { spawnFn: spawn, existsFn: () => true });
    expect(result.next).toBe(PhaseName.Analyze);
  });

  it('should dispatch and route to Select after successful decomposition', async () => {
    const sizing = { needs_decomposition: true, reasons: ['too large'] };
    const state = { state: 'shaped', missing_phases: ['decomposed', 'analyzed'] }; // leaf
    const report = { parentBeadId: 'pv-epic-1', childBeadIds: ['pv-c1', 'pv-c2'], childCount: 2, summary: 'split' };

    const spawn = seqSpawn(
      fakeSpawn(JSON.stringify(sizing), '', 0),  // sizing check
      fakeSpawn(JSON.stringify(state), '', 0),    // state check (leaf)
    );

    const result = await decompose(makeCtx(), {
      spawnFn: spawn,
      existsFn: () => true,
      dispatchFn: async () => report as never,
    });

    expect(result.next).toBe(PhaseName.Select);
  });
});

// =============================================================================
// analyze
// =============================================================================

describe('analyze', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('should skip to Branch when bead is a leaf (no children)', async () => {
    const result = await analyze(makeCtx(), { childIds: [] });
    expect(result.next).toBe(PhaseName.Branch);
  });

  it('should skip to AnalyzeAdvisors when all children are enriched', async () => {
    const spawn = seqSpawn(
      fakeSpawn('', '', 0), // child 1 enriched
      fakeSpawn('', '', 0), // child 2 enriched
    );

    const result = await analyze(makeCtx(), { childIds: ['c1', 'c2'], spawnFn: spawn });
    expect(result.next).toBe(PhaseName.AnalyzeAdvisors);
  });

  it('should dispatch and route to AnalyzeAdvisors on success', async () => {
    const report = { beadId: 'pv-test-1', mode: 'hierarchy', leavesEnriched: ['c1'], summary: 'done' };
    const spawn = seqSpawn(
      fakeSpawn('', '', 1), // c1 unenriched initially
      fakeSpawn('', '', 0), // c1 enriched after dispatch (belt-and-braces)
    );

    const result = await analyze(makeCtx(), {
      childIds: ['c1'],
      spawnFn: spawn,
      dispatchFn: async () => report as never,
    });

    expect(result.next).toBe(PhaseName.AnalyzeAdvisors);
  });
});

// =============================================================================
// analyzeAdvisors
// =============================================================================

describe('analyzeAdvisors', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('should skip to Branch when bead is a leaf', async () => {
    const result = await analyzeAdvisors(makeCtx(), {
      isEpicFn: () => false,
    });

    expect(result.next).toBe(PhaseName.Branch);
  });

  it('should route to Branch on all-clean verdicts', async () => {
    const result = await analyzeAdvisors(makeCtx(), {
      isEpicFn: () => true,
      getFileHintsFn: () => ['src/server/foo.ts'],
      getBeadContextFn: () => 'context',
      spawnFn: seqSpawn(
        fakeSpawn(JSON.stringify([{ name: 'adv', path: '', description: '', rationale: '' }]), '', 0),
      ),
      fanOutFn: async () => ({
        beadId: 'pv-test-1',
        phase: 'phase-5-analyze' as const,
        advisors: [{ agent: 'adv', verdict: 'clean' as const, concerns: [], recommendations: [] }],
        overallVerdict: 'clean' as const,
        summary: 'approved',
      }),
    });

    expect(result.next).toBe(PhaseName.Branch);
  });
});

// =============================================================================
// branch
// =============================================================================

describe('branch', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('should halt when git-safe-to-start fails', async () => {
    const spawn = seqSpawn(fakeSpawn('', 'dirty tree', 1));

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await branch(makeCtx(), { spawnFn: spawn });

    expect(result.next).toBe('halt');
  });

  it('should create branch and route epic to Epic phase', async () => {
    const bdShowJson = JSON.stringify([{ issue_type: 'epic' }]);
    const spawn = seqSpawn(
      fakeSpawn('', '', 0),                   // git-safe-to-start
      fakeSpawn('feat/pv-test-1', '', 0),     // branch-name.sh
      fakeSpawn('main', '', 0),               // git branch --show-current
      fakeSpawn('', '', 0),                   // git checkout -b
      fakeSpawn(bdShowJson, '', 0),           // bd show --json
    );

    const result = await branch(makeCtx(), { spawnFn: spawn });

    expect(result.next).toBe(PhaseName.Epic);
  });

  it('should route non-epic to Leaf phase', async () => {
    const bdShowJson = JSON.stringify([{ issue_type: 'task' }]);
    const spawn = seqSpawn(
      fakeSpawn('', '', 0),                   // git-safe-to-start
      fakeSpawn('feat/pv-test-1', '', 0),     // branch-name.sh
      fakeSpawn('main', '', 0),               // git branch --show-current
      fakeSpawn('', '', 0),                   // git checkout -b
      fakeSpawn(bdShowJson, '', 0),           // bd show --json
    );

    const result = await branch(makeCtx(), { spawnFn: spawn });

    expect(result.next).toBe(PhaseName.Leaf);
  });

  it('should skip checkout if already on target branch', async () => {
    const bdShowJson = JSON.stringify([{ issue_type: 'task' }]);
    const spawn = seqSpawn(
      fakeSpawn('', '', 0),                   // git-safe-to-start
      fakeSpawn('feat/pv-test-1', '', 0),     // branch-name.sh
      fakeSpawn('feat/pv-test-1', '', 0),     // git branch --show-current (same!)
      fakeSpawn(bdShowJson, '', 0),           // bd show --json
    );

    const result = await branch(makeCtx(), { spawnFn: spawn });

    expect(result.next).toBe(PhaseName.Leaf);
    // Only 4 spawn calls, not 5 (no checkout)
    expect(spawn).toHaveBeenCalledTimes(4);
  });
});

// =============================================================================
// Message constant checks
// =============================================================================

describe('message constants', () => {
  it('should have exactly 4 preflight message kinds', () => {
    expect(Object.keys(PREFLIGHT_MESSAGES)).toEqual([
      'dirty_tree', 'wrong_branch', 'stale_main', 'empty_backlog',
    ]);
  });

  it('should use em-dash in all preflight messages', () => {
    for (const msg of Object.values(PREFLIGHT_MESSAGES)) {
      expect(msg).toContain('\u2014');
    }
  });
});
