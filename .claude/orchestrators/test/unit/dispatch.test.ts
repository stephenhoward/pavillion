import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess, SpawnSyncReturns } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import {
  dispatch,
  DispatchTimeoutError,
  DispatchMalformedError,
  DispatchSpawnError,
  runScript,
  RunScriptError,
  spawnCmd,
  fanOutAdvisors,
  buildAdvisorPrompt,
  ADVISOR_BUDGET_DEFAULT,
  ADVISOR_TIMEOUT_MS,
  type DispatchOptions,
  type RunScriptOptions,
  type AdvisorVerdict,
  type MatchedAdvisor,
  type FanOutDeps,
} from '../../lib/dispatch.js';
import { PhaseName, type RunLogger, type RunContext } from '../../lib/types.js';

/**
 * Build a stub logger that captures calls for assertions.
 */
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

/**
 * Create a mock child process that emits data and close asynchronously.
 */
function createMockChild(
  stdout: string,
  stderr: string,
  exitCode: number,
): ChildProcess & EventEmitter {
  const child = new EventEmitter() as ChildProcess & EventEmitter;

  const stdoutStream = new Readable({ read() {} });
  const stderrStream = new Readable({ read() {} });

  // Stub stdin as a writable that accepts writes silently
  child.stdin = { write: vi.fn(), end: vi.fn() } as unknown as ChildProcess['stdin'];
  child.stdout = stdoutStream;
  child.stderr = stderrStream;
  child.pid = 12345;
  child.kill = vi.fn().mockReturnValue(true);

  // Use setImmediate so events fire after the promise listeners are attached
  setImmediate(() => {
    if (stdout) stdoutStream.push(stdout);
    stdoutStream.push(null);
    if (stderr) stderrStream.push(stderr);
    stderrStream.push(null);
    child.emit('close', exitCode);
  });

  return child;
}

/**
 * Create a mock child that never closes (for timeout tests).
 * The child responds to kill by emitting close.
 */
function createHangingChild(): ChildProcess & EventEmitter {
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

  return child;
}

