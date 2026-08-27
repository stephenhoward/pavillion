/**
 * triage-delta.ts — turn one weekly Trivy scan plus current bead/PR state into
 * a categorized delta the /triage-health agent can act on without re-deriving
 * anything.
 *
 * This module is the deterministic half of the skill. Everything above the CLI
 * shell divider is pure: scan reports, filed CVE beads, the rolling watch bead,
 * and open Renovate PRs all arrive as data. The shell at the bottom of the file
 * is the only part that runs `gh` or `bd`.
 *
 * Design mirrors scripts/trivy-summary.ts:
 *   - Pure core split from the IO shell so the categorization is unit-tested
 *     against fixtures rather than against a live GitHub run.
 *   - No new dependencies; Trivy JSON is parsed by `summarize()` from
 *     scripts/trivy-summary.ts rather than re-implemented here.
 *
 * Usage:
 *   npx tsx .claude/skills/triage-health/triage-delta.ts [--out FILE]
 *
 * Triage contract:
 *   - Scope follows the health report itself: CRITICAL/HIGH vulnerabilities,
 *     plus every secret and (CRITICAL/HIGH) misconfiguration `summarize()`
 *     itemizes. MEDIUM/LOW vulnerabilities stay counts-only.
 *   - Every in-scope finding lands in exactly one category — nothing is
 *     silently dropped. Anything the scope deliberately narrows away is
 *     reported as data in `scope_notes` rather than vanishing.
 *   - A CVE named on an existing open bead is never re-filed. That is the
 *     idempotency invariant the whole weekly workflow rests on.
 *   - Secrets and misconfigurations are always actionable: "no fixed version"
 *     is meaningless for them, so they never reach the watch list.
 *   - A failed, missing, or absent scan surfaces as `scan_errors` /
 *     `scope_notes.missingScans` and suppresses resolution entirely: absence
 *     from a scan that did not run is not evidence a finding is gone.
 *   - Resolution is decided against every id the scan named at *any* severity,
 *     not against the CRITICAL/HIGH subset triaged here. A CVE re-rated down is
 *     still present, so it must not read as fixed.
 *   - Uncertainty always fails toward "file a bead". A Renovate match that
 *     cannot be proven to reach the fixed version, that cannot be tied to this
 *     package by *both* branch and title, or that leaves any package of a
 *     collapsed finding uncovered, produces work rather than suppressing it.
 *   - Prose belongs to the agent. Everything this module narrows away is
 *     reported as structured data; SKILL.md turns it into sentences.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  SEVERITIES,
  readReports,
  summarize,
  type Finding,
  type ReportInput,
  type Severity,
} from '../../../scripts/trivy-summary.js';

/**
 * Where a finding lives, which decides the fix strategy the agent writes:
 * `node` for Node.js dependencies, `image` for base-image/OS packages, `repo`
 * for everything else the filesystem scan turns up (Dockerfiles, workflows).
 */
export type TargetClass = 'node' | 'image' | 'repo';

/** One finding, collapsed across the per-package rows Trivy emits for it. */
export interface DeltaFinding {
  id: string;
  severity: Severity;
  kind: Finding['kind'];
  title: string;
  /** Scan label the finding came from (`repository`, `image`). */
  scan: string;
  target: string;
  targetClass: TargetClass;
  /** Every package the CVE was reported against on this target, sorted. */
  packages: string[];
  installed?: string;
  /** Undefined when no fixed version is published — the watch-list trigger. */
  fixedVersion?: string;
  /**
   * The fixed version published for each individual package, keyed by package
   * name. `fixedVersion` above is the flattened display value; coverage
   * decisions read this map, because comparing a PR's target against a *different*
   * package's fix compares numbers from unrelated version spaces.
   */
  fixedVersions?: Record<string, string>;
  fixable: boolean;
  url?: string;
  /**
   * Open Renovate PRs that named a package of this finding but did not earn
   * suppression. The finding is still filed — the hints only save the agent from
   * re-deriving the links.
   */
  renovateHints?: RenovateHint[];
}

/** A Renovate PR that matched a package but did not earn suppression. */
export interface RenovateHint {
  number: number;
  title: string;
  /** The finding package this PR was matched against. */
  pkg: string;
  /** Why the match was not treated as coverage. */
  reason: string;
}

/** The identifying half of a `RenovatePr`, as carried in the delta output. */
export interface RenovatePrRef {
  number: number;
  title: string;
}

/**
 * A finding whose every package is provably carried by an open Renovate PR.
 *
 * Plural because one collapsed finding can span several packages, and Renovate
 * opens one PR per dependency: `prs` lists every PR the coverage rests on.
 */
export interface CoveredFinding extends DeltaFinding {
  prs: RenovatePrRef[];
}

/** Findings this scan repeats that are already recorded somewhere. */
export interface AlreadyTracked {
  /** Number of in-scope findings suppressed as already-known. */
  count: number;
  /** Finding ids covered by an open bead or the watch list. */
  cves: string[];
  /** Open beads whose CVEs: line matched something in this scan. */
  beadIds: string[];
  /** Subset of `cves` recorded on the watch bead rather than on a bead. */
  onWatchList: string[];
}

/** A tracked bead whose CVEs have (partly) left the scan. */
export interface ResolvedBead {
  beadId: string;
  title?: string;
  status: 'fully' | 'partially';
  clearedCves: string[];
  remainingCves: string[];
}

export interface Resolved {
  beads: ResolvedBead[];
  /** Watch-list entries absent from this scan — the agent prunes these. */
  watchEntries: string[];
}

export interface DeltaMetadata {
  sha?: string;
  runUrl?: string;
  scanDate?: string;
  healthReportIssue?: number;
}

/** A bead labelled `cve`, as `bd list --json` returns it. */
export interface CveBead {
  id: string;
  title?: string;
  status?: string;
  notes?: string;
}

