/**
 * Classification and execution logic for the /git-cleanup command.
 *
 * Design spec: docs/superpowers/specs/2026-08-08-git-cleanup-command-design.md
 *
 * Safety invariant: execute() re-verifies through the SAME predicate
 * functions classify() uses. Do not add a parallel implementation of any
 * deletability or protection check.
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { run, type SpawnDeps, type SpawnFn } from './shared.js';

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
  /**
   * True when the worktree's checked-out branch was itself classified
   * deletable (`merged-ancestor`, `merged-pr`, or `empty`). A detached
   * worktree (no branch) is never deletable. Design spec ("Worktree
   * handling", condition 1): a worktree is removed only when its branch is
   * classified deletable AND it passes every other safety check below.
   */
  branchDeletable: boolean;
}

/**
 * Single source of truth for worktree-removal safety. classify() and
 * execute()'s re-verify both call this — never fork the logic.
 */
export function assessWorktree(checks: WorktreeChecks): { removable: boolean; reason: string } {
  if (checks.isPrimary) return { removable: false, reason: 'primary checkout — never removed' };
  if (checks.isCurrentSession) return { removable: false, reason: 'current session worktree — never removed' };
  if (!checks.branchDeletable) return { removable: false, reason: 'branch not classified deletable' };
  if (checks.locked) return { removable: false, reason: 'worktree is locked' };
  if (checks.dirty) return { removable: false, reason: 'uncommitted changes present' };
  if (checks.active) return { removable: false, reason: 'live process has cwd inside worktree' };
  if (checks.recentlyModified) return { removable: false, reason: 'modified within the last 30 minutes' };
  return { removable: true, reason: 'clean, inactive, unlocked' };
}

// =============================================================================
// Plan assembly, report rendering, and classify() orchestration
// =============================================================================

export interface BranchPlanItem {
  branch: string;
  sha: string;
  category: Category;
  reason: string;
  worktree: string | null;
}

export interface WorktreePlanItem {
  path: string;
  branch: string | null;
  sha: string;
  family: WorktreeFamily;
  removable: boolean;
  reason: string;
}

export interface CleanupPlan {
  createdAt: string;
  mainSha: string;
  branches: BranchPlanItem[];
  worktrees: WorktreePlanItem[];
  protected: { branch: string; reason: string }[];
}

const DELETABLE_CATEGORIES: Category[] = ['merged-ancestor', 'merged-pr', 'empty'];
const ALL_CATEGORIES: Category[] = ['merged-ancestor', 'merged-pr', 'empty', 'doubt'];

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function mdTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '_none_\n';
  const headerLine = `| ${headers.join(' | ')} |`;
  const dividerLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const rowLines = rows.map((r) => `| ${r.join(' | ')} |`);
  return [headerLine, dividerLine, ...rowLines].join('\n') + '\n';
}

/**
 * The ONLY Markdown formatter for a CleanupPlan. Never build a second
 * serialization of the plan elsewhere (spec) — the report is always
 * `renderReport(plan)`.
 */
