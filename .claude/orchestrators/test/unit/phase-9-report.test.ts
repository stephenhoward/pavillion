import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSummary, runReport } from '../../lib/phase-9-report.js';
import { PhaseName, type RunLogger, type PhaseResult } from '../../lib/context.js';
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
  overrides: Record<string, unknown> = {},
): OrchestratorContext & { prUrl?: string; beadsClosed?: string[] } {
  return {
    runId: 'test-run-001',
    beadId: 'pv-test-1',
    logger: logStub.logger,
    phaseHistory: [],
    dryRun: false,
    ...overrides,
  } as OrchestratorContext & { prUrl?: string; beadsClosed?: string[] };
}

// ---------------------------------------------------------------------------
// buildSummary — pure function
// ---------------------------------------------------------------------------

describe('buildSummary', () => {

  it('should include run ID, bead ID, and status', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub, {
      prUrl: 'https://github.com/pull/42',
      beadsClosed: ['pv-test-1'],
      phaseHistory: [
        { phase: PhaseName.Preflight, ok: true, durationMs: 100 },
        { phase: PhaseName.Select, ok: true, durationMs: 200 },
      ] as PhaseResult[],
    });

    const summary = buildSummary(ctx);

    expect(summary).toContain('Run ID: test-run-001');
    expect(summary).toContain('Bead: pv-test-1');
    expect(summary).toContain('PR: https://github.com/pull/42');
    expect(summary).toContain('Beads Touched: pv-test-1');
    expect(summary).toContain('Status: completed');
    expect(summary).toContain('Total Duration: 300ms');
  });

  it('should list phases in execution order', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub, {
      phaseHistory: [
        { phase: PhaseName.Preflight, ok: true, durationMs: 50 },
        { phase: PhaseName.Select, ok: true, durationMs: 50 },
        { phase: PhaseName.PR, ok: true, durationMs: 50 },
      ] as PhaseResult[],
    });

    const summary = buildSummary(ctx);

    expect(summary).toContain(
      `Phases Executed: ${PhaseName.Preflight} \u2192 ${PhaseName.Select} \u2192 ${PhaseName.PR}`,
    );
  });

  it('should report multiple beads touched', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub, {
      beadsClosed: ['pv-epic-1', 'pv-epic-1.1', 'pv-epic-1.2'],
      phaseHistory: [],
    });

    const summary = buildSummary(ctx);

    expect(summary).toContain('Beads Touched: pv-epic-1, pv-epic-1.1, pv-epic-1.2');
  });

  it('should show errors when phases failed', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub, {
      phaseHistory: [
        { phase: PhaseName.Preflight, ok: true, durationMs: 50 },
        { phase: PhaseName.Select, ok: false, durationMs: 100, error: 'bd not found' },
      ] as PhaseResult[],
    });

    const summary = buildSummary(ctx);

    expect(summary).toContain('Status: completed with errors');
    expect(summary).toContain('Errors:');
    expect(summary).toContain(`${PhaseName.Select}: bd not found`);
  });

  it('should show (none) for missing PR URL', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub, { phaseHistory: [] });

    const summary = buildSummary(ctx);

    expect(summary).toContain('PR: (none)');
  });

  it('should fall back to beadId if beadsClosed is not set', () => {
    const logStub = stubLogger();
    const ctx = makeCtx(logStub, {
      beadId: 'pv-fallback-1',
      phaseHistory: [],
    });

    const summary = buildSummary(ctx);

    expect(summary).toContain('Beads Touched: pv-fallback-1');
  });
});

// ---------------------------------------------------------------------------
// runReport — phase runner
// ---------------------------------------------------------------------------

describe('runReport', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
    vi.restoreAllMocks();
  });

  it('should always return halt', async () => {
    const ctx = makeCtx(logStub, {
      prUrl: 'https://github.com/pull/1',
      beadsClosed: ['pv-test-1'],
      phaseHistory: [
        { phase: PhaseName.Preflight, ok: true, durationMs: 100 },
      ] as PhaseResult[],
    });

    const result = await runReport(ctx);

    expect(result.next).toBe('halt');
  });

  it('should log run_summary to run.json', async () => {
    const ctx = makeCtx(logStub, {
      prUrl: 'https://github.com/pull/42',
      beadsClosed: ['pv-test-1', 'pv-test-2'],
      phaseHistory: [
        { phase: PhaseName.Preflight, ok: true, durationMs: 100 },
        { phase: PhaseName.PR, ok: true, durationMs: 200 },
      ] as PhaseResult[],
    });

    await runReport(ctx);

    const summaryEntry = logStub.runJsonEntries.find(e => e.event === 'run_summary');
    expect(summaryEntry).toBeDefined();
    expect(summaryEntry!.runId).toBe('test-run-001');
    expect(summaryEntry!.prUrl).toBe('https://github.com/pull/42');
    expect(summaryEntry!.beadsClosed).toEqual(['pv-test-1', 'pv-test-2']);
    expect(summaryEntry!.phasesExecuted).toEqual([PhaseName.Preflight, PhaseName.PR]);
    expect(summaryEntry!.totalDurationMs).toBe(300);
  });

  it('should log errors array when phases failed', async () => {
    const ctx = makeCtx(logStub, {
      phaseHistory: [
        { phase: PhaseName.Preflight, ok: false, durationMs: 50, error: 'dirty tree' },
      ] as PhaseResult[],
    });

    await runReport(ctx);

    const summaryEntry = logStub.runJsonEntries.find(e => e.event === 'run_summary');
    expect(summaryEntry!.errors).toEqual([
      { phase: PhaseName.Preflight, error: 'dirty tree' },
    ]);
  });

  it('should print summary to stdout', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const ctx = makeCtx(logStub, {
      prUrl: 'https://github.com/pull/1',
      phaseHistory: [],
    });

    await runReport(ctx);

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('=== Process Backlog Run Summary ===');

    consoleSpy.mockRestore();
  });
});
