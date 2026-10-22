/**
 * Deterministic plumbing for /upgrade-dependencies (.agents/commands/upgrade-dependencies.md).
 *
 * The command makes two kinds of judgment — which majors are coupled, and
 * whether a red bump is a translation or a redesign — and leaves everything
 * else here: reading the Renovate Dependency Dashboard, ticking exactly one
 * checkbox, classifying open major PRs from their commits and CI, ordering the
 * admission queue, and appending the migration section to a PR body.
 *
 * Pure functions take parsed data; the I/O wrappers take an injectable
 * `spawnFn`. Commands are spawned without a shell so package names and
 * fixed-string patterns pass through verbatim.
 */

import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnDeps, SpawnFn } from './shared.js';

export const DASHBOARD_ISSUE = 561;
export const TRAILER = 'Migrated-by: upgrade-dependencies';
export const MIGRATION_HEADING = '## Migration made on your behalf';
/** Label that marks an escalated PR so later runs do not re-judge it. */
export const ESCALATION_LABEL = 'needs-human';
export const RENOVATE_LOGIN = 'renovate-bot';

/** Dashboard checkboxes this command must never tick. */
const FORBIDDEN_KEYS = ['approve-all-pending-prs', 'create-all-rate-limited-prs'];

// =============================================================================
// Process helper
// =============================================================================

