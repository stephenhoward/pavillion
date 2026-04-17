/**
 * Integration tests: safeguard scenarios.
 *
 * Covers preflight failure, empty backlog, auto-shape escalation,
 * and advisor REQUEST CHANGES escalation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhaseName } from '../../lib/context.js';
import { runStateMachine, type OrchestratorContext, type PhaseRunner } from '../../process-backlog.js';
import { runPreflight } from '../../lib/phase-0-preflight.js';
import { runSelect } from '../../lib/phase-1-select.js';
import { runState } from '../../lib/phase-2-state.js';
import { runShape } from '../../lib/phase-3-shape.js';
import { runShapeAdvisors } from '../../lib/phase-3.5-advisors.js';
import {
  makeCtx,
  ScriptRouter,
  DispatchRouter,
} from './helpers.js';

type PhaseLoader = () => Promise<{ run: PhaseRunner }>;

describe('Integration: safeguards', () => {
  let scripts: ScriptRouter;
  let dispatches: DispatchRouter;
  let ctx: OrchestratorContext;

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
    const scriptOpts = { spawnFn, existsFn };

    const registry: Record<string, PhaseLoader> = {
      [PhaseName.Preflight]: async () => ({
        run: async (c) => runPreflight(c, { runScriptOpts: scriptOpts, gitSafeSpawnFn: spawnFn as never }),
      }),
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
    const scriptOpts = { spawnFn, existsFn };

    const registry: Record<string, PhaseLoader> = {
      [PhaseName.Preflight]: async () => ({
        run: async (c) => runPreflight(c, { runScriptOpts: scriptOpts, gitSafeSpawnFn: spawnFn as never }),
      }),
      [PhaseName.Select]: async () => ({
        run: async (c) => runSelect(c, { runScriptOpts: scriptOpts }),
      }),
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
    const scriptOpts = { spawnFn, existsFn };

    const registry: Record<string, PhaseLoader> = {
      [PhaseName.Preflight]: async () => ({
        run: async (c) => runPreflight(c, { runScriptOpts: scriptOpts, gitSafeSpawnFn: spawnFn as never }),
      }),
      [PhaseName.Select]: async () => ({
        run: async (c) => runSelect(c, { runScriptOpts: scriptOpts }),
      }),
      [PhaseName.State]: async () => ({
        run: async (c) => runState(c, { runScriptOpts: scriptOpts }),
      }),
      [PhaseName.Shape]: async () => ({
        run: async (c) => runShape(c, {
          dispatchFn: dispatchFn as never,
          escalateSpawnFn: spawnFn as never,
          stateSpawnFn: spawnFn as never,
        }),
      }),
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
    const scriptOpts = { spawnFn, existsFn };

    ctx = makeCtx({ dryRun: true });

    const registry: Record<string, PhaseLoader> = {
      [PhaseName.Preflight]: async () => ({
        run: async (c) => runPreflight(c, { runScriptOpts: scriptOpts, gitSafeSpawnFn: spawnFn as never }),
      }),
      [PhaseName.Select]: async () => ({
        run: async (c) => runSelect(c, { runScriptOpts: scriptOpts }),
      }),
      [PhaseName.State]: async () => ({
        run: async (c) => runState(c, { runScriptOpts: scriptOpts }),
      }),
    };

    const result = await runStateMachine(ctx, PhaseName.Preflight, registry);

    const phases = result.phaseHistory.map((p) => p.phase);
    expect(phases).toEqual([PhaseName.Preflight, PhaseName.Select, PhaseName.State]);
    expect(result.dryRun).toBe(true);
  });
});
