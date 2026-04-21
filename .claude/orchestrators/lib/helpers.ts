/**
 * Deterministic helper functions for the process-backlog orchestrator.
 *
 * All functions that previously shelled out to .sh scripts now live here
 * as typed TypeScript. CLI-calling functions accept an injectable `spawnFn`
 * for testing; pure functions have no I/O at all.
 *
 * Exports:
 *   CLI helpers: gitSafeToStart, preflight, bdTopReady, bdEscalate,
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
  [key: string]: unknown;
}

export interface TopReadyResult {
  bead: BeadJson | null;
  exhausted: boolean;
}

export interface StateVerdict {
  state: 'unshaped' | 'shaped' | 'decomposed' | 'analyzed' | 'executing' | 'complete';
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
 * Check that the working tree is clean and we are on the main branch.
 *
 * Mirrors git-safe-to-start.sh logic:
 *   - must be inside a git work tree
 *   - current branch must be 'main' (or GIT_SAFE_MAIN_BRANCH override)
 *   - working tree must be clean (git status --porcelain is empty)
 */
export function gitSafeToStart(deps: SpawnDeps = {}): GitSafeResult {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const mainBranch = process.env.GIT_SAFE_MAIN_BRANCH ?? 'main';

  // Check inside work tree
  const insideRepo = run('git', ['rev-parse', '--is-inside-work-tree'], spawn);
  if (insideRepo.exitCode !== 0) {
    return { ok: false, reason: 'not inside a git work tree' };
  }

  // Check branch
  const branchResult = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], spawn);
  if (branchResult.exitCode !== 0) {
    return { ok: false, reason: 'git rev-parse failed unexpectedly' };
  }
  if (branchResult.stdout !== mainBranch) {
    return {
      ok: false,
      reason: `on '${branchResult.stdout}', expected '${mainBranch}'`,
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
// preflight
// =============================================================================

/**
 * Full preflight gate. Checks:
 *   - dirty_tree:     working tree has uncommitted changes
 *   - wrong_branch:   not on main (or GIT_SAFE_MAIN_BRANCH)
 *   - stale_main:     local main differs from origin/main
 *   - empty_backlog:  no ready beads excluding needs-human beads
 */
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

  // 2. On main branch
  const branchResult = run('git', ['branch', '--show-current'], spawn);
  if (branchResult.stdout !== mainBranch) {
    failures.push({
      kind: 'wrong_branch',
      reason: `expected to be on '${mainBranch}' but currently on '${branchResult.stdout}'`,
    });
  }

  // 3. Local main in sync with origin/main
  const fetchResult = run('git', ['fetch', 'origin', mainBranch], spawn, { timeout: 30_000 });
  if (fetchResult.exitCode !== 0) {
    failures.push({
      kind: 'stale_main',
      reason: `could not fetch origin/${mainBranch}; check network or remote`,
    });
  }
  else {
    const diffResult = run('git', ['diff', `origin/${mainBranch}`, '--quiet'], spawn);
    if (diffResult.exitCode !== 0) {
      failures.push({
        kind: 'stale_main',
        reason: `local ${mainBranch} differs from origin/${mainBranch}; pull or reset before /process-backlog`,
      });
    }
  }

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

  const reasons: string[] = [];

  const hasDesc = hasSection('DESCRIPTION') && descriptionNonEmpty();
  const hasDesign = hasSection('DESIGN');
  const hasAccept = hasSection('ACCEPTANCE CRITERIA');
  const hasChildren = hasSection('CHILDREN') && hasChildBead();
  const hasImplCtx = hasImplContext();

  if (hasDesc) reasons.push('has non-empty DESCRIPTION');
  else reasons.push('missing or empty DESCRIPTION');

  if (hasDesign) reasons.push('has DESIGN section');
  else reasons.push('missing DESIGN section');

  if (hasAccept) reasons.push('has ACCEPTANCE CRITERIA section');
  else reasons.push('missing ACCEPTANCE CRITERIA section');

  if (hasChildren) reasons.push('has CHILDREN with at least one child bead');
  if (hasImplCtx) reasons.push('notes contain Implementation Context');

  // Build missing_phases
  const missing: string[] = [];
  if (!hasDesc || !hasDesign || !hasAccept) missing.push('shaped');
  if (!hasChildren) missing.push('decomposed');
  if (!hasImplCtx) missing.push('analyzed');

  // Determine state — status overrides section-based detection
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
      missing_phases: ['shaped', 'decomposed', 'analyzed'],
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
 * Format: <prefix>/<kebab-title>-<id-slug>
 * Max length: 60 chars total.
 * Dots in beadId are replaced with hyphens.
 */
export function branchName(
  beadId: string,
  title: string,
  issueType: string,
): string {
  const MAX_LEN = 60;
  const prefix = BRANCH_PREFIX_MAP[issueType] ?? 'chore';
  const idSlug = beadId.replace(/\./g, '-');

  // Kebab-case the title
  const kebabFull = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // Reserve space: prefix + "/" + "-" + idSlug
  const reserved = prefix.length + 1 + 1 + idSlug.length;
  const budget = Math.max(8, MAX_LEN - reserved);

  let kebab = kebabFull.length > budget
    ? kebabFull.slice(0, budget).replace(/-+$/, '')
    : kebabFull;

  return `${prefix}/${kebab}-${idSlug}`;
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
 * Format a conventional commit message. Pure function.
 *
 * Format: <type>(<scope>): <summary> (<beadId>)
 *      or <type>: <summary> (<beadId>)
 */
export function commitMsg(
  beadId: string,
  summary: string,
  issueType: string,
  scope?: string,
): string {
  const type = COMMIT_TYPE_MAP[issueType] ?? 'chore';
  const cleanSummary = summary.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

  if (scope) {
    return `${type}(${scope}): ${cleanSummary} (${beadId})`;
  }
  return `${type}: ${cleanSummary} (${beadId})`;
}

// =============================================================================
// prBody (pure)
// =============================================================================

/**
 * Generate PR markdown body. Pure function.
 *
 * Sections: ## Summary, ## Beads closed, ## Test plan.
 */
export function prBody(
  primaryTitle: string,
  primaryDesc: string,
  beads: BeadRef[],
): string {
  // Extract first sentence from description
  const summaryLine = (() => {
    const flat = primaryDesc.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const dotIdx = flat.indexOf('. ');
    if (dotIdx >= 0) {
      return flat.slice(0, dotIdx + 1);
    }
    return flat.endsWith('.') ? flat : flat + '.';
  })();

  const lines: string[] = [
    '## Summary',
    '',
    `- ${primaryTitle}`,
    ...(primaryDesc ? [`- ${summaryLine}`] : []),
    '',
    '## Beads closed',
    '',
    ...beads.map(b => `- ${b.id} - ${b.title}`),
    '',
    '## Test plan',
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
 * @param suffix - e.g. 'auditor', 'advisor', 'reviewer', 'verifier'
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