function exec(
  cmd: string,
  args: string[],
  spawn: SpawnFn,
  opts: { cwd?: string; timeout?: number } = {},
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawn(cmd, args, {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: opts.timeout ?? 120_000,
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  return {
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? '').trim(),
    exitCode: result.status ?? 1,
  };
}

function execJson<T>(cmd: string, args: string[], spawn: SpawnFn): T {
  const r = exec(cmd, args, spawn);
  if (r.exitCode !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  }
  return JSON.parse(r.stdout) as T;
}

// =============================================================================
// Dashboard
// =============================================================================

export interface PendingItem {
  key: string;
  title: string;
  checked: boolean;
}

const APPROVE_LINE = /^\s*- \[( |x)\] <!-- approve-branch=(\S+) -->(.*)$/;

/** The checkboxes in the dashboard's "Pending Approval" section, in order. */
export function parsePendingApproval(body: string): PendingItem[] {
  const start = body.indexOf('## Pending Approval');
  if (start === -1) return [];
  const next = body.indexOf('\n## ', start + 1);
  const section = body.slice(start, next === -1 ? undefined : next);
  const items: PendingItem[] = [];
  for (const line of section.split('\n')) {
    const m = APPROVE_LINE.exec(line);
    if (m) items.push({ key: m[2], title: m[3].trim(), checked: m[1] === 'x' });
  }
  return items;
}

/**
 * Tick one approve-branch checkbox and change nothing else. Throws unless the
 * unticked checkbox for `key` occurs exactly once.
 */
export function tickPendingApproval(body: string, key: string): string {
  if (FORBIDDEN_KEYS.includes(key) || !key.startsWith('renovate/')) {
    throw new Error(`refusing to tick ${key}: only renovate/* approve-branch keys may be ticked`);
  }
  const unticked = `- [ ] <!-- approve-branch=${key} -->`;
  const count = body.split(unticked).length - 1;
  if (count !== 1) {
    const ticked = body.includes(`- [x] <!-- approve-branch=${key} -->`);
    throw new Error(ticked
      ? `${key} is already ticked`
      : `expected exactly one unticked checkbox for ${key}, found ${count}`);
  }
  return body.replace(unticked, `- [x] <!-- approve-branch=${key} -->`);
}

export interface ParsedTitle {
  packages: string[];
  targetMajor: number | null;
  /** What the title itself says about the datasource, if anything. */
  hint: 'action' | 'docker' | null;
}

/** Package names, target major and datasource hint from a dashboard title. */
export function parseUpdateTitle(title: string): ParsedTitle {
  const backticks = [...title.matchAll(/`([^`]+)`/g)].map(m => m[1]);
  const m = /update (?:dependency )?(\S+)(?: (action|docker tag|monorepo))? to v(\d+)(?![.\d])/.exec(title);
  const hint = m?.[2] === 'action' || / actions \(major\)/.test(title)
    ? 'action'
    : m?.[2] === 'docker tag' ? 'docker' : null;
  const packages = backticks.length > 0 ? backticks : m && m[2] !== 'monorepo' ? [m[1]] : [];
  return { packages, targetMajor: m ? Number(m[3]) : null, hint };
}

/**
 * Every major the dashboard knows about: Pending Approval checkboxes, ticked
 * or not, plus major PRs listed as open. The open list lags merges, which is
 * harmless here — a merged major is already in package.json.
 */
export function dashboardMajors(body: string): { key: string; packages: string[]; targetMajor: number | null }[] {
  const majors: { key: string; packages: string[]; targetMajor: number | null }[] = [];
  for (const line of body.split('\n')) {
    const m = /<!-- (approve|rebase)-branch=(\S+) -->(.*)$/.exec(line);
    if (!m) continue;
    const title = m[1] === 'rebase' ? /^\[(.*)\]\(/.exec(m[3])?.[1] ?? '' : m[3];
    if (m[1] === 'rebase' && !isMajorTitle(title)) continue;
    const parsed = parseUpdateTitle(m[3]);
    majors.push({ key: m[2], packages: parsed.packages, targetMajor: parsed.targetMajor });
  }
  return majors;
}

/** True for a Renovate PR title that proposes a major bump. */
export function isMajorTitle(title: string): boolean {
  const t = title.replace(/\s*\[security\]\s*$/, '').trim();
  return /\bto v\d+$/.test(t) || /\(major\)$/.test(t);
}

// =============================================================================
// Admission order
// =============================================================================

export type PackageSource = 'runtime' | 'dev' | 'types' | 'action' | 'docker' | 'unknown';

export interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function packageSource(
  name: string,
  manifest: Manifest,
  workflowActions: Set<string>,
  hint: ParsedTitle['hint'],
): PackageSource {
  if (name.startsWith('@types/')) return 'types';
  if (manifest.dependencies?.[name]) return 'runtime';
  if (manifest.devDependencies?.[name]) return 'dev';
  if (hint === 'action' || workflowActions.has(name)) return 'action';
  if (hint === 'docker') return 'docker';
  return 'unknown';
}

/**
 * True when the manifest already asks for the target major of every npm
 * package in the item — the dashboard lags a bump made by hand, and ticking
 * the box would only make Renovate discard it.
 */
export function alreadyAtMajor(packages: string[], targetMajor: number | null, manifest: Manifest): boolean {
  if (targetMajor === null || packages.length === 0) return false;
  return packages.every(name => (manifestMajor(name, manifest) ?? -1) >= targetMajor);
}

/** The major a package.json range asks for, or null when the package is absent. */
export function manifestMajor(name: string, manifest: Manifest): number | null {
  const range = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
  const major = range ? /(\d+)/.exec(range) : null;
  return major ? Number(major[1]) : null;
}

/**
 * 1 = development tooling with no runtime footprint; 2 = runtime library with
 * narrow surface (at most two importing files); 3 = everything else. An
 * unrecognised package is treated as broad surface.
 */
export function tierFor(sources: PackageSource[], importFiles: number): 1 | 2 | 3 {
  if (sources.length === 0 || sources.includes('unknown')) return 3;
  if (sources.every(s => s !== 'runtime')) return 1;
  return importFiles <= 2 ? 2 : 3;
}

export interface Candidate extends PendingItem {
  index: number;
  packages: { name: string; source: PackageSource }[];
  targetMajor: number | null;
  tier: 1 | 2 | 3;
  importFiles: number;
  /** First stable release of the target major, when it could be looked up. */
  releasedAt: string | null;
  /**
   * Coupled candidates: this one's target major demands them as a peer at a
   * major the project does not have, and the installed version of this one
   * refuses their target major — neither branch can go green alone. This
   * candidate is the primary; the migration bumps them inside its branch.
   */
  demands: string[];
  /**
   * Dashboard items this one's target major demands, where the demanded
   * package can go green alone (or is already ticked or open). This one
   * waits until they merge.
   */
  waitsFor: string[];
}

/**
 * Whether a semver range admits some version of `major`. Judged at major
 * granularity only, which is the question coupling asks; an unparseable
 * comparator is treated as admitting, so it never invents a coupling.
 */
export function rangeAdmitsMajor(range: string, major: number): boolean {
  return range.split('||').some((alt) => {
    const comps = alt.trim().split(/\s+/).filter(Boolean);
    if (comps.length === 3 && comps[1] === '-') {
      const lo = Number(/\d+/.exec(comps[0])?.[0] ?? 0);
      const hi = Number(/\d+/.exec(comps[2])?.[0] ?? Infinity);
      return major >= lo && major <= hi;
    }
    return comps.every(c => comparatorAdmitsMajor(c, major));
  });
}

function comparatorAdmitsMajor(comparator: string, major: number): boolean {
  const m = /^(>=|<=|>|<|\^|~|=)?v?(\d+|x|X|\*)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?/.exec(comparator);
  if (!m || !/^\d+$/.test(m[2])) return true;
  const n = Number(m[2]);
  const belowMajorNonZero = Number(m[3] ?? 0) > 0 || Number(m[4] ?? 0) > 0;
  switch (m[1]) {
    case '>=': return major >= n;
    case '>': return m[3] !== undefined ? major >= n : major > n;
    case '<=': return major <= n;
    case '<': return belowMajorNonZero ? major <= n : major < n;
    default: return major === n;
  }
}

export interface DemandContext {
  manifest: Manifest;
  majors: ReturnType<typeof dashboardMajors>;
  /** Keys of unticked candidates. */
  candidateKeys: Set<string>;
}

/**
 * How a candidate's new peer requirement constrains admission. `null` when
 * the installed peer already satisfies it, or no dashboard item delivers a
 * major that does (the migration bumps it in-branch as a translation).
 * `installedPeerRange` is the candidate's *installed* version's range for
 * the same peer: when it refuses the peer's target major the two are
 * mutually coupled and fold into one branch; otherwise the peer can go green
 * alone and this candidate waits for it.
 */
export function classifyDemand(
  key: string,
  peer: string,
  range: string,
  installedPeerRange: string | undefined,
  ctx: DemandContext,
): { kind: 'fold' | 'wait'; key: string } | null {
  const installed = manifestMajor(peer, ctx.manifest);
  if (installed === null || rangeAdmitsMajor(range, installed)) return null;
  const owner = ctx.majors.find(m => m.key !== key && m.packages.includes(peer)
    && (m.targetMajor === null || rangeAdmitsMajor(range, m.targetMajor)));
  if (!owner) return null;
  const mutual = ctx.candidateKeys.has(owner.key)
    && installedPeerRange !== undefined
    && owner.targetMajor !== null
    && !rangeAdmitsMajor(installedPeerRange, owner.targetMajor);
  return { kind: mutual ? 'fold' : 'wait', key: owner.key };
}

/** The newest entry from `npm view <pkg>@<major> peerDependencies --json`. */
export function newestPeers(stdout: string): Record<string, string> {
  if (!stdout.trim()) return {};
  const parsed = JSON.parse(stdout) as Record<string, string> | Record<string, string>[];
  return Array.isArray(parsed) ? parsed[parsed.length - 1] ?? {} : parsed;
}

export interface Admission {
  /** The checkbox to tick: the primary of a coupled set. */
  key: string;
  /** Coupled keys the migration bumps inside the primary's branch; never ticked. */
  peers: string[];
}

/**
 * Walk candidates in admission order, folding coupled pairs into one entry:
 * reaching a peer admits its primary instead, and each key appears once.
 * A candidate that waits on another item is left out.
 */
export function admissionQueue(ordered: Candidate[]): Admission[] {
  const queue: Admission[] = [];
  const seen = new Set<string>();
  for (const c of ordered) {
    if (seen.has(c.key) || c.waitsFor.length > 0) continue;
    const primary = ordered.find(p => p.demands.includes(c.key) && !seen.has(p.key) && p.waitsFor.length === 0) ?? c;
    const peers = primary.demands.filter(k => !seen.has(k));
    queue.push({ key: primary.key, peers });
    for (const k of [primary.key, ...peers]) seen.add(k);
  }
  return queue;
}

/** Tier, then oldest release first, then dashboard order for undated items. */
export function admissionOrder(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) =>
    a.tier - b.tier
    || (a.releasedAt ?? '￿').localeCompare(b.releasedAt ?? '￿')
    || a.index - b.index);
}

/** Earliest publish time of `<major>.x.y` (no prerelease) from `npm view time`. */
export function firstStableRelease(times: Record<string, string>, major: number): string | null {
  const dates = Object.entries(times)
    .filter(([v]) => new RegExp(`^${major}\\.\\d+\\.\\d+$`).test(v))
    .map(([, t]) => t)
    .sort();
  return dates[0] ?? null;
}

// =============================================================================
// PR classification
// =============================================================================

export interface CommitFact {
  oid: string;
  authors: { login?: string }[];
  messageHeadline: string;
  messageBody: string;
}

export interface CheckFact {
  __typename?: string;
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string;
  state?: string;
  detailsUrl?: string;
  targetUrl?: string;
}

export type CommitOrigin = 'renovate' | 'command' | 'foreign';

export function commitOrigin(c: CommitFact): CommitOrigin {
  const message = `${c.messageHeadline}\n\n${c.messageBody}`;
  if (new RegExp(`^${TRAILER}$`, 'm').test(message)) return 'command';
  if (c.authors.length > 0 && c.authors.every(a => a.login === RENOVATE_LOGIN)) return 'renovate';
  return 'foreign';
}

const GREEN = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

export interface Rollup {
  state: 'green' | 'red' | 'pending';
  failing: { name: string; runId: number | null }[];
}

export function rollup(checks: CheckFact[]): Rollup {
  if (checks.length === 0) return { state: 'pending', failing: [] };
  let pending = false;
  const failing: Rollup['failing'] = [];
  for (const c of checks) {
    if (c.__typename === 'StatusContext' || c.state !== undefined) {
      if (c.state === 'PENDING' || c.state === 'EXPECTED') pending = true;
      else if (c.state !== 'SUCCESS') failing.push({ name: c.context ?? 'status', runId: null });
      continue;
    }
    if (c.status !== 'COMPLETED') pending = true;
    else if (!GREEN.has(c.conclusion ?? '')) {
      const run = /\/actions\/runs\/(\d+)/.exec(c.detailsUrl ?? '');
      failing.push({ name: c.name ?? 'check', runId: run ? Number(run[1]) : null });
    }
  }
  if (pending) return { state: 'pending', failing };
  return { state: failing.length > 0 ? 'red' : 'green', failing };
}

export type PrKind =
  | 'in-hand'           // a commit that is neither Renovate's nor this command's
  | 'ready'             // all checks green
  | 'pending'           // checks still running
  | 'escalated'         // red and labelled by an earlier escalation
  | 'rerun'             // red, re-run not yet spent on this head commit
  | 'gate-2'            // red after re-run, Renovate's bump alone
  | 'migration-failed'; // red after re-run, this command's migration on it

export interface PrFacts {
  labels: string[];
  commits: CommitFact[];
  checks: CheckFact[];
  /** Attempt number of each failing workflow run, keyed by run id. */
  attempts: Record<number, number>;
}

export interface Classification {
  kind: PrKind;
  migrated: boolean;
  failing: string[];
  rerunRunIds: number[];
}

export function classifyPr(facts: PrFacts): Classification {
  const origins = facts.commits.map(commitOrigin);
  const migrated = origins.includes('command');
  const r = rollup(facts.checks);
  const failing = r.failing.map(f => f.name);
  const base = { migrated, failing, rerunRunIds: [] as number[] };

  if (origins.includes('foreign')) return { ...base, kind: 'in-hand' };
  if (r.state === 'green') return { ...base, kind: 'ready' };
  if (facts.labels.includes(ESCALATION_LABEL)) return { ...base, kind: 'escalated' };
  if (r.state === 'pending') return { ...base, kind: 'pending' };

  const runIds = [...new Set(r.failing.map(f => f.runId).filter((id): id is number => id !== null))];
  const rerunSpent = runIds.some(id => (facts.attempts[id] ?? 1) >= 2);
  if (!rerunSpent && runIds.length > 0) return { ...base, kind: 'rerun', rerunRunIds: runIds };
  return { ...base, kind: migrated ? 'migration-failed' : 'gate-2' };
}

// =============================================================================
// PR annotation
// =============================================================================

/**
 * Append (or replace) the migration section, keeping Renovate's body intact.
 */
export function annotateBody(body: string, ruling: string, files: string[]): string {
  const at = body.indexOf(MIGRATION_HEADING);
  const kept = (at === -1 ? body : body.slice(0, at)).trimEnd();
  const fileList = files.map(f => `- \`${f}\``).join('\n');
  return `${kept}\n\n${MIGRATION_HEADING}\n\n${ruling.trim()}\n\n### Files changed\n\n${fileList}\n`;
}