export function renderReport(plan: CleanupPlan): string {
  const sections: string[] = [];

  sections.push(`# Git Cleanup Plan — ${plan.createdAt}\n\nmain @ \`${shortSha(plan.mainSha)}\`\n`);

  const summaryRows = ALL_CATEGORIES.map((cat) => [
    cat,
    String(plan.branches.filter((b) => b.category === cat).length),
  ]);
  sections.push(`## Summary\n\n${mdTable(['Category', 'Count'], summaryRows)}`);

  const deletableSections = DELETABLE_CATEGORIES
    .map((cat) => {
      const items = plan.branches.filter((b) => b.category === cat);
      if (items.length === 0) return '';
      const rows = items.map((b) => [b.branch, shortSha(b.sha), b.reason, b.worktree ?? '_none_']);
      return `### ${cat}\n\n${mdTable(['Branch', 'SHA', 'Reason', 'Worktree'], rows)}`;
    })
    .filter((s) => s.length > 0)
    .join('\n');
  sections.push(`## Deletable branches\n\n${deletableSections || '_none_\n'}`);

  const removableWorktrees = plan.worktrees.filter((w) => w.removable);
  const worktreeRows = removableWorktrees.map((w) => [
    w.family, w.path, w.branch ?? '_detached_', shortSha(w.sha), w.reason,
  ]);
  sections.push(`## Worktree removals\n\n${mdTable(['Family', 'Path', 'Branch', 'SHA', 'Reason'], worktreeRows)}`);

  const doubtBranches = plan.branches.filter((b) => b.category === 'doubt');
  const nonRemovableWorktrees = plan.worktrees.filter((w) => !w.removable);
  const doubtRows = [
    ...doubtBranches.map((b) => ['branch', b.branch, shortSha(b.sha), b.reason]),
    ...nonRemovableWorktrees.map((w) => ['worktree', w.path, shortSha(w.sha), w.reason]),
  ];
  sections.push(`## Doubts\n\n${mdTable(['Type', 'Item', 'SHA', 'Reason'], doubtRows)}`);

  const protectedRows = plan.protected.map((p) => [p.branch, p.reason]);
  sections.push(`## Protected\n\n${mdTable(['Branch', 'Reason'], protectedRows)}`);

  return sections.join('\n');
}

export interface ClassifyDeps extends SpawnDeps {
  nowMs?: () => number;
  cwd?: string;
  statMtimes?: (path: string) => number[];
  writeFile?: (path: string, content: string) => void;
  /**
   * Canonicalize a path through the filesystem (default fs.realpathSync,
   * falling back to the input path on error). lsof reports kernel-canonical
   * cwds while `git worktree list` reports creation-time paths — a
   * symlinked ancestor makes the two disagree unless both sides are
   * resolved through the same realpath call before comparison.
   */
  realpath?: (p: string) => string;
}

function defaultRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  }
  catch {
    return p;
  }
}

