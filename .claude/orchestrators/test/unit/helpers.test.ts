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
  it('returns ok=true when inside repo, on main, clean tree', () => {
    const spawn = seqSpawn(
      fakeSpawn('true'),         // rev-parse --is-inside-work-tree
      fakeSpawn('main'),         // rev-parse --abbrev-ref HEAD
      fakeSpawn(''),             // git status --porcelain (empty = clean)
    );
    const result = gitSafeToStart({ spawnFn: spawn as never });
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns ok=false with reason when on wrong branch', () => {
    const spawn = seqSpawn(
      fakeSpawn('true'),         // rev-parse --is-inside-work-tree
      fakeSpawn('feat/my-work'), // wrong branch
      fakeSpawn(''),             // status (won't be called but safe to stub)
    );
    const result = gitSafeToStart({ spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('feat/my-work');
  });

  it('returns ok=false when tree is dirty', () => {
    const spawn = seqSpawn(
      fakeSpawn('true'),
      fakeSpawn('main'),
      fakeSpawn(' M src/server/app.ts\n'), // dirty
    );
    const result = gitSafeToStart({ spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('dirty');
  });

  it('returns ok=false when not inside a git repo', () => {
    const spawn = seqSpawn(fakeSpawn('', 'not a repo', 128));
    const result = gitSafeToStart({ spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('work tree');
  });
});

// =============================================================================
// preflight
// =============================================================================

describe('preflight', () => {
  it('returns ok=true when all checks pass', () => {
    // Calls in order: git status, git branch --show-current, git fetch, git diff,
    // bd ready --json, bd label list (per bead)
    const beadsJson = JSON.stringify([
      { id: 'pv-abc1', priority: 1, created_at: '2026-01-01' },
    ]);
    const spawn = seqSpawn(
      fakeSpawn(''),           // git status --porcelain (clean)
      fakeSpawn('main'),       // git branch --show-current
      fakeSpawn(''),           // git fetch origin main (success)
      fakeSpawn('', '', 0),   // git diff origin/main --quiet (no diff)
      fakeSpawn(beadsJson),   // bd ready --json
      fakeSpawn('  - backlog'),  // bd label list pv-abc1 (no needs-human)
    );
    const result = preflight({ spawnFn: spawn as never });
    expect(result.ok).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('reports dirty_tree and wrong_branch failures', () => {
    const spawn = seqSpawn(
      fakeSpawn(' M src/file.ts'),   // dirty
      fakeSpawn('feat/branch'),       // wrong branch
      fakeSpawn('', '', 1),           // fetch fails → stale_main
      fakeSpawn('[]'),               // bd ready (empty → empty_backlog)
    );
    const result = preflight({ spawnFn: spawn as never });
    expect(result.ok).toBe(false);
    const kinds = result.failures.map(f => f.kind);
    expect(kinds).toContain('dirty_tree');
    expect(kinds).toContain('wrong_branch');
    expect(kinds).toContain('stale_main');
    expect(kinds).toContain('empty_backlog');
  });

  it('reports empty_backlog when all ready beads have needs-human label', () => {
    const beadsJson = JSON.stringify([{ id: 'pv-x1', priority: 1, created_at: '2026-01-01' }]);
    const spawn = seqSpawn(
      fakeSpawn(''),              // clean tree
      fakeSpawn('main'),          // on main
      fakeSpawn(''),              // fetch ok
      fakeSpawn('', '', 0),      // no diff
      fakeSpawn(beadsJson),       // bd ready
      fakeSpawn('  - needs-human'),  // label list: has needs-human
    );
    const result = preflight({ spawnFn: spawn as never });
    expect(result.failures.map(f => f.kind)).toContain('empty_backlog');
  });

  // ---------------------------------------------------------------------------
  // Orphan branch recovery
  // ---------------------------------------------------------------------------

  it('recovers from an orphaned orchestrator branch and continues preflight', () => {
    // Branch matches pattern, tree clean, no commits ahead, no open PR →
    // checkout main and proceed without reporting wrong_branch.
    const beadsJson = JSON.stringify([{ id: 'pv-x1', priority: 1, created_at: '2026-01-01' }]);
    const spawn = seqSpawn(
      fakeSpawn(''),                           // git status (clean)
      fakeSpawn('chore/some-title-pv-abc'),    // git branch --show-current
      // canRecoverOrphanBranch:
      fakeSpawn(''),                           // git status (clean)
      fakeSpawn('0'),                          // git rev-list --count main..branch
      fakeSpawn('[]'),                         // gh pr list (no open PR)
      fakeSpawn('', '', 0),                    // git checkout main (success)
      // Resume preflight:
      fakeSpawn('', '', 0),                    // git fetch origin main
      fakeSpawn('', '', 0),                    // git diff (no diff)
      fakeSpawn(beadsJson),                    // bd ready
      fakeSpawn('  - other'),                  // bd label list pv-x1
    );
    const result = preflight({ spawnFn: spawn as never });
    expect(result.ok).toBe(true);
    expect(result.recovered).toEqual({ orphanedBranch: 'chore/some-title-pv-abc' });
    expect(result.failures.map(f => f.kind)).not.toContain('wrong_branch');
  });

  it('does not recover when branch has commits ahead of main', () => {
    const spawn = seqSpawn(
      fakeSpawn(''),                              // git status (clean)
      fakeSpawn('feat/wip-pv-xyz'),               // git branch
      // canRecoverOrphanBranch:
      fakeSpawn(''),                              // git status (clean)
      fakeSpawn('3'),                             // git rev-list: 3 commits ahead → refuse
      // No checkout; proceed with wrong_branch failure:
      fakeSpawn('', '', 0),                       // git fetch
      fakeSpawn('', '', 0),                       // git diff
      fakeSpawn('[]'),                            // bd ready (empty)
    );
    const result = preflight({ spawnFn: spawn as never });
    expect(result.recovered).toBeUndefined();
    expect(result.failures.map(f => f.kind)).toContain('wrong_branch');
  });

  it('does not recover when branch has an open PR', () => {
    const spawn = seqSpawn(
      fakeSpawn(''),                              // git status
      fakeSpawn('fix/bug-pv-pqr'),                // git branch
      fakeSpawn(''),                              // git status (recovery check)
      fakeSpawn('0'),                             // no commits ahead
      fakeSpawn('[{"number":101}]'),              // gh pr list: open PR exists → refuse
      fakeSpawn('', '', 0),                       // git fetch
      fakeSpawn('', '', 0),                       // git diff
      fakeSpawn('[]'),                            // bd ready
    );
    const result = preflight({ spawnFn: spawn as never });
    expect(result.recovered).toBeUndefined();
    expect(result.failures.map(f => f.kind)).toContain('wrong_branch');
  });

  it('does not recover non-orchestrator-looking branch names', () => {
    // Branch doesn't match pattern → skip recovery entirely, report wrong_branch.
    const spawn = seqSpawn(
      fakeSpawn(''),                              // git status
      fakeSpawn('my-local-experiment'),           // git branch — no type prefix
      // canRecoverOrphanBranch returns false on pattern mismatch — no extra calls
      fakeSpawn('', '', 0),                       // git fetch
      fakeSpawn('', '', 0),                       // git diff
      fakeSpawn('[]'),                            // bd ready
    );
    const result = preflight({ spawnFn: spawn as never });
    expect(result.recovered).toBeUndefined();
    expect(result.failures.map(f => f.kind)).toContain('wrong_branch');
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
    expect(result.missing_phases).toContain('decomposed');
    expect(result.missing_phases).not.toContain('shaped');
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
    expect(result).toBe('chore/fix-the-broken-widget');
  });

  it('uses feat prefix for feature type', () => {
    const result = branchName('Add calendar discovery', 'feature');
    expect(result).toMatch(/^feat\//);
  });

  it('uses feat prefix for epic type', () => {
    const result = branchName('Build search', 'epic');
    expect(result).toMatch(/^feat\//);
  });

  it('uses fix prefix for bug type', () => {
    const result = branchName('Fix broken links', 'bug');
    expect(result).toMatch(/^fix\//);
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
    expect(result).toMatch(/^chore\//);
    expect(result.endsWith('-')).toBe(false);
  });

  it('defaults to chore for unknown issue type', () => {
    const result = branchName('Some work', 'unknown');
    expect(result).toMatch(/^chore\//);
  });

  it('strips leading and trailing non-alphanumerics from the title', () => {
    const result = branchName('  --Add Search-- ', 'feature');
    expect(result).toBe('feat/add-search');
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
