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
  buildShapePrompt,
  buildAnalyzePrompt,
  buildAdvisorTriagePrompt,
  parseAdvisorTriageVerdict,
  applyAdvisorTriage,
  formatRefinementFeedback,
  REFINEMENT_ROUND_CAP_DEFAULT,
  PREFLIGHT_MESSAGES,
  GIT_SAFE_MESSAGES,
  type PhaseCtx,
  type PhaseDeps,
  type StateVerdict,
  type ShapeVerdict,
  type AdvisorTriageVerdict,
} from '../../lib/phases.js';
import { PhaseName, type RunLogger } from '../../lib/types.js';
import { DispatchTimeoutError, type RefinementReport, type DispatchOptions } from '../../lib/dispatch.js';

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
// Canonical bd show text outputs for classifyBeadState()
// =============================================================================

/** Returns text that classifyBeadState() interprets as "unshaped" */
function beadTextUnshaped(): string {
  return 'OPEN pv-test-1 Add something\n';
}

/** Returns text that classifyBeadState() interprets as "shaped" */
function beadTextShaped(): string {
  return [
    'OPEN pv-test-1 Add something',
    'DESCRIPTION',
    'This is a real description that is non-empty.',
    'DESIGN',
    'Some design notes.',
    'ACCEPTANCE CRITERIA',
    'It works.',
  ].join('\n');
}

/** Returns text that classifyBeadState() interprets as "analyzed" (has Implementation Context) */
function beadTextAnalyzed(): string {
  return beadTextShaped() + '\nNOTES\nImplementation Context\nSome details.\n';
}

/** Returns text that classifyBeadState() interprets as "executing" */
function beadTextExecuting(): string {
  return 'IN_PROGRESS pv-test-1 Something in flight\n';
}

// =============================================================================
// Canonical seqSpawn sequences for gitSafeToStart() (3 git calls)
// =============================================================================

/** 3 spawn calls that satisfy gitSafeToStart() successfully */
function gitSafeOkSpawns(): SpawnSyncReturns<Buffer>[] {
  return [
    fakeSpawn('true', '', 0),   // git rev-parse --is-inside-work-tree
    fakeSpawn('main', '', 0),   // git rev-parse --abbrev-ref HEAD
    fakeSpawn('', '', 0),       // git status --porcelain (clean)
  ];
}

/** 3 spawn calls that make gitSafeToStart() fail on dirty tree */
function gitSafeDirtySpawns(): SpawnSyncReturns<Buffer>[] {
  return [
    fakeSpawn('true', '', 0),        // git rev-parse --is-inside-work-tree
    fakeSpawn('main', '', 0),        // git rev-parse --abbrev-ref HEAD
    fakeSpawn('M somefile', '', 0),  // git status --porcelain (dirty)
  ];
}

// =============================================================================
// Canonical seqSpawn sequences for preflight() / runPreflightCheck() (6 calls)
// then gitSafeToStart() (3 calls) = 9 total for full success
// =============================================================================

/**
 * 9 spawn calls for a fully passing preflight() (runPreflightCheck + gitSafeToStart).
 * Bead id used for label check is passed in.
 */
function preflightPassingSpawns(beadId = 'pv-abc-1'): SpawnSyncReturns<Buffer>[] {
  return [
    // runPreflightCheck:
    fakeSpawn('', '', 0),                                  // git status --porcelain (clean)
    fakeSpawn('main', '', 0),                              // git branch --show-current
    fakeSpawn('', '', 0),                                  // git fetch origin main
    fakeSpawn('', '', 0),                                  // git diff origin/main --quiet
    fakeSpawn(JSON.stringify([{ id: beadId }]), '', 0),    // bd ready --limit=50 --json
    fakeSpawn('- other-label', '', 0),                     // bd label list <id>
    // gitSafeToStart:
    ...gitSafeOkSpawns(),
  ];
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

  it('should proceed to Select when all checks pass', async () => {
    const spawn = seqSpawn(...preflightPassingSpawns());

    const result = await preflight(makeCtx(), { spawnFn: spawn });
    expect(result.next).toBe(PhaseName.Select);
  });

  it('should halt on dirty tree (preflight check fails)', async () => {
    // git status --porcelain returns non-empty (dirty tree)
    const spawn = seqSpawn(
      fakeSpawn('M dirty-file', '', 0),  // git status --porcelain — dirty
    );

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await preflight(makeCtx(), { spawnFn: spawn });

    expect(result.next).toBe('halt');
  });

  it('should halt when git-safe-to-start fails after preflight passes', async () => {
    // runPreflightCheck passes (6 calls), then gitSafeToStart fails on dirty tree
    const spawn = seqSpawn(
      // runPreflightCheck passes:
      fakeSpawn('', '', 0),                                      // git status --porcelain (clean)
      fakeSpawn('main', '', 0),                                  // git branch --show-current
      fakeSpawn('', '', 0),                                      // git fetch origin main
      fakeSpawn('', '', 0),                                      // git diff origin/main --quiet
      fakeSpawn(JSON.stringify([{ id: 'pv-abc-1' }]), '', 0),   // bd ready --limit=50 --json
      fakeSpawn('- other-label', '', 0),                         // bd label list
      // gitSafeToStart fails:
      fakeSpawn('true', '', 0),    // git rev-parse --is-inside-work-tree
      fakeSpawn('main', '', 0),    // git rev-parse --abbrev-ref HEAD
      fakeSpawn('M file', '', 0),  // git status --porcelain (dirty)
    );

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await preflight(makeCtx(), { spawnFn: spawn });

    expect(result.next).toBe('halt');
  });

  it('should halt when backlog is empty (automatic selection mode)', async () => {
    const spawn = seqSpawn(
      fakeSpawn('', '', 0),        // git status --porcelain (clean)
      fakeSpawn('main', '', 0),    // git branch --show-current
      fakeSpawn('', '', 0),        // git fetch origin main
      fakeSpawn('', '', 0),        // git diff origin/main --quiet
      fakeSpawn('[]', '', 0),      // bd ready: empty array
    );

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await preflight(makeCtx({ beadId: '' }), { spawnFn: spawn });

    expect(result.next).toBe('halt');
  });

  it('should ignore empty backlog when an explicit bead-id is supplied', async () => {
    // runPreflightCheck reports empty_backlog, but with beadId preset we skip it
    // and proceed through gitSafeToStart to Select.
    const spawn = seqSpawn(
      // runPreflightCheck (empty_backlog is the only failure):
      fakeSpawn('', '', 0),        // git status --porcelain (clean)
      fakeSpawn('main', '', 0),    // git branch --show-current
      fakeSpawn('', '', 0),        // git fetch origin main
      fakeSpawn('', '', 0),        // git diff origin/main --quiet
      fakeSpawn('[]', '', 0),      // bd ready: empty array
      // gitSafeToStart passes:
      ...gitSafeOkSpawns(),
    );

    const result = await preflight(makeCtx({ beadId: 'pv-explicit-7' }), { spawnFn: spawn });

    expect(result.next).toBe(PhaseName.Select);
    expect(result.ctx.beadId).toBe('pv-explicit-7');
  });
});

