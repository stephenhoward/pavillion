/**
 * Integration test: Leaf happy path.
 *
 * Walks the full state machine for a single leaf bead from preflight
 * through PR and report:
 *
 *   preflight -> select -> state(shaped) -> shapeAdvisors(skip, no hints)
 *   -> decompose(no decompose) -> analyze(leaf, skip) -> branch
 *   -> leaf(implementer ok, audit pass) -> PR -> report -> halt
 *
 * All script and dispatch calls are mocked via ScriptRouter and
 * DispatchRouter. No real I/O occurs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PhaseName } from '../../lib/types.js';
import { runStateMachine, type OrchestratorCtx } from '../../process-backlog.js';
import {
  preflight,
  select,
  assessState,
  shapeAdvisors,
  decompose,
  analyze,
  branch,
  type PhaseCtx as PhasesCtx,
  type PhaseDeps,
} from '../../lib/phases.js';
import { runPR, type PhaseRunner, type ExecuteDeps } from '../../lib/execute.js';
import {
  makeCtx,
  ScriptRouter,
  DispatchRouter,
} from './helpers.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

function fixture(path: string): string {
  return readFileSync(join(FIXTURES, path), 'utf-8');
}

describe('Integration: leaf happy path', () => {
  let scripts: ScriptRouter;
  let dispatches: DispatchRouter;
  let ctx: OrchestratorCtx;

  beforeEach(() => {
    scripts = new ScriptRouter();
    dispatches = new DispatchRouter();
    ctx = makeCtx();

    // Suppress console output during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    // --- Script routes ---

    // Preflight scripts
    scripts.onFixture('preflight.sh', 'sh/preflight-ok.json');
    scripts.on('git-safe-to-start.sh', () => ({
      exitCode: 0, stdout: '', stderr: '',
    }));

    // Select: bd-top-ready.sh returns a leaf bead
    scripts.onFixture('bd-top-ready.sh', 'sh/bd-top-ready-leaf.json');

    // State: bd-state.sh returns shaped leaf
    scripts.onFixture('bd-state.sh', 'sh/bd-state-shaped-leaf.json');

    // Decompose: bd-sizing-check.sh says no decomposition
    scripts.onFixture('bd-sizing-check.sh', 'sh/bd-sizing-no-decompose.json');

    // Branch: branch-name.sh returns branch name
    scripts.on('branch-name.sh', () => ({
      exitCode: 0, stdout: 'feat/pv-test-1', stderr: '',
    }));

    // Branch: git branch --show-current returns main (then feat/pv-test-1 after checkout)
    let branchCallCount = 0;
    scripts.on('git', (args) => {
      if (args.includes('--show-current')) {
        branchCallCount++;
        // First call in branch phase: on main
        // Second call in PR phase: on feature branch
        return {
          exitCode: 0,
          stdout: branchCallCount <= 1 ? 'main' : 'feat/pv-test-1',
          stderr: '',
        };
      }
      if (args.includes('checkout')) {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (args.includes('push')) {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    // Branch: bd show --json for routing
    scripts.on('bd', (args) => {
      if (args.includes('--json')) {
        return {
          exitCode: 0,
          stdout: fixture('sh/bd-show-leaf-closed.json'),
          stderr: '',
        };
      }
      if (args.includes('show')) {
        return {
          exitCode: 0,
          stdout: 'DESCRIPTION\nSome leaf bead\nNOTES\nImplementation Context\n',
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    // Match agents: returns empty (no advisors/auditors matched)
    scripts.on('match-agents.sh', () => ({
      exitCode: 0, stdout: '[]', stderr: '',
    }));

    // Enrichment check: enriched
    scripts.on('bd-enrichment-check.sh', () => ({
      exitCode: 0, stdout: '', stderr: '',
    }));

    // PR scripts
    scripts.on('pr-body.sh', () => ({
      exitCode: 0, stdout: '## PR body\n\nAutomated PR', stderr: '',
    }));
    scripts.on('commit-msg.sh', () => ({
      exitCode: 0, stdout: 'feat(calendar): implement widget feature (pv-test.1)', stderr: '',
    }));
    scripts.on('gh', () => ({
      exitCode: 0, stdout: 'https://github.com/org/repo/pull/42', stderr: '',
    }));

    // --- Dispatch routes ---
    // Implementer returns empty (success = no error thrown)
    dispatches.on('implementer', () => ({}));
  });

  function buildRegistry(
    spawnFn: ReturnType<ScriptRouter['toSpawnFn']>,
    existsFn: ReturnType<ScriptRouter['toExistsFn']>,
    dispatchFn: ReturnType<DispatchRouter['toDispatchFn']>,
  ): Record<string, PhaseRunner> {
    // PhaseDeps uses spawnFn + existsFn (spawnSync-based)
    const phaseDeps: PhaseDeps = {
      spawnFn: spawnFn as never,
      existsFn,
      dispatchFn: dispatchFn as never,
    };

    // ExecuteDeps uses scriptSpawnFn + scriptExistsFn (spawnSync-based)
    const execDeps: ExecuteDeps = {
      scriptSpawnFn: spawnFn as never,
      scriptExistsFn: existsFn,
    };

    return {
      [PhaseName.Preflight]: async (c) => preflight(c as PhasesCtx, phaseDeps),
      [PhaseName.Select]: async (c) => select(c as PhasesCtx, phaseDeps),
      [PhaseName.State]: async (c) => assessState(c as PhasesCtx, phaseDeps),
      [PhaseName.ShapeAdvisors]: async (c) => shapeAdvisors(c as PhasesCtx, phaseDeps),
      [PhaseName.Decompose]: async (c) => decompose(c as PhasesCtx, phaseDeps),
      [PhaseName.Analyze]: async (c) => analyze(c as PhasesCtx, phaseDeps),
      [PhaseName.Branch]: async (c) => branch(c as PhasesCtx, phaseDeps),
      [PhaseName.Leaf]: async (c) => {
        // Simulate successful leaf execution: implementer + audit pass
        await dispatchFn({ agent: 'implementer', prompt: `implement ${c.beadId}` });
        return { next: PhaseName.PR, ctx: c };
      },
      [PhaseName.PR]: async (c) => runPR(c as never, execDeps),
      [PhaseName.Report]: async (c) => {
        // Report phase is absorbed into process-backlog.ts for production runs.
        // In integration tests, just halt cleanly.
        return { next: 'halt' as const, ctx: c };
      },
    };
  }

  it('should walk the full leaf happy path from preflight to report', async () => {
    const spawnFn = scripts.toSpawnFn();
    const existsFn = scripts.toExistsFn();
    const dispatchFn = dispatches.toDispatchFn();

    const registry = buildRegistry(spawnFn, existsFn, dispatchFn);
    const result = await runStateMachine(ctx, PhaseName.Preflight, registry);

    // Verify the full phase chain executed
    const phases = result.phaseHistory.map((p) => p.phase);
    expect(phases).toEqual([
      PhaseName.Preflight,
      PhaseName.Select,
      PhaseName.State,
      PhaseName.ShapeAdvisors,
      PhaseName.Decompose,
      PhaseName.Analyze,
      PhaseName.Branch,
      PhaseName.Leaf,
      PhaseName.PR,
      PhaseName.Report,
    ]);

    // All phases succeeded
    expect(result.phaseHistory.every((p) => p.ok)).toBe(true);

    // Bead was selected
    expect(result.beadId).toBe('pv-test.1');

    // PR URL was set
    expect(result.prUrl).toBe('https://github.com/org/repo/pull/42');

    // Implementer was dispatched
    expect(dispatches.calls.some((c) => c.agent === 'implementer')).toBe(true);

    // Scripts were called
    expect(scripts.calls.some((c) => c.cmd.includes('preflight.sh'))).toBe(true);
    expect(scripts.calls.some((c) => c.cmd.includes('bd-top-ready.sh'))).toBe(true);
    expect(scripts.calls.some((c) => c.cmd.includes('bd-state.sh'))).toBe(true);
    expect(scripts.calls.some((c) => c.cmd.includes('gh'))).toBe(true);
  });

  it('should complete in under 500ms (all I/O mocked)', async () => {
    const spawnFn = scripts.toSpawnFn();
    const existsFn = scripts.toExistsFn();
    const dispatchFn = dispatches.toDispatchFn();

    const registry = buildRegistry(spawnFn, existsFn, dispatchFn);

    const start = Date.now();
    await runStateMachine(ctx, PhaseName.Preflight, registry);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
  });
});
