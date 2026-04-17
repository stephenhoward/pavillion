import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhaseName, type RunLogger } from '../../lib/context.js';
import {
  runStateMachine,
  type OrchestratorContext,
  type PhaseRunner,
} from '../../process-backlog.js';

/**
 * Build a stub logger that captures calls for assertions.
 */
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

function makeCtx(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    runId: 'test-run-001',
    beadId: '',
    logger: stubLogger(),
    phaseHistory: [],
    dryRun: false,
    ...overrides,
  };
}

describe('runStateMachine', () => {
  it('should halt immediately when the first phase returns halt', async () => {
    const registry = {
      [PhaseName.Preflight]: async () => ({
        run: async (ctx: OrchestratorContext) => ({ next: 'halt' as const, ctx }),
      }),
    };

    const ctx = makeCtx();
    const result = await runStateMachine(ctx, PhaseName.Preflight, registry);

    expect(result.phaseHistory).toHaveLength(1);
    expect(result.phaseHistory[0].phase).toBe(PhaseName.Preflight);
    expect(result.phaseHistory[0].ok).toBe(true);
  });

  it('should chain phases until halt', async () => {
    const registry = {
      [PhaseName.Preflight]: async () => ({
        run: async (ctx: OrchestratorContext) => ({ next: PhaseName.Select, ctx }),
      }),
      [PhaseName.Select]: async () => ({
        run: async (ctx: OrchestratorContext) => ({ next: PhaseName.State, ctx }),
      }),
      [PhaseName.State]: async () => ({
        run: async (ctx: OrchestratorContext) => ({ next: 'halt' as const, ctx }),
      }),
    };

    const ctx = makeCtx();
    const result = await runStateMachine(ctx, PhaseName.Preflight, registry);

    expect(result.phaseHistory).toHaveLength(3);
    expect(result.phaseHistory.map((p) => p.phase)).toEqual([
      PhaseName.Preflight,
      PhaseName.Select,
      PhaseName.State,
    ]);
    expect(result.phaseHistory.every((p) => p.ok)).toBe(true);
  });

  it('should propagate errors from a phase and record in history', async () => {
    const registry = {
      [PhaseName.Preflight]: async () => ({
        run: async () => { throw new Error('preflight boom'); },
      }),
    };

    const ctx = makeCtx();
    await expect(runStateMachine(ctx, PhaseName.Preflight, registry))
      .rejects.toThrow('preflight boom');

    expect(ctx.phaseHistory).toHaveLength(1);
    expect(ctx.phaseHistory[0].ok).toBe(false);
    expect(ctx.phaseHistory[0].error).toBe('preflight boom');
  });

  it('should halt on unknown phase', async () => {
    const registry = {
      [PhaseName.Preflight]: async () => ({
        run: async (ctx: OrchestratorContext) => ({
          next: 'phase-999-unknown' as PhaseName,
          ctx,
        }),
      }),
    };

    const logger = stubLogger();
    const ctx = makeCtx({ logger });
    const result = await runStateMachine(ctx, PhaseName.Preflight, registry);

    // Preflight ran, then unknown phase caused halt
    expect(result.phaseHistory).toHaveLength(1);
    expect(logger.runJsonEntries.some((e) => e.event === 'unknown_phase')).toBe(true);
  });

  it('should pass dryRun flag through context', async () => {
    let capturedDryRun = false;

    const registry = {
      [PhaseName.Preflight]: async () => ({
        run: async (ctx: OrchestratorContext) => {
          capturedDryRun = ctx.dryRun;
          return { next: 'halt' as const, ctx };
        },
      }),
    };

    const ctx = makeCtx({ dryRun: true });
    await runStateMachine(ctx, PhaseName.Preflight, registry);

    expect(capturedDryRun).toBe(true);
  });

  it('should record phase durations in phaseHistory', async () => {
    const registry = {
      [PhaseName.Preflight]: async () => ({
        run: async (ctx: OrchestratorContext) => {
          // Simulate a tiny delay
          await new Promise((r) => setTimeout(r, 5));
          return { next: 'halt' as const, ctx };
        },
      }),
    };

    const ctx = makeCtx();
    const result = await runStateMachine(ctx, PhaseName.Preflight, registry);

    expect(result.phaseHistory[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should log phase_complete events to run.json', async () => {
    const registry = {
      [PhaseName.Preflight]: async () => ({
        run: async (ctx: OrchestratorContext) => ({ next: 'halt' as const, ctx }),
      }),
    };

    const logger = stubLogger();
    const ctx = makeCtx({ logger });
    await runStateMachine(ctx, PhaseName.Preflight, registry);

    const completeEntry = logger.runJsonEntries.find((e) => e.event === 'phase_complete');
    expect(completeEntry).toBeDefined();
    expect(completeEntry!.phase).toBe(PhaseName.Preflight);
    expect(completeEntry!.next).toBe('halt');
  });

  it('should allow context mutation across phases', async () => {
    const registry = {
      [PhaseName.Preflight]: async () => ({
        run: async (ctx: OrchestratorContext) => {
          return { next: PhaseName.Select, ctx: { ...ctx, beadId: 'pv-abc' } };
        },
      }),
      [PhaseName.Select]: async () => ({
        run: async (ctx: OrchestratorContext) => {
          return { next: 'halt' as const, ctx };
        },
      }),
    };

    const ctx = makeCtx();
    const result = await runStateMachine(ctx, PhaseName.Preflight, registry);

    expect(result.beadId).toBe('pv-abc');
  });
});
