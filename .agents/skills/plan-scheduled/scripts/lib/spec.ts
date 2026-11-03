/**
 * Deterministic parsing for `/plan --scheduled`: pass selections, the notes
 * heading test, note-block extraction and the state-label write.
 *
 * Exports:
 *   Pure helpers: hasHeading, lastBlock, stateWriteArgs, selectDrafting,
 *     selectApproved, selectRevise, unanalysedLeaves, reviseNote,
 *     revisionNumber, gateMisses, inspect
 *   CLI helpers: bdSelect, bdInspect, bdLeaves, bdNotes
 *
 * Operator-facing flow: .agents/skills/plan-scheduled/SKILL.md
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { run, type SpawnDeps } from './run.js';

/** The subset of a `bd ... --json` row this skill reads. */
export interface Bead {
  id: string;
  title: string;
  status: string;
  priority: number;
  issue_type?: string;
  created_at: string;
  labels?: string[];
  parent?: string | null;
  notes?: string;
  description?: string;
  design?: string;
  acceptance_criteria?: string;
}

export interface Row {
  id: string;
  priority: number;
  created_at: string;
  needs_human: boolean;
  title: string;
}

export interface ApprovedRow extends Row {
  /** The root's `spec:*` and `needs-human` labels, for the report. */
  labels: string[];
  /** Also carries `spec:revise`: the revise pass takes it instead. */
  also_revise: boolean;
}

export const STATE_LABELS = [
  'spec:drafted',
  'spec:blocked',
  'spec:revise',
  'spec:approved',
  'spec:decomposing',
  'spec:ready',
] as const;

export type StateLabel = (typeof STATE_LABELS)[number];

const NEEDS_HUMAN = 'needs-human';

// =============================================================================
// Heading test and blocks
// =============================================================================

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The heading test: `name` appears as a markdown heading of any level, any
 * case, at the start of the notes or after a newline. `\b` closes the name,
 * so prose such as "advisory review passed" never matches.
 */
export function hasHeading(notes: string | undefined, name: string): boolean {
  return headingRegex(name).test(notes ?? '');
}

function headingRegex(namePattern: string, flags = 'i'): RegExp {
  // `\b` closes a name ending in a word character; a name ending in `)` is
  // already closed, and `\b` before a newline would never match there.
  const close = namePattern.endsWith('\\)') ? '' : '\\b';
  return new RegExp(`(?:^|\\n)#{1,6}[ \\t]*${namePattern}${close}`, flags);
}

const ANY_HEADING = /^#{1,6}[ \t]*/;

/**
 * The body of the last block whose heading is `name` (any suffix allowed),
 * cut at the next heading, or null when there is no such heading.
 */
export function lastBlock(notes: string | undefined, name: string): string | null {
  const parts = (notes ?? '').split(headingRegex(escape(name)));
  if (parts.length < 2) return null;
  const lines = parts[parts.length - 1].split('\n').slice(1);
  const next = lines.findIndex(l => ANY_HEADING.test(l));
  return trimBlank(next === -1 ? lines : lines.slice(0, next)).join('\n');
}

/** The last markdown heading line in the notes, trimmed, or null. */
export function lastHeading(notes: string | undefined): string | null {
  const headings = (notes ?? '').split('\n').filter(l => ANY_HEADING.test(l));
  return headings.length ? headings[headings.length - 1].trim() : null;
}

function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && /^[ \t]*$/.test(lines[start])) start++;
  while (end > start && /^[ \t]*$/.test(lines[end - 1])) end--;
  return lines.slice(start, end);
}

// =============================================================================
// State write
// =============================================================================

/**
 * The `bd update` flags of a state write: remove every other state label,
 * add the target. bd accepts removing an absent label.
 */
export function stateWriteArgs(target: StateLabel): string[] {
  if (!STATE_LABELS.includes(target)) {
    throw new Error(`not a state label: ${target}`);
  }
  const args: string[] = [];
  for (const label of STATE_LABELS) {
    if (label !== target) args.push('--remove-label', label);
  }
  args.push('--add-label', target);
  return args;
}

// =============================================================================
// Selections
// =============================================================================

function labelsOf(b: Bead): string[] {
  return b.labels ?? [];
}

function byPriorityThenOldest(a: Bead, b: Bead): number {
  return a.priority - b.priority || a.created_at.localeCompare(b.created_at);
}

