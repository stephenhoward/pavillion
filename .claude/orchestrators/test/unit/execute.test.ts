import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess, SpawnSyncReturns } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { PhaseName, type RunContext, type RunLogger } from '../../lib/types.js';
import type { ExecuteDeps, PhaseCtx } from '../../lib/execute.js';

// ---------------------------------------------------------------------------
// Mock helpers module so discoverAgents is controllable per-test. Auditor
// selection happens via selectAuditorsFn injected through ExecuteDeps.
// ---------------------------------------------------------------------------

vi.mock('../../lib/helpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/helpers.js')>();
  return {
    ...actual,
    discoverAgents: vi.fn().mockReturnValue([]),
    bdEscalate: vi.fn(),
    bdEnrichmentCheck: vi.fn().mockReturnValue(false),
    commitMsg: vi.fn().mockImplementation(
      (beadId: string, summary: string, issueType: string) => {
        const typeMap: Record<string, string> = { bug: 'fix', feature: 'feat', epic: 'feat', task: 'chore' };
        const type = typeMap[issueType] ?? 'chore';
        return `${type}: ${summary} (${beadId})`;
      },
    ),
    prBody: vi.fn().mockReturnValue('## Summary\n\n- title\n'),
  };
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function stubLogger(): {
  logger: RunLogger;
  logs: { phase: PhaseName; kind: 'out' | 'err'; data: string }[];
  runJsonEntries: Record<string, unknown>[];
} {
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

function createMockChild(
  stdout: string,
  stderr: string,
  exitCode: number,
): ChildProcess & EventEmitter {
  const child = new EventEmitter() as ChildProcess & EventEmitter;

  const stdoutStream = new Readable({ read() {} });
  const stderrStream = new Readable({ read() {} });

  child.stdin = { write: vi.fn(), end: vi.fn() } as unknown as ChildProcess['stdin'];
  child.stdout = stdoutStream;
  child.stderr = stderrStream;
  child.pid = 12345;
  child.kill = vi.fn().mockReturnValue(true);

  setImmediate(() => {
    if (stdout) stdoutStream.push(stdout);
    stdoutStream.push(null);
    if (stderr) stderrStream.push(stderr);
    stderrStream.push(null);
    child.emit('close', exitCode);
  });

  return child;
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

function makeCtx(logStub: ReturnType<typeof stubLogger>): RunContext {
  return {
    runId: 'test-run-1',
    beadId: 'pv-test-1',
    logger: logStub.logger,
    phaseHistory: [],
  };
}

function makePhaseCtx(logStub: ReturnType<typeof stubLogger>): PhaseCtx {
  return {
    runId: 'test-run-1',
    beadId: 'pv-test-1',
    logger: logStub.logger,
    phaseHistory: [],
    dryRun: false,
  };
}

// ---------------------------------------------------------------------------
// Standard fixtures
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

// =============================================================================
// dispatchImplementer
// =============================================================================

describe('dispatchImplementer', () => {
  let logStub: ReturnType<typeof stubLogger>;
  let ctx: RunContext;

  beforeEach(() => {
    logStub = stubLogger();
    ctx = makeCtx(logStub);
  });

  it('should return ok:true on successful dispatch', async () => {
    const { dispatchImplementer } = await import('../../lib/execute.js');

    const mockSpawnFn = vi.fn().mockReturnValue(
      createMockChild(JSON.stringify({ status: 'closed' }), '', 0),
    );

    const result = await dispatchImplementer('pv-test-1', ctx, {
      spawnFn: mockSpawnFn,
    });

    expect(result.ok).toBe(true);

    // Verify prompt contains bead id
    const child = mockSpawnFn.mock.results[0].value;
    const writtenPrompt = child.stdin.write.mock.calls[0][0] as string;
    expect(writtenPrompt).toContain('pv-test-1');
    expect(writtenPrompt).toContain('Implement Bead');
  });

  it('should return ok:false on dispatch timeout', async () => {
    const { dispatchImplementer } = await import('../../lib/execute.js');

    const child = new EventEmitter() as ChildProcess & EventEmitter;
    const stdoutStream = new Readable({ read() {} });
    const stderrStream = new Readable({ read() {} });
    child.stdin = { write: vi.fn(), end: vi.fn() } as unknown as ChildProcess['stdin'];
    child.stdout = stdoutStream;
    child.stderr = stderrStream;
    child.pid = 12345;
    child.kill = vi.fn().mockImplementation(() => {
      setImmediate(() => {
        stdoutStream.push(null);
        stderrStream.push(null);
        child.emit('close', null, 'SIGTERM');
      });
      return true;
    });

    const mockSpawnFn = vi.fn().mockReturnValue(child);

    const result = await dispatchImplementer('pv-test-1', ctx, {
      spawnFn: mockSpawnFn,
      timeoutMs: 50,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('timed out');
  });

  it('should include retry context concerns in prompt when provided', async () => {
    const { dispatchImplementer } = await import('../../lib/execute.js');

    const mockSpawnFn = vi.fn().mockReturnValue(
      createMockChild(JSON.stringify({ status: 'closed' }), '', 0),
    );

    const result = await dispatchImplementer('pv-test-1', ctx, {
      spawnFn: mockSpawnFn,
      retryContext: { concerns: ['Missing null check'], attempt: 2 },
    });

    expect(result.ok).toBe(true);

    const child = mockSpawnFn.mock.results[0].value;
    const writtenPrompt = child.stdin.write.mock.calls[0][0] as string;
    expect(writtenPrompt).toContain('Missing null check');
    expect(writtenPrompt).toContain('Previous audit failed');
  });
});

// =============================================================================
// runAudit
// =============================================================================

describe('runAudit', () => {
  let logStub: ReturnType<typeof stubLogger>;
  let ctx: RunContext;

  beforeEach(async () => {
    logStub = stubLogger();
    ctx = makeCtx(logStub);
    vi.clearAllMocks();
    const helpers = await import('../../lib/helpers.js');
    vi.mocked(helpers.discoverAgents).mockReturnValue([]);
    vi.mocked(helpers.bdEscalate).mockReturnValue(undefined);
    vi.mocked(helpers.bdEnrichmentCheck).mockReturnValue(false);
  });

  it('should return passed:true when no changed files', async () => {
    const { runAudit } = await import('../../lib/execute.js');

    const result = await runAudit('pv-test-1', ctx, {
      changedFiles: [],
    });

    expect(result.passed).toBe(true);
    expect(result.verdicts).toHaveLength(0);
  });

  it('should aggregate verdicts from matched auditors', async () => {
    const { runAudit } = await import('../../lib/execute.js');
    const helpers = await import('../../lib/helpers.js');

    const matchResult = [
      { name: 'architecture-auditor', path: '.claude/agents/arch.md', description: 'Arch', rationale: 'Match' },
    ];

    vi.mocked(helpers.discoverAgents).mockReturnValue([
      { name: 'architecture-auditor', path: '.claude/agents/arch.md', description: 'Arch' },
    ]);

    const passVerdict = {
      agent: 'architecture-auditor',
      verdict: 'pass',
      concerns: [],
      recommendations: [],
      beadId: 'pv-test-1',
    };

    const mockSpawnFn = vi.fn().mockReturnValue(
      createMockChild(JSON.stringify(passVerdict), '', 0),
    );

    const result = await runAudit('pv-test-1', ctx, {
      spawnFn: mockSpawnFn,
      changedFiles: ['src/server/calendar/service/calendar.ts'],
      selectAuditorsFn: async () => matchResult,
    });

    expect(result.passed).toBe(true);
    expect(result.verdicts).toHaveLength(1);
  });

  it('should return passed:false when auditor fails', async () => {
    const { runAudit } = await import('../../lib/execute.js');
    const helpers = await import('../../lib/helpers.js');

    const matchResult = [
      { name: 'security-auditor', path: '.claude/agents/sec.md', description: 'Sec', rationale: 'Match' },
    ];

    vi.mocked(helpers.discoverAgents).mockReturnValue([
      { name: 'security-auditor', path: '.claude/agents/sec.md', description: 'Sec' },
    ]);

    const failVerdict = {
      agent: 'security-auditor',
      verdict: 'fail',
      concerns: ['XSS vulnerability'],
      recommendations: [],
      beadId: 'pv-test-1',
    };

    const mockSpawnFn = vi.fn().mockReturnValue(
      createMockChild(JSON.stringify(failVerdict), '', 0),
    );

    const result = await runAudit('pv-test-1', ctx, {
      spawnFn: mockSpawnFn,
      changedFiles: ['src/server/calendar/service/calendar.ts'],
      selectAuditorsFn: async () => matchResult,
    });

    expect(result.passed).toBe(false);
    expect(result.concerns).toContain('XSS vulnerability');
  });
});

// =============================================================================
// runLeafExecution
// =============================================================================

describe('runLeafExecution', () => {
  let logStub: ReturnType<typeof stubLogger>;
  let ctx: RunContext;

  beforeEach(async () => {
    logStub = stubLogger();
    ctx = makeCtx(logStub);
    vi.clearAllMocks();
    const helpers = await import('../../lib/helpers.js');
    vi.mocked(helpers.discoverAgents).mockReturnValue([]);
    vi.mocked(helpers.bdEscalate).mockReturnValue(undefined);
    vi.mocked(helpers.bdEnrichmentCheck).mockReturnValue(false);
  });

  it('should complete on happy path (impl ok + audit pass)', async () => {
    const { runLeafExecution } = await import('../../lib/execute.js');
    const helpers = await import('../../lib/helpers.js');

    const implementerResult = { status: 'closed' };
    const auditVerdict = {
      agent: 'arch-auditor',
      verdict: 'pass',
      concerns: [],
      recommendations: [],
      beadId: 'pv-test-1',
    };

    const matchResult = [
      { name: 'arch-auditor', path: '.claude/agents/arch.md', description: 'Arch', rationale: 'Match' },
    ];
    vi.mocked(helpers.discoverAgents).mockReturnValue([
      { name: 'arch-auditor', path: '.claude/agents/arch.md', description: 'Arch' },
    ]);

    let dispatchCount = 0;
    const mockSpawnFn = vi.fn().mockImplementation(() => {
      dispatchCount++;
      if (dispatchCount === 1) {
        return createMockChild(JSON.stringify(implementerResult), '', 0);
      }
      return createMockChild(JSON.stringify(auditVerdict), '', 0);
    });

    // Gate probes: clean tree, 1 commit ahead of base, 1 changed file
    const scriptSpawnFn = vi.fn()
      .mockReturnValueOnce(fakeSpawnResult('', '', 0))
      .mockReturnValueOnce(fakeSpawnResult('1\n', '', 0))
      .mockReturnValueOnce(fakeSpawnResult('src/server/calendar/service/calendar.ts\n', '', 0));

    const result = await runLeafExecution('pv-test-1', ctx, {
      spawnFn: mockSpawnFn,
      scriptSpawnFn,
      changedFiles: ['src/server/calendar/service/calendar.ts'],
      selectAuditorsFn: async () => matchResult,
    });

    expect(result.outcome).toBe('complete');
    expect(result.retryCount).toBe(0);
  });

  it('should complete with retryCount=1 on audit fail then pass', async () => {
    const { runLeafExecution } = await import('../../lib/execute.js');
    const helpers = await import('../../lib/helpers.js');

    const implementerResult = { status: 'closed' };
    const failVerdict = {
      agent: 'sec-auditor',
      verdict: 'fail',
      concerns: ['Missing validation'],
      recommendations: [],
      beadId: 'pv-test-1',
    };
    const passVerdict = {
      agent: 'sec-auditor',
      verdict: 'pass',
      concerns: [],
      recommendations: [],
      beadId: 'pv-test-1',
    };

    const matchResult = [
      { name: 'sec-auditor', path: '.claude/agents/sec.md', description: 'Sec', rationale: 'Match' },
    ];
    vi.mocked(helpers.discoverAgents).mockReturnValue([
      { name: 'sec-auditor', path: '.claude/agents/sec.md', description: 'Sec' },
    ]);

    let dispatchCount = 0;
    const mockSpawnFn = vi.fn().mockImplementation(() => {
      dispatchCount++;
      switch (dispatchCount) {
        case 1: return createMockChild(JSON.stringify(implementerResult), '', 0);
        case 2: return createMockChild(JSON.stringify(failVerdict), '', 0);
        case 3: return createMockChild(JSON.stringify(implementerResult), '', 0);
        case 4: return createMockChild(JSON.stringify(passVerdict), '', 0);
        default: return createMockChild(JSON.stringify(implementerResult), '', 0);
      }
    });

    // Gate probes fire once per implementer success: 3 probes per call, 2 calls total
    const scriptSpawnFn = vi.fn()
      // Attempt 1 gate
      .mockReturnValueOnce(fakeSpawnResult('', '', 0))
      .mockReturnValueOnce(fakeSpawnResult('1\n', '', 0))
      .mockReturnValueOnce(fakeSpawnResult('src/server/calendar/service/calendar.ts\n', '', 0))
      // Retry gate
      .mockReturnValueOnce(fakeSpawnResult('', '', 0))
      .mockReturnValueOnce(fakeSpawnResult('1\n', '', 0))
      .mockReturnValueOnce(fakeSpawnResult('src/server/calendar/service/calendar.ts\n', '', 0));

    const result = await runLeafExecution('pv-test-1', ctx, {
      spawnFn: mockSpawnFn,
      scriptSpawnFn,
      changedFiles: ['src/server/calendar/service/calendar.ts'],
      selectAuditorsFn: async () => matchResult,
    });

    expect(result.outcome).toBe('complete');
    expect(result.retryCount).toBe(1);
  });

  it('should halt on audit fail after retry exhaustion', async () => {
    const { runLeafExecution } = await import('../../lib/execute.js');
    const helpers = await import('../../lib/helpers.js');

    const implementerResult = { status: 'closed' };
    const failVerdict = {
      agent: 'sec-auditor',
      verdict: 'fail',
      concerns: ['Persistent issue'],
      recommendations: [],
      beadId: 'pv-test-1',
    };

    const matchResult = [
      { name: 'sec-auditor', path: '.claude/agents/sec.md', description: 'Sec', rationale: 'Match' },
    ];
    vi.mocked(helpers.discoverAgents).mockReturnValue([
      { name: 'sec-auditor', path: '.claude/agents/sec.md', description: 'Sec' },
    ]);

    let dispatchCount = 0;
    const mockSpawnFn = vi.fn().mockImplementation(() => {
      dispatchCount++;
      if (dispatchCount % 2 === 1) {
        return createMockChild(JSON.stringify(implementerResult), '', 0);
      }
      return createMockChild(JSON.stringify(failVerdict), '', 0);
    });

    // Gate probes fire once per implementer success: 3 probes per call, 2 calls total
    const scriptSpawnFn = vi.fn()
      .mockReturnValueOnce(fakeSpawnResult('', '', 0))
      .mockReturnValueOnce(fakeSpawnResult('1\n', '', 0))
      .mockReturnValueOnce(fakeSpawnResult('src/server/calendar/service/calendar.ts\n', '', 0))
      .mockReturnValueOnce(fakeSpawnResult('', '', 0))
      .mockReturnValueOnce(fakeSpawnResult('1\n', '', 0))
      .mockReturnValueOnce(fakeSpawnResult('src/server/calendar/service/calendar.ts\n', '', 0));

    const result = await runLeafExecution('pv-test-1', ctx, {
      spawnFn: mockSpawnFn,
      scriptSpawnFn,
      changedFiles: ['src/server/calendar/service/calendar.ts'],
      selectAuditorsFn: async () => matchResult,
    });

    expect(result.outcome).toBe('halt');
    expect(result.reason).toContain('retry exhausted');
  });

  it('calls verification gate after implementer success and uses its changedFiles for audit', async () => {
    const { runLeafExecution } = await import('../../lib/execute.js');

    // Implementer succeeds once
    const spawnFn = vi.fn().mockImplementation(() => createMockChild('done', '', 0));

    // Gate probes: clean tree, 1 commit, 1 changed file.
    // Probes may fire more than once if a retry occurs; keep returning passing
    // results so the test never exhausts the mock sequence — we only assert
    // that the FIRST gate pass drove the authoritative changedFiles.
    const scriptSpawnFn = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--porcelain')) return fakeSpawnResult('', '', 0);
      if (args.includes('--count')) return fakeSpawnResult('1\n', '', 0);
      if (args.includes('--name-only')) return fakeSpawnResult('src/gate.ts\n', '', 0);
      return fakeSpawnResult('', '', 0);
    });

    const passingSelector = vi.fn().mockResolvedValue([]); // empty selection -> audit fails
    // We don't actually care about audit outcome for this test; we only assert the gate fired and
    // changedFiles was overridden.

    await runLeafExecution('pv-gate.1', ctx, {
      spawnFn,
      scriptSpawnFn,
      selectAuditorsFn: passingSelector,
      changedFiles: ['STALE.ts'], // intentionally stale; gate must override
    });

    // Gate fired and passed
    expect(logStub.runJsonEntries).toContainEqual(
      expect.objectContaining({
        event: 'implementer-verification-passed',
        changedFilesCount: 1,
      }),
    );

    // audit-skip did NOT fire (gate produced a non-empty changedFiles)
    expect(logStub.runJsonEntries).not.toContainEqual(
      expect.objectContaining({ event: 'audit-skip' }),
    );

    // Auditor selector was called with the gate's changedFiles, not the stale dep
    expect(passingSelector).toHaveBeenCalledWith(
      ['src/gate.ts'],
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('retries implementer when gate fails on first attempt, succeeds on retry', async () => {
    const { runLeafExecution } = await import('../../lib/execute.js');

    const gateCtx: RunContext = { ...makeCtx(logStub), beadId: 'pv-gate.2' };

    // Implementer succeeds both attempts
    const spawnFn = vi.fn().mockImplementation(() => createMockChild('done', '', 0));

    // scriptSpawnFn: route by argv. First status call is dirty; subsequent clean.
    const scriptSpawnFn = vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status') {
        const call = scriptSpawnFn.mock.calls
          .filter(c => c[0] === 'git' && (c[1] as string[])[0] === 'status').length;
        return call === 1
          ? fakeSpawnResult(' M a.ts\n', '', 0)
          : fakeSpawnResult('', '', 0);
      }
      if (cmd === 'git' && args[0] === 'rev-list') return fakeSpawnResult('1\n', '', 0);
      // Empty diff -> audit-skip pass-through (we're exercising the gate, not audit).
      if (cmd === 'git' && args[0] === 'diff') return fakeSpawnResult('', '', 0);
      if (cmd === 'bd') return fakeSpawnResult('', '', 0);
      return fakeSpawnResult('', '', 0);
    });

    const selectAuditorsFn = vi.fn().mockResolvedValue([]);

    const result = await runLeafExecution('pv-gate.2', gateCtx, {
      spawnFn,
      scriptSpawnFn,
      selectAuditorsFn,
    });

    expect(result.outcome).toBe('complete');
    expect(result.retryCount).toBe(1);

    const verificationEvents = logStub.runJsonEntries
      .filter(e => typeof e.event === 'string' && (e.event as string).startsWith('implementer-verification'))
      .map(e => e.event);
    expect(verificationEvents).toEqual([
      'implementer-verification-failed',
      'implementer-verification-passed',
    ]);

    expect(logStub.runJsonEntries).toContainEqual(
      expect.objectContaining({
        event: 'bead-reopened',
        beadId: 'pv-gate.2',
        reason: 'verification-gate-retry',
      }),
    );
  });

  it('escalates when gate fails on both attempts', async () => {
    const { runLeafExecution } = await import('../../lib/execute.js');

    const gateCtx: RunContext = { ...makeCtx(logStub), beadId: 'pv-gate.3' };

    const spawnFn = vi.fn().mockImplementation(() => createMockChild('done', '', 0));

    // Status always dirty, everything else cooperates
    const scriptSpawnFn = vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status') return fakeSpawnResult(' M a.ts\n', '', 0);
      if (cmd === 'git' && args[0] === 'rev-list') return fakeSpawnResult('1\n', '', 0);
      if (cmd === 'git' && args[0] === 'diff') return fakeSpawnResult('a.ts\n', '', 0);
      if (cmd === 'bd') return fakeSpawnResult('', '', 0);
      return fakeSpawnResult('', '', 0);
    });

    const result = await runLeafExecution('pv-gate.3', gateCtx, {
      spawnFn,
      scriptSpawnFn,
    });

    expect(result.outcome).toBe('halt');

    const reopenEvents = logStub.runJsonEntries.filter(e => e.event === 'bead-reopened');
    expect(reopenEvents).toHaveLength(2);
    expect(reopenEvents.map(e => e.reason)).toEqual([
      'verification-gate-retry',
      'verification-gate-escalate',
    ]);
  });

  it('escalates when tree is clean but branch has zero commits (the observed failure)', async () => {
    const { runLeafExecution } = await import('../../lib/execute.js');

    const gateCtx: RunContext = { ...makeCtx(logStub), beadId: 'pv-psum.2' };

    const spawnFn = vi.fn().mockImplementation(() => createMockChild('done', '', 0));

    const scriptSpawnFn = vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status') return fakeSpawnResult('', '', 0);
      if (cmd === 'git' && args[0] === 'rev-list') return fakeSpawnResult('0\n', '', 0);
      if (cmd === 'git' && args[0] === 'diff') return fakeSpawnResult('', '', 0);
      if (cmd === 'bd') return fakeSpawnResult('', '', 0);
      return fakeSpawnResult('', '', 0);
    });

    const result = await runLeafExecution('pv-psum.2', gateCtx, {
      spawnFn,
      scriptSpawnFn,
    });

    expect(result.outcome).toBe('halt');

    const failReasons = logStub.runJsonEntries
      .filter(e => e.event === 'implementer-verification-failed')
      .map(e => e.reason);
    expect(failReasons).toEqual([
      'no commits on branch ahead of main',
      'no commits on branch ahead of main',
    ]);
  });
});

