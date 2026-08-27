import { describe, it, expect } from 'vitest';
import type { ReportInput } from '../../../scripts/trivy-summary.js';
import {
  computeDelta,
  parseCvesLine,
  parseWatchTable,
  type DeltaInputs,
} from './triage-delta.js';

/**
 * The suite drives the pure `computeDelta()` core with inline Trivy-shaped
 * report fixtures plus fake bead / Renovate state, exactly as the CLI shell
 * will supply them. Nothing here touches the filesystem, `gh`, or `bd`.
 *
 * The contract under test: every in-scope finding lands in exactly one
 * category, an already-filed bead suppresses a re-file (the idempotency
 * invariant the whole skill rests on), secrets and misconfigurations are never
 * deferred to the watch list, and a scan that failed is surfaced rather than
 * read as clean.
 */

const advisory = (id: string) => `https://avd.aquasec.com/nvd/${id.toLowerCase()}`;

const vuln = (over: Record<string, unknown> = {}) => ({
  VulnerabilityID: 'CVE-2026-0001',
  PkgName: 'undici',
  InstalledVersion: '6.0.0',
  FixedVersion: '6.27.0',
  Severity: 'HIGH',
  Title: 'Request smuggling',
  PrimaryURL: advisory('CVE-2026-0001'),
  ...over,
});

const repoReport = (results: Record<string, unknown>[]): ReportInput => ({
  label: 'repository',
  json: { Results: results },
});

const imageReport = (results: Record<string, unknown>[]): ReportInput => ({
  label: 'image',
  json: { Results: results },
});

const nodeResult = (vulnerabilities: Record<string, unknown>[]) => ({
  Target: 'package-lock.json',
  Vulnerabilities: vulnerabilities,
});

const inputs = (over: Partial<DeltaInputs> = {}): DeltaInputs => ({
  reports: [],
  cveBeads: [],
  watchBeads: [],
  renovatePrs: [],
  ...over,
});

describe('computeDelta: new findings', () => {
  it('files a fixable finding with no covering bead or PR as new_actionable', () => {
    const delta = computeDelta(inputs({ reports: [repoReport([nodeResult([vuln()])])] }));

    expect(delta.new_actionable).toHaveLength(1);
    expect(delta.new_actionable[0]).toMatchObject({
      id: 'CVE-2026-0001',
      severity: 'HIGH',
      kind: 'vulnerability',
      packages: ['undici'],
      installed: '6.0.0',
      fixedVersion: '6.27.0',
      fixable: true,
      targetClass: 'node',
      url: advisory('CVE-2026-0001'),
    });
    expect(delta.new_no_fix).toHaveLength(0);
    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.already_tracked.count).toBe(0);
  });

  it('defers an unfixed finding that is not yet on the watch list to new_no_fix', () => {
    const delta = computeDelta(inputs({
      reports: [imageReport([{
        Target: 'debian 12.5 (bookworm)',
        Vulnerabilities: [vuln({ VulnerabilityID: 'CVE-2026-9999', PkgName: 'perl', FixedVersion: '', Severity: 'CRITICAL' })],
      }])],
    }));

    expect(delta.new_no_fix).toHaveLength(1);
    expect(delta.new_no_fix[0]).toMatchObject({
      id: 'CVE-2026-9999',
      fixable: false,
      targetClass: 'image',
      severity: 'CRITICAL',
    });
    expect(delta.new_no_fix[0].fixedVersion).toBeUndefined();
    expect(delta.new_actionable).toHaveLength(0);
  });

  it('classifies a filesystem finding outside a lockfile as the repo target class', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([{
        Target: 'Dockerfile',
        Misconfigurations: [{ ID: 'DS002', Severity: 'HIGH', Title: 'Image runs as root' }],
      }])],
    }));

    expect(delta.new_actionable[0]).toMatchObject({ targetClass: 'repo', kind: 'misconfiguration' });
  });
});

