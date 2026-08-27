/**
 * coverage-summary.ts — turn per-tier Vitest coverage reports into one markdown
 * worklist of what is untested.
 *
 * Consumed by .github/workflows/coverage.weekly.yaml: the weekly job runs the
 * unit and integration suites with V8 coverage, each writing its own
 * `coverage-summary.json`, and this script renders them into the body of the
 * rolling `coverage-report` issue.
 *
 * Design mirrors scripts/trivy-summary.ts:
 *   - Pure `summarize()` / `renderMarkdown()` split from a thin `main()` that
 *     does the IO, so both the aggregation and the CLI seam are unit-tested.
 *   - No new dependencies: istanbul-shaped JSON read with JSON.parse, output is
 *     hand-rolled markdown.
 *   - A tier whose run produced no report is announced as an error rather than
 *     read as a result — here that means it must not drag every file into the
 *     untested list.
 *
 * Reporting contract:
 *   - The tiers stay in SEPARATE columns. A line covered by a unit test and a
 *     line covered by an integration test answer different questions — one says
 *     the logic has an isolated test, the other says the code is reachable
 *     through a real DB/HTTP path — so blending them into a single percentage
 *     would hide the interesting cases (logic tested, wiring not; or the
 *     reverse).
 *   - Section 1 is files with no coverage in ANY tier, ranked by uncovered
 *     lines: the genuine gaps.
 *   - Section 2 is files that are covered somewhere but miss the tier their
 *     area is expected to have (see EXPECTATION_RULES).
 *   - Section 3 is a per-area rollup for context.
 *
 * Known approximation: `coverage-summary.json` carries per-file totals, not
 * per-line hit maps, so the union of two tiers cannot be computed exactly. A
 * file's covered-line count is taken as the MAX across tiers, which understates
 * coverage when the tiers cover disjoint lines. A true union would mean reading
 * the much larger `coverage-final.json`; for a gap list, ranking by the max is
 * enough, and it errs toward listing a file rather than hiding it.
 *
 * Usage:
 *   tsx scripts/coverage-summary.ts unit=<summary.json> integration=<summary.json>
 *       [--root DIR] [--out FILE] [--json-out FILE] [--sha SHA] [--run-url URL]
 *
 * Always exits 0 when it ran: gaps are reported through the issue, not the exit
 * code. When GITHUB_OUTPUT is set, appends `untested=`, `actionable=`,
 * `run_errors=` and `fingerprint=` so the workflow can decide whether this
 * week's report is worth a notification.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Test tiers measured separately. Order fixes the report's column order. */
export const TIERS = ['unit', 'integration'] as const;
export type Tier = typeof TIERS[number];

/**
 * Which tier each area is expected to be covered by. First match wins.
 *
 * Server API routes are wiring: serialization, auth middleware, query paths.
 * Unit tests around a route handler mock exactly the parts that break, so an
 * integration test is what makes a route trustworthy. Everything else is logic
 * that should have an isolated test.
 */
