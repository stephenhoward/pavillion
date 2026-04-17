import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import {
  dispatch,
  DispatchTimeoutError,
  DispatchMalformedError,
  DispatchSpawnError,
  type DispatchOptions,
} from '../../lib/dispatch.js';
import { PhaseName, type RunLogger } from '../../lib/context.js';

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
    expect(args).toContain('--bare');
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
