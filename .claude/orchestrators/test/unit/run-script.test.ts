import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { runScript, RunScriptError, type RunScriptOptions } from '../../lib/run-script.js';
import { PhaseName, type RunLogger } from '../../lib/context.js';

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
