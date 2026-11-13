/**
 * Deterministic half of `/spawn-bead-workers --scheduled`: flag validation,
 * preflight, the four gates, root selection, the `## Build state` parser,
 * the state write and the dry run.
 *
 * Exports:
 *   Constants: QUEUE_GATE, GH_PR_LIMIT, MAX_FIRINGS, ROOT_ID, REPORT_DIR, LOCK_PATH
 *   Pure: validateFlags, assertRootId, lockDecision, passingCi, queueGate,
 *     priorEpicGate, selectRoot, evaluateGates, parseBuildState,
 *     buildStateWriteArgs, stateWriteCommand, chainPlanInput
 *   CLI helpers (injectable Runner): execRunner, readBeads, readOpenPrs,
 *     readBead, readChildren, runPreflight, runGates, runQueueGate, runDryRun
 *
 * Every external command goes through a Runner: execFileSync with an argv
 * array, never a shell. Any non-zero exit, unparsable JSON or missing field
 * is a failed reading, never a pass.
 *
 * Operator-facing flow: .agents/skills/build-scheduled/SKILL.md
 */

import { execFileSync } from 'node:child_process';
// The first cross-skill script import, accepted on purpose: the build stage
// consumes the planner's spec:ready, so both state writes share one table.
import {
  type Bead,
  type StateLabel,
  hasHeading,
  labelsOwnedBy,
  stateWriteArgs,
} from '../../../plan-scheduled/scripts/lib/spec.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * /clear-backlog's scheduled queue gate, unchanged. Pinned by a unit test to
 * the `<!-- queue-gate: ... -->` marker in .agents/commands/clear-backlog.md.
 */
export const QUEUE_GATE = { open: 10, ageDays: 7 } as const;

/** `gh pr list --limit`; a result this long may be truncated, so it fails. */
export const GH_PR_LIMIT = 200;

/** The third counted firing still building stalls the root (pv-256c.3). */
export const MAX_FIRINGS = 3;

export const ROOT_ID = /^pv-[a-z0-9]+(\.[0-9]+)*$/;

export const REPORT_DIR = 'reports/spawn-bead-workers';
export const LOCK_PATH = `${REPORT_DIR}/.lock`;

const STACK_TS = '.agents/skills/bead-branch-and-pr/scripts/stack.ts';

const HOLD = 'build:hold';
const NEEDS_HUMAN = 'needs-human';

/** git-workflow/branches.md: `<type>.<kebab-title>`, at most 60 characters. */
const BRANCH = /^(feat|fix|chore|refactor|docs|test|perf|ci|build|style)\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BRANCH_MAX = 60;

// =============================================================================
// Types
// =============================================================================

/** A `bd ... --json` row, with the fields this skill reads beyond spec.ts's. */
export interface BuildBead extends Bead {
  updated_at?: string;
  /**
   * When the root reached spec:ready, from a label event. bd 1.2.2's
   * history carries no labels, so the CLI never supplies it today.
   */
  spec_ready_at?: string;
  /**
   * `bd children`/`bd list` rows carry `{depends_on_id, type}`; `bd show`
   * rows carry `{id, dependency_type}`. Either names the blocker.
   */
  dependencies?: { id?: string; dependency_type?: string; issue_id?: string; depends_on_id?: string; type?: string }[];
}

export interface PrRow {
  number: number;
  isDraft: boolean;
  createdAt: string;
  reviewDecision: string | null;
  statusCheckRollup: unknown[];
}

export type Verdict = 'pass' | 'fail' | 'skipped' | 'not-run';

export interface Reading {
  check: string;
  verdict: Verdict;
  reading: string;
}

export interface Skip {
  id: string;
  reason: string;
}

export interface Selection {
  root: string | null;
  kind: 'resume' | 'ready' | null;
  /** Ordering source for a spec:ready pick; null on resume or no pick. */
  source: 'label-event' | 'updated_at' | null;
  at: string | null;
  skipped: Skip[];
}

