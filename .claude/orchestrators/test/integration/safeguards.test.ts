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

// ---------------------------------------------------------------------------
// Helpers: shaped bead text (classifyBeadState returns 'shaped')
// ---------------------------------------------------------------------------

function shapedBeadText(): string {
  return [
    'OPEN pv-test-1 A task',
    'DESCRIPTION',
    'This is a real description.',
    'DESIGN',
    'Some design.',
    'ACCEPTANCE CRITERIA',
    'It works.',
  ].join('\n');
}

function unshapedBeadText(): string {
  return 'OPEN pv-test-1 A task\n';
}

/**
 * Mount a full passing preflight on a ScriptRouter.
 *
 * Covers all git/bd calls made by:
 *   - runPreflightCheck(): git status, git fetch, git rev-parse HEAD,
 *                          git rev-parse origin/main, bd ready, bd label list
 *   - gitSafeToStart():    git rev-parse (work tree), git rev-parse HEAD,
 *                          git rev-parse origin/main, git status
 */
function mountPassingPreflight(scripts: ScriptRouter, beadId = 'pv-test.1'): void {
  scripts.on('git', (args) => {
    const argStr = args.join(' ');

    if (argStr.includes('status --porcelain')) {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (argStr.includes('fetch origin')) {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (argStr.includes('rev-parse --is-inside-work-tree')) {
      return { exitCode: 0, stdout: 'true', stderr: '' };
    }
    if (argStr.includes('rev-parse HEAD') || argStr.includes('rev-parse origin/')) {
      // Both HEAD and origin/main return the same SHA → preflight/gitSafe pass
      return { exitCode: 0, stdout: 'abc1234567890abcdef', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  });

  scripts.on('bd', (args) => {
    const argStr = args.join(' ');
    if (argStr.includes('ready')) {
      return {
        exitCode: 0,
        stdout: JSON.stringify([{ id: beadId, issue_type: 'task', priority: 1 }]),
        stderr: '',
      };
    }
    if (argStr.includes('label list')) {
      return { exitCode: 0, stdout: '- other-label', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  });

  mountPassingGhStack(scripts);
}

/**
 * Mount passing gh-stack preflight probes on a ScriptRouter.
 *
 * Covers the gh calls made by runPreflightCheck() (D5: two cheap local
 * hard-gates only): gh stack --version, gh auth status.
 */
function mountPassingGhStack(scripts: ScriptRouter): void {
  scripts.on('gh', (args) => {
    const argStr = args.join(' ');
    if (argStr.includes('stack --version')) {
      return { exitCode: 0, stdout: 'gh stack version 0.0.8', stderr: '' };
    }
    if (argStr.includes('auth status')) {
      return { exitCode: 0, stdout: 'Logged in to github.com as testuser', stderr: '' };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  });
}

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
    // git status --porcelain returns dirty output → preflight halts
    scripts.on('git', (args) => {
      const argStr = args.join(' ');
      if (argStr.includes('status --porcelain')) {
        return { exitCode: 0, stdout: 'M dirty-file', stderr: '' };
      }
      return { exitCode: 0, stdout: 'main', stderr: '' };
    });
    scripts.on('bd', () => ({ exitCode: 0, stdout: '[]', stderr: '' }));

    const spawnFn = scripts.toSpawnFn();
    const phaseDeps: PhaseDeps = { spawnFn: spawnFn as never };

    const registry: Record<string, PhaseRunner> = {
      [PhaseName.Preflight]: async (c) => preflight(c as PhasesCtx, phaseDeps),
    };

    const result = await runStateMachine(ctx, PhaseName.Preflight, registry);

    expect(result.phaseHistory).toHaveLength(1);
    expect(result.phaseHistory[0].phase).toBe(PhaseName.Preflight);
  });

  it('should halt on empty backlog (exhausted)', async () => {
    // Preflight passes, but bdTopReady returns empty list
    let prefCalls = 0;
    mountPassingGhStack(scripts);
    scripts.on('git', (args) => {
      const a = args.join(' ');
      if (a.includes('status --porcelain')) return { exitCode: 0, stdout: '', stderr: '' };
      if (a.includes('branch --show-current')) return { exitCode: 0, stdout: 'main', stderr: '' };
      if (a.includes('fetch origin')) return { exitCode: 0, stdout: '', stderr: '' };
      if (a.includes('diff')) return { exitCode: 0, stdout: '', stderr: '' };
      if (a.includes('rev-parse --is-inside-work-tree')) return { exitCode: 0, stdout: 'true', stderr: '' };
      if (a.includes('rev-parse --abbrev-ref')) return { exitCode: 0, stdout: 'main', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    scripts.on('bd', (args) => {
      const a = args.join(' ');
      if (a.includes('ready') && a.includes('50')) {
        // preflight backlog check: non-empty
        return { exitCode: 0, stdout: JSON.stringify([{ id: 'pv-x' }]), stderr: '' };
      }
      if (a.includes('label list')) {
        return { exitCode: 0, stdout: '- other-label', stderr: '' };
      }
      if (a.includes('ready') && a.includes('5')) {
        // select backlog check: empty
        return { exitCode: 0, stdout: '[]', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const spawnFn = scripts.toSpawnFn();
    const phaseDeps: PhaseDeps = { spawnFn: spawnFn as never };

    const registry: Record<string, PhaseRunner> = {
      [PhaseName.Preflight]: async (c) => preflight(c as PhasesCtx, phaseDeps),
      [PhaseName.Select]: async (c) => select(c as PhasesCtx, phaseDeps),
    };

    const result = await runStateMachine(ctx, PhaseName.Preflight, registry);

    const phases = result.phaseHistory.map((p) => p.phase);
    expect(phases).toEqual([PhaseName.Preflight, PhaseName.Select]);
  });

  it('should halt on auto-shape ESCALATE verdict', async () => {
    mountPassingPreflight(scripts, 'pv-test.1');

    // bdTopReady (select phase)
    scripts.on('bd', (args) => {
      const a = args.join(' ');
      if (a.includes('ready') && a.includes('5')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ id: 'pv-test.1', issue_type: 'task', priority: 1 }]),
          stderr: '',
        };
      }
      if (a.includes('label list') && a.includes('pv-test.1')) {
        return { exitCode: 0, stdout: '- other-label', stderr: '' };
      }
      // bdState (assessState phase): bd show
      if (a.includes('show') && !a.includes('--json')) {
        return { exitCode: 0, stdout: unshapedBeadText(), stderr: '' };
      }
      // bdEscalate: bd label add, bd show --json, bd update
      if (a.includes('label add')) {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (a.includes('show') && a.includes('--json')) {
        return { exitCode: 0, stdout: JSON.stringify([{ notes: '' }]), stderr: '' };
      }
      if (a.includes('update')) {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    dispatches.onFixture('shape-bead', 'claude-p/shape-verdict-escalate.json');

    const spawnFn = scripts.toSpawnFn();
    const dispatchFn = dispatches.toDispatchFn();
    const phaseDeps: PhaseDeps = {
      spawnFn: spawnFn as never,
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
    mountPassingPreflight(scripts, 'pv-test.1');

    // bdTopReady (select)
    scripts.on('bd', (args) => {
      const a = args.join(' ');
      if (a.includes('ready') && a.includes('5')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ id: 'pv-test.1', issue_type: 'task', priority: 1 }]),
          stderr: '',
        };
      }
      if (a.includes('label list')) {
        return { exitCode: 0, stdout: '- other-label', stderr: '' };
      }
      // bdState (assessState): bd show
      if (a.includes('show')) {
        return { exitCode: 0, stdout: shapedBeadText(), stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const spawnFn = scripts.toSpawnFn();
    const phaseDeps: PhaseDeps = { spawnFn: spawnFn as never };

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