// =============================================================================
// runEpicExecution
// =============================================================================

describe('runEpicExecution', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(async () => {
    logStub = stubLogger();
    vi.clearAllMocks();
    const helpers = await import('../../lib/helpers.js');
    vi.mocked(helpers.discoverAgents).mockReturnValue([]);
    vi.mocked(helpers.bdEscalate).mockReturnValue(undefined);
    // Treat beads in this suite as enriched so they enter the implementer wave.
    vi.mocked(helpers.bdEnrichmentCheck).mockReturnValue(true);
  });

  it('runs verification gate per bead in an epic wave and escalates on gate failure', async () => {
    const { runEpicExecution } = await import('../../lib/execute.js');

    const ctx: RunContext = {
      runId: 'test-run',
      beadId: 'epic-parent',
      logger: logStub.logger,
      phaseHistory: [],
    };

    const initialBeads = ['pv-child.1'];

    // Implementer + downstream verifier agents all return success.
    // Build-guardian needs valid JSON for a pass verdict; return that uniformly
    // so the wave-end chain passes cleanly and the per-bead gate-failure path
    // is what drives the outcome.
    const spawnFn = vi.fn().mockImplementation(() =>
      createMockChild(JSON.stringify({ verdict: 'pass' }), '', 0),
    );

    // Gate fails with zero commits; bd/git calls otherwise cooperate.
    const scriptSpawnFn = vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status')   return fakeSpawnResult('', '', 0);
      if (cmd === 'git' && args[0] === 'rev-list') return fakeSpawnResult('0\n', '', 0);
      if (cmd === 'git' && args[0] === 'diff')     return fakeSpawnResult('', '', 0);
      // bd ready (cascade) returns no new beads so the while-loop exits.
      if (cmd === 'bd' && args[0] === 'ready')     return fakeSpawnResult('[]', '', 0);
      if (cmd === 'bd')                            return fakeSpawnResult('', '', 0);
      return fakeSpawnResult('', '', 0);
    });

    const result = await runEpicExecution('epic-parent', initialBeads, ctx, {
      spawnFn,
      scriptSpawnFn,
    });

    // Gate fired and reported the zero-commit failure for the child bead.
    expect(logStub.runJsonEntries).toContainEqual(
      expect.objectContaining({
        event: 'implementer-verification-failed',
        beadId: 'pv-child.1',
        reason: 'no commits on branch ahead of main',
      }),
    );

    // Bead was reopened with the epic-specific escalate tag.
    expect(logStub.runJsonEntries).toContainEqual(
      expect.objectContaining({
        event: 'bead-reopened',
        beadId: 'pv-child.1',
        reason: 'verification-gate-epic-escalate',
      }),
    );

    // The bead ended up flagged as failed/escalated in the epic result.
    const failedLike = [
      ...(result.beadsFailed ?? []),
      ...(result.escalatedBeads ?? []),
    ];
    expect(failedLike).toContain('pv-child.1');
  });
});