// =============================================================================
// I/O wrappers
// =============================================================================

export function readDashboard(deps: SpawnDeps = {}): string {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  return execJson<{ body: string }>('gh', ['issue', 'view', String(DASHBOARD_ISSUE), '--json', 'body'], spawn).body;
}

function withTempFile<T>(content: string, fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'upgrade-dependencies-'));
  const path = join(dir, 'body.md');
  writeFileSync(path, content);
  try {
    return fn(path);
  }
  finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function tick(key: string, deps: SpawnDeps = {}): void {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const updated = tickPendingApproval(readDashboard(deps), key);
  const r = withTempFile(updated, path =>
    exec('gh', ['issue', 'edit', String(DASHBOARD_ISSUE), '--body-file', path], spawn));
  if (r.exitCode !== 0) throw new Error(`gh issue edit failed: ${r.stderr}`);
}

function installedPeerDependencies(name: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join('node_modules', name, 'package.json'), 'utf-8')) as { peerDependencies?: Record<string, string> };
    return pkg.peerDependencies ?? {};
  }
  catch {
    return {};
  }
}

function workflowActions(spawn: SpawnFn): Set<string> {
  const r = exec('git', ['grep', '-h', '-o', '-E', 'uses: [^@ ]+@', '--', '.github/workflows'], spawn);
  return new Set(r.stdout.split('\n').map(l => l.replace(/^uses: /, '').replace(/@$/, '')).filter(Boolean));
}

