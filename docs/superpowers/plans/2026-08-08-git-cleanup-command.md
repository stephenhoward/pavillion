# /git-cleanup Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/git-cleanup` slash command that classifies local branches/worktrees as merged/empty/doubtful via a deterministic script, gets category-level approval through AskUserQuestion, and deletes only what was approved and re-verified.

**Architecture:** All logic lives in `.claude/tools/lib/git-cleanup.ts` (pure/stubbable functions per the `stack.ts` pattern); `.claude/tools/git-cleanup.ts` is a thin CLI with `classify` and `execute` subcommands; `.claude/commands/git-cleanup.md` is a thin command wrapper. `execute` re-verifies through the **same predicate functions** `classify` uses — a parallel re-implementation of any safety check is a design violation (spec constraint).

**Tech Stack:** TypeScript run via `npx tsx`, vitest (config at `.claude/tools/vitest.config.ts`), `gh api graphql` for PR-state lookup.

**Spec:** `docs/superpowers/specs/2026-08-08-git-cleanup-command-design.md` — read it before starting. Constants copied from it below.

## Global Constraints

- Doubts are report-only. No code path may delete a `doubt`-category item.
- Protections are hard-coded, never overridable by approval: `main`, primary-checkout branch, current session's worktree/branch, live-process worktrees (lsof cwd), locked worktrees, worktrees modified < 30 min ago, dirty worktrees.
- `git worktree remove` is always called **without** `--force`.
- Never assume merged on a GitHub lookup failure — classify as doubt.
- mtime threshold: 30 minutes. Plan staleness limit: 60 minutes. GraphQL batch size: 50. All hard-coded constants, not config.
- Plan/report/undo files live in the repo's **common** git dir (`git rev-parse --git-common-dir`) — the script may run from a worktree whose `.git` is a file.
- Undo log line format: `<branch> <sha>`, appended to `<common-dir>/git-cleanup-undo-<YYYY-MM-DD>.log` before each deletion.
- Commit messages: conventional format per `.claude/skills/git-workflow/commits.md`. No AI-attribution trailers, no bead IDs.
- Run tests with: `npx vitest run --config .claude/tools/vitest.config.ts`

## File Structure

- Create: `.claude/tools/lib/git-cleanup.ts` — types, parsers, classification, protection predicates, plan assembly, report renderer, execute logic. One lib file, matching `lib/stack.ts` convention.
- Create: `.claude/tools/git-cleanup.ts` — CLI entry, JSON to stdout, matching `stack.ts` shape.
- Create: `.claude/tools/test/git-cleanup.test.ts` — unit tests using the `fakeSpawn`/`seqSpawn` helper pattern from `test/stack.test.ts`.
- Create: `.claude/commands/git-cleanup.md` — thin command wrapper, matching `restack.md` tone.

---

### Task 1: Types and parsers

**Files:**
- Create: `.claude/tools/lib/git-cleanup.ts`
- Create: `.claude/tools/test/git-cleanup.test.ts`

**Interfaces:**
- Consumes: `run`, `SpawnDeps` from `./shared.js` (existing).
- Produces (later tasks rely on these exact names):
  - `type Category = 'merged-ancestor' | 'merged-pr' | 'empty' | 'doubt'`
  - `type WorktreeFamily = 'superset' | 'agent' | 'chain' | 'other'`
  - `interface BranchInfo { name: string; sha: string; upstream: string | null; upstreamGone: boolean }`
  - `interface WorktreeInfo { path: string; sha: string; branch: string | null; locked: boolean; prunable: boolean }`
  - `parseBranchRefs(output: string): BranchInfo[]`
  - `parseWorktrees(output: string): WorktreeInfo[]`
  - `worktreeFamily(path: string): WorktreeFamily`

- [ ] **Step 1: Write failing tests for the parsers**

In `.claude/tools/test/git-cleanup.test.ts`:

```typescript
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
} from '../lib/git-cleanup.js';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config .claude/tools/vitest.config.ts`
Expected: FAIL — module `../lib/git-cleanup.js` not found.

- [ ] **Step 3: Implement types and parsers**

In `.claude/tools/lib/git-cleanup.ts`:

