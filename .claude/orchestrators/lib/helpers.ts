/**
 * Deterministic helper functions for the process-backlog orchestrator.
 *
 * All functions that previously shelled out to .sh scripts now live here
 * as typed TypeScript. CLI-calling functions accept an injectable `spawnFn`
 * for testing; pure functions have no I/O at all.
 *
 * Exports:
 *   CLI helpers: gitSafeToStart, stackCreate, stackSubmit, syncAndRestack,
 *                preflight, bdTopReady, bdEscalate,
 *                bdState, bdSizingCheck, bdEnrichmentCheck,
 *                discoverAgents
 *   Pure helpers: branchName, commitMsg, prBody,
 *                 classifyBeadState, classifySizing
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// =============================================================================
// Re-exported Node types
// =============================================================================

export type SpawnFn = typeof nodeSpawnSync;

// =============================================================================
// Shared deps interface
// =============================================================================

export interface SpawnDeps {
  spawnFn?: SpawnFn;
}

// =============================================================================
// Result types
// =============================================================================

export interface GitSafeResult {
  ok: boolean;
  reason?: string;
}

export interface StackOpResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface SyncAndRestackResult {
  /** True when gt sync exited 0 and no branch hit a restack conflict. */
  ok: boolean;
  /** Branches gt restacked cleanly ("Restacked X on Y."). */
  restacked: string[];
  /** Branches skipped because their restack would conflict; resolve with `gt restack` from the checkout that holds them. */
  conflicted: string[];
  /** Branches gt skipped because they are checked out in another worktree; rerun sync/restack from that worktree. */
  skippedWorktree: string[];
  /** Combined raw stdout/stderr from gt sync, for diagnostics and reporting. */
  rawOutput: string;
}

export interface PreflightFailure {
  kind: string;
  reason: string;
}

export interface PreflightResult {
  ok: boolean;
  failures: PreflightFailure[];
}

export interface BeadJson {
  id: string;
  issue_type?: string;
  priority?: number;
  created_at?: string;
  status?: string;
  parent?: string;
  dependencies?: BeadDependency[];
  dependents?: BeadDependency[];
  [key: string]: unknown;
}

export interface BeadDependency {
  id: string;
  status?: string;
  issue_type?: string;
  dependency_type?: string;
  [key: string]: unknown;
}

export interface EpicPromotionResult {
  epicId: string;
  epicTitle?: string;
  readyChildCount: number;
}

export interface TopReadyResult {
  bead: BeadJson | null;
  exhausted: boolean;
}

export interface StateVerdict {
  state: 'unshaped' | 'shaped' | 'advised' | 'decomposed' | 'analyzed' | 'executing' | 'complete';
  missing_phases: string[];
  reasons: string[];
}

export interface SizingVerdict {
  needs_decomposition: boolean;
  reasons: string[];
}

export interface BeadRef {
  id: string;
  title: string;
}

export interface AgentInfo {
  name: string;
  path: string;
  description: string;
}

