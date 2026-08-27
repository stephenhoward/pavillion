/**
 * trivy-summary.ts — turn Trivy JSON reports into one markdown health report.
 *
 * Consumed by .github/workflows/health.weekly.yaml: the weekly scan writes one
 * JSON file per scan scope (filesystem, container image), this script renders
 * them into a single markdown body, and the workflow posts that body as the
 * rolling `health-report` issue.
 *
 * Design mirrors scripts/check-raw-sql.ts:
 *   - Pure `summarize()` / `renderMarkdown()` split from a thin `main()` that
 *     does the IO, so both the aggregation and the CLI seam are unit-tested.
 *   - No new dependencies: Trivy JSON is read with JSON.parse, output is
 *     hand-rolled markdown.
 *
 * Reporting contract:
 *   - EVERY severity is counted in the summary table (the trend matters).
 *   - Only CRITICAL and HIGH are itemized (the issue must stay actionable).
 *   - A malformed or missing report file is itself reported as a scan error
 *     rather than silently producing a clean-looking report — a scanner that
 *     did not run must never read as "no findings".
 *
 * Usage:
 *   tsx scripts/trivy-summary.ts <label>=<path.json> [...] [--out FILE]
 *                                [--sha SHA] [--run-url URL]
 *
 * Always exits 0: findings are reported through the issue, not the exit code.
 * When GITHUB_OUTPUT is set, appends `total=` and `actionable=` counts so the
 * workflow can decide between updating and closing the issue.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Severities Trivy emits, ordered most to least severe. */
export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type Severity = typeof SEVERITIES[number];

/** Severities itemized in the report body rather than only counted. */
const ACTIONABLE: Severity[] = ['CRITICAL', 'HIGH'];

export interface Finding {
  scan: string;
  kind: 'vulnerability' | 'misconfiguration' | 'secret';
  severity: Severity;
  target: string;
  id: string;
  title: string;
  /** Vulnerabilities only: the package and versions involved. */
  pkg?: string;
  installed?: string;
  fixedVersion?: string;
  url?: string;
}

export interface ScanSummary {
  scan: string;
  counts: Record<Severity, number>;
  error?: string;
}

export interface Summary {
  scans: ScanSummary[];
  findings: Finding[];
  errors: string[];
  total: number;
  actionable: number;
}

export interface ReportInput {
  label: string;
  /** Parsed Trivy JSON, or null when the file was missing/unreadable. */
  json: unknown;
  error?: string;
}