function defaultStatMtimes(commonDir: string) {
  return (worktreePath: string): number[] => {
    const candidates = [
      worktreePath,
      path.join(commonDir, 'worktrees', path.basename(worktreePath), 'index'),
    ];
    const mtimes: number[] = [];
    for (const candidate of candidates) {
      try {
        mtimes.push(fs.statSync(candidate).mtimeMs);
      }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    return mtimes;
  };
}

export interface WorktreeCheckContext {
  spawn: SpawnFn;
  cwd?: string;
  statMtimes: (path: string) => number[];
  nowMs: number;
  /** Realpath-resolved lsof cwd list, gathered once per classify/execute call. */
  cwds: string[];
  realpath: (p: string) => string;
}

/**
 * Gather the WorktreeChecks for a single non-primary worktree. This is the
 * ONLY place these checks are gathered — classify() and Task 6's execute()
 * re-verify both call this, so a predicate change only needs to happen here.
 */
export function gatherWorktreeChecks(
  wt: WorktreeInfo,
  isPrimary: boolean,
  isCurrentSession: boolean,
  branchDeletable: boolean,
  ctx: WorktreeCheckContext,
): WorktreeChecks {
  const statusResult = run('git', ['-C', wt.path, 'status', '--porcelain'], ctx.spawn, { cwd: ctx.cwd });
  const dirty = isDirty(statusResult.stdout);
  const recentlyModified = isRecentlyModified(ctx.statMtimes(wt.path), ctx.nowMs);
  const resolvedPath = ctx.realpath(wt.path);
  const active = isActiveWorktree(resolvedPath, ctx.cwds);
  return {
    locked: wt.locked,
    dirty,
    recentlyModified,
    active,
    isCurrentSession,
    isPrimary,
    branchDeletable,
  };
}

/**
 * Find the worktree that most specifically contains `targetPath` (realpath
 * -equal to, or nested inside, the worktree's path). Nested worktrees (e.g.
 * agent worktrees under `<repo>/.claude/worktrees/agent-*`) live INSIDE the
 * primary checkout, so a naive first-match would always return the primary
 * — longest matching path wins (most-specific-wins), so a cwd inside a
 * nested worktree resolves to that worktree, not its ancestor.
 */
function findContainingWorktree(
  targetPath: string,
  worktrees: WorktreeInfo[],
  realpath: (p: string) => string,
): WorktreeInfo | undefined {
  const resolvedTarget = realpath(targetPath);
  let best: WorktreeInfo | undefined;
  let bestPathLength = -1;
  for (const wt of worktrees) {
    const resolvedWt = realpath(wt.path);
    if (!isActiveWorktree(resolvedWt, [resolvedTarget])) continue;
    if (resolvedWt.length > bestPathLength) {
      best = wt;
      bestPathLength = resolvedWt.length;
    }
  }
  return best;
}

/**
 * Orchestrate the full classify pass: fetch, read branch/worktree state,
 * classify every branch and worktree, write the plan/report, and return a
 * summary. See the 13-step sequence in the task-5 brief for the exact call
 * order — seqSpawn-style tests depend on it.
 */
export function classify(deps: ClassifyDeps = {}): {
  ok: boolean;
  plan?: CleanupPlan;
  planPath?: string;
  reportPath?: string;
  summary?: Record<Category, number>;
  error?: string;
} {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const cwd = deps.cwd ?? process.cwd();
  const runGit = (args: string[], opts: { timeout?: number } = {}) =>
    run('git', args, spawn, { cwd, ...opts });

  // Step 1: file locations + inside-work-tree guard.
  const commonDirResult = runGit(['rev-parse', '--git-common-dir']);
  if (commonDirResult.exitCode !== 0) {
    return { ok: false, error: `git rev-parse --git-common-dir failed: ${commonDirResult.stderr}` };
  }
  const commonDir = path.resolve(cwd, commonDirResult.stdout);

  const insideWorkTree = runGit(['rev-parse', '--is-inside-work-tree']);
  if (insideWorkTree.exitCode !== 0 || insideWorkTree.stdout !== 'true') {
    return { ok: false, error: 'not inside a git work tree' };
  }

  // Step 2: fetch. Never assume merged on GitHub failure, but a failed
  // fetch means we cannot trust local refs against origin at all — hard stop.
  const fetchResult = runGit(['fetch', '--prune', 'origin'], { timeout: 120_000 });
  if (fetchResult.exitCode !== 0) {
    return { ok: false, error: `git fetch --prune origin failed: ${fetchResult.stderr}` };
  }

  // Step 3: main sha.
  const mainShaResult = runGit(['rev-parse', 'origin/main']);
  if (mainShaResult.exitCode !== 0) {
    return { ok: false, error: `git rev-parse origin/main failed: ${mainShaResult.stderr}` };
  }
  const mainSha = mainShaResult.stdout;

  // Step 4: all local branch refs.
  const refsResult = runGit([
    'for-each-ref', 'refs/heads',
    '--format=%(refname:short)%09%(objectname)%09%(upstream:short)%09%(upstream:track)',
  ]);
  const branches = parseBranchRefs(refsResult.stdout);

  // Step 5: ancestor set.
  const mergedResult = runGit(['for-each-ref', 'refs/heads', '--merged', 'origin/main', '--format=%(refname:short)']);
  const ancestorSet = new Set(
    mergedResult.stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0),
  );

  // Step 6: worktrees. First entry is the primary checkout.
  const worktreeResult = runGit(['worktree', 'list', '--porcelain']);
  const worktrees = parseWorktrees(worktreeResult.stdout);
  const primaryWt = worktrees[0];

  const realpath = deps.realpath ?? defaultRealpath;
  const sessionWt = findContainingWorktree(cwd, worktrees, realpath);

  // Step 7: protected set. main, primary checkout's branch, current session
  // branch. These bypass classifyBranch entirely.
  const protectedEntries: { branch: string; reason: string }[] = [];
  const protectedNames = new Set<string>();
  const addProtected = (branchName: string | null | undefined, reason: string) => {
    if (!branchName || protectedNames.has(branchName)) return;
    protectedNames.add(branchName);
    protectedEntries.push({ branch: branchName, reason });
  };
  addProtected('main', 'main branch');
  addProtected(primaryWt?.branch, "primary checkout's branch");
  addProtected(sessionWt?.branch, 'current session branch');

  const nonAncestorBranches = branches.filter(
    (b) => !ancestorSet.has(b.name) && !protectedNames.has(b.name),
  );

  // Step 8: ahead counts for non-ancestor, non-protected branches.
  const aheadCounts = new Map<string, number>();
  for (const b of nonAncestorBranches) {
    const result = runGit(['rev-list', '--count', `origin/main..${b.name}`]);
    aheadCounts.set(b.name, result.exitCode === 0 ? (parseInt(result.stdout, 10) || 0) : 0);
  }

  // Step 9: PR lookup for the same set. gh failure never means "assume
  // merged" — a failed chunk marks its branches 'lookup-failed' (doubt).
  // Overall `ok` stays true: PR-dependent branches degrade to doubt, but
  // git-only classification (ancestors, empties) still succeeds.
  const prLookup: PrLookup = new Map();
  if (nonAncestorBranches.length > 0) {
    const names = nonAncestorBranches.map((b) => b.name);
    const originUrlResult = runGit(['remote', 'get-url', 'origin']);
    const parsedOrigin = originUrlResult.exitCode === 0 ? parseOriginUrl(originUrlResult.stdout) : null;
    if (!parsedOrigin) {
      for (const name of names) prLookup.set(name, 'lookup-failed');
    }
    else {
      for (const branchChunk of chunk(names, 50)) {
        const query = buildPrQuery(branchChunk, parsedOrigin.owner, parsedOrigin.repo);
        const ghResult = run('gh', ['api', 'graphql', '-f', `query=${query}`], spawn, { cwd, timeout: 60_000 });
        if (ghResult.exitCode !== 0) {
          for (const name of branchChunk) prLookup.set(name, 'lookup-failed');
          continue;
        }
        let json: unknown;
        try {
          json = JSON.parse(ghResult.stdout);
        }
        catch {
          for (const name of branchChunk) prLookup.set(name, 'lookup-failed');
          continue;
        }
        for (const [name, val] of parsePrResponse(json, branchChunk)) prLookup.set(name, val);
      }
    }
  }

  // Step 10: classify every non-protected branch.
  const branchPlanItems: BranchPlanItem[] = branches
    .filter((b) => !protectedNames.has(b.name))
    .map((b) => {
      const isAncestor = ancestorSet.has(b.name);
      const aheadCount = isAncestor ? 0 : (aheadCounts.get(b.name) ?? 0);
      const prs = isAncestor ? null : (prLookup.get(b.name) ?? 'lookup-failed');
      const classified = classifyBranch(b, isAncestor, aheadCount, prs);
      const wt = worktrees.find((w) => w.branch === b.name);
      return {
        branch: b.name,
        sha: b.sha,
        category: classified.category,
        reason: classified.reason,
        worktree: wt ? wt.path : null,
      };
    });

  // Step 11: per non-primary worktree, gather checks and assess.
  const nowMs = (deps.nowMs ?? Date.now)();
  const statMtimes = deps.statMtimes ?? defaultStatMtimes(commonDir);
  const nonPrimaryWorktrees = worktrees.slice(1);

  let cwds: string[] = [];
  if (nonPrimaryWorktrees.length > 0) {
    // lsof routinely exits non-zero on macOS (permission-denied reading some
    // processes' fds) while still printing every cwd it *could* read on
    // stdout. Parse stdout regardless of exit code — an empty cwd list only
    // when stdout itself is empty, never inferred from the exit code alone.
    const lsofResult = run('lsof', ['-a', '-d', 'cwd', '-Fn'], spawn, { cwd, timeout: 15_000 });
    cwds = parseCwdPaths(lsofResult.stdout).map((p) => realpath(p));
  }

  const worktreePlanItems: WorktreePlanItem[] = nonPrimaryWorktrees.map((wt) => {
    const isCurrentSession = wt === sessionWt;
    // Worktree handling condition 1 (design spec): only removable when its
    // checked-out branch was itself classified deletable. A detached
    // worktree (wt.branch === null) or one whose branch is protected/doubt
    // is never branch-deletable.
    const branchItem = wt.branch ? branchPlanItems.find((b) => b.branch === wt.branch) : undefined;
    const branchDeletable = branchItem !== undefined && DELETABLE_CATEGORIES.includes(branchItem.category);
    const checks = gatherWorktreeChecks(wt, false, isCurrentSession, branchDeletable, {
      spawn, cwd, statMtimes, nowMs, cwds, realpath,
    });
    const assessment = assessWorktree(checks);
    return {
      path: wt.path,
      branch: wt.branch,
      sha: wt.sha,
      family: worktreeFamily(wt.path),
      removable: assessment.removable,
      reason: assessment.reason,
    };
  });

  // Step 12: assemble and write.
  const plan: CleanupPlan = {
    createdAt: new Date(nowMs).toISOString(),
    mainSha,
    branches: branchPlanItems,
    worktrees: worktreePlanItems,
    protected: protectedEntries,
  };

  const planPath = path.join(commonDir, 'git-cleanup-plan.json');
  const reportPath = path.join(commonDir, 'git-cleanup-report.md');
  const writeFile = deps.writeFile ?? ((p: string, content: string) => fs.writeFileSync(p, content));
  writeFile(planPath, JSON.stringify(plan, null, 2));
  writeFile(reportPath, renderReport(plan));

  // Step 13: summary.
  const summary: Record<Category, number> = { 'merged-ancestor': 0, 'merged-pr': 0, empty: 0, doubt: 0 };
  for (const b of branchPlanItems) summary[b.category]++;

  return { ok: true, plan, planPath, reportPath, summary };
}