describe('dispatch', () => {
  let mockSpawnFn: ReturnType<typeof vi.fn>;
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    mockSpawnFn = vi.fn();
    logStub = stubLogger();
  });

  function baseOpts(overrides?: Partial<DispatchOptions>): DispatchOptions {
    return {
      agent: 'test-agent',
      schemaPath: '/path/to/schema.json',
      prompt: 'Do the thing',
      budgetUsd: 0.50,
      timeoutMs: 30_000,
      ctx: {
        runId: 'test-run-1',
        beadId: 'pv-test',
        logger: logStub.logger,
        phaseHistory: [],
      },
      logTag: PhaseName.Shape,
      spawnFn: mockSpawnFn,
      ...overrides,
    };
  }

  it('should return parsed JSON on successful dispatch', async () => {
    const payload = { result: 'success', score: 42 };
    mockSpawnFn.mockReturnValue(
      createMockChild(JSON.stringify(payload), '', 0),
    );

    const result = await dispatch(baseOpts());
    expect(result).toEqual(payload);
  });

  it('should pass canonical flags to claude CLI', async () => {
    const payload = { ok: true };
    mockSpawnFn.mockReturnValue(
      createMockChild(JSON.stringify(payload), '', 0),
    );

    await dispatch(baseOpts());

    expect(mockSpawnFn).toHaveBeenCalledTimes(1);
    const [bin, args] = mockSpawnFn.mock.calls[0];
    expect(bin).toContain('claude');
    expect(args).not.toContain('--bare');
    expect(args).toContain('--permission-mode');
    expect(args).toContain('bypassPermissions');
    expect(args).toContain('--no-session-persistence');
    expect(args).toContain('--agent');
    expect(args).toContain('test-agent');
    expect(args).toContain('--json-schema');
    expect(args).toContain('/path/to/schema.json');
    expect(args).toContain('--max-budget-usd');
    expect(args).toContain('0.5');
  });

  it('should include --fallback-model when provided', async () => {
    const payload = { ok: true };
    mockSpawnFn.mockReturnValue(
      createMockChild(JSON.stringify(payload), '', 0),
    );

    await dispatch(baseOpts({ fallbackModel: true }));

    const [, args] = mockSpawnFn.mock.calls[0];
    expect(args).toContain('--fallback-model');
  });

  it('should not include --fallback-model when not provided', async () => {
    const payload = { ok: true };
    mockSpawnFn.mockReturnValue(
      createMockChild(JSON.stringify(payload), '', 0),
    );

    await dispatch(baseOpts());

    const [, args] = mockSpawnFn.mock.calls[0];
    expect(args).not.toContain('--fallback-model');
  });

  it('should write prompt to stdin on initial dispatch', async () => {
    const payload = { ok: true };
    const child = createMockChild(JSON.stringify(payload), '', 0);
    mockSpawnFn.mockReturnValue(child);

    await dispatch(baseOpts());

    expect(child.stdin!.write).toHaveBeenCalledWith('Do the thing');
    expect(child.stdin!.end).toHaveBeenCalled();
  });

  it('should log stdout and stderr', async () => {
    const payload = { ok: true };
    mockSpawnFn.mockReturnValue(
      createMockChild(JSON.stringify(payload), 'some warning', 0),
    );

    await dispatch(baseOpts());

    expect(logStub.logs.some(l =>
      l.kind === 'out' && l.data.includes(JSON.stringify(payload)),
    )).toBe(true);
    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('some warning'),
    )).toBe(true);
  });

  it('should throw DispatchTimeoutError when process exceeds timeout', async () => {
    const child = createHangingChild();
    mockSpawnFn.mockReturnValue(child);

    // Use a very short timeout so the real timer fires quickly
    const promise = dispatch(baseOpts({ timeoutMs: 50 }));

    await expect(promise).rejects.toThrow(DispatchTimeoutError);
    expect(child.kill).toHaveBeenCalled();
  });

  it('should retry once on malformed JSON output then succeed', async () => {
    const goodPayload = { result: 'fixed' };

    // First call returns invalid JSON, second returns valid
    mockSpawnFn
      .mockReturnValueOnce(createMockChild('not valid json', '', 0))
      .mockReturnValueOnce(createMockChild(JSON.stringify(goodPayload), '', 0));

    const result = await dispatch(baseOpts());

    expect(result).toEqual(goodPayload);
    expect(mockSpawnFn).toHaveBeenCalledTimes(2);
  });

  it('should include validation error in retry prompt via -p flag', async () => {
    const goodPayload = { result: 'fixed' };

    mockSpawnFn
      .mockReturnValueOnce(createMockChild('not valid json', '', 0))
      .mockReturnValueOnce(createMockChild(JSON.stringify(goodPayload), '', 0));

    await dispatch(baseOpts());

    // The retry call should use -p flag with the nudge prompt
    const [, retryArgs] = mockSpawnFn.mock.calls[1];
    expect(retryArgs).toContain('-p');

    // Find the prompt arg (follows -p)
    const pIdx = retryArgs.indexOf('-p');
    const nudgePrompt = retryArgs[pIdx + 1] as string;
    expect(nudgePrompt).toContain('Validation error:');
    expect(nudgePrompt).toContain('/path/to/schema.json');
  });

  it('should throw DispatchMalformedError after retry also fails', async () => {
    mockSpawnFn
      .mockReturnValueOnce(createMockChild('broken json 1', '', 0))
      .mockReturnValueOnce(createMockChild('broken json 2', '', 0));

    await expect(dispatch(baseOpts())).rejects.toThrow(DispatchMalformedError);
    expect(mockSpawnFn).toHaveBeenCalledTimes(2);
  });

  it('should throw DispatchSpawnError on non-zero exit code', async () => {
    mockSpawnFn.mockReturnValue(
      createMockChild('', 'agent crashed', 1),
    );

    await expect(dispatch(baseOpts())).rejects.toThrow(DispatchSpawnError);
  });

  it('should truncate prompt in log to first 200 chars', async () => {
    const longPrompt = 'x'.repeat(500);
    const payload = { ok: true };
    mockSpawnFn.mockReturnValue(
      createMockChild(JSON.stringify(payload), '', 0),
    );

    await dispatch(baseOpts({ prompt: longPrompt }));

    expect(logStub.runJsonEntries.length).toBeGreaterThan(0);
    const entry = logStub.runJsonEntries[0] as Record<string, unknown>;
    expect(entry.promptLength).toBe(500);
    const preview = entry.promptPreview as string;
    expect(preview.length).toBeLessThanOrEqual(203); // 200 + "..."
  });
});

// =============================================================================
// runScript tests
// =============================================================================

/**
 * Build a fake SpawnSyncReturns from simple string values.
 */
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