```typescript
/**
 * Classification and execution logic for the /git-cleanup command.
 *
 * Design spec: docs/superpowers/specs/2026-08-08-git-cleanup-command-design.md
 *
 * Safety invariant: execute() re-verifies through the SAME predicate
 * functions classify() uses. Do not add a parallel implementation of any
 * deletability or protection check.
 */

export type Category = 'merged-ancestor' | 'merged-pr' | 'empty' | 'doubt';
export type WorktreeFamily = 'superset' | 'agent' | 'chain' | 'other';

export interface BranchInfo {
  name: string;
  sha: string;
  upstream: string | null;
  upstreamGone: boolean;
}

export interface WorktreeInfo {
  path: string;
  sha: string;
  branch: string | null;
  locked: boolean;
  prunable: boolean;
}

/** Parse `git for-each-ref refs/heads --format='%(refname:short)%09%(objectname)%09%(upstream:short)%09%(upstream:track)'`. */
export function parseBranchRefs(output: string): BranchInfo[] {
  return output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [name, sha, upstream, track] = line.split('\t');
      return {
        name,
        sha,
        upstream: upstream ? upstream : null,
        upstreamGone: track === '[gone]',
      };
    });
}

/** Parse `git worktree list --porcelain` blocks. */
export function parseWorktrees(output: string): WorktreeInfo[] {
  const result: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), branch: null, locked: false, prunable: false };
    }
    else if (current && line.startsWith('HEAD ')) current.sha = line.slice('HEAD '.length);
    else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
    else if (current && (line === 'locked' || line.startsWith('locked '))) current.locked = true;
    else if (current && (line === 'prunable' || line.startsWith('prunable '))) current.prunable = true;
    else if (current && line.trim() === '') {
      result.push(current as WorktreeInfo);
      current = null;
    }
  }
  if (current) result.push(current as WorktreeInfo);
  return result;
}

export function worktreeFamily(path: string): WorktreeFamily {
  if (path.includes('/.superset/worktrees/')) return 'superset';
  if (path.includes('/.claude/worktrees/')) return 'agent';
  if (path.includes('/pv-jdot-chains/')) return 'chain';
  return 'other';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config .claude/tools/vitest.config.ts`
Expected: PASS (existing stack/bead tests must stay green too).

- [ ] **Step 5: Commit**

```bash
git add .claude/tools/lib/git-cleanup.ts .claude/tools/test/git-cleanup.test.ts
git commit -m "feat(tools): add git-cleanup branch and worktree parsers"
```

---

### Task 2: GitHub PR lookup

**Files:**
- Modify: `.claude/tools/lib/git-cleanup.ts` (append)
- Modify: `.claude/tools/test/git-cleanup.test.ts` (append)

**Interfaces:**
- Produces:
  - `interface PrInfo { number: number; state: 'OPEN' | 'MERGED' | 'CLOSED'; headRefOid: string }`
  - `type PrLookup = Map<string, PrInfo[] | 'lookup-failed'>`
  - `parseOriginUrl(url: string): { owner: string; repo: string } | null`
  - `buildPrQuery(branches: string[], owner: string, repo: string): string`
  - `parsePrResponse(json: unknown, branches: string[]): PrLookup`
  - `chunk<T>(items: T[], size: number): T[][]`

Batching exists only to stay under GraphQL alias limits (50 per query — one query at current repo scale); keep it a plain array-chunk loop.

- [ ] **Step 1: Write failing tests**

Append to `.claude/tools/test/git-cleanup.test.ts`:

```typescript
import {
  parseOriginUrl,
  buildPrQuery,
  parsePrResponse,
  chunk,
} from '../lib/git-cleanup.js';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config .claude/tools/vitest.config.ts`
Expected: FAIL — named exports missing.

- [ ] **Step 3: Implement**

Append to `.claude/tools/lib/git-cleanup.ts`:

```typescript
export interface PrInfo {
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  headRefOid: string;
}

/** Per-branch PR lookup result. 'lookup-failed' → classify as doubt, never merged. */
export type PrLookup = Map<string, PrInfo[] | 'lookup-failed'>;

export function parseOriginUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function buildPrQuery(branches: string[], owner: string, repo: string): string {
  const fields = branches
    .map((name, i) => {
      const escaped = name.replace(/"/g, '\\"');
      return `    b${i}: pullRequests(headRefName: "${escaped}", states: [OPEN, MERGED, CLOSED], first: 10) { nodes { number state headRefOid } }`;
    })
    .join('\n');
  return `query {\n  repository(owner: "${owner}", name: "${repo}") {\n${fields}\n  }\n}`;
}

export function parsePrResponse(json: unknown, branches: string[]): PrLookup {
  const map: PrLookup = new Map();
  const repository = (json as { data?: { repository?: Record<string, { nodes?: PrInfo[] }> } })
    ?.data?.repository;
  if (!repository) {
    for (const b of branches) map.set(b, 'lookup-failed');
    return map;
  }
  branches.forEach((name, i) => {
    const nodes = repository[`b${i}`]?.nodes;
    map.set(name, Array.isArray(nodes) ? nodes : 'lookup-failed');
  });
  return map;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config .claude/tools/vitest.config.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/tools/lib/git-cleanup.ts .claude/tools/test/git-cleanup.test.ts
git commit -m "feat(tools): add batched GitHub PR-state lookup for git-cleanup"
```