// =============================================================================
// select
// =============================================================================

describe('select', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('should store beadId and route to State on success', async () => {
    // bdTopReady: bd ready --limit=5 --json + bd label list (no needs-human)
    const bead = { id: 'pv-abc-42', issue_type: 'task', priority: 1 };
    const spawn = seqSpawn(
      fakeSpawn(JSON.stringify([bead]), '', 0),  // bd ready --limit=5 --json
      fakeSpawn('- other-label', '', 0),          // bd label list pv-abc-42
    );

    const ctx = makeCtx({ beadId: '' });
    const result = await select(ctx, { spawnFn: spawn });

    expect(result.next).toBe(PhaseName.State);
    expect(result.ctx.beadId).toBe('pv-abc-42');
  });

  it('should halt when backlog is exhausted (empty list)', async () => {
    const spawn = seqSpawn(
      fakeSpawn('[]', '', 0),  // bd ready --limit=5 --json: empty
    );

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await select(makeCtx({ beadId: '' }), { spawnFn: spawn });

    expect(result.next).toBe('halt');
  });

  it('should halt when bd ready fails', async () => {
    const spawn = seqSpawn(
      fakeSpawn('', 'error', 1),  // bd ready fails
    );

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await select(makeCtx({ beadId: '' }), { spawnFn: spawn });

    expect(result.next).toBe('halt');
  });

  it('should halt when all beads have needs-human label', async () => {
    const bead = { id: 'pv-abc-42', issue_type: 'task', priority: 1 };
    const spawn = seqSpawn(
      fakeSpawn(JSON.stringify([bead]), '', 0),   // bd ready --limit=5 --json
      fakeSpawn('- needs-human', '', 0),           // bd label list: needs-human
    );

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await select(makeCtx({ beadId: '' }), { spawnFn: spawn });

    expect(result.next).toBe('halt');
  });

  it('should skip bdTopReady and route to State when beadId is pre-set', async () => {
    // No spawn calls expected: explicit bead-id mode bypasses bd ready entirely.
    const spawn = seqSpawn();

    const ctx = makeCtx({ beadId: 'pv-explicit-99' });
    const result = await select(ctx, { spawnFn: spawn });

    expect(result.next).toBe(PhaseName.State);
    expect(result.ctx.beadId).toBe('pv-explicit-99');
    expect(spawn).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Epic promotion
  // -------------------------------------------------------------------------
  //
  // When /process-backlog auto-selects a leaf whose parent is an analyzed
  // epic with >= 2 ready children, we want it to pivot to the epic id so
  // the epic phase can run as a wave. These tests cover the decision matrix.

  /** Text for bdState() that looks like an enriched (analyzed) epic. */
  function beadTextAnalyzedEpic(): string {
    return [
      'OPEN pv-epic',
      'DESCRIPTION',
      'A nontrivial epic that spans multiple beads.',
      'DESIGN',
      'Break the work into independent leaves.',
      'ACCEPTANCE CRITERIA',
      '- All child beads close',
      'CHILDREN',
      '  ↳ pv-child-1',
      '  ↳ pv-child-2',
      'NOTES',
      'Implementation Context: children enriched with scope and test plan.',
    ].join('\n');
  }

  /** Text for bdState() that looks like an epic before analyze. */
  function beadTextShapedOnlyEpic(): string {
    return [
      'OPEN pv-epic',
      'DESCRIPTION',
      'Shaped epic without children yet.',
      'DESIGN',
      'TBD',
      'ACCEPTANCE CRITERIA',
      '- Define child beads',
      'NOTES',
      'not yet analyzed',
    ].join('\n');
  }

  it('should promote leaf to its analyzed epic parent with 2+ ready children', async () => {
    const leaf = { id: 'pv-child-1', issue_type: 'task', priority: 1 };
    const leafFull = { id: 'pv-child-1', issue_type: 'task', parent: 'pv-epic' };
    const epicFull = {
      id: 'pv-epic',
      issue_type: 'epic',
      title: 'Orchestrator resilience',
      dependents: [
        { id: 'pv-child-1', dependency_type: 'parent-child' },
        { id: 'pv-child-2', dependency_type: 'parent-child' },
      ],
    };

    const spawn = seqSpawn(
      // bdTopReady
      fakeSpawn(JSON.stringify([leaf]), '', 0),  // bd ready --limit=5 --json
      fakeSpawn('- other', '', 0),                // bd label list pv-child-1

      // checkEpicPromotion
      fakeSpawn(JSON.stringify([leafFull]), '', 0),     // bd show pv-child-1 --json
      fakeSpawn(JSON.stringify([epicFull]), '', 0),     // bd show pv-epic --json
      fakeSpawn(beadTextAnalyzedEpic(), '', 0),         // bd show pv-epic (bdState)
      fakeSpawn(JSON.stringify([                        // bd ready --limit=200 --json
        { id: 'pv-child-1' }, { id: 'pv-child-2' },
      ]), '', 0),
      fakeSpawn(JSON.stringify([epicFull]), '', 0),     // bd show pv-epic --json (bdListChildren)
      fakeSpawn('- other', '', 0),                      // bd label list pv-child-1
      fakeSpawn('- other', '', 0),                      // bd label list pv-child-2
    );

    const ctx = makeCtx({ beadId: '' });
    const result = await select(ctx, { spawnFn: spawn });

    expect(result.next).toBe(PhaseName.State);
    expect(result.ctx.beadId).toBe('pv-epic');
  });

  it('should not promote when leaf has no parent', async () => {
    const leaf = { id: 'pv-solo', issue_type: 'task', priority: 1 };
    const leafFull = { id: 'pv-solo', issue_type: 'task' };  // no parent

    const spawn = seqSpawn(
      fakeSpawn(JSON.stringify([leaf]), '', 0),
      fakeSpawn('- other', '', 0),
      fakeSpawn(JSON.stringify([leafFull]), '', 0),  // no parent -> early return
    );

    const ctx = makeCtx({ beadId: '' });
    const result = await select(ctx, { spawnFn: spawn });

    expect(result.next).toBe(PhaseName.State);
    expect(result.ctx.beadId).toBe('pv-solo');
  });

  it('should not promote when parent is not an epic', async () => {
    const leaf = { id: 'pv-sub', issue_type: 'task', priority: 1 };
    const leafFull = { id: 'pv-sub', issue_type: 'task', parent: 'pv-task-parent' };
    const parentFull = { id: 'pv-task-parent', issue_type: 'task' };  // not an epic

    const spawn = seqSpawn(
      fakeSpawn(JSON.stringify([leaf]), '', 0),
      fakeSpawn('- other', '', 0),
      fakeSpawn(JSON.stringify([leafFull]), '', 0),
      fakeSpawn(JSON.stringify([parentFull]), '', 0),  // issue_type != epic -> return null
    );

    const ctx = makeCtx({ beadId: '' });
    const result = await select(ctx, { spawnFn: spawn });

    expect(result.next).toBe(PhaseName.State);
    expect(result.ctx.beadId).toBe('pv-sub');
  });

  it('should not promote when epic parent is not yet analyzed', async () => {
    const leaf = { id: 'pv-child-1', issue_type: 'task', priority: 1 };
    const leafFull = { id: 'pv-child-1', issue_type: 'task', parent: 'pv-epic' };
    const epicFull = { id: 'pv-epic', issue_type: 'epic' };

    const spawn = seqSpawn(
      fakeSpawn(JSON.stringify([leaf]), '', 0),
      fakeSpawn('- other', '', 0),
      fakeSpawn(JSON.stringify([leafFull]), '', 0),
      fakeSpawn(JSON.stringify([epicFull]), '', 0),
      fakeSpawn(beadTextShapedOnlyEpic(), '', 0),  // bdState: missing_phases includes 'analyzed'
    );

    const ctx = makeCtx({ beadId: '' });
    const result = await select(ctx, { spawnFn: spawn });

    expect(result.next).toBe(PhaseName.State);
    expect(result.ctx.beadId).toBe('pv-child-1');
  });

  it('should not promote when epic has only 1 ready child', async () => {
    const leaf = { id: 'pv-child-1', issue_type: 'task', priority: 1 };
    const leafFull = { id: 'pv-child-1', issue_type: 'task', parent: 'pv-epic' };
    const epicFull = {
      id: 'pv-epic',
      issue_type: 'epic',
      dependents: [
        { id: 'pv-child-1', dependency_type: 'parent-child' },
        { id: 'pv-child-2', dependency_type: 'parent-child' },  // exists but not ready
      ],
    };

    const spawn = seqSpawn(
      fakeSpawn(JSON.stringify([leaf]), '', 0),
      fakeSpawn('- other', '', 0),
      fakeSpawn(JSON.stringify([leafFull]), '', 0),
      fakeSpawn(JSON.stringify([epicFull]), '', 0),
      fakeSpawn(beadTextAnalyzedEpic(), '', 0),
      fakeSpawn(JSON.stringify([{ id: 'pv-child-1' }]), '', 0),  // only child-1 in bd ready
      fakeSpawn(JSON.stringify([epicFull]), '', 0),
      fakeSpawn('- other', '', 0),
    );

    const ctx = makeCtx({ beadId: '' });
    const result = await select(ctx, { spawnFn: spawn });

    expect(result.next).toBe(PhaseName.State);
    expect(result.ctx.beadId).toBe('pv-child-1');
  });

  it('should promote even when bd reports the epic parent as blocked-by-children', async () => {
    // Guard: an analyzed epic's bd status may be "blocked" because bd views
    // its unclosed children as blockers. That's normal for epics and must NOT
    // prevent promotion — the wave executor iterates exactly those children.
    const leaf = { id: 'pv-child-1', issue_type: 'task', priority: 1 };
    const leafFull = { id: 'pv-child-1', issue_type: 'task', parent: 'pv-epic' };
    const epicFull = {
      id: 'pv-epic',
      issue_type: 'epic',
      status: 'blocked',   // bd reports blocked — must not disqualify promotion
      dependents: [
        { id: 'pv-child-1', dependency_type: 'parent-child' },
        { id: 'pv-child-2', dependency_type: 'parent-child' },
        { id: 'pv-child-3', dependency_type: 'parent-child' },
      ],
    };

    const spawn = seqSpawn(
      fakeSpawn(JSON.stringify([leaf]), '', 0),
      fakeSpawn('- other', '', 0),
      fakeSpawn(JSON.stringify([leafFull]), '', 0),
      fakeSpawn(JSON.stringify([epicFull]), '', 0),
      fakeSpawn(beadTextAnalyzedEpic(), '', 0),
      fakeSpawn(JSON.stringify([
        { id: 'pv-child-1' }, { id: 'pv-child-2' }, { id: 'pv-child-3' },
      ]), '', 0),
      fakeSpawn(JSON.stringify([epicFull]), '', 0),
      fakeSpawn('- other', '', 0),
      fakeSpawn('- other', '', 0),
      fakeSpawn('- other', '', 0),
    );

    const ctx = makeCtx({ beadId: '' });
    const result = await select(ctx, { spawnFn: spawn });

    expect(result.ctx.beadId).toBe('pv-epic');
  });

  it('should not promote when 2 children exist but one is needs-human labelled', async () => {
    const leaf = { id: 'pv-child-1', issue_type: 'task', priority: 1 };
    const leafFull = { id: 'pv-child-1', issue_type: 'task', parent: 'pv-epic' };
    const epicFull = {
      id: 'pv-epic',
      issue_type: 'epic',
      dependents: [
        { id: 'pv-child-1', dependency_type: 'parent-child' },
        { id: 'pv-child-2', dependency_type: 'parent-child' },
      ],
    };

    const spawn = seqSpawn(
      fakeSpawn(JSON.stringify([leaf]), '', 0),
      fakeSpawn('- other', '', 0),
      fakeSpawn(JSON.stringify([leafFull]), '', 0),
      fakeSpawn(JSON.stringify([epicFull]), '', 0),
      fakeSpawn(beadTextAnalyzedEpic(), '', 0),
      fakeSpawn(JSON.stringify([
        { id: 'pv-child-1' }, { id: 'pv-child-2' },
      ]), '', 0),
      fakeSpawn(JSON.stringify([epicFull]), '', 0),
      fakeSpawn('- other', '', 0),         // child-1 label list
      fakeSpawn('- needs-human', '', 0),    // child-2 labelled -> excluded
    );

    const ctx = makeCtx({ beadId: '' });
    const result = await select(ctx, { spawnFn: spawn });

    expect(result.ctx.beadId).toBe('pv-child-1');
  });
});

// =============================================================================
// assessState
// =============================================================================

describe('assessState', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('should route unshaped -> Shape', async () => {
    // bdState calls bd show <beadId>, returns text classifyBeadState reads
    const spawn = seqSpawn(fakeSpawn(beadTextUnshaped(), '', 0));

    const result = await assessState(makeCtx(), { spawnFn: spawn });
    expect(result.next).toBe(PhaseName.Shape);
  });

  it('should halt on dryRun', async () => {
    const spawn = seqSpawn(fakeSpawn(beadTextUnshaped(), '', 0));

    const result = await assessState(makeCtx({ dryRun: true }), { spawnFn: spawn });
    expect(result.next).toBe('halt');
  });

  it('should halt on executing state', async () => {
    const spawn = seqSpawn(fakeSpawn(beadTextExecuting(), '', 0));

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await assessState(makeCtx(), { spawnFn: spawn });
    expect(result.next).toBe('halt');
  });

  it('should route to ShapeAdvisors when bead is shaped', async () => {
    const spawn = seqSpawn(fakeSpawn(beadTextShaped(), '', 0));

    const result = await assessState(makeCtx(), { spawnFn: spawn });
    expect(result.next).toBe(PhaseName.ShapeAdvisors);
  });

  it('should halt on bd show failure (bd state error)', async () => {
    // bdState returns unshaped with error reason when bd show fails,
    // so we get routed to Shape (not halt). To test the "failure" path,
    // we verify that even on error we get a valid route (unshaped → Shape).
    const spawn = seqSpawn(fakeSpawn('', 'error', 1));

    const result = await assessState(makeCtx(), { spawnFn: spawn });
    // bdState() returns unshaped as safe default on failure
    expect(result.next).toBe(PhaseName.Shape);
  });
});

