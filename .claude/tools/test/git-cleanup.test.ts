/**
 * Unit tests for .claude/tools/lib/git-cleanup.ts
 *
 * Pure functions are tested directly with canned command output. I/O
 * orchestration functions inject fake spawn/fs deps (later tasks).
 */

import { describe, it, expect } from 'vitest';
import {
  parseBranchRefs,
  parseWorktrees,
  worktreeFamily,
  parseOriginUrl,
  buildPrQuery,
  parsePrResponse,
  chunk,
} from '../lib/git-cleanup.js';
import { classifyBranch, type BranchInfo, type PrInfo } from '../lib/git-cleanup.js';

describe('parseBranchRefs', () => {
  // git for-each-ref refs/heads --format='%(refname:short)%09%(objectname)%09%(upstream:short)%09%(upstream:track)'
  it('parses branch, sha, upstream, and gone status', () => {
    const output = [
      'main\tabc123\torigin/main\t',
      'feat.done\tdef456\torigin/feat.done\t[gone]',
      'local-only\t789abc\t\t',
      'ahead\t111222\torigin/ahead\t[ahead 2]',
    ].join('\n');
    const refs = parseBranchRefs(output);
    expect(refs).toHaveLength(4);
    expect(refs[0]).toEqual({ name: 'main', sha: 'abc123', upstream: 'origin/main', upstreamGone: false });
    expect(refs[1]).toEqual({ name: 'feat.done', sha: 'def456', upstream: 'origin/feat.done', upstreamGone: true });
    expect(refs[2]).toEqual({ name: 'local-only', sha: '789abc', upstream: null, upstreamGone: false });
    expect(refs[3].upstreamGone).toBe(false);
  });

  it('returns empty array for empty output', () => {
    expect(parseBranchRefs('')).toEqual([]);
  });
});

describe('parseWorktrees', () => {
  it('parses porcelain blocks including locked and detached', () => {
    const output = [
      'worktree /Users/x/repo',
      'HEAD aaa111',
      'branch refs/heads/main',
      '',
      'worktree /Users/x/.superset/worktrees/uuid/foo',
      'HEAD bbb222',
      'branch refs/heads/foo',
      'locked started by agent',
      '',
      'worktree /Users/x/repo/.claude/worktrees/agent-1',
      'HEAD ccc333',
      'detached',
      '',
    ].join('\n');
    const wts = parseWorktrees(output);
    expect(wts).toHaveLength(3);
    expect(wts[0]).toEqual({ path: '/Users/x/repo', sha: 'aaa111', branch: 'main', locked: false, prunable: false });
    expect(wts[1].locked).toBe(true);
    expect(wts[1].branch).toBe('foo');
    expect(wts[2].branch).toBeNull();
  });
});

describe('worktreeFamily', () => {
  it('classifies the three known families and other', () => {
    expect(worktreeFamily('/Users/x/.superset/worktrees/uuid/foo')).toBe('superset');
    expect(worktreeFamily('/Users/x/repo/.claude/worktrees/agent-a1')).toBe('agent');
    expect(worktreeFamily('/Users/x/pavillion/pv-jdot-chains/chain-b')).toBe('chain');
    expect(worktreeFamily('/Users/x/somewhere/else')).toBe('other');
  });
});

describe('parseOriginUrl', () => {
  it('parses ssh and https remote urls', () => {
    expect(parseOriginUrl('git@github.com:stephenhoward/pavillion.git'))
      .toEqual({ owner: 'stephenhoward', repo: 'pavillion' });
    expect(parseOriginUrl('https://github.com/stephenhoward/pavillion.git'))
      .toEqual({ owner: 'stephenhoward', repo: 'pavillion' });
    expect(parseOriginUrl('https://github.com/stephenhoward/pavillion'))
      .toEqual({ owner: 'stephenhoward', repo: 'pavillion' });
    expect(parseOriginUrl('not-a-url')).toBeNull();
  });
});

