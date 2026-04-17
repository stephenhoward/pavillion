import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  runPR,
  parseBeadJson,
  derivePrTitleFromBead,
  type PRDeps,
} from '../../lib/phase-8-pr.js';
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

function makeDeps(results: SpawnSyncReturns<Buffer>[]): PRDeps {
  let callIndex = 0;
  const spawnFn = vi.fn().mockImplementation(() => {
    const result = results[callIndex] ?? results[results.length - 1];
    callIndex++;
    return result;
  });

  return { spawnFn };
}

// ---------------------------------------------------------------------------
// Standard bd show --json fixtures
// ---------------------------------------------------------------------------

const CLOSED_LEAF_JSON = JSON.stringify([{
  title: 'Fix widget alignment',
  status: 'closed',
  issue_type: 'task',
}]);

const CLOSED_EPIC_JSON = JSON.stringify([{
  title: 'Epic: Redesign dashboard',
  status: 'closed',
  issue_type: 'epic',
  children: [{ id: 'pv-test-1.1' }, { id: 'pv-test-1.2' }],
}]);

const CLOSED_CHILD_JSON = JSON.stringify([{
  title: 'Child bead',
  status: 'closed',
  issue_type: 'task',
}]);

const OPEN_BEAD_JSON = JSON.stringify([{
  title: 'Still open',
  status: 'in_progress',
  issue_type: 'task',
}]);

// ---------------------------------------------------------------------------
// parseBeadJson — pure helper
// ---------------------------------------------------------------------------

