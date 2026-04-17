/**
 * Unit tests for .claude/orchestrators/lib/helpers.ts
 *
 * Pure functions (classifyBeadState, classifySizing, branchName, commitMsg,
 * prBody, fileTags, matchAgents) are tested directly with inputs.
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
  bdState,
  classifyBeadState,
  bdSizingCheck,
  classifySizing,
  bdEnrichmentCheck,
  branchName,
  commitMsg,
  prBody,
  fileTags,
  matchAgents,
  type AgentInfo,
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
    const result = branchName('pv-abc1', 'Fix the broken widget', 'task');
    expect(result).toMatch(/^chore\//);
    expect(result).toContain('fix-the-broken-widget');
    expect(result).toContain('pv-abc1');
  });

  it('uses feat prefix for feature type', () => {
    const result = branchName('pv-abc2', 'Add calendar discovery', 'feature');
    expect(result).toMatch(/^feat\//);
  });

  it('uses fix prefix for bug type', () => {
    const result = branchName('pv-abc3', 'Fix broken links', 'bug');
    expect(result).toMatch(/^fix\//);
  });

  it('replaces dots in bead id with hyphens', () => {
    const result = branchName('pv-abc1.3', 'Some task', 'task');
    expect(result).toContain('pv-abc1-3');
    expect(result).not.toContain('pv-abc1.3');
  });

  it('truncates long titles to stay within 60 chars', () => {
    const longTitle = 'This is a very long title that would exceed the maximum length limit easily';
    const result = branchName('pv-abc1', longTitle, 'task');
    expect(result.length).toBeLessThanOrEqual(60);
  });

  it('defaults to chore for unknown issue type', () => {
    const result = branchName('pv-abc1', 'Some work', 'unknown');
    expect(result).toMatch(/^chore\//);
  });
});

// =============================================================================
// commitMsg (pure)
// =============================================================================

describe('commitMsg', () => {
  it('formats correctly without scope', () => {
    const result = commitMsg('pv-abc1', 'Add event search', 'feature');
    expect(result).toBe('feat: Add event search (pv-abc1)');
  });

  it('includes scope when provided', () => {
    const result = commitMsg('pv-abc1', 'Fix calendar API', 'bug', 'calendar');
    expect(result).toBe('fix(calendar): Fix calendar API (pv-abc1)');
  });

  it('maps epic to feat', () => {
    const result = commitMsg('pv-abc1', 'Implement federation', 'epic');
    expect(result).toMatch(/^feat:/);
  });

  it('collapses newlines in summary', () => {
    const result = commitMsg('pv-abc1', 'Line one\nLine two', 'task');
    expect(result).not.toContain('\n');
    expect(result).toContain('Line one Line two');
  });
});

// =============================================================================
// prBody (pure)
// =============================================================================

describe('prBody', () => {
  it('includes all three sections', () => {
    const body = prBody(
      'Add event search',
      'This feature allows users to search for events.',
      [{ id: 'pv-abc1', title: 'Add event search' }],
    );
    expect(body).toContain('## Summary');
    expect(body).toContain('## Beads closed');
    expect(body).toContain('## Test plan');
  });

  it('lists all beads in Beads closed section', () => {
    const body = prBody(
      'Epic: Build search',
      'Description text.',
      [
        { id: 'pv-abc1', title: 'Parent epic' },
        { id: 'pv-abc1.1', title: 'Child one' },
        { id: 'pv-abc1.2', title: 'Child two' },
      ],
    );
    expect(body).toContain('pv-abc1');
    expect(body).toContain('pv-abc1.1');
    expect(body).toContain('pv-abc1.2');
  });

  it('uses first sentence of description in summary', () => {
    const body = prBody(
      'Add feature',
      'First sentence text. Second sentence should be excluded.',
      [{ id: 'pv-abc1', title: 'Add feature' }],
    );
    expect(body).toContain('First sentence text.');
    expect(body).not.toContain('Second sentence');
  });

  it('omits description line when no description', () => {
    const body = prBody('Add feature', '', [{ id: 'pv-abc1', title: 'Add feature' }]);
    // Should still have summary with just the title
    expect(body).toContain('## Summary');
    expect(body).toContain('- Add feature');
  });
});

// =============================================================================
// fileTags (pure)
// =============================================================================

describe('fileTags', () => {
  it('tags .vue files as vue', () => {
    expect(fileTags('src/client/components/edit-event.vue')).toContain('vue');
  });

  it('tags .scss files as scss', () => {
    expect(fileTags('src/client/assets/styles.scss')).toContain('scss');
  });

  it('tags test files as test', () => {
    expect(fileTags('src/server/calendar/test/calendar.test.ts')).toContain('test');
    expect(fileTags('src/server/calendar/test/calendar.spec.ts')).toContain('test');
  });

  it('tags api files correctly', () => {
    expect(fileTags('src/server/calendar/api/v1/events.ts')).toContain('api');
  });

  it('tags entity and model files', () => {
    expect(fileTags('src/server/calendar/entity/calendar.ts')).toContain('entity');
    expect(fileTags('src/common/model/calendar.ts')).toContain('model');
    expect(fileTags('src/server/calendar/model/calendar.ts')).toContain('model');
  });

  it('tags service files', () => {
    expect(fileTags('src/server/calendar/service/calendar.ts')).toContain('service');
  });

  it('tags migration files', () => {
    expect(fileTags('src/server/calendar/migrations/001-add-column.ts')).toContain('migration');
  });

  it('tags i18n locale files', () => {
    expect(fileTags('src/client/locales/en.json')).toContain('i18n');
    expect(fileTags('src/site/locales/en.json')).toContain('i18n');
  });

  it('tags shell scripts as script', () => {
    expect(fileTags('.claude/skills/some-skill/helper.sh')).toContain('script');
  });

  it('tags .claude/ and docs/ files as infra', () => {
    expect(fileTags('.claude/orchestrators/lib/helpers.ts')).toContain('infra');
    expect(fileTags('docs/superpowers/design.md')).toContain('infra');
  });

  it('returns empty array for untagged files', () => {
    expect(fileTags('src/server/app.ts')).toHaveLength(0);
  });

  it('can return multiple tags for one file', () => {
    // A .test.vue file in a locales context would be both test and vue
    const tags = fileTags('src/client/components/MyComponent.test.vue');
    expect(tags).toContain('test');
    expect(tags).toContain('vue');
  });
});

// =============================================================================
// matchAgents (pure)
// =============================================================================

describe('matchAgents', () => {
  const agents: AgentInfo[] = [
    { name: 'accessibility-auditor', path: '/agents/accessibility-auditor.md', description: 'WCAG auditor' },
    { name: 'security-auditor', path: '/agents/security-auditor.md', description: 'Security checks' },
    { name: 'testing-auditor', path: '/agents/testing-auditor.md', description: 'Test quality' },
    { name: 'complexity-auditor', path: '/agents/complexity-auditor.md', description: 'Complexity' },
  ];

  it('returns empty array when no files provided', () => {
    expect(matchAgents(agents, [])).toHaveLength(0);
  });

  it('matches accessibility-auditor for .vue files', () => {
    const matched = matchAgents(agents, ['src/client/components/edit-event.vue']);
    const names = matched.map(a => a.name);
    expect(names).toContain('accessibility-auditor');
    expect(names).not.toContain('security-auditor');
  });

  it('matches security-auditor for api files', () => {
    const matched = matchAgents(agents, ['src/server/calendar/api/v1/events.ts']);
    const names = matched.map(a => a.name);
    expect(names).toContain('security-auditor');
  });

  it('matches testing-auditor for test files', () => {
    const matched = matchAgents(agents, ['src/server/calendar/test/calendar.test.ts']);
    const names = matched.map(a => a.name);
    expect(names).toContain('testing-auditor');
    expect(names).not.toContain('accessibility-auditor');
  });

  it('includes rationale with file name, tag, and agent name', () => {
    const matched = matchAgents(agents, ['src/client/components/edit-event.vue']);
    const auditor = matched.find(a => a.name === 'accessibility-auditor');
    expect(auditor?.rationale).toContain('edit-event.vue');
    expect(auditor?.rationale).toContain('accessibility-auditor');
    expect(auditor?.rationale).toContain('vue');
  });

  it('skips agents with no tag table entry', () => {
    const unknownAgents: AgentInfo[] = [
      { name: 'unknown-agent', path: '/agents/unknown-agent.md', description: 'Unknown' },
    ];
    const matched = matchAgents(unknownAgents, ['src/client/components/edit-event.vue']);
    expect(matched).toHaveLength(0);
  });

  it('matches multiple agents when multiple tags present', () => {
    // A .vue file will match accessibility, complexity, and potentially others
    const matched = matchAgents(agents, ['src/client/components/edit-event.vue']);
    expect(matched.length).toBeGreaterThanOrEqual(2);
  });
});

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