describe('buildPrQuery', () => {
  it('aliases one pullRequests field per branch', () => {
    const q = buildPrQuery(['feat.a', 'fix/b'], 'me', 'repo');
    expect(q).toContain('repository(owner: "me", name: "repo")');
    expect(q).toContain('b0: pullRequests(headRefName: "feat.a"');
    expect(q).toContain('b1: pullRequests(headRefName: "fix/b"');
    expect(q).toContain('states: [OPEN, MERGED, CLOSED]');
  });

  it('escapes quotes in branch names', () => {
    const q = buildPrQuery(['we"ird'], 'me', 'repo');
    expect(q).toContain('headRefName: "we\\"ird"');
  });
});

describe('parsePrResponse', () => {
  it('maps aliases back to branch names', () => {
    const json = {
      data: {
        repository: {
          b0: { nodes: [{ number: 7, state: 'MERGED', headRefOid: 'abc' }] },
          b1: { nodes: [] },
        },
      },
    };
    const map = parsePrResponse(json, ['feat.a', 'fix/b']);
    expect(map.get('feat.a')).toEqual([{ number: 7, state: 'MERGED', headRefOid: 'abc' }]);
    expect(map.get('fix/b')).toEqual([]);
  });

  it('marks every branch lookup-failed on malformed response', () => {
    const map = parsePrResponse({ errors: [{ message: 'boom' }] }, ['a', 'b']);
    expect(map.get('a')).toBe('lookup-failed');
    expect(map.get('b')).toBe('lookup-failed');
  });
});

describe('chunk', () => {
  it('splits into fixed-size chunks', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

function branch(over: Partial<BranchInfo> = {}): BranchInfo {
  return { name: 'b', sha: 'aaa', upstream: 'origin/b', upstreamGone: false, ...over };
}
function pr(over: Partial<PrInfo> = {}): PrInfo {
  return { number: 1, state: 'MERGED', headRefOid: 'aaa', ...over };
}

describe('classifyBranch', () => {
  it('ancestor with upstream → merged-ancestor', () => {
    expect(classifyBranch(branch(), true, 0, null).category).toBe('merged-ancestor');
  });

  it('ancestor with gone upstream → merged-ancestor', () => {
    expect(classifyBranch(branch({ upstreamGone: true }), true, 0, null).category).toBe('merged-ancestor');
  });

  it('ancestor with no upstream → empty', () => {
    expect(classifyBranch(branch({ upstream: null }), true, 0, null).category).toBe('empty');
  });

  it('non-ancestor with MERGED PR at branch tip → merged-pr', () => {
    const c = classifyBranch(branch(), false, 3, [pr()]);
    expect(c.category).toBe('merged-pr');
    expect(c.reason).toContain('#1');
  });

  it('non-ancestor MERGED PR but tip moved past it → doubt (ahead of merged PR)', () => {
    const c = classifyBranch(branch({ sha: 'bbb' }), false, 5, [pr({ headRefOid: 'aaa' })]);
    expect(c.category).toBe('doubt');
    expect(c.reason).toContain('ahead of merged PR');
  });

  it('OPEN PR → doubt', () => {
    const c = classifyBranch(branch(), false, 2, [pr({ state: 'OPEN' })]);
    expect(c.category).toBe('doubt');
    expect(c.reason).toContain('open PR');
  });

  it('only CLOSED PRs → doubt (closed without merging)', () => {
    const c = classifyBranch(branch(), false, 2, [pr({ state: 'CLOSED' })]);
    expect(c.category).toBe('doubt');
    expect(c.reason).toContain('closed without merging');
  });

  it('gone upstream, unique commits, no PR → doubt', () => {
    const c = classifyBranch(branch({ upstreamGone: true }), false, 4, []);
    expect(c.category).toBe('doubt');
    expect(c.reason).toContain('4');
  });

  it('no upstream, unique commits → doubt', () => {
    const c = classifyBranch(branch({ upstream: null }), false, 2, []);
    expect(c.category).toBe('doubt');
    expect(c.reason).toContain('no upstream');
  });

  it('lookup failure → doubt, never merged', () => {
    const c = classifyBranch(branch(), false, 1, 'lookup-failed');
    expect(c.category).toBe('doubt');
    expect(c.reason).toContain('lookup failed');
  });

  it('a MERGED PR at tip wins over an older CLOSED PR', () => {
    const c = classifyBranch(branch(), false, 1, [pr({ state: 'CLOSED', number: 2 }), pr()]);
    expect(c.category).toBe('merged-pr');
  });
});