export interface Failure {
  error: string;
}

export type Mode = 'run' | 'dry';

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type Runner = (cmd: string, args: string[]) => RunResult;

// =============================================================================
// Flags and ids
// =============================================================================

export type FlagCheck =
  | { ok: true; scheduled: boolean; dryRun: boolean }
  | { ok: false; error: string };

/**
 * `--scheduled` takes no epic id and none of `--only`, `--sequential`,
 * `--resume`: selection is the whole input and resume is automatic.
 * Attended argv is the command's business and passes through.
 */
export function validateFlags(argv: string[]): FlagCheck {
  const scheduled = argv.includes('--scheduled');
  const dryRun = argv.includes('--dry-run');
  if (!scheduled) return { ok: true, scheduled, dryRun };
  for (const token of argv) {
    if (token === '--scheduled' || token === '--dry-run') continue;
    if (token === '--only' || token.startsWith('--only=')) {
      return { ok: false, error: '--scheduled refuses --only: selection is the whole input' };
    }
    if (token === '--sequential' || token === '--resume') {
      return { ok: false, error: `--scheduled refuses ${token}` };
    }
    if (token.startsWith('-')) {
      return { ok: false, error: `--scheduled refuses unknown flag ${token}` };
    }
    return { ok: false, error: `--scheduled refuses an epic id (${token}): selection picks the root` };
  }
  return { ok: true, scheduled, dryRun };
}

export function assertRootId(id: string): void {
  if (!ROOT_ID.test(id)) throw new Error(`invalid root id: ${JSON.stringify(id)}`);
}

// =============================================================================
// Lock
// =============================================================================

export interface LockDecision {
  verdict: 'take' | 'replace' | 'held' | 'malformed';
  reading: string;
}

/**
 * One scheduled run per checkout. `content` is the lock file's text or null.
 * A live holder stops the run, a dead one is stale and replaced, the
 * session's own pid re-takes it, and anything unparsable fails closed.
 */
export function lockDecision(
  content: string | null,
  isAlive: (pid: number) => boolean,
  ownerPid: number,
): LockDecision {
  if (content === null) return { verdict: 'take', reading: 'no lock' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  }
  catch {
    return { verdict: 'malformed', reading: `malformed lock ${LOCK_PATH}: not JSON` };
  }
  const lock = parsed as { pid?: unknown; started?: unknown };
  if (
    typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
    || !Number.isSafeInteger(lock.pid) || (lock.pid as number) <= 0
    || typeof lock.started !== 'string'
  ) {
    return { verdict: 'malformed', reading: `malformed lock ${LOCK_PATH}: needs {pid, started}` };
  }
  const pid = lock.pid as number;
  if (pid === ownerPid) return { verdict: 'take', reading: `already held by this session (pid ${pid})` };
  if (isAlive(pid)) {
    return { verdict: 'held', reading: `held by live pid ${pid} since ${lock.started}` };
  }
  return { verdict: 'replace', reading: `stale lock (pid ${pid} not running) replaced` };
}

// =============================================================================
// Queue gate
// =============================================================================

const PASSING_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const ROLLUP_TYPES = new Set(['CheckRun', 'StatusContext']);

type RollupEntry = { __typename?: string; status?: string; conclusion?: string; state?: string };

/**
 * Passing CI: at least one check, and every check finished green. A pending
 * check is not passing; neither is a PR with no checks at all. Entries of an
 * unknown type never pass; queueGate refuses them before asking.
 */
export function passingCi(rollup: unknown[]): boolean {
  if (rollup.length === 0) return false;
  return rollup.every(entry => {
    const c = entry as RollupEntry;
    if (c.__typename === 'CheckRun') {
      return c.status === 'COMPLETED' && PASSING_CONCLUSIONS.has(c.conclusion ?? '');
    }
    if (c.__typename === 'StatusContext') return c.state === 'SUCCESS';
    return false;
  });
}