describe('computeDelta: idempotency against filed beads', () => {
  it('treats a CVE named in an open bead CVEs: line as already_tracked and does not re-file it', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      cveBeads: [{
        id: 'pv-abc1',
        title: 'security: bump undici to 6.27.0',
        status: 'open',
        notes: 'Fix strategy: direct bump.\nCVEs: CVE-2026-0001\n',
      }],
    }));

    expect(delta.new_actionable).toHaveLength(0);
    expect(delta.already_tracked.count).toBe(1);
    expect(delta.already_tracked.cves).toEqual(['CVE-2026-0001']);
    expect(delta.already_tracked.beadIds).toEqual(['pv-abc1']);
  });

  it('re-files a CVE whose only covering bead is already closed', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      cveBeads: [{ id: 'pv-abc1', status: 'closed', notes: 'CVEs: CVE-2026-0001' }],
    }));

    expect(delta.new_actionable.map(f => f.id)).toEqual(['CVE-2026-0001']);
    expect(delta.already_tracked.count).toBe(0);
  });

  it('reports a watch-listed CVE that gained a fix as newly_fixable', () => {
    const delta = computeDelta(inputs({
      reports: [imageReport([{
        Target: 'debian 12.5 (bookworm)',
        Vulnerabilities: [vuln({ VulnerabilityID: 'CVE-2026-9999', PkgName: 'perl', FixedVersion: '5.40.1-2', Severity: 'HIGH' })],
      }])],
      watchBeads: [{
        id: 'pv-watch',
        design: [
          '| CVE | Severity | Packages | Target | First seen | Exploitability note |',
          '| --- | --- | --- | --- | --- | --- |',
          '| CVE-2026-9999 | HIGH | perl | image | 2026-08-01 | not exercised |',
        ].join('\n'),
      }],
    }));

    expect(delta.newly_fixable.map(f => f.id)).toEqual(['CVE-2026-9999']);
    expect(delta.new_actionable).toHaveLength(0);
    expect(delta.new_no_fix).toHaveLength(0);
  });

  it('leaves a still-unfixed watch-listed CVE in already_tracked rather than re-reporting it', () => {
    const delta = computeDelta(inputs({
      reports: [imageReport([{
        Target: 'debian 12.5 (bookworm)',
        Vulnerabilities: [vuln({ VulnerabilityID: 'CVE-2026-9999', PkgName: 'perl', FixedVersion: '', Severity: 'HIGH' })],
      }])],
      watchBeads: [{ id: 'pv-watch', design: '| CVE-2026-9999 | HIGH | perl | image | 2026-08-01 | none |' }],
    }));

    expect(delta.new_no_fix).toHaveLength(0);
    expect(delta.already_tracked.onWatchList).toEqual(['CVE-2026-9999']);
    expect(delta.already_tracked.count).toBe(1);
  });

  it('aborts when more than one cve-watch bead is open', () => {
    expect(() => computeDelta(inputs({
      watchBeads: [{ id: 'pv-watch1' }, { id: 'pv-watch2' }],
    }))).toThrow(/pv-watch1.*pv-watch2/s);
  });

  it('treats zero watch beads as a valid first run', () => {
    const delta = computeDelta(inputs({
      reports: [imageReport([{
        Target: 'debian 12.5 (bookworm)',
        Vulnerabilities: [vuln({ FixedVersion: '' })],
      }])],
    }));

    expect(delta.new_no_fix).toHaveLength(1);
  });
});

describe('computeDelta: resolution', () => {
  it('reports fully and partially resolved beads when their CVEs leave the scan', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln({ VulnerabilityID: 'CVE-2026-0003' })])])],
      cveBeads: [
        { id: 'pv-gone', title: 'security: bump left-pad', status: 'open', notes: 'CVEs: CVE-2026-0001, CVE-2026-0002' },
        { id: 'pv-part', title: 'security: bump undici', status: 'in_progress', notes: 'CVEs: CVE-2026-0003, CVE-2026-0004' },
      ],
    }));

    expect(delta.resolved.beads).toEqual([
      {
        beadId: 'pv-gone',
        title: 'security: bump left-pad',
        status: 'fully',
        clearedCves: ['CVE-2026-0001', 'CVE-2026-0002'],
        remainingCves: [],
      },
      {
        beadId: 'pv-part',
        title: 'security: bump undici',
        status: 'partially',
        clearedCves: ['CVE-2026-0004'],
        remainingCves: ['CVE-2026-0003'],
      },
    ]);
  });

  it('prunes watch-list entries that no longer appear in the scan', () => {
    const delta = computeDelta(inputs({
      reports: [],
      watchBeads: [{ id: 'pv-watch', design: '| CVE-2026-9999 | HIGH | perl | image | 2026-08-01 | none |' }],
    }));

    expect(delta.resolved.watchEntries).toEqual(['CVE-2026-9999']);
  });

  it('does not report an open bead as resolved while all its CVEs are still present', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      cveBeads: [{ id: 'pv-abc1', status: 'open', notes: 'CVEs: CVE-2026-0001' }],
    }));

    expect(delta.resolved.beads).toEqual([]);
  });
});

