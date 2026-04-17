/**
 * Integration tests: safeguard scenarios.
 *
 * Covers preflight failure, empty backlog, auto-shape escalation,
 * and advisor REQUEST CHANGES escalation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhaseName } from '../../lib/types.js';
import { runStateMachine, type OrchestratorCtx } from '../../process-backlog.js';
import {
  preflight,
  select,
  assessState,
  shape,
  shapeAdvisors,
  type PhaseCtx as PhasesCtx,
  type PhaseDeps,
} from '../../lib/phases.js';
import { type PhaseRunner } from '../../lib/execute.js';
import {
  makeCtx,
  ScriptRouter,
  DispatchRouter,
} from './helpers.js';

describe('Integration: safeguards', () => {
  let scripts: ScriptRouter;
  let dispatches: DispatchRouter;
  let ctx: OrchestratorCtx;

  beforeEach(() => {
    scripts = new ScriptRouter();
    dispatches = new DispatchRouter();
    ctx = makeCtx();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should halt on dirty tree (preflight failure)', async () => {
    scripts.onFixture('preflight.sh', 'sh/preflight-dirty.json', 1);
    scripts.on('git-safe-to-start.sh', () => ({
      exitCode: 0, stdout: '', stderr: '',
    }));

    const spawnFn = scripts.toSpawnFn();
    const existsFn = scripts.toExistsFn();
    const phaseDeps: PhaseDeps = { spawnFn: spawnFn as never, existsFn };

    const registry: Record<string, PhaseRunner> = {
      [PhaseName.Preflight]: async (c) => preflight(c as PhasesCtx, phaseDeps),
    };

    const result = await runStateMachine(ctx, PhaseName.Preflight, registry);

    expect(result.phaseHistory).toHaveLength(1);
    expect(result.phaseHistory[0].phase).toBe(PhaseName.Preflight);
  });

  it('should halt on empty backlog (exit code 3)', async () => {
    scripts.onFixture('preflight.sh', 'sh/preflight-ok.json');
    scripts.on('git-safe-to-start.sh', () => ({
      exitCode: 0, stdout: '', stderr: '',
    }));
    scripts.on('bd-top-ready.sh', () => ({
      exitCode: 3,
      stdout: '',
      stderr: 'backlog exhausted for automation',
    }));

    const spawnFn = scripts.toSpawnFn();
    const existsFn = scripts.toExistsFn();
    const phaseDeps: PhaseDeps = { spawnFn: spawnFn as never, existsFn };

    const registry: Record<string, PhaseRunner> = {
      [PhaseName.Preflight]: async (c) => preflight(c as PhasesCtx, phaseDeps),
      [PhaseName.Select]: async (c) => select(c as PhasesCtx, phaseDeps),
    };

    const result = await runStateMachine(ctx, PhaseName.Preflight, registry);

    const phases = result.phaseHistory.map((p) => p.phase);
    expect(phases).toEqual([PhaseName.Preflight, PhaseName.Select]);
  });

  it('should halt on auto-shape ESCALATE verdict', async () => {
    scripts.onFixture('preflight.sh', 'sh/preflight-ok.json');
    scripts.on('git-safe-to-start.sh', () => ({
      exitCode: 0, stdout: '', stderr: '',
    }));
    scripts.onFixture('bd-top-ready.sh', 'sh/bd-top-ready-leaf.json');
    scripts.onFixture('bd-state.sh', 'sh/bd-state-unshaped.json');
    scripts.on('bd-escalate.sh', () => ({
      exitCode: 0, stdout: '{}', stderr: '',
    }));

    dispatches.onFixture('shape-bead', 'claude-p/shape-verdict-escalate.json');

    const spawnFn = scripts.toSpawnFn();
    const existsFn = scripts.toExistsFn();
    const dispatchFn = dispatches.toDispatchFn();
    const phaseDeps: PhaseDeps = {
      spawnFn: spawnFn as never,
      existsFn,
      dispatchFn: dispatchFn as never,
    };

    const registry: Record<string, PhaseRunner> = {
      [PhaseName.Preflight]: async (c) => preflight(c as PhasesCtx, phaseDeps),
      [PhaseName.Select]: async (c) => select(c as PhasesCtx, phaseDeps),
      [PhaseName.State]: async (c) => assessState(c as PhasesCtx, phaseDeps),
      [PhaseName.Shape]: async (c) => shape(c as PhasesCtx, phaseDeps),
    };

    const result = await runStateMachine(ctx, PhaseName.Preflight, registry);

    const phases = result.phaseHistory.map((p) => p.phase);
    expect(phases).toContain(PhaseName.Shape);
    expect(dispatches.calls.some((c) => c.agent === 'shape-bead')).toBe(true);
  });

  it('should run --dry-run and stop after phase 2', async () => {
    scripts.onFixture('preflight.sh', 'sh/preflight-ok.json');
    scripts.on('git-safe-to-start.sh', () => ({
      exitCode: 0, stdout: '', stderr: '',
    }));
    scripts.onFixture('bd-top-ready.sh', 'sh/bd-top-ready-leaf.json');
    scripts.onFixture('bd-state.sh', 'sh/bd-state-shaped-leaf.json');

    const spawnFn = scripts.toSpawnFn();
    const existsFn = scripts.toExistsFn();
    const phaseDeps: PhaseDeps = { spawnFn: spawnFn as never, existsFn };

    ctx = makeCtx({ dryRun: true });

    const registry: Record<string, PhaseRunner> = {
      [PhaseName.Preflight]: async (c) => preflight(c as PhasesCtx, phaseDeps),
      [PhaseName.Select]: async (c) => select(c as PhasesCtx, phaseDeps),
      [PhaseName.State]: async (c) => assessState(c as PhasesCtx, phaseDeps),
    };

    const result = await runStateMachine(ctx, PhaseName.Preflight, registry);

    const phases = result.phaseHistory.map((p) => p.phase);
    expect(phases).toEqual([PhaseName.Preflight, PhaseName.Select, PhaseName.State]);
    expect(result.dryRun).toBe(true);
  });
});