function toRow(b: Bead): Row {
  return {
    id: b.id,
    priority: b.priority,
    created_at: b.created_at,
    needs_human: labelsOf(b).includes(NEEDS_HUMAN),
    title: b.title,
  };
}

function openRoots(beads: Bead[]): Bead[] {
  return beads.filter(b => b.parent == null && b.status === 'open');
}

/**
 * Drafting-pass candidates: open `office:*` roots carrying no `spec:*` label
 * and no Advisory Review heading, none of whose children has started or
 * closed. Rows flagged `needs_human` are reported, never taken.
 */
export function selectDrafting(beads: Bead[]): Row[] {
  const started = new Set(
    beads
      .filter(b => b.parent != null && (b.status === 'in_progress' || b.status === 'closed'))
      .map(b => b.parent as string),
  );
  return openRoots(beads)
    .filter(b => labelsOf(b).some(l => l.startsWith('office:')))
    .filter(b => !labelsOf(b).some(l => l.startsWith('spec:')))
    .filter(b => !hasHeading(b.notes, 'Advisory Review'))
    .filter(b => !started.has(b.id))
    .sort(byPriorityThenOldest)
    .map(toRow);
}

/** Approved-pass roots: open roots carrying `spec:approved` or `spec:decomposing`. */
export function selectApproved(beads: Bead[]): ApprovedRow[] {
  return openRoots(beads)
    .filter(b => labelsOf(b).some(l => l === 'spec:approved' || l === 'spec:decomposing'))
    .sort(byPriorityThenOldest)
    .map(b => ({
      ...toRow(b),
      labels: labelsOf(b).filter(l => l.startsWith('spec:') || l === NEEDS_HUMAN),
      also_revise: labelsOf(b).includes('spec:revise'),
    }));
}

/** Revise-pass roots: open roots carrying `spec:revise`. */
export function selectRevise(beads: Bead[]): Row[] {
  return openRoots(beads)
    .filter(b => labelsOf(b).includes('spec:revise'))
    .sort(byPriorityThenOldest)
    .map(toRow);
}

// =============================================================================
// Leaves
// =============================================================================

/**
 * Leaves under `rootId` still to analyse: not closed, no children, not a
 * `decision`, no Implementation Context heading — at any depth, because an
 * adopted child may have children of its own.
 */
export function unanalysedLeaves(beads: Bead[], rootId: string): { id: string; title: string }[] {
  const parentOf = new Map(beads.map(b => [b.id, b.parent ?? null]));
  const parents = new Set(beads.map(b => b.parent).filter((p): p is string => p != null));
  const under = (id: string): boolean => {
    const seen = new Set<string>();
    let p = parentOf.get(id) ?? null;
    while (p != null && !seen.has(p)) {
      if (p === rootId) return true;
      seen.add(p);
      p = parentOf.get(p) ?? null;
    }
    return false;
  };
  return beads
    .filter(b => under(b.id))
    .filter(b => !parents.has(b.id))
    .filter(b => b.status !== 'closed')
    .filter(b => b.issue_type !== 'decision')
    .filter(b => !hasHeading(b.notes, 'Implementation Context'))
    .map(b => ({ id: b.id, title: b.title }));
}

// =============================================================================
// Revise note, revision number, gate misses
// =============================================================================

const DECISIONS = 'Decisions made for you';
const DATED_REVISION = /^#{1,6}[ \t]*[^\n]*\brevision \([0-9]{4}-[0-9]{2}-[0-9]{2}\)/i;
const ITEM_OR_FILLER = /^[ \t]*$|^[ \t]+|^- \*\*|^(- )?none[ \t]*$/;

/**
 * The maintainer's revise note: the body of the last dated `revision (<date>)`
 * heading after the last Decisions block, or else the plain text that follows
 * that block's items. Either runs to the next heading. Empty when there is
 * no Decisions block or nothing follows it.
 */
export function reviseNote(notes: string | undefined): string {
  const parts = (notes ?? '').split(headingRegex(DECISIONS));
  if (parts.length < 2) return '';
  let lines = parts[parts.length - 1].split('\n').slice(1);

  let dated = -1;
  lines.forEach((l, i) => {
    if (DATED_REVISION.test(l)) dated = i;
  });

  if (dated >= 0) {
    lines = lines.slice(dated + 1);
    while (lines.length && /^[ \t]*$/.test(lines[0])) lines.shift();
  }
  else {
    while (lines.length && ITEM_OR_FILLER.test(lines[0])) lines.shift();
  }

  const next = lines.findIndex(l => ANY_HEADING.test(l));
  if (next !== -1) lines = lines.slice(0, next);
  return trimBlank(lines).join('\n');
}