describe('computeDelta: Renovate coverage', () => {
  it('attributes a fixable finding to a matching open Renovate PR', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      renovatePrs: [
        { number: 561, title: 'chore(deps): update dependency undici to v6.27.0', headRefName: 'renovate/undici-6.x' },
        { number: 562, title: 'chore(deps): update dependency marked to v18.0.11', headRefName: 'renovate/marked-18.x' },
      ],
    }));

    expect(delta.new_actionable).toHaveLength(0);
    expect(delta.covered_by_renovate).toHaveLength(1);
    expect(delta.covered_by_renovate[0]).toMatchObject({
      id: 'CVE-2026-0001',
      pr: { number: 561, title: 'chore(deps): update dependency undici to v6.27.0' },
    });
  });

  it('does not attribute a finding to a PR that merely contains the package name as a substring', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln({ PkgName: 'ms' })])])],
      renovatePrs: [{ number: 570, title: 'chore(deps): update dependency msgpack to v1', headRefName: 'renovate/msgpack-1.x' }],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable).toHaveLength(1);
  });

  it('never attributes an unfixable finding to Renovate', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln({ FixedVersion: '' })])])],
      renovatePrs: [{ number: 561, title: 'chore(deps): update dependency undici to v6.27.0' }],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_no_fix).toHaveLength(1);
  });
});

describe('computeDelta: scope and normalization', () => {
  it('treats a no-fix secret as actionable and never watch-listable', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([{
        Target: 'src/config.ts',
        Secrets: [{ RuleID: 'aws-access-key-id', Severity: 'LOW', Title: 'AWS key', StartLine: 42 }],
      }])],
    }));

    expect(delta.new_actionable).toHaveLength(1);
    expect(delta.new_actionable[0]).toMatchObject({
      kind: 'secret',
      id: 'aws-access-key-id',
      target: 'src/config.ts:42',
      fixable: false,
    });
    expect(delta.new_no_fix).toHaveLength(0);
  });

  it('treats a no-fix misconfiguration as actionable rather than deferring it', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([{
        Target: 'Dockerfile',
        Misconfigurations: [{ ID: 'DS026', Severity: 'CRITICAL', Title: 'No HEALTHCHECK' }],
      }])],
    }));

    expect(delta.new_actionable.map(f => f.kind)).toEqual(['misconfiguration']);
    expect(delta.new_no_fix).toHaveLength(0);
  });

  it('counts a MEDIUM vulnerability without placing it in any actionable category', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln({ Severity: 'MEDIUM' }), vuln({ VulnerabilityID: 'CVE-2026-0002', Severity: 'LOW' })])])],
    }));

    expect(delta.counts.MEDIUM).toBe(1);
    expect(delta.counts.LOW).toBe(1);
    expect(delta.new_actionable).toHaveLength(0);
    expect(delta.new_no_fix).toHaveLength(0);
    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.newly_fixable).toHaveLength(0);
    expect(delta.already_tracked.count).toBe(0);
  });

  it('collapses per-package rows for one CVE on one target into a single finding', () => {
    const delta = computeDelta(inputs({
      reports: [imageReport([{
        Target: 'debian 12.5 (bookworm)',
        Vulnerabilities: [
          vuln({ VulnerabilityID: 'CVE-2026-7777', PkgName: 'perl', FixedVersion: '' }),
          vuln({ VulnerabilityID: 'CVE-2026-7777', PkgName: 'perl-base', FixedVersion: '' }),
          vuln({ VulnerabilityID: 'CVE-2026-7777', PkgName: 'libperl5.40', FixedVersion: '' }),
          vuln({ VulnerabilityID: 'CVE-2026-7777', PkgName: 'perl-modules-5.40', FixedVersion: '' }),
        ],
      }])],
    }));

    expect(delta.new_no_fix).toHaveLength(1);
    expect(delta.new_no_fix[0].packages).toEqual(['libperl5.40', 'perl', 'perl-base', 'perl-modules-5.40']);
  });

  it('keeps the same CVE separate when it appears on two different scan targets', () => {
    const delta = computeDelta(inputs({
      reports: [
        repoReport([nodeResult([vuln()])]),
        imageReport([{ Target: 'debian 12.5 (bookworm)', Vulnerabilities: [vuln()] }]),
      ],
    }));

    expect(delta.new_actionable).toHaveLength(2);
    expect(delta.new_actionable.map(f => f.targetClass).sort()).toEqual(['image', 'node']);
  });

  it('propagates scan errors instead of reporting a clean delta', () => {
    const delta = computeDelta(inputs({
      reports: [
        { label: 'image', json: null, error: 'could not read trivy-image.json' },
        repoReport([nodeResult([vuln()])]),
      ],
    }));

    expect(delta.scan_errors).toEqual(['image: could not read trivy-image.json']);
    expect(delta.new_actionable).toHaveLength(1);
  });

  it('returns an all-empty delta for an empty scan and empty state', () => {
    const delta = computeDelta(inputs({ metadata: { sha: 'abc123', runUrl: 'https://runs/1', scanDate: '2026-08-26', healthReportIssue: 549 } }));

    expect(delta).toMatchObject({
      new_actionable: [],
      covered_by_renovate: [],
      newly_fixable: [],
      new_no_fix: [],
      already_tracked: { count: 0, beadIds: [], cves: [], onWatchList: [] },
      resolved: { beads: [], watchEntries: [] },
      scan_errors: [],
      metadata: { sha: 'abc123', runUrl: 'https://runs/1', scanDate: '2026-08-26', healthReportIssue: 549 },
    });
    expect(delta.counts).toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 });
  });
});