describe('parseBeadJson', () => {

  it('should parse valid bd show --json output', () => {
    const result = parseBeadJson(CLOSED_LEAF_JSON);
    expect(result).toEqual({
      title: 'Fix widget alignment',
      status: 'closed',
      issue_type: 'task',
    });
  });

  it('should return null for invalid JSON', () => {
    expect(parseBeadJson('not json')).toBeNull();
  });

  it('should return null for empty array', () => {
    expect(parseBeadJson('[]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// derivePrTitleFromBead — pure helper
// ---------------------------------------------------------------------------

describe('derivePrTitleFromBead', () => {

  it('should strip "Epic:" prefix for epic beads', () => {
    expect(derivePrTitleFromBead('Epic: Redesign dashboard', 'epic'))
      .toBe('Redesign dashboard');
  });

  it('should handle missing "Epic:" prefix for epic beads', () => {
    expect(derivePrTitleFromBead('Redesign dashboard', 'epic'))
      .toBe('Redesign dashboard');
  });

  it('should return title as-is for non-epic beads', () => {
    expect(derivePrTitleFromBead('Fix alignment', 'task'))
      .toBe('Fix alignment');
  });
});

// ---------------------------------------------------------------------------
// runPR — full phase runner
// ---------------------------------------------------------------------------

describe('runPR', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Happy path — leaf bead
  // -----------------------------------------------------------------------

  it('should create PR and route to Report for a closed leaf bead', async () => {
    const branchName = 'chore/fix-widget-pv-test-1';
    const prUrl = 'https://github.com/owner/repo/pull/42';
    const commitMsg = 'chore: Fix widget alignment (pv-test-1)';

    const deps = makeDeps([
      fakeSpawnResult(branchName, '', 0),       // git branch --show-current
      fakeSpawnResult(CLOSED_LEAF_JSON, '', 0),  // bd show --json
      fakeSpawnResult('## Summary\n...', '', 0), // pr-body.sh
      fakeSpawnResult(commitMsg, '', 0),          // commit-msg.sh
      fakeSpawnResult('', '', 0),                 // git push
      fakeSpawnResult(prUrl, '', 0),              // gh pr create
    ]);
    const ctx = makeCtx(logStub);

    const result = await runPR(ctx, deps);

    expect(result.next).toBe(PhaseName.Report);

    // PR URL stored on context
    const resultCtx = result.ctx as OrchestratorContext & { prUrl?: string };
    expect(resultCtx.prUrl).toBe(prUrl);

    // Beads closed stored on context
    const beadsCtx = result.ctx as OrchestratorContext & { beadsClosed?: string[] };
    expect(beadsCtx.beadsClosed).toEqual(['pv-test-1']);

    // Run JSON logged
    const complete = logStub.runJsonEntries.find(e => e.event === 'pr_finalize_complete');
    expect(complete).toBeDefined();
    expect(complete!.prUrl).toBe(prUrl);
    expect(complete!.prTitle).toBe(commitMsg);
  });

  // -----------------------------------------------------------------------
  // Happy path — epic bead
  // -----------------------------------------------------------------------

  it('should create PR for a closed epic with closed children', async () => {
    const branchName = 'feat/redesign-dashboard-pv-test-1';
    const prUrl = 'https://github.com/owner/repo/pull/99';

    const deps = makeDeps([
      fakeSpawnResult(branchName, '', 0),          // git branch --show-current
      fakeSpawnResult(CLOSED_EPIC_JSON, '', 0),    // bd show --json (parent)
      fakeSpawnResult(CLOSED_CHILD_JSON, '', 0),   // bd show --json (child 1)
      fakeSpawnResult(CLOSED_CHILD_JSON, '', 0),   // bd show --json (child 2)
      fakeSpawnResult('## Summary\n...', '', 0),   // pr-body.sh
      fakeSpawnResult('', '', 0),                   // git push
      fakeSpawnResult(prUrl, '', 0),                // gh pr create
    ]);
    const ctx = makeCtx(logStub);

    const result = await runPR(ctx, deps);

    expect(result.next).toBe(PhaseName.Report);

    // Epic uses title directly (no commit-msg.sh call)
    const complete = logStub.runJsonEntries.find(e => e.event === 'pr_finalize_complete');
    expect(complete!.prTitle).toBe('Redesign dashboard');
    expect(complete!.beadsClosed).toEqual(['pv-test-1', 'pv-test-1.1', 'pv-test-1.2']);
  });

  // -----------------------------------------------------------------------
  // Unclosed bead → halt
  // -----------------------------------------------------------------------

  it('should halt when the target bead is not closed', async () => {
    const deps = makeDeps([
      fakeSpawnResult('feat/branch', '', 0),       // git branch --show-current
      fakeSpawnResult(OPEN_BEAD_JSON, '', 0),      // bd show --json
    ]);
    const ctx = makeCtx(logStub);

    const result = await runPR(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('UNCLOSED'),
    )).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Unclosed child in epic → halt
  // -----------------------------------------------------------------------

  it('should halt when an epic child bead is not closed', async () => {
    const deps = makeDeps([
      fakeSpawnResult('feat/branch', '', 0),         // git branch --show-current
      fakeSpawnResult(CLOSED_EPIC_JSON, '', 0),      // bd show --json (parent)
      fakeSpawnResult(CLOSED_CHILD_JSON, '', 0),     // bd show --json (child 1)
      fakeSpawnResult(OPEN_BEAD_JSON, '', 0),        // bd show --json (child 2 - open!)
    ]);
    const ctx = makeCtx(logStub);

    const result = await runPR(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('UNCLOSED'),
    )).toBe(true);
  });

  // -----------------------------------------------------------------------
  // pr-body.sh failure → halt
  // -----------------------------------------------------------------------

  it('should halt when pr-body.sh fails', async () => {
    const deps = makeDeps([
      fakeSpawnResult('feat/branch', '', 0),         // git branch --show-current
      fakeSpawnResult(CLOSED_LEAF_JSON, '', 0),      // bd show --json
      fakeSpawnResult('', 'bd lookup failed', 3),    // pr-body.sh fails
    ]);
    const ctx = makeCtx(logStub);

    const result = await runPR(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('pr-body.sh'),
    )).toBe(true);
  });

  // -----------------------------------------------------------------------
  // commit-msg.sh failure → halt (leaf only)
  // -----------------------------------------------------------------------

  it('should halt when commit-msg.sh fails for leaf bead', async () => {
    const deps = makeDeps([
      fakeSpawnResult('feat/branch', '', 0),         // git branch --show-current
      fakeSpawnResult(CLOSED_LEAF_JSON, '', 0),      // bd show --json
      fakeSpawnResult('## Summary', '', 0),          // pr-body.sh
      fakeSpawnResult('', 'bd lookup failed', 3),    // commit-msg.sh fails
    ]);
    const ctx = makeCtx(logStub);

    const result = await runPR(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('commit-msg.sh'),
    )).toBe(true);
  });

  // -----------------------------------------------------------------------
  // git push failure → halt
  // -----------------------------------------------------------------------

  it('should halt when git push fails', async () => {
    const deps = makeDeps([
      fakeSpawnResult('feat/branch', '', 0),         // git branch --show-current
      fakeSpawnResult(CLOSED_LEAF_JSON, '', 0),      // bd show --json
      fakeSpawnResult('## Summary', '', 0),          // pr-body.sh
      fakeSpawnResult('chore: title (pv-test-1)', '', 0), // commit-msg.sh
      fakeSpawnResult('', 'rejected non-fast-forward', 1), // git push fails
    ]);
    const ctx = makeCtx(logStub);

    const result = await runPR(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('git push'),
    )).toBe(true);
  });

  // -----------------------------------------------------------------------
  // gh pr create failure → halt
  // -----------------------------------------------------------------------

  it('should halt when gh pr create fails', async () => {
    const deps = makeDeps([
      fakeSpawnResult('feat/branch', '', 0),                // git branch --show-current
      fakeSpawnResult(CLOSED_LEAF_JSON, '', 0),             // bd show --json
      fakeSpawnResult('## Summary', '', 0),                 // pr-body.sh
      fakeSpawnResult('chore: title (pv-test-1)', '', 0),   // commit-msg.sh
      fakeSpawnResult('', '', 0),                            // git push
      fakeSpawnResult('', 'GraphQL: error', 1),             // gh pr create fails
    ]);
    const ctx = makeCtx(logStub);

    const result = await runPR(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('gh pr create'),
    )).toBe(true);
  });

  // -----------------------------------------------------------------------
  // bd show failure → halt
  // -----------------------------------------------------------------------

  it('should halt when bd show --json fails', async () => {
    const deps = makeDeps([
      fakeSpawnResult('feat/branch', '', 0),         // git branch --show-current
      fakeSpawnResult('', 'bead not found', 1),      // bd show --json fails
    ]);
    const ctx = makeCtx(logStub);

    const result = await runPR(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('bd show'),
    )).toBe(true);
  });

  // -----------------------------------------------------------------------
  // branch detection failure → halt
  // -----------------------------------------------------------------------

  it('should halt when git branch --show-current fails', async () => {
    const deps = makeDeps([
      fakeSpawnResult('', 'not a git repo', 128),   // git branch --show-current fails
    ]);
    const ctx = makeCtx(logStub);

    const result = await runPR(ctx, deps);

    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('branch'),
    )).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Logging
  // -----------------------------------------------------------------------

  it('should log pr_finalize_start event to run.json', async () => {
    const deps = makeDeps([
      fakeSpawnResult('feat/branch', '', 0),
      fakeSpawnResult(CLOSED_LEAF_JSON, '', 0),
      fakeSpawnResult('## Summary', '', 0),
      fakeSpawnResult('chore: title (pv-test-1)', '', 0),
      fakeSpawnResult('', '', 0),
      fakeSpawnResult('https://github.com/pull/1', '', 0),
    ]);
    const ctx = makeCtx(logStub);

    await runPR(ctx, deps);

    const startEntry = logStub.runJsonEntries.find(e => e.event === 'pr_finalize_start');
    expect(startEntry).toBeDefined();
    expect(startEntry!.beadId).toBe('pv-test-1');
  });
});
