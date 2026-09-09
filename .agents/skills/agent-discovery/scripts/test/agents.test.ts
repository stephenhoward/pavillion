/**
 * Unit tests for .agents/skills/agent-discovery/scripts/lib/agents.ts
 *
 * discoverAgents reads a temp fixture directory of agent definition files.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverAgents } from '../lib/agents.js';

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
