/**
 * Unit tests for .claude/tools/lib/bead.ts
 *
 * Pure functions (classifyBeadState, classifySizing) are tested directly
 * with inputs. CLI-calling functions (bdState, bdSizingCheck,
 * bdEnrichmentCheck, bdEscalate) inject a fake spawnFn that returns canned
 * responses. discoverAgents reads a temp fixture directory.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bdState,
  classifyBeadState,
  bdSizingCheck,
  classifySizing,
  bdEnrichmentCheck,
  bdEscalate,
  discoverAgents,
} from '../lib/bead.js';

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
// bdState
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
// discoverAgents
// =============================================================================

describe('discoverAgents', () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'agents-'));
    writeFileSync(join(fixtureDir, 'security-auditor.md'), [
      '---',
      'name: security-auditor',
      'description: "Post-code security audit of implemented changes."',
      '---',
      'Body.',
    ].join('\n'));
    writeFileSync(join(fixtureDir, 'privacy-advisor.md'), [
      '---',
      'name: privacy-advisor',
      'description: Pre-code spec reviewer for privacy gaps.',
      '---',
      'Body.',
    ].join('\n'));
    writeFileSync(join(fixtureDir, 'no-frontmatter-auditor.md'), 'Just a body, no frontmatter.');
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('lists agents matching the suffix with name and description from frontmatter', () => {
    const agents = discoverAgents('auditor', fixtureDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('security-auditor');
    expect(agents[0].description).toBe('Post-code security audit of implemented changes.');
  });

  it('matches other suffixes independently and unquotes plain descriptions', () => {
    const agents = discoverAgents('advisor', fixtureDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('privacy-advisor');
    expect(agents[0].description).toBe('Pre-code spec reviewer for privacy gaps.');
  });

  it('returns an empty list for a missing directory', () => {
    expect(discoverAgents('auditor', join(fixtureDir, 'does-not-exist'))).toEqual([]);
  });
});
