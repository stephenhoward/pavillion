import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  runBranch,
  routeToExecution,
  type BranchDeps,
} from '../../lib/phase-6-branch.js';
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

/**
 * Build BranchDeps with a spawnFn that returns results in call order.
 */
function makeDeps(results: SpawnSyncReturns<Buffer>[]): BranchDeps {
  let callIndex = 0;
  const spawnFn = vi.fn().mockImplementation(() => {
    const result = results[callIndex] ?? results[results.length - 1];
    callIndex++;
    return result;
  });

  return { spawnFn };
}

// ---------------------------------------------------------------------------
// routeToExecution — pure routing function
// ---------------------------------------------------------------------------

describe('routeToExecution', () => {

  it('should route epic issue type to phase-7a-epic', () => {
    expect(routeToExecution('epic')).toBe(PhaseName.Epic);
  });

  it('should route feature issue type to phase-7b-leaf', () => {
    expect(routeToExecution('feature')).toBe(PhaseName.Leaf);
  });

  it('should route task issue type to phase-7b-leaf', () => {
    expect(routeToExecution('task')).toBe(PhaseName.Leaf);
  });

  it('should route bug issue type to phase-7b-leaf', () => {
    expect(routeToExecution('bug')).toBe(PhaseName.Leaf);
  });

  it('should route unknown issue type to phase-7b-leaf', () => {
    expect(routeToExecution('unknown')).toBe(PhaseName.Leaf);
  });
});

// ---------------------------------------------------------------------------
// runBranch — full phase runner
// ---------------------------------------------------------------------------