function unknownRollupEntry(prs: PrRow[]): number | null {
  const bad = prs.find(p => p.statusCheckRollup.some(e => !ROLLUP_TYPES.has((e as RollupEntry)?.__typename ?? '')));
  return bad ? bad.number : null;
}

/**
 * Fails at QUEUE_GATE.open or more open non-draft PRs passing CI with no
 * change request, or when the oldest such PR is older than
 * QUEUE_GATE.ageDays. A result as long as the --limit fails closed.
 */
export function queueGate(prs: PrRow[], now: Date): Reading {
  const check = 'queue';
  if (prs.length >= GH_PR_LIMIT) {
    return { check, verdict: 'fail', reading: `gh pr list returned its limit (${GH_PR_LIMIT}); the queue may be truncated` };
  }
  const unknown = unknownRollupEntry(prs);
  if (unknown !== null) {
    return { check, verdict: 'fail', reading: `gh pr list: #${unknown} has a status check of unknown __typename` };
  }
  const counted = prs.filter(p => !p.isDraft && passingCi(p.statusCheckRollup) && p.reviewDecision !== 'CHANGES_REQUESTED');
  const ages = counted.map(p => (now.getTime() - Date.parse(p.createdAt)) / 86_400_000);
  const oldest = ages.length ? Math.max(...ages) : null;
  const full = counted.length >= QUEUE_GATE.open;
  const stale = oldest !== null && oldest > QUEUE_GATE.ageDays;
  const reading = `${counted.length} open non-draft PRs passing CI with no change request (stops at ${QUEUE_GATE.open}); `
    + (oldest === null ? 'none to age' : `oldest ${oldest.toFixed(1)} days (stops beyond ${QUEUE_GATE.ageDays})`);
  return { check, verdict: full || stale ? 'fail' : 'pass', reading };
}

// =============================================================================
// Build state
// =============================================================================

export interface BuildLevel {
  branch: string;
  pr: number;
}

export interface BuildChain {
  index: number;
  levels: BuildLevel[];
  /** The next level's branch, or `done`. */
  next: string;
}

export interface BuildState {
  firings: number;
  restart: 'none' | 'resume';
  chains: BuildChain[];
  stopped: string;
  /** Every recorded PR number, in chain order. */
  prs: number[];
}

export type BuildStateParse = { ok: true; state: BuildState | null } | { ok: false; stall: string };

const STATE_HEADING = /^## Build state(?: \([^)\n]*\))?$/;
const ANY_HEADING = /^#{1,6}[ \t]/;
const FENCE = /^(`{3,}|~{3,})/;

/** The body lines of the last unfenced `## Build state` heading, or null. */
function lastStateBody(notes: string): string[] | null {
  const lines = notes.split('\n').map(l => l.trimEnd());
  let fence: string | null = null;
  const headings: number[] = [];
  lines.forEach((line, i) => {
    const f = line.match(FENCE);
    if (fence !== null) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
      return;
    }
    if (f) {
      fence = f[1];
      return;
    }
    if (ANY_HEADING.test(line)) headings.push(i);
  });
  const starts = headings.filter(i => STATE_HEADING.test(lines[i]));
  if (!starts.length) return null;
  const start = starts[starts.length - 1];
  const end = headings.find(i => i > start) ?? lines.length;
  return lines.slice(start + 1, end).filter(l => l.trim() !== '');
}

function validBranch(name: string): boolean {
  return name.length <= BRANCH_MAX && BRANCH.test(name);
}

/**
 * Strict parse of the last `## Build state` block (shape in SKILL.md).
 * Headings inside fenced text — a `## Build stall` report — never count. A
 * malformed last block is a stall reason; there is no fallback to an
 * earlier block. No block at all is `state: null`.
 */