// =============================================================================
// runWithConcurrencyCap
// =============================================================================

describe('runWithConcurrencyCap', () => {
  it('should respect concurrency cap', async () => {
    const { runWithConcurrencyCap } = await import('../../lib/execute.js');

    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 6 }, (_, i) => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(r => setTimeout(r, 10));
      concurrent--;
      return i;
    });

    const results = await runWithConcurrencyCap(tasks, 2);

    expect(results).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('should return results in order', async () => {
    const { runWithConcurrencyCap } = await import('../../lib/execute.js');

    const tasks = [
      async () => { await new Promise(r => setTimeout(r, 30)); return 'slow'; },
      async () => { await new Promise(r => setTimeout(r, 10)); return 'fast'; },
      async () => { return 'instant'; },
    ];

    const results = await runWithConcurrencyCap(tasks, 3);
    expect(results).toEqual(['slow', 'fast', 'instant']);
  });
});

// =============================================================================
// parseBeadJson
// =============================================================================

describe('parseBeadJson', () => {
  it('should parse valid bd show --json output', async () => {
    const { parseBeadJson } = await import('../../lib/execute.js');

    const result = parseBeadJson(CLOSED_LEAF_JSON);
    expect(result).toEqual({
      title: 'Fix widget alignment',
      status: 'closed',
      issue_type: 'task',
    });
  });

  it('should return null for invalid JSON', async () => {
    const { parseBeadJson } = await import('../../lib/execute.js');
    expect(parseBeadJson('not json')).toBeNull();
  });

  it('should return null for empty string', async () => {
    const { parseBeadJson } = await import('../../lib/execute.js');
    expect(parseBeadJson('')).toBeNull();
  });

  it('should return null for empty array', async () => {
    const { parseBeadJson } = await import('../../lib/execute.js');
    expect(parseBeadJson('[]')).toBeNull();
  });
});

