/**
 * Unit tests for .claude/orchestrators/lib/helpers.ts
 *
 * Pure functions (classifyBeadState, classifySizing, branchName, commitMsg,
 * prBody) are tested directly with inputs.
 *
 * CLI-calling functions (gitSafeToStart, preflight, bdTopReady, bdEscalate,
 * bdState, bdSizingCheck, bdEnrichmentCheck, discoverAgents) inject a fake
 * spawnFn that returns canned responses.
 */

import { describe, it, expect } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  gitSafeToStart,
  preflight,
  bdTopReady,
  bdEscalate,
  bdCreateFollowup,
  bdState,
  classifyBeadState,
  bdSizingCheck,
  classifySizing,
  bdEnrichmentCheck,
  branchName,
  commitMsg,
  prBody,
  stackCreate,
  stackSubmit,
  syncAndRestack,
  stackPlan,
  type DependencyEdge,
} from '../../lib/helpers.js';

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
// preflight
// =============================================================================

describe('preflight', () => {
  // gt probe responses shared by passing cases:
  //   gt --version, gt auth --no-interactive, gt trunk
  const gtOk = () => [
    fakeSpawn('1.8.6'),
    fakeSpawn('Authenticated as: someone\n✅ Ready to submit PRs.'),
    fakeSpawn('main'),
  ];

  it('returns ok=true when all checks pass', () => {
    // Calls in order: git status, git fetch, git rev-parse HEAD, git rev-parse origin/main,
    // gt --version, gt auth, gt trunk, bd ready --json, bd label list (per bead)
    const beadsJson = JSON.stringify([
      { id: 'pv-abc1', priority: 1, created_at: '2026-01-01' },
    ]);
    const spawn = seqSpawn(
      fakeSpawn(''),                  // git status --porcelain (clean)
      fakeSpawn(''),                  // git fetch origin main (success)
      fakeSpawn('abc1234'),           // git rev-parse HEAD
      fakeSpawn('abc1234'),           // git rev-parse origin/main (matches)
      ...gtOk(),
      fakeSpawn(beadsJson),           // bd ready --json
      fakeSpawn('  - backlog'),       // bd label list pv-abc1 (no needs-human)
    );
    const result = preflight({ spawnFn: spawn as never });
    expect(result.ok).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('passes when on a non-main branch as long as HEAD == origin/main', () => {
    const beadsJson = JSON.stringify([
      { id: 'pv-abc1', priority: 1, created_at: '2026-01-01' },
    ]);
    const spawn = seqSpawn(
      fakeSpawn(''),                  // clean
      fakeSpawn(''),                  // fetch ok
      fakeSpawn('def5678'),           // HEAD
      fakeSpawn('def5678'),           // origin/main matches
      ...gtOk(),
      fakeSpawn(beadsJson),
      fakeSpawn('  - other'),
    );
    const result = preflight({ spawnFn: spawn as never });
    expect(result.ok).toBe(true);
  });

  it('reports dirty_tree, behind_main, and empty_backlog failures together', () => {
    const spawn = seqSpawn(
      fakeSpawn(' M src/file.ts'),   // dirty
      fakeSpawn('', '', 1),           // fetch fails → behind_main
      ...gtOk(),
      fakeSpawn('[]'),                // bd ready (empty → empty_backlog)
    );
    const result = preflight({ spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    const kinds = result.failures.map(f => f.kind);
    expect(kinds).toContain('dirty_tree');
    expect(kinds).toContain('behind_main');
    expect(kinds).toContain('empty_backlog');
  });

  it('reports behind_main when HEAD differs from origin/main', () => {
    const spawn = seqSpawn(
      fakeSpawn(''),                  // clean
      fakeSpawn(''),                  // fetch ok
      fakeSpawn('aaaaaaa'),           // HEAD
      fakeSpawn('bbbbbbb'),           // origin/main differs
      ...gtOk(),
      fakeSpawn('[]'),                // bd ready (empty → empty_backlog too)
    );
    const result = preflight({ spawnFn: spawn as never });
    const kinds = result.failures.map(f => f.kind);
    expect(kinds).toContain('behind_main');
  });

  it('reports empty_backlog when all ready beads have needs-human label', () => {
    const beadsJson = JSON.stringify([{ id: 'pv-x1', priority: 1, created_at: '2026-01-01' }]);
    const spawn = seqSpawn(
      fakeSpawn(''),                  // clean tree
      fakeSpawn(''),                  // fetch ok
      fakeSpawn('abc1234'),           // HEAD
      fakeSpawn('abc1234'),           // origin/main matches
      ...gtOk(),
      fakeSpawn(beadsJson),           // bd ready
      fakeSpawn('  - needs-human'),   // label list: has needs-human
    );
    const result = preflight({ spawnFn: spawn as never });
    expect(result.failures.map(f => f.kind)).toContain('empty_backlog');
  });

  it('reports missing_gt and skips the auth/trunk probes when gt is absent', () => {
    const beadsJson = JSON.stringify([{ id: 'pv-x1', priority: 1, created_at: '2026-01-01' }]);
    const calls: string[] = [];
    const results = [
      fakeSpawn(''),                        // clean tree
      fakeSpawn(''),                        // fetch ok
      fakeSpawn('abc1234'),                 // HEAD
      fakeSpawn('abc1234'),                 // origin/main matches
      fakeSpawn('', 'command not found: gt', 127), // gt --version fails
      fakeSpawn(beadsJson),                 // bd ready (auth/trunk probes skipped)
      fakeSpawn('  - backlog'),             // bd label list
    ];
    let i = 0;
    const spawn = (cmd: string, args: string[], _opts: unknown) => {
      calls.push([cmd, ...(args as string[])].join(' '));
      return results[i++] ?? fakeSpawn('', 'unexpected call', 1);
    };
    const result = preflight({ spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.failures.map(f => f.kind)).toContain('missing_gt');
    // Hard stop on the tool itself: auth and trunk are not probed.
    expect(calls.some(c => c.includes('auth'))).toBe(false);
    expect(calls.some(c => c.includes('trunk'))).toBe(false);
  });

  it('reports gt_unauthenticated when the auth probe fails', () => {
    const beadsJson = JSON.stringify([{ id: 'pv-x1', priority: 1, created_at: '2026-01-01' }]);
    const spawn = seqSpawn(
      fakeSpawn(''),                        // clean tree
      fakeSpawn(''),                        // fetch ok
      fakeSpawn('abc1234'),                 // HEAD
      fakeSpawn('abc1234'),                 // origin/main matches
      fakeSpawn('1.8.6'),                   // gt --version ok
      fakeSpawn('', 'Please authenticate', 1), // gt auth fails
      fakeSpawn('main'),                    // gt trunk ok
      fakeSpawn(beadsJson),
      fakeSpawn('  - backlog'),
    );
    const result = preflight({ spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.failures.map(f => f.kind)).toContain('gt_unauthenticated');
  });

  it('reports gt_unauthenticated when the auth probe output lacks an authenticated user', () => {
    const beadsJson = JSON.stringify([{ id: 'pv-x1', priority: 1, created_at: '2026-01-01' }]);
    const spawn = seqSpawn(
      fakeSpawn(''),
      fakeSpawn(''),
      fakeSpawn('abc1234'),
      fakeSpawn('abc1234'),
      fakeSpawn('1.8.6'),
      fakeSpawn('Add your auth token to enable Graphite CLI'), // exit 0 but not authenticated
      fakeSpawn('main'),
      fakeSpawn(beadsJson),
      fakeSpawn('  - backlog'),
    );
    const result = preflight({ spawnFn: spawn as never });
    expect(result.failures.map(f => f.kind)).toContain('gt_unauthenticated');
  });

  it('reports gt_trunk_misconfigured when gt trunk is not the main branch', () => {
    const beadsJson = JSON.stringify([{ id: 'pv-x1', priority: 1, created_at: '2026-01-01' }]);
    const spawn = seqSpawn(
      fakeSpawn(''),
      fakeSpawn(''),
      fakeSpawn('abc1234'),
      fakeSpawn('abc1234'),
      fakeSpawn('1.8.6'),
      fakeSpawn('Authenticated as: someone'),
      fakeSpawn('develop'),                 // gt trunk mismatch
      fakeSpawn(beadsJson),
      fakeSpawn('  - backlog'),
    );
    const result = preflight({ spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.failures.map(f => f.kind)).toContain('gt_trunk_misconfigured');
  });
});

// =============================================================================
// bdTopReady
// =============================================================================

describe('bdTopReady', () => {
  it('returns top bead sorted by priority', () => {
    const beadsJson = JSON.stringify([
      { id: 'pv-b', priority: 2, created_at: '2026-01-01' },
      { id: 'pv-a', priority: 1, created_at: '2026-01-01' },
    ]);
    const spawn = seqSpawn(
      fakeSpawn(beadsJson),         // bd ready
      fakeSpawn('  - backlog'),     // label list pv-b (no needs-human)
      fakeSpawn('  - backlog'),     // label list pv-a (no needs-human)
    );
    const result = bdTopReady({ spawnFn: spawn as never });
    expect(result.exhausted).toBe(false);
    expect(result.bead?.id).toBe('pv-a');
  });

  it('returns exhausted=true when all beads have needs-human', () => {
    const beadsJson = JSON.stringify([{ id: 'pv-x1', priority: 1, created_at: '2026-01-01' }]);
    const spawn = seqSpawn(
      fakeSpawn(beadsJson),
      fakeSpawn('  - needs-human'),
    );
    const result = bdTopReady({ spawnFn: spawn as never });
    expect(result.exhausted).toBe(true);
    expect(result.bead).toBeNull();
  });

  it('returns exhausted=true when bd ready returns empty list', () => {
    const spawn = seqSpawn(fakeSpawn('[]'));
    const result = bdTopReady({ spawnFn: spawn as never });
    expect(result.exhausted).toBe(true);
  });
});

// =============================================================================
// bdEscalate
// =============================================================================

describe('bdEscalate', () => {
  it('adds label and appends note when not already escalated today', () => {
    const calls: [string, string[]][] = [];
    const spawn = (_cmd: string, _args: string[], _opts: unknown) => {
      calls.push([_cmd, _args as string[]]);
      // For bd show --json, return notes without today's escalation
      if ((_args as string[])[0] === 'show') {
        return fakeSpawn(JSON.stringify([{ notes: 'some old notes' }]));
      }
      return fakeSpawn('');
    };
    bdEscalate('pv-abc1', 'timed out', '3', { spawnFn: spawn as never });
    const cmds = calls.map(c => c[1].join(' '));
    expect(cmds.some(c => c.includes('label add') && c.includes('needs-human'))).toBe(true);
    expect(cmds.some(c => c.includes('update') && c.includes('--append-notes'))).toBe(true);
  });

  it('skips append-notes when today\'s escalation already present', () => {
    const today = new Date().toISOString().split('T')[0];
    const calls: string[][] = [];
    const spawn = (_cmd: string, _args: string[], _opts: unknown) => {
      calls.push(_args as string[]);
      if ((_args as string[])[0] === 'show') {
        return fakeSpawn(JSON.stringify([{
          notes: `## Escalation (${today})\n\nAlready done.`,
        }]));
      }
      return fakeSpawn('');
    };
    bdEscalate('pv-abc1', 'reason', '3', { spawnFn: spawn as never });
    const cmds = calls.map(c => c.join(' '));
    expect(cmds.some(c => c.includes('--append-notes'))).toBe(false);
  });
});

// =============================================================================
// bdCreateFollowup
// =============================================================================

describe('bdCreateFollowup', () => {
  it('creates a bead, parses its id, and applies followup-from + caller labels', () => {
    const calls: string[][] = [];
    const spawn = (_cmd: string, args: string[], _opts: unknown) => {
      calls.push(args);
      if (args[0] === 'create') {
        return fakeSpawn('✓ Created issue: pv-new9 — my title\n');
      }
      return fakeSpawn('');
    };

    const result = bdCreateFollowup(
      {
        parentBeadId: 'pv-parent1',
        title: 'Clean up lingering test gaps',
        description: 'Multi-line\ndescription\n',
        labels: ['needs-shape'],
      },
      { spawnFn: spawn as never },
    );

    expect(result.beadId).toBe('pv-new9');

    const flat = calls.map(a => a.join(' '));
    expect(flat[0]).toContain('create');
    expect(flat[0]).toContain('--type task');
    expect(flat[0]).toContain('--priority 2');

    const labelCalls = flat.filter(c => c.startsWith('label add'));
    expect(labelCalls.some(c => c.includes('followup-from:pv-parent1'))).toBe(true);
    expect(labelCalls.some(c => c.includes('needs-shape'))).toBe(true);
  });

  it('returns beadId=null when bd create output has no parseable id', () => {
    const spawn = (_cmd: string, args: string[], _opts: unknown) => {
      if (args[0] === 'create') return fakeSpawn('', 'bd: command failed', 1);
      return fakeSpawn('');
    };

    const result = bdCreateFollowup(
      {
        parentBeadId: 'pv-parent1',
        title: 't',
        description: 'd',
        labels: [],
      },
      { spawnFn: spawn as never },
    );

    expect(result.beadId).toBeNull();
    expect(result.rawOutput).toContain('bd: command failed');
  });

  it('deduplicates labels when caller supplies the parent label themselves', () => {
    const calls: string[][] = [];
    const spawn = (_cmd: string, args: string[], _opts: unknown) => {
      calls.push(args);
      if (args[0] === 'create') return fakeSpawn('✓ Created issue: pv-dup1 — x');
      return fakeSpawn('');
    };

    bdCreateFollowup(
      {
        parentBeadId: 'pv-parent1',
        title: 't',
        description: 'd',
        labels: ['followup-from:pv-parent1', 'needs-shape'],
      },
      { spawnFn: spawn as never },
    );

    const labelAdds = calls
      .filter(a => a[0] === 'label' && a[1] === 'add')
      .map(a => a[3]);
    const parentLabelCount = labelAdds.filter(l => l === 'followup-from:pv-parent1').length;
    expect(parentLabelCount).toBe(1);
  });
});

// =============================================================================
// classifyBeadState (pure)
// =============================================================================

describe('classifyBeadState', () => {
  it('returns unshaped for minimal bead with no sections', () => {
    const content = '[● P3 · OPEN] pv-abc1 · My Bead\n\nDESCRIPTION\n\nNothing here\n';
    // has DESCRIPTION but no DESIGN or ACCEPTANCE CRITERIA
    const result = classifyBeadState(content);
    expect(result.state).toBe('unshaped');
    expect(result.missing_phases).toContain('shaped');
  });

  it('returns shaped when DESCRIPTION, DESIGN, ACCEPTANCE CRITERIA all present', () => {
    const content = [
      '[● P1 · OPEN] pv-abc1 · My Bead',
      '',
      'DESCRIPTION',
      'This is a description.',
      '',
      'DESIGN',
      'This is a design.',
      '',
      'ACCEPTANCE CRITERIA',
      '- AC1',
    ].join('\n');
    const result = classifyBeadState(content);
    expect(result.state).toBe('shaped');
    expect(result.missing_phases).toContain('advised');
    expect(result.missing_phases).toContain('decomposed');
    expect(result.missing_phases).not.toContain('shaped');
  });

  it('returns advised when shaped + Advisory Review notes present', () => {
    const content = [
      '[● P1 · OPEN] pv-abc1 · My Bead',
      '',
      'DESCRIPTION',
      'This is a description.',
      '',
      'DESIGN',
      'This is a design.',
      '',
      'ACCEPTANCE CRITERIA',
      '- AC1',
      '',
      'NOTES',
      '## Advisory Review',
      '- **complexity-advisor:** APPROVE — no concerns',
    ].join('\n');
    const result = classifyBeadState(content);
    expect(result.state).toBe('advised');
    expect(result.missing_phases).toContain('decomposed');
    expect(result.missing_phases).not.toContain('advised');
    expect(result.missing_phases).not.toContain('shaped');
    expect(result.reasons).toContain('notes contain Advisory Review');
  });

  it('returns decomposed when shaped + has children', () => {
    const content = [
      '[● P1 · OPEN] pv-abc1 · My Bead',
      '',
      'DESCRIPTION',
      'This is a description.',
      '',
      'DESIGN',
      'This is a design.',
      '',
      'ACCEPTANCE CRITERIA',
      '- AC1',
      '',
      'CHILDREN',
      '  ↳ pv-abc1.1 · Child One',
    ].join('\n');
    const result = classifyBeadState(content);
    expect(result.state).toBe('decomposed');
  });

  it('returns analyzed when Implementation Context present', () => {
    const content = [
      '[● P1 · OPEN] pv-abc1 · My Bead',
      '',
      'DESCRIPTION',
      'Desc.',
      '',
      'DESIGN',
      'Design.',
      '',
      'ACCEPTANCE CRITERIA',
      '- AC1',
      '',
      'NOTES',
      '## Implementation Context',
      'Some context here.',
    ].join('\n');
    const result = classifyBeadState(content);
    expect(result.state).toBe('analyzed');
  });

  it('returns executing for IN_PROGRESS status', () => {
    const content = '[● P1 · IN_PROGRESS] pv-abc1 · My Bead\n\nDESCRIPTION\nDesc.\n';
    const result = classifyBeadState(content);
    expect(result.state).toBe('executing');
    expect(result.reasons).toContain('bead status is IN_PROGRESS');
  });

  it('returns complete for CLOSED status', () => {
    const content = '[● P1 · CLOSED] pv-abc1 · My Bead\n\n';
    const result = classifyBeadState(content);
    expect(result.state).toBe('complete');
  });
});

// =============================================================================
// classifySizing (pure)
// =============================================================================

describe('classifySizing', () => {
  it('returns needs_decomposition=false for small single-domain bead', () => {
    const result = classifySizing('Update one service file to fix a bug.');
    expect(result.needs_decomposition).toBe(false);
  });

  it('triggers decomposition when 2 of 3 criteria met', () => {
    // 4+ files AND spans multiple domains
    const scopeText = [
      'Modify src/server/calendar/service/calendar.ts',
      'Modify src/server/calendar/api/v1/events.ts',
      'Modify src/client/components/edit-event.vue',
      'Modify src/client/components/calendar-list.vue',
      'Add frontend Vue component and backend service',
      'Also update locales/en.json with i18n keys',
    ].join('\n');
    const result = classifySizing(scopeText);
    expect(result.needs_decomposition).toBe(true);
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('triggers on 4+ bullet items and multi-domain', () => {
    const scopeText = [
      '- Add API endpoint for events',
      '- Add Vue component for calendar view',
      '- Update backend service logic',
      '- Add translation strings for i18n',
      'Backend api and frontend vue work',
    ].join('\n');
    const result = classifySizing(scopeText);
    expect(result.needs_decomposition).toBe(true);
  });
});

// =============================================================================
// bdEnrichmentCheck
// =============================================================================

describe('bdEnrichmentCheck', () => {
  it('returns true when notes contain Implementation Context', () => {
    const spawn = seqSpawn(
      fakeSpawn('Some content\n## Implementation Context\nDetails here'),
    );
    expect(bdEnrichmentCheck('pv-abc1', { spawnFn: spawn as never })).toBe(true);
  });

  it('returns false when notes do not contain Implementation Context', () => {
    const spawn = seqSpawn(fakeSpawn('Some content without the key phrase'));
    expect(bdEnrichmentCheck('pv-abc1', { spawnFn: spawn as never })).toBe(false);
  });

  it('returns false when bd show fails', () => {
    const spawn = seqSpawn(fakeSpawn('', 'error', 1));
    expect(bdEnrichmentCheck('pv-abc1', { spawnFn: spawn as never })).toBe(false);
  });
});

// =============================================================================
// branchName (pure)
// =============================================================================

describe('branchName', () => {
  it('derives chore prefix for task type', () => {
    const result = branchName('Fix the broken widget', 'task');
    expect(result).toBe('chore.fix-the-broken-widget');
  });

  it('uses feat prefix for feature type', () => {
    const result = branchName('Add calendar discovery', 'feature');
    expect(result).toMatch(/^feat\./);
  });

  it('uses feat prefix for epic type', () => {
    const result = branchName('Build search', 'epic');
    expect(result).toMatch(/^feat\./);
  });

  it('uses fix prefix for bug type', () => {
    const result = branchName('Fix broken links', 'bug');
    expect(result).toMatch(/^fix\./);
  });

  it('does not embed bead IDs in output', () => {
    // Bead IDs must not appear in branch names — git-workflow principle.
    const result = branchName('Some task', 'task');
    expect(result).not.toMatch(/pv-/);
  });

  it('truncates long titles to stay within 60 chars', () => {
    const longTitle = 'This is a very long title that would exceed the maximum length limit easily and should be truncated cleanly';
    const result = branchName(longTitle, 'task');
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result).toMatch(/^chore\./);
    expect(result.endsWith('-')).toBe(false);
  });

  it('defaults to chore for unknown issue type', () => {
    const result = branchName('Some work', 'unknown');
    expect(result).toMatch(/^chore\./);
  });

  it('strips leading and trailing non-alphanumerics from the title', () => {
    const result = branchName('  --Add Search-- ', 'feature');
    expect(result).toBe('feat.add-search');
  });
});

// =============================================================================
// commitMsg (pure)
// =============================================================================

describe('commitMsg', () => {
  it('formats correctly without scope', () => {
    const result = commitMsg('Add event search', 'feature');
    expect(result).toBe('feat: Add event search');
  });

  it('includes scope when provided', () => {
    const result = commitMsg('Fix calendar API', 'bug', 'calendar');
    expect(result).toBe('fix(calendar): Fix calendar API');
  });

  it('maps epic to feat', () => {
    const result = commitMsg('Implement federation', 'epic');
    expect(result).toMatch(/^feat:/);
  });

  it('does not embed bead IDs in output', () => {
    // Bead IDs must not appear in commit messages — git-workflow principle.
    const result = commitMsg('Add event search', 'feature');
    expect(result).not.toMatch(/pv-/);
  });

  it('collapses newlines in summary', () => {
    const result = commitMsg('Line one\nLine two', 'task');
    expect(result).not.toContain('\n');
    expect(result).toContain('Line one Line two');
  });

  it('defaults to chore for unknown issue type', () => {
    const result = commitMsg('Some work', 'unknown');
    expect(result).toBe('chore: Some work');
  });
});

// =============================================================================
// prBody (pure)
// =============================================================================

describe('prBody', () => {
  it('renders the three required template sections', () => {
    // The git-workflow PR template requires Motivation, Approach, Validation.
    // No Summary, no Beads-closed list, no Test plan section.
    const body = prBody(
      'Add event search',
      'Users have asked for a way to search calendar events.',
    );
    expect(body).toContain('## Motivation');
    expect(body).toContain('## Approach');
    expect(body).toContain('## Validation');
    expect(body).not.toContain('## Summary');
    expect(body).not.toContain('## Beads closed');
    expect(body).not.toContain('## Test plan');
  });

  it('does not include any bead IDs in the rendered body', () => {
    // Bead IDs must not appear in PR bodies — git-workflow principle.
    const body = prBody('Add feature', 'Why this work was needed.');
    expect(body).not.toMatch(/pv-[a-z0-9]+/);
  });

  it('uses the description for the Motivation section', () => {
    const description = 'Users have asked for a way to search calendar events.';
    const body = prBody('Add event search', description);
    const motivationStart = body.indexOf('## Motivation');
    const approachStart = body.indexOf('## Approach');
    const motivationBody = body.slice(motivationStart, approachStart);
    expect(motivationBody).toContain(description);
  });

  it('uses the title for the Approach section', () => {
    const body = prBody('Add event search', 'Why...');
    const approachStart = body.indexOf('## Approach');
    const validationStart = body.indexOf('## Validation');
    const approachBody = body.slice(approachStart, validationStart);
    expect(approachBody).toContain('Add event search');
  });

  it('falls back to title for Motivation when description is empty', () => {
    const body = prBody('Add feature', '');
    const motivationStart = body.indexOf('## Motivation');
    const approachStart = body.indexOf('## Approach');
    const motivationBody = body.slice(motivationStart, approachStart);
    expect(motivationBody).toContain('Add feature');
  });

  it('includes the standard validation checklist', () => {
    const body = prBody('Add feature', 'Why.');
    expect(body).toContain('`npm run lint`');
    expect(body).toContain('`npm run test:unit`');
    expect(body).toContain('`npm run test:integration`');
    expect(body).toContain('`npm run build`');
    expect(body).toContain('build-guardian');
  });
});

// Note: the legacy fileTags/matchAgents mechanical matcher was removed in
// pv-2213. Agent selection now happens via the agent-selector subagent,
// which is tested in phases.test.ts (selectAdvisors) and execute.test.ts
// (selectAuditors) against mocked dispatch.

// =============================================================================
// bdState (via spawnFn)
// =============================================================================

describe('bdState', () => {
  it('returns unshaped for bead missing sections', () => {
    const content = '[● P3 · OPEN] pv-abc1 · My Bead\n\nDESCRIPTION\n\nsome text\n';
    const spawn = seqSpawn(fakeSpawn(content));
    const result = bdState('pv-abc1', { spawnFn: spawn as never });
    expect(result.state).toBe('unshaped');
  });

  it('returns shaped when all shape sections present', () => {
    const content = [
      '[● P1 · OPEN] pv-abc1',
      '',
      'DESCRIPTION',
      'Details.',
      '',
      'DESIGN',
      'Plan.',
      '',
      'ACCEPTANCE CRITERIA',
      '- AC1',
    ].join('\n');
    const spawn = seqSpawn(fakeSpawn(content));
    const result = bdState('pv-abc1', { spawnFn: spawn as never });
    expect(result.state).toBe('shaped');
  });
});

// =============================================================================
// bdSizingCheck (via spawnFn)
// =============================================================================

describe('bdSizingCheck', () => {
  it('returns needs_decomposition=false for simple bead', () => {
    const content = [
      '[● P1 · OPEN] pv-abc1',
      '',
      'DESCRIPTION',
      'Fix a small bug.',
      '',
      'DESIGN',
      'Change one line in service.',
    ].join('\n');
    const spawn = seqSpawn(fakeSpawn(content));
    const result = bdSizingCheck('pv-abc1', { spawnFn: spawn as never });
    expect(result.needs_decomposition).toBe(false);
  });

  it('returns needs_decomposition=true for large bead', () => {
    const content = [
      '[● P1 · OPEN] pv-abc1',
      '',
      'DESCRIPTION',
      'Add calendar search feature.',
      '',
      'DESIGN',
      '- Add src/server/calendar/service/search.ts',
      '- Add src/server/calendar/api/v1/search.ts',
      '- Add src/client/components/SearchBar.vue',
      '- Add src/client/components/SearchResults.vue',
      '- Update src/client/locales/en.json',
      '- Modify src/server/calendar/entity/event.ts',
      'Spans backend API, frontend Vue, and i18n translation.',
    ].join('\n');
    const spawn = seqSpawn(fakeSpawn(content));
    const result = bdSizingCheck('pv-abc1', { spawnFn: spawn as never });
    expect(result.needs_decomposition).toBe(true);
  });
});

// =============================================================================
// stackCreate
// =============================================================================

describe('stackCreate', () => {
  it('runs gt create with --onto parent and --no-interactive', () => {
    const calls: string[] = [];
    const spawn = (cmd: string, args: string[], _opts: unknown) => {
      calls.push([cmd, ...(args as string[])].join(' '));
      return fakeSpawn('');
    };
    const result = stackCreate('feat.add-search', 'main', { spawnFn: spawn as never });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('gt create feat.add-search');
    expect(calls[0]).toContain('--onto main');
    expect(calls[0]).toContain('--no-interactive');
  });

  it('accepts branchName()-produced names verbatim (documented precondition)', () => {
    // stackCreate does not validate or rewrite branch names at runtime;
    // callers must pass names produced by branchName(). This test asserts
    // the precondition holds end to end: a branchName() output goes to gt
    // unchanged and carries no bead IDs.
    const name = branchName('Add calendar discovery surface', 'feature');
    const calls: string[] = [];
    const spawn = (cmd: string, args: string[], _opts: unknown) => {
      calls.push([cmd, ...(args as string[])].join(' '));
      return fakeSpawn('');
    };
    stackCreate(name, 'feat.parent-level', { spawnFn: spawn as never });
    expect(calls[0]).toContain(`gt create ${name}`);
    expect(calls[0]).not.toMatch(/pv-[a-z0-9]+/);
  });

  it('returns ok=false with stderr when gt create fails', () => {
    const spawn = seqSpawn(
      fakeSpawn('', 'ERROR: Cannot perform this operation on untracked branch xyz.', 1),
    );
    const result = stackCreate('feat.add-search', 'main', { spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('untracked branch');
  });
});

// =============================================================================
// stackSubmit
// =============================================================================

describe('stackSubmit', () => {
  it('runs gt submit non-interactively with --publish and an explicit --branch', () => {
    // --publish is load-bearing: on gt 1.8.6, --no-interactive submits new
    // PRs as drafts unless --publish is passed (verified 2026-07-11), and
    // the git-workflow skill forbids draft PRs.
    const calls: string[] = [];
    const spawn = (cmd: string, args: string[], _opts: unknown) => {
      calls.push([cmd, ...(args as string[])].join(' '));
      return fakeSpawn('✅ Submitted.');
    };
    const result = stackSubmit('feat.add-search', { spawnFn: spawn as never });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('gt submit');
    expect(calls[0]).toContain('--no-interactive');
    expect(calls[0]).toContain('--publish');
    expect(calls[0]).toContain('--branch feat.add-search');
  });

  it('returns ok=false with output when gt submit fails', () => {
    const spawn = seqSpawn(
      fakeSpawn('', 'ERROR: Validation failed; branches need restack.', 1),
    );
    const result = stackSubmit('feat.add-search', { spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('restack');
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
    // Head order follows input order: b2's chain head is b1 (first head
    // encountered in input order is b1 via... b2 is not a head; heads in
    // input order are b1 then b9).
    expect(first.chains).toEqual([['b1', 'b2'], ['b9', 'b5']]);
  });
});

// =============================================================================
// syncAndRestack
// =============================================================================

describe('syncAndRestack', () => {
  // Output lines below match observed gt 1.8.6 output (verified 2026-07-11).
  const syncOutput = [
    '🌲 Fetching branches from remote...',
    'main is up to date.',
    '',
    '🥞 Restacking branches...',
    'feat.level-one does not need to be restacked on main.',
    'Restacked feat.level-two on feat.level-one.',
    'WARNING: feat.level-three could not be restacked cleanly.',
    'Did not restack branch feat.level-four because it is checked out in worktree /some/worktree/path.',
    '',
    'You can resolve conflicts with gt restack.',
  ].join('\n');

  it('runs gt sync -f --no-interactive', () => {
    const calls: string[] = [];
    const spawn = (cmd: string, args: string[], _opts: unknown) => {
      calls.push([cmd, ...(args as string[])].join(' '));
      return fakeSpawn('main is up to date.');
    };
    syncAndRestack({ spawnFn: spawn as never });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('gt sync');
    expect(calls[0]).toContain('-f');
    expect(calls[0]).toContain('--no-interactive');
  });

  it('returns structured clean / conflicted / worktree-skipped results', () => {
    const spawn = seqSpawn(fakeSpawn(syncOutput));
    const result = syncAndRestack({ spawnFn: spawn as never });
    expect(result.restacked).toEqual(['feat.level-two']);
    expect(result.conflicted).toEqual(['feat.level-three']);
    expect(result.skippedWorktree).toEqual(['feat.level-four']);
    expect(result.rawOutput).toContain('Restacking branches');
  });

  it('reports ok=false when any branch conflicted', () => {
    const spawn = seqSpawn(fakeSpawn(syncOutput));
    const result = syncAndRestack({ spawnFn: spawn as never });
    expect(result.ok).toBe(false);
  });

  it('reports ok=true on a fully clean sync', () => {
    const clean = [
      'main is up to date.',
      '🥞 Restacking branches...',
      'feat.level-one does not need to be restacked on main.',
      'Restacked feat.level-two on feat.level-one.',
    ].join('\n');
    const spawn = seqSpawn(fakeSpawn(clean));
    const result = syncAndRestack({ spawnFn: spawn as never });
    expect(result.ok).toBe(true);
    expect(result.restacked).toEqual(['feat.level-two']);
    expect(result.conflicted).toEqual([]);
    expect(result.skippedWorktree).toEqual([]);
  });

  it('reports ok=false when gt sync itself exits non-zero', () => {
    const spawn = seqSpawn(fakeSpawn('', 'ERROR: network failure', 1));
    const result = syncAndRestack({ spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.rawOutput).toContain('network failure');
  });
});