---

### Task 3: Branch classification

**Files:**
- Modify: `.claude/tools/lib/git-cleanup.ts` (append)
- Modify: `.claude/tools/test/git-cleanup.test.ts` (append)

**Interfaces:**
- Consumes: `BranchInfo`, `PrInfo` (Tasks 1–2).
- Produces:
  - `interface Classified { category: Category; reason: string }`
  - `classifyBranch(branch: BranchInfo, isAncestor: boolean, aheadCount: number, prs: PrInfo[] | 'lookup-failed' | null): Classified`

`prs` is `null` when no lookup was needed (ancestors skip GitHub). Protected branches are filtered out *before* classification (Task 5) — `classifyBranch` never sees them.

- [ ] **Step 1: Write failing tests — one per spec rule**

Append to `.claude/tools/test/git-cleanup.test.ts`:

```typescript
import { classifyBranch, type BranchInfo, type PrInfo } from '../lib/git-cleanup.js';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config .claude/tools/vitest.config.ts`
Expected: FAIL — `classifyBranch` not exported.

- [ ] **Step 3: Implement**

Append to `.claude/tools/lib/git-cleanup.ts`:

```typescript
export interface Classified {
  category: Category;
  reason: string;
}

/**
 * Assign one category per branch. `prs` is null for ancestors (no GitHub
 * lookup needed), 'lookup-failed' when GitHub could not be consulted —
 * which is always a doubt, never an assumed merge.
 */
export function classifyBranch(
  branch: BranchInfo,
  isAncestor: boolean,
  aheadCount: number,
  prs: PrInfo[] | 'lookup-failed' | null,
): Classified {
  if (isAncestor) {
    return branch.upstream === null
      ? { category: 'empty', reason: 'no upstream, no commits beyond main' }
      : { category: 'merged-ancestor', reason: 'tip is an ancestor of origin/main' };
  }
  if (prs === 'lookup-failed' || prs === null) {
    return { category: 'doubt', reason: 'GitHub PR lookup failed — cannot prove merge' };
  }
  const mergedAtTip = prs.find((p) => p.state === 'MERGED' && p.headRefOid === branch.sha);
  if (mergedAtTip) {
    return { category: 'merged-pr', reason: `PR #${mergedAtTip.number} merged at branch tip` };
  }
  const merged = prs.find((p) => p.state === 'MERGED');
  if (merged) {
    return { category: 'doubt', reason: `ahead of merged PR #${merged.number} — has commits after the merge` };
  }
  const open = prs.find((p) => p.state === 'OPEN');
  if (open) {
    return { category: 'doubt', reason: `open PR #${open.number}` };
  }
  const closed = prs.find((p) => p.state === 'CLOSED');
  if (closed) {
    return { category: 'doubt', reason: `PR #${closed.number} closed without merging` };
  }
  if (branch.upstream === null) {
    return { category: 'doubt', reason: `no upstream, ${aheadCount} unique commit(s)` };
  }
  return {
    category: 'doubt',
    reason: `${branch.upstreamGone ? 'upstream gone' : 'unmerged'}, ${aheadCount} commit(s) not on main, no PR found`,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config .claude/tools/vitest.config.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/tools/lib/git-cleanup.ts .claude/tools/test/git-cleanup.test.ts
git commit -m "feat(tools): add git-cleanup branch classification with doubt reasons"
```

---

### Task 4: Worktree protection predicates

**Files:**
- Modify: `.claude/tools/lib/git-cleanup.ts` (append)
- Modify: `.claude/tools/test/git-cleanup.test.ts` (append)

**Interfaces:**
- Consumes: `WorktreeInfo` (Task 1).
- Produces (execute's re-verify MUST reuse these — spec's shared-predicate constraint):
  - `MTIME_THRESHOLD_MS = 30 * 60_000`
  - `isDirty(statusOutput: string): boolean`
  - `isRecentlyModified(mtimesMs: number[], nowMs: number): boolean`
  - `parseCwdPaths(lsofOutput: string): string[]`
  - `isActiveWorktree(path: string, cwds: string[]): boolean`
  - `interface WorktreeChecks { locked: boolean; dirty: boolean; recentlyModified: boolean; active: boolean; isCurrentSession: boolean; isPrimary: boolean }`
  - `assessWorktree(checks: WorktreeChecks): { removable: boolean; reason: string }`

Note: `lsof` (live process *right now*) and mtime (worktree just provisioned, agent not started yet) overlap but are not redundant — each covers the other's gap. Both stay (spec).

- [ ] **Step 1: Write failing tests**

Append to `.claude/tools/test/git-cleanup.test.ts`:

```typescript
import {
  isDirty,
  isRecentlyModified,
  parseCwdPaths,
  isActiveWorktree,
  assessWorktree,
  MTIME_THRESHOLD_MS,
  type WorktreeChecks,
} from '../lib/git-cleanup.js';

const cleanChecks: WorktreeChecks = {
  locked: false, dirty: false, recentlyModified: false,
  active: false, isCurrentSession: false, isPrimary: false,
};

describe('isDirty', () => {
  it('is true for any porcelain output, false for empty', () => {
    expect(isDirty(' M src/foo.ts')).toBe(true);
    expect(isDirty('?? new-file')).toBe(true);
    expect(isDirty('')).toBe(false);
    expect(isDirty('  \n')).toBe(false);
  });
});

describe('isRecentlyModified', () => {
  const now = 1_000_000_000_000;
  it('is true when any mtime is within the 30-minute threshold', () => {
    expect(isRecentlyModified([now - MTIME_THRESHOLD_MS + 1000], now)).toBe(true);
    expect(isRecentlyModified([now - MTIME_THRESHOLD_MS - 1000, now - 1000], now)).toBe(true);
  });
  it('is false when all mtimes are older than the threshold', () => {
    expect(isRecentlyModified([now - MTIME_THRESHOLD_MS - 1000], now)).toBe(false);
    expect(isRecentlyModified([], now)).toBe(false);
  });
});

describe('parseCwdPaths', () => {
  it('extracts n-lines from lsof -Fn output', () => {
    const out = 'p123\nn/Users/x/repo\np456\nn/Users/x/.superset/worktrees/u/foo\n';
    expect(parseCwdPaths(out)).toEqual(['/Users/x/repo', '/Users/x/.superset/worktrees/u/foo']);
  });
  it('returns empty for empty output', () => {
    expect(parseCwdPaths('')).toEqual([]);
  });
});

describe('isActiveWorktree', () => {
  const cwds = ['/Users/x/wt-a', '/Users/x/wt-b/sub/dir'];
  it('matches exact cwd and cwd nested inside the worktree', () => {
    expect(isActiveWorktree('/Users/x/wt-a', cwds)).toBe(true);
    expect(isActiveWorktree('/Users/x/wt-b', cwds)).toBe(true);
  });
  it('does not prefix-match sibling paths', () => {
    expect(isActiveWorktree('/Users/x/wt', cwds)).toBe(false);
  });
});

describe('assessWorktree', () => {
  it('is removable only when every check passes', () => {
    expect(assessWorktree(cleanChecks).removable).toBe(true);
  });
  it.each([
    ['locked', { locked: true }, 'locked'],
    ['dirty', { dirty: true }, 'uncommitted changes'],
    ['recent', { recentlyModified: true }, 'modified within the last 30 minutes'],
    ['active', { active: true }, 'live process'],
    ['current session', { isCurrentSession: true }, 'current session'],
    ['primary', { isPrimary: true }, 'primary checkout'],
  ] as const)('%s worktree is protected', (_label, override, reasonFragment) => {
    const result = assessWorktree({ ...cleanChecks, ...override });
    expect(result.removable).toBe(false);
    expect(result.reason).toContain(reasonFragment);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config .claude/tools/vitest.config.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

Append to `.claude/tools/lib/git-cleanup.ts`:

```typescript
export const MTIME_THRESHOLD_MS = 30 * 60_000;

/** Any `git status --porcelain` output means uncommitted changes. */
export function isDirty(statusOutput: string): boolean {
  return statusOutput.trim().length > 0;
}

/**
 * mtime guard: catches a worktree provisioned for an agent that has not
 * started working yet (no live process, nothing dirty). Complements the
 * lsof check, which only sees processes running right now.
 */
export function isRecentlyModified(mtimesMs: number[], nowMs: number): boolean {
  return mtimesMs.some((m) => nowMs - m < MTIME_THRESHOLD_MS);
}

/** Parse `lsof -a -d cwd -Fn` output: n-prefixed lines are cwd paths. */
export function parseCwdPaths(lsofOutput: string): string[] {
  return lsofOutput
    .split('\n')
    .filter((line) => line.startsWith('n'))
    .map((line) => line.slice(1));
}

/** True when any live process has its cwd at or inside the worktree. */
export function isActiveWorktree(path: string, cwds: string[]): boolean {
  return cwds.some((cwd) => cwd === path || cwd.startsWith(`${path}/`));
}

export interface WorktreeChecks {
  locked: boolean;
  dirty: boolean;
  recentlyModified: boolean;
  active: boolean;
  isCurrentSession: boolean;
  isPrimary: boolean;
}

/**
 * Single source of truth for worktree-removal safety. classify() and
 * execute()'s re-verify both call this — never fork the logic.
 */
export function assessWorktree(checks: WorktreeChecks): { removable: boolean; reason: string } {
  if (checks.isPrimary) return { removable: false, reason: 'primary checkout — never removed' };
  if (checks.isCurrentSession) return { removable: false, reason: 'current session worktree — never removed' };
  if (checks.locked) return { removable: false, reason: 'worktree is locked' };
  if (checks.dirty) return { removable: false, reason: 'uncommitted changes present' };
  if (checks.active) return { removable: false, reason: 'live process has cwd inside worktree' };
  if (checks.recentlyModified) return { removable: false, reason: 'modified within the last 30 minutes' };
  return { removable: true, reason: 'clean, inactive, unlocked' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config .claude/tools/vitest.config.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/tools/lib/git-cleanup.ts .claude/tools/test/git-cleanup.test.ts
git commit -m "feat(tools): add git-cleanup worktree protection predicates"
```

---

### Task 5: Plan assembly, report renderer, and `classify` orchestration

**Files:**
- Modify: `.claude/tools/lib/git-cleanup.ts` (append)
- Modify: `.claude/tools/test/git-cleanup.test.ts` (append)

**Interfaces:**
- Consumes: everything from Tasks 1–4; `run`, `SpawnDeps` from `./shared.js`.
- Produces:
  - `interface BranchPlanItem { branch: string; sha: string; category: Category; reason: string; worktree: string | null }`
  - `interface WorktreePlanItem { path: string; branch: string | null; sha: string; family: WorktreeFamily; removable: boolean; reason: string }`
  - `interface CleanupPlan { createdAt: string; mainSha: string; branches: BranchPlanItem[]; worktrees: WorktreePlanItem[]; protected: { branch: string; reason: string }[] }`
  - `renderReport(plan: CleanupPlan): string` — the ONLY Markdown formatter; report is always `render(plan)`, never a second serialization (spec).
  - `interface ClassifyDeps extends SpawnDeps { nowMs?: () => number; cwd?: string; statMtimes?: (path: string) => number[]; writeFile?: (path: string, content: string) => void }`
  - `classify(deps?: ClassifyDeps): { ok: boolean; plan?: CleanupPlan; planPath?: string; reportPath?: string; summary?: Record<Category, number>; error?: string }`

**`classify` orchestration sequence (implement exactly this order):**

1. `git rev-parse --git-common-dir` → file locations; `git rev-parse --is-inside-work-tree` guard.
2. `git fetch --prune origin` (timeout 120s). On failure → `{ ok: false, error }`.
3. `git rev-parse origin/main` → `mainSha`.
4. `git for-each-ref refs/heads --format='%(refname:short)%09%(objectname)%09%(upstream:short)%09%(upstream:track)'` → `parseBranchRefs`.
5. `git for-each-ref refs/heads --merged origin/main --format='%(refname:short)'` → ancestor set.
6. `git worktree list --porcelain` → `parseWorktrees`. First entry is the primary checkout.
7. Protected set: `main`, the primary checkout's branch, the branch of the worktree containing `deps.cwd ?? process.cwd()`. These go in `plan.protected`, not through `classifyBranch`.
8. For each non-ancestor, non-protected branch: `git rev-list --count origin/main..<branch>` → `aheadCount`.
9. PR lookup for non-ancestors: `git remote get-url origin` → `parseOriginUrl`; `chunk(names, 50)`; per chunk `gh api graphql -f query=<buildPrQuery(...)>` (timeout 60s), `parsePrResponse`. Any spawn failure → every branch in that chunk `'lookup-failed'`. If `gh` exits non-zero for ALL chunks, still return `ok: true` — PR-dependent branches become doubts (spec: git-only degradation).
10. `classifyBranch` per branch → `BranchPlanItem[]` (attach `worktree` path when a worktree has that branch checked out).
11. Per non-primary worktree, gather checks: `git -C <path> status --porcelain` → `isDirty`; `deps.statMtimes(path)` → `isRecentlyModified` (default impl: mtimes of the worktree root dir and its git index file at `<common-dir>/worktrees/<basename>/index`, skipping ENOENT); one `lsof -a -d cwd -Fn` call total (timeout 15s; non-zero exit tolerated → empty list, lsof errors on permission-denied entries) → `parseCwdPaths` + `isActiveWorktree`; `locked` from porcelain; `isCurrentSession` = worktree contains `deps.cwd`; `isPrimary` = first entry. Then `assessWorktree`. A worktree whose branch is deletable but which fails checks → `removable: false` with the failing reason (rendered under doubts).
12. Assemble `CleanupPlan` (`createdAt: new Date(nowMs()).toISOString()`), write `<common-dir>/git-cleanup-plan.json` (JSON, 2-space) and `<common-dir>/git-cleanup-report.md` (`renderReport(plan)`) via `deps.writeFile` (default `fs.writeFileSync`).
13. Return `{ ok: true, plan, planPath, reportPath, summary }` where `summary` counts branches per category.

**`renderReport` output shape** (keep exactly these sections so the command file can reference them): title with `createdAt` + `mainSha`; `## Summary` count table; `## Deletable branches` — one `###` subsection per deletable category with a `branch / sha (short) / reason / worktree` table; `## Worktree removals` — table with family column, removable items only; `## Doubts` — table of every doubt branch and every non-removable worktree with reasons; `## Protected` — table.

- [ ] **Step 1: Write failing tests** for `renderReport` (given a hand-built two-branch, one-worktree `CleanupPlan`, assert section headers, a branch row, a doubt reason string, and a protected row appear) and for `classify` with a `seqSpawn`-style fake covering: (a) happy path with one ancestor branch + one gone-with-commits branch + fake `gh` response — assert plan categories, files written via a recording `writeFile`, summary counts; (b) `git fetch` failure → `ok: false`; (c) `gh` failure → non-ancestor branches classified doubt with lookup-failed reason, `ok: true`. Follow the `seqSpawn` helper pattern already in this test file (copy it from `test/stack.test.ts` if not yet present).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config .claude/tools/vitest.config.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `BranchPlanItem`/`WorktreePlanItem`/`CleanupPlan`, `renderReport`, and `classify` per the orchestration sequence above. `classify` calls `run(...)` from `shared.js` for every command; every fs access goes through injectable deps with `node:fs` defaults.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config .claude/tools/vitest.config.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/tools/lib/git-cleanup.ts .claude/tools/test/git-cleanup.test.ts
git commit -m "feat(tools): add git-cleanup classify orchestration and report renderer"
```

---

### Task 6: `execute` — re-verify, delete, undo log

**Files:**
- Modify: `.claude/tools/lib/git-cleanup.ts` (append)
- Modify: `.claude/tools/test/git-cleanup.test.ts` (append)

**Interfaces:**
- Consumes: `CleanupPlan`, `assessWorktree`, `isDirty`, `isRecentlyModified`, `parseCwdPaths`, `isActiveWorktree` (Tasks 4–5).
- Produces:
  - `PLAN_MAX_AGE_MS = 60 * 60_000`
  - `isPlanStale(createdAt: string, nowMs: number): boolean`
  - `interface ExecuteOptions { categories: Category[]; worktreeFamilies: WorktreeFamily[] }`
  - `interface ExecuteDeps extends SpawnDeps { nowMs?: () => number; cwd?: string; statMtimes?: (path: string) => number[]; readFile?: (path: string) => string; appendFile?: (path: string, line: string) => void }`
  - `interface ExecuteResult { ok: boolean; deletedBranches: string[]; removedWorktrees: string[]; skipped: { item: string; reason: string }[]; undoLogPath: string | null; error?: string }`
  - `execute(opts: ExecuteOptions, deps?: ExecuteDeps): ExecuteResult`
  - `parseExecuteArgs(argv: string[]): ExecuteOptions | { error: string }` — parses `--categories=a,b` / `--worktree-families=x,y`, rejects unknown values and rejects `doubt` explicitly.

**`execute` sequence (implement exactly):**

1. Load plan from `<common-dir>/git-cleanup-plan.json` via `deps.readFile`; missing → `{ ok: false, error: 'no plan file — run classify first' }`.
2. `isPlanStale(plan.createdAt, nowMs())` → `{ ok: false, error: 'plan is older than 60 minutes — re-run classify' }`. (Per-item re-verify guards changed items; this gate exists for what re-verify cannot see: new branches/worktrees since classify, approval given from stale context.)
3. Select branch items whose `category` is in `opts.categories`. `doubt` is never selectable (`parseExecuteArgs` rejects it; `execute` also filters it defensively).
4. For each selected item **with a worktree**: if its family is not in `opts.worktreeFamilies` → skip both worktree and branch (a checked-out branch cannot be deleted), reason `worktree family not approved`. Otherwise re-verify the worktree by re-gathering live checks (fresh `git -C <path> status --porcelain`, fresh single `lsof` call, fresh `statMtimes`) and calling **`assessWorktree`** — the same predicate as classify. Fail → skip with its reason. Pass → `git worktree remove <path>` (no `--force`; non-zero exit → skip with stderr as reason).
5. For each selected branch (worktree-free, or worktree removed in step 4): re-verify `git rev-parse refs/heads/<branch>` still equals the plan's `sha` (moved → skip, reason `branch moved since classify`). Append `<branch> <sha>` to `<common-dir>/git-cleanup-undo-<YYYY-MM-DD>.log` via `deps.appendFile`, **then** delete: `git branch -d` for `merged-ancestor`, `git branch -D` for `merged-pr` and `empty`. Non-zero exit → skip with stderr as reason.
6. `git worktree prune`.
7. Return totals. `ok: true` even with skips — skips are reported, not fatal.

- [ ] **Step 1: Write failing tests** covering: `isPlanStale` boundary (59 min fresh / 61 min stale); `parseExecuteArgs` (valid input, unknown category rejected, `doubt` rejected, missing flags default to empty worktree-families and error on empty categories); `execute` happy path with fake spawn (branch deleted with `-d` vs `-D` by category, undo line appended **before** the delete call — assert via recorded call order); re-verify skip when `rev-parse` returns a different sha; worktree family-not-approved skips branch too; dirty-on-reverify worktree skipped via `assessWorktree` reason; missing plan file and stale plan return `ok: false`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config .claude/tools/vitest.config.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** per the sequence. The worktree re-check helper that gathers `WorktreeChecks` must be the same function used by classify (extract `gatherWorktreeChecks(wt, deps)` in this task and refactor Task 5's classify to call it — one source of truth).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config .claude/tools/vitest.config.ts`
Expected: PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
git add .claude/tools/lib/git-cleanup.ts .claude/tools/test/git-cleanup.test.ts
git commit -m "feat(tools): add git-cleanup execute with re-verify and undo log"
```

---

### Task 7: CLI entry and command file

**Files:**
- Create: `.claude/tools/git-cleanup.ts`
- Create: `.claude/commands/git-cleanup.md`
- Modify: `.claude/tools/README.md` (add one row/entry for git-cleanup, matching its existing format)

**Interfaces:**
- Consumes: `classify`, `execute`, `parseExecuteArgs` (Tasks 5–6).

- [ ] **Step 1: Write the CLI entry**

`.claude/tools/git-cleanup.ts` (mirror `stack.ts` shape exactly):

```typescript
/**
 * Agent-facing CLI for local branch/worktree cleanup. JSON to stdout.
 *
 * Usage:
 *   npx tsx .claude/tools/git-cleanup.ts classify
 *   npx tsx .claude/tools/git-cleanup.ts execute --categories=merged-ancestor,merged-pr,empty \
 *       --worktree-families=superset,agent,chain
 *
 * Design spec: docs/superpowers/specs/2026-08-08-git-cleanup-command-design.md
 */

import { classify, execute, parseExecuteArgs } from './lib/git-cleanup.js';

const USAGE = `usage: git-cleanup.ts <command> [args]

commands:
  classify                              fetch --prune, classify all branches/worktrees,
                                        write plan + report to the common git dir
  execute --categories=<a,b>            delete approved categories from the saved plan
          [--worktree-families=<x,y>]   (categories: merged-ancestor, merged-pr, empty;
                                        families: superset, agent, chain)
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'classify': {
    const result = classify();
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
    break;
  }
  case 'execute': {
    const parsed = parseExecuteArgs(args);
    if ('error' in parsed) fail(`${parsed.error}\n\n${USAGE}`);
    const result = execute(parsed);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
    break;
  }
  default:
    fail(USAGE);
}
```

- [ ] **Step 2: Smoke-test classify against the real repo (read-only)**

Run: `npx tsx .claude/tools/git-cleanup.ts classify`
Expected: `ok: true`, summary counts roughly matching design-time measurements (~375 merged-ancestor, ~50 non-ancestor split between merged-pr and doubts), report file exists at the printed path, current branch listed under `protected`. Spot-check 3 branches from the report against `git log`/`gh pr view` by hand. **Do not run execute against the real repo in this task.**

- [ ] **Step 3: Write the command file**

`.claude/commands/git-cleanup.md`:

```markdown
# Git Cleanup

Clean up local branches and worktrees whose work has merged to main or that
carry no new work. Classification and deletion are performed by the
deterministic tool in `.claude/tools/git-cleanup.ts`; this command wraps it
with a report and a category-approval gate. Design spec:
`docs/superpowers/specs/2026-08-08-git-cleanup-command-design.md`.

Doubts are report-only: never delete anything the tool classifies as a
doubt, and never work around a protection the tool enforces.

## Steps

1. **Classify.** Run:

   ```bash
   npx tsx .claude/tools/git-cleanup.ts classify
   ```

   If `ok` is false, report the error and stop.

2. **Report.** From the JSON summary and the report file (path in
   `reportPath`), present in chat:
   - Counts per category (merged-ancestor, merged-pr, empty).
   - Worktree removals grouped by family (superset / agent / chain), with
     branch names.
   - The complete doubts list with each item's reason — do not truncate.
   - Point at `reportPath` for the full branch tables.

3. **Approve.** One AskUserQuestion round (multiSelect), offering exactly:
   - Delete `merged-ancestor` branches (N)
   - Delete `merged-pr` branches (N)
   - Delete `empty` branches (N)
   - Remove worktrees per family present in the plan (one option per family
     with a removable worktree)

   Do not offer doubts. If the user selects nothing, stop cleanly.

4. **Execute.** Run with only the approved values:

   ```bash
   npx tsx .claude/tools/git-cleanup.ts execute \
     --categories=<approved categories> \
     --worktree-families=<approved families>
   ```

5. **Summarize.** Report: branches deleted, worktrees removed, skipped
   items with reasons (the tool re-verifies every item immediately before
   acting — skips are normal when state changed since classify), and the
   undo log path. Deleted branches are recoverable with
   `git branch <name> <sha>` using that log.
```

- [ ] **Step 4: Run the full test suite and lint**

Run: `npx vitest run --config .claude/tools/vitest.config.ts && npm run lint`
Expected: all tests PASS; no new lint errors (warnings baseline ~267 is pre-existing).

- [ ] **Step 5: Update `.claude/tools/README.md`** with a git-cleanup entry matching the README's existing structure for `stack.ts`/`bead.ts`.

- [ ] **Step 6: Commit**

```bash
git add .claude/tools/git-cleanup.ts .claude/commands/git-cleanup.md .claude/tools/README.md
git commit -m "feat(tools): add /git-cleanup command wrapping the cleanup tool"
```

---

### Task 8: Supervised live run (manual verification)

No new files. This is the manual half the spec assigns to execution paths.

- [ ] **Step 1: Run classify for real** and read the report end to end. Confirm: current worktree protected; the primary checkout (`~/pavillion/code`, on `main`) protected; any recently-touched agent worktree flagged as protected by mtime or lsof.

- [ ] **Step 2: Execute a minimal slice.** Pick ONE obviously-merged branch from `merged-ancestor` with no worktree; run `execute --categories=merged-ancestor` **after temporarily hand-editing the plan JSON down to that one item** (or accept the full category if the user prefers). Confirm: undo log written first, branch gone, `git branch <name> <sha>` restores it, delete again.

- [ ] **Step 3: Full run via the command.** Invoke `/git-cleanup` in a fresh session and take it through the real AskUserQuestion flow. Confirm skips report sensibly and worktree removals behave (start with the `chain` family — smallest blast radius).

- [ ] **Step 4: Commit any fixes** found during the live run with conventional messages, then report results.

---

## Self-Review (completed)

- **Spec coverage:** categories/rules → Task 3; GitHub verification + measured batching → Task 2; protections incl. lsof/mtime rationale → Task 4; single formatter + plan/report files + classify flow → Task 5; shared-predicate constraint, staleness gate, undo, deletion order, worktree prune → Task 6; command flow + AskUserQuestion shape + degraded gh mode → Tasks 5/7; unit-tested protection predicates (advisor condition) → Task 4; out-of-scope items absent everywhere.
- **Placeholder scan:** Tasks 5/6 Step-1 test descriptions enumerate exact cases and expected assertions rather than full listings — deliberate: the code interfaces they test are fully specified, and the test-helper pattern is named. No TBDs.
- **Type consistency:** `classifyBranch(branch, isAncestor, aheadCount, prs)`, `assessWorktree(checks)`, `gatherWorktreeChecks(wt, deps)` (introduced Task 6, reused by Task 5's classify), `parseExecuteArgs(argv)` — names match across tasks.
