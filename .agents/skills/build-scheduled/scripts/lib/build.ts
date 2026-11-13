/**
 * Deterministic half of `/spawn-bead-workers --scheduled`: flag validation,
 * preflight, the four gates, root selection, the `## Build state` parser
 * and formatter, the kill switch, start/restart/resume, counted firings,
 * recorded-PR validation, the publication text check, the guarded write
 * and the dry run.
 *
 * Exports:
 *   Constants: QUEUE_GATE, GH_PR_LIMIT, MAX_FIRINGS, ROOT_ID, REPORT_DIR, LOCK_PATH, TRUNK,
 *     STALL_REPORT_MAX
 *   Pure: validateFlags, assertRootId, lockDecision, passingCi, queueGate,
 *     priorEpicGate, selectRoot, evaluateGates, scanNotes, parseBuildState,
 *     buildStateWriteArgs, stateWriteCommand, chainPlanInput,
 *     nextFiringCount, rootStillOurs, startDecision, resumePoint,
 *     formatBuildState, formatStallBlock, writeGuard, firingId, firingContext,
 *     applyFiring,
 *     recordedPrExpectations, validateRecordedPr, prTextCheck, securityHold,
 *     validatePublishTarget
 *   CLI helpers (injectable Runner): execRunner, readBeads, readOpenPrs,
 *     readBead, readChildren, runPreflight, releaseLock, runGates,
 *     runQueueGate, runDryRun, runStillOurs, runWrite, runValidatePrs,
 *     runBuildState, runPublishPr, runSubmitCheck
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
  /** The session that wrote the block (firingId), or null on a block without the line. */
  firing: string | null;
  /** Every recorded PR number, in chain order. */
  prs: number[];
}

export type BuildStateParse = { ok: true; state: BuildState | null } | { ok: false; stall: string };