/** Files under src/ and scripts/ that import or require `name`. */
export function countImportFiles(name: string, deps: SpawnDeps = {}): number {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const patterns = [`'${name}'`, `'${name}/`, `"${name}"`, `"${name}/`]
    .flatMap(p => ['-e', `from ${p}`, '-e', `import(${p}`, '-e', `require(${p}`]);
  const r = exec('git', ['grep', '-l', '-F', ...patterns, '--', 'src', 'scripts'], spawn);
  return r.exitCode === 0 ? r.stdout.split('\n').filter(Boolean).length : 0;
}

function releasedAt(
  pkg: { name: string; source: PackageSource },
  major: number,
  spawn: SpawnFn,
): string | null {
  if (pkg.source === 'action') {
    const r = exec('gh', ['api', `repos/${pkg.name}/releases/tags/v${major}.0.0`], spawn);
    if (r.exitCode !== 0) return null;
    return (JSON.parse(r.stdout) as { published_at?: string }).published_at ?? null;
  }
  if (pkg.source === 'docker' || pkg.source === 'unknown') return null;
  const r = exec('npm', ['view', pkg.name, 'time', '--json'], spawn);
  if (r.exitCode !== 0) return null;
  return firstStableRelease(JSON.parse(r.stdout) as Record<string, string>, major);
}