describe('runScript', () => {
  let mockSpawnFn: ReturnType<typeof vi.fn>;
  let logStub: ReturnType<typeof stubLogger>;
  let opts: RunScriptOptions;

  beforeEach(() => {
    mockSpawnFn = vi.fn();
    logStub = stubLogger();
    opts = {
      logger: logStub.logger,
      logTag: PhaseName.Preflight,
      spawnFn: mockSpawnFn,
      existsFn: () => true,
    };
  });

  it('should parse JSON and return success for exit code 0', () => {
    const payload = { ok: true, failures: [] };
    mockSpawnFn.mockReturnValue(
      fakeSpawnResult(JSON.stringify(payload), '', 0),
    );

    const result = runScript('/path/to/script.sh', ['--flag'], opts);

    expect(result.exitCode).toBe(0);
    expect(result.json).toEqual(payload);
    expect(result.stderr).toBe('');
  });

  it('should log stdout on success', () => {
    const payload = { ok: true };
    mockSpawnFn.mockReturnValue(
      fakeSpawnResult(JSON.stringify(payload), '', 0),
    );

    runScript('/path/to/script.sh', [], opts);

    expect(logStub.logs).toContainEqual({
      phase: PhaseName.Preflight,
      kind: 'out',
      data: JSON.stringify(payload),
    });
  });

  it('should return failure with stderr and stdout for non-zero exit', () => {
    mockSpawnFn.mockReturnValue(
      fakeSpawnResult('partial output', 'something went wrong', 1),
    );

    const result = runScript('/path/to/script.sh', ['arg1'], opts);

    expect(result.exitCode).toBe(1);
    expect(result.json).toBeNull();
    expect(result.stderr).toBe('something went wrong');
    expect((result as { stdout: string }).stdout).toBe('partial output');
  });

  it('should not attempt JSON parse on non-zero exit', () => {
    mockSpawnFn.mockReturnValue(
      fakeSpawnResult('not json at all', 'error msg', 2),
    );

    // Should not throw even though stdout is not JSON
    const result = runScript('/path/to/script.sh', [], opts);
    expect(result.exitCode).toBe(2);
    expect(result.json).toBeNull();
  });

  it('should log stderr on non-zero exit', () => {
    mockSpawnFn.mockReturnValue(
      fakeSpawnResult('', 'fatal error', 1),
    );

    runScript('/path/to/script.sh', [], opts);

    expect(logStub.logs).toContainEqual({
      phase: PhaseName.Preflight,
      kind: 'err',
      data: 'fatal error',
    });
  });

  it('should throw RunScriptError for malformed JSON on exit 0', () => {
    mockSpawnFn.mockReturnValue(
      fakeSpawnResult('{ broken json !!!', '', 0),
    );

    expect(() => runScript('/path/to/script.sh', [], opts))
      .toThrow(RunScriptError);

    try {
      runScript('/path/to/script.sh', [], opts);
    }
    catch (err) {
      expect(err).toBeInstanceOf(RunScriptError);
      const rse = err as RunScriptError;
      expect(rse.exitCode).toBe(0);
      expect(rse.stdout).toBe('{ broken json !!!');
      expect(rse.cause).toBeDefined();
    }
  });

  it('should throw RunScriptError when script does not exist', () => {
    opts.existsFn = () => false;

    expect(() => runScript('/missing/script.sh', [], opts))
      .toThrow(RunScriptError);

    try {
      runScript('/missing/script.sh', [], opts);
    }
    catch (err) {
      const rse = err as RunScriptError;
      expect(rse.message).toContain('Script not found');
      expect(rse.exitCode).toBe(-1);
    }
  });

  it('should log the error when script does not exist', () => {
    opts.existsFn = () => false;

    try {
      runScript('/missing/script.sh', [], opts);
    }
    catch {
      // expected
    }

    expect(logStub.logs.some(l =>
      l.kind === 'err' && l.data.includes('Script not found'),
    )).toBe(true);
  });

  it('should not call spawnFn when script does not exist', () => {
    opts.existsFn = () => false;

    try {
      runScript('/missing/script.sh', [], opts);
    }
    catch {
      // expected
    }

    expect(mockSpawnFn).not.toHaveBeenCalled();
  });

  it('should pass args to the spawn function', () => {
    mockSpawnFn.mockReturnValue(
      fakeSpawnResult('{}', '', 0),
    );

    runScript('/path/to/script.sh', ['--limit', '5'], opts);

    expect(mockSpawnFn).toHaveBeenCalledWith(
      '/path/to/script.sh',
      ['--limit', '5'],
      expect.objectContaining({ shell: true }),
    );
  });

  it('should handle empty stdout on exit 0 as malformed JSON', () => {
    mockSpawnFn.mockReturnValue(
      fakeSpawnResult('', '', 0),
    );

    expect(() => runScript('/path/to/script.sh', [], opts))
      .toThrow(RunScriptError);
  });
});

// =============================================================================
// spawnCmd tests
// =============================================================================