const STATE_HEADING = /^## Build state(?: \([^)\n]*\))?$/;
const ANY_HEADING = /^#{1,6}[ \t]/;
const FENCE = /^(`{3,}|~{3,})/;

export interface NotesScan {
  lines: string[];
  /** Indexes of the column-0 headings outside fenced text. */
  headings: number[];
  /** The fence still open at the end of the notes, or null. */
  openFence: string | null;
}

/**
 * One pass over notes, tracking fences the way every reader does. Fence
 * state is global to the notes, so a write that appends to notes ending
 * inside an open fence would have its own fence read as the closer.
 */
export function scanNotes(notes: string): NotesScan {
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
  return { lines, headings, openFence: fence };
}

/** The body lines of every unfenced `## Build state` heading, oldest first. */
function stateBodies(notes: string): string[][] {
  const { lines, headings } = scanNotes(notes);
  return headings.filter(i => STATE_HEADING.test(lines[i])).map(start => {
    const end = headings.find(i => i > start) ?? lines.length;
    return lines.slice(start + 1, end).filter(l => l.trim() !== '');
  });
}

function validBranch(name: string): boolean {
  return name.length <= BRANCH_MAX && BRANCH.test(name);
}

/**
 * Strict parse of the last `## Build state` block, the shape
 * formatBuildState writes. Headings inside fenced text — a `## Build stall`
 * report — never count. A malformed last block is a stall reason; there is
 * no fallback to an earlier block. No block at all is `state: null`.
 */
export function parseBuildState(notes: string | undefined): BuildStateParse {
  const bodies = stateBodies(notes ?? '');
  if (!bodies.length) return { ok: true, state: null };
  return parseStateBody(bodies[bodies.length - 1]);
}

/** A firing's identity: the session's pid and its process start time. */
const FIRING_ID = /^pid [1-9][0-9]{0,9} started [A-Za-z0-9:]+(?: [A-Za-z0-9:]+){0,7}$/;

function parseStateBody(body: string[]): BuildStateParse {
  const bad = (what: string, line?: string): BuildStateParse => ({
    ok: false,
    stall: `malformed Build state block: ${what}${line === undefined ? '' : ` (line: ${JSON.stringify(line)})`}`,
  });

  // The firing line is optional: a block without it reads as an earlier firing's.
  const hasFiring = body[2]?.startsWith('firing: ') ?? false;
  const head = hasFiring ? 3 : 2;
  if (body.length < head + 2) return bad(`expected firings, restart, chain and stopped lines, got ${body.length} lines`);

  const firings = body[0].match(/^firings: (\d+)$/);
  if (!firings) return bad('first line must be "firings: <n>"', body[0]);
  const count = Number(firings[1]);
  if (count > MAX_FIRINGS) return bad(`firings out of range 0-${MAX_FIRINGS}`, body[0]);

  const restart = body[1].match(/^restart: (none|resume)$/);
  if (!restart) return bad('second line must be "restart: none | resume"', body[1]);

  const firing = hasFiring ? body[2].slice('firing: '.length) : null;
  if (firing !== null && !FIRING_ID.test(firing)) return bad('firing must be "pid <n> started <time>"', body[2]);

  const stopped = body[body.length - 1].match(/^stopped: (\S.*)$/);
  if (!stopped) return bad('last line must be "stopped: <reason | none>"', body[body.length - 1]);

  const chains: BuildChain[] = [];
  for (const line of body.slice(head, -1)) {
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

  const branches = chains.flatMap(c => [...c.levels.map(l => l.branch), ...(c.next === 'done' ? [] : [c.next])]);
  const twice = branches.find((b, i) => branches.indexOf(b) !== i);
  if (twice !== undefined) return bad(`branch ${twice} appears twice`);

  return {
    ok: true,
    state: {
      firings: count,
      restart: restart[1] as 'none' | 'resume',
      chains,
      stopped: stopped[1],
      firing,
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
  // writeGuard refuses every write to such notes; selecting the root would stop every firing on it.
  if (scanNotes(b.notes ?? '').openFence !== null) return 'notes end inside an open fence';
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
// Counted firings and the kill switch
// =============================================================================

/**
 * How a firing on the root ended. `building`: it started or resumed a level
 * and left the root spec:building. `ended`: it started or resumed a level
 * and set spec:built or spec:stalled itself. The other four never count.
 */
export type FiringKind = 'building' | 'ended' | 'gate-skipped' | 'dry-run' | 'decision-blocked' | 'kill-switch';

/**
 * The firing count the stop block records. Only a firing that started or
 * resumed a level counts; the MAX_FIRINGS-th counted firing that still
 * leaves the root spec:building stalls it. The count never passes the
 * parser's bound.
 */
export function nextFiringCount(prev: number, kind: FiringKind): { count: number; stall: boolean } {
  if (kind !== 'building' && kind !== 'ended') return { count: prev, stall: false };
  return { count: Math.min(prev + 1, MAX_FIRINGS), stall: kind === 'building' && prev + 1 >= MAX_FIRINGS };
}

export type Check = { ok: true } | { ok: false; reason: string };

function specLabels(labels: string[]): string[] {
  return labels.filter(l => l.startsWith('spec:'));
}

/**
 * The kill switch: the root is still this run's to write while it carries
 * spec:building as its only spec label and neither build:hold nor
 * needs-human.
 */
export function rootStillOurs(labels: string[]): Check {
  if (labels.includes(HOLD)) return { ok: false, reason: `${HOLD} is set` };
  if (labels.includes(NEEDS_HUMAN)) return { ok: false, reason: `${NEEDS_HUMAN} is set` };
  const spec = specLabels(labels);
  if (spec.length !== 1 || spec[0] !== 'spec:building') {
    return { ok: false, reason: `spec label is ${spec.join(', ') || 'absent'}, not spec:building` };
  }
  return { ok: true };
}

// =============================================================================
// Start, restart and resume
// =============================================================================

export type StartDecision =
  | { action: 'start'; firings: 0; restart: 'none' }
  | { action: 'continue'; firings: number; restart: 'none'; state: BuildState }
  | { action: 'restart'; firings: 0; restart: 'resume'; state: BuildState }
  | { action: 'stall'; reason: string };

/**
 * What a run does with the root it holds. spec:ready with no block starts;
 * spec:building continues from its last block, or restarts (firings reset,
 * submitted levels carried) when that block records `stopped: stalled`,
 * which means the maintainer moved it back from spec:stalled. Everything
 * else stalls: there is no start-over.
 */
export function startDecision(labels: string[], parsed: BuildStateParse): StartDecision {
  const spec = specLabels(labels);
  if (spec.length === 1 && spec[0] === 'spec:ready') {
    if (parsed.ok && parsed.state === null) return { action: 'start', firings: 0, restart: 'none' };
    return { action: 'stall', reason: 'spec:ready root already has a Build state block: a rebuild is reset by hand' };
  }
  if (spec.length !== 1 || spec[0] !== 'spec:building') {
    return { action: 'stall', reason: `root carries ${spec.join(', ') || 'no spec label'}, not spec:ready or spec:building` };
  }
  if (!parsed.ok) return { action: 'stall', reason: parsed.stall };
  if (parsed.state === null) return { action: 'stall', reason: 'spec:building root has no Build state block' };
  if (parsed.state.stopped === 'stalled') return { action: 'restart', firings: 0, restart: 'resume', state: parsed.state };
  return { action: 'continue', firings: parsed.state.firings, restart: 'none', state: parsed.state };
}

export interface ChainResume {
  index: number;
  submitted: number;
  /** The chain's top submitted level, restored with `gh stack checkout <pr>`. */
  top: BuildLevel | null;
  next: string;
  /** The leaf behind `next`, or null when the chain is done. */
  nextBead: string | null;
}

export type ResumePoint = { ok: true; chains: ChainResume[]; redo: string[] } | { ok: false; stall: string };

/**
 * Where each chain continues. Block chain k is the chain plan's chain k and
 * its submitted levels are that chain's first leaves. The redo set is every
 * leaf of an unfinished chain with no submitted level that is in progress
 * or closed — its work is never trusted — except an escalated
 * (needs-human) leaf, which stays with the maintainer.
 */
export function resumePoint(state: BuildState, planChains: string[][], children: BuildBead[]): ResumePoint {
  if (state.chains.length !== planChains.length) {
    return { ok: false, stall: `Build state records ${state.chains.length} chains, the chain plan has ${planChains.length}` };
  }
  const byId = new Map(children.map(c => [c.id, c]));
  const chains: ChainResume[] = [];
  const redo: string[] = [];
  for (const chain of state.chains) {
    const leaves = planChains[chain.index - 1];
    const submitted = chain.levels.length;
    if (submitted > leaves.length) {
      return { ok: false, stall: `chain ${chain.index} records ${submitted} submitted levels, its plan holds ${leaves.length}` };
    }
    const done = chain.next === 'done';
    const nextBead = done ? null : leaves[submitted] ?? null;
    if (!done && nextBead === null) {
      return { ok: false, stall: `chain ${chain.index} records next ${chain.next} past the end of its plan` };
    }
    chains.push({ index: chain.index, submitted, top: chain.levels[submitted - 1] ?? null, next: chain.next, nextBead });
    if (done) continue;
    for (const id of leaves.slice(submitted)) {
      const leaf = byId.get(id);
      if (leaf && leaf.status !== 'open' && !labelsOf(leaf).includes(NEEDS_HUMAN)) redo.push(id);
    }
  }
  return { ok: true, chains, redo };
}

// =============================================================================
// Block formatting and the write guard
// =============================================================================

const STOPPED = /^[\x20-\x7e]{1,160}$/;
/** The failing steps a Build stall block may name. */
const STALL_STEP = /^(preflight|gates|build-state|validate-prs|firing-limit|sweep|text-check|chain [1-9][0-9]? level [1-9][0-9]? (implement|audit|build-gate|submit))$/;

function stamp(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * The `## Build state` block for a state (the shape `build-state` prints;
 * extra fields are ignored), under a dated heading. Throws on anything the
 * parser would refuse, and returns the block with the state it parses back
 * to.
 */
export function formatBuildState(input: unknown, at: Date): { text: string; state: BuildState } {
  const s = input as { firings?: unknown; restart?: unknown; firing?: unknown; chains?: unknown; stopped?: unknown } | null;
  if (typeof s !== 'object' || s === null || Array.isArray(s)) throw new Error('Build state input must be an object');
  if (!Number.isSafeInteger(s.firings) || (s.firings as number) < 0 || (s.firings as number) > MAX_FIRINGS) {
    throw new Error(`firings must be an integer 0-${MAX_FIRINGS}`);
  }
  if (s.restart !== 'none' && s.restart !== 'resume') throw new Error('restart must be none or resume');
  if (s.firing != null && (typeof s.firing !== 'string' || !FIRING_ID.test(s.firing))) {
    throw new Error('firing must be "pid <n> started <time>"');
  }
  if (typeof s.stopped !== 'string' || !STOPPED.test(s.stopped)) {
    throw new Error('stopped must be one line of 1-160 printable characters');
  }
  if (!Array.isArray(s.chains) || s.chains.length === 0) throw new Error('chains must be a non-empty array');
  const chainLines = s.chains.map((raw, i) => {
    const c = raw as { levels?: unknown; next?: unknown };
    if (!Array.isArray(c?.levels)) throw new Error(`chain ${i + 1}: levels must be an array`);
    const levels = c.levels.map(l => {
      const level = l as { branch?: unknown; pr?: unknown };
      if (typeof level?.branch !== 'string' || !validBranch(level.branch)) throw new Error(`chain ${i + 1}: bad branch`);
      if (!Number.isSafeInteger(level.pr) || (level.pr as number) < 1 || (level.pr as number) > 9_999_999) {
        throw new Error(`chain ${i + 1}: pr must be an integer 1-9999999`);
      }
      return `${level.branch} → #${level.pr}`;
    });
    if (typeof c.next !== 'string' || (c.next !== 'done' && !validBranch(c.next))) {
      throw new Error(`chain ${i + 1}: next must be done or a <type>.<kebab> branch`);
    }
    return `chain ${i + 1}: ${levels.length ? levels.join(', ') : '-'}; next: ${c.next}`;
  });
  const text = [
    `## Build state (${stamp(at)})`,
    `firings: ${s.firings}`,
    `restart: ${s.restart}`,
    ...(s.firing == null ? [] : [`firing: ${s.firing}`]),
    ...chainLines,
    `stopped: ${s.stopped}`,
  ].join('\n');
  const parsed = parseBuildState(text);
  if (!parsed.ok || parsed.state === null) throw new Error(parsed.ok ? 'formatted block did not parse' : parsed.stall);
  return { text, state: parsed.state };
}

/** Report text kept in a Build stall block; the rest is cut with a marker. */
export const STALL_REPORT_MAX = 8000;

const STALL_INDENT = '    ';
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;

/**
 * The `## Build stall` block. The step is a closed vocabulary (STALL_STEP),
 * so no failure text is ever typed on a command line. The report has
 * control characters stripped, is cut at STALL_REPORT_MAX, and every line
 * is indented inside a fence: no report line starts in column 0, so none
 * can open or close a fence or be read as a heading, whatever fence state
 * the notes before it are in.
 */
export function formatStallBlock(step: string, report: string): string {
  if (!STALL_STEP.test(step)) throw new Error(`stall step ${JSON.stringify(step)} is not one of the stall steps`);
  let text = report.replace(/\r\n?/g, '\n').replace(CONTROL, '');
  if (text.length > STALL_REPORT_MAX) text = `${text.slice(0, STALL_REPORT_MAX)}\n[truncated]`;
  const body = text.split('\n').map(line => `${STALL_INDENT}${line}`);
  return ['## Build stall', `step: ${step}`, '````text', ...body, '````'].join('\n');
}

const WRITABLE_STATUSES = new Set(['open', 'in_progress']);

/**
 * Whether a write may land on `root`, read just before it. `label` is the
 * state write, or null for a block append. `state` is the Build state block
 * being written (null only on a stall over an unreadable block), `hasStall`
 * whether a Build stall block rides with it. Returns the refusal, or null.
 */
export function writeGuard(root: BuildBead, label: string | null, state: BuildState | null, hasStall: boolean): string | null {
  if (!WRITABLE_STATUSES.has(root.status)) return `root is ${root.status}`;
  const labels = labelsOf(root);
  const spec = specLabels(labels);
  const fromReady = spec.length === 1 && spec[0] === 'spec:ready';

  if (label === 'spec:building' || (label === 'spec:stalled' && fromReady)) {
    if (labels.includes(HOLD)) return `${HOLD} is set`;
    if (labels.includes(NEEDS_HUMAN)) return `${NEEDS_HUMAN} is set`;
    if (!fromReady) return `spec:building is written over spec:ready only; root carries ${spec.join(', ') || 'no spec label'}`;
  }
  else {
    const ours = rootStillOurs(labels);
    if (!ours.ok) return ours.reason;
  }

  const fence = scanNotes(root.notes ?? '').openFence;
  if (fence !== null) return `the root's notes end inside an open ${fence} fence`;
  if (label === 'spec:building') {
    const existing = parseBuildState(root.notes);
    if (!existing.ok || existing.state !== null) return 'spec:ready root already has a Build state block: stall it, never start over';
  }

  const stalling = label === 'spec:stalled';
  if (stalling !== hasStall) return 'a Build stall block goes with spec:stalled, and only with it';
  if (state === null) return stalling ? null : 'every write but a stall carries a Build state block';
  if (label === 'spec:building' && (state.firings !== 0 || state.restart !== 'none' || state.prs.length || state.stopped !== 'none')) {
    return 'the first Build state block records firings 0, restart none, no submitted level, stopped none';
  }
  if (label === 'spec:built' && state.chains.some(c => c.next !== 'done')) return 'spec:built needs every chain at next: done';
  if (stalling !== (state.stopped === 'stalled')) return 'stopped: stalled goes with spec:stalled, and only with it';
  return label === 'spec:building' ? null : continuityGuard(root.notes, state);
}

/**
 * A block continues the last one. `restart: resume` (and with it a reset
 * firing count) only follows a block that reads `stopped: stalled`;
 * otherwise `firings` never goes down. A malformed last block is stalled
 * with no Build state block, never written over.
 */
function continuityGuard(notes: string | undefined, state: BuildState): string | null {
  const last = parseBuildState(notes);
  if (!last.ok) return `${last.stall}: stall with no Build state block`;
  const restarting = last.state?.stopped === 'stalled';
  if (state.restart === 'resume' && !restarting) return 'restart: resume only follows a block that reads stopped: stalled';
  if (restarting && state.restart !== 'resume') return 'the first block after stopped: stalled carries restart: resume';
  if (!restarting && last.state && state.firings < last.state.firings) {
    return `firings ${state.firings} is below the last block's ${last.state.firings}`;
  }
  return null;
}

const FIRING_KINDS: FiringKind[] = ['building', 'ended', 'gate-skipped', 'dry-run', 'decision-blocked', 'kill-switch'];

/**
 * The session a firing runs in: the agent session's pid (`--owner-pid
 * $PPID`, as preflight takes it) and that process's start time from
 * `ps -o lstart=`, so a pid reused by a later session is a new firing.
 */
export function firingId(pid: number, lstart: string): string {
  const id = `pid ${pid} started ${lstart.trim().replace(/\s+/g, ' ')}`;
  if (!FIRING_ID.test(id)) throw new Error(`owner pid ${pid}: unreadable process start time ${JSON.stringify(lstart)}`);
  return id;
}

/** What a write in firing `firing` derives from the root's notes. */
export interface FiringContext {
  firing: string;
  /** The count the firing started from: the last block an earlier firing wrote, or 0 after a stall. */
  start: number;
  /** `resume` only on the first block after one that reads `stopped: stalled`. */
  restart: 'none' | 'resume';
  /** A block this firing already wrote recorded it as counted. */
  counted: boolean;
}

/**
 * Derive the firing's starting count and restart from the notes, so the
 * agent never counts. Blocks are walked back from the last while they carry
 * this firing's line; the first one that does not (or none) is where the
 * firing started. Every block one firing writes therefore carries the same
 * count, however often `build-state` is re-read between them.
 */
export function firingContext(notes: string | undefined, firing: string): { ok: true } & FiringContext | { ok: false; stall: string } {
  const bodies = stateBodies(notes ?? '');
  const own: number[] = [];
  let start = 0;
  let restart: 'none' | 'resume' = 'none';
  for (let i = bodies.length - 1; i >= 0; i--) {
    const parsed = parseStateBody(bodies[i]);
    if (!parsed.ok) return parsed;
    const state = parsed.state as BuildState;
    if (i === bodies.length - 1 && state.stopped === 'stalled') restart = 'resume';
    if (state.firing !== firing) {
      start = state.stopped === 'stalled' ? 0 : state.firings;
      break;
    }
    own.push(state.firings);
  }
  return { ok: true, firing, start, restart, counted: own.some(n => n > start) };
}

/**
 * The state a write records. Only `chains` and `stopped` come from the
 * input (build-state's `state`, edited); `firings`, `restart` and the
 * firing line are derived from the notes (firingContext), whatever the
 * input carries. The first `spec:building` block takes no firing kind;
 * every other block needs one; `spec:built` is an `ended` firing. Once a
 * block counted the firing, it stays counted. A stop that would leave the
 * root spec:building on its MAX_FIRINGS-th counted firing is refused:
 * write spec:stalled instead.
 */
export function applyFiring(input: unknown, label: string | null, firing: string | null, ctx: FiringContext | null): unknown {
  if (input === null) {
    if (firing !== null) throw new Error('--firing does not go with a stall with no Build state block');
    return null;
  }
  if (ctx === null) throw new Error('a Build state block needs the firing it is written in');
  const s = input as { chains?: unknown; stopped?: unknown };
  const own = { chains: s?.chains, stopped: s?.stopped, firing: ctx.firing };
  if (label === 'spec:building') {
    if (firing !== null) throw new Error('--firing does not go with spec:building');
    return { firings: 0, restart: 'none', ...own };
  }
  if (firing === null) throw new Error(`--firing is required: one of ${FIRING_KINDS.join(', ')}`);
  if (!(FIRING_KINDS as string[]).includes(firing)) throw new Error(`unknown firing ${firing}: one of ${FIRING_KINDS.join(', ')}`);
  if (label === 'spec:built' && firing !== 'ended') throw new Error('spec:built is written by an ended firing');
  const kind = ctx.counted && firing !== 'ended' ? 'building' : firing as FiringKind;
  const next = nextFiringCount(ctx.start, kind);
  if (next.stall && label === null && s.stopped !== 'none') {
    throw new Error(`counted firing ${next.count} still leaves the root spec:building: write spec:stalled with --stall-step firing-limit`);
  }
  return { firings: next.count, restart: ctx.restart, ...own };
}

// =============================================================================
// Recorded-PR validation
// =============================================================================

export const TRUNK = 'main';

export interface PrExpectation {
  pr: number;
  branch: string;
  /** The level below in the same chain, or null for a chain's first level. */
  predecessor: string | null;
  /** Below the chain's top submitted level: the maintainer may have merged it. */
  lowerLevel: boolean;
}

/** What every PR the block records must look like on GitHub. */
export function recordedPrExpectations(state: BuildState): PrExpectation[] {
  return state.chains.flatMap(c => c.levels.map((level, i) => ({
    pr: level.pr,
    branch: level.branch,
    predecessor: i === 0 ? null : c.levels[i - 1].branch,
    lowerLevel: i < c.levels.length - 1,
  })));
}

/**
 * A recorded PR before any checkout, push or edit of it, over `gh pr view
 * --json number,state,author,isCrossRepository,headRefName,baseRefName,
 * autoMergeRequest`: open, or merged for a lower level (then `stack.ts sync`
 * runs first); auto-merge not set;
 * authored by the authenticated gh login; not from a fork; head on the
 * recorded branch; base on the trunk or the recorded predecessor.
 */
export function validateRecordedPr(
  pr: unknown,
  expected: PrExpectation,
  ghLogin: string,
): { ok: true; merged: boolean } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason: `#${expected.pr}: ${reason}` });
  if (typeof pr !== 'object' || pr === null || Array.isArray(pr)) return no('gh pr view reading is not an object');
  const p = pr as Record<string, unknown>;
  const author = (p.author as { login?: unknown } | null)?.login;
  const missing = [
    Number.isSafeInteger(p.number) ? null : 'number',
    typeof p.state === 'string' ? null : 'state',
    typeof author === 'string' && author !== '' ? null : 'author',
    typeof p.isCrossRepository === 'boolean' ? null : 'isCrossRepository',
    typeof p.headRefName === 'string' ? null : 'headRefName',
    typeof p.baseRefName === 'string' ? null : 'baseRefName',
    'autoMergeRequest' in p ? null : 'autoMergeRequest',
  ].filter(Boolean);
  if (missing.length) return no(`gh pr view missing or malformed ${missing.join(', ')}`);
  if (p.number !== expected.pr) return no(`gh pr view returned #${p.number}`);
  if (p.autoMergeRequest !== null) return no('auto-merge is set: the maintainer merges by hand');
  if (ghLogin === '') return no('no authenticated gh login to compare the author with');
  const merged = p.state === 'MERGED';
  if (!(p.state === 'OPEN' || (merged && expected.lowerLevel))) {
    return no(`state ${p.state}${merged ? ' on the chain\'s top submitted level' : ''}`);
  }
  if ((author as string).toLowerCase() !== ghLogin.toLowerCase()) return no(`author ${author} is not ${ghLogin}`);
  if (p.isCrossRepository) return no('opened from a fork');
  if (p.headRefName !== expected.branch) return no(`head ${p.headRefName} is not ${expected.branch}`);
  const bases = expected.predecessor ? [TRUNK, expected.predecessor] : [TRUNK];
  if (!bases.includes(p.baseRefName as string)) return no(`base ${p.baseRefName} is not ${bases.join(' or ')}`);
  return { ok: true, merged };
}

// =============================================================================
// Publication text check
// =============================================================================

export type TextRule = 'bead-id' | 'home-path' | 'session-trailer' | 'office-label' | 'email' | 'token';

export interface TextMatch {
  rule: TextRule;
  /** 1-based line of the candidate text. */
  line: number;
  /** The matched text; a token is cut to its first four characters. */
  match: string;
}

/**
 * What no PR title or body, branch name or commit message the run publishes
 * may carry. The source is git-workflow's rule that local-only references
 * stay out of GitHub artifacts (SKILL.md "Foundational principle",
 * branches.md, commits.md and pull-requests.md "Disallowed" / "Never
 * include"); this list widens it to internal process text. Generic shapes
 * only: naming any private organisation's vocabulary here would publish it.
 */
const TEXT_RULES: { rule: TextRule; pattern: RegExp }[] = [
  // Not after a letter, so `npv-1234` passes; `_` or a digit before still matches.
  { rule: 'bead-id', pattern: /(?<![a-z])pv-[a-z0-9]+(?:\.[0-9]+)*/gi },
  {
    rule: 'home-path',
    pattern: new RegExp([
      String.raw`(?<![\w.])(?:\/(?:users|home)\/[^\s/]+`,
      String.raw`\/root(?=[/\s]|$)`,
      String.raw`[a-z]:[\\/]users[\\/][^\s\\/]+`,
      String.raw`~[\w.-]*\/\S*`,
      String.raw`\/volumes\/[^\s/]+`,
      String.raw`\/private\/(?:tmp|var)\/\S*`,
      String.raw`\/var\/folders\/\S*`,
      String.raw`\/tmp\/claude-\d+\/\S*)`,
    ].join('|'), 'gi'),
  },
  // A home directory encoded into a path segment, as agent tooling names its project folders.
  { rule: 'home-path', pattern: /(?<![\w-])-(?:Users|home)-[A-Za-z0-9._]+-/g },
  {
    rule: 'session-trailer',
    pattern: new RegExp([
      String.raw`^[ \t]*(?:[-*>][ \t]+)*(?:[A-Za-z][\w-]*-Session:`,
      String.raw`Co-authored-by:[^\n]*\b(?:claude|anthropic)\b[^\n]*`,
      String.raw`Generated-by:[^\n]*)`,
      String.raw`Generated with \[?Claude`,
      String.raw`claude\.ai\/code\/session\S*`,
    ].join('|'), 'gim'),
  },
  { rule: 'office-label', pattern: /\boffice:[a-z][\w-]*/gi },
  // GitHub's noreply addresses are how a commit names its author publicly.
  { rule: 'email', pattern: /[\w.+-]+@(?!users\.noreply\.github\.com\b)[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/g },
  {
    rule: 'token',
    pattern: new RegExp([
      String.raw`\bgh[pousr]_[A-Za-z0-9]{20,}`,
      String.raw`\bgithub_pat_\w{20,}`,
      String.raw`\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}`,
      String.raw`\bwhsec_[A-Za-z0-9]{10,}`,
      String.raw`\bsk-(?:ant-)?[\w-]{20,}`,
      String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`,
      String.raw`\bnpm_[A-Za-z0-9]{36}\b`,
      String.raw`\bAIza[\w-]{35}`,
      String.raw`\bxox[abposr]-[A-Za-z0-9-]{10,}`,
      String.raw`hooks\.slack\.com\/services\/\S+`,
      String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----`,
      String.raw`\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}`,
      // Longer than a commit SHA's 40 hex digits.
      String.raw`(?<![0-9A-Fa-f])[0-9A-Fa-f]{41,}(?![0-9A-Fa-f])`,
      // A long run mixing upper case, lower case and digits, unless it is a
      // file name. Commit SHAs (lower-case hex) and kebab-case names never
      // mix all three.
      String.raw`(?<![\w+=-])(?=[\w+=-]*[A-Z])(?=[\w+=-]*[a-z])(?=[\w+=-]*[0-9])(?![\w+=-]*\.[A-Za-z]{1,5}\b)[\w+=-]{32,}`,
    ].join('|'), 'g'),
  },
];

/** Every rejected pattern in a candidate title, body, branch name or commit message. */
export function prTextCheck(text: string): TextMatch[] {
  const matches: TextMatch[] = [];
  text.split('\n').forEach((line, i) => {
    for (const { rule, pattern } of TEXT_RULES) {
      for (const m of line.matchAll(pattern)) {
        const found = m[0].trim();
        matches.push({ rule, line: i + 1, match: rule === 'token' ? `${found.slice(0, 4)}…` : found });
      }
    }
  });
  return matches;
}

function describeMatches(matches: TextMatch[]): string {
  return matches.map(m => `${m.rule} ${JSON.stringify(m.match)} (line ${m.line})`).join('; ');
}

// =============================================================================
// Chain plan input
// =============================================================================

export interface PlanInput {
  beads: string[];
  edges: { blocker: string; blocked: string; dependencyType: string }[];
}

/** Id order with numeric segments compared as numbers: pv-r.2 before pv-r.10. */
function compareIds(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

/**
 * `stack.ts plan` input: every non-decision child and the blocks edges among
 * them. Children are ordered by id, because the plan emits chains in input
 * order and resume maps a Build state block's chain k to the plan's chain k.
 */
export function chainPlanInput(children: BuildBead[]): PlanInput {
  const kept = children.filter(c => c.issue_type !== 'decision').sort((a, b) => compareIds(a.id, b.id));
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

/**
 * Release the lock at every run end and every failed-gate exit. Only a
 * lock holding `ownerPid` is removed; a lock held by another run, or one
 * that cannot be read, is left for its owner (or the stale-lock rule).
 */
export function releaseLock(lock: LockStore, ownerPid: number): Reading {
  const check = 'lock-release';
  const current = lock.read();
  if (current === null) return { check, verdict: 'pass', reading: 'no lock' };
  const d = lockDecision(current, () => true, ownerPid);
  if (d.verdict !== 'take') return { check, verdict: 'fail', reading: `not released: ${d.reading}` };
  lock.remove();
  return { check, verdict: 'pass', reading: `released (pid ${ownerPid})` };
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

/** The kill switch over a fresh read of the root: closed, held or relabelled stops the run. */
export function runStillOurs(runner: Runner, root: string): Check {
  const bead = attempt(() => readBead(runner, root));
  if (isFailure(bead)) return { ok: false, reason: bead.error };
  if (!WRITABLE_STATUSES.has(bead.status)) return { ok: false, reason: `root is ${bead.status}` };
  return rootStillOurs(labelsOf(bead));
}

export interface WriteInput {
  root: string;
  /** spec:building, spec:built or spec:stalled; null appends a block with no label change. */
  label: string | null;
  /** A Build state (formatBuildState's input), or null on a stall over an unreadable block. */
  state: unknown;
  stall: { step: string; report: string } | null;
  /** How this firing ran (applyFiring); null only on the first spec:building block or a block-less stall. */
  firing: string | null;
  /** The agent session's pid ($PPID), which with its start time names the firing. */
  ownerPid: number;
  now: Date;
}

/**
 * The one write path for the root: name the firing, re-read the root,
 * derive `firings` and `restart` from its notes, format the blocks, apply
 * the write guard (the kill switch included), then one `bd update` with
 * the state-write flags and `--append-notes`, through argv only. Any
 * refusal writes nothing.
 */
export function runWrite(runner: Runner, input: WriteInput): { ok: boolean; reading: string } {
  const refuse = (reading: string) => ({ ok: false, reading });
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
  let flags: string[];
  let stall: string | null;
  try {
    assertRootId(input.root);
    flags = input.label === null ? [] : buildStateWriteArgs(input.label);
    stall = input.stall === null ? null : formatStallBlock(input.stall.step, input.stall.report);
  }
  catch (err) {
    return refuse(message(err));
  }

  let firing: string | null = null;
  if (input.state !== null) {
    if (!Number.isSafeInteger(input.ownerPid) || input.ownerPid <= 0) return refuse(`bad owner pid ${input.ownerPid}`);
    const ps = runner('ps', ['-o', 'lstart=', '-p', String(input.ownerPid)]);
    if (ps.exitCode !== 0 || ps.stdout === '') return refuse(`owner pid ${input.ownerPid} is not a running session`);
    try {
      firing = firingId(input.ownerPid, ps.stdout);
    }
    catch (err) {
      return refuse(message(err));
    }
  }

  const root = attempt(() => readBead(runner, input.root));
  if (isFailure(root)) return refuse(root.error);

  let state: { text: string; state: BuildState } | null;
  try {
    const ctx = firing === null ? null : firingContext(root.notes, firing);
    if (ctx !== null && !ctx.ok) return refuse(`${ctx.stall}: stall with no Build state block`);
    const counted = applyFiring(input.state, input.label, input.firing, ctx);
    state = counted === null ? null : formatBuildState(counted, input.now);
  }
  catch (err) {
    return refuse(message(err));
  }
  const guard = writeGuard(root, input.label, state?.state ?? null, stall !== null);
  if (guard !== null) return refuse(`write refused: ${guard}`);

  const notes = `\n${[state?.text, stall].filter(Boolean).join('\n\n')}`;
  const result = runner('bd', ['update', input.root, ...flags, '--append-notes', notes]);
  if (result.exitCode !== 0) return refuse(`bd update failed (${result.exitCode}): ${result.stderr}`);
  return { ok: true, reading: `wrote ${input.label ?? 'a Build state block'} on ${input.root}` };
}

const PR_VIEW_FIELDS = 'number,state,author,isCrossRepository,headRefName,baseRefName,autoMergeRequest';

export interface PrsValidation {
  ok: boolean;
  reading: string;
  /** A lower level merged: run `stack.ts sync` before any checkout. */
  sync_first: boolean;
  prs: ({ pr: number; ok: true; merged: boolean } | { pr: number; ok: false; reason: string })[];
  /** Each unfinished chain's `next` branch: on origin already means a cut between submit and the block write. */
  next: { branch: string; ok: boolean; reading: string }[];
}

/**
 * A `next` branch must not exist on origin yet: if it does, the level was
 * pushed (maybe with a PR) and the cut came before its block was written,
 * so redoing it would rewrite published work. `git ls-remote --exit-code`
 * exits 2 when the ref is absent; anything else but 0 fails closed.
 */
function nextBranchAbsent(runner: Runner, branch: string): { branch: string; ok: boolean; reading: string } {
  const r = runner('git', ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`]);
  if (r.exitCode === 2) return { branch, ok: true, reading: 'not on origin' };
  if (r.exitCode === 0) return { branch, ok: false, reading: `${branch} is already on origin: stall, do not redo` };
  return { branch, ok: false, reading: `git ls-remote failed (${r.exitCode}): ${r.stderr}` };
}

/**
 * The published title, body and head branch of a recorded PR, through
 * prTextCheck. A missing title or body fails closed.
 */
function publishedTextCheck(view: unknown, pr: number): { ok: true } | { ok: false; reason: string } {
  const p = view as { title?: unknown; body?: unknown; headRefName?: unknown };
  const missing = ['title', 'body'].filter(k => typeof p[k as 'title' | 'body'] !== 'string');
  if (missing.length) return { ok: false, reason: `#${pr}: gh pr view missing or malformed ${missing.join(', ')}` };
  const matches = [p.title, p.body, p.headRefName].flatMap(t => prTextCheck(String(t)));
  return matches.length ? { ok: false, reason: `#${pr}: published text: ${describeMatches(matches)}` } : { ok: true };
}

/**
 * Every PR the root's last block records, validated read-only against
 * GitHub, and every `next` branch checked absent from origin. With `text`
 * (the post-submit check before spec:built) each PR's published title,
 * body and head branch also go through prTextCheck.
 */
export function runValidatePrs(runner: Runner, root: string, opts: { text?: boolean } = {}): PrsValidation {
  const none = (reading: string): PrsValidation => ({ ok: false, reading, sync_first: false, prs: [], next: [] });
  const bead = attempt(() => readBead(runner, root));
  if (isFailure(bead)) return none(bead.error);
  const parsed = parseBuildState(bead.notes);
  if (!parsed.ok) return none(parsed.stall);
  if (parsed.state === null) return none(`${root} has no Build state block`);

  const login = runner('gh', ['api', 'user', '--jq', '.login']);
  if (login.exitCode !== 0 || login.stdout === '') return none(`cannot read the authenticated gh login: ${login.stderr}`);

  const fields = opts.text ? `${PR_VIEW_FIELDS},title,body` : PR_VIEW_FIELDS;
  const prs = recordedPrExpectations(parsed.state).map(expected => {
    const view = attempt(() => readJson(runner, 'gh', ['pr', 'view', String(expected.pr), '--json', fields]));
    if (isFailure(view)) return { pr: expected.pr, ok: false as const, reason: `#${expected.pr}: ${view.error}` };
    const result = validateRecordedPr(view, expected, login.stdout);
    const text = result.ok && opts.text ? publishedTextCheck(view, expected.pr) : null;
    return { pr: expected.pr, ...(text && !text.ok ? text : result) };
  });
  const next = parsed.state.chains.filter(c => c.next !== 'done').map(c => nextBranchAbsent(runner, c.next));
  const bad = prs.filter(p => !p.ok).length + next.filter(n => !n.ok).length;
  return {
    ok: bad === 0,
    reading: bad
      ? `${bad} check(s) failed: stall the root`
      : `${prs.length} recorded PR(s) valid${opts.text ? ' with clean published text' : ''}, ${next.length} next branch(es) not on origin`,
    sync_first: prs.some(p => p.ok && p.merged),
    prs,
    next,
  };
}

// =============================================================================
// Publishing a PR's title and body
// =============================================================================

/** Labels whose leaf is never published unattended: the maintainer decides how. */
export const SECURITY_LABELS = ['security', 'cve-watch'];

/** The deterministic security hold over a leaf's labels; the reason, or null. */
export function securityHold(labels: string[]): string | null {
  const hit = SECURITY_LABELS.find(l => labels.includes(l));
  return hit ? `leaf carries ${hit}: held for the maintainer` : null;
}

const PUBLISH_FIELDS = 'number,state,author,isCrossRepository,headRefName,baseRefName,autoMergeRequest';
const TITLE_MAX = 256;

/**
 * A PR the run is about to edit: the one asked for, open, authored by the
 * authenticated gh login, not from a fork, auto-merge not set, and with a
 * head and base that are safe to name in a git argv.
 */
export function validatePublishTarget(
  view: unknown,
  pr: number,
  ghLogin: string,
): { ok: true; head: string; base: string } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason: `#${pr}: ${reason}` });
  if (typeof view !== 'object' || view === null || Array.isArray(view)) return no('gh pr view reading is not an object');
  const p = view as Record<string, unknown>;
  const author = (p.author as { login?: unknown } | null)?.login;
  if (p.number !== pr) return no(`gh pr view returned ${JSON.stringify(p.number)}`);
  if (p.state !== 'OPEN') return no(`state ${JSON.stringify(p.state)}, not OPEN`);
  if (ghLogin === '' || typeof author !== 'string' || author.toLowerCase() !== ghLogin.toLowerCase()) {
    return no(`author ${JSON.stringify(author)} is not the authenticated gh login`);
  }
  if (p.isCrossRepository !== false) return no('not known to be from this repository');
  if (!('autoMergeRequest' in p) || p.autoMergeRequest !== null) return no('auto-merge is set or unreadable');
  if (typeof p.headRefName !== 'string' || !validBranch(p.headRefName)) return no(`head ${JSON.stringify(p.headRefName)} is not <type>.<kebab>`);
  const base = p.baseRefName;
  if (typeof base !== 'string' || (base !== TRUNK && !validBranch(base))) return no(`base ${JSON.stringify(base)} is not the trunk or <type>.<kebab>`);
  return { ok: true, head: p.headRefName, base };
}

export interface PublishInput {
  root: string;
  pr: number;
  /** The leaf the PR's level implements; its labels decide the security hold. */
  leaf: string;
  title: string;
  body: string;
  /** The absolute path `body` was read from, handed to `gh pr edit --body-file`. */
  bodyFile: string;
}

export interface PublishResult {
  ok: boolean;
  reading: string;
  /** A security hold: stall the level unsubmitted rather than retry. */
  hold: boolean;
  matches: (TextMatch & { source: string })[];
}

/**
 * The one way the run edits a PR: security hold, target validation, the
 * text check over the title, body, head branch and the published commits
 * (`origin/<base>..origin/<head>`, fetched first), the kill switch, then
 * `gh pr edit --title --body-file` through argv. Any refusal edits nothing.
 */
export function runPublishPr(runner: Runner, input: PublishInput): PublishResult {
  const refuse = (reading: string, extra: Partial<PublishResult> = {}): PublishResult => ({ ok: false, reading, hold: false, matches: [], ...extra });
  try {
    assertRootId(input.root);
    assertRootId(input.leaf);
  }
  catch (err) {
    return refuse((err as Error).message);
  }
  if (!Number.isSafeInteger(input.pr) || input.pr < 1 || input.pr > 9_999_999) return refuse(`bad PR number ${input.pr}`);
  const title = input.title.replace(/\r?\n$/, '');
  if (!title.trim() || title.includes('\n') || title.length > TITLE_MAX) return refuse(`title must be one line of 1-${TITLE_MAX} characters`);

  const leaf = attempt(() => readBead(runner, input.leaf));
  if (isFailure(leaf)) return refuse(leaf.error);
  const hold = securityHold(labelsOf(leaf));
  if (hold) return refuse(hold, { hold: true });

  const login = runner('gh', ['api', 'user', '--jq', '.login']);
  if (login.exitCode !== 0 || login.stdout === '') return refuse(`cannot read the authenticated gh login: ${login.stderr}`);
  const view = attempt(() => readJson(runner, 'gh', ['pr', 'view', String(input.pr), '--json', PUBLISH_FIELDS]));
  if (isFailure(view)) return refuse(view.error);
  const target = validatePublishTarget(view, input.pr, login.stdout);
  if (!target.ok) return refuse(target.reason);

  const fetch = runner('git', ['fetch', '--quiet', 'origin', target.base, target.head]);
  if (fetch.exitCode !== 0) return refuse(`git fetch failed (${fetch.exitCode}): ${fetch.stderr}`);
  const log = runner('git', ['log', '--format=%B', `origin/${target.base}..origin/${target.head}`]);
  if (log.exitCode !== 0) return refuse(`git log failed (${log.exitCode}): ${log.stderr}`);

  const sources: [string, string][] = [['title', title], ['body', input.body], ['branch', target.head], ['commits', log.stdout]];
  const matches = sources.flatMap(([source, text]) => prTextCheck(text).map(m => ({ source, ...m })));
  if (matches.length) return refuse(`text check rejected: ${matches.map(m => `${m.source} ${describeMatches([m])}`).join('; ')}`, { matches });

  const ours = runStillOurs(runner, input.root);
  if (!ours.ok) return refuse(`kill switch: ${ours.reason}`);

  const edit = runner('gh', ['pr', 'edit', String(input.pr), '--title', title, '--body-file', input.bodyFile]);
  if (edit.exitCode !== 0) return refuse(`gh pr edit failed (${edit.exitCode}): ${edit.stderr}`);
  return { ok: true, reading: `published title and body on #${input.pr}`, hold: false, matches: [] };
}

/**
 * Before `stack.ts submit`: the security hold, then the text check over the
 * checked-out level's branch name and its commits since `base` (the trunk
 * as freshly fetched `origin/main`), then the
 * kill switch. Exit 1 means submit nothing; `hold` means stall the level
 * unsubmitted for the maintainer.
 */
export function runSubmitCheck(runner: Runner, input: { root: string; leaf: string; base: string }): PublishResult {
  const refuse = (reading: string, extra: Partial<PublishResult> = {}): PublishResult => ({ ok: false, reading, hold: false, matches: [], ...extra });
  try {
    assertRootId(input.root);
    assertRootId(input.leaf);
  }
  catch (err) {
    return refuse((err as Error).message);
  }
  if (input.base !== TRUNK && !validBranch(input.base)) return refuse(`base ${JSON.stringify(input.base)} is not the trunk or <type>.<kebab>`);

  const leaf = attempt(() => readBead(runner, input.leaf));
  if (isFailure(leaf)) return refuse(leaf.error);
  const hold = securityHold(labelsOf(leaf));
  if (hold) return refuse(hold, { hold: true });

  const head = runner('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (head.exitCode !== 0) return refuse(`git rev-parse failed (${head.exitCode}): ${head.stderr}`);
  if (!validBranch(head.stdout)) return refuse(`checked-out branch ${JSON.stringify(head.stdout)} is not <type>.<kebab>`);
  // Local main can be stale and would pull merged history into the range.
  let base = input.base;
  if (base === TRUNK) {
    const fetch = runner('git', ['fetch', '--quiet', 'origin', TRUNK]);
    if (fetch.exitCode !== 0) return refuse(`git fetch failed (${fetch.exitCode}): ${fetch.stderr}`);
    base = `origin/${TRUNK}`;
  }
  const log = runner('git', ['log', '--format=%B', `${base}..HEAD`]);
  if (log.exitCode !== 0) return refuse(`git log failed (${log.exitCode}): ${log.stderr}`);

  const sources: [string, string][] = [['branch', head.stdout], ['commits', log.stdout]];
  const matches = sources.flatMap(([source, text]) => prTextCheck(text).map(m => ({ source, ...m })));
  if (matches.length) return refuse(`text check rejected: ${matches.map(m => `${m.source} ${describeMatches([m])}`).join('; ')}`, { matches });

  const ours = runStillOurs(runner, input.root);
  if (!ours.ok) return refuse(`kill switch: ${ours.reason}`);
  return { ok: true, reading: `${head.stdout} may be submitted`, hold: false, matches: [] };
}

export interface BuildStateResult {
  ok: boolean;
  parse: BuildStateParse;
  start: StartDecision;
  /** Null unless the run continues or restarts a build. */
  resume: ResumePoint | Failure | null;
}

/**
 * `build-state <root>`: the last block, what the run does with the root,
 * and — when it continues or restarts — where each chain resumes, from the
 * chain plan over the root's children. Not ok means stall the root.
 */
export function runBuildState(runner: Runner, root: string): BuildStateResult {
  const bead = readBead(runner, root);
  const parse = parseBuildState(bead.notes);
  const start = startDecision(labelsOf(bead), parse);
  if (start.action === 'stall' || start.action === 'start') {
    return { ok: start.action === 'start', parse, start, resume: null };
  }
  const resume = attempt(() => {
    const children = readChildren(runner, root);
    const plan = readJson(runner, 'npx', ['--no-install', 'tsx', STACK_TS, 'plan', JSON.stringify(chainPlanInput(children))]);
    const chains = (plan as { chains?: unknown } | null)?.chains;
    if (!Array.isArray(chains) || !chains.every(c => Array.isArray(c) && c.every(id => typeof id === 'string'))) {
      throw new Error('stack.ts plan: no chains array');
    }
    return resumePoint(start.state, chains as string[][], children);
  });
  return { ok: !isFailure(resume) && resume.ok, parse, start, resume };
}