export interface DashboardReport {
  /** What to tick, in order, with coupled pairs folded into their primary. */
  queue: Admission[];
  /** Unticked majors, in admission order, with tier and coupling detail. */
  candidates: Candidate[];
  /** Ticked by an earlier run; Renovate has not opened the PR yet. */
  awaitingRenovate: PendingItem[];
  /** Unticked, but package.json is already on the target major. */
  alreadyApplied: PendingItem[];
}

export function dashboard(deps: SpawnDeps = {}): DashboardReport {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const body = readDashboard(deps);
  const items = parsePendingApproval(body);
  const manifest = JSON.parse(readFileSync('package.json', 'utf-8')) as Manifest;
  const actions = workflowActions(spawn);

  const alreadyApplied: PendingItem[] = [];
  const candidates = items.flatMap((item, index): Candidate[] => {
    if (item.checked) return [];
    const parsed = parseUpdateTitle(item.title);
    if (alreadyAtMajor(parsed.packages, parsed.targetMajor, manifest)) {
      alreadyApplied.push(item);
      return [];
    }
    const packages = parsed.packages.map(name => ({
      name,
      source: packageSource(name, manifest, actions, parsed.hint),
    }));
    const importFiles = packages
      .filter(p => p.source === 'runtime')
      .reduce((sum, p) => sum + countImportFiles(p.name, deps), 0);
    const tier = tierFor(packages.map(p => p.source), importFiles);
    const first = packages.find(p => p.source !== 'types') ?? packages[0];
    return [{
      ...item,
      index,
      packages,
      targetMajor: parsed.targetMajor,
      tier,
      importFiles,
      releasedAt: first && parsed.targetMajor !== null ? releasedAt(first, parsed.targetMajor, spawn) : null,
      demands: [],
      waitsFor: [],
    }];
  });

  const ctx: DemandContext = { manifest, majors: dashboardMajors(body), candidateKeys: new Set(candidates.map(c => c.key)) };
  for (const c of candidates) {
    if (c.targetMajor === null) continue;
    for (const pkg of c.packages.filter(p => p.source === 'runtime' || p.source === 'dev')) {
      const r = exec('npm', ['view', `${pkg.name}@${c.targetMajor}`, 'peerDependencies', '--json'], spawn);
      if (r.exitCode !== 0) continue;
      const installedPeers = installedPeerDependencies(pkg.name);
      for (const [peer, range] of Object.entries(newestPeers(r.stdout))) {
        const demand = classifyDemand(c.key, peer, range, installedPeers[peer], ctx);
        const list = demand?.kind === 'fold' ? c.demands : c.waitsFor;
        if (demand && !list.includes(demand.key)) list.push(demand.key);
      }
    }
  }

  const ordered = admissionOrder(candidates);
  return {
    queue: admissionQueue(ordered),
    candidates: ordered,
    awaitingRenovate: items.filter(i => i.checked),
    alreadyApplied,
  };
}