export function parseBuildState(notes: string | undefined): BuildStateParse {
  const body = lastStateBody(notes ?? '');
  if (body === null) return { ok: true, state: null };
  const bad = (what: string, line?: string): BuildStateParse => ({
    ok: false,
    stall: `malformed Build state block: ${what}${line === undefined ? '' : ` (line: ${JSON.stringify(line)})`}`,
  });

  if (body.length < 4) return bad(`expected firings, restart, chain and stopped lines, got ${body.length} lines`);

  const firings = body[0].match(/^firings: (\d+)$/);
  if (!firings) return bad('first line must be "firings: <n>"', body[0]);
  const count = Number(firings[1]);
  if (count > MAX_FIRINGS) return bad(`firings out of range 0-${MAX_FIRINGS}`, body[0]);

  const restart = body[1].match(/^restart: (none|resume)$/);
  if (!restart) return bad('second line must be "restart: none | resume"', body[1]);

  const stopped = body[body.length - 1].match(/^stopped: (\S.*)$/);
  if (!stopped) return bad('last line must be "stopped: <reason | none>"', body[body.length - 1]);

  const chains: BuildChain[] = [];
  for (const line of body.slice(2, -1)) {
    const m = line.match(/^chain (\d+): (.+); next: (\S+)$/);
    if (!m) return bad('expected "chain <k>: <levels>; next: <branch|done>"', line);
    const index = Number(m[1]);
    if (index !== chains.length + 1) return bad(`chain ${index} out of order`, line);
    const levels: BuildLevel[] = [];
    if (m[2] !== '-') {
      for (const part of m[2].split(', ')) {
        const level = part.match(/^(\S+) → #([1-9][0-9]{0,6})$/);
        if (!level) return bad('level must be "<branch> → #<pr>"', line);
        if (!validBranch(level[1])) return bad(`branch ${level[1]} is not <type>.<kebab>`, line);
        levels.push({ branch: level[1], pr: Number(level[2]) });
      }
    }
    if (m[3] !== 'done' && !validBranch(m[3])) return bad(`next ${m[3]} is not done or <type>.<kebab>`, line);
    chains.push({ index, levels, next: m[3] });
  }

  return {
    ok: true,
    state: {
      firings: count,
      restart: restart[1] as 'none' | 'resume',
      chains,
      stopped: stopped[1],
      prs: chains.flatMap(c => c.levels.map(l => l.pr)),
    },
  };
}

// =============================================================================
// Gates and selection
// =============================================================================

function labelsOf(b: BuildBead): string[] {
  return b.labels ?? [];
}

function isRoot(b: BuildBead): boolean {
  return b.parent == null;
}

/**
 * Gate 2: fails if any open PR is recorded in the last Build state block of
 * a spec:built root, open or closed. A missing or malformed block fails
 * closed: a spec:built root without its PR record is a missing field.
 */
export function priorEpicGate(beads: BuildBead[], openPrs: Set<number>): Reading {
  const check = 'prior-epic-in-review';
  const built = beads.filter(b => isRoot(b) && labelsOf(b).includes('spec:built'));
  const hits: string[] = [];
  for (const root of built) {
    const parsed = parseBuildState(root.notes);
    if (!parsed.ok) return { check, verdict: 'fail', reading: `${root.id}: ${parsed.stall}` };
    if (parsed.state === null) {
      return { check, verdict: 'fail', reading: `spec:built root ${root.id} has no Build state block` };
    }
    const open = parsed.state.prs.filter(n => openPrs.has(n));
    if (open.length) hits.push(`${root.id} has open PR ${open.map(n => `#${n}`).join(', ')}`);
  }
  if (hits.length) return { check, verdict: 'fail', reading: hits.join('; ') };
  return { check, verdict: 'pass', reading: `${built.length} spec:built root(s), none with an open recorded PR` };
}

function holdReason(b: BuildBead): string | null {
  if (labelsOf(b).includes(HOLD)) return HOLD;
  if (labelsOf(b).includes(NEEDS_HUMAN)) return NEEDS_HUMAN;
  if (!ROOT_ID.test(b.id)) return 'id fails the root-id pattern';
  return null;
}

/**
 * Resume first: an open spec:building root without build:hold or
 * needs-human (lowest id if several). Otherwise the open spec:ready root
 * that reached spec:ready earliest — label-event time when known, else
 * updated_at — ties by id. Every skipped candidate is named with a reason.
 */
export function selectRoot(beads: BuildBead[]): Selection {
  const roots = beads.filter(b => isRoot(b) && b.status !== 'closed').sort((a, b) => a.id.localeCompare(b.id));
  const skipped: Skip[] = [];

  const building = roots.filter(b => labelsOf(b).includes('spec:building'));
  let resume: string | null = null;
  for (const b of building) {
    const reason = holdReason(b);
    if (reason) skipped.push({ id: b.id, reason });
    else if (resume === null) resume = b.id;
    else skipped.push({ id: b.id, reason: `another spec:building root (${resume}) resumes first` });
  }

  const candidates: { id: string; at: string; source: 'label-event' | 'updated_at' }[] = [];
  for (const b of roots.filter(r => labelsOf(r).includes('spec:ready'))) {
    const state = parseBuildState(b.notes);
    const reason = holdReason(b)
      ?? (hasHeading(b.notes, 'Bead Analysis') ? null : 'no Bead Analysis heading: run /analyze-bead')
      ?? (state.ok && state.state === null ? null : 'spec:ready but already has a Build state block')
      ?? ((b.spec_ready_at ?? b.updated_at) ? null : 'no updated_at to order by');
    if (reason) {
      skipped.push({ id: b.id, reason });
      continue;
    }
    const candidate = b.spec_ready_at
      ? { id: b.id, at: b.spec_ready_at, source: 'label-event' as const }
      : { id: b.id, at: b.updated_at as string, source: 'updated_at' as const };
    if (Number.isNaN(Date.parse(candidate.at))) {
      skipped.push({ id: b.id, reason: `unparsable ${candidate.source} timestamp ${JSON.stringify(candidate.at)}` });
      continue;
    }
    candidates.push(candidate);
  }

  if (resume !== null) return { root: resume, kind: 'resume', source: null, at: null, skipped };
  candidates.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  const pick = candidates[0];
  if (!pick) return { root: null, kind: null, source: null, at: null, skipped };
  return { root: pick.id, kind: 'ready', source: pick.source, at: pick.at, skipped };
}

export interface GatesInput {
  beads: BuildBead[] | Failure;
  prs: PrRow[] | Failure;
  now: Date;
  mode: Mode;
}

export interface GatesResult {
  ok: boolean;
  gates: Reading[];
  selection: Selection | null;
}

function isFailure<T>(value: T | Failure): value is Failure {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'error' in value;
}

/**
 * The four gates, in order. A real run evaluates none after the first
 * failure (`not-run`); a dry run evaluates all of them. Resume skips gates 2
 * and 4 and keeps the queue gate.
 */
export function evaluateGates({ beads, prs, now, mode }: GatesInput): GatesResult {
  const gates: Reading[] = [];
  let failed = false;
  const add = (reading: Reading): void => {
    gates.push(reading);
    if (reading.verdict === 'fail') failed = true;
  };
  const halted = (): boolean => mode === 'run' && failed;
  const notRun = (check: string): Reading => ({ check, verdict: 'not-run', reading: 'an earlier check failed' });

  const selection = isFailure(beads) ? null : selectRoot(beads);
  const resuming = selection?.kind === 'resume';

  add(isFailure(beads)
    ? { check: 'resume-first', verdict: 'fail', reading: beads.error }
    : { check: 'resume-first', verdict: 'pass', reading: resuming ? `resume ${selection.root}` : 'no resumable spec:building root' });

  if (halted()) add(notRun('prior-epic-in-review'));
  else if (resuming) add({ check: 'prior-epic-in-review', verdict: 'skipped', reading: 'resuming' });
  else if (isFailure(beads) || isFailure(prs)) {
    add({ check: 'prior-epic-in-review', verdict: 'fail', reading: (isFailure(beads) ? beads : prs as Failure).error });
  }
  else add(priorEpicGate(beads, new Set(prs.map(p => p.number))));

  if (halted()) add(notRun('queue'));
  else add(isFailure(prs) ? { check: 'queue', verdict: 'fail', reading: prs.error } : queueGate(prs, now));

  if (halted()) add(notRun('nothing-to-build'));
  else if (resuming) add({ check: 'nothing-to-build', verdict: 'skipped', reading: 'resuming' });
  else if (selection === null) add({ check: 'nothing-to-build', verdict: 'fail', reading: 'no bead reading' });
  else if (selection.root === null) {
    add({ check: 'nothing-to-build', verdict: 'fail', reading: 'no eligible spec:ready or spec:building root' });
  }
  else add({ check: 'nothing-to-build', verdict: 'pass', reading: `selected ${selection.root} (by ${selection.source})` });

  return { ok: !failed, gates, selection };
}

// =============================================================================
// State write
// =============================================================================

/** Flags of a build state write: one of this skill's three labels, clearing the other eight. */
export function buildStateWriteArgs(label: string): string[] {
  if (!(labelsOwnedBy('build-scheduled') as string[]).includes(label)) {
    throw new Error(`not a build-scheduled label: ${label}`);
  }
  return stateWriteArgs(label as StateLabel);
}

/** The `bd` argv of a state write on `rootId`, id validated first. */
export function stateWriteCommand(rootId: string, label: string): string[] {
  assertRootId(rootId);
  return ['update', rootId, ...buildStateWriteArgs(label)];
}

// =============================================================================
// Chain plan input
// =============================================================================

export interface PlanInput {
  beads: string[];
  edges: { blocker: string; blocked: string; dependencyType: string }[];
}

/** `stack.ts plan` input: every non-decision child and the blocks edges among them. */
export function chainPlanInput(children: BuildBead[]): PlanInput {
  const kept = children.filter(c => c.issue_type !== 'decision');
  const ids = new Set(kept.map(c => c.id));
  const edges = kept.flatMap(c => (c.dependencies ?? [])
    .map(d => ({ blocker: d.depends_on_id ?? d.id ?? '', type: d.type ?? d.dependency_type }))
    .filter(d => d.type === 'blocks' && ids.has(d.blocker))
    .map(d => ({ blocker: d.blocker, blocked: c.id, dependencyType: 'blocks' })));
  return { beads: kept.map(c => c.id), edges };
}

// =============================================================================
// CLI helpers
// =============================================================================

/** execFileSync with an argv array and no shell; a failure is a non-zero RunResult. */
export const execRunner: Runner = (cmd, args) => {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      // `bd list --all --json` with notes exceeds the 1 MiB default.
      maxBuffer: 256 * 1024 * 1024,
    });
    return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
  }
  catch (err) {
    const e = err as { status?: number | null; stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    return {
      stdout: String(e.stdout ?? '').trim(),
      stderr: String(e.stderr ?? '').trim() || (e.message ?? ''),
      exitCode: typeof e.status === 'number' && e.status !== 0 ? e.status : 1,
    };
  }
};