describe('runBranch', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Dirty tree / unsafe → halt
  // -----------------------------------------------------------------------

  it('should halt when git-safe-to-start exits 1 (dirty tree)', async () => {
    const deps = makeDeps([
      fakeSpawnResult('', 'git-safe-to-start: working tree is dirty', 1),
    ]);
    const ctx = makeCtx(logStub);

    const result = await runBranch(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('dirty'),
    )).toBe(true);
  });

  it('should halt when git-safe-to-start exits 2 (git failure)', async () => {
    const deps = makeDeps([
      fakeSpawnResult('', 'git-safe-to-start: not inside a git work tree', 2),
    ]);
    const ctx = makeCtx(logStub);

    const result = await runBranch(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('git failure'),
    )).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Already on correct branch → short-circuit
  // -----------------------------------------------------------------------

  it('should short-circuit when already on the target branch', async () => {
    const branchName = 'chore/test-bead-pv-test-1';
    const deps = makeDeps([
      // git-safe-to-start: success
      fakeSpawnResult('', '', 0),
      // branch-name.sh: returns the branch name
      fakeSpawnResult(branchName + '\n', '', 0),
      // git branch --show-current: same branch
      fakeSpawnResult(branchName + '\n', '', 0),
      // bd show --json: task type
      fakeSpawnResult(JSON.stringify([{ issue_type: 'task' }]), '', 0),
    ]);
    const ctx = makeCtx(logStub);

    const result = await runBranch(ctx, deps);

    expect(result.next).toBe(PhaseName.Leaf);
    const shortCircuit = logStub.runJsonEntries.find(
      (e) => e.event === 'branch_already_current',
    );
    expect(shortCircuit).toBeDefined();
    expect(shortCircuit!.branchName).toBe(branchName);
  });

  // -----------------------------------------------------------------------
  // Branch created → routes to correct phase
  // -----------------------------------------------------------------------

  it('should create branch and route leaf bead to phase-7b-leaf', async () => {
    const branchName = 'chore/test-bead-pv-test-1';
    const deps = makeDeps([
      fakeSpawnResult('', '', 0),                                          // git-safe-to-start
      fakeSpawnResult(branchName + '\n', '', 0),                           // branch-name.sh
      fakeSpawnResult('main\n', '', 0),                                    // git branch --show-current
      fakeSpawnResult('', '', 0),                                          // git checkout -b
      fakeSpawnResult(JSON.stringify([{ issue_type: 'task' }]), '', 0),    // bd show --json
    ]);
    const ctx = makeCtx(logStub);

    const result = await runBranch(ctx, deps);

    expect(result.next).toBe(PhaseName.Leaf);
    const created = logStub.runJsonEntries.find(
      (e) => e.event === 'branch_created',
    );
    expect(created).toBeDefined();
    expect(created!.branchName).toBe(branchName);
  });

  it('should create branch and route epic bead to phase-7a-epic', async () => {
    const branchName = 'feat/epic-feature-pv-test-1';
    const deps = makeDeps([
      fakeSpawnResult('', '', 0),                                          // git-safe-to-start
      fakeSpawnResult(branchName + '\n', '', 0),                           // branch-name.sh
      fakeSpawnResult('main\n', '', 0),                                    // git branch --show-current
      fakeSpawnResult('', '', 0),                                          // git checkout -b
      fakeSpawnResult(JSON.stringify([{ issue_type: 'epic' }]), '', 0),    // bd show --json
    ]);
    const ctx = makeCtx(logStub);

    const result = await runBranch(ctx, deps);

    expect(result.next).toBe(PhaseName.Epic);
  });

  // -----------------------------------------------------------------------
  // branch-name.sh failure
  // -----------------------------------------------------------------------

  it('should halt when branch-name.sh fails', async () => {
    const deps = makeDeps([
      fakeSpawnResult('', '', 0),                                          // git-safe-to-start
      fakeSpawnResult('', 'branch-name.sh: bd lookup failed', 3),          // branch-name.sh fails
    ]);
    const ctx = makeCtx(logStub);

    const result = await runBranch(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('branch-name.sh'),
    )).toBe(true);
  });

  // -----------------------------------------------------------------------
  // git checkout -b failure
  // -----------------------------------------------------------------------

  it('should halt when git checkout -b fails', async () => {
    const branchName = 'chore/test-bead-pv-test-1';
    const deps = makeDeps([
      fakeSpawnResult('', '', 0),                                          // git-safe-to-start
      fakeSpawnResult(branchName + '\n', '', 0),                           // branch-name.sh
      fakeSpawnResult('main\n', '', 0),                                    // git branch --show-current
      fakeSpawnResult('', 'fatal: branch already exists', 1),              // git checkout -b fails
    ]);
    const ctx = makeCtx(logStub);

    const result = await runBranch(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('checkout'),
    )).toBe(true);
  });

  // -----------------------------------------------------------------------
  // bd show --json failure → halt
  // -----------------------------------------------------------------------

  it('should halt when bd show --json fails', async () => {
    const branchName = 'chore/test-bead-pv-test-1';
    const deps = makeDeps([
      fakeSpawnResult('', '', 0),                                          // git-safe-to-start
      fakeSpawnResult(branchName + '\n', '', 0),                           // branch-name.sh
      fakeSpawnResult('main\n', '', 0),                                    // git branch --show-current
      fakeSpawnResult('', '', 0),                                          // git checkout -b
      fakeSpawnResult('', 'bd: bead not found', 1),                        // bd show --json fails
    ]);
    const ctx = makeCtx(logStub);

    const result = await runBranch(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('bd show'),
    )).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Logging
  // -----------------------------------------------------------------------

  it('should log branch_setup_start event to run.json', async () => {
    const branchName = 'chore/test-bead-pv-test-1';
    const deps = makeDeps([
      fakeSpawnResult('', '', 0),
      fakeSpawnResult(branchName + '\n', '', 0),
      fakeSpawnResult('main\n', '', 0),
      fakeSpawnResult('', '', 0),
      fakeSpawnResult(JSON.stringify([{ issue_type: 'task' }]), '', 0),
    ]);
    const ctx = makeCtx(logStub);

    await runBranch(ctx, deps);

    const startEntry = logStub.runJsonEntries.find(
      (e) => e.event === 'branch_setup_start',
    );
    expect(startEntry).toBeDefined();
    expect(startEntry!.beadId).toBe('pv-test-1');
  });

  it('should log branch_setup_complete with routing info', async () => {
    const branchName = 'feat/epic-feature-pv-test-1';
    const deps = makeDeps([
      fakeSpawnResult('', '', 0),
      fakeSpawnResult(branchName + '\n', '', 0),
      fakeSpawnResult('main\n', '', 0),
      fakeSpawnResult('', '', 0),
      fakeSpawnResult(JSON.stringify([{ issue_type: 'epic' }]), '', 0),
    ]);
    const ctx = makeCtx(logStub);

    await runBranch(ctx, deps);

    const completeEntry = logStub.runJsonEntries.find(
      (e) => e.event === 'branch_setup_complete',
    );
    expect(completeEntry).toBeDefined();
    expect(completeEntry!.branchName).toBe(branchName);
    expect(completeEntry!.issueType).toBe('epic');
    expect(completeEntry!.next).toBe(PhaseName.Epic);
  });

  it('should pass beadId as arg to branch-name.sh', async () => {
    const branchName = 'chore/test-bead-pv-abc-42';
    const spawnFn = vi.fn()
      .mockReturnValueOnce(fakeSpawnResult('', '', 0))
      .mockReturnValueOnce(fakeSpawnResult(branchName + '\n', '', 0))
      .mockReturnValueOnce(fakeSpawnResult('main\n', '', 0))
      .mockReturnValueOnce(fakeSpawnResult('', '', 0))
      .mockReturnValueOnce(fakeSpawnResult(JSON.stringify([{ issue_type: 'task' }]), '', 0));

    const deps: BranchDeps = { spawnFn };
    const ctx = makeCtx(logStub, { beadId: 'pv-abc-42' });

    await runBranch(ctx, deps);

    // Second call is branch-name.sh with the bead id
    expect(spawnFn.mock.calls[1][0]).toContain('branch-name.sh');
    expect(spawnFn.mock.calls[1][1]).toContain('pv-abc-42');
  });
});