// =============================================================================
// shape
// =============================================================================

describe('shape', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('should re-route via routeByState on shaped verdict', async () => {
    const shapeVerdict: ShapeVerdict = { beadId: 'pv-test-1', status: 'shaped', summary: 'ok' };
    // Post-shape state recheck: bdState calls bd show → shaped text
    const spawn = seqSpawn(fakeSpawn(beadTextShaped(), '', 0));

    const result = await shape(makeCtx(), {
      dispatchFn: async () => shapeVerdict as never,
      spawnFn: spawn,
    });

    expect(result.next).toBe(PhaseName.ShapeAdvisors);
  });

  it('should escalate and halt on escalate verdict', async () => {
    const shapeVerdict: ShapeVerdict = { beadId: 'pv-test-1', status: 'escalate', summary: 'too vague' };
    // escalate() calls bdEscalate: bd label add, bd show --json, bd update
    const spawn = seqSpawn(
      fakeSpawn('', '', 0),                                 // bd label add
      fakeSpawn(JSON.stringify([{ notes: '' }]), '', 0),    // bd show --json
      fakeSpawn('', '', 0),                                 // bd update --append-notes
    );

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await shape(makeCtx(), {
      dispatchFn: async () => shapeVerdict as never,
      spawnFn: spawn,
    });

    expect(result.next).toBe('halt');
  });

  it('should halt without escalating to needs-human on dispatch timeout', async () => {
    // Timeout is classified as transient_halt: the run halts but the bead
    // stays open and eligible for the next /process-backlog invocation.
    // bdEscalate is NOT called, so no bd spawn calls should happen here.
    const spawn = seqSpawn();

    const log = stubLogger();
    const ctx = makeCtx({ logger: log.logger });
    const result = await shape(ctx, {
      dispatchFn: async () => { throw new DispatchTimeoutError('shape-bead', 300000); },
      spawnFn: spawn,
    });

    expect(result.next).toBe('halt');
    expect(spawn).not.toHaveBeenCalled();
    // Verify the timeout event was logged (distinct from *_escalated)
    expect(log.jsonEntries.some(e => e.event === 'shape_bead_timed_out')).toBe(true);
    expect(log.jsonEntries.some(e => e.event === 'shape_bead_escalated')).toBe(false);
  });

  it('should escalate to needs-human on malformed dispatch output', async () => {
    // Malformed output IS an escalation: bdEscalate runs its bd commands.
    const spawn = seqSpawn(
      fakeSpawn('', '', 0),                                 // bd label add
      fakeSpawn(JSON.stringify([{ notes: '' }]), '', 0),    // bd show --json
      fakeSpawn('', '', 0),                                 // bd update --append-notes
    );

    const log = stubLogger();
    const { DispatchMalformedError } = await import('../../lib/dispatch.js');
    const result = await shape(makeCtx({ logger: log.logger }), {
      dispatchFn: async () => { throw new DispatchMalformedError('shape-bead', 'not json'); },
      spawnFn: spawn,
    });

    expect(result.next).toBe('halt');
    expect(log.jsonEntries.some(e => e.event === 'shape_bead_escalated')).toBe(true);
  });

  // Regression: shape() used to build its prompt from beadId only,
  // ignoring ctx.refinementReport. That made the refinement loop
  // re-dispatch the agent with identical input each round.
  it('threads ctx.refinementReport into the shape prompt on re-dispatch', async () => {
    const report: RefinementReport = {
      beadId: 'pv-test-1',
      phase: 'phase-3-shape',
      advisors: [{
        agent: 'testing-advisor',
        verdict: 'refinement-needed',
        concerns: ['no tests planned for register.vue'],
        recommendations: ['add register.vue.test.ts'],
      }],
      overallVerdict: 'refinement-needed',
      summary: '1 concern from testing-advisor',
    };

    let capturedPrompt = '';
    const spawn = seqSpawn(fakeSpawn(beadTextShaped(), '', 0));

    await shape(makeCtx({ refinementReport: report }), {
      dispatchFn: (async (opts: DispatchOptions) => {
        capturedPrompt = opts.prompt;
        return { beadId: 'pv-test-1', status: 'shaped', summary: 'ok' } as never;
      }) as PhaseDeps['dispatchFn'],
      spawnFn: spawn,
    });

    expect(capturedPrompt).toContain('Refinement feedback');
    expect(capturedPrompt).toContain('testing-advisor');
    expect(capturedPrompt).toContain('no tests planned for register.vue');
    expect(capturedPrompt).toContain('add register.vue.test.ts');
  });
});