export interface MatchedAgent extends AgentInfo {
  rationale: string;
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Run a command synchronously via spawnSync and return trimmed stdout/stderr.
 */
function run(
  cmd: string,
  args: string[],
  spawnFn: SpawnFn,
  opts: { input?: string; timeout?: number } = {},
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnFn(cmd, args, {
    encoding: 'buffer' as never,
    shell: true,
    timeout: opts.timeout ?? 30_000,
    ...(opts.input !== undefined ? { input: Buffer.from(opts.input) } : {}),
  });
  return {
    stdout: (result.stdout?.toString('utf-8') ?? '').trim(),
    stderr: (result.stderr?.toString('utf-8') ?? '').trim(),
    exitCode: result.status ?? 1,
  };
}

// =============================================================================
// gitSafeToStart
// =============================================================================

/**
 * Check that the working tree is clean and HEAD is current with the base
 * the next branch will be cut from.
 *
 *   - must be inside a git work tree
 *   - HEAD commit must equal the base ref (any branch name is fine)
 *   - working tree must be clean (git status --porcelain is empty)
 *
 * Without `parentBranch`, the base ref is `origin/<mainBranch>` — the
 * "current with main" model (rather than "on main") supports worktree-based
 * workflows where each worktree's branch starts at origin/main and feature
 * branches are cut from there. The env var `GIT_SAFE_MAIN_BRANCH` still
 * configures the upstream branch name (default: `main`).
 *
 * With `parentBranch` (stacking case), HEAD is compared against the LOCAL
 * parent branch tip — a mid-chain stack parent may not have been submitted
 * yet, so it may not exist on origin at all. `origin/<mainBranch>` remains
 * the comparison only for the trunk case.
 */
export function gitSafeToStart(
  parentBranch?: string,
  deps: SpawnDeps = {},
): GitSafeResult {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const mainBranch = process.env.GIT_SAFE_MAIN_BRANCH ?? 'main';
  const baseRef = parentBranch ?? `origin/${mainBranch}`;

  // Check inside work tree
  const insideRepo = run('git', ['rev-parse', '--is-inside-work-tree'], spawn);
  if (insideRepo.exitCode !== 0) {
    return { ok: false, reason: 'not inside a git work tree' };
  }

  // Check HEAD == base ref
  const headSha = run('git', ['rev-parse', 'HEAD'], spawn);
  if (headSha.exitCode !== 0) {
    return { ok: false, reason: 'git rev-parse HEAD failed unexpectedly' };
  }
  const baseSha = run('git', ['rev-parse', baseRef], spawn);
  if (baseSha.exitCode !== 0) {
    return {
      ok: false,
      reason: parentBranch
        ? `could not resolve local parent branch ${parentBranch}`
        : `could not resolve origin/${mainBranch}; check remote access`,
    };
  }
  if (headSha.stdout !== baseSha.stdout) {
    return {
      ok: false,
      reason: `HEAD is not at ${baseRef} (HEAD=${headSha.stdout.slice(0, 7)}, ${baseRef}=${baseSha.stdout.slice(0, 7)})`,
    };
  }

  // Check clean tree
  const statusResult = run('git', ['status', '--porcelain'], spawn);
  if (statusResult.exitCode !== 0) {
    return { ok: false, reason: 'git status failed unexpectedly' };
  }
  if (statusResult.stdout.length > 0) {
    return { ok: false, reason: 'working tree is dirty' };
  }

  return { ok: true };
}

// =============================================================================
// Graphite stack helpers
// =============================================================================
//
// These three wrappers are the ONLY place gt operations are implemented
// (anti-drift rule; conventions live in git-workflow/stacking.md). Command
// shapes and output parsing are pinned to behavior observed on gt 1.8.6
// (verified 2026-07-11).

/**
 * Create a stacked branch on top of `parent` via
 * `gt create <branch> --onto <parent> --no-interactive`.
 *
 * `--onto` avoids checking out the parent first, which also sidesteps the
 * untracked auto-generated branch a superset.sh-style worktree starts on.
 * With a clean tree gt creates an empty branch (no commit), which is the
 * expected pre-work state.
 *
 * PRECONDITION (not validated at runtime, asserted in tests): `branch` must
 * be a branchName()-produced name. `parent` must be a gt-tracked branch
 * (`main` or another stack level).
 */
export function stackCreate(
  branch: string,
  parent: string,
  deps: SpawnDeps = {},
): StackOpResult {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const result = run('gt', ['create', branch, '--onto', parent, '--no-interactive'], spawn);
  return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Submit a branch (and its downstack) via
 * `gt submit --no-interactive --publish --branch <branch>`.
 *
 * `--publish` is load-bearing: on gt 1.8.6, `--no-interactive` creates new
 * PRs in DRAFT mode unless `--publish` is passed, and the git-workflow skill
 * forbids draft PRs. Title/body are canonicalized afterwards with
 * `gh pr edit` (see git-workflow/stacking.md), so gt's own metadata prompts
 * stay disabled.
 */
export function stackSubmit(branch: string, deps: SpawnDeps = {}): StackOpResult {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const result = run(
    'gt',
    ['submit', '--no-interactive', '--publish', '--branch', branch],
    spawn,
    { timeout: 120_000 },
  );
  return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Run `gt sync -f --no-interactive` and report structured restack results.
 *
 * gt sync pulls trunk, deletes local branches whose PRs are merged/closed
 * (`-f` skips the per-branch confirmation), and restacks every tracked
 * branch it can. Branches that would conflict are SKIPPED with a warning —
 * sync never leaves the repo mid-rebase — and branches checked out in
 * another worktree are skipped with their own message (both observed on
 * gt 1.8.6). Callers decide what to do with `conflicted` /
 * `skippedWorktree`; this helper never attempts resolution.
 */
export function syncAndRestack(deps: SpawnDeps = {}): SyncAndRestackResult {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const result = run('gt', ['sync', '-f', '--no-interactive'], spawn, { timeout: 120_000 });
  const rawOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');

  const restacked: string[] = [];
  const conflicted: string[] = [];
  const skippedWorktree: string[] = [];

  for (const line of rawOutput.split('\n')) {
    const clean = line.match(/^Restacked (\S+) on \S+\.$/);
    if (clean) {
      restacked.push(clean[1]);
      continue;
    }
    const conflict = line.match(/^WARNING: (\S+) could not be restacked cleanly\.$/);
    if (conflict) {
      conflicted.push(conflict[1]);
      continue;
    }
    const skipped = line.match(/^Did not restack branch (\S+) because it is checked out in worktree /);
    if (skipped) {
      skippedWorktree.push(skipped[1]);
    }
  }

  return {
    ok: result.exitCode === 0 && conflicted.length === 0,
    restacked,
    conflicted,
    skippedWorktree,
    rawOutput,
  };
}

// =============================================================================
// preflight
// =============================================================================

/**
 * Full preflight gate. Checks:
 *   - dirty_tree:              working tree has uncommitted changes
 *   - behind_main:             HEAD is not at origin/<mainBranch> (or fetch failed)
 *   - missing_gt:              the Graphite CLI (gt) is not installed
 *   - gt_unauthenticated:      gt is installed but not authenticated
 *   - gt_trunk_misconfigured:  gt's trunk is not <mainBranch>
 *   - empty_backlog:           no ready beads excluding needs-human beads
 *
 * The gt failures are hard stops: all branch creation and PR submission goes
 * through gt (git-workflow stacking.md), and there is deliberately no silent
 * fallback to plain git. When gt itself is missing, the auth and trunk probes
 * are skipped — they would only produce confusing follow-on noise.
 *
 * The branch name is not enforced: any branch is acceptable as long as HEAD
 * is at origin/main. This supports worktree workflows where each worktree's
 * branch starts at origin/main.
 */
function checkGtPreflight(spawn: SpawnFn, mainBranch: string): PreflightFailure[] {
  const failures: PreflightFailure[] = [];

  const gtVersion = run('gt', ['--version'], spawn);
  if (gtVersion.exitCode !== 0) {
    failures.push({
      kind: 'missing_gt',
      reason: 'Graphite CLI (gt) not found; install gt and run `gt init` — all branch creation and PR submission goes through gt, with no plain-git fallback',
    });
    return failures;
  }

  const gtAuth = run('gt', ['auth', '--no-interactive'], spawn);
  if (gtAuth.exitCode !== 0 || !gtAuth.stdout.includes('Authenticated as')) {
    failures.push({
      kind: 'gt_unauthenticated',
      reason: 'gt is not authenticated; run `gt auth` interactively before autonomous work',
    });
  }
  const gtTrunk = run('gt', ['trunk'], spawn);
  if (gtTrunk.exitCode !== 0 || gtTrunk.stdout !== mainBranch) {
    failures.push({
      kind: 'gt_trunk_misconfigured',
      reason: `gt trunk is not ${mainBranch} (got: ${gtTrunk.stdout || 'nothing'}); run \`gt init --trunk ${mainBranch}\``,
    });
  }

  return failures;
}

export function preflight(deps: SpawnDeps = {}): PreflightResult {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const mainBranch = process.env.PREFLIGHT_MAIN_BRANCH ?? 'main';
  const readyLimit = parseInt(process.env.PREFLIGHT_READY_LIMIT ?? '50', 10);
  const failures: PreflightFailure[] = [];

  // 1. Clean working tree
  const statusResult = run('git', ['status', '--porcelain'], spawn);
  if (statusResult.stdout.length > 0) {
    failures.push({
      kind: 'dirty_tree',
      reason: 'working tree has uncommitted changes; commit or stash before /process-backlog',
    });
  }

  // 2. HEAD is current with origin/<mainBranch>
  const fetchResult = run('git', ['fetch', 'origin', mainBranch], spawn, { timeout: 30_000 });
  if (fetchResult.exitCode !== 0) {
    failures.push({
      kind: 'behind_main',
      reason: `could not fetch origin/${mainBranch}; check network or remote`,
    });
  }
  else {
    const headSha = run('git', ['rev-parse', 'HEAD'], spawn);
    const baseSha = run('git', ['rev-parse', `origin/${mainBranch}`], spawn);
    if (headSha.exitCode !== 0 || baseSha.exitCode !== 0) {
      failures.push({
        kind: 'behind_main',
        reason: `could not resolve HEAD or origin/${mainBranch}`,
      });
    }
    else if (headSha.stdout !== baseSha.stdout) {
      failures.push({
        kind: 'behind_main',
        reason: `HEAD is not at origin/${mainBranch} (HEAD=${headSha.stdout.slice(0, 7)}, origin/${mainBranch}=${baseSha.stdout.slice(0, 7)}); pull, rebase, or check out a fresh branch from origin/${mainBranch}`,
      });
    }
  }

  // 3. Graphite CLI present, authenticated, trunk configured
  failures.push(...checkGtPreflight(spawn, mainBranch));

  // 4. Backlog non-empty (excluding needs-human)
  const readyResult = run('bd', ['ready', `--limit=${readyLimit}`, '--json'], spawn);
  let unlabelledCount = 0;

  if (readyResult.exitCode === 0 && readyResult.stdout) {
    try {
      const beads = JSON.parse(readyResult.stdout) as BeadJson[];
      for (const bead of beads) {
        const labelResult = run('bd', ['label', 'list', bead.id], spawn);
        const hasNeedsHuman = labelResult.stdout
          .split('\n')
          .some(line => line.trim() === '- needs-human');
        if (!hasNeedsHuman) {
          unlabelledCount++;
        }
      }
    }
    catch {
      // If JSON parse fails, treat as empty
    }
  }

  if (unlabelledCount === 0) {
    failures.push({
      kind: 'empty_backlog',
      reason: 'no ready beads available (excluding needs-human-labelled)',
    });
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

// =============================================================================
// bdTopReady
// =============================================================================

/**
 * Pick the top-priority ready bead, filtering out needs-human beads.
 *
 * Mirrors bd-top-ready.sh: sorts by priority asc then created_at asc.
 * Returns exhausted=true when no eligible bead is found.
 */
export function bdTopReady(deps: SpawnDeps = {}, limit = 5): TopReadyResult {
  const spawn = deps.spawnFn ?? nodeSpawnSync;

  const readyResult = run('bd', ['ready', `--limit=${limit}`, '--json'], spawn);

  if (readyResult.exitCode !== 0 || !readyResult.stdout) {
    return { bead: null, exhausted: true };
  }

  let beads: BeadJson[];
  try {
    beads = JSON.parse(readyResult.stdout) as BeadJson[];
  }
  catch {
    return { bead: null, exhausted: true };
  }

  if (beads.length === 0) {
    return { bead: null, exhausted: true };
  }

  // Filter out needs-human beads
  const eligible: BeadJson[] = [];
  for (const bead of beads) {
    const labelResult = run('bd', ['label', 'list', bead.id], spawn);
    const hasNeedsHuman = labelResult.stdout
      .split('\n')
      .some(line => line.trim() === '- needs-human');
    if (!hasNeedsHuman) {
      eligible.push(bead);
    }
  }

  if (eligible.length === 0) {
    return { bead: null, exhausted: true };
  }

  // Sort: priority asc, then created_at asc
  eligible.sort((a, b) => {
    const pa = a.priority ?? 999;
    const pb = b.priority ?? 999;
    if (pa !== pb) return pa - pb;
    const ca = a.created_at ?? '';
    const cb = b.created_at ?? '';
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });

  return { bead: eligible[0], exhausted: false };
}

// =============================================================================
// bdEscalate
// =============================================================================

/**
 * Mark a bead as needs-human and append an escalation note.
 *
 * Mirrors bd-escalate.sh: idempotent — if today's escalation block is
 * already present in the notes, skips the append but still adds the label.
 */
export function bdEscalate(
  beadId: string,
  reason: string,
  phase: string,
  deps: SpawnDeps = {},
): void {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const today = new Date().toISOString().split('T')[0];

  // Add label (set-based; idempotent)
  run('bd', ['label', 'add', beadId, 'needs-human'], spawn);

  // Check existing notes
  const showResult = run('bd', ['show', beadId, '--json'], spawn);
  let notes = '';
  if (showResult.exitCode === 0 && showResult.stdout) {
    try {
      const parsed = JSON.parse(showResult.stdout) as Array<{ notes?: string }>;
      notes = parsed[0]?.notes ?? '';
    }
    catch {
      // ignore
    }
  }

  // Idempotency: skip if today's section already present
  if (notes.includes(`## Escalation (${today})`)) {
    return;
  }

  const escBlock = `\n## Escalation (${today})\n\nPhase: ${phase}\nReason: ${reason}\n`;
  run('bd', ['update', beadId, '--append-notes', escBlock], spawn);
}

// =============================================================================
// bdCreateFollowup
// =============================================================================

export interface BdCreateFollowupInput {
  parentBeadId: string;
  title: string;
  description: string;
  labels: string[];
  /** Issue type for `bd create`. Defaults to 'task'. */
  type?: 'task' | 'bug' | 'feature';
  /** Priority 0-4. Defaults to 2. */
  priority?: number;
}

export interface BdCreateFollowupResult {
  /** New bead id, or null when creation failed. */
  beadId: string | null;
  /** Raw `bd create` stdout/stderr for diagnostics. */
  rawOutput: string;
}

/** Extract a bead id (e.g. `pv-xkt7`) from `bd create` stdout. */
function parseCreatedBeadId(stdout: string): string | null {
  const match = stdout.match(/\b(pv-[a-z0-9]{3,})\b/i);
  return match ? match[1] : null;
}

/**
 * Create a follow-up bead for concerns deferred from a parent bead.
 *
 * Runs `bd create` with the given title/description, then applies labels via
 * `bd label add`. Always appends `followup-from:<parent>` in addition to any
 * caller-supplied labels. Returns the new bead id (or null on failure).
 */
export function bdCreateFollowup(
  input: BdCreateFollowupInput,
  deps: SpawnDeps = {},
): BdCreateFollowupResult {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const type = input.type ?? 'task';
  const priority = input.priority ?? 2;

  // Quote title/description so the shell (spawn uses shell:true) preserves
  // whitespace and special characters. Single quotes with escaping handles
  // multi-line content safely across POSIX shells.
  const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

  const createResult = run('bd', [
    'create',
    '--title', shellQuote(input.title),
    '--description', shellQuote(input.description),
    '--type', type,
    '--priority', String(priority),
  ], spawn);

  const beadId = parseCreatedBeadId(createResult.stdout);
  const rawOutput = [createResult.stdout, createResult.stderr].filter(Boolean).join('\n');

  if (!beadId) {
    return { beadId: null, rawOutput };
  }

  const parentLabel = `followup-from:${input.parentBeadId}`;
  const labels = Array.from(new Set([parentLabel, ...input.labels]));
  for (const label of labels) {
    run('bd', ['label', 'add', beadId, label], spawn);
  }

  return { beadId, rawOutput };
}

// =============================================================================
// classifyBeadState (pure)
// =============================================================================

/**
 * Pure function: classify bead state from `bd show` text content.
 *
 * Mirrors bd-state.sh section detection logic.
 */
export function classifyBeadState(content: string): StateVerdict {
  const lines = content.split('\n');

  // Detect status from first line header
  const header = lines[0] ?? '';
  let status: 'closed' | 'in_progress' | 'open' | 'unknown' = 'unknown';
  if (/CLOSED/.test(header)) status = 'closed';
  else if (/IN_PROGRESS/.test(header)) status = 'in_progress';
  else if (/OPEN/.test(header)) status = 'open';

  // Helper: check if a section header exists (all-caps on its own line)
  const hasSection = (name: string): boolean =>
    lines.some(l => l.trim() === name);

  // Description is non-empty if there's a non-blank line after DESCRIPTION
  // before the next all-caps header
  const descriptionNonEmpty = (): boolean => {
    let inBlock = false;
    for (const line of lines) {
      if (line.trim() === 'DESCRIPTION') {
        inBlock = true;
        continue;
      }
      if (inBlock) {
        if (/^[A-Z][A-Z ]+$/.test(line.trim()) && line.trim().length > 1) break;
        if (line.trim().length > 0) return true;
      }
    }
    return false;
  };

  // Children section has at least one ↳ line
  const hasChildBead = (): boolean =>
    lines.some(l => /^\s+↳ /.test(l));

  // Notes contain "Implementation Context"
  const hasImplContext = (): boolean =>
    content.includes('Implementation Context');

  // Notes contain "Advisory Review" — written by /plan's ADVISE phase
  const hasAdvisoryReview = (): boolean =>
    content.includes('Advisory Review');

  const reasons: string[] = [];

  const hasDesc = hasSection('DESCRIPTION') && descriptionNonEmpty();
  const hasDesign = hasSection('DESIGN');
  const hasAccept = hasSection('ACCEPTANCE CRITERIA');
  const hasChildren = hasSection('CHILDREN') && hasChildBead();
  const hasImplCtx = hasImplContext();
  const hasAdvised = hasAdvisoryReview();

  if (hasDesc) reasons.push('has non-empty DESCRIPTION');
  else reasons.push('missing or empty DESCRIPTION');

  if (hasDesign) reasons.push('has DESIGN section');
  else reasons.push('missing DESIGN section');

  if (hasAccept) reasons.push('has ACCEPTANCE CRITERIA section');
  else reasons.push('missing ACCEPTANCE CRITERIA section');

  if (hasAdvised) reasons.push('notes contain Advisory Review');
  if (hasChildren) reasons.push('has CHILDREN with at least one child bead');
  if (hasImplCtx) reasons.push('notes contain Implementation Context');

  // Build missing_phases
  const missing: string[] = [];
  if (!hasDesc || !hasDesign || !hasAccept) missing.push('shaped');
  if (!hasAdvised) missing.push('advised');
  if (!hasChildren) missing.push('decomposed');
  if (!hasImplCtx) missing.push('analyzed');

  // Determine state — status overrides section-based detection.
  // Otherwise, state is the highest milestone reached.
  let state: StateVerdict['state'] = 'unshaped';

  if (status === 'closed') {
    state = 'complete';
    reasons.push('bead status is CLOSED');
  }
  else if (status === 'in_progress') {
    state = 'executing';
    reasons.push('bead status is IN_PROGRESS');
  }
  else if (hasImplCtx) {
    state = 'analyzed';
  }
  else if (hasChildren) {
    state = 'decomposed';
  }
  else if (hasAdvised && hasDesc && hasDesign && hasAccept) {
    state = 'advised';
  }
  else if (hasDesc && hasDesign && hasAccept) {
    state = 'shaped';
  }

  return { state, missing_phases: missing, reasons };
}

// =============================================================================
// bdState
// =============================================================================

/**
 * Classify bead lifecycle state via `bd show <beadId>`.
 */
export function bdState(beadId: string, deps: SpawnDeps = {}): StateVerdict {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const result = run('bd', ['show', beadId], spawn);

  if (result.exitCode !== 0) {
    // Return unshaped with empty fields as a safe default
    return {
      state: 'unshaped',
      missing_phases: ['shaped', 'advised', 'decomposed', 'analyzed'],
      reasons: [`bd show ${beadId} failed with exit code ${result.exitCode}`],
    };
  }

  return classifyBeadState(result.stdout);
}

// =============================================================================
// classifySizing (pure)
// =============================================================================

/**
 * Pure function: 2-of-3 decomposition heuristic over scope text.
 *
 * Criteria:
 *   (a) 4+ distinct file paths
 *   (b) 2+ domain areas
 *   (c) 4+ bullet items
 */
export function classifySizing(scopeText: string): SizingVerdict {
  const reasons: string[] = [];
  let passes = 0;

  // (a) File count — look for extension-bearing tokens
  const fileMatches = scopeText.match(
    /[A-Za-z0-9_./-]+\.(ts|tsx|js|vue|scss|css|sql|md|json|yaml|yml|sh|html)/g,
  ) ?? [];
  const uniqueFiles = new Set(fileMatches);
  const fileCount = uniqueFiles.size;

  if (fileCount >= 4) {
    reasons.push(`implies ${fileCount} or more files`);
    passes++;
  }

  // (b) Multi-domain span
  const lc = scopeText.toLowerCase();
  const backendHits = (lc.match(/\b(backend|api|service|entity|migration|sequelize|endpoint|route)\b/g) ?? []).length;
  const frontendHits = (lc.match(/\b(frontend|vue|component|pinia|store|site|client|scss|css)\b/g) ?? []).length;
  const translationHits = (lc.match(/\b(locale|translation|i18n|i18next)\b/g) ?? []).length;
  const federationHits = (lc.match(/\b(activitypub|federation|federated|inbox|outbox|actor)\b/g) ?? []).length;

  let domainsSpanned = 0;
  if (backendHits > 0) domainsSpanned++;
  if (frontendHits > 0) domainsSpanned++;
  if (translationHits > 0) domainsSpanned++;
  if (federationHits > 0) domainsSpanned++;

  if (domainsSpanned >= 2) {
    reasons.push(
      `spans multiple domains (backend=${backendHits}, frontend=${frontendHits}, translation=${translationHits}, federation=${federationHits})`,
    );
    passes++;
  }

  // (c) Bullet items
  const bulletMatches = scopeText.match(/^[ \t]*([-*]|[0-9]+\.)[ \t]+/gm) ?? [];
  const bulletCount = bulletMatches.length;

  if (bulletCount >= 4) {
    reasons.push(`${bulletCount} independent deliverables listed`);
    passes++;
  }

  const needsDecomposition = passes >= 2;

  if (!needsDecomposition && reasons.length === 0) {
    reasons.push('fewer than 4 files, single domain, few deliverables — fits leaf size');
  }

  return { needs_decomposition: needsDecomposition, reasons };
}

// =============================================================================
// bdSizingCheck
// =============================================================================

/**
 * Run sizing check against a bead's DESCRIPTION + DESIGN sections.
 */
export function bdSizingCheck(beadId: string, deps: SpawnDeps = {}): SizingVerdict {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const result = run('bd', ['show', beadId], spawn);

  if (result.exitCode !== 0) {
    return { needs_decomposition: false, reasons: [`bd show ${beadId} failed`] };
  }

  // Extract DESCRIPTION and DESIGN section bodies
  const extractSection = (content: string, name: string): string => {
    const lines = content.split('\n');
    let inBlock = false;
    const collected: string[] = [];
    for (const line of lines) {
      if (line.trim() === name) { inBlock = true; continue; }
      if (inBlock) {
        if (/^[A-Z][A-Z ]+$/.test(line.trim()) && line.trim().length > 1) break;
        collected.push(line);
      }
    }
    return collected.join('\n');
  };

  const scopeText = [
    extractSection(result.stdout, 'DESCRIPTION'),
    extractSection(result.stdout, 'DESIGN'),
  ].join('\n');

  return classifySizing(scopeText);
}

// =============================================================================
// bdEnrichmentCheck
// =============================================================================

/**
 * Check if a bead's notes contain "Implementation Context".
 * Returns true if enriched.
 */
export function bdEnrichmentCheck(beadId: string, deps: SpawnDeps = {}): boolean {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const result = run('bd', ['show', beadId], spawn);

  if (result.exitCode !== 0) return false;

  return result.stdout.includes('Implementation Context');
}

// =============================================================================
// bdListChildren
// =============================================================================

/**
 * List the parent-child leaf IDs of a bead via `bd show <id> --json`.
 *
 * Returns the ids of `dependents` whose `dependency_type === 'parent-child'`,
 * or an empty array if the bead has no children or the call fails. The Analyze
 * phase uses this to discover children produced by Decompose when the caller
 * doesn't inject `childIds` explicitly (tests inject; production doesn't).
 */
export function bdListChildren(beadId: string, deps: SpawnDeps = {}): string[] {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const result = run('bd', ['show', beadId, '--json'], spawn);

  if (result.exitCode !== 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  }
  catch {
    return [];
  }

  const record = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!record || typeof record !== 'object') return [];

  const dependents = (record as { dependents?: unknown }).dependents;
  if (!Array.isArray(dependents)) return [];

  const childIds: string[] = [];
  for (const dep of dependents) {
    if (!dep || typeof dep !== 'object') continue;
    const d = dep as { id?: unknown; dependency_type?: unknown };
    if (d.dependency_type === 'parent-child' && typeof d.id === 'string') {
      childIds.push(d.id);
    }
  }
  return childIds;
}

// =============================================================================
// bdShowJson
// =============================================================================

/**
 * Load the full JSON record for a bead via `bd show <id> --json`. Returns null
 * when the call fails or the output is unparseable. `bd show --json` wraps its
 * output in a single-element array; this helper unwraps it.
 */
export function bdShowJson(beadId: string, deps: SpawnDeps = {}): BeadJson | null {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const result = run('bd', ['show', beadId, '--json'], spawn);
  if (result.exitCode !== 0 || !result.stdout) return null;

  try {
    const parsed = JSON.parse(result.stdout);
    const record = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!record || typeof record !== 'object') return null;
    return record as BeadJson;
  }
  catch {
    return null;
  }
}

// =============================================================================
// checkEpicPromotion
// =============================================================================

/**
 * Decide whether a selected leaf bead should be promoted to its parent epic.
 *
 * Promotion condition: the selected bead's parent is an analyzed epic with
 * at least 2 ready children (including the selected bead itself). This lets
 * the orchestrator run the epic as a wave — one branch, one PR closing all
 * children — instead of fragmenting the epic across multiple single-leaf runs.
 *
 * Note: an analyzed epic is always "blocked" by its own unclosed children in
 * bd's dependency DAG. That is NOT disqualifying — it's exactly the condition
 * under which wave orchestration applies.
 *
 * Returns null when any of these hold:
 *   - the selected bead has no parent
 *   - the parent is not an epic
 *   - the parent has not reached the 'analyzed' state
 *   - fewer than 2 children are currently ready (no unmet blockers,
 *     not labelled needs-human)
 */
export function checkEpicPromotion(
  selectedBeadId: string,
  deps: SpawnDeps = {},
): EpicPromotionResult | null {
  const spawn = deps.spawnFn ?? nodeSpawnSync;

  // 1. Load selected bead, check for a parent
  const selected = bdShowJson(selectedBeadId, deps);
  if (!selected || !selected.parent) return null;

  // 2. Load parent, require epic
  const parent = bdShowJson(selected.parent, deps);
  if (!parent || parent.issue_type !== 'epic') return null;

  // 3. Require analyzed state — we don't promote to an epic that hasn't had
  //    its children enriched yet, since the wave executor needs enrichment.
  const parentState = bdState(parent.id, deps);
  if (parentState.missing_phases.includes('analyzed')) return null;

  // 4. Count ready children. Build a set of currently-ready bead ids from
  //    `bd ready --json` to match bd's own readiness semantics, then count
  //    how many of the epic's children appear in that set.
  const readyResult = run('bd', ['ready', '--limit=200', '--json'], spawn);
  if (readyResult.exitCode !== 0) return null;

  let readyBeads: BeadJson[];
  try {
    readyBeads = JSON.parse(readyResult.stdout) as BeadJson[];
  }
  catch {
    return null;
  }

  const readyIds = new Set(readyBeads.map(b => b.id));
  const childIds = bdListChildren(parent.id, deps);

  let readyChildCount = 0;
  for (const childId of childIds) {
    if (!readyIds.has(childId)) continue;
    // Exclude children that are labelled needs-human
    const labelResult = run('bd', ['label', 'list', childId], spawn);
    const hasNeedsHuman = labelResult.stdout
      .split('\n')
      .some(line => line.trim() === '- needs-human');
    if (!hasNeedsHuman) readyChildCount++;
  }

  if (readyChildCount < 2) return null;

  return {
    epicId: parent.id,
    epicTitle: typeof parent.title === 'string' ? parent.title : undefined,
    readyChildCount,
  };
}

// =============================================================================
// branchName (pure)
// =============================================================================

/** Prefix map for conventional commit branch names. */
const BRANCH_PREFIX_MAP: Record<string, string> = {
  bug: 'fix',
  feature: 'feat',
  epic: 'feat',
  task: 'chore',
};

/**
 * Derive a branch name from bead metadata. Pure function.
 *
 * Format: <prefix>.<kebab-title>
 * Max length: 60 chars total.
 *
 * Bead IDs do not appear in branch names — see git-workflow skill's
 * foundational principle: GitHub artifacts are self-contained for GitHub
 * readers, so local tracker references stay out of branch names, commits,
 * and PR bodies.
 */
export function branchName(
  title: string,
  issueType: string,
): string {
  const MAX_LEN = 60;
  const prefix = BRANCH_PREFIX_MAP[issueType] ?? 'chore';

  // Kebab-case the title
  const kebabFull = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // Reserve space: prefix + "."
  const reserved = prefix.length + 1;
  const budget = Math.max(8, MAX_LEN - reserved);

  const kebab = kebabFull.length > budget
    ? kebabFull.slice(0, budget).replace(/-+$/, '')
    : kebabFull;

  return `${prefix}.${kebab}`;
}

// =============================================================================
// commitMsg (pure)
// =============================================================================

/** Commit type prefix map. */
const COMMIT_TYPE_MAP: Record<string, string> = {
  bug: 'fix',
  feature: 'feat',
  epic: 'feat',
  task: 'chore',
};

/**
 * Format a conventional commit message header. Pure function.
 *
 * Format: <type>(<scope>): <summary>
 *      or <type>: <summary>
 *
 * Bead IDs do not appear in commit messages — see git-workflow skill's
 * foundational principle.
 */
export function commitMsg(
  summary: string,
  issueType: string,
  scope?: string,
): string {
  const type = COMMIT_TYPE_MAP[issueType] ?? 'chore';
  const cleanSummary = summary.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

  if (scope) {
    return `${type}(${scope}): ${cleanSummary}`;
  }
  return `${type}: ${cleanSummary}`;
}

// =============================================================================
// prBody (pure)
// =============================================================================

/**
 * Generate PR markdown body. Pure function.
 *
 * Sections: ## Motivation, ## Approach, ## Validation. Matches the template
 * in the git-workflow skill's pull-requests.md. No Summary, no Beads-closed
 * list — bead IDs and other local tracker references must not appear in
 * GitHub-visible artifacts.
 */
export function prBody(
  title: string,
  description: string,
): string {
  const motivation = description.trim().length > 0
    ? description.trim()
    : title;

  const lines: string[] = [
    '## Motivation',
    '',
    motivation,
    '',
    '## Approach',
    '',
    title,
    '',
    '## Validation',
    '',
    '- [ ] `npm run lint`',
    '- [ ] `npm run test:unit`',
    '- [ ] `npm run test:integration`',
    '- [ ] `npm run build`',
    '- [ ] Relevant e2e specs passing via build-guardian',
  ];

  return lines.join('\n');
}

// =============================================================================
// discoverAgents
// =============================================================================

/**
 * Read agent files matching a suffix from disk.
 * Reads YAML frontmatter for name and description.
 *
 * @param suffix - e.g. 'auditor', 'advisor', 'verifier'
 * @param agentsDir - defaults to '.claude/agents'
 */
export function discoverAgents(
  suffix: string,
  agentsDir = '.claude/agents',
): AgentInfo[] {
  let files: string[];
  try {
    files = readdirSync(agentsDir)
      .filter(f => f.endsWith(`-${suffix}.md`))
      .sort()
      .map(f => join(agentsDir, f));
  }
  catch {
    return [];
  }

  const agents: AgentInfo[] = [];

  for (const filePath of files) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const name = extractFrontmatter(content, 'name');
      const description = extractFrontmatter(content, 'description');

      if (!name) continue;

      agents.push({ name, path: filePath, description: description ?? '' });
    }
    catch {
      // skip unreadable files
    }
  }

  return agents;
}

/**
 * Extract a scalar value from YAML frontmatter delimited by `---` lines.
 */
function extractFrontmatter(content: string, key: string): string | null {
  const lines = content.split('\n');
  let inFm = false;
  let sawOpen = false;

  for (const line of lines) {
    if (/^---\s*$/.test(line)) {
      if (!sawOpen) { sawOpen = true; inFm = true; continue; }
      else { break; }
    }
    if (!inFm) continue;

    const match = line.match(new RegExp(`^${key}\\s*:\\s*(.+)$`));
    if (match) {
      let value = match[1].trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      return value;
    }
  }

  return null;
}

