/**
 * Unit tests for .agents/tools/lib/bead.ts
 *
 * bdEscalate injects a fake spawnFn that returns canned responses.
 */

import { describe, it, expect } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { bdEscalate } from '../lib/bead.js';

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