describe('spawnCmd', () => {
  let mockSpawnFn: ReturnType<typeof vi.fn>;
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    mockSpawnFn = vi.fn();
    logStub = stubLogger();
  });

  it('should return stdout, stderr, and exitCode', () => {
    mockSpawnFn.mockReturnValue(
      fakeSpawnResult('hello world\n', 'warn msg\n', 0),
    );

    const result = spawnCmd('git', ['status'], logStub.logger, PhaseName.Branch, mockSpawnFn);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello world');
    expect(result.stderr).toBe('warn msg');
  });

  it('should log stdout and stderr', () => {
    mockSpawnFn.mockReturnValue(
      fakeSpawnResult('output line\n', 'error line\n', 1),
    );

    spawnCmd('git', ['push'], logStub.logger, PhaseName.PR, mockSpawnFn);

    expect(logStub.logs.some(l => l.kind === 'out' && l.data.includes('output line'))).toBe(true);
    expect(logStub.logs.some(l => l.kind === 'err' && l.data.includes('error line'))).toBe(true);
  });

  it('should merge env when provided', () => {
    mockSpawnFn.mockReturnValue(fakeSpawnResult('', '', 0));

    spawnCmd('env', [], logStub.logger, PhaseName.Branch, mockSpawnFn, { MY_VAR: 'hello' });

    const spawnOpts = mockSpawnFn.mock.calls[0][2] as Record<string, unknown>;
    expect(spawnOpts.env).toMatchObject({ MY_VAR: 'hello' });
  });

  it('should pass undefined env when no env override provided', () => {
    mockSpawnFn.mockReturnValue(fakeSpawnResult('', '', 0));

    spawnCmd('git', ['log'], logStub.logger, PhaseName.Branch, mockSpawnFn);

    const spawnOpts = mockSpawnFn.mock.calls[0][2] as Record<string, unknown>;
    expect(spawnOpts.env).toBeUndefined();
  });
});

// =============================================================================
// fanOutAdvisors tests
// =============================================================================

function makeCtx(logStub: ReturnType<typeof stubLogger>): RunContext {
  return {
    runId: 'test-run-001',
    beadId: 'pv-test-1',
    logger: logStub.logger,
    phaseHistory: [],
  };
}

function makeAdvisor(name: string): MatchedAdvisor {
  return {
    name,
    path: `.claude/agents/${name}.md`,
    description: `${name} agent`,
    rationale: 'matched by test',
  };
}

function cleanVerdict(agent: string): AdvisorVerdict {
  return { agent, verdict: 'clean', concerns: [], recommendations: [] };
}

function refinementVerdict(agent: string): AdvisorVerdict {
  return {
    agent,
    verdict: 'refinement-needed',
    concerns: ['Missing error handling pattern'],
    recommendations: ['Add try/catch around API calls'],
  };
}

function escalateVerdict(agent: string): AdvisorVerdict {
  return {
    agent,
    verdict: 'escalate',
    concerns: ['Critical security gap in design'],
    recommendations: ['Redesign auth flow'],
  };
}

describe('buildAdvisorPrompt', () => {
  it('should include advisor name in prompt', () => {
    const prompt = buildAdvisorPrompt('security-advisor', 'pv-abc-1', 'some context');
    expect(prompt).toContain('security-advisor');
  });

  it('should include bead id in prompt', () => {
    const prompt = buildAdvisorPrompt('security-advisor', 'pv-abc-1', 'some context');
    expect(prompt).toContain('pv-abc-1');
  });

  it('should include bead context in prompt', () => {
    const prompt = buildAdvisorPrompt('security-advisor', 'pv-abc-1', 'Full bead description here');
    expect(prompt).toContain('Full bead description here');
  });

  it('should reference the advisor-verdict schema output format', () => {
    const prompt = buildAdvisorPrompt('security-advisor', 'pv-abc-1', 'ctx');
    expect(prompt).toContain('advisor-verdict');
  });
});

