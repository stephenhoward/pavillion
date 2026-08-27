import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  summarize,
  renderMarkdown,
  readReports,
  main,
} from '../trivy-summary.js';

/**
 * The suite drives the pure `summarize()` / `renderMarkdown()` pair with inline
 * Trivy-shaped fixtures, then covers the file-reading and CLI seams separately.
 *
 * The contract under test: counts cover every severity, only CRITICAL/HIGH
 * vulnerabilities and misconfigs are itemized, every secret is itemized, and a
 * scan that failed to produce a report is reported as an error rather than
 * silently reading as clean.
 */

const vulnReport = (severity: string) => ({
  Results: [{
    Target: 'package-lock.json',
    Vulnerabilities: [{
      VulnerabilityID: 'CVE-2026-0001',
      PkgName: 'left-pad',
      InstalledVersion: '1.0.0',
      FixedVersion: '1.0.1',
      Severity: severity,
      Title: 'Prototype pollution',
      PrimaryURL: 'https://avd.aquasec.com/CVE-2026-0001',
    }],
  }],
});

describe('trivy-summary: summarize', () => {
  it('counts and itemizes a CRITICAL vulnerability', () => {
    const summary = summarize([{ label: 'fs', json: vulnReport('CRITICAL') }]);

    expect(summary.total).toBe(1);
    expect(summary.actionable).toBe(1);
    expect(summary.scans[0].counts.CRITICAL).toBe(1);
    expect(summary.findings[0]).toMatchObject({
      scan: 'fs',
      kind: 'vulnerability',
      severity: 'CRITICAL',
      id: 'CVE-2026-0001',
      pkg: 'left-pad',
      fixedVersion: '1.0.1',
    });
  });

  it('counts but does not itemize a MEDIUM vulnerability', () => {
    const summary = summarize([{ label: 'fs', json: vulnReport('MEDIUM') }]);

    expect(summary.total).toBe(1);
    expect(summary.actionable).toBe(0);
    expect(summary.scans[0].counts.MEDIUM).toBe(1);
  });

  it('maps an unrecognized severity to UNKNOWN instead of dropping it', () => {
    const summary = summarize([{ label: 'fs', json: vulnReport('NOVEL') }]);

    expect(summary.total).toBe(1);
    expect(summary.scans[0].counts.UNKNOWN).toBe(1);
  });

  it('itemizes every secret regardless of severity', () => {
    const summary = summarize([{
      label: 'fs',
      json: {
        Results: [{
          Target: 'src/config.ts',
          Secrets: [{ RuleID: 'aws-access-key-id', Severity: 'LOW', Title: 'AWS key', StartLine: 42 }],
        }],
      },
    }]);

    expect(summary.actionable).toBe(1);
    expect(summary.findings[0]).toMatchObject({ kind: 'secret', target: 'src/config.ts:42' });
  });

  it('itemizes a HIGH misconfiguration', () => {
    const summary = summarize([{
      label: 'config',
      json: {
        Results: [{
          Target: 'Dockerfile',
          Misconfigurations: [{ ID: 'DS002', Severity: 'HIGH', Title: 'Image runs as root' }],
        }],
      },
    }]);

    expect(summary.findings[0]).toMatchObject({ kind: 'misconfiguration', id: 'DS002', target: 'Dockerfile' });
  });

  it('records a failed scan as an error rather than a clean result', () => {
    const summary = summarize([{ label: 'image', json: null, error: 'could not read image.json' }]);

    expect(summary.errors).toHaveLength(1);
    expect(summary.scans[0].error).toContain('could not read');
    expect(summary.total).toBe(0);
  });

  it('sorts findings by severity across scans', () => {
    const summary = summarize([
      { label: 'fs', json: vulnReport('HIGH') },
      { label: 'image', json: vulnReport('CRITICAL') },
    ]);

    expect(summary.findings.map(f => f.severity)).toEqual(['CRITICAL', 'HIGH']);
  });

  it('tolerates a report with no Results array', () => {
    const summary = summarize([{ label: 'fs', json: { SchemaVersion: 2 } }]);

    expect(summary.total).toBe(0);
    expect(summary.errors).toHaveLength(0);
  });
});

