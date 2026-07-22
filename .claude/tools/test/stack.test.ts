/**
 * Unit tests for .claude/tools/lib/stack.ts
 *
 * The pure function (stackPlan) is tested directly with inputs. CLI-calling
 * functions (gitSafeToStart, stackCreate, stackSubmit, syncAndRestack)
 * inject a fake spawnFn that returns canned responses.
 */

import { describe, it, expect } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  gitSafeToStart,
  stackCreate,
  stackSubmit,
  syncAndRestack,
  stackPlan,
  type DependencyEdge,
} from '../lib/stack.js';

// =============================================================================
// Test helpers
// =============================================================================

function fakeSpawn(
  stdout: string,
  stderr = '',
  status = 0,
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

/** Build a sequential spawn mock that returns results in order. */
function seqSpawn(...results: SpawnSyncReturns<Buffer>[]) {
  let i = 0;
  return (_cmd: string, _args: string[], _opts: unknown) => {
    return results[i++] ?? fakeSpawn('', 'unexpected call', 1);
  };
}

// =============================================================================
// gitSafeToStart
// =============================================================================

describe('gitSafeToStart', () => {
  it('returns ok=true when inside repo, HEAD at origin/main, clean tree', () => {
    const spawn = seqSpawn(
      fakeSpawn('true'),                                            // rev-parse --is-inside-work-tree
      fakeSpawn('abc1234567890abcdef1234567890abcdef123456'),       // rev-parse HEAD
      fakeSpawn('abc1234567890abcdef1234567890abcdef123456'),       // rev-parse origin/main
      fakeSpawn(''),                                                // git status --porcelain (clean)
    );
    const result = gitSafeToStart(undefined, { spawnFn: spawn as never });
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns ok=true on a non-main branch as long as HEAD == origin/main', () => {
    const spawn = seqSpawn(
      fakeSpawn('true'),
      fakeSpawn('def4567890abcdef1234567890abcdef12345678'),
      fakeSpawn('def4567890abcdef1234567890abcdef12345678'),
      fakeSpawn(''),
    );
    const result = gitSafeToStart(undefined, { spawnFn: spawn as never });
    expect(result.ok).toBe(true);
  });

  it('returns ok=false with reason when HEAD differs from origin/main', () => {
    const spawn = seqSpawn(
      fakeSpawn('true'),
      fakeSpawn('aaaaaaa1234567890abcdef1234567890abcdef1'),       // HEAD
      fakeSpawn('bbbbbbb1234567890abcdef1234567890abcdef1'),       // origin/main differs
      fakeSpawn(''),
    );
    const result = gitSafeToStart(undefined, { spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('origin/main');
  });

  it('returns ok=false when origin/main cannot be resolved', () => {
    const spawn = seqSpawn(
      fakeSpawn('true'),
      fakeSpawn('abc1234'),                                         // HEAD ok
      fakeSpawn('', 'unknown ref', 128),                            // origin/main missing
    );
    const result = gitSafeToStart(undefined, { spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('origin/main');
  });

  it('returns ok=false when tree is dirty', () => {
    const spawn = seqSpawn(
      fakeSpawn('true'),
      fakeSpawn('abc1234'),
      fakeSpawn('abc1234'),
      fakeSpawn(' M src/server/app.ts\n'),                          // dirty
    );
    const result = gitSafeToStart(undefined, { spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('dirty');
  });

  it('returns ok=false when not inside a git repo', () => {
    const spawn = seqSpawn(fakeSpawn('', 'not a repo', 128));
    const result = gitSafeToStart(undefined, { spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('work tree');
  });

  it('compares HEAD against the LOCAL parent tip when parentBranch is given', () => {
    // A mid-chain stack parent may not exist on origin yet, so the
    // comparison must use the local ref, never origin/<parent>.
    const calls: string[] = [];
    const results = [
      fakeSpawn('true'),                                            // rev-parse --is-inside-work-tree
      fakeSpawn('abc1234567890abcdef1234567890abcdef123456'),       // rev-parse HEAD
      fakeSpawn('abc1234567890abcdef1234567890abcdef123456'),       // rev-parse chore.parent-branch
      fakeSpawn(''),                                                // git status --porcelain (clean)
    ];
    let i = 0;
    const spawn = (_cmd: string, args: string[], _opts: unknown) => {
      calls.push((args as string[]).join(' '));
      return results[i++] ?? fakeSpawn('', 'unexpected call', 1);
    };
    const result = gitSafeToStart('chore.parent-branch', { spawnFn: spawn as never });
    expect(result.ok).toBe(true);
    expect(calls.some(c => c.includes('rev-parse chore.parent-branch'))).toBe(true);
    expect(calls.some(c => c.includes('origin/chore.parent-branch'))).toBe(false);
  });

  it('returns ok=false when HEAD differs from the local parent tip', () => {
    const spawn = seqSpawn(
      fakeSpawn('true'),
      fakeSpawn('aaaaaaa1234567890abcdef1234567890abcdef1'),       // HEAD
      fakeSpawn('bbbbbbb1234567890abcdef1234567890abcdef1'),       // parent differs
    );
    const result = gitSafeToStart('chore.parent-branch', { spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('chore.parent-branch');
  });

  it('returns ok=false when the local parent branch cannot be resolved', () => {
    const spawn = seqSpawn(
      fakeSpawn('true'),
      fakeSpawn('abc1234'),                                         // HEAD ok
      fakeSpawn('', 'unknown ref', 128),                            // parent missing locally
    );
    const result = gitSafeToStart('chore.parent-branch', { spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('chore.parent-branch');
  });

  it('still checks for a dirty tree in parentBranch mode', () => {
    const spawn = seqSpawn(
      fakeSpawn('true'),
      fakeSpawn('abc1234'),
      fakeSpawn('abc1234'),
      fakeSpawn(' M src/server/app.ts\n'),                          // dirty
    );
    const result = gitSafeToStart('chore.parent-branch', { spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('dirty');
  });
});

// =============================================================================
// stackCreate
// =============================================================================

describe('stackCreate', () => {
  describe('chain path (chained=true)', () => {
    it('runs gh stack init with --base when parent is trunk (chain head)', () => {
      const calls: string[] = [];
      const spawn = (cmd: string, args: string[], _opts: unknown) => {
        calls.push([cmd, ...(args as string[])].join(' '));
        return fakeSpawn('');
      };
      const result = stackCreate('feat.add-search', 'main', true, { spawnFn: spawn as never });
      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBe('gh stack init --base main feat.add-search');
    });

    it('runs gh stack add (no --base) when parent is a stack level, not trunk', () => {
      const calls: string[] = [];
      const spawn = (cmd: string, args: string[], _opts: unknown) => {
        calls.push([cmd, ...(args as string[])].join(' '));
        return fakeSpawn('');
      };
      const result = stackCreate('feat.level-two', 'feat.level-one', true, { spawnFn: spawn as never });
      expect(result.ok).toBe(true);
      expect(calls).toEqual(['gh stack add feat.level-two']);
    });

    it('passes conventional branch names to gh-stack verbatim, with no bead IDs', () => {
      // stackCreate does not validate or rewrite branch names at runtime;
      // callers must pass names that follow git-workflow/branches.md. This
      // test asserts the precondition holds end to end: the name goes to
      // gh-stack unchanged and carries no bead IDs.
      const name = 'feat.add-calendar-discovery-surface';
      const calls: string[] = [];
      const spawn = (cmd: string, args: string[], _opts: unknown) => {
        calls.push([cmd, ...(args as string[])].join(' '));
        return fakeSpawn('');
      };
      stackCreate(name, 'feat.parent-level', true, { spawnFn: spawn as never });
      expect(calls[0]).toBe(`gh stack add ${name}`);
      expect(calls[0]).not.toMatch(/pv-[a-z0-9]+/);
    });

    it('returns ok=false with stderr when gh stack init fails', () => {
      const spawn = seqSpawn(
        fakeSpawn('', 'current branch "main" is already part of a stack', 5),
      );
      const result = stackCreate('feat.add-search', 'main', true, { spawnFn: spawn as never });
      expect(result.ok).toBe(false);
      expect(result.stderr).toContain('already part of a stack');
    });
  });

  describe('single path (chained=false)', () => {
    it('runs plain git checkout -b off trunk, never touching gh-stack', () => {
      const calls: string[] = [];
      const spawn = (cmd: string, args: string[], _opts: unknown) => {
        calls.push([cmd, ...(args as string[])].join(' '));
        return fakeSpawn('');
      };
      const result = stackCreate('chore.fix-widget', 'main', false, { spawnFn: spawn as never });
      expect(result.ok).toBe(true);
      expect(calls).toEqual(['git checkout -b chore.fix-widget main']);
      expect(calls.some(c => c.includes('gh stack'))).toBe(false);
    });

    it('returns ok=false with stderr when git checkout -b fails', () => {
      const spawn = seqSpawn(
        fakeSpawn('', "fatal: a branch named 'chore.fix-widget' already exists", 128),
      );
      const result = stackCreate('chore.fix-widget', 'main', false, { spawnFn: spawn as never });
      expect(result.ok).toBe(false);
      expect(result.stderr).toContain('already exists');
    });
  });
});

// =============================================================================
// gh-stack helpers — cwd forwarding (native gh-stack-in-worktrees, D2)
// =============================================================================

describe('gh-stack helpers cwd forwarding', () => {
  function captureOpts() {
    const optsSeen: Array<Record<string, unknown>> = [];
    const spawn = (_cmd: string, _args: string[], opts: Record<string, unknown>) => {
      optsSeen.push(opts);
      return fakeSpawn('{}');
    };
    return { optsSeen, spawn };
  }

  it('forwards deps.cwd into the spawn options for stackCreate, stackSubmit, and syncAndRestack', () => {
    const { optsSeen, spawn } = captureOpts();

    stackCreate('feat.level-two', 'feat.level-one', true, { spawnFn: spawn as never, cwd: '/tmp/orch-wt-1' });
    stackSubmit('feat.level-two', true, { spawnFn: spawn as never, cwd: '/tmp/orch-wt-1' });
    syncAndRestack({ spawnFn: spawn as never, cwd: '/tmp/orch-wt-1' });

    expect(optsSeen.length).toBeGreaterThan(0);
    for (const opts of optsSeen) {
      expect(opts.cwd).toBe('/tmp/orch-wt-1');
    }
  });

  it('omits cwd from the spawn options when deps.cwd is not set (main checkout)', () => {
    const { optsSeen, spawn } = captureOpts();

    stackCreate('feat.level-one', 'main', true, { spawnFn: spawn as never });
    stackSubmit('feat.level-one', true, { spawnFn: spawn as never });
    syncAndRestack({ spawnFn: spawn as never });

    expect(optsSeen.length).toBeGreaterThan(0);
    for (const opts of optsSeen) {
      expect('cwd' in opts).toBe(false);
    }
  });
});

// =============================================================================
// stackSubmit
// =============================================================================

describe('stackSubmit', () => {
  describe('chain path (chained=true)', () => {
    it('runs gh stack submit --auto --open, then sweeps gh pr ready over the stack (D3 safe interim)', () => {
      const calls: string[] = [];
      const spawn = (cmd: string, args: string[], _opts: unknown) => {
        const call = [cmd, ...(args as string[])].join(' ');
        calls.push(call);
        if (cmd === 'gh' && args[0] === 'stack' && args[1] === 'view') {
          return fakeSpawn(JSON.stringify({
            branches: [
              { name: 'feat.level-one', pr: { number: 10 } },
              { name: 'feat.level-two', pr: { number: 11 } },
            ],
          }));
        }
        return fakeSpawn('✓ Stack created on GitHub with 2 PRs (stack #1)');
      };
      const result = stackSubmit('feat.level-two', true, { spawnFn: spawn as never });
      expect(result.ok).toBe(true);
      expect(calls[0]).toBe('gh stack submit --auto --open');
      expect(calls).toContain('gh stack view --json');
      expect(calls).toContain('gh pr ready 10');
      expect(calls).toContain('gh pr ready 11');
    });

    it('does not sweep gh pr ready when the stack has no PRs yet', () => {
      const calls: string[] = [];
      const spawn = (cmd: string, args: string[], _opts: unknown) => {
        calls.push([cmd, ...(args as string[])].join(' '));
        if (cmd === 'gh' && args[0] === 'stack' && args[1] === 'view') {
          return fakeSpawn(JSON.stringify({ branches: [] }));
        }
        return fakeSpawn('');
      };
      stackSubmit('feat.level-one', true, { spawnFn: spawn as never });
      expect(calls.some(c => c.startsWith('gh pr ready'))).toBe(false);
    });

    it('returns ok=false with output when gh stack submit fails, without sweeping', () => {
      const calls: string[] = [];
      const spawn = (cmd: string, args: string[], _opts: unknown) => {
        calls.push([cmd, ...(args as string[])].join(' '));
        return fakeSpawn('', 'feature disabled for this repo', 9);
      };
      const result = stackSubmit('feat.add-search', true, { spawnFn: spawn as never });
      expect(result.ok).toBe(false);
      expect(result.stderr).toContain('feature disabled');
      expect(calls).toEqual(['gh stack submit --auto --open']);
    });
  });

  describe('single path (chained=false)', () => {
    it('runs plain git push then gh pr create --fill, never touching gh-stack', () => {
      const calls: string[] = [];
      const spawn = (cmd: string, args: string[], _opts: unknown) => {
        calls.push([cmd, ...(args as string[])].join(' '));
        return fakeSpawn('');
      };
      const result = stackSubmit('chore.fix-widget', false, { spawnFn: spawn as never });
      expect(result.ok).toBe(true);
      expect(calls).toEqual([
        'git push -u origin chore.fix-widget',
        'gh pr create --fill',
      ]);
    });

    it('returns ok=false without calling gh pr create when git push fails', () => {
      const calls: string[] = [];
      const spawn = (cmd: string, args: string[], _opts: unknown) => {
        calls.push([cmd, ...(args as string[])].join(' '));
        return fakeSpawn('', 'fatal: could not read from remote repository', 128);
      };
      const result = stackSubmit('chore.fix-widget', false, { spawnFn: spawn as never });
      expect(result.ok).toBe(false);
      expect(result.stderr).toContain('remote repository');
      expect(calls).toEqual(['git push -u origin chore.fix-widget']);
    });

    it('returns ok=false when gh pr create fails after a successful push', () => {
      const spawn = seqSpawn(
        fakeSpawn(''),
        fakeSpawn('', 'a pull request for branch "chore.fix-widget" already exists', 1),
      );
      const result = stackSubmit('chore.fix-widget', false, { spawnFn: spawn as never });
      expect(result.ok).toBe(false);
      expect(result.stderr).toContain('already exists');
    });
  });
});

// =============================================================================
// stackPlan
// =============================================================================

describe('stackPlan', () => {
  const blocks = (blocker: string, blocked: string): DependencyEdge =>
    ({ blocker, blocked, dependencyType: 'blocks' });

  it('orders a linear chain blocker-first', () => {
    const result = stackPlan(['b3', 'b1', 'b2'], [blocks('b1', 'b2'), blocks('b2', 'b3')]);
    expect(result.flat).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.chains).toEqual([['b1', 'b2', 'b3']]);
  });

  it('returns multiple independent chains in input order of their heads', () => {
    const result = stackPlan(
      ['b1', 'b4', 'b5', 'b2', 'b6'],
      [blocks('b1', 'b2'), blocks('b5', 'b6')],
    );
    expect(result.flat).toBe(false);
    expect(result.chains).toEqual([['b1', 'b2'], ['b4'], ['b5', 'b6']]);
  });

  it('returns all singletons for an empty edge set without flagging flat', () => {
    const result = stackPlan(['b1', 'b2', 'b3'], []);
    expect(result.chains).toEqual([['b1'], ['b2'], ['b3']]);
    expect(result.flat).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('falls back to a flat plan with a warning on a cycle', () => {
    const result = stackPlan(
      ['b1', 'b2', 'b3'],
      [blocks('b1', 'b2'), blocks('b2', 'b1')],
    );
    expect(result.flat).toBe(true);
    expect(result.chains).toEqual([['b1'], ['b2'], ['b3']]);
    expect(result.warnings.some(w => /cycle/.test(w))).toBe(true);
  });

  it('falls back to a flat plan with a warning on a fork (one blocker, two dependents)', () => {
    const result = stackPlan(
      ['b1', 'b2', 'b3'],
      [blocks('b1', 'b2'), blocks('b1', 'b3')],
    );
    expect(result.flat).toBe(true);
    expect(result.chains).toEqual([['b1'], ['b2'], ['b3']]);
    expect(result.warnings.some(w => /fork at b1/.test(w))).toBe(true);
  });

  it('falls back to a flat plan with a warning on a join (two blockers, one dependent)', () => {
    const result = stackPlan(
      ['b1', 'b2', 'b3'],
      [blocks('b1', 'b3'), blocks('b2', 'b3')],
    );
    expect(result.flat).toBe(true);
    expect(result.chains).toEqual([['b1'], ['b2'], ['b3']]);
    expect(result.warnings.some(w => /join at b3/.test(w))).toBe(true);
  });

  it('ignores parent-child edges', () => {
    const result = stackPlan(
      ['b1', 'b2'],
      [
        { blocker: 'epic-1', blocked: 'b1', dependencyType: 'parent-child' },
        { blocker: 'b1', blocked: 'b2', dependencyType: 'parent-child' },
      ],
    );
    expect(result.chains).toEqual([['b1'], ['b2']]);
    expect(result.flat).toBe(false);
  });

  it('ignores self-edges', () => {
    const result = stackPlan(['b1', 'b2'], [blocks('b1', 'b1')]);
    expect(result.chains).toEqual([['b1'], ['b2']]);
    expect(result.flat).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('ignores edges that reference beads outside the sibling set', () => {
    const result = stackPlan(
      ['b1', 'b2'],
      [blocks('pv-external', 'b1'), blocks('b1', 'b2')],
    );
    expect(result.chains).toEqual([['b1', 'b2']]);
    expect(result.flat).toBe(false);
  });

  it('does not treat duplicate edges as a fork or join', () => {
    const result = stackPlan(
      ['b1', 'b2'],
      [blocks('b1', 'b2'), blocks('b1', 'b2')],
    );
    expect(result.flat).toBe(false);
    expect(result.chains).toEqual([['b1', 'b2']]);
  });

  it('produces deterministic output for the same input', () => {
    const beads = ['b2', 'b1', 'b9', 'b5'];
    const edges = [blocks('b1', 'b2'), blocks('b9', 'b5')];
    const first = stackPlan(beads, edges);
    const second = stackPlan(beads, edges);
    expect(first).toEqual(second);
    // Heads in input order are b1 then b9 (b2 and b5 are blocked).
    expect(first.chains).toEqual([['b1', 'b2'], ['b9', 'b5']]);
  });
});

// =============================================================================
// syncAndRestack
// =============================================================================

describe('syncAndRestack', () => {
  it('runs gh stack sync --prune', () => {
    const calls: string[] = [];
    const spawn = (cmd: string, args: string[], _opts: unknown) => {
      calls.push([cmd, ...(args as string[])].join(' '));
      return fakeSpawn('✓ Synced.');
    };
    syncAndRestack({ spawnFn: spawn as never });
    expect(calls).toEqual(['gh stack sync --prune']);
  });

  it('reports ok=true on a clean sync (exit 0)', () => {
    const spawn = seqSpawn(fakeSpawn('✓ Synced 2 branches.'));
    const result = syncAndRestack({ spawnFn: spawn as never });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.conflicted).toBe(false);
    expect(result.featureDisabled).toBe(false);
  });

  it('reports a rebase conflict on exit code 3', () => {
    const spawn = seqSpawn(fakeSpawn('', 'rebase conflict on feat.level-two', 3));
    const result = syncAndRestack({ spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.conflicted).toBe(true);
    expect(result.featureDisabled).toBe(false);
    expect(result.rawOutput).toContain('rebase conflict');
  });

  it('reports feature-disabled on exit code 9 (clean hard stop, per D5)', () => {
    const spawn = seqSpawn(fakeSpawn('', 'feature disabled for this repo', 9));
    const result = syncAndRestack({ spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(9);
    expect(result.featureDisabled).toBe(true);
    expect(result.conflicted).toBe(false);
  });

  it('reports ok=false when gh stack sync fails for any other reason', () => {
    const spawn = seqSpawn(fakeSpawn('', 'ERROR: network failure', 1));
    const result = syncAndRestack({ spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.conflicted).toBe(false);
    expect(result.featureDisabled).toBe(false);
    expect(result.rawOutput).toContain('network failure');
  });
});
