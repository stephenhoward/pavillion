/**
 * Tests for the simplified process-backlog.ts:
 *   - runStateMachine: state machine loop behaviour
 *   - buildSummary: summary assembly (absorbed from phase-9-report.ts)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhaseName, type RunLogger, type PhaseResult } from '../../lib/types.js';
import {
  runStateMachine,
  buildSummary,
  classifyVerdict,
  type OrchestratorCtx,
} from '../../process-backlog.js';
import type { PhaseRunner } from '../../lib/execute.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubLogger(): RunLogger & { runJsonEntries: Record<string, unknown>[] } {
  const runJsonEntries: Record<string, unknown>[] = [];
  return {
    writePhaseLog: vi.fn(),
    appendRunJson(entry: Record<string, unknown>) {
      runJsonEntries.push(entry);
    },
    runDir: () => '/tmp/fake-run-dir',
    runJsonEntries,
  };
}

function makeCtx(overrides: Partial<OrchestratorCtx> = {}): OrchestratorCtx {
  return {
    runId: 'test-run-001',
    beadId: '',
    logger: stubLogger(),
    phaseHistory: [],
    dryRun: false,
    ...overrides,
  };
}

/** Build a minimal PhaseRunner that returns halt immediately. */
function haltRunner(): PhaseRunner {
  return async (ctx) => ({ next: 'halt', ctx: ctx as OrchestratorCtx });
}

/** Build a PhaseRunner that returns the given next phase. */
function nextRunner(next: PhaseName | 'halt'): PhaseRunner {
  return async (ctx) => ({ next, ctx: ctx as OrchestratorCtx });
}

// ---------------------------------------------------------------------------
// runStateMachine
// ---------------------------------------------------------------------------