function readJson(runner: Runner, cmd: string, args: string[]): unknown {
  const label = `${cmd} ${args.slice(0, 2).join(' ')}`;
  const result = runner(cmd, args);
  if (result.exitCode !== 0) throw new Error(`${label} failed (${result.exitCode}): ${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  }
  catch {
    throw new Error(`${label}: output is not JSON`);
  }
}

function beadRows(value: unknown, label: string): BuildBead[] {
  if (!Array.isArray(value)) throw new Error(`${label}: expected a JSON array`);
  for (const row of value) {
    const b = row as Partial<BuildBead>;
    if (typeof b?.id !== 'string' || typeof b.status !== 'string') {
      throw new Error(`${label}: row missing id or status`);
    }
  }
  return value as BuildBead[];
}

export function readBeads(runner: Runner): BuildBead[] {
  // --limit 0 is mandatory on bd 1.2.2: `bd list --json` otherwise stops at 50 rows.
  return beadRows(readJson(runner, 'bd', ['list', '--all', '--limit', '0', '--json']), 'bd list');
}

export function readBead(runner: Runner, id: string): BuildBead {
  assertRootId(id);
  const rows = beadRows(readJson(runner, 'bd', ['show', id, '--json']), 'bd show');
  if (rows.length !== 1) throw new Error(`bd show ${id}: expected one row, got ${rows.length}`);
  return rows[0];
}

export function readChildren(runner: Runner, root: string): BuildBead[] {
  assertRootId(root);
  return beadRows(readJson(runner, 'bd', ['children', root, '--json']), 'bd children');
}

export function readOpenPrs(runner: Runner): PrRow[] {
  const value = readJson(runner, 'gh', [
    'pr', 'list', '--state', 'open', '--limit', String(GH_PR_LIMIT),
    '--json', 'number,isDraft,createdAt,reviewDecision,statusCheckRollup',
  ]);
  if (!Array.isArray(value)) throw new Error('gh pr list: expected a JSON array');
  for (const row of value) {
    const p = row as Record<string, unknown>;
    const missing = [
      Number.isSafeInteger(p.number) ? null : 'number',
      typeof p.isDraft === 'boolean' ? null : 'isDraft',
      typeof p.createdAt === 'string' && !Number.isNaN(Date.parse(p.createdAt)) ? null : 'createdAt',
      typeof p.reviewDecision === 'string' || p.reviewDecision === null ? null : 'reviewDecision',
      Array.isArray(p.statusCheckRollup) ? null : 'statusCheckRollup',
    ].filter(Boolean);
    if (missing.length) throw new Error(`gh pr list: row missing or malformed ${missing.join(', ')}`);
  }
  return value as PrRow[];
}

function attempt<T>(read: () => T): T | Failure {
  try {
    return read();
  }
  catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export interface LockStore {
  read(): string | null;
  /** Create the lock only if it is absent (O_EXCL); false when it exists. */
  create(content: string): boolean;
  overwrite(content: string): void;
  remove(): void;
}

export interface PreflightDeps {
  lock: LockStore;
  isAlive: (pid: number) => boolean;
  ownerPid: number;
  now: Date;
}

export interface PreflightResult {
  ok: boolean;
  checks: Reading[];
}

function reportPathCheck(runner: Runner): Reading {
  const r = runner('git', ['check-ignore', '-q', `${REPORT_DIR}/`]);
  return r.exitCode === 0
    ? { check: 'report-path', verdict: 'pass', reading: `${REPORT_DIR}/ is gitignored` }
    : { check: 'report-path', verdict: 'fail', reading: `${REPORT_DIR}/ is not gitignored: no report, no run` };
}

function cleanTreeCheck(runner: Runner): Reading {
  const r = runner('npx', ['--no-install', 'tsx', STACK_TS, 'safe-to-start']);
  if (r.exitCode === 0) return { check: 'clean-tree', verdict: 'pass', reading: 'clean tree at the trunk' };
  let reason = r.stderr || `exit ${r.exitCode}`;
  try {
    reason = (JSON.parse(r.stdout) as { reason?: string }).reason ?? reason;
  }
  catch { /* keep stderr */ }
  return { check: 'clean-tree', verdict: 'fail', reading: `stack.ts safe-to-start: ${reason}` };
}

/**
 * Take the lock: refused for an owner pid that is not running; a free lock
 * is created exclusively, so two racing takers cannot both win; a stale one
 * is overwritten and read back, and anything but our own record fails.
 */
function takeLock(deps: PreflightDeps): { reading: Reading; took: boolean } {
  const fail = (reading: string) => ({ reading: { check: 'lock', verdict: 'fail' as const, reading }, took: false });
  if (!deps.isAlive(deps.ownerPid)) return fail(`owner pid ${deps.ownerPid} is not running`);
  const current = deps.lock.read();
  const d = lockDecision(current, deps.isAlive, deps.ownerPid);
  if (d.verdict === 'held' || d.verdict === 'malformed') return fail(d.reading);
  const record = JSON.stringify({ pid: deps.ownerPid, started: deps.now.toISOString() });
  if (current === null) {
    if (!deps.lock.create(record)) return fail('lock appeared while taking it: another run started');
  }
  else if (d.verdict === 'replace') {
    deps.lock.overwrite(record);
    if (deps.lock.read() !== record) return fail('lock changed while replacing it: another run started');
  }
  return { reading: { check: 'lock', verdict: 'pass', reading: d.reading }, took: true };
}

/**
 * Fails closed, in order: the report path is gitignored, the lock is ours,
 * the tree is clean at the trunk. A real run stops at the first failure and
 * releases a lock it took. `deps` null is the dry run: every check is
 * evaluated and the lock is neither read nor written.
 */
export function runPreflight(runner: Runner, deps: PreflightDeps | null): PreflightResult {
  const checks: Reading[] = [];
  const dry = deps === null;
  const failed = (): boolean => checks.some(c => c.verdict === 'fail');
  const notRun = (check: string): Reading => ({ check, verdict: 'not-run', reading: 'an earlier check failed' });

  checks.push(reportPathCheck(runner));

  let took = false;
  if (dry) {
    checks.push({ check: 'lock', verdict: 'skipped', reading: 'not read in a dry run' });
  }
  else if (failed()) {
    checks.push(notRun('lock'));
  }
  else {
    const lock = takeLock(deps);
    took = lock.took;
    checks.push(lock.reading);
  }

  if (!dry && failed()) checks.push(notRun('clean-tree'));
  else checks.push(cleanTreeCheck(runner));

  if (!dry && failed() && took) deps.lock.remove();
  return { ok: !failed(), checks };
}

export function runGates(runner: Runner, now: Date, mode: Mode): GatesResult {
  return evaluateGates({ beads: attempt(() => readBeads(runner)), prs: attempt(() => readOpenPrs(runner)), now, mode });
}

/** Gate 3 alone, re-read before every new level. */
export function runQueueGate(runner: Runner, now: Date): Reading {
  const prs = attempt(() => readOpenPrs(runner));
  return isFailure(prs) ? { check: 'queue', verdict: 'fail', reading: prs.error } : queueGate(prs, now);
}

export interface DryRunResult {
  preflight: PreflightResult;
  gates: GatesResult['gates'];
  selection: Selection | null;
  chain_plan: unknown;
  /** The `bd` argv the run would write, or why it writes no label. */
  labels: string[] | string;
}

/**
 * Everything a real run would read before its first write, and nothing
 * written: preflight and gate readings with verdicts, the selection, the
 * chain plan from `stack.ts plan`, and the label write it would make.
 */
export function runDryRun(runner: Runner, now: Date): DryRunResult {
  const preflight = runPreflight(runner, null);
  const gates = runGates(runner, now, 'dry');
  const selection = gates.selection;
  let chainPlan: unknown = null;
  let labels: string[] | string = 'none: nothing selected';
  if (selection?.root) {
    const root = selection.root;
    chainPlan = attempt(() => {
      const input = chainPlanInput(readChildren(runner, root));
      return readJson(runner, 'npx', ['--no-install', 'tsx', STACK_TS, 'plan', JSON.stringify(input)]);
    });
    labels = selection.kind === 'resume'
      ? 'none: root already carries spec:building'
      : ['bd', ...stateWriteCommand(root, 'spec:building')];
  }
  return { preflight, gates: gates.gates, selection, chain_plan: chainPlan, labels };
}
