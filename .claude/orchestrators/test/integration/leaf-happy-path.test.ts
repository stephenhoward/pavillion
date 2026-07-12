/**
 * Integration test: Leaf happy path.
 *
 * Walks the full state machine for a single leaf bead from preflight
 * through PR and report:
 *
 *   preflight -> select -> state(shaped) -> shapeAdvisors(skip, no agents on disk)
 *   -> decompose(no decompose) -> analyze(leaf, skip) -> branch
 *   -> leaf(implementer ok, audit pass) -> PR -> report -> halt
 *
 * All git and bd calls are mocked via ScriptRouter. No real I/O occurs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

// ---------------------------------------------------------------------------
// Bead text helpers for classifyBeadState()
// ---------------------------------------------------------------------------

/** Text that classifyBeadState() reads as 'shaped' */
function shapedBeadText(): string {
  return [
    'OPEN pv-test.1 Implement widget feature',
    'DESCRIPTION',
    'Implement a calendar widget.',
    'DESIGN',
    'Add widget component to src/client/components.',
    'ACCEPTANCE CRITERIA',
    'Widget renders correctly.',
  ].join('\n');
}

/** Text that bdEnrichmentCheck() reads as enriched */
function enrichedBeadText(): string {
  return shapedBeadText() + '\nNOTES\nImplementation Context\nSome context.\n';
}