// =============================================================================
// derivePrTitleFromBead
// =============================================================================

describe('derivePrTitleFromBead', () => {
  it('should strip "Epic:" prefix for epic beads', async () => {
    const { derivePrTitleFromBead } = await import('../../lib/execute.js');
    expect(derivePrTitleFromBead('Epic: Redesign dashboard', 'epic'))
      .toBe('Redesign dashboard');
  });

  it('should pass through title for non-epic beads', async () => {
    const { derivePrTitleFromBead } = await import('../../lib/execute.js');
    expect(derivePrTitleFromBead('Fix alignment', 'task'))
      .toBe('Fix alignment');
  });

  it('should handle missing "Epic:" prefix for epic beads', async () => {
    const { derivePrTitleFromBead } = await import('../../lib/execute.js');
    expect(derivePrTitleFromBead('Redesign dashboard', 'epic'))
      .toBe('Redesign dashboard');
  });
});

// =============================================================================
// runPR
// =============================================================================

describe('runPR', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(async () => {
    logStub = stubLogger();
    vi.clearAllMocks();
    const helpers = await import('../../lib/helpers.js');
    vi.mocked(helpers.discoverAgents).mockReturnValue([]);
    vi.mocked(helpers.bdEscalate).mockReturnValue(undefined);
    vi.mocked(helpers.bdEnrichmentCheck).mockReturnValue(false);
    vi.mocked(helpers.commitMsg).mockImplementation(
      (beadId: string, summary: string, issueType: string) => {
        const typeMap: Record<string, string> = { bug: 'fix', feature: 'feat', epic: 'feat', task: 'chore' };
        const type = typeMap[issueType] ?? 'chore';
        return `${type}: ${summary} (${beadId})`;
      },
    );
    vi.mocked(helpers.prBody).mockReturnValue('## Summary\n\n- title\n');
  });

  function makeDeps(results: SpawnSyncReturns<Buffer>[]): ExecuteDeps {
    let callIndex = 0;
    const spawnFn = vi.fn().mockImplementation((cmd: string, args: string[]) => {
      // Intercept the rev-list backstop probe so the existing sequential
      // fixtures don't have to know about it. Default: branch has commits.
      if (cmd === 'git' && args[0] === 'rev-list') {
        return fakeSpawnResult('1\n', '', 0);
      }
      const result = results[callIndex] ?? results[results.length - 1];
      callIndex++;
      return result;
    });
    return { scriptSpawnFn: spawnFn };
  }

  it('should halt when git branch --show-current fails', async () => {
    const { runPR } = await import('../../lib/execute.js');

    const deps = makeDeps([
      fakeSpawnResult('', 'not a git repo', 128),
    ]);
    const ctx = makePhaseCtx(logStub);

    const result = await runPR(ctx, deps);
    expect(result.next).toBe('halt');
  });

  it('should halt when bead is not closed', async () => {
    const { runPR } = await import('../../lib/execute.js');

    const deps = makeDeps([
      fakeSpawnResult('feat/branch', '', 0),
      fakeSpawnResult(OPEN_BEAD_JSON, '', 0),
    ]);
    const ctx = makePhaseCtx(logStub);

    const result = await runPR(ctx, deps);
    expect(result.next).toBe('halt');
    expect(logStub.logs.some(l => l.kind === 'err' && l.data.includes('UNCLOSED'))).toBe(true);
  });

  it('should create PR and route to Report for a closed leaf bead', async () => {
    const { runPR } = await import('../../lib/execute.js');

    const branchName = 'chore/fix-widget-pv-test-1';
    const prUrl = 'https://github.com/owner/repo/pull/42';

    // Sequence: git branch, bd show, git push, gh pr create
    const deps = makeDeps([
      fakeSpawnResult(branchName, '', 0),
      fakeSpawnResult(CLOSED_LEAF_JSON, '', 0),
      fakeSpawnResult('', '', 0),
      fakeSpawnResult(prUrl, '', 0),
    ]);
    const ctx = makePhaseCtx(logStub);

    const result = await runPR(ctx, deps);

    expect(result.next).toBe(PhaseName.Report);
    expect(result.ctx.prUrl).toBe(prUrl);
    expect(result.ctx.beadsClosed).toEqual(['pv-test-1']);
  });

  it('should create PR for a closed epic with closed children', async () => {
    const { runPR } = await import('../../lib/execute.js');

    const prUrl = 'https://github.com/owner/repo/pull/99';

    // Sequence: git branch, bd show (epic), bd show (child1), bd show (child2),
    //           git push, gh pr create
    const deps = makeDeps([
      fakeSpawnResult('feat/branch', '', 0),
      fakeSpawnResult(CLOSED_EPIC_JSON, '', 0),
      fakeSpawnResult(CLOSED_CHILD_JSON, '', 0),
      fakeSpawnResult(CLOSED_CHILD_JSON, '', 0),
      fakeSpawnResult('', '', 0),
      fakeSpawnResult(prUrl, '', 0),
    ]);
    const ctx = makePhaseCtx(logStub);

    const result = await runPR(ctx, deps);

    expect(result.next).toBe(PhaseName.Report);

    const complete = logStub.runJsonEntries.find(e => e.event === 'pr_finalize_complete');
    expect(complete!.prTitle).toBe('Redesign dashboard');
    expect(complete!.beadsClosed).toEqual(['pv-test-1', 'pv-test-1.1', 'pv-test-1.2']);
  });

  it('should halt when an epic child is not closed', async () => {
    const { runPR } = await import('../../lib/execute.js');

    const deps = makeDeps([
      fakeSpawnResult('feat/branch', '', 0),
      fakeSpawnResult(CLOSED_EPIC_JSON, '', 0),
      fakeSpawnResult(CLOSED_CHILD_JSON, '', 0),
      fakeSpawnResult(OPEN_BEAD_JSON, '', 0),
    ]);
    const ctx = makePhaseCtx(logStub);

    const result = await runPR(ctx, deps);
    expect(result.next).toBe('halt');
  });
});