// =============================================================================
// execute() — re-verify, delete, undo log
// =============================================================================

/**
 * A plan older than this is refused outright. Per-item re-verify (rev-parse
 * for branches, gatherWorktreeChecks/assessWorktree for worktrees) already
 * guards against anything re-verify CAN see changing between classify and
 * execute. This gate exists for what re-verify cannot see: brand-new
 * branches/worktrees created since classify, or an approval given by a user
 * looking at context that's no longer representative of the repo.
 */
export const PLAN_MAX_AGE_MS = 60 * 60_000;

export function isPlanStale(createdAt: string, nowMs: number): boolean {
  return nowMs - new Date(createdAt).getTime() > PLAN_MAX_AGE_MS;
}

const VALID_EXECUTE_CATEGORIES: Category[] = ['merged-ancestor', 'merged-pr', 'empty'];
const VALID_WORKTREE_FAMILIES: WorktreeFamily[] = ['superset', 'agent', 'chain'];

export interface ExecuteOptions {
  categories: Category[];
  worktreeFamilies: WorktreeFamily[];
}

export interface ExecuteDeps extends SpawnDeps {
  nowMs?: () => number;
  cwd?: string;
  statMtimes?: (path: string) => number[];
  readFile?: (path: string) => string;
  appendFile?: (path: string, line: string) => void;
  /** See ClassifyDeps.realpath — same canonicalization need on the execute-side re-verify. */
  realpath?: (p: string) => string;
}