/** 1 + the count of `Decisions made for you (revision K)` headings. */
export function revisionNumber(notes: string | undefined): number {
  const re = headingRegex(`${DECISIONS} \\(revision [0-9]+\\)`, 'gi');
  return ((notes ?? '').match(re) ?? []).length + 1;
}

/** Gate misses since the last `Decisions made for you (decomposition gate)` heading. */
export function gateMisses(notes: string | undefined): number {
  const parts = (notes ?? '').split(headingRegex(`${DECISIONS} \\(decomposition gate\\)`));
  const tail = parts[parts.length - 1];
  return (tail.match(/(?:^|\n)- gate not met [0-9]{4}-[0-9]{2}-[0-9]{2}:/g) ?? []).length;
}

// =============================================================================
// inspect
// =============================================================================

export interface Inspection {
  id: string;
  status: string;
  labels: string[];
  state_labels: string[];
  needs_human: boolean;
  fields: { description: boolean; design: boolean; acceptance: boolean };
  /** The last markdown heading line in the notes, or null. */
  last_heading: string | null;
  headings: {
    planned_hierarchy: boolean;
    implementation_context: boolean;
    bead_analysis: boolean;
    advisory_review: boolean;
    decisions: boolean;
  };
}

/** What the passes route on, from one `bd show --json` row. */
export function inspect(b: Bead): Inspection {
  const labels = labelsOf(b);
  const filled = (s: string | undefined): boolean => (s ?? '').trim().length > 0;
  return {
    id: b.id,
    status: b.status,
    labels,
    state_labels: labels.filter(l => (STATE_LABELS as readonly string[]).includes(l)),
    needs_human: labels.includes(NEEDS_HUMAN),
    fields: {
      description: filled(b.description),
      design: filled(b.design),
      acceptance: filled(b.acceptance_criteria),
    },
    last_heading: lastHeading(b.notes),
    headings: {
      planned_hierarchy: hasHeading(b.notes, 'Planned hierarchy'),
      implementation_context: hasHeading(b.notes, 'Implementation Context'),
      bead_analysis: hasHeading(b.notes, 'Bead Analysis'),
      advisory_review: hasHeading(b.notes, 'Advisory Review'),
      decisions: hasHeading(b.notes, DECISIONS),
    },
  };
}

// =============================================================================
// CLI helpers
// =============================================================================

export type Selection = 'drafting' | 'approved' | 'revise';

function bdList(deps: SpawnDeps): Bead[] {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  // --limit 0 is mandatory on bd 1.2.2: `bd list --json` otherwise stops at 50 rows.
  const result = run('bd', ['list', '--all', '--limit', '0', '--json'], spawn, { cwd: deps.cwd });
  if (result.exitCode !== 0) {
    throw new Error(`bd list failed (${result.exitCode}): ${result.stderr}`);
  }
  return JSON.parse(result.stdout || '[]') as Bead[];
}

function bdShow(beadId: string, deps: SpawnDeps): Bead {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const result = run('bd', ['show', beadId, '--json'], spawn, { cwd: deps.cwd });
  if (result.exitCode !== 0) {
    throw new Error(`bd show ${beadId} failed (${result.exitCode}): ${result.stderr}`);
  }
  const rows = JSON.parse(result.stdout || '[]') as Bead[];
  if (rows.length !== 1) throw new Error(`bd show ${beadId}: expected one row, got ${rows.length}`);
  return rows[0];
}

export function bdSelect(which: Selection, deps: SpawnDeps = {}): Row[] | ApprovedRow[] {
  const beads = bdList(deps);
  switch (which) {
    case 'drafting': return selectDrafting(beads);
    case 'approved': return selectApproved(beads);
    case 'revise': return selectRevise(beads);
  }
}

export function bdLeaves(rootId: string, deps: SpawnDeps = {}): { id: string; title: string }[] {
  return unanalysedLeaves(bdList(deps), rootId);
}

export function bdInspect(beadId: string, deps: SpawnDeps = {}): Inspection {
  return inspect(bdShow(beadId, deps));
}

export function bdNotes(beadId: string, deps: SpawnDeps = {}): string {
  return bdShow(beadId, deps).notes ?? '';
}