describe('runPR backstop', () => {
  it('halts before push if branch has zero commits ahead of main', async () => {
    const logStub = stubLogger();
    const ctx: PhaseCtx = {
      runId: 'test-run',
      beadId: 'pv-empty.1',
      logger: logStub.logger,
      phaseHistory: [],
      dryRun: false,
    };

    const scriptSpawnFn = vi.fn().mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'branch' && args[1] === '--show-current') {
        return fakeSpawnResult('chore/pv-empty-1\n', '', 0);
      }
      if (cmd === 'git' && args[0] === 'rev-list') {
        return fakeSpawnResult('0\n', '', 0);
      }
      // Anything else (bd show, git push, gh pr create) must NOT be called.
      // If it is, return failure so assertions catch the leak.
      return fakeSpawnResult('', 'unexpected spawn', 1);
    });

    const { runPR } = await import('../../lib/execute.js');
    const result = await runPR(ctx, { scriptSpawnFn });

    expect(result.next).toBe('halt');
    expect(ctx.prUrl).toBeUndefined();

    expect(logStub.runJsonEntries).toContainEqual(
      expect.objectContaining({
        event: 'pr_finalize_aborted',
        reason: 'no commits on branch',
      }),
    );

    // Assert the sequence: only branch detect + rev-list were called.
    const cmds = scriptSpawnFn.mock.calls.map((c: [string, string[]]) =>
      `${c[0]} ${c[1]?.[0] ?? ''}`);
    expect(cmds).toContain('git branch');
    expect(cmds).toContain('git rev-list');
    expect(cmds).not.toContain('git push');
    expect(cmds).not.toContain('gh pr');
    expect(cmds).not.toContain('bd show');
  });
});