/** The rolling watch bead; its design field holds the seen-list table. */
export interface WatchBead {
  id: string;
  design?: string;
}

/**
 * One row of `gh pr list --json number,title,headRefName,state,author`.
 *
 * `state` and `author` are part of the type on purpose. The "open, authored by
 * Renovate" guarantee decides whether a finding is suppressed, so it is
 * enforced here — where it is unit-testable — rather than resting on the flags
 * the CLI shell happens to pass in a public repository anyone can open a PR
 * against.
 */
export interface RenovatePr {
  number: number;
  title: string;
  /** Renovate's branch, e.g. `renovate/undici-6.x` — the matching key. */
  headRefName: string;
  /** gh's PR state; only `OPEN` may cover a finding. */
  state: string;
  /** PR author login (`gh pr list --json author` → `.author.login`). */
  author?: string;
  /** `gh pr list --json author` → `.author.is_bot`; a human is never Renovate. */
  authorIsBot?: boolean;
}

export interface DeltaInputs {
  reports: ReportInput[];
  /**
   * The scan labels this run must see before it may treat absence as
   * resolution — the same labels the CLI shell passes to `readReports()`
   * (`repository`, `image`).
   *
   * A scan that failed shows up in `scan_errors`; a scan that was never
   * attempted shows up nowhere at all, which is why the expected set has to be
   * stated rather than inferred from what arrived. Any expected label with no
   * report suppresses resolution wholesale.
   */
  expectedScans: string[];
  cveBeads: CveBead[];
  /**
   * Every open bead labelled `cve-watch`, passed through unfiltered: the
   * cardinality check lives here rather than in the shell so it is testable.
   * Zero is a valid first run; more than one is an abort.
   */
  watchBeads: WatchBead[];
  renovatePrs: RenovatePr[];
  metadata?: DeltaMetadata;
}

/**
 * What this run deliberately did not triage, as structured data rather than as
 * silence — and deliberately not as prose. Composing these fields into the
 * sentences the triage summary carries is the agent's job (SKILL.md), per the
 * spec's "script for determinism, agent for judgment (including wording)".
 *
 * `untriagedMisconfigurations` exists because the spec contradicts itself: it
 * puts *all* misconfigurations in scope regardless of severity while forbidding
 * any change to `trivy-summary.ts`, whose `summarize()` itemizes only
 * CRITICAL/HIGH. The narrowing is reported instead of hidden, and a human
 * decides whether it warrants widening `summarize()`.
 */
export interface ScopeNotes {
  /** Misconfigurations counted by the scan but below the itemization cut. */
  untriagedMisconfigurations: Record<Severity, number>;
  /** Expected scan labels with no report at all this run (see `expectedScans`). */
  missingScans: string[];
}

export interface Delta {
  metadata: DeltaMetadata;
  /** Every severity counted, including the MEDIUM/LOW that are not triaged. */
  counts: Record<Severity, number>;
  new_actionable: DeltaFinding[];
  covered_by_renovate: CoveredFinding[];
  newly_fixable: DeltaFinding[];
  new_no_fix: DeltaFinding[];
  already_tracked: AlreadyTracked;
  resolved: Resolved;
  /**
   * True when this run refused to derive resolution at all — a failed scan, an
   * expected scan that never arrived, or no usable report. `resolved` is then
   * empty because nothing could be *proven* gone, which is a different claim
   * from "nothing was resolved", and the agent must not close beads or prune
   * watch entries on it.
   */
  resolution_suppressed: boolean;
  scan_errors: string[];
  scope_notes: ScopeNotes;
}

/**
 * Tokens accepted as finding ids: CVE-2026-0001, GHSA-xxxx-xxxx-xxxx, Trivy
 * misconfiguration ids like DS002, secret rule ids like aws-access-key-id.
 * The digit-or-hyphen requirement is what keeps prose ("none", table headers)
 * out of the parsed lists.
 */
const ID_TOKEN = /^[A-Za-z][A-Za-z0-9._-]*$/;

function isFindingId(token: string): boolean {
  return token.length >= 3 && ID_TOKEN.test(token) && /[\d-]/.test(token);
}

function normalizeId(id: string): string {
  return id.trim().toUpperCase();
}

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Extract the finding ids from the machine-readable `CVEs:` lines a triage bead
 * carries in its notes. Each must start its own line — a mid-sentence mention is
 * prose, not state. Ids come back upper-cased and de-duplicated so they compare
 * directly against scan ids.
 *
 * The union of *every* matching line is taken, not the first. `bd note` appends,
 * so an amended list lands below the original; reading only the topmost one
 * would judge a bead against a stale set and could close it on a CVE it never
 * covered.
 */
export function parseCvesLine(notes: string | null | undefined): string[] {
  if (!notes) return [];

  const ids: string[] = [];
  for (const match of notes.matchAll(/^[ \t]*CVEs:[ \t]*(.*)$/gim)) {
    ids.push(
      ...match[1]
        .split(/[,;\s]+/)
        .map(token => token.trim())
        .filter(isFindingId)
        .map(normalizeId),
    );
  }
  return dedupe(ids);
}

/**
 * Extract the seen-list from the watch bead's design field: the first column of
 * every data row of its markdown table. Header and divider rows fall out
 * naturally because neither is a finding id.
 */
export function parseWatchTable(design: string | null | undefined): string[] {
  if (!design) return [];

  const ids: string[] = [];
  for (const line of design.split('\n')) {
    if (!line.includes('|')) continue;

    const cells = line.split('|');
    if (cells[0].trim() === '') cells.shift();

    const first = (cells[0] ?? '').trim();
    if (isFindingId(first)) ids.push(normalizeId(first));
  }
  return dedupe(ids);
}