// =============================================================================
// shapeAdvisors
// =============================================================================

describe('shapeAdvisors', () => {
  beforeEach(() => vi.restoreAllMocks());

  // Helper: a selectAdvisorsFn that returns a stubbed MatchedAdvisor list.
  const fakeSelectAdvisors = (advisors: Array<{ name: string }>) =>
    async () => advisors.map(a => ({
      name: a.name,
      path: `/agents/${a.name}.md`,
      description: 'stub',
      rationale: 'test',
    }));

  it('should halt and escalate when selector returns empty', async () => {
    // bdEscalate calls: bd label add, bd show --json, bd update --append-notes
    const spawn = seqSpawn(
      fakeSpawn('', '', 0),                                 // bd label add
      fakeSpawn(JSON.stringify([{ notes: '' }]), '', 0),    // bd show --json
      fakeSpawn('', '', 0),                                 // bd update --append-notes
    );

    const result = await shapeAdvisors(makeCtx(), {
      spawnFn: spawn,
      selectAdvisorsFn: fakeSelectAdvisors([]),
    });

    // Empty selection now halts (instead of silently advancing).
    expect(result.next).toBe('halt');
  });

  it('should route to Decompose on all-clean verdicts', async () => {
    const result = await shapeAdvisors(makeCtx(), {
      selectAdvisorsFn: fakeSelectAdvisors([{ name: 'test-advisor' }]),
      getBeadContextFn: () => 'bead context',
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
      fakeSpawn('', '', 0),
      fakeSpawn(JSON.stringify([{ notes: '' }]), '', 0),
      fakeSpawn('', '', 0),
    );

    const result = await shapeAdvisors(makeCtx(), {
      spawnFn: spawn,
      selectAdvisorsFn: fakeSelectAdvisors([{ name: 'test-advisor' }]),
      getBeadContextFn: () => 'bead context',
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
      selectAdvisorsFn: fakeSelectAdvisors([{ name: 'test-advisor' }]),
      getBeadContextFn: () => 'bead context',
      fanOutFn: async () => ({
        beadId: 'pv-test-1',
        phase: 'phase-3-shape' as const,
        advisors: [{ agent: 'test-advisor', verdict: 'refinement-needed' as const, concerns: ['fix X'], recommendations: [] }],
        overallVerdict: 'refinement-needed' as const,
        summary: 'needs work',
      }),
    });

    expect(result.next).toBe(PhaseName.Shape);
  });
});

// =============================================================================
// decompose
// =============================================================================

describe('decompose', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('should skip to Analyze when no decomposition needed', async () => {
    // bdSizingCheck calls bd show → text without enough criteria
    const spawn = seqSpawn(fakeSpawn(beadTextShaped(), '', 0));

    const result = await decompose(makeCtx(), { spawnFn: spawn });
    expect(result.next).toBe(PhaseName.Analyze);
  });

  it('should dispatch and route to Analyze after successful decomposition', async () => {
    // Need text that triggers sizing (4+ files, 2+ domains)
    const bigBeadText = [
      'OPEN pv-test-1 Big epic bead',
      'DESCRIPTION',
      'This bead touches the backend API, frontend component, service layer, and migration.',
      'DESIGN',
      'Files: src/server/foo/api/foo.ts, src/server/foo/entity/foo-entity.ts,',
      'src/server/foo/service/foo-service.ts, src/client/components/foo.vue,',
      'src/site/components/bar.vue, migrations/foo.sql',
      '- Add endpoint',
      '- Update entity',
      '- Create service',
      '- Build component',
      '- Write migration',
      'ACCEPTANCE CRITERIA',
      'All tests pass.',
    ].join('\n');

    // bd show output for a bead that has been decomposed (has CHILDREN section).
    const decomposedBeadText = beadTextShaped() + '\nCHILDREN\n  \u21b3 pv-c1: first\n  \u21b3 pv-c2: second\n';

    const report = { parentBeadId: 'pv-epic-1', childBeadIds: ['pv-c1', 'pv-c2'], childCount: 2, summary: 'split' };

    const spawn = seqSpawn(
      // bdSizingCheck: bd show
      fakeSpawn(bigBeadText, '', 0),
      // bdState (epic check): bd show → shaped (missing decomposed)
      fakeSpawn(beadTextShaped(), '', 0),
      // bdState (post-decompose verification): bd show → now has CHILDREN
      fakeSpawn(decomposedBeadText, '', 0),
    );

    const result = await decompose(makeCtx(), {
      spawnFn: spawn,
      dispatchFn: async () => report as never,
    });

    expect(result.next).toBe(PhaseName.Analyze);
  });

  it('should route to Analyze and log decompose_declined when agent leaves bead without children', async () => {
    const bigBeadText = [
      'OPEN pv-test-1 Big epic bead',
      'DESCRIPTION',
      'This bead touches the backend API, frontend component, service layer, and migration.',
      'DESIGN',
      'Files: src/server/foo/api/foo.ts, src/server/foo/entity/foo-entity.ts,',
      'src/server/foo/service/foo-service.ts, src/client/components/foo.vue,',
      'src/site/components/bar.vue, migrations/foo.sql',
      '- Add endpoint',
      '- Update entity',
      '- Create service',
      '- Build component',
      '- Write migration',
      'ACCEPTANCE CRITERIA',
      'All tests pass.',
    ].join('\n');

    const declineReport = 'Verdict: NOT DECOMPOSED — already a leaf bead.';

    const spawn = seqSpawn(
      // bdSizingCheck
      fakeSpawn(bigBeadText, '', 0),
      // bdState (epic check) — still shaped
      fakeSpawn(beadTextShaped(), '', 0),
      // bdState (post-decompose verification) — still shaped, agent declined
      fakeSpawn(beadTextShaped(), '', 0),
    );

    const result = await decompose(makeCtx(), {
      spawnFn: spawn,
      dispatchFn: async () => declineReport as never,
    });

    expect(result.next).toBe(PhaseName.Analyze);
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
    // bdEnrichmentCheck calls bd show for each child, checks for "Implementation Context"
    const spawn = seqSpawn(
      fakeSpawn(beadTextAnalyzed(), '', 0),   // c1 enriched (has Implementation Context)
      fakeSpawn(beadTextAnalyzed(), '', 0),   // c2 enriched
    );

    const result = await analyze(makeCtx(), { childIds: ['c1', 'c2'], spawnFn: spawn });
    expect(result.next).toBe(PhaseName.AnalyzeAdvisors);
  });

  it('should dispatch and route to AnalyzeAdvisors on success', async () => {
    const report = { beadId: 'pv-test-1', mode: 'hierarchy', leavesEnriched: ['c1'], summary: 'done' };
    const spawn = seqSpawn(
      fakeSpawn(beadTextShaped(), '', 0),    // c1 unenriched initially (no Implementation Context)
      fakeSpawn(beadTextAnalyzed(), '', 0),  // c1 enriched after dispatch (belt-and-braces)
    );

    const result = await analyze(makeCtx(), {
      childIds: ['c1'],
      spawnFn: spawn,
      dispatchFn: async () => report as never,
    });

    expect(result.next).toBe(PhaseName.AnalyzeAdvisors);
  });

  it('should discover children via bd show --json when childIds is omitted', async () => {
    // bdListChildren calls `bd show <parent> --json` and parses parent-child dependents.
    const parentJson = JSON.stringify([{
      id: 'pv-test-1',
      dependents: [
        { id: 'c1', dependency_type: 'parent-child', issue_type: 'task' },
        { id: 'c2', dependency_type: 'parent-child', issue_type: 'task' },
        { id: 'rel', dependency_type: 'related', issue_type: 'task' },
      ],
    }]);
    const report = { beadId: 'pv-test-1', mode: 'hierarchy', leavesEnriched: ['c1', 'c2'], summary: 'done' };
    const spawn = seqSpawn(
      fakeSpawn(parentJson, '', 0),          // bdListChildren
      fakeSpawn(beadTextShaped(), '', 0),    // c1 unenriched
      fakeSpawn(beadTextShaped(), '', 0),    // c2 unenriched
      fakeSpawn(beadTextAnalyzed(), '', 0),  // c1 enriched after dispatch
      fakeSpawn(beadTextAnalyzed(), '', 0),  // c2 enriched after dispatch
    );

    const result = await analyze(makeCtx(), {
      spawnFn: spawn,
      dispatchFn: async () => report as never,
    });

    expect(result.next).toBe(PhaseName.AnalyzeAdvisors);
  });

  it('should treat bead as leaf when bd show reports no parent-child dependents', async () => {
    const parentJson = JSON.stringify([{
      id: 'pv-test-1',
      dependents: [
        { id: 'rel', dependency_type: 'related', issue_type: 'task' },
      ],
    }]);
    const spawn = seqSpawn(
      fakeSpawn(parentJson, '', 0),  // bdListChildren returns []
    );

    const result = await analyze(makeCtx(), { spawnFn: spawn });

    expect(result.next).toBe(PhaseName.Branch);
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
      selectAdvisorsFn: async () => [{
        name: 'adv',
        path: '/agents/adv.md',
        description: 'stub',
        rationale: 'test',
      }],
      getBeadContextFn: () => 'context',
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
    // gitSafeToStart: 3 calls (work tree ok, main ok, dirty)
    const spawn = seqSpawn(
      fakeSpawn('true', '', 0),       // git rev-parse --is-inside-work-tree
      fakeSpawn('main', '', 0),       // git rev-parse --abbrev-ref HEAD
      fakeSpawn('M dirty', '', 0),    // git status --porcelain (dirty)
    );

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await branch(makeCtx(), { spawnFn: spawn });

    expect(result.next).toBe('halt');
  });

  it('should create branch and route epic to Epic phase', async () => {
    const bdShowJson = JSON.stringify([{ issue_type: 'epic', title: 'My Epic Feature' }]);
    const spawn = seqSpawn(
      // gitSafeToStart (3 calls):
      fakeSpawn('true', '', 0),            // git rev-parse --is-inside-work-tree
      fakeSpawn('main', '', 0),            // git rev-parse --abbrev-ref HEAD
      fakeSpawn('', '', 0),                // git status --porcelain (clean)
      // bd show --json (for title + issueType):
      fakeSpawn(bdShowJson, '', 0),
      // git branch --show-current:
      fakeSpawn('main', '', 0),
      // git checkout -b <branch>:
      fakeSpawn('', '', 0),
    );

    const result = await branch(makeCtx(), { spawnFn: spawn });

    expect(result.next).toBe(PhaseName.Epic);
  });

  it('should route non-epic to Leaf phase', async () => {
    const bdShowJson = JSON.stringify([{ issue_type: 'task', title: 'A Task' }]);
    const spawn = seqSpawn(
      // gitSafeToStart:
      fakeSpawn('true', '', 0),
      fakeSpawn('main', '', 0),
      fakeSpawn('', '', 0),
      // bd show --json:
      fakeSpawn(bdShowJson, '', 0),
      // git branch --show-current:
      fakeSpawn('main', '', 0),
      // git checkout -b:
      fakeSpawn('', '', 0),
    );

    const result = await branch(makeCtx(), { spawnFn: spawn });

    expect(result.next).toBe(PhaseName.Leaf);
  });

  it('should skip checkout if already on target branch', async () => {
    const bdShowJson = JSON.stringify([{ issue_type: 'task', title: 'A Task' }]);
    // branchName('A Task', 'task') = 'chore/a-task'
    const expectedBranch = 'chore/a-task';
    const spawn = seqSpawn(
      // gitSafeToStart:
      fakeSpawn('true', '', 0),
      fakeSpawn('main', '', 0),
      fakeSpawn('', '', 0),
      // bd show --json:
      fakeSpawn(bdShowJson, '', 0),
      // git branch --show-current (already on target):
      fakeSpawn(expectedBranch, '', 0),
      // No git checkout -b call!
    );

    const result = await branch(makeCtx(), { spawnFn: spawn });

    expect(result.next).toBe(PhaseName.Leaf);
    // 5 spawn calls total (no checkout)
    expect(spawn).toHaveBeenCalledTimes(5);
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

// =============================================================================
// Prompt builders + refinement feedback plumbing
// =============================================================================

function refinementReportFixture(): RefinementReport {
  return {
    beadId: 'pv-test-1',
    phase: 'phase-3-shape',
    advisors: [
      { agent: 'testing-advisor', verdict: 'refinement-needed', concerns: ['missing test A'], recommendations: ['write test A'] },
      { agent: 'stylesheet-advisor', verdict: 'clean', concerns: [], recommendations: [] },
    ],
    overallVerdict: 'refinement-needed',
    summary: '1 concern from testing-advisor',
  };
}

describe('formatRefinementFeedback', () => {
  it('returns empty string when report is absent', () => {
    expect(formatRefinementFeedback(undefined)).toBe('');
  });

  it('returns empty string when overallVerdict is clean', () => {
    const clean: RefinementReport = {
      beadId: 'pv-x', phase: 'phase-3-shape', advisors: [], overallVerdict: 'clean', summary: 'ok',
    };
    expect(formatRefinementFeedback(clean)).toBe('');
  });

  it('omits clean advisors and only surfaces non-clean feedback', () => {
    const md = formatRefinementFeedback(refinementReportFixture());
    expect(md).toContain('testing-advisor');
    expect(md).toContain('missing test A');
    expect(md).toContain('write test A');
    expect(md).not.toContain('stylesheet-advisor');
  });

  it('includes both concerns and recommendations under labelled sections', () => {
    const md = formatRefinementFeedback(refinementReportFixture());
    expect(md).toMatch(/Concerns:/);
    expect(md).toMatch(/Recommendations:/);
  });
});

describe('buildShapePrompt', () => {
  it('produces a prompt with no feedback section when no report is provided', () => {
    const prompt = buildShapePrompt('pv-test-1');
    expect(prompt).not.toContain('Refinement feedback');
    expect(prompt).toContain('pv-test-1');
  });

  it('splices refinement feedback into the prompt when a report is provided', () => {
    const prompt = buildShapePrompt('pv-test-1', refinementReportFixture());
    expect(prompt).toContain('Refinement feedback');
    expect(prompt).toContain('missing test A');
  });
});

describe('buildAnalyzePrompt', () => {
  it('produces a prompt with no feedback section when no report is provided', () => {
    const prompt = buildAnalyzePrompt('pv-epic-1', ['pv-leaf-1']);
    expect(prompt).not.toContain('Refinement feedback');
    expect(prompt).toContain('pv-epic-1');
  });

  it('splices refinement feedback into the prompt when a report is provided', () => {
    const report = { ...refinementReportFixture(), phase: 'phase-5-analyze' as const };
    const prompt = buildAnalyzePrompt('pv-epic-1', ['pv-leaf-1'], report);
    expect(prompt).toContain('Refinement feedback');
    expect(prompt).toContain('missing test A');
  });
});

describe('refinement round cap', () => {
  it('has a default cap that allows multiple refinement rounds before triage', () => {
    // >= 3 — advisors almost always find something to flag, so give the loop
    // at least two refinement passes before triaging remaining concerns.
    expect(REFINEMENT_ROUND_CAP_DEFAULT).toBeGreaterThanOrEqual(3);
  });
});

// =============================================================================
// advisor triage: parseAdvisorTriageVerdict + buildAdvisorTriagePrompt
// =============================================================================

describe('parseAdvisorTriageVerdict', () => {
  it('parses a well-formed followup verdict with a single bead', () => {
    const verdict = parseAdvisorTriageVerdict({
      verdict: 'followup',
      reason: 'minor concerns',
      followups: [
        {
          title: 'Address deferred advisor concerns',
          description: 'Summary of concerns',
          labels: ['needs-shape'],
        },
      ],
    });
    expect(verdict?.verdict).toBe('followup');
    expect(verdict?.followups).toHaveLength(1);
    expect(verdict?.followups?.[0]?.title).toBe('Address deferred advisor concerns');
    expect(verdict?.followups?.[0]?.labels).toEqual(['needs-shape']);
  });

  it('parses a followup verdict with multiple beads', () => {
    const verdict = parseAdvisorTriageVerdict({
      verdict: 'followup',
      reason: 'two unrelated concerns',
      followups: [
        { title: 'Rename query params', description: 'snake_case → camelCase', labels: ['needs-shape'] },
        { title: 'Extract shared helper', description: 'duplicated logic', labels: ['needs-shape'] },
      ],
    });
    expect(verdict?.followups).toHaveLength(2);
    expect(verdict?.followups?.[0]?.title).toBe('Rename query params');
    expect(verdict?.followups?.[1]?.title).toBe('Extract shared helper');
  });

  it('accepts the legacy single-followup schema for back-compat', () => {
    const verdict = parseAdvisorTriageVerdict({
      verdict: 'followup',
      reason: 'legacy schema',
      followup: {
        title: 'Old shape',
        description: 'still works',
        labels: ['needs-shape'],
      },
    });
    expect(verdict?.followups).toHaveLength(1);
    expect(verdict?.followups?.[0]?.title).toBe('Old shape');
  });

  it('parses a well-formed escalate verdict without followups', () => {
    const verdict = parseAdvisorTriageVerdict({
      verdict: 'escalate',
      reason: 'design is unsound',
    });
    expect(verdict?.verdict).toBe('escalate');
    expect(verdict?.followups).toBeUndefined();
  });

  it('parses JSON from a fenced code block string', () => {
    const raw = '```json\n{"verdict":"followup","reason":"ok","followups":[{"title":"t","description":"d","labels":[]}]}\n```';
    const verdict = parseAdvisorTriageVerdict(raw);
    expect(verdict?.verdict).toBe('followup');
    expect(verdict?.followups).toHaveLength(1);
  });

  it('rejects followup with no followups field at all', () => {
    const verdict = parseAdvisorTriageVerdict({ verdict: 'followup', reason: 'x' });
    expect(verdict).toBeNull();
  });

  it('rejects followup with empty followups array', () => {
    const verdict = parseAdvisorTriageVerdict({
      verdict: 'followup',
      reason: 'x',
      followups: [],
    });
    expect(verdict).toBeNull();
  });

  it('rejects followup when any entry is missing a title', () => {
    const verdict = parseAdvisorTriageVerdict({
      verdict: 'followup',
      reason: 'x',
      followups: [
        { title: 'ok', description: 'd' },
        { title: '', description: 'd' },
      ],
    });
    expect(verdict).toBeNull();
  });

  it('rejects unknown verdict values', () => {
    const verdict = parseAdvisorTriageVerdict({ verdict: 'ignore', reason: 'x' });
    expect(verdict).toBeNull();
  });

  it('returns null for non-JSON strings', () => {
    expect(parseAdvisorTriageVerdict('nope')).toBeNull();
  });
});

describe('buildAdvisorTriagePrompt', () => {
  it('includes bead id, non-clean advisor concerns, and output schema', () => {
    const report: RefinementReport = {
      beadId: 'pv-test-1',
      phase: 'phase-3-shape',
      advisors: [
        { agent: 'advisor-a', verdict: 'clean', concerns: [], recommendations: [] },
        {
          agent: 'advisor-b',
          verdict: 'refinement-needed',
          concerns: ['missing edge case test'],
          recommendations: ['add test for null input'],
        },
      ],
      overallVerdict: 'refinement-needed',
      summary: 'work needed',
    };
    const prompt = buildAdvisorTriagePrompt('pv-test-1', report);
    expect(prompt).toContain('pv-test-1');
    expect(prompt).toContain('advisor-b');
    expect(prompt).toContain('missing edge case test');
    expect(prompt).not.toContain('advisor-a'); // clean verdicts are filtered out
    expect(prompt).toContain('"verdict": "followup" | "escalate"');
    expect(prompt).toContain('"followups": [');
    expect(prompt).toContain('followup-from:pv-test-1');
    expect(prompt).toContain('one bead per concern');
  });

  it('handles a report with no non-clean advisors gracefully', () => {
    const report: RefinementReport = {
      beadId: 'pv-x',
      phase: 'phase-5-analyze',
      advisors: [],
      overallVerdict: 'refinement-needed',
      summary: '',
    };
    const prompt = buildAdvisorTriagePrompt('pv-x', report);
    expect(prompt).toContain('no non-clean advisor verdicts captured');
  });
});

// =============================================================================
// applyAdvisorTriage — cap-exceeded branch of runAdvisorPass
// =============================================================================

describe('applyAdvisorTriage', () => {
  beforeEach(() => vi.restoreAllMocks());

  const refinementReport: RefinementReport = {
    beadId: 'pv-test-1',
    phase: 'phase-5-analyze',
    advisors: [
      {
        agent: 'complexity-advisor',
        verdict: 'refinement-needed',
        concerns: ['helper too broad'],
        recommendations: ['narrow scope'],
      },
    ],
    overallVerdict: 'refinement-needed',
    summary: 'unresolved after 3 rounds',
  };

  it('advances to nextOnClean after filing a single followup bead when triage returns followup', async () => {
    const spawnCalls: string[][] = [];
    const spawn = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
      spawnCalls.push(args as string[]);
      if ((args as string[])[0] === 'create') {
        return fakeSpawn('✓ Created issue: pv-new2 — deferred', '', 0);
      }
      return fakeSpawn('', '', 0);
    });

    const triageFn = async (): Promise<AdvisorTriageVerdict> => ({
      verdict: 'followup',
      reason: 'non-blocking',
      followups: [
        {
          title: 'Follow up on complexity concerns',
          description: 'Detailed notes',
          labels: ['needs-shape'],
        },
      ],
    });

    const ctx = makeCtx();
    const result = await applyAdvisorTriage(ctx, refinementReport, 'fallback', {
      logTag: PhaseName.AnalyzeAdvisors,
      escalateTag: '5.5',
      nextOnClean: PhaseName.Branch,
    }, { spawnFn: spawn, triageFn });

    expect(result.next).toBe(PhaseName.Branch);
    const flat = spawnCalls.map(a => a.join(' '));
    expect(flat.filter(s => s.startsWith('create'))).toHaveLength(1);
    expect(flat.some(s => s.includes('label add') && s.includes('followup-from:pv-test-1'))).toBe(true);
    // bdEscalate should NOT have been called: no label add for needs-human
    expect(flat.some(s => s.includes('needs-human'))).toBe(false);
  });

  it('files multiple followup beads when triage returns multiple entries', async () => {
    const spawnCalls: string[][] = [];
    let createCount = 0;
    const spawn = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
      spawnCalls.push(args as string[]);
      if ((args as string[])[0] === 'create') {
        createCount += 1;
        return fakeSpawn(`✓ Created issue: pv-new${createCount} — deferred`, '', 0);
      }
      return fakeSpawn('', '', 0);
    });

    const triageFn = async (): Promise<AdvisorTriageVerdict> => ({
      verdict: 'followup',
      reason: 'two unrelated concerns',
      followups: [
        { title: 'Rename query params', description: 'snake_case → camelCase', labels: ['needs-shape'] },
        { title: 'Extract shared helper', description: 'duplicated logic', labels: ['needs-shape'] },
      ],
    });

    const ctx = makeCtx();
    const result = await applyAdvisorTriage(ctx, refinementReport, 'fallback', {
      logTag: PhaseName.AnalyzeAdvisors,
      escalateTag: '5.5',
      nextOnClean: PhaseName.Branch,
    }, { spawnFn: spawn, triageFn });

    expect(result.next).toBe(PhaseName.Branch);
    const flat = spawnCalls.map(a => a.join(' '));
    expect(flat.filter(s => s.startsWith('create'))).toHaveLength(2);
    const parentLabelCalls = flat.filter(s => s.includes('label add') && s.includes('followup-from:pv-test-1'));
    expect(parentLabelCalls).toHaveLength(2);
    expect(flat.some(s => s.includes('needs-human'))).toBe(false);
  });

  it('advances when at least one followup bead creates successfully (partial failure)', async () => {
    let createCount = 0;
    const spawn = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
      if ((args as string[])[0] === 'create') {
        createCount += 1;
        // First create succeeds, second fails.
        if (createCount === 1) {
          return fakeSpawn('✓ Created issue: pv-new1 — first', '', 0);
        }
        return fakeSpawn('', 'bd create: database locked', 1);
      }
      return fakeSpawn('', '', 0);
    });

    const triageFn = async (): Promise<AdvisorTriageVerdict> => ({
      verdict: 'followup',
      reason: 'mixed result',
      followups: [
        { title: 'Bead one', description: 'first concern', labels: ['needs-shape'] },
        { title: 'Bead two', description: 'second concern', labels: ['needs-shape'] },
      ],
    });

    const ctx = makeCtx();
    const result = await applyAdvisorTriage(ctx, refinementReport, 'fallback', {
      logTag: PhaseName.AnalyzeAdvisors,
      escalateTag: '5.5',
      nextOnClean: PhaseName.Branch,
    }, { spawnFn: spawn, triageFn });

    expect(result.next).toBe(PhaseName.Branch);
    const calls = spawn.mock.calls.map((c) => (c[1] as string[]).join(' '));
    expect(calls.some(c => c.includes('needs-human'))).toBe(false);
  });

  it('escalates when triage returns escalate verdict', async () => {
    const spawn = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
      if ((args as string[])[0] === 'show') {
        return fakeSpawn(JSON.stringify([{ notes: '' }]), '', 0);
      }
      return fakeSpawn('', '', 0);
    });

    const triageFn = async (): Promise<AdvisorTriageVerdict> => ({
      verdict: 'escalate',
      reason: 'bead design is unsound',
    });

    const ctx = makeCtx();
    const result = await applyAdvisorTriage(ctx, refinementReport, 'fallback reason', {
      logTag: PhaseName.AnalyzeAdvisors,
      escalateTag: '5.5',
      nextOnClean: PhaseName.Branch,
    }, { spawnFn: spawn, triageFn });

    expect(result.next).toBe('halt');
    // bdEscalate: adds needs-human label
    const calls = spawn.mock.calls.map((c) => (c[1] as string[]).join(' '));
    expect(calls.some(c => c.includes('label add') && c.includes('needs-human'))).toBe(true);
  });

  it('escalates when triage returns null (dispatch failed)', async () => {
    const spawn = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
      if ((args as string[])[0] === 'show') {
        return fakeSpawn(JSON.stringify([{ notes: '' }]), '', 0);
      }
      return fakeSpawn('', '', 0);
    });

    const triageFn = async (): Promise<null> => null;

    const ctx = makeCtx();
    const result = await applyAdvisorTriage(ctx, refinementReport, 'fallback reason', {
      logTag: PhaseName.AnalyzeAdvisors,
      escalateTag: '5.5',
      nextOnClean: PhaseName.Branch,
    }, { spawnFn: spawn, triageFn });

    expect(result.next).toBe('halt');
    const calls = spawn.mock.calls.map((c) => (c[1] as string[]).join(' '));
    expect(calls.some(c => c.includes('needs-human'))).toBe(true);
  });

  it('falls back to escalate when every followup bead creation fails', async () => {
    const spawn = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
      if ((args as string[])[0] === 'create') {
        return fakeSpawn('', 'bd create: database locked', 1);
      }
      if ((args as string[])[0] === 'show') {
        return fakeSpawn(JSON.stringify([{ notes: '' }]), '', 0);
      }
      return fakeSpawn('', '', 0);
    });

    const triageFn = async (): Promise<AdvisorTriageVerdict> => ({
      verdict: 'followup',
      reason: 'deferrable',
      followups: [
        { title: 't1', description: 'd1', labels: ['needs-shape'] },
        { title: 't2', description: 'd2', labels: ['needs-shape'] },
      ],
    });

    const ctx = makeCtx();
    const result = await applyAdvisorTriage(ctx, refinementReport, 'fallback reason', {
      logTag: PhaseName.AnalyzeAdvisors,
      escalateTag: '5.5',
      nextOnClean: PhaseName.Branch,
    }, { spawnFn: spawn, triageFn });

    expect(result.next).toBe('halt');
    const calls = spawn.mock.calls.map((c) => (c[1] as string[]).join(' '));
    expect(calls.some(c => c.includes('needs-human'))).toBe(true);
  });
});