// =============================================================================
// leafPhase / epicPhase — basic routing
// =============================================================================

describe('leafPhase', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(async () => {
    logStub = stubLogger();
    vi.clearAllMocks();
    const helpers = await import('../../lib/helpers.js');
    vi.mocked(helpers.discoverAgents).mockReturnValue([]);
    vi.mocked(helpers.bdEscalate).mockReturnValue(undefined);
    vi.mocked(helpers.bdEnrichmentCheck).mockReturnValue(false);
  });

  it('should route to PR on successful leaf execution', async () => {
    const { leafPhase } = await import('../../lib/execute.js');

    const implementerResult = { status: 'closed' };

    // No auditors matched -> passes immediately after implementer
    const mockSpawnFn = vi.fn().mockReturnValue(
      createMockChild(JSON.stringify(implementerResult), '', 0),
    );

    // Gate probes: clean tree, 1 commit, 0 changed files -> audit-skip passes
    const scriptSpawnFn = vi.fn()
      .mockReturnValueOnce(fakeSpawnResult('', '', 0))
      .mockReturnValueOnce(fakeSpawnResult('1\n', '', 0))
      .mockReturnValueOnce(fakeSpawnResult('', '', 0));

    const ctx = makePhaseCtx(logStub);

    const result = await leafPhase(ctx, {
      spawnFn: mockSpawnFn,
      scriptSpawnFn,
      changedFiles: [],
    });

    expect(result.next).toBe(PhaseName.PR);
  });
});

describe('epicPhase', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(async () => {
    logStub = stubLogger();
    vi.clearAllMocks();
    const helpers = await import('../../lib/helpers.js');
    vi.mocked(helpers.discoverAgents).mockReturnValue([]);
    vi.mocked(helpers.bdEscalate).mockReturnValue(undefined);
    vi.mocked(helpers.bdEnrichmentCheck).mockReturnValue(false);
  });

  it('should halt when no ready beads found', async () => {
    const { epicPhase } = await import('../../lib/execute.js');

    const mockSpawnSync = vi.fn().mockReturnValue({
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      status: 1,
    });

    const ctx = makePhaseCtx(logStub);

    const result = await epicPhase(ctx, { scriptSpawnFn: mockSpawnSync });
    expect(result.next).toBe('halt');
  });
});