function targetClassFor(finding: Finding): TargetClass {
  if (/image/i.test(finding.scan)) return 'image';
  if (/(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml)(:|$)/.test(finding.target)) return 'node';
  if (/node_modules/.test(finding.target)) return 'node';
  return 'repo';
}

function hasFix(value: string | undefined): boolean {
  return !!value && value !== 'none';
}

/**
 * Collapse the per-package rows Trivy emits into one entry per finding id per
 * scan target: a base-image CVE listed against perl, perl-base, libperl5.40 and
 * perl-modules-5.40 is one upgrade decision, not four.
 */
function collapse(findings: Finding[]): DeltaFinding[] {
  // `_fixed` is keyed by package rather than flattened, so that a later coverage
  // check compares a PR's target against the fix for the package that PR
  // actually upgrades. Flattening loses that binding, and two packages on one
  // CVE do not share a version space.
  const byKey = new Map<string, DeltaFinding & { _installed: string[]; _fixed: Map<string, string[]> }>();

  // The collapse key is NUL-separated, written as a `\u0000` escape so the
  // separator is visible in the source. Trivy targets carry spaces
  // (`debian 12.5 (bookworm)`) and so can filesystem paths, which makes any
  // printable separator ambiguous between neighbouring fields.
  for (const finding of findings) {
    const key = `${finding.scan}\u0000${finding.target}\u0000${finding.id}`;
    let entry = byKey.get(key);

    if (!entry) {
      entry = {
        id: finding.id,
        severity: finding.severity,
        kind: finding.kind,
        title: finding.title,
        scan: finding.scan,
        target: finding.target,
        targetClass: targetClassFor(finding),
        packages: [],
        fixable: false,
        url: finding.url,
        _installed: [],
        _fixed: new Map(),
      };
      byKey.set(key, entry);
    }

    const pkg = finding.pkg && finding.pkg !== 'unknown' ? finding.pkg : undefined;
    if (pkg && !entry.packages.includes(pkg)) {
      entry.packages.push(pkg);
    }
    if (finding.installed && finding.installed !== 'unknown' && !entry._installed.includes(finding.installed)) {
      entry._installed.push(finding.installed);
    }
    if (hasFix(finding.fixedVersion)) {
      const versions = entry._fixed.get(pkg ?? '') ?? [];
      if (!versions.includes(finding.fixedVersion!)) versions.push(finding.fixedVersion!);
      entry._fixed.set(pkg ?? '', versions);
    }
    // The most severe row wins: a CVE rated differently per package is triaged
    // at its worst rating.
    if (SEVERITIES.indexOf(finding.severity) < SEVERITIES.indexOf(entry.severity)) {
      entry.severity = finding.severity;
    }
    entry.url ??= finding.url;
  }

  return [...byKey.values()].map(({ _installed, _fixed, ...entry }) => {
    const fixedVersions: Record<string, string> = {};
    for (const [pkg, versions] of _fixed) fixedVersions[pkg] = versions.join(', ');
    const allFixed = dedupe([..._fixed.values()].flat());

    return {
      ...entry,
      packages: [...entry.packages].sort(),
      installed: _installed.length > 0 ? _installed.join(', ') : undefined,
      fixedVersion: allFixed.length > 0 ? allFixed.join(', ') : undefined,
      fixedVersions: allFixed.length > 0 ? fixedVersions : undefined,
      fixable: allFixed.length > 0,
    };
  });
}

const RENOVATE_BRANCH_PREFIX = /^renovate\//i;

/**
 * What Renovate appends after the dependency slug in a branch name: a version
 * constraint (`6.x`, `1.3.2`) or an update-type keyword. Requiring one of these
 * is what separates `renovate/git-url-parse-14.x` (dependency `git-url-parse`)
 * from a `git` finding trying to claim it — a plain word-boundary check reads
 * the hyphen as a boundary and matches the wrong package.
 */
const RENOVATE_UPDATE_SUFFIX = /^(v?\d|major|minor|patch|digest|monorepo|vulnerability|lock-file-maintenance)/i;