describe('runStateMachine', () => {
  it('halts immediately when the first phase returns halt', async () => {
    const registry = {
      [PhaseName.Preflight]: haltRunner(),
    };

    const ctx = makeCtx();
    const result = await runStateMachine(ctx, PhaseName.Preflight, registry as Record<string, PhaseRunner>);

    expect(result.phaseHistory).toHaveLength(1);
    expect(result.phaseHistory[0].phase).toBe(PhaseName.Preflight);
    expect(result.phaseHistory[0].ok).toBe(true);
  });

  it('chains phases until halt', async () => {
    const registry = {
      [PhaseName.Preflight]: nextRunner(PhaseName.Select),
      [PhaseName.Select]:    nextRunner(PhaseName.State),
      [PhaseName.State]:     haltRunner(),
    };

    const ctx = makeCtx();
    const result = await runStateMachine(ctx, PhaseName.Preflight, registry as Record<string, PhaseRunner>);

    expect(result.phaseHistory).toHaveLength(3);
    expect(result.phaseHistory.map((p) => p.phase)).toEqual([
      PhaseName.Preflight,
      PhaseName.Select,
      PhaseName.State,
    ]);
    expect(result.phaseHistory.every((p) => p.ok)).toBe(true);
  });

  it('halts on unknown phase and logs unknown_phase event', async () => {
    const registry = {
      [PhaseName.Preflight]: async (ctx: OrchestratorCtx) => ({
        next: 'phase-999-unknown' as PhaseName,
        ctx,
      }),
    };

    const logger = stubLogger();
    const ctx = makeCtx({ logger });
    const result = await runStateMachine(
      ctx,
      PhaseName.Preflight,
      registry as Record<string, PhaseRunner>,
    );

    // Preflight ran, then unknown phase caused halt — no second entry
    expect(result.phaseHistory).toHaveLength(1);
    expect(logger.runJsonEntries.some((e) => e.event === 'unknown_phase')).toBe(true);
  });

  it('records phase error in history and rethrows', async () => {
    const registry = {
      [PhaseName.Preflight]: async () => {
        throw new Error('preflight boom');
      },
    };

    const ctx = makeCtx();
    await expect(
      runStateMachine(ctx, PhaseName.Preflight, registry as Record<string, PhaseRunner>),
    ).rejects.toThrow('preflight boom');

    expect(ctx.phaseHistory).toHaveLength(1);
    expect(ctx.phaseHistory[0].ok).toBe(false);
    expect(ctx.phaseHistory[0].error).toBe('preflight boom');
  });

  it('logs phase_complete event for each successful phase', async () => {
    const registry = {
      [PhaseName.Preflight]: haltRunner(),
    };

    const logger = stubLogger();
    const ctx = makeCtx({ logger });
    await runStateMachine(ctx, PhaseName.Preflight, registry as Record<string, PhaseRunner>);

    const completeEntry = logger.runJsonEntries.find((e) => e.event === 'phase_complete');
    expect(completeEntry).toBeDefined();
    expect(completeEntry!.phase).toBe(PhaseName.Preflight);
    expect(completeEntry!.next).toBe('halt');
  });

  it('passes dryRun flag through context', async () => {
    let capturedDryRun: boolean | undefined;

    const registry = {
      [PhaseName.Preflight]: async (ctx: OrchestratorCtx) => {
        capturedDryRun = ctx.dryRun;
        return { next: 'halt' as const, ctx };
      },
    };

    const ctx = makeCtx({ dryRun: true });
    await runStateMachine(ctx, PhaseName.Preflight, registry as Record<string, PhaseRunner>);

    expect(capturedDryRun).toBe(true);
  });

  it('allows context mutation across phases (beadId)', async () => {
    const registry = {
      [PhaseName.Preflight]: async (ctx: OrchestratorCtx) => ({
        next: PhaseName.Select,
        ctx: { ...ctx, beadId: 'pv-abc' } as OrchestratorCtx,
      }),
      [PhaseName.Select]: haltRunner(),
    };

    const ctx = makeCtx();
    const result = await runStateMachine(
      ctx,
      PhaseName.Preflight,
      registry as Record<string, PhaseRunner>,
    );

    expect(result.beadId).toBe('pv-abc');
  });

  it('records durationMs for each phase', async () => {
    const registry = {
      [PhaseName.Preflight]: async (ctx: OrchestratorCtx) => {
        await new Promise((r) => setTimeout(r, 5));
        return { next: 'halt' as const, ctx };
      },
    };

    const ctx = makeCtx();
    const result = await runStateMachine(
      ctx,
      PhaseName.Preflight,
      registry as Record<string, PhaseRunner>,
    );

    expect(result.phaseHistory[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// buildSummary
// ---------------------------------------------------------------------------

describe('buildSummary', () => {
  it('includes run ID, bead ID, PR URL, and status', () => {
    const ctx = makeCtx({
      beadId: 'pv-test-1',
      prUrl: 'https://github.com/pull/42',
      beadsClosed: ['pv-test-1'],
      phaseHistory: [
        { phase: PhaseName.Preflight, ok: true, durationMs: 100 },
        { phase: PhaseName.Select,    ok: true, durationMs: 200 },
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

  it('lists phases in execution order with arrows', () => {
    const ctx = makeCtx({
      beadId: 'pv-test-1',
      phaseHistory: [
        { phase: PhaseName.Preflight, ok: true, durationMs: 50 },
        { phase: PhaseName.Select,    ok: true, durationMs: 50 },
        { phase: PhaseName.PR,        ok: true, durationMs: 50 },
      ] as PhaseResult[],
    });

    const summary = buildSummary(ctx);

    expect(summary).toContain(
      `Phases Executed: ${PhaseName.Preflight} \u2192 ${PhaseName.Select} \u2192 ${PhaseName.PR}`,
    );
  });

  it('reports multiple beads touched', () => {
    const ctx = makeCtx({
      beadsClosed: ['pv-epic-1', 'pv-epic-1.1', 'pv-epic-1.2'],
      phaseHistory: [],
    });

    const summary = buildSummary(ctx);

    expect(summary).toContain('Beads Touched: pv-epic-1, pv-epic-1.1, pv-epic-1.2');
  });

  it('shows errors when phases failed', () => {
    const ctx = makeCtx({
      phaseHistory: [
        { phase: PhaseName.Preflight, ok: true,  durationMs: 50 },
        { phase: PhaseName.Select,    ok: false, durationMs: 100, error: 'bd not found' },
      ] as PhaseResult[],
    });

    const summary = buildSummary(ctx);

    expect(summary).toContain('Status: completed with errors');
    expect(summary).toContain('Errors:');
    expect(summary).toContain(`${PhaseName.Select}: bd not found`);
  });

  it('shows (none) for missing PR URL', () => {
    const ctx = makeCtx({ phaseHistory: [] });

    const summary = buildSummary(ctx);

    expect(summary).toContain('PR: (none)');
  });

  it('falls back to beadId when beadsClosed is not set', () => {
    const ctx = makeCtx({
      beadId: 'pv-fallback-1',
      phaseHistory: [],
    });

    const summary = buildSummary(ctx);

    expect(summary).toContain('Beads Touched: pv-fallback-1');
  });

  it('shows (none) for beads touched when beadId is empty and beadsClosed not set', () => {
    const ctx = makeCtx({
      beadId: '',
      phaseHistory: [],
    });

    const summary = buildSummary(ctx);

    expect(summary).toContain('Beads Touched: (none)');
  });

  it('includes header and footer markers', () => {
    const ctx = makeCtx({ phaseHistory: [] });
    const summary = buildSummary(ctx);

    expect(summary).toContain('=== Process Backlog Run Summary ===');
    expect(summary).toContain('===================================');
  });

  it('includes the verdict line', () => {
    const ctx = makeCtx({
      beadId: 'pv-1',
      prUrl: 'https://github.com/pull/1',
      phaseHistory: [],
    });
    expect(buildSummary(ctx)).toContain('Verdict: completed');
  });
});

// ---------------------------------------------------------------------------
// classifyVerdict
// ---------------------------------------------------------------------------

describe('classifyVerdict', () => {
  it('returns completed when PR was opened', () => {
    const ctx = makeCtx({
      prUrl: 'https://github.com/pull/42',
      phaseHistory: [],
    });
    expect(classifyVerdict(ctx)).toBe('completed');
  });

  it('returns transient_halt when a phase failed with a timeout', () => {
    const ctx = makeCtx({
      phaseHistory: [
        { phase: PhaseName.Shape, ok: false, durationMs: 180000,
          error: 'shape-bead subagent timed out after 180000ms' },
      ] as PhaseResult[],
    });
    expect(classifyVerdict(ctx)).toBe('transient_halt');
  });

  it('returns transient_halt when preflight halts on behind_main', () => {
    const ctx = makeCtx({
      phaseHistory: [
        { phase: PhaseName.Preflight, ok: false, durationMs: 300,
          error: 'behind_main: HEAD is not at origin/main' },
      ] as PhaseResult[],
    });
    expect(classifyVerdict(ctx)).toBe('transient_halt');
  });

  it('returns needs_human for non-transient failures without a PR', () => {
    const ctx = makeCtx({
      phaseHistory: [
        { phase: PhaseName.ShapeAdvisors, ok: false, durationMs: 10000,
          error: 'advisor REQUEST CHANGES after refinement' },
      ] as PhaseResult[],
    });
    expect(classifyVerdict(ctx)).toBe('needs_human');
  });

  it('returns needs_human when there are no failures and no PR', () => {
    const ctx = makeCtx({
      phaseHistory: [
        { phase: PhaseName.Preflight, ok: true, durationMs: 100 },
      ] as PhaseResult[],
    });
    expect(classifyVerdict(ctx)).toBe('needs_human');
  });
});