export interface PrReport extends Classification {
  number: number;
  title: string;
  branch: string;
  headSha: string;
  createdAt: string;
  labels: string[];
}

interface PrListItem {
  number: number;
  title: string;
  headRefName: string;
  createdAt: string;
  labels: { name: string }[];
}

/** Every open major Renovate PR not labelled `security`, classified. */
export function prs(deps: SpawnDeps = {}): PrReport[] {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const open = execJson<PrListItem[]>('gh', [
    'pr', 'list', '--state', 'open', '--limit', '200',
    '--json', 'number,title,headRefName,createdAt,labels',
  ], spawn);

  return open
    .filter(pr => pr.headRefName.startsWith('renovate/') && isMajorTitle(pr.title))
    .filter(pr => !pr.labels.some(l => l.name === 'security'))
    .map(pr => {
      const view = execJson<{ headRefOid: string; commits: CommitFact[]; statusCheckRollup: CheckFact[] }>('gh', [
        'pr', 'view', String(pr.number), '--json', 'headRefOid,commits,statusCheckRollup',
      ], spawn);
      const labels = pr.labels.map(l => l.name);
      const attempts: Record<number, number> = {};
      for (const f of rollup(view.statusCheckRollup).failing) {
        if (f.runId === null || f.runId in attempts) continue;
        const run = exec('gh', ['run', 'view', String(f.runId), '--json', 'attempt'], spawn);
        attempts[f.runId] = run.exitCode === 0 ? (JSON.parse(run.stdout) as { attempt: number }).attempt : 1;
      }
      return {
        number: pr.number,
        title: pr.title,
        branch: pr.headRefName,
        headSha: view.headRefOid,
        createdAt: pr.createdAt,
        labels,
        ...classifyPr({ labels, commits: view.commits, checks: view.statusCheckRollup, attempts }),
      };
    });
}