/** Renovate's branch slug for a package: `@types/node` → `types-node`. */
function packageSlug(pkg: string): string {
  return pkg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * The dependency a Renovate PR title names. Renovate's conventional title is
 * `update dependency <name> to v<x>`; a grouped, monorepo, or hand-retitled PR
 * matches nothing, which reads as "cannot prove" rather than as a match.
 */
const RENOVATE_TITLE_DEPENDENCY = /\bupdate\s+dependency\s+(\S+)\s+to\b/i;

/**
 * True when the branch follows `renovate/<package-slug>-<version-or-keyword>`
 * for this package.
 *
 * This is only half the identity check — see `prNamesPackage`. The branch alone
 * is not sufficient, because the *version* that decides coverage is read from
 * the title, and Renovate's grouped and retitled PRs routinely carry a branch
 * and a title naming different dependencies.
 */
function branchNamesPackage(headRefName: string, pkg: string): boolean {
  if (!RENOVATE_BRANCH_PREFIX.test(headRefName)) return false;

  const slug = packageSlug(pkg);
  if (slug.length === 0) return false;

  const branch = headRefName.replace(RENOVATE_BRANCH_PREFIX, '').toLowerCase();
  // Vulnerability-alert branches prefix the datasource (`renovate/npm-undici-
  // vulnerability`), so try the branch with and without it.
  const candidates = branch.startsWith('npm-') ? [branch, branch.slice(4)] : [branch];

  return candidates.some((candidate) => {
    if (candidate === slug) return true;
    if (!candidate.startsWith(`${slug}-`)) return false;
    return RENOVATE_UPDATE_SUFFIX.test(candidate.slice(slug.length + 1));
  });
}

/**
 * True when the title's `update dependency <name>` clause resolves to this same
 * package. This is the half that binds identity to the decisive value: the
 * target version is parsed out of the title, so unless the title names *this*
 * package the comparison is against an unrelated dependency's release line.
 */
function titleNamesPackage(title: string, pkg: string): boolean {
  const named = RENOVATE_TITLE_DEPENDENCY.exec(title ?? '')?.[1];
  if (!named) return false;

  const slug = packageSlug(named);
  return slug.length > 0 && slug === packageSlug(pkg);
}

/**
 * A PR may be matched to a package only when its branch *and* its title both
 * name that package. Either string alone has produced false coverage: the
 * branch suffix rule alone lets `base` claim `renovate/base-64-1.x`, and the
 * title alone is not tied to Renovate's branch convention at all.
 */
function prNamesPackage(pr: RenovatePr, pkg: string): boolean {
  return branchNamesPackage(pr.headRefName ?? '', pkg) && titleNamesPackage(pr.title ?? '', pkg);
}

/**
 * Only an open PR Renovate itself opened may suppress a finding. This repo is
 * public, so anyone can open a PR on a `renovate/`-shaped branch; the author
 * check is what stops that from silencing a CVE. An absent `author` disables
 * coverage entirely rather than trusting the branch name alone — the fail-safe
 * direction, since the cost is a duplicate bead rather than a dropped CVE.
 */
function isTrustedRenovatePr(pr: RenovatePr): boolean {
  if ((pr.state ?? '').toUpperCase() !== 'OPEN') return false;
  if (!RENOVATE_BRANCH_PREFIX.test(pr.headRefName ?? '')) return false;
  // `gh pr list --json author` reports `is_bot`. A human account is never
  // Renovate whatever it renames itself to; when the field is absent (older gh,
  // a hand-built input) the login check stands on its own.
  if (pr.authorIsBot === false) return false;
  return /^renovate(\[bot\])?$/i.test((pr.author ?? '').replace(/^app\//, ''));
}

/** Numeric release segments of a version, or undefined when it is not one. */
function versionSegments(version: string): number[] | undefined {
  const core = version.trim().split(/[-+]/)[0];
  if (!/^\d+(\.\d+)*$/.test(core)) return undefined;
  return core.split('.').map(Number);
}

/** -1/0/1 comparing two release versions; undefined when either is unreadable. */
function compareVersions(a: string, b: string): number | undefined {
  const left = versionSegments(a);
  const right = versionSegments(b);
  if (!left || !right) return undefined;

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The concrete version a Renovate PR title upgrades to. Ranges (`to v6.x`) and
 * grouped/monorepo titles yield nothing, which is treated as uncertainty rather
 * than as coverage.
 */
function prTargetVersion(pr: RenovatePr): string | undefined {
  return /\bto\s+v?(\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.]+)?)(?![\w.-])/i.exec(pr.title)?.[1];
}

/** The outcome of evaluating one PR against one package of a finding. */
interface PrEvaluation {
  pr: RenovatePr;
  /** True only when the PR provably reaches that package's fixed version. */
  covered: boolean;
  /** Populated when `covered` is false: why the match did not suppress. */
  reason: string;
}

/** How one package of a finding relates to the open Renovate PR list. */
interface PackageCoverage {
  pkg: string;
  /** The PR proven to reach this package's fixed version, when one exists. */
  pr?: RenovatePr;
  /** PRs that named the package without proving the upgrade. */
  hints: RenovateHint[];
}

/** What the open Renovate PR list does, collectively, for one finding. */
interface RenovateCoverage {
  /** True only when *every* package of the finding is provably covered. */
  covered: boolean;
  /** The PRs the coverage rests on; empty unless `covered`. */
  prs: RenovatePrRef[];
  /** Everything that matched without earning suppression. */
  hints: RenovateHint[];
}

/**
 * Match a fixable finding against the open Renovate PRs.
 *
 * Four deliberate narrowings, each of which turns a would-be silent drop into
 * an extra bead a human closes as a duplicate:
 *   - Node.js dependencies only. Renovate does not upgrade OS packages, so an
 *     `image` CVE on `node` must never be claimed by a `node-forge` PR.
 *   - Branch convention *and* title dependency name must agree (`prNamesPackage`).
 *   - The PR must provably reach the fixed version published for that same
 *     package. A pinned or stalled PR otherwise suppresses the CVE for as long
 *     as it stays open.
 *   - Every package of a collapsed finding must be covered. One CVE against
 *     `foo` and `bar` is not handled by a PR that upgrades only `foo`; partial
 *     coverage files the whole finding, carrying the matched PRs as hints.
 */
function matchRenovate(finding: DeltaFinding, prs: RenovatePr[]): RenovateCoverage | undefined {
  if (finding.targetClass !== 'node') return undefined;
  if (finding.packages.length === 0) return undefined;

  const coverages = finding.packages.map(pkg => coverPackage(finding, pkg, prs));
  if (coverages.every(coverage => !coverage.pr && coverage.hints.length === 0)) return undefined;

  const uncovered = coverages.filter(coverage => !coverage.pr).map(coverage => coverage.pkg);
  if (uncovered.length === 0) {
    return { covered: true, prs: dedupePrRefs(coverages.map(coverage => coverage.pr!)), hints: [] };
  }

  return {
    covered: false,
    prs: [],
    hints: coverages.flatMap(coverage => (coverage.pr
      ? [{
        number: coverage.pr.number,
        title: coverage.pr.title,
        pkg: coverage.pkg,
        reason: `PR #${coverage.pr.number} reaches the fixed version for ${coverage.pkg}, `
          + `but no open Renovate PR covers ${uncovered.join(', ')}`,
      }]
      : coverage.hints)),
  };
}

/** Find the PR, if any, that provably upgrades one package past its fix. */
function coverPackage(finding: DeltaFinding, pkg: string, prs: RenovatePr[]): PackageCoverage {
  const candidates = prs.filter(pr => isTrustedRenovatePr(pr) && prNamesPackage(pr, pkg));
  // Renovate can have several open branches for one package (a v6 line and a
  // v7 major, say). A PR that reaches the fix wins over one that does not.
  const evaluations = candidates.map(pr => evaluateRenovatePr(pr, pkg, finding));
  const covering = evaluations.find(evaluation => evaluation.covered);

  if (covering) return { pkg, pr: covering.pr, hints: [] };
  return {
    pkg,
    hints: evaluations.map(({ pr, reason }) => ({ number: pr.number, title: pr.title, pkg, reason })),
  };
}

function dedupePrRefs(prs: RenovatePr[]): RenovatePrRef[] {
  const seen = new Set<number>();
  const refs: RenovatePrRef[] = [];
  for (const pr of prs) {
    if (seen.has(pr.number)) continue;
    seen.add(pr.number);
    refs.push({ number: pr.number, title: pr.title });
  }
  return refs;
}

/**
 * Decide whether one matched PR provably carries the fix for one package.
 *
 * The fixed version comes from `fixedVersions[pkg]`, never from the finding's
 * flattened list: comparing this PR's target against a sibling package's fix
 * compares numbers from unrelated version spaces and passes by coincidence.
 */
function evaluateRenovatePr(pr: RenovatePr, pkg: string, finding: DeltaFinding): PrEvaluation {
  const target = prTargetVersion(pr);
  if (!target) {
    return { pr, covered: false, reason: `PR #${pr.number} names ${pkg} but its target version could not be read from the title` };
  }

  // A comma-separated FixedVersion is treated as "must clear all of them",
  // which over-files rather than under-files when Trivy lists alternatives.
  const fixedVersions = (finding.fixedVersions?.[pkg] ?? '').split(',').map(v => v.trim()).filter(Boolean);
  if (fixedVersions.length === 0) {
    return { pr, covered: false, reason: `PR #${pr.number} names ${pkg} but no fixed version is published for that package` };
  }

  for (const fixed of fixedVersions) {
    const order = compareVersions(target, fixed);
    if (order === undefined) {
      return { pr, covered: false, reason: `PR #${pr.number} targets ${target}, which cannot be compared against fixed version ${fixed} for ${pkg}` };
    }
    if (order < 0) {
      return { pr, covered: false, reason: `PR #${pr.number} targets ${target}, below the fixed version ${fixed} for ${pkg}` };
    }
  }

  return { pr, covered: true, reason: '' };
}

/**
 * Every bd built-in status except `closed` (`bd statuses`): each one means the
 * bead is still standing, so the CVE it names is tracked.
 *
 * The list is an allow-list rather than a `closed` deny-list on purpose.
 * Anything else — an absent status field, a renamed one, a custom status a
 * future `bd config` adds — reads as "not tracked", so the finding is re-filed
 * and the bead stays out of resolution. Failing the other way lets a field this
 * code cannot read silently suppress a CVE.
 */
const OPEN_STATUSES = new Set(['open', 'in_progress', 'blocked', 'deferred', 'pinned', 'hooked']);

function isOpen(bead: CveBead): boolean {
  return OPEN_STATUSES.has((bead.status ?? '').trim().toLowerCase());
}

function emptyCounts(): Record<Severity, number> {
  return { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
}

/** Severities `summarize()` itemizes; everything else is counts-only. */
const ITEMIZED: Severity[] = ['CRITICAL', 'HIGH'];

function asSeverity(value: unknown): Severity {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  return (SEVERITIES as readonly string[]).includes(upper) ? upper as Severity : 'UNKNOWN';
}

/** The raw-row collections Trivy emits, with the field carrying each id. */
const RAW_ID_FIELDS = [
  ['Vulnerabilities', 'VulnerabilityID'],
  ['Misconfigurations', 'ID'],
  ['Secrets', 'RuleID'],
] as const;

/** What one severity-blind pass over the raw Trivy JSON yields. */
interface RawScanFacts {
  /**
   * Every finding id the scan named, at *any* severity. Presence, unlike
   * triage, is severity-blind: a CVE re-rated from HIGH to MEDIUM drops out of
   * `summarize()`'s itemized list while still being present in the image, and
   * deriving resolution from that list would report it as fixed.
   */
  allIds: Set<string>;
  /**
   * Misconfigurations the spec puts in scope but `summarize()` does not
   * itemize — see `ScopeNotes`.
   */
  untriagedMisconfigurations: Record<Severity, number>;
}

/**
 * The one place this module looks at raw Trivy JSON. It reads a couple of
 * fields per row rather than re-implementing the parse; the alternative is
 * widening `summarize()`, which the spec forbids.
 */
function readRawReports(reports: ReportInput[]): RawScanFacts {
  const allIds = new Set<string>();
  const untriagedMisconfigurations = emptyCounts();

  for (const report of reports) {
    if (report.error) continue;

    const results = (report.json as { Results?: unknown } | null)?.Results;
    if (!Array.isArray(results)) continue;

    for (const result of results) {
      for (const [collection, idField] of RAW_ID_FIELDS) {
        const rows = (result as Record<string, unknown> | null)?.[collection];
        if (!Array.isArray(rows)) continue;

        for (const row of rows) {
          const record = row as Record<string, unknown> | null;

          const id = record?.[idField];
          if (typeof id === 'string' && id.trim().length > 0) allIds.add(normalizeId(id));

          if (collection === 'Misconfigurations') {
            const severity = asSeverity(record?.Severity);
            if (!ITEMIZED.includes(severity)) untriagedMisconfigurations[severity]++;
          }
        }
      }
    }
  }
  return { allIds, untriagedMisconfigurations };
}

/**
 * Expected scan labels with no report at all. A scan that failed arrives with
 * an `error` and is reported through `scan_errors`; a scan that was never
 * attempted arrives as nothing, which is why the expected set has to be stated
 * rather than inferred. The two lists stay disjoint.
 */
function missingScanLabels(expected: string[], reports: ReportInput[]): string[] {
  const present = new Set(reports.map(report => report.label));
  return expected.filter(label => !present.has(label));
}

/** Open beads plus the CVE lookups derived from their `CVEs:` lines. */
interface BeadIndex {
  openBeads: CveBead[];
  /** Bead id → the CVEs it claims to cover. */
  cvesByBead: Map<string, string[]>;
  /** CVE → the open beads that claim it. */
  beadsByCve: Map<string, string[]>;
}

function buildBeadIndex(cveBeads: CveBead[]): BeadIndex {
  // Only open beads suppress a re-file; a closed bead means the work is done,
  // so a CVE that came back deserves a fresh bead.
  const openBeads = cveBeads.filter(isOpen);
  const cvesByBead = new Map(openBeads.map(bead => [bead.id, parseCvesLine(bead.notes)]));
  const beadsByCve = new Map<string, string[]>();

  for (const [beadId, cves] of cvesByBead) {
    for (const cve of cves) {
      beadsByCve.set(cve, [...(beadsByCve.get(cve) ?? []), beadId]);
    }
  }
  return { openBeads, cvesByBead, beadsByCve };
}

/** The finding categories, before metadata and resolution are folded in. */
interface Categorized {
  new_actionable: DeltaFinding[];
  covered_by_renovate: CoveredFinding[];
  newly_fixable: DeltaFinding[];
  new_no_fix: DeltaFinding[];
  already_tracked: AlreadyTracked;
}

/**
 * Place every in-scope finding in exactly one category. The ordering below is
 * the triage policy: an existing bead wins over everything (idempotency),
 * secrets and misconfigurations skip the fix-version split entirely, and only a
 * proven Renovate upgrade suppresses a fixable vulnerability.
 */
function categorizeFindings(
  findings: DeltaFinding[],
  beadsByCve: Map<string, string[]>,
  watchSet: Set<string>,
  renovatePrs: RenovatePr[],
): Categorized {
  const result: Categorized = {
    new_actionable: [],
    covered_by_renovate: [],
    newly_fixable: [],
    new_no_fix: [],
    already_tracked: { count: 0, cves: [], beadIds: [], onWatchList: [] },
  };

  const trackedCves: string[] = [];
  const trackedBeadIds: string[] = [];
  const trackedOnWatch: string[] = [];

  for (const finding of findings) {
    const id = normalizeId(finding.id);
    const coveringBeads = beadsByCve.get(id);

    if (coveringBeads) {
      result.already_tracked.count++;
      trackedCves.push(id);
      trackedBeadIds.push(...coveringBeads);
      continue;
    }

    // Secrets and misconfigurations have no fixed-version semantics, so the
    // fixable/watch-list split below does not apply to them: they are always
    // actionable.
    if (finding.kind !== 'vulnerability') {
      result.new_actionable.push(finding);
      continue;
    }

    if (finding.fixable) {
      const coverage = matchRenovate(finding, renovatePrs);
      if (coverage?.covered) {
        result.covered_by_renovate.push({ ...finding, prs: coverage.prs });
        continue;
      }

      // An unproven or partial match still files the finding; the hints only
      // carry the links forward so the agent does not re-derive them.
      const filed: DeltaFinding = coverage && coverage.hints.length > 0
        ? { ...finding, renovateHints: coverage.hints }
        : finding;

      if (watchSet.has(id)) result.newly_fixable.push(filed);
      else result.new_actionable.push(filed);
      continue;
    }

    if (watchSet.has(id)) {
      result.already_tracked.count++;
      trackedCves.push(id);
      trackedOnWatch.push(id);
      continue;
    }

    result.new_no_fix.push(finding);
  }

  result.already_tracked.cves = dedupe(trackedCves);
  result.already_tracked.beadIds = dedupe(trackedBeadIds);
  result.already_tracked.onWatchList = dedupe(trackedOnWatch);
  return result;
}

/**
 * Work out what left the scan since last week.
 *
 * Callers must only reach this on a complete scan. Resolution is derived purely
 * from absence, and absence from a scan that did not finish means nothing —
 * acting on it would close live CVE beads and prune live watch entries.
 *
 * `scanIds` must be the severity-blind id set (`RawScanFacts.allIds`), not the
 * triaged findings: a CVE downgraded to MEDIUM is still there.
 */
function computeResolved(
  index: BeadIndex,
  watchList: string[],
  scanIds: Set<string>,
): Resolved {
  const beads: ResolvedBead[] = [];

  for (const bead of index.openBeads) {
    const cves = index.cvesByBead.get(bead.id) ?? [];
    if (cves.length === 0) continue;

    const remainingCves = cves.filter(cve => scanIds.has(cve));
    const clearedCves = cves.filter(cve => !scanIds.has(cve));
    if (clearedCves.length === 0) continue;

    beads.push({
      beadId: bead.id,
      title: bead.title,
      status: remainingCves.length === 0 ? 'fully' : 'partially',
      clearedCves,
      remainingCves,
    });
  }

  return { beads, watchEntries: watchList.filter(cve => !scanIds.has(cve)) };
}

/**
 * Categorize one scan against current triage state.
 *
 * Throws when more than one open `cve-watch` bead exists: the watch list is a
 * single rewritten document, so a split one is corruption the agent must not
 * paper over by picking a winner.
 */
export function computeDelta(inputs: DeltaInputs): Delta {
  if (inputs.watchBeads.length > 1) {
    const ids = inputs.watchBeads.map(bead => bead.id).join(', ');
    throw new Error(
      `expected at most one open cve-watch bead, found ${inputs.watchBeads.length} (${ids}); `
      + 'close or merge the duplicates before triaging',
    );
  }

  const summary = summarize(inputs.reports);
  const counts = emptyCounts();
  for (const scan of summary.scans) {
    for (const severity of SEVERITIES) counts[severity] += scan.counts[severity];
  }

  const raw = readRawReports(inputs.reports);
  const findings = collapse(summary.findings);

  const watchList = parseWatchTable(inputs.watchBeads[0]?.design);
  const index = buildBeadIndex(inputs.cveBeads);

  const categorized = categorizeFindings(findings, index.beadsByCve, new Set(watchList), inputs.renovatePrs);

  // Resolution is the one destructive signal in the delta — it closes beads and
  // prunes watch entries — and it is derived purely from absence. It is
  // therefore computed only from a run where every expected scan arrived and
  // completed. `every()` on an empty array is true, so zero reports suppresses
  // too: nothing scanned can never mean everything is fixed.
  const missingScans = missingScanLabels(inputs.expectedScans ?? [], inputs.reports);
  const resolutionSuppressed = summary.errors.length > 0
    || missingScans.length > 0
    || inputs.reports.every(report => !!report.error);

  return {
    metadata: inputs.metadata ?? {},
    counts,
    ...categorized,
    resolved: resolutionSuppressed
      ? { beads: [], watchEntries: [] }
      : computeResolved(index, watchList, raw.allIds),
    resolution_suppressed: resolutionSuppressed,
    scan_errors: summary.errors,
    scope_notes: { untriagedMisconfigurations: raw.untriagedMisconfigurations, missingScans },
  };
}

// ---------------------------------------------------------------------------
// CLI shell — the only IO in this file. It gathers the four inputs
// `computeDelta()` needs and prints the result; it decides nothing.
// ---------------------------------------------------------------------------

/**
 * The files `health.weekly.yaml` uploads in its `trivy-reports` artifact, and
 * the scan label each one carries into the delta.
 *
 * This list is also `expectedScans`: it is what the run *intends* to read, so a
 * file that never arrives is reported as a missing scan rather than being
 * invisible. It must stay in step with the workflow's Trivy steps — a scan
 * added there and not here is triaged by nobody.
 */
const SCAN_FILES = [
  ['repository', 'trivy-fs.json'],
  ['image', 'trivy-image.json'],
] as const;

const EXPECTED_SCANS: string[] = SCAN_FILES.map(([label]) => label);
const SCAN_ARTIFACT = 'trivy-reports';
const HEALTH_WORKFLOW = 'health.weekly.yaml';
const HEALTH_REPORT_LABEL = 'health-report';

/**
 * Cap on every `bd list` read. bd truncates at its own default of 50 without
 * saying so, so the limit is always explicit — and a read that comes back *at*
 * the cap is treated as truncated rather than complete, because triaging
 * against a partial view of the filed beads re-files work already tracked.
 */
const BEAD_LIMIT = 400;

/**
 * Reject a report that was present and parsed but named no scan target at all.
 *
 * This is the third leg of "absence is not evidence", alongside the two the
 * core already has: `scan_errors` covers a scan that failed, `missingScans`
 * covers a scan that never ran, and this covers a scan whose report arrived
 * empty — `Results: null`, `Results: []`, a truncated file, an error page.
 * `summarize()` and `readRawReports()` both skip a non-array `Results` quietly,
 * so without this an empty report resolves every CVE bead and prunes every
 * watch entry.
 *
 * A report that scanned a target and found nothing in it is a different thing
 * and stays usable: the target row is the evidence that the scanner looked.
 *
 * Pure and exported so the guard is unit-tested rather than resting on a live
 * `gh run download`; the shell applies it to everything it reads.
 */
export function checkReportUsability(reports: ReportInput[]): ReportInput[] {
  return reports.map(report => {
    if (report.error) return report;

    const results = (report.json as { Results?: unknown } | null)?.Results;
    if (Array.isArray(results) && results.length > 0) return report;

    return {
      ...report,
      error: 'report parsed but listed no scan results — a scanner that examined nothing '
        + 'is a failed scan, not a clean one',
    };
  });
}

/**
 * Run a command with an argument array — never a shell string, so no external
 * value is ever interpolated into a command line.
 */
function capture(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  }
  catch (err) {
    const stderr = (err as { stderr?: string }).stderr;
    throw new Error(`\`${command} ${args.join(' ')}\` failed: ${stderr?.trim() || (err as Error).message}`);
  }
}

function captureJson<T>(command: string, args: string[]): T {
  const out = capture(command, args);
  try {
    return JSON.parse(out) as T;
  }
  catch {
    throw new Error(`\`${command} ${args.join(' ')}\` did not return JSON: ${out.slice(0, 200)}`);
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

interface BeadRow {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  notes?: unknown;
  design?: unknown;
}

/**
 * One `bd list` read, with the shape and cardinality asserted rather than
 * assumed. An unparseable, non-array, or truncated read aborts: bead state is
 * what stops this run re-filing work, and a silently short list looks exactly
 * like "nothing is tracked yet".
 */
function listBeads(filters: string[]): BeadRow[] {
  const args = ['list', ...filters, '-n', String(BEAD_LIMIT), '--json'];
  const rows = captureJson<unknown>('bd', args);

  if (!Array.isArray(rows)) {
    throw new Error(`\`bd ${args.join(' ')}\` returned ${typeof rows}, expected an array of beads`);
  }
  if (rows.length >= BEAD_LIMIT) {
    throw new Error(
      `\`bd ${args.join(' ')}\` returned ${rows.length} beads, at the -n ${BEAD_LIMIT} cap — the read is `
      + 'truncated, and triaging against a partial bead list re-files work that is already tracked. '
      + 'Raise BEAD_LIMIT and re-run.',
    );
  }
  for (const row of rows as BeadRow[]) {
    if (!optionalString(row.id)) {
      throw new Error(`\`bd ${args.join(' ')}\` returned a bead with no id: ${JSON.stringify(row).slice(0, 200)}`);
    }
  }
  return rows as BeadRow[];
}

/** One row of `gh pr list --json number,title,headRefName,state,author`. */
interface GhPrRow {
  number: number;
  title?: string;
  headRefName?: string;
  state?: string;
  author?: { login?: string; is_bot?: boolean };
}

/**
 * Open Renovate PRs, forwarded whole.
 *
 * `--author app/renovate` is a filter, not a guarantee: the trust check that
 * decides whether a PR may suppress a security finding lives in `computeDelta`,
 * where it is unit-tested, so `state` and the author's login and bot flag are
 * carried through rather than dropped once the flag has been passed.
 */
function fetchRenovatePrs(): RenovatePr[] {
  const args = [
    'pr', 'list',
    '--author', 'app/renovate',
    '--state', 'open',
    '--json', 'number,title,headRefName,state,author',
  ];
  const rows = captureJson<GhPrRow[]>('gh', args);
  if (!Array.isArray(rows)) {
    throw new Error(`\`gh ${args.join(' ')}\` returned ${typeof rows}, expected an array of pull requests`);
  }

  return rows.map(row => ({
    number: row.number,
    title: row.title ?? '',
    headRefName: row.headRefName ?? '',
    state: row.state ?? '',
    author: row.author?.login,
    authorIsBot: row.author?.is_bot,
  }));
}

interface GhRunRow {
  databaseId?: number;
  headSha?: string;
  url?: string;
  createdAt?: string;
}

interface Scan {
  reports: ReportInput[];
  metadata: DeltaMetadata;
}

/** Every expected scan, marked failed for one shared reason. */
function scanFailure(reason: string): ReportInput[] {
  return SCAN_FILES.map(([label]) => ({ label, json: null, error: reason }));
}

/**
 * Download the newest successful weekly scan.
 *
 * Every failure here is *represented* rather than thrown: no successful run, an
 * expired artifact, and an unreadable report all become per-scan errors, so the
 * delta says "the scan did not happen" — which suppresses resolution — instead
 * of an empty delta that reads as "nothing was found".
 */
function fetchScan(dir: string): Scan {
  let run: GhRunRow | undefined;
  try {
    const runs = captureJson<GhRunRow[]>('gh', [
      'run', 'list',
      '--workflow', HEALTH_WORKFLOW,
      '--status', 'success',
      '--limit', '1',
      '--json', 'databaseId,headSha,url,createdAt',
    ]);
    run = Array.isArray(runs) ? runs[0] : undefined;
  }
  catch (err) {
    return { reports: scanFailure(`could not list ${HEALTH_WORKFLOW} runs (${(err as Error).message})`), metadata: {} };
  }

  if (!run?.databaseId) {
    return { reports: scanFailure(`no successful ${HEALTH_WORKFLOW} run to triage`), metadata: {} };
  }

  const metadata: DeltaMetadata = {
    sha: run.headSha,
    runUrl: run.url,
    scanDate: run.createdAt?.slice(0, 10),
  };

  try {
    capture('gh', ['run', 'download', String(run.databaseId), '-n', SCAN_ARTIFACT, '-D', dir]);
  }
  catch (err) {
    return {
      reports: scanFailure(
        `could not download the ${SCAN_ARTIFACT} artifact from run ${run.databaseId} — `
        + `artifacts expire after 30 days (${(err as Error).message})`,
      ),
      metadata,
    };
  }

  const reports = readReports(SCAN_FILES.map(([label, file]) => `${label}=${path.join(dir, file)}`));
  return { reports: checkReportUsability(reports), metadata };
}

/** The open rolling health-report issue the agent comments its summary on. */
function fetchHealthReportIssue(): number | undefined {
  const rows = captureJson<{ number?: number }[]>('gh', [
    'issue', 'list',
    '--label', HEALTH_REPORT_LABEL,
    '--state', 'open',
    '--limit', '1',
    '--json', 'number',
  ]);
  return Array.isArray(rows) ? rows[0]?.number : undefined;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) {
      process.stderr.write('usage: triage-delta.ts [--out FILE]\n');
      return 1;
    }
    flags[argv[i].slice(2)] = argv[++i] ?? '';
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-health-'));
  let delta: Delta;
  try {
    const scan = fetchScan(dir);
    delta = computeDelta({
      reports: scan.reports,
      expectedScans: EXPECTED_SCANS,
      // All statuses: `computeDelta` keeps only the open ones, and a closed
      // bead deliberately does not suppress a CVE that came back.
      cveBeads: listBeads(['--label', 'cve', '--all']).map(row => ({
        id: String(row.id),
        title: optionalString(row.title),
        status: optionalString(row.status),
        notes: optionalString(row.notes),
      })),
      // Open only, and passed through however many there are: zero is a valid
      // first run and more than one is an abort, both decided by the core.
      watchBeads: listBeads(['--label', 'cve-watch']).map(row => ({
        id: String(row.id),
        design: optionalString(row.design),
      })),
      renovatePrs: fetchRenovatePrs(),
      metadata: { ...scan.metadata, healthReportIssue: fetchHealthReportIssue() },
    });
  }
  finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const json = JSON.stringify(delta, null, 2) + '\n';
  if (flags.out) fs.writeFileSync(flags.out, json);
  else process.stdout.write(json);

  // Findings are the output, not the exit status: a delta full of new CVEs is a
  // successful run. Non-zero is reserved for a failure the delta cannot carry —
  // unreadable bead state, or a watch list split across several beads.
  return 0;
}

// Run only when invoked directly (not when imported by the test).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exit(main());
  }
  catch (err) {
    process.stderr.write(`triage-delta: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