const EXPECTATION_RULES: { pattern: RegExp; tier: Tier }[] = [
  { pattern: /^src\/server\/[^/]+\/api\//, tier: 'integration' },
  { pattern: /^src\/server\/api\//, tier: 'integration' },
];

/** Tier coverage below this percentage counts as missing that tier. */
const EXPECTATION_THRESHOLD = 50;

/** Rows listed per section before the report collapses the tail into a count. */
const TOP_N = 25;

export interface TierCoverage {
  pct: number;
  covered: number;
  total: number;
}

export interface FileGap {
  file: string;
  area: string;
  expected: Tier;
  unit: TierCoverage | null;
  integration: TierCoverage | null;
  totalLines: number;
  /** Lines covered by no tier, using the max-across-tiers approximation. */
  uncoveredLines: number;
  /** Lines the expected tier does not cover; the whole file when it did not run. */
  expectedUncovered: number;
}

export interface AreaRollup {
  area: string;
  files: number;
  unit: TierCoverage | null;
  integration: TierCoverage | null;
  totalLines: number;
  uncoveredLines: number;
}

export interface Summary {
  /** Tiers that actually produced a report. */
  available: Tier[];
  errors: string[];
  files: FileGap[];
  /** Section 1: no coverage in any tier. Empty when a tier did not run. */
  untested: FileGap[];
  /** Section 2: covered somewhere, but not by the tier this area expects. */
  misses: FileGap[];
  areas: AreaRollup[];
  actionable: number;
  /** Stable hash of the actionable file set, used to suppress repeat pings. */
  fingerprint: string;
}

export interface TierInput {
  tier: Tier;
  /** Parsed coverage-summary.json, or null when the file was missing/unreadable. */
  json: unknown;
  error?: string;
}

/** The tier an area is expected to be covered by. */
export function expectedTierFor(file: string): Tier {
  return EXPECTATION_RULES.find(rule => rule.pattern.test(file))?.tier ?? 'unit';
}

/** Rollup group: one per backend domain, one per frontend app. */
export function areaOf(file: string): string {
  const parts = file.split('/');
  if (parts[0] !== 'src') return parts[0] ?? 'unknown';
  if (parts[1] === 'server' && parts.length > 3) return `server/${parts[2]}`;
  return parts[1] ?? 'unknown';
}

function relativize(file: string, root: string): string {
  const normalized = file.replace(/\\/g, '/');
  const base = root.replace(/\\/g, '/').replace(/\/$/, '');
  if (normalized.startsWith(`${base}/`)) return normalized.slice(base.length + 1);
  return path.isAbsolute(normalized) ? path.relative(base, normalized).replace(/\\/g, '/') : normalized;
}

function lineMetric(entry: unknown): { covered: number; total: number } | null {
  const lines = (entry as Record<string, unknown> | null)?.lines as Record<string, unknown> | undefined;
  if (!lines) return null;
  const total = Number(lines.total);
  const covered = Number(lines.covered);
  if (!Number.isFinite(total) || !Number.isFinite(covered)) return null;
  return { total, covered };
}

function tierCoverage(covered: number, total: number): TierCoverage {
  return { covered, total, pct: total === 0 ? 100 : (covered / total) * 100 };
}

/**
 * Fold one coverage report per tier into a per-file matrix plus the two
 * prioritized gap sections.
 */
export function summarize(inputs: TierInput[], root: string = process.cwd()): Summary {
  const errors: string[] = [];
  const available: Tier[] = [];
  const perTier = new Map<Tier, Map<string, { covered: number; total: number }>>();

  for (const tier of TIERS) {
    const input = inputs.find(i => i.tier === tier);
    if (!input) continue;
    if (input.error || !input.json) {
      errors.push(input.error ?? `${tier}: no report`);
      continue;
    }

    const files = new Map<string, { covered: number; total: number }>();
    for (const [key, entry] of Object.entries(input.json as Record<string, unknown>)) {
      // `total` is the aggregate row istanbul writes alongside the files.
      if (key === 'total') continue;
      const metric = lineMetric(entry);
      if (!metric) continue;
      files.set(relativize(key, root), metric);
    }
    perTier.set(tier, files);
    available.push(tier);
  }

  const paths = new Set<string>();
  for (const files of perTier.values()) for (const file of files.keys()) paths.add(file);

  const gaps: FileGap[] = [];
  for (const file of [...paths].sort()) {
    const totals = new Map<Tier, TierCoverage>();
    let totalLines = 0;
    for (const tier of available) {
      // A file absent from an available tier's report was never executed by it:
      // `coverage.include` puts every source file in every tier's report, so a
      // gap in the map means zero covered lines, not "unknown".
      const metric = perTier.get(tier)?.get(file) ?? { covered: 0, total: 0 };
      totalLines = Math.max(totalLines, metric.total);
      totals.set(tier, tierCoverage(metric.covered, metric.total));
    }
    // Type-only and re-export files compile to nothing executable; listing them
    // as 0% would bury the real gaps.
    if (totalLines === 0) continue;

    const expected = expectedTierFor(file);
    const expectedCoverage = totals.get(expected) ?? null;
    const maxCovered = Math.max(0, ...[...totals.values()].map(t => t.covered));

    gaps.push({
      file,
      area: areaOf(file),
      expected,
      unit: totals.get('unit') ?? null,
      integration: totals.get('integration') ?? null,
      totalLines,
      uncoveredLines: totalLines - maxCovered,
      expectedUncovered: expectedCoverage ? totalLines - expectedCoverage.covered : totalLines,
    });
  }

  // "No coverage in any tier" is only provable when every tier reported. With a
  // tier missing, such a file falls through to the expectation check instead of
  // being asserted as untested on evidence that was never collected.
  const complete = available.length === TIERS.length;
  const untested = complete
    ? gaps.filter(g => [...TIERS].every(tier => (g[tier]?.covered ?? 0) === 0))
    : [];
  const untestedSet = new Set(untested.map(g => g.file));

  const misses = gaps.filter(g =>
    !untestedSet.has(g.file)
    && available.includes(g.expected)
    && (g[g.expected]?.pct ?? 0) < EXPECTATION_THRESHOLD,
  );

  untested.sort((a, b) => b.uncoveredLines - a.uncoveredLines || a.file.localeCompare(b.file));
  misses.sort((a, b) => b.expectedUncovered - a.expectedUncovered || a.file.localeCompare(b.file));

  const areas = rollUp(gaps, available);
  const fingerprint = crypto
    .createHash('sha256')
    .update([...untested.map(g => `U:${g.file}`), ...misses.map(g => `M:${g.file}`)].join('\n'))
    .digest('hex')
    .slice(0, 12);

  return {
    available,
    errors,
    files: gaps,
    untested,
    misses,
    areas,
    actionable: untested.length + misses.length,
    fingerprint,
  };
}

function rollUp(gaps: FileGap[], available: Tier[]): AreaRollup[] {
  const byArea = new Map<string, FileGap[]>();
  for (const gap of gaps) {
    const list = byArea.get(gap.area) ?? [];
    list.push(gap);
    byArea.set(gap.area, list);
  }

  return [...byArea.entries()]
    .map(([area, files]) => {
      const sumTier = (tier: Tier): TierCoverage | null => {
        if (!available.includes(tier)) return null;
        let covered = 0;
        let total = 0;
        for (const file of files) {
          covered += file[tier]?.covered ?? 0;
          total += file[tier]?.total ?? 0;
        }
        return tierCoverage(covered, total);
      };
      return {
        area,
        files: files.length,
        unit: sumTier('unit'),
        integration: sumTier('integration'),
        totalLines: files.reduce((sum, f) => sum + f.totalLines, 0),
        uncoveredLines: files.reduce((sum, f) => sum + f.uncoveredLines, 0),
      };
    })
    .sort((a, b) => b.uncoveredLines - a.uncoveredLines || a.area.localeCompare(b.area));
}

export interface ReportMeta {
  sha?: string;
  runUrl?: string;
  generatedAt?: string;
}

function table(rows: string[][]): string {
  const header = rows[0];
  const divider = header.map(() => '---');
  return [header, divider, ...rows.slice(1)].map(r => `| ${r.join(' | ')} |`).join('\n');
}

function pct(coverage: TierCoverage | null): string {
  return coverage ? `${coverage.pct.toFixed(1)}%` : '—';
}

function truncate<T>(rows: T[]): { shown: T[]; hidden: number } {
  return { shown: rows.slice(0, TOP_N), hidden: Math.max(0, rows.length - TOP_N) };
}

/** Render the markdown body posted to the rolling coverage-report issue. */
export function renderMarkdown(summary: Summary, meta: ReportMeta = {}): string {
  const lines: string[] = ['## Weekly coverage report', ''];

  const provenance: string[] = [];
  if (meta.generatedAt) provenance.push(`Measured ${meta.generatedAt}`);
  if (meta.sha) provenance.push(`commit \`${meta.sha.slice(0, 12)}\``);
  if (meta.runUrl) provenance.push(`[workflow run](${meta.runUrl})`);
  if (provenance.length > 0) lines.push(provenance.join(' · '), '');

  if (summary.errors.length > 0) {
    lines.push('> [!WARNING]', '> Some tiers produced no report — the picture below is incomplete:');
    for (const err of summary.errors) lines.push(`> - ${err}`);
    lines.push('> ', '> Untested files are only listed when every tier reported.', '');
  }

  const untested = truncate(summary.untested);
  lines.push('### Untested files (no coverage in any tier)', '');
  if (summary.untested.length === 0) {
    lines.push(summary.available.length === TIERS.length
      ? 'None.'
      : 'Not computed — a tier is missing.', '');
  }
  else {
    lines.push(table([
      ['File', 'Area', 'Expected tier', 'Lines'],
      ...untested.shown.map(g => [`\`${g.file}\``, g.area, g.expected, String(g.totalLines)]),
    ]), '');
    if (untested.hidden > 0) lines.push(`…and ${untested.hidden} more. Full list in the \`coverage-gaps\` artifact.`, '');
  }

  const misses = truncate(summary.misses);
  lines.push(`### Below expected tier (< ${EXPECTATION_THRESHOLD}% in the tier the area expects)`, '');
  if (summary.misses.length === 0) {
    lines.push('None.', '');
  }
  else {
    lines.push(table([
      ['File', 'Expected tier', 'Unit', 'Integration', 'Uncovered in expected tier'],
      ...misses.shown.map(g => [
        `\`${g.file}\``,
        g.expected,
        pct(g.unit),
        pct(g.integration),
        String(g.expectedUncovered),
      ]),
    ]), '');
    if (misses.hidden > 0) lines.push(`…and ${misses.hidden} more. Full list in the \`coverage-gaps\` artifact.`, '');
  }

  lines.push('### Coverage by area', '', table([
    ['Area', 'Files', 'Unit', 'Integration', 'Uncovered lines'],
    ...summary.areas.map(a => [
      a.area,
      String(a.files),
      pct(a.unit),
      pct(a.integration),
      String(a.uncoveredLines),
    ]),
  ]), '');

  lines.push(
    'Tiers are reported separately on purpose: unit coverage says the logic has an isolated test, integration coverage says the code is reachable through a real DB/HTTP path. A file covered by only one of them is covered against only one class of failure.',
    '',
    `<!-- coverage-fingerprint: ${summary.fingerprint} -->`,
  );
  return lines.join('\n') + '\n';
}

/** Parse `tier=path` CLI pairs into tier inputs, reading each file. */
export function readReports(pairs: string[]): TierInput[] {
  return pairs.map(pair => {
    const separator = pair.indexOf('=');
    const tier = pair.slice(0, separator) as Tier;
    const file = pair.slice(separator + 1);
    try {
      return { tier, json: JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
    catch (err) {
      return { tier, json: null, error: `${tier}: could not read ${file} (${(err as Error).message})` };
    }
  });
}

const USAGE = 'usage: coverage-summary.ts unit=<summary.json> integration=<summary.json>'
  + ' [--root DIR] [--out FILE] [--json-out FILE] [--sha SHA] [--run-url URL]\n';

export function main(argv: string[] = process.argv.slice(2)): number {
  const pairs: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) flags[arg.slice(2)] = argv[++i] ?? '';
    else pairs.push(arg);
  }

  if (pairs.length === 0) {
    process.stderr.write(USAGE);
    return 1;
  }

  const unknown = pairs.filter(p => !(TIERS as readonly string[]).includes(p.slice(0, p.indexOf('='))));
  if (unknown.length > 0) {
    process.stderr.write(`unknown tier label(s): ${unknown.join(', ')}\n${USAGE}`);
    return 1;
  }

  const summary = summarize(readReports(pairs), flags.root || process.cwd());
  const markdown = renderMarkdown(summary, {
    sha: flags.sha,
    runUrl: flags['run-url'],
    generatedAt: flags['generated-at'] || new Date().toISOString().slice(0, 10),
  });

  if (flags.out) fs.writeFileSync(flags.out, markdown);
  else process.stdout.write(markdown);

  if (flags['json-out']) {
    fs.writeFileSync(flags['json-out'], JSON.stringify({
      generatedAt: flags['generated-at'] || new Date().toISOString(),
      sha: flags.sha,
      available: summary.available,
      errors: summary.errors,
      fingerprint: summary.fingerprint,
      untested: summary.untested,
      misses: summary.misses,
      areas: summary.areas,
      files: summary.files,
    }, null, 2));
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `untested=${summary.untested.length}\nmisses=${summary.misses.length}\n`
      + `actionable=${summary.actionable}\nrun_errors=${summary.errors.length}\n`
      + `fingerprint=${summary.fingerprint}\n`,
    );
  }

  // Gaps are reported through the issue, never the exit code; a non-zero exit
  // is reserved for the script itself failing.
  return 0;
}

// Run only when invoked directly (not when imported by the test).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main());
}