describe('trivy-summary: renderMarkdown', () => {
  it('states plainly that a clean scan found nothing', () => {
    const markdown = renderMarkdown(summarize([{ label: 'fs', json: { Results: [] } }]));

    expect(markdown).toContain('No findings.');
    expect(markdown).not.toContain('### Vulnerabilities');
  });

  it('distinguishes "nothing actionable" from "nothing at all"', () => {
    const markdown = renderMarkdown(summarize([{ label: 'fs', json: vulnReport('LOW') }]));

    expect(markdown).toContain('No CRITICAL or HIGH findings');
    expect(markdown).toContain('1 lower-severity finding');
  });

  it('itemizes actionable findings in a table with the fix version', () => {
    const markdown = renderMarkdown(summarize([{ label: 'fs', json: vulnReport('CRITICAL') }]));

    expect(markdown).toContain('### Vulnerabilities (CRITICAL / HIGH)');
    expect(markdown).toContain('[CVE-2026-0001](https://avd.aquasec.com/CVE-2026-0001)');
    expect(markdown).toContain('1.0.1');
  });

  it('warns above the table when a scan failed', () => {
    const markdown = renderMarkdown(summarize([{ label: 'image', json: null, error: 'trivy exited 2' }]));

    expect(markdown).toContain('[!WARNING]');
    expect(markdown).toContain('trivy exited 2');
  });

  it('includes provenance when given', () => {
    const markdown = renderMarkdown(summarize([]), {
      sha: 'abcdef1234567890',
      runUrl: 'https://github.com/o/r/actions/runs/1',
      generatedAt: '2026-08-26',
    });

    expect(markdown).toContain('2026-08-26');
    expect(markdown).toContain('`abcdef123456`');
    expect(markdown).toContain('actions/runs/1');
  });
});

describe('trivy-summary: readReports and CLI', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trivy-summary-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads a label=path pair', () => {
    const file = path.join(dir, 'fs.json');
    fs.writeFileSync(file, JSON.stringify(vulnReport('HIGH')));

    const [report] = readReports([`fs=${file}`]);
    expect(report.label).toBe('fs');
    expect(report.error).toBeUndefined();
  });

  it('turns a missing report file into an error input, not a throw', () => {
    const [report] = readReports([`image=${path.join(dir, 'missing.json')}`]);

    expect(report.error).toContain('could not read');
    expect(report.json).toBeNull();
  });

  it('exits 1 with usage when no reports are given', () => {
    expect(main([])).toBe(1);
  });

  it('writes markdown to --out and exits 0 even with findings', () => {
    const input = path.join(dir, 'fs.json');
    const out = path.join(dir, 'report.md');
    fs.writeFileSync(input, JSON.stringify(vulnReport('CRITICAL')));

    expect(main([`fs=${input}`, '--out', out])).toBe(0);
    expect(fs.readFileSync(out, 'utf8')).toContain('CVE-2026-0001');
  });

  it('appends finding counts to GITHUB_OUTPUT when set', () => {
    const input = path.join(dir, 'fs.json');
    const githubOutput = path.join(dir, 'gh-output');
    fs.writeFileSync(input, JSON.stringify(vulnReport('CRITICAL')));
    process.env.GITHUB_OUTPUT = githubOutput;

    try {
      main([`fs=${input}`, '--out', path.join(dir, 'report.md')]);
      const written = fs.readFileSync(githubOutput, 'utf8');
      expect(written).toContain('total=1');
      expect(written).toContain('actionable=1');
      expect(written).toContain('scan_errors=0');
    }
    finally {
      delete process.env.GITHUB_OUTPUT;
    }
  });
});