describe('fanOutAdvisors', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
  });

  it('should return clean report for empty advisor list', async () => {
    const ctx = makeCtx(logStub);
    const report = await fanOutAdvisors(
      [], 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors,
    );

    expect(report.overallVerdict).toBe('clean');
    expect(report.advisors).toHaveLength(0);
    expect(report.beadId).toBe('pv-test-1');
    expect(report.phase).toBe('phase-3-shape');
  });

  it('should return clean when single advisor approves', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('architecture-advisor')];
    const deps: FanOutDeps = {
      dispatchFn: vi.fn().mockResolvedValue(cleanVerdict('architecture-advisor')),
    };

    const report = await fanOutAdvisors(
      advisors, 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors, deps,
    );

    expect(report.overallVerdict).toBe('clean');
    expect(report.advisors).toHaveLength(1);
    expect(report.advisors[0].verdict).toBe('clean');
  });

  it('should return clean when all advisors approve', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [
      makeAdvisor('architecture-advisor'),
      makeAdvisor('security-advisor'),
      makeAdvisor('consistency-advisor'),
    ];

    const dispatchFn = vi.fn()
      .mockResolvedValueOnce(cleanVerdict('architecture-advisor'))
      .mockResolvedValueOnce(cleanVerdict('security-advisor'))
      .mockResolvedValueOnce(cleanVerdict('consistency-advisor'));

    const deps: FanOutDeps = { dispatchFn };

    const report = await fanOutAdvisors(
      advisors, 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors, deps,
    );

    expect(report.overallVerdict).toBe('clean');
    expect(report.advisors).toHaveLength(3);
    expect(dispatchFn).toHaveBeenCalledTimes(3);
  });

  it('should return refinement-needed when one advisor escalates', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('architecture-advisor'), makeAdvisor('security-advisor')];

    const dispatchFn = vi.fn()
      .mockResolvedValueOnce(cleanVerdict('architecture-advisor'))
      .mockResolvedValueOnce(escalateVerdict('security-advisor'));

    const report = await fanOutAdvisors(
      advisors, 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors, { dispatchFn },
    );

    expect(report.overallVerdict).toBe('refinement-needed');
    expect(report.advisors).toHaveLength(2);
    expect(report.advisors[1].verdict).toBe('escalate');
  });

  it('should return refinement-needed when one advisor needs refinement', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('architecture-advisor'), makeAdvisor('consistency-advisor')];

    const dispatchFn = vi.fn()
      .mockResolvedValueOnce(cleanVerdict('architecture-advisor'))
      .mockResolvedValueOnce(refinementVerdict('consistency-advisor'));

    const report = await fanOutAdvisors(
      advisors, 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors, { dispatchFn },
    );

    expect(report.overallVerdict).toBe('refinement-needed');
    expect(report.summary).toContain('consistency-advisor');
  });

  it('should handle dispatch timeout gracefully as escalate verdict', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('slow-advisor')];
    const deps: FanOutDeps = {
      dispatchFn: vi.fn().mockRejectedValue(
        new DispatchTimeoutError('slow-advisor', 120_000),
      ),
    };

    const report = await fanOutAdvisors(
      advisors, 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors, deps,
    );

    expect(report.overallVerdict).toBe('refinement-needed');
    expect(report.advisors[0].verdict).toBe('escalate');
    expect(report.advisors[0].concerns[0]).toContain('timed out');
  });

  it('should handle dispatch malformed error gracefully', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('broken-advisor')];
    const deps: FanOutDeps = {
      dispatchFn: vi.fn().mockRejectedValue(
        new DispatchMalformedError('broken-advisor', 'garbage', 'not json'),
      ),
    };

    const report = await fanOutAdvisors(
      advisors, 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors, deps,
    );

    expect(report.overallVerdict).toBe('refinement-needed');
    expect(report.advisors[0].verdict).toBe('escalate');
    expect(report.advisors[0].concerns[0]).toContain('malformed');
  });

  it('should log fan_out_start event', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('test-advisor')];
    const deps: FanOutDeps = {
      dispatchFn: vi.fn().mockResolvedValue(cleanVerdict('test-advisor')),
    };

    await fanOutAdvisors(
      advisors, 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors, deps,
    );

    const startEntry = logStub.runJsonEntries.find(e => e.event === 'advisors_fan_out_start');
    expect(startEntry).toBeDefined();
    expect(startEntry!.advisorCount).toBe(1);
  });

  it('should log fan_out_complete event', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('test-advisor')];
    const deps: FanOutDeps = {
      dispatchFn: vi.fn().mockResolvedValue(cleanVerdict('test-advisor')),
    };

    await fanOutAdvisors(
      advisors, 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors, deps,
    );

    const completeEntry = logStub.runJsonEntries.find(e => e.event === 'advisors_fan_out_complete');
    expect(completeEntry).toBeDefined();
    expect(completeEntry!.overallVerdict).toBe('clean');
  });

  it('should export sensible default constants', () => {
    expect(ADVISOR_BUDGET_DEFAULT).toBeGreaterThan(0);
    expect(ADVISOR_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('should set the phase tag from the caller', async () => {
    const ctx = makeCtx(logStub);
    const report = await fanOutAdvisors(
      [], 'pv-test-1', 'context', 'phase-5-analyze', ctx, PhaseName.AnalyzeAdvisors,
    );

    expect(report.phase).toBe('phase-5-analyze');
  });
});