describe('parseCvesLine', () => {
  it('extracts several CVEs from one line', () => {
    expect(parseCvesLine('CVEs: CVE-2026-0001, CVE-2026-0002, CVE-2026-0003'))
      .toEqual(['CVE-2026-0001', 'CVE-2026-0002', 'CVE-2026-0003']);
  });

  it('tolerates irregular whitespace and separators around the ids', () => {
    expect(parseCvesLine('Some preamble.\n   CVEs:   CVE-2026-0001 ,CVE-2026-0002\t CVE-2026-0003  \nTrailing text'))
      .toEqual(['CVE-2026-0001', 'CVE-2026-0002', 'CVE-2026-0003']);
  });

  it('matches the label case-insensitively and normalizes ids to upper case', () => {
    expect(parseCvesLine('cves: cve-2026-0001')).toEqual(['CVE-2026-0001']);
  });

  it('accepts GHSA and Trivy misconfiguration ids alongside CVEs', () => {
    expect(parseCvesLine('CVEs: GHSA-abcd-efgh-ijkl, DS002'))
      .toEqual(['GHSA-ABCD-EFGH-IJKL', 'DS002']);
  });

  it('de-duplicates repeated ids while preserving first-seen order', () => {
    expect(parseCvesLine('CVEs: CVE-2026-0002, CVE-2026-0001, CVE-2026-0002'))
      .toEqual(['CVE-2026-0002', 'CVE-2026-0001']);
  });

  it('returns nothing when the line is missing, empty, or malformed', () => {
    expect(parseCvesLine(undefined)).toEqual([]);
    expect(parseCvesLine('')).toEqual([]);
    expect(parseCvesLine('No machine-readable line here.')).toEqual([]);
    expect(parseCvesLine('CVEs:')).toEqual([]);
    expect(parseCvesLine('CVEs: none')).toEqual([]);
    expect(parseCvesLine('Mentions CVEs: CVE-2026-0001 mid-sentence')).toEqual([]);
  });
});

describe('parseWatchTable', () => {
  it('extracts the first column of every data row', () => {
    const design = [
      '# Base-image CVE watch',
      '',
      '| CVE | Severity | Packages | Target | First seen | Exploitability note |',
      '| --- | --- | --- | --- | --- | --- |',
      '| CVE-2026-9999 | HIGH | perl | image | 2026-08-01 | interpreter not invoked |',
      '| CVE-2026-8888 | CRITICAL | zlib1g | image | 2026-08-08 | compression path unused |',
    ].join('\n');

    expect(parseWatchTable(design)).toEqual(['CVE-2026-9999', 'CVE-2026-8888']);
  });

  it('returns nothing for a header-only table', () => {
    const design = [
      '| CVE | Severity | Packages | Target | First seen | Exploitability note |',
      '| --- | --- | --- | --- | --- | --- |',
    ].join('\n');

    expect(parseWatchTable(design)).toEqual([]);
  });

  it('reads the first column regardless of how many extra columns a row carries', () => {
    const design = [
      '| CVE | Severity | Packages | Target | First seen | Note | Owner | Ticket |',
      '|:--- | :---: | ---: | --- | --- | --- | --- | --- |',
      '| CVE-2026-9999 | HIGH | perl | image | 2026-08-01 | none | stephen | n/a |',
    ].join('\n');

    expect(parseWatchTable(design)).toEqual(['CVE-2026-9999']);
  });

  it('tolerates rows without leading or trailing pipes', () => {
    expect(parseWatchTable('CVE-2026-9999 | HIGH | perl')).toEqual(['CVE-2026-9999']);
  });

  it('returns nothing for missing, empty, or non-table design text', () => {
    expect(parseWatchTable(undefined)).toEqual([]);
    expect(parseWatchTable('')).toEqual([]);
    expect(parseWatchTable('No entries yet.')).toEqual([]);
  });

  it('de-duplicates a CVE listed twice', () => {
    const design = [
      '| CVE-2026-9999 | HIGH | perl | image | 2026-08-01 | none |',
      '| CVE-2026-9999 | HIGH | perl-base | image | 2026-08-01 | none |',
    ].join('\n');

    expect(parseWatchTable(design)).toEqual(['CVE-2026-9999']);
  });
});
