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
import { PhaseName } from '../../lib/context.js';
import { runStateMachine, type OrchestratorContext, type PhaseRunner } from '../../process-backlog.js';
import { runPreflight } from '../../lib/phase-0-preflight.js';
import { runSelect } from '../../lib/phase-1-select.js';
import { runState } from '../../lib/phase-2-state.js';
import { runShapeAdvisors } from '../../lib/phase-3.5-advisors.js';
import { runDecompose } from '../../lib/phase-4-decompose.js';
import { runAnalyze } from '../../lib/phase-5-analyze.js';
import { runBranch } from '../../lib/phase-6-branch.js';
import { runPR } from '../../lib/phase-8-pr.js';
import { runReport } from '../../lib/phase-9-report.js';
import {
  makeCtx,
  ScriptRouter,
  DispatchRouter,
  type StubLogger,
} from './helpers.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

function fixture(path: string): string {
  return readFileSync(join(FIXTURES, path), 'utf-8');
}

describe('Integration: leaf happy path', () => {
  let scripts: ScriptRouter;
  let dispatches: DispatchRouter;
  let ctx: OrchestratorContext;

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

  it('should walk the full leaf happy path from preflight to report', async () => {
    const spawnFn = scripts.toSpawnFn();
    const existsFn = scripts.toExistsFn();
    const dispatchFn = dispatches.toDispatchFn();

    const scriptOpts = { spawnFn, existsFn };

    type PhaseLoader = () => Promise<{ run: PhaseRunner }>;

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
      [PhaseName.ShapeAdvisors]: async () => ({
        run: async (c) => runShapeAdvisors(c, {
          getFileHintsFn: () => [],
          runScriptOpts: scriptOpts,
        }),
      }),
      [PhaseName.Decompose]: async () => ({
        run: async (c) => runDecompose(c, {
          runScriptOpts: scriptOpts,
          dispatchFn: dispatchFn as never,
        }),
      }),
      [PhaseName.Analyze]: async () => ({
        run: async (c) => runAnalyze(c, {
          runScriptOpts: scriptOpts,
          childIds: [],
        }),
      }),
      [PhaseName.Branch]: async () => ({
        run: async (c) => runBranch(c, { spawnFn }),
      }),
      [PhaseName.Leaf]: async () => ({
        run: async (c) => {
          // Simulate successful leaf execution: implementer + audit pass
          // Then route to PR
          await dispatchFn({ agent: 'implementer', prompt: `implement ${c.beadId}` });
          return { next: PhaseName.PR, ctx: c };
        },
      }),
      [PhaseName.PR]: async () => ({
        run: async (c) => runPR(c, { spawnFn }),
      }),
      [PhaseName.Report]: async () => ({
        run: async (c) => runReport(c as never),
      }),
    };

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
    expect((result as OrchestratorContext & { prUrl?: string }).prUrl)
      .toBe('https://github.com/org/repo/pull/42');

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
    const scriptOpts = { spawnFn, existsFn };

    type PhaseLoader = () => Promise<{ run: PhaseRunner }>;

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
      [PhaseName.ShapeAdvisors]: async () => ({
        run: async (c) => runShapeAdvisors(c, {
          getFileHintsFn: () => [],
          runScriptOpts: scriptOpts,
        }),
      }),
      [PhaseName.Decompose]: async () => ({
        run: async (c) => runDecompose(c, {
          runScriptOpts: scriptOpts,
          dispatchFn: dispatchFn as never,
        }),
      }),
      [PhaseName.Analyze]: async () => ({
        run: async (c) => runAnalyze(c, {
          runScriptOpts: scriptOpts,
          childIds: [],
        }),
      }),
      [PhaseName.Branch]: async () => ({
        run: async (c) => runBranch(c, { spawnFn }),
      }),
      [PhaseName.Leaf]: async () => ({
        run: async (c) => {
          await dispatchFn({ agent: 'implementer', prompt: `implement ${c.beadId}` });
          return { next: PhaseName.PR, ctx: c };
        },
      }),
      [PhaseName.PR]: async () => ({
        run: async (c) => runPR(c, { spawnFn }),
      }),
      [PhaseName.Report]: async () => ({
        run: async (c) => runReport(c as never),
      }),
    };

    const start = Date.now();
    await runStateMachine(ctx, PhaseName.Preflight, registry);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
  });
});