export function annotate(pr: number, rulingFile: string, files: string[], deps: SpawnDeps = {}): void {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const { body } = execJson<{ body: string }>('gh', ['pr', 'view', String(pr), '--json', 'body'], spawn);
  const updated = annotateBody(body, readFileSync(rulingFile, 'utf-8'), files);
  const r = withTempFile(updated, path =>
    exec('gh', ['pr', 'edit', String(pr), '--body-file', path], spawn));
  if (r.exitCode !== 0) throw new Error(`gh pr edit failed: ${r.stderr}`);
}

export interface ClockDeps extends SpawnDeps {
  now?: () => number;
  sleep?: (ms: number) => void;
}

function blockingSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface RenovateRun {
  runId: number | null;
  status: string | null;
  conclusion: string | null;
  timedOut: boolean;
}

/**
 * Dispatch the Renovate workflow and block until that run completes or
 * `timeoutMs` passes. A run counts as ours when it was created no earlier
 * than a minute before the dispatch, which absorbs clock skew with GitHub.
 */
export function triggerRenovate(timeoutMs: number, deps: ClockDeps = {}): RenovateRun {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? blockingSleep;

  const dispatchedAt = now();
  const r = exec('gh', ['workflow', 'run', 'renovate.yaml'], spawn);
  if (r.exitCode !== 0) throw new Error(`gh workflow run failed: ${r.stderr}`);

  let last: RenovateRun = { runId: null, status: null, conclusion: null, timedOut: false };
  while (now() - dispatchedAt < timeoutMs) {
    const runs = execJson<{ databaseId: number; createdAt: string; status: string; conclusion: string }[]>('gh', [
      'run', 'list', '--workflow', 'renovate.yaml', '--event', 'workflow_dispatch', '--limit', '5',
      '--json', 'databaseId,createdAt,status,conclusion',
    ], spawn);
    const ours = runs.find(run => Date.parse(run.createdAt) >= dispatchedAt - 60_000);
    if (ours) {
      last = { runId: ours.databaseId, status: ours.status, conclusion: ours.conclusion || null, timedOut: false };
      if (ours.status === 'completed') return last;
    }
    sleep(30_000);
  }
  return { ...last, timedOut: true };
}

export interface Worktree {
  path: string;
  branch: string;
  /** Branch head at checkout: where a stopped migration resets to. */
  resetSha: string;
}

/**
 * Check `branch` out in the command's own worktree (created on first use)
 * and install its lockfile there, leaving the launch checkout untouched.
 */
export function prepareWorktree(branch: string, deps: SpawnDeps = {}): Worktree {
  const spawn = deps.spawnFn ?? nodeSpawnSync;
  if (!branch.startsWith('renovate/')) throw new Error(`refusing ${branch}: only renovate/* branches`);

  const git = (args: string[], cwd?: string) => {
    const r = exec('git', args, spawn, { cwd });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout;
  };

  const path = join(git(['rev-parse', '--show-toplevel']), '.agents', 'worktrees', 'upgrade-dependencies');
  const listed = git(['worktree', 'list', '--porcelain']).split('\n').includes(`worktree ${path}`);
  if (!listed) git(['worktree', 'add', '--detach', path, 'origin/main']);

  git(['fetch', 'origin'], path);
  git(['checkout', '-B', branch, `origin/${branch}`], path);
  git(['clean', '-fd'], path);
  const resetSha = git(['rev-parse', 'HEAD'], path);

  // Under the Bash tool's 10-minute ceiling, so a slow install fails here with a message.
  const install = exec('npm', ['ci'], spawn, { cwd: path, timeout: 540_000 });
  if (install.exitCode !== 0) throw new Error(`npm ci failed in ${path}: ${install.stderr.slice(-2000)}`);
  return { path, branch, resetSha };
}