function emptyCounts(): Record<Severity, number> {
  return { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
}

function asSeverity(value: unknown): Severity {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  return (SEVERITIES as readonly string[]).includes(upper) ? upper as Severity : 'UNKNOWN';
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object') : [];
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * Fold one or more parsed Trivy reports into counts plus an itemized list of
 * the actionable findings.
 */
export function summarize(inputs: ReportInput[]): Summary {
  const scans: ScanSummary[] = [];
  const findings: Finding[] = [];
  const errors: string[] = [];
  let total = 0;

  for (const input of inputs) {
    const counts = emptyCounts();

    if (input.error) {
      errors.push(`${input.label}: ${input.error}`);
      scans.push({ scan: input.label, counts, error: input.error });
      continue;
    }

    const root = (input.json ?? {}) as Record<string, unknown>;
    for (const result of asArray(root.Results)) {
      const target = str(result.Target, input.label);

      for (const v of asArray(result.Vulnerabilities)) {
        const severity = asSeverity(v.Severity);
        counts[severity]++;
        total++;
        if (ACTIONABLE.includes(severity)) {
          findings.push({
            scan: input.label,
            kind: 'vulnerability',
            severity,
            target,
            id: str(v.VulnerabilityID, 'unknown'),
            title: str(v.Title, str(v.VulnerabilityID, 'unknown')),
            pkg: str(v.PkgName, 'unknown'),
            installed: str(v.InstalledVersion, 'unknown'),
            fixedVersion: str(v.FixedVersion, 'none'),
            url: str(v.PrimaryURL) || undefined,
          });
        }
      }

      for (const m of asArray(result.Misconfigurations)) {
        const severity = asSeverity(m.Severity);
        counts[severity]++;
        total++;
        if (ACTIONABLE.includes(severity)) {
          findings.push({
            scan: input.label,
            kind: 'misconfiguration',
            severity,
            target,
            id: str(m.ID, 'unknown'),
            title: str(m.Title, str(m.Message, 'unknown')),
            url: str(m.PrimaryURL) || undefined,
          });
        }
      }

      // Secrets carry no severity threshold worth trusting — any hit is worth
      // seeing, so they are always itemized regardless of Trivy's rating.
      for (const s of asArray(result.Secrets)) {
        const severity = asSeverity(s.Severity);
        counts[severity]++;
        total++;
        findings.push({
          scan: input.label,
          kind: 'secret',
          severity,
          target: `${target}:${String(s.StartLine ?? '?')}`,
          id: str(s.RuleID, 'unknown'),
          title: str(s.Title, str(s.Category, 'secret')),
        });
      }
    }

    scans.push({ scan: input.label, counts });
  }

  const order = (f: Finding) => SEVERITIES.indexOf(f.severity);
  findings.sort((a, b) => order(a) - order(b) || a.scan.localeCompare(b.scan) || a.id.localeCompare(b.id));

  return { scans, findings, errors, total, actionable: findings.length };
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

function findingRows(findings: Finding[], kind: Finding['kind']): string[][] | null {
  const subset = findings.filter(f => f.kind === kind);
  if (subset.length === 0) return null;

  if (kind === 'vulnerability') {
    return [
      ['Severity', 'ID', 'Package', 'Installed', 'Fixed in', 'Target'],
      ...subset.map(f => [
        f.severity,
        f.url ? `[${f.id}](${f.url})` : f.id,
        `\`${f.pkg}\``,
        f.installed ?? '',
        f.fixedVersion ?? '',
        `\`${f.target}\``,
      ]),
    ];
  }
  return [
    ['Severity', 'ID', 'Detail', 'Target'],
    ...subset.map(f => [
      f.severity,
      f.url ? `[${f.id}](${f.url})` : f.id,
      f.title,
      `\`${f.target}\``,
    ]),
  ];
}

/** Render the markdown body posted to the rolling health-report issue. */
export function renderMarkdown(summary: Summary, meta: ReportMeta = {}): string {
  const lines: string[] = ['## Weekly health report', ''];

  const provenance: string[] = [];
  if (meta.generatedAt) provenance.push(`Scanned ${meta.generatedAt}`);
  if (meta.sha) provenance.push(`commit \`${meta.sha.slice(0, 12)}\``);
  if (meta.runUrl) provenance.push(`[workflow run](${meta.runUrl})`);
  if (provenance.length > 0) lines.push(provenance.join(' · '), '');

  if (summary.errors.length > 0) {
    lines.push('> [!WARNING]', '> Some scans did not complete — findings below are incomplete:');
    for (const err of summary.errors) lines.push(`> - ${err}`);
    lines.push('');
  }

  lines.push(table([
    ['Scan', ...SEVERITIES.map(s => s[0] + s.slice(1).toLowerCase())],
    ...summary.scans.map(s => [
      s.error ? `${s.scan} (failed)` : s.scan,
      ...SEVERITIES.map(sev => String(s.counts[sev])),
    ]),
  ]), '');

  if (summary.actionable === 0) {
    lines.push(summary.total === 0
      ? 'No findings.'
      : `No CRITICAL or HIGH findings. ${summary.total} lower-severity finding(s) counted above.`);
    return lines.join('\n') + '\n';
  }

  for (const [kind, heading] of [
    ['vulnerability', 'Vulnerabilities (CRITICAL / HIGH)'],
    ['misconfiguration', 'Misconfigurations (CRITICAL / HIGH)'],
    ['secret', 'Secrets'],
  ] as [Finding['kind'], string][]) {
    const rows = findingRows(summary.findings, kind);
    if (!rows) continue;
    lines.push(`### ${heading}`, '', table(rows), '');
  }

  lines.push('Triage: fix, or record the reason it is accepted. Intentional secrets belong in `.trivy/secret.yaml`.');
  return lines.join('\n') + '\n';
}

/** Parse `label=path` CLI pairs into report inputs, reading each file. */
export function readReports(pairs: string[]): ReportInput[] {
  return pairs.map(pair => {
    const separator = pair.indexOf('=');
    const label = separator === -1 ? path.basename(pair, '.json') : pair.slice(0, separator);
    const file = separator === -1 ? pair : pair.slice(separator + 1);
    try {
      return { label, json: JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
    catch (err) {
      return { label, json: null, error: `could not read ${file} (${(err as Error).message})` };
    }
  });
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const pairs: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      flags[arg.slice(2)] = argv[++i] ?? '';
    }
    else {
      pairs.push(arg);
    }
  }

  if (pairs.length === 0) {
    process.stderr.write('usage: trivy-summary.ts <label>=<report.json> [...] [--out FILE] [--sha SHA] [--run-url URL]\n');
    return 1;
  }

  const summary = summarize(readReports(pairs));
  const markdown = renderMarkdown(summary, {
    sha: flags.sha,
    runUrl: flags['run-url'],
    generatedAt: flags['generated-at'] || new Date().toISOString().slice(0, 10),
  });

  if (flags.out) fs.writeFileSync(flags.out, markdown);
  else process.stdout.write(markdown);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `total=${summary.total}\nactionable=${summary.actionable}\nscan_errors=${summary.errors.length}\n`,
    );
  }

  // Findings are reported through the issue, never the exit code; a non-zero
  // exit is reserved for the script itself failing.
  return 0;
}

// Run only when invoked directly (not when imported by the test).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main());
}