export interface ExecuteResult {
  ok: boolean;
  deletedBranches: string[];
  removedWorktrees: string[];
  skipped: { item: string; reason: string }[];
  undoLogPath: string | null;
  error?: string;
}

/**
 * Parse `execute` CLI args: `--categories=a,b` (required, non-empty) and
 * `--worktree-families=x,y` (optional, defaults to no families approved).
 * `doubt` is rejected here so it can never reach `execute` via the CLI —
 * `execute` itself also filters it defensively for callers that bypass this
 * parser.
 */
export function parseExecuteArgs(argv: string[]): ExecuteOptions | { error: string } {
  let categoriesRaw: string | undefined;
  let familiesRaw: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith('--categories=')) categoriesRaw = arg.slice('--categories='.length);
    else if (arg.startsWith('--worktree-families=')) familiesRaw = arg.slice('--worktree-families='.length);
  }

  const categories = (categoriesRaw ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (categories.length === 0) return { error: '--categories is required (comma-separated, non-empty)' };
  for (const c of categories) {
    if (c === 'doubt') return { error: 'doubt is never selectable — it is report-only' };
    if (!VALID_EXECUTE_CATEGORIES.includes(c as Category)) return { error: `unknown category: ${c}` };
  }

  const families = (familiesRaw ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  for (const f of families) {
    if (!VALID_WORKTREE_FAMILIES.includes(f as WorktreeFamily)) return { error: `unknown worktree family: ${f}` };
  }

  return { categories: categories as Category[], worktreeFamilies: families as WorktreeFamily[] };
}

function formatDateStamp(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Re-verify and execute an approved plan: delete branches, remove worktrees,
 * append an undo log line before each branch deletion. Every safety check
 * runs through `gatherWorktreeChecks` + `assessWorktree` — the same
 * functions classify() uses (see file-header invariant). A skipped item is
 * never fatal; `ok: false` is reserved for "could not even attempt this run"
 * (no plan, stale plan).
 */
export function execute(opts: ExecuteOptions, deps: ExecuteDeps = {}): ExecuteResult {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const cwd = deps.cwd ?? process.cwd();
  const runGit = (args: string[], runOpts: { timeout?: number } = {}) =>
    run('git', args, spawn, { cwd, ...runOpts });
  const nowMs = (deps.nowMs ?? Date.now)();
  const realpath = deps.realpath ?? defaultRealpath;
  const readFile = deps.readFile ?? ((p: string) => fs.readFileSync(p, 'utf-8'));
  const appendFile = deps.appendFile ?? ((p: string, line: string) => fs.appendFileSync(p, line));

  const fail = (error: string): ExecuteResult => ({
    ok: false, deletedBranches: [], removedWorktrees: [], skipped: [], undoLogPath: null, error,
  });

  // Step 1: locate and load the plan.
  const commonDirResult = runGit(['rev-parse', '--git-common-dir']);
  if (commonDirResult.exitCode !== 0) {
    return fail(`git rev-parse --git-common-dir failed: ${commonDirResult.stderr}`);
  }
  const commonDir = path.resolve(cwd, commonDirResult.stdout);
  // Matches classify's default: mtime is checked on the worktree root AND
  // <common-dir>/worktrees/<basename>/index, so this must be keyed off
  // commonDir, not cwd (deps.statMtimes ignores this entirely — tests always
  // inject their own).
  const statMtimes = deps.statMtimes ?? defaultStatMtimes(commonDir);
  const planPath = path.join(commonDir, 'git-cleanup-plan.json');

  let planText: string;
  try {
    planText = readFile(planPath);
  }
  catch {
    return fail('no plan file — run classify first');
  }
  const plan = JSON.parse(planText) as CleanupPlan;

  // Step 2: staleness gate.
  if (isPlanStale(plan.createdAt, nowMs)) {
    return fail('plan is older than 60 minutes — re-run classify');
  }

  const undoLogPath = path.join(commonDir, `git-cleanup-undo-${formatDateStamp(nowMs)}.log`);

  // Step 3: select approved, non-doubt branch items. doubt is never
  // selectable — parseExecuteArgs already rejects it, but execute()
  // defends independently for callers that bypass the CLI parser.
  const approvedCategories = opts.categories.filter((c) => c !== 'doubt');
  const selected = plan.branches.filter((b) => b.category !== 'doubt' && approvedCategories.includes(b.category));

  const skipped: { item: string; reason: string }[] = [];
  const removedWorktrees: string[] = [];

  const withoutWorktree = selected.filter((b) => b.worktree === null);
  const withWorktree = selected.filter((b) => b.worktree !== null);

  // Step 4a: family gate — a checked-out branch cannot be deleted, so an
  // unapproved family skips both the worktree and its branch immediately,
  // before any live re-verify call.
  const familyApproved: BranchPlanItem[] = [];
  for (const b of withWorktree) {
    const wtPlanItem = plan.worktrees.find((w) => w.path === b.worktree);
    const family = wtPlanItem?.family ?? 'other';
    if (!opts.worktreeFamilies.includes(family)) {
      skipped.push({ item: b.worktree as string, reason: 'worktree family not approved' });
      skipped.push({ item: b.branch, reason: 'worktree family not approved' });
      continue;
    }
    familyApproved.push(b);
  }

  // Step 4b: one fresh lsof call covers every worktree being re-verified
  // this run (mirrors classify's batching — see gatherWorktreeChecks caller
  // contract).
  let cwds: string[] = [];
  if (familyApproved.length > 0) {
    const lsofResult = run('lsof', ['-a', '-d', 'cwd', '-Fn'], spawn, { cwd, timeout: 15_000 });
    cwds = parseCwdPaths(lsofResult.stdout).map((p) => realpath(p));
  }

  // Step 4c: per approved-family worktree, re-verify via gatherWorktreeChecks
  // + assessWorktree — the same predicate classify() used to write
  // `removable: true` into the plan. isPrimary/isCurrentSession are always
  // false and branchDeletable is always true here: a worktree whose branch
  // was protected or non-deletable could never have reached `selected`
  // (protected branches never appear in plan.branches; non-deletable
  // categories were filtered out in step 3). `locked` isn't part of the
  // brief's re-verify set (dirty/active/recentlyModified only) — a lock
  // acquired after classify is a gap the mtime/active checks don't close,
  // but re-checking it isn't in scope for this task.
  const branchDeleteCandidates: BranchPlanItem[] = [...withoutWorktree];
  for (const b of familyApproved) {
    const wtInfo: WorktreeInfo = {
      path: b.worktree as string, sha: b.sha, branch: b.branch, locked: false, prunable: false,
    };
    const checks = gatherWorktreeChecks(wtInfo, false, false, true, {
      spawn, cwd, statMtimes, nowMs, cwds, realpath,
    });
    const assessment = assessWorktree(checks);
    if (!assessment.removable) {
      skipped.push({ item: b.worktree as string, reason: assessment.reason });
      skipped.push({ item: b.branch, reason: assessment.reason });
      continue;
    }
    const removeResult = runGit(['worktree', 'remove', b.worktree as string]);
    if (removeResult.exitCode !== 0) {
      skipped.push({ item: b.worktree as string, reason: removeResult.stderr });
      skipped.push({ item: b.branch, reason: removeResult.stderr });
      continue;
    }
    removedWorktrees.push(b.worktree as string);
    branchDeleteCandidates.push(b);
  }

  // Step 5: re-verify each surviving branch's sha, append the undo line
  // BEFORE deleting, then delete.
  const deletedBranches: string[] = [];
  for (const b of branchDeleteCandidates) {
    const revParseResult = runGit(['rev-parse', `refs/heads/${b.branch}`]);
    if (revParseResult.exitCode !== 0 || revParseResult.stdout !== b.sha) {
      skipped.push({ item: b.branch, reason: 'branch moved since classify' });
      continue;
    }
    appendFile(undoLogPath, `${b.branch} ${b.sha}\n`);
    const flag = b.category === 'merged-ancestor' ? '-d' : '-D';
    const deleteResult = runGit(['branch', flag, b.branch]);
    if (deleteResult.exitCode !== 0) {
      skipped.push({ item: b.branch, reason: deleteResult.stderr });
      continue;
    }
    deletedBranches.push(b.branch);
  }

  // Step 6: prune unconditionally.
  runGit(['worktree', 'prune']);

  // Step 7: totals. Skips are reported, never fatal.
  return { ok: true, deletedBranches, removedWorktrees, skipped, undoLogPath };
}
