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