// ---------------------------------------------------------------------------
// Branch name that branchName() would derive for 'task' + title
// ---------------------------------------------------------------------------
// branchName('Implement widget feature', 'task')
// → prefix='chore', kebab='implement-widget-feature'
// → 'chore.implement-widget-feature'
const EXPECTED_BRANCH = 'chore.implement-widget-feature';

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

    // ---------------------------------------------------------------------------
    // Unified git handler
    // Covers all git calls across all phases.
    // ---------------------------------------------------------------------------
    scripts.on('git', (args) => {
      const a = args.join(' ');

      // gitSafeToStart + preflight status checks
      if (a.includes('status --porcelain')) return { exitCode: 0, stdout: '', stderr: '' };
      // gitSafeToStart inside-repo check
      if (a.includes('rev-parse --is-inside-work-tree')) return { exitCode: 0, stdout: 'true', stderr: '' };
      // preflight + gitSafeToStart "current with main" check: HEAD == origin/main
      if (a.includes('rev-parse HEAD') || a.includes('rev-parse origin/')) {
        return { exitCode: 0, stdout: 'abc1234567890abcdef', stderr: '' };
      }
      // branch phase: branch --show-current — main triggers checkout
      if (a.includes('branch --show-current')) {
        return { exitCode: 0, stdout: 'main', stderr: '' };
      }
      // preflight fetch
      if (a.includes('fetch origin')) return { exitCode: 0, stdout: '', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    // ---------------------------------------------------------------------------
    // Unified gt handler
    // Covers the preflight Graphite probes (gt --version, gt auth, gt trunk),
    // the branch phase's gt create, and the PR phase's gt submit.
    // ---------------------------------------------------------------------------
    scripts.on('gt', (args) => {
      const a = args.join(' ');
      if (a.includes('--version')) return { exitCode: 0, stdout: '1.8.6', stderr: '' };
      if (a.includes('auth')) return { exitCode: 0, stdout: 'Authenticated as: testuser', stderr: '' };
      if (a.includes('trunk')) return { exitCode: 0, stdout: 'main', stderr: '' };
      if (a.includes('create')) return { exitCode: 0, stdout: '', stderr: '' };
      if (a.includes('submit')) return { exitCode: 0, stdout: '✅ Submitted.', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    // ---------------------------------------------------------------------------
    // Unified bd handler
    // Covers all bd calls across all phases.
    // ---------------------------------------------------------------------------
    scripts.on('bd', (args) => {
      const a = args.join(' ');

      // preflight backlog check: bd ready --limit=50 --json
      if (a.includes('ready') && a.includes('50')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ id: 'pv-test.1', issue_type: 'task', priority: 1 }]),
          stderr: '',
        };
      }
      // select: bd ready --limit=5 --json
      if (a.includes('ready') && a.includes('5')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ id: 'pv-test.1', issue_type: 'task', priority: 1, created_at: '2026-04-01' }]),
          stderr: '',
        };
      }
      // label list (needs-human check): return no needs-human
      if (a.includes('label list')) {
        return { exitCode: 0, stdout: '- other-label', stderr: '' };
      }
      // bd show --json: used in branch phase for title+type, and by PR phase
      if (a.includes('show') && a.includes('--json')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{
            id: 'pv-test.1',
            title: 'Implement widget feature',
            issue_type: 'task',
            status: 'closed',
            description: 'Implement a calendar widget.',
            notes: '',
          }]),
          stderr: '',
        };
      }
      // bd show (text): used by bdState, bdSizingCheck, bdEnrichmentCheck
      // Use shapedBeadText so assessState returns 'shaped' and sizing says no-decompose.
      // analyze() reads parent-child dependents via bd show --json (handled above with
      // no dependents field), so the leaf path is taken and enrichment check is skipped.
      if (a.includes('show')) {
        return { exitCode: 0, stdout: shapedBeadText(), stderr: '' };
      }
      // bd label add (bdEscalate)
      if (a.includes('label add')) return { exitCode: 0, stdout: '', stderr: '' };
      // bd update (bdEscalate append-notes)
      if (a.includes('update')) return { exitCode: 0, stdout: '', stderr: '' };

      return { exitCode: 0, stdout: '', stderr: '' };
    });

    // ---------------------------------------------------------------------------
    // gh handler (for PR phase): pr view resolves number/url, pr edit succeeds
    // ---------------------------------------------------------------------------
    scripts.on('gh', (args) => {
      const a = args.join(' ');
      if (a.includes('view')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ number: 42, url: 'https://github.com/org/repo/pull/42' }),
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    // --- Dispatch routes ---
    // Implementer returns empty (success = no error thrown)
    dispatches.on('implementer', () => ({}));
  });

  function buildRegistry(
    spawnFn: ReturnType<ScriptRouter['toSpawnFn']>,
    dispatchFn: ReturnType<DispatchRouter['toDispatchFn']>,
  ): Record<string, PhaseRunner> {
    const phaseDeps: PhaseDeps = {
      spawnFn: spawnFn as never,
      dispatchFn: dispatchFn as never,
      // Stub advisor selection for integration tests: return a single
      // advisor so the advisor fan-out runs, then use fanOutFn to produce
      // a clean verdict. This exercises the phase transition without
      // requiring real agent files on disk or a real selector dispatch.
      selectAdvisorsFn: async () => [{
        name: 'test-advisor',
        path: '.claude/agents/test-advisor.md',
        description: 'integration stub',
        rationale: 'test',
      }],
      fanOutFn: async (advisors, beadId, _ctx, phase) => ({
        beadId,
        phase,
        advisors: advisors.map(a => ({
          agent: a.name,
          verdict: 'clean' as const,
          concerns: [],
          recommendations: [],
        })),
        overallVerdict: 'clean' as const,
        summary: 'integration stub: all clean',
      }),
    };

    // ExecuteDeps uses scriptSpawnFn + scriptExistsFn (spawnSync-based)
    const execDeps: ExecuteDeps = {
      scriptSpawnFn: spawnFn as never,
      scriptExistsFn: () => true,
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
    const dispatchFn = dispatches.toDispatchFn();

    const registry = buildRegistry(spawnFn, dispatchFn);
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

    // git and bd commands were called
    expect(scripts.calls.some((c) => c.cmd === 'git')).toBe(true);
    expect(scripts.calls.some((c) => c.cmd === 'bd')).toBe(true);
    expect(scripts.calls.some((c) => c.cmd === 'gh')).toBe(true);
  });

  it('should complete in under 500ms (all I/O mocked)', async () => {
    const spawnFn = scripts.toSpawnFn();
    const dispatchFn = dispatches.toDispatchFn();

    const registry = buildRegistry(spawnFn, dispatchFn);

    const start = Date.now();
    await runStateMachine(ctx, PhaseName.Preflight, registry);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
  });
});
