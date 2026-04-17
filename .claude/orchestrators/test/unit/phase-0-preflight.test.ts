import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { runPreflight, PREFLIGHT_MESSAGES, GIT_SAFE_MESSAGES, type PreflightDeps } from '../../lib/phase-0-preflight.js';
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

function makeCtx(logStub: ReturnType<typeof stubLogger>): OrchestratorContext {
  return {
    runId: 'test-run-001',
    beadId: '',
    logger: logStub.logger,
    phaseHistory: [],
    dryRun: false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('phase-0-preflight', () => {
  let logStub: ReturnType<typeof stubLogger>;
  let ctx: OrchestratorContext;
  let spawnCalls: { script: string; args: string[] }[];
  let spawnResults: SpawnSyncReturns<Buffer>[];

  beforeEach(() => {
    logStub = stubLogger();
    ctx = makeCtx(logStub);
    spawnCalls = [];
    spawnResults = [];
    vi.restoreAllMocks();
  });

  /**
   * Build deps that queue up spawn results in order.
   */
  function makeDeps(): PreflightDeps {
    let callIndex = 0;
    const sharedSpawnFn = ((script: string, args: string[]) => {
      spawnCalls.push({ script, args });
      return spawnResults[callIndex++] ?? fakeSpawnResult('', 'unexpected call', 1);
    }) as unknown as typeof import('node:child_process').spawnSync;

    return {
      runScriptOpts: {
        existsFn: () => true,
        spawnFn: sharedSpawnFn,
      },
      gitSafeSpawnFn: sharedSpawnFn,
    };
  }

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('should proceed to phase-1-select when both scripts pass', async () => {
    spawnResults = [
      // preflight.sh — ok
      fakeSpawnResult(JSON.stringify({ ok: true, failures: [] }), '', 0),
      // git-safe-to-start.sh — ok
      fakeSpawnResult('{}', '', 0),
    ];

    const result = await runPreflight(ctx, makeDeps());

    expect(result.next).toBe(PhaseName.Select);
    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[0].script).toContain('preflight.sh');
    expect(spawnCalls[1].script).toContain('git-safe-to-start.sh');
  });

  // -------------------------------------------------------------------------
  // Preflight failures (4 kinds)
  // -------------------------------------------------------------------------

  it('should halt with dirty_tree message', async () => {
    const failures = [{ kind: 'dirty_tree', reason: 'uncommitted changes' }];
    spawnResults = [
      fakeSpawnResult(
        JSON.stringify({ ok: false, failures }),
        '',
        1,
      ),
    ];

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runPreflight(ctx, makeDeps());

    expect(result.next).toBe('halt');
    expect(consoleSpy).toHaveBeenCalledWith(PREFLIGHT_MESSAGES.dirty_tree);
    consoleSpy.mockRestore();
  });

  it('should halt with wrong_branch message', async () => {
    const failures = [{ kind: 'wrong_branch', reason: 'on feature-x' }];
    spawnResults = [
      fakeSpawnResult(
        JSON.stringify({ ok: false, failures }),
        '',
        1,
      ),
    ];

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runPreflight(ctx, makeDeps());

    expect(result.next).toBe('halt');
    expect(consoleSpy).toHaveBeenCalledWith(PREFLIGHT_MESSAGES.wrong_branch);
    consoleSpy.mockRestore();
  });

  it('should halt with stale_main message', async () => {
    const failures = [{ kind: 'stale_main', reason: 'out of sync' }];
    spawnResults = [
      fakeSpawnResult(
        JSON.stringify({ ok: false, failures }),
        '',
        1,
      ),
    ];

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runPreflight(ctx, makeDeps());

    expect(result.next).toBe('halt');
    expect(consoleSpy).toHaveBeenCalledWith(PREFLIGHT_MESSAGES.stale_main);
    consoleSpy.mockRestore();
  });

  it('should halt with empty_backlog message', async () => {
    const failures = [{ kind: 'empty_backlog', reason: 'no beads' }];
    spawnResults = [
      fakeSpawnResult(
        JSON.stringify({ ok: false, failures }),
        '',
        1,
      ),
    ];

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runPreflight(ctx, makeDeps());

    expect(result.next).toBe('halt');
    expect(consoleSpy).toHaveBeenCalledWith(PREFLIGHT_MESSAGES.empty_backlog);
    consoleSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Multiple preflight failures
  // -------------------------------------------------------------------------

  it('should report all failures when preflight returns multiple', async () => {
    const failures = [
      { kind: 'dirty_tree', reason: 'uncommitted' },
      { kind: 'wrong_branch', reason: 'on feature' },
    ];
    spawnResults = [
      fakeSpawnResult(
        JSON.stringify({ ok: false, failures }),
        '',
        1,
      ),
    ];

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runPreflight(ctx, makeDeps());

    expect(result.next).toBe('halt');
    expect(consoleSpy).toHaveBeenCalledWith(PREFLIGHT_MESSAGES.dirty_tree);
    expect(consoleSpy).toHaveBeenCalledWith(PREFLIGHT_MESSAGES.wrong_branch);
    consoleSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // git-safe-to-start failures
  // -------------------------------------------------------------------------

  it('should halt when git-safe-to-start exits 1', async () => {
    spawnResults = [
      // preflight.sh — ok
      fakeSpawnResult(JSON.stringify({ ok: true, failures: [] }), '', 0),
      // git-safe-to-start.sh — dirty/wrong branch
      fakeSpawnResult('', 'git-safe-to-start: working tree is dirty', 1),
    ];

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runPreflight(ctx, makeDeps());

    expect(result.next).toBe('halt');
    expect(consoleSpy).toHaveBeenCalledWith(GIT_SAFE_MESSAGES[1]);
    consoleSpy.mockRestore();
  });

  it('should halt when git-safe-to-start exits 2 (git failure)', async () => {
    spawnResults = [
      fakeSpawnResult(JSON.stringify({ ok: true, failures: [] }), '', 0),
      fakeSpawnResult('', 'git-safe-to-start: not inside a git work tree', 2),
    ];

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runPreflight(ctx, makeDeps());

    expect(result.next).toBe('halt');
    expect(consoleSpy).toHaveBeenCalledWith(GIT_SAFE_MESSAGES[2]);
    consoleSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Preflight non-zero exit with unparseable stdout
  // -------------------------------------------------------------------------

  it('should halt with generic message when preflight stdout is not JSON', async () => {
    spawnResults = [
      fakeSpawnResult('not json', 'some error', 1),
    ];

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runPreflight(ctx, makeDeps());

    expect(result.next).toBe('halt');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Preflight failed with exit code 1'),
    );
    consoleSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  it('should log failure messages to the phase log', async () => {
    const failures = [{ kind: 'dirty_tree', reason: 'uncommitted' }];
    spawnResults = [
      fakeSpawnResult(JSON.stringify({ ok: false, failures }), '', 1),
    ];

    vi.spyOn(console, 'error').mockImplementation(() => {});
    await runPreflight(ctx, makeDeps());

    const errLogs = logStub.logs.filter(l => l.kind === 'err');
    expect(errLogs.some(l => l.data.includes(PREFLIGHT_MESSAGES.dirty_tree))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Verbatim message parity check
  // -------------------------------------------------------------------------

  it('should have exactly 4 preflight message kinds', () => {
    expect(Object.keys(PREFLIGHT_MESSAGES)).toEqual([
      'dirty_tree',
      'wrong_branch',
      'stale_main',
      'empty_backlog',
    ]);
  });

  it('should use em-dash in all verbatim messages', () => {
    for (const msg of Object.values(PREFLIGHT_MESSAGES)) {
      expect(msg).toContain('\u2014');
    }
  });
});
