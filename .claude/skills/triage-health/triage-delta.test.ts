import { describe, it, expect } from 'vitest';
import type { ReportInput } from '../../../scripts/trivy-summary.js';
import {
  checkReportUsability,
  computeDelta,
  parseCvesLine,
  parseWatchTable,
  type DeltaInputs,
  type RenovatePr,
} from './triage-delta.js';

/**
 * The suite drives the pure `computeDelta()` core with inline Trivy-shaped
 * report fixtures plus fake bead / Renovate state, exactly as the CLI shell
 * will supply them. Nothing here touches the filesystem, `gh`, or `bd`.
 *
 * The contract under test: every in-scope finding lands in exactly one
 * category, an already-filed bead suppresses a re-file (the idempotency
 * invariant the whole skill rests on), secrets and misconfigurations are never
 * deferred to the watch list, and a scan that failed — or never ran — is
 * surfaced rather than read as clean.
 *
 * Suppression paths get adversarial fixtures on purpose. A test that "passes"
 * because some earlier guard rejected the fixture proves nothing about the
 * guard it names, so each one is built to reach the guard under test and fail
 * only there.
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

/**
 * Renovate PRs arrive from `gh pr list --json number,title,headRefName,state,author`.
 * The helper supplies the trust fields (open, authored by the Renovate bot) so
 * each test states only what it is actually varying.
 */
const renovatePr = (over: Partial<RenovatePr> = {}): RenovatePr => ({
  number: 561,
  title: 'chore(deps): update dependency undici to v6.27.0',
  headRefName: 'renovate/undici-6.x',
  state: 'OPEN',
  author: 'renovate',
  authorIsBot: true,
  ...over,
});

/**
 * `expectedScans` defaults to the labels the fixtures use. Tests that assert
 * resolution therefore run against a complete scan; the missing-scan cases set
 * it explicitly.
 */
const inputs = (over: Partial<DeltaInputs> = {}): DeltaInputs => ({
  reports: [],
  expectedScans: [],
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

  it('prunes watch-list entries that no longer appear in a completed scan', () => {
    const delta = computeDelta(inputs({
      reports: [imageReport([{ Target: 'debian 12.5 (bookworm)', Vulnerabilities: [vuln({ VulnerabilityID: 'CVE-2026-8888', FixedVersion: '' })] }])],
      expectedScans: ['image'],
      watchBeads: [{
        id: 'pv-watch',
        design: [
          '| CVE-2026-9999 | HIGH | perl | image | 2026-08-01 | none |',
          '| CVE-2026-8888 | HIGH | zlib1g | image | 2026-08-08 | none |',
        ].join('\n'),
      }],
    }));

    expect(delta.resolved.watchEntries).toEqual(['CVE-2026-9999']);
    expect(delta.resolution_suppressed).toBe(false);
  });

  it('resolves nothing from zero reports, because an unrun scan is not evidence of a fix', () => {
    const delta = computeDelta(inputs({
      reports: [],
      cveBeads: [{ id: 'pv-abc1', status: 'open', notes: 'CVEs: CVE-2026-0001' }],
      watchBeads: [{ id: 'pv-watch', design: '| CVE-2026-9999 | HIGH | perl | image | 2026-08-01 | none |' }],
    }));

    expect(delta.resolved).toEqual({ beads: [], watchEntries: [] });
    expect(delta.resolution_suppressed).toBe(true);
  });

  it('suppresses resolution when an expected scan produced no report at all', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      expectedScans: ['repository', 'image'],
      cveBeads: [{ id: 'pv-img', status: 'open', notes: 'CVEs: CVE-2026-8001' }],
      watchBeads: [{ id: 'pv-watch', design: '| CVE-2026-9999 | HIGH | perl | image | 2026-08-01 | none |' }],
    }));

    // The image scan never ran, so it raised no error either — absence of an
    // error is exactly the gap this guard closes.
    expect(delta.scan_errors).toEqual([]);
    expect(delta.scope_notes.missingScans).toEqual(['image']);
    expect(delta.resolved).toEqual({ beads: [], watchEntries: [] });
    expect(delta.resolution_suppressed).toBe(true);
  });

  it('reports no missing scans when every expected label arrived', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      expectedScans: ['repository'],
      cveBeads: [{ id: 'pv-gone', status: 'open', notes: 'CVEs: CVE-2026-0002' }],
    }));

    expect(delta.scope_notes.missingScans).toEqual([]);
    expect(delta.resolution_suppressed).toBe(false);
    expect(delta.resolved.beads.map(b => b.beadId)).toEqual(['pv-gone']);
  });

  it('counts a failed expected scan as an error rather than as a missing scan', () => {
    const delta = computeDelta(inputs({
      reports: [{ label: 'image', json: null, error: 'could not read trivy-image.json' }],
      expectedScans: ['image'],
    }));

    expect(delta.scan_errors).toEqual(['image: could not read trivy-image.json']);
    expect(delta.scope_notes.missingScans).toEqual([]);
    expect(delta.resolution_suppressed).toBe(true);
  });

  it('does not read a severity downgrade as a resolution', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([
        // Re-rated to MEDIUM, so summarize() no longer itemizes it — but the
        // package is still vulnerable and the bead must stay open.
        vuln({ VulnerabilityID: 'CVE-2026-0001', Severity: 'MEDIUM' }),
        vuln({ VulnerabilityID: 'CVE-2026-0002', Severity: 'HIGH' }),
      ])])],
      expectedScans: ['repository'],
      cveBeads: [{ id: 'pv-abc1', status: 'open', notes: 'CVEs: CVE-2026-0001, CVE-2026-0002' }],
    }));

    expect(delta.resolved.beads).toEqual([]);
  });

  it('still resolves a bead whose downgraded CVE has genuinely left the scan', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln({ VulnerabilityID: 'CVE-2026-0002', Severity: 'MEDIUM' })])])],
      expectedScans: ['repository'],
      cveBeads: [{ id: 'pv-abc1', status: 'open', notes: 'CVEs: CVE-2026-0001, CVE-2026-0002' }],
    }));

    expect(delta.resolved.beads).toEqual([{
      beadId: 'pv-abc1',
      title: undefined,
      status: 'partially',
      clearedCves: ['CVE-2026-0001'],
      remainingCves: ['CVE-2026-0002'],
    }]);
  });

  it('does not read a downgraded misconfiguration or secret as resolved', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([{
        Target: 'Dockerfile',
        Misconfigurations: [{ ID: 'DS013', Severity: 'MEDIUM', Title: 'No health check' }],
        Secrets: [{ RuleID: 'aws-access-key-id', Severity: 'LOW', Title: 'AWS key', StartLine: 42 }],
      }])],
      expectedScans: ['repository'],
      cveBeads: [{ id: 'pv-cfg', status: 'open', notes: 'CVEs: DS013, aws-access-key-id' }],
    }));

    expect(delta.resolved.beads).toEqual([]);
  });

  it('does not report an open bead as resolved while all its CVEs are still present', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      cveBeads: [{ id: 'pv-abc1', status: 'open', notes: 'CVEs: CVE-2026-0001' }],
    }));

    expect(delta.resolved.beads).toEqual([]);
  });

  it('suppresses every resolution when a scan failed, so a partial scan never closes live work', () => {
    const delta = computeDelta(inputs({
      reports: [
        { label: 'image', json: null, error: 'could not read trivy-image.json' },
        repoReport([nodeResult([vuln()])]),
      ],
      expectedScans: ['image', 'repository'],
      cveBeads: [{ id: 'pv-img', status: 'open', notes: 'CVEs: CVE-2026-8001, CVE-2026-8002' }],
      watchBeads: [{ id: 'pv-watch', design: '| CVE-2026-9999 | HIGH | perl | image | 2026-08-01 | none |' }],
    }));

    expect(delta.scan_errors).toHaveLength(1);
    expect(delta.resolved.beads).toEqual([]);
    expect(delta.resolved.watchEntries).toEqual([]);
    expect(delta.resolution_suppressed).toBe(true);
  });
});

describe('computeDelta: bead status handling', () => {
  it('treats a bead with no status as untracked rather than assuming it is open', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      cveBeads: [{ id: 'pv-abc1', notes: 'CVEs: CVE-2026-0001' }],
    }));

    expect(delta.already_tracked.count).toBe(0);
    expect(delta.new_actionable.map(f => f.id)).toEqual(['CVE-2026-0001']);
    expect(delta.resolved.beads).toEqual([]);
  });

  it('treats a bead with an unrecognized status as untracked', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      cveBeads: [{ id: 'pv-abc1', status: 'wontfix', notes: 'CVEs: CVE-2026-0001' }],
    }));

    expect(delta.already_tracked.count).toBe(0);
    expect(delta.new_actionable).toHaveLength(1);
  });

  it('still tracks a bead in any bd status other than closed', () => {
    for (const status of ['open', 'in_progress', 'blocked', 'deferred', 'pinned', 'hooked']) {
      const delta = computeDelta(inputs({
        reports: [repoReport([nodeResult([vuln()])])],
        cveBeads: [{ id: 'pv-abc1', status, notes: 'CVEs: CVE-2026-0001' }],
      }));

      expect(delta.already_tracked.count, status).toBe(1);
    }
  });
});

describe('computeDelta: Renovate coverage', () => {
  it('attributes a fixable finding to a matching open Renovate PR that reaches the fixed version', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      renovatePrs: [
        renovatePr(),
        renovatePr({ number: 562, title: 'chore(deps): update dependency marked to v18.0.11', headRefName: 'renovate/marked-18.x' }),
      ],
    }));

    expect(delta.new_actionable).toHaveLength(0);
    expect(delta.covered_by_renovate).toHaveLength(1);
    expect(delta.covered_by_renovate[0]).toMatchObject({
      id: 'CVE-2026-0001',
      prs: [{ number: 561, title: 'chore(deps): update dependency undici to v6.27.0' }],
    });
  });

  it('does not attribute a finding to a PR that merely contains the package name as a substring', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln({ PkgName: 'ms' })])])],
      renovatePrs: [renovatePr({ number: 570, title: 'chore(deps): update dependency msgpack to v1', headRefName: 'renovate/msgpack-1.x' })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable).toHaveLength(1);
    expect(delta.new_actionable[0].renovateHints).toBeUndefined();
  });

  it('does not let a hyphen-adjacent package name claim an unrelated Renovate PR', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln({ VulnerabilityID: 'CVE-2026-1111', PkgName: 'git', FixedVersion: '2.45.0', Severity: 'CRITICAL' })])])],
      renovatePrs: [renovatePr({ number: 580, title: 'chore(deps): update dependency git-url-parse to v14', headRefName: 'renovate/git-url-parse-14.x' })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable.map(f => f.id)).toEqual(['CVE-2026-1111']);
    expect(delta.new_actionable[0].renovateHints).toBeUndefined();
  });

  it('does not let a sibling package whose slug extends this one claim its PR', () => {
    // `renovate/base-64-1.x` passes the branch suffix rule for `base` (the
    // remainder `64-1.x` starts with a digit), and v1.0.0 clears `base`'s
    // 0.11.2 fix by coincidence. Only the title's dependency name separates
    // them, so this fixture reaches that check and nothing earlier.
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([
        vuln({ VulnerabilityID: 'CVE-2026-8001', PkgName: 'base', InstalledVersion: '0.11.1', FixedVersion: '0.11.2', Severity: 'CRITICAL' }),
      ])])],
      renovatePrs: [renovatePr({ number: 101, title: 'chore(deps): update dependency base-64 to v1.0.0', headRefName: 'renovate/base-64-1.x' })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable.map(f => f.id)).toEqual(['CVE-2026-8001']);
    expect(delta.new_actionable[0].renovateHints).toBeUndefined();
  });

  it('does not let a title-only match cover a finding whose package the branch never names', () => {
    // The mirror of the case above: the title names undici and clears the fix,
    // but Renovate's branch — the string that says what the PR actually
    // changes — is for lodash. Only the branch half of the identity check
    // stands here.
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      renovatePrs: [renovatePr({ number: 106, title: 'chore(deps): update dependency undici to v6.27.0', headRefName: 'renovate/lodash-9.x' })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable.map(f => f.id)).toEqual(['CVE-2026-0001']);
  });

  it('does not let a branch slug that extends the package name match even when the title agrees', () => {
    // Branch `renovate/git-url-parse-14.x` and a title naming `git`: both
    // strings say `git`-something, and 2.45.0 clears the fix. The branch's
    // update-suffix rule is the only thing that rejects `url-parse-14.x` as a
    // version constraint.
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln({ VulnerabilityID: 'CVE-2026-1112', PkgName: 'git', FixedVersion: '2.45.0', Severity: 'CRITICAL' })])])],
      renovatePrs: [renovatePr({ number: 581, title: 'chore(deps): update dependency git to v2.45.0', headRefName: 'renovate/git-url-parse-14.x' })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable.map(f => f.id)).toEqual(['CVE-2026-1112']);
  });

  it('does not let a PR whose branch and title name different dependencies cover either', () => {
    // Grouped and hand-retitled Renovate PRs produce this shape: the branch
    // says undici, the title (which is where the decisive version is read from)
    // says lodash. The branch check alone passes here.
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln({ VulnerabilityID: 'CVE-2026-8005', PkgName: 'undici', FixedVersion: '6.21.1' })])])],
      renovatePrs: [renovatePr({ number: 105, title: 'chore(deps): update dependency lodash to v9.9.9', headRefName: 'renovate/undici-6.x' })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable.map(f => f.id)).toEqual(['CVE-2026-8005']);
    expect(delta.new_actionable[0].renovateHints).toBeUndefined();
  });

  it('files a multi-package CVE when a PR covers only one of its packages', () => {
    // One CVE, two lockfile packages, one Renovate PR. `foo`'s 2.0.0 target
    // clears `bar`'s 1.0.0 fix numerically, so only per-package binding plus the
    // all-packages rule keeps `bar` from disappearing.
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([
        vuln({ VulnerabilityID: 'CVE-2026-8002', PkgName: 'foo', InstalledVersion: '1.0.0', FixedVersion: '2.0.0', Severity: 'CRITICAL' }),
        vuln({ VulnerabilityID: 'CVE-2026-8002', PkgName: 'bar', InstalledVersion: '0.9.0', FixedVersion: '1.0.0', Severity: 'CRITICAL' }),
      ])])],
      renovatePrs: [renovatePr({ number: 102, title: 'chore(deps): update dependency foo to v2.0.0', headRefName: 'renovate/foo-2.x' })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable).toHaveLength(1);
    expect(delta.new_actionable[0].packages).toEqual(['bar', 'foo']);
    expect(delta.new_actionable[0].renovateHints).toEqual([
      expect.objectContaining({ number: 102, pkg: 'foo', reason: expect.stringContaining('bar') }),
    ]);
  });

  it('covers a multi-package CVE only when every package has its own proven PR', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([
        vuln({ VulnerabilityID: 'CVE-2026-8003', PkgName: 'foo', InstalledVersion: '1.0.0', FixedVersion: '2.0.0', Severity: 'CRITICAL' }),
        vuln({ VulnerabilityID: 'CVE-2026-8003', PkgName: 'bar', InstalledVersion: '0.9.0', FixedVersion: '1.0.0', Severity: 'CRITICAL' }),
      ])])],
      renovatePrs: [
        renovatePr({ number: 102, title: 'chore(deps): update dependency foo to v2.0.0', headRefName: 'renovate/foo-2.x' }),
        renovatePr({ number: 103, title: 'chore(deps): update dependency bar to v1.0.0', headRefName: 'renovate/bar-1.x' }),
      ],
    }));

    expect(delta.new_actionable).toHaveLength(0);
    expect(delta.covered_by_renovate).toHaveLength(1);
    expect(delta.covered_by_renovate[0].prs.map(pr => pr.number).sort()).toEqual([102, 103]);
  });

  it('compares each package against its own fixed version, not a sibling package version line', () => {
    // `bar` needs 3.0.0 and its PR delivers it; flattening the two packages'
    // fixed versions would judge `foo`'s 2.0.0 PR against 3.0.0 and demote a
    // genuinely covered finding.
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([
        vuln({ VulnerabilityID: 'CVE-2026-8004', PkgName: 'foo', InstalledVersion: '1.0.0', FixedVersion: '2.0.0', Severity: 'CRITICAL' }),
        vuln({ VulnerabilityID: 'CVE-2026-8004', PkgName: 'bar', InstalledVersion: '2.0.0', FixedVersion: '3.0.0', Severity: 'CRITICAL' }),
      ])])],
      renovatePrs: [
        renovatePr({ number: 102, title: 'chore(deps): update dependency foo to v2.0.0', headRefName: 'renovate/foo-2.x' }),
        renovatePr({ number: 103, title: 'chore(deps): update dependency bar to v3.0.0', headRefName: 'renovate/bar-3.x' }),
      ],
    }));

    expect(delta.covered_by_renovate).toHaveLength(1);
    expect(delta.new_actionable).toHaveLength(0);
  });

  it('does not treat a PR targeting a version below the fixed version as coverage', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      renovatePrs: [renovatePr({ number: 590, title: 'chore(deps): update dependency undici to v6.1.0', headRefName: 'renovate/undici-6.x' })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable).toHaveLength(1);
    expect(delta.new_actionable[0].renovateHints).toHaveLength(1);
    expect(delta.new_actionable[0].renovateHints?.[0]).toMatchObject({ number: 590, pkg: 'undici' });
    expect(delta.new_actionable[0].renovateHints?.[0].reason).toMatch(/6\.1\.0.*6\.27\.0/);
  });

  it('demotes a match whose target version cannot be read to new_actionable with a PR hint', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      renovatePrs: [renovatePr({ number: 591, title: 'chore(deps): update dependency undici to v6.x', headRefName: 'renovate/undici-6.x' })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable).toHaveLength(1);
    expect(delta.new_actionable[0].renovateHints?.[0]).toMatchObject({ number: 591, pkg: 'undici' });
  });

  it('never attributes an image finding to a Renovate PR that names the very same package', () => {
    // `renovate/node-20.x` + "update dependency node to v20.11.1" satisfies the
    // branch rule, the title rule, and the version comparison for this image
    // CVE's `node` package. Only the target-class guard stands between a live
    // CRITICAL and silent suppression.
    const delta = computeDelta(inputs({
      reports: [imageReport([{
        Target: 'debian 12.5 (bookworm)',
        Vulnerabilities: [vuln({ VulnerabilityID: 'CVE-2026-2222', PkgName: 'node', InstalledVersion: '20.11.0', FixedVersion: '20.11.1', Severity: 'CRITICAL' })],
      }])],
      renovatePrs: [renovatePr({ number: 592, title: 'chore(deps): update dependency node to v20.11.1', headRefName: 'renovate/node-20.x' })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable.map(f => f.targetClass)).toEqual(['image']);
    expect(delta.new_actionable[0].renovateHints).toBeUndefined();
  });

  it('never attributes a repo finding to a Renovate PR that names the very same package', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([{
        Target: 'Dockerfile',
        Vulnerabilities: [vuln({ VulnerabilityID: 'CVE-2026-2223', PkgName: 'node', InstalledVersion: '20.11.0', FixedVersion: '20.11.1', Severity: 'CRITICAL' })],
      }])],
      renovatePrs: [renovatePr({ number: 596, title: 'chore(deps): update dependency node to v20.11.1', headRefName: 'renovate/node-20.x' })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable.map(f => f.targetClass)).toEqual(['repo']);
  });

  it('ignores a Renovate-shaped PR that is not open', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      renovatePrs: [renovatePr({ state: 'MERGED' })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable).toHaveLength(1);
    expect(delta.new_actionable[0].renovateHints).toBeUndefined();
  });

  it('ignores an open PR on a renovate-shaped branch opened by a human', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      renovatePrs: [renovatePr({ author: 'drive-by-contributor', authorIsBot: false })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable).toHaveLength(1);
  });

  it('ignores an open PR on a renovate-shaped branch opened by a different bot', () => {
    // A genuine bot, so the is_bot check passes; only the login check
    // distinguishes Renovate's PRs from another automation's.
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      renovatePrs: [renovatePr({ author: 'dependabot[bot]', authorIsBot: true })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable).toHaveLength(1);
    expect(delta.new_actionable[0].renovateHints).toBeUndefined();
  });

  it('ignores a PR whose author gh did not report at all', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      renovatePrs: [renovatePr({ author: undefined, authorIsBot: undefined })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable).toHaveLength(1);
  });

  it('trusts the app/ prefixed login gh reports for the Renovate GitHub App', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      renovatePrs: [renovatePr({ author: 'app/renovate' })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(1);
  });

  it('ignores a human account that has taken the renovate login', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      renovatePrs: [renovatePr({ author: 'renovate', authorIsBot: false })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_actionable).toHaveLength(1);
    expect(delta.new_actionable[0].renovateHints).toBeUndefined();
  });

  it('still trusts a Renovate PR when gh reported no is_bot field', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      renovatePrs: [renovatePr({ authorIsBot: undefined })],
    }));

    expect(delta.covered_by_renovate).toHaveLength(1);
  });

  it('prefers the matching PR that reaches the fix when several are open for one package', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      renovatePrs: [
        renovatePr({ number: 594, title: 'chore(deps): update dependency undici to v6.1.0', headRefName: 'renovate/undici-6.x' }),
        renovatePr({ number: 595, title: 'chore(deps): update dependency undici to v7.0.0', headRefName: 'renovate/undici-7.x' }),
      ],
    }));

    expect(delta.covered_by_renovate.map(f => f.prs.map(pr => pr.number))).toEqual([[595]]);
    expect(delta.new_actionable).toHaveLength(0);
  });

  it('never attributes an unfixable finding to Renovate', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln({ FixedVersion: '' })])])],
      renovatePrs: [renovatePr()],
    }));

    expect(delta.covered_by_renovate).toHaveLength(0);
    expect(delta.new_no_fix).toHaveLength(1);
  });

  it('keeps a watch-listed CVE in newly_fixable rather than new_actionable when its PR match is uncertain', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln()])])],
      watchBeads: [{ id: 'pv-watch', design: '| CVE-2026-0001 | HIGH | undici | node | 2026-08-01 | none |' }],
      renovatePrs: [renovatePr({ number: 593, title: 'chore(deps): update dependency undici to v6.x' })],
    }));

    expect(delta.newly_fixable.map(f => f.id)).toEqual(['CVE-2026-0001']);
    expect(delta.newly_fixable[0].renovateHints?.[0]).toMatchObject({ number: 593 });
    expect(delta.new_actionable).toHaveLength(0);
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

  it('surfaces MEDIUM/LOW misconfigurations as an explicit out-of-scope count rather than dropping them', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([{
        Target: 'Dockerfile',
        Misconfigurations: [
          { ID: 'DS002', Severity: 'HIGH', Title: 'Image runs as root' },
          { ID: 'DS013', Severity: 'MEDIUM', Title: 'No health check' },
          { ID: 'DS029', Severity: 'LOW', Title: 'apt-get without --no-install-recommends' },
        ],
      }])],
    }));

    expect(delta.new_actionable.map(f => f.id)).toEqual(['DS002']);
    expect(delta.scope_notes.untriagedMisconfigurations).toMatchObject({ MEDIUM: 1, LOW: 1, CRITICAL: 0, HIGH: 0 });
  });

  it('reports no untriaged misconfigurations when every misconfiguration is itemized', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([{
        Target: 'Dockerfile',
        Misconfigurations: [{ ID: 'DS002', Severity: 'HIGH', Title: 'Image runs as root' }],
      }])],
    }));

    expect(delta.scope_notes.untriagedMisconfigurations)
      .toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 });
    expect(delta.scope_notes.missingScans).toEqual([]);
  });

  it('keeps one CVE separate across two space-containing targets of the same scan', () => {
    const delta = computeDelta(inputs({
      reports: [imageReport([
        { Target: 'debian 12.5', Vulnerabilities: [vuln({ VulnerabilityID: 'CVE-2026-4444', FixedVersion: '' })] },
        { Target: 'debian 12.5 (bookworm)', Vulnerabilities: [vuln({ VulnerabilityID: 'CVE-2026-4444', FixedVersion: '' })] },
      ])],
    }));

    expect(delta.new_no_fix).toHaveLength(2);
  });

  it('normalizes already_tracked ids so a mixed-case scan id matches its bead entry once', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([
        vuln({ VulnerabilityID: 'cve-2026-0001' }),
        vuln({ VulnerabilityID: 'CVE-2026-0001', PkgName: 'undici-2' }),
      ])])],
      cveBeads: [{ id: 'pv-abc1', status: 'open', notes: 'CVEs: CVE-2026-0001' }],
    }));

    expect(delta.already_tracked.cves).toEqual(['CVE-2026-0001']);
    expect(delta.already_tracked.count).toBe(2);
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
      scope_notes: { missingScans: [] },
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

  it('takes the union of every CVEs: line, because bd note appends rather than replaces', () => {
    const notes = [
      '# Implementation Context',
      'CVEs: CVE-2026-0001',
      '',
      '# Follow-up 2026-08-20',
      'The same upgrade also clears two more:',
      'CVEs: CVE-2026-0001, CVE-2026-0002, CVE-2026-0003',
    ].join('\n');

    expect(parseCvesLine(notes))
      .toEqual(['CVE-2026-0001', 'CVE-2026-0002', 'CVE-2026-0003']);
  });

  it('keeps a bead tracked when only a later appended CVEs: line names the scanned CVE', () => {
    const delta = computeDelta(inputs({
      reports: [repoReport([nodeResult([vuln({ VulnerabilityID: 'CVE-2026-0002' })])])],
      expectedScans: ['repository'],
      cveBeads: [{
        id: 'pv-abc1',
        status: 'open',
        notes: 'CVEs: CVE-2026-0001\n\nScope widened.\nCVEs: CVE-2026-0001, CVE-2026-0002',
      }],
    }));

    expect(delta.already_tracked.cves).toEqual(['CVE-2026-0002']);
    expect(delta.new_actionable).toHaveLength(0);
    expect(delta.resolved.beads).toEqual([{
      beadId: 'pv-abc1',
      title: undefined,
      status: 'partially',
      clearedCves: ['CVE-2026-0001'],
      remainingCves: ['CVE-2026-0002'],
    }]);
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

/**
 * The usability guard is the third leg of the "absence is not evidence" rule,
 * alongside `scan_errors` (the scan failed) and `missingScans` (the scan never
 * ran). It covers the case both of those miss: a report file that is present
 * and parses, but names no scan target at all. Resolution is derived from
 * absence, so an empty report otherwise reads as "every CVE is fixed" and
 * closes every open bead.
 */
describe('checkReportUsability', () => {
  const usable: ReportInput = {
    label: 'repository',
    json: { Results: [{ Target: 'package-lock.json', Vulnerabilities: [vuln()] }] },
  };

  it('passes a report that names at least one scan target through untouched', () => {
    expect(checkReportUsability([usable])).toEqual([usable]);
  });

  it('passes a scanned target that found nothing — an empty target list is clean', () => {
    const clean: ReportInput = { label: 'image', json: { Results: [{ Target: 'debian 12.5 (bookworm)' }] } };

    expect(checkReportUsability([clean])).toEqual([clean]);
  });

  it.each([
    ['a null Results field', { Results: null }],
    ['a Results field that is not an array', { Results: { Target: 'package-lock.json' } }],
    ['no Results field at all', { SchemaVersion: 2, ArtifactName: '.' }],
    ['an empty Results array', { Results: [] }],
    ['a body that is not an object', 'not a report'],
    ['a null body', null],
  ])('marks a report with %s as a failed scan', (_label, json) => {
    const [checked] = checkReportUsability([{ label: 'repository', json }]);

    expect(checked.error).toMatch(/no scan results/);
    expect(checked.label).toBe('repository');
  });

  it('leaves an existing read error as the reported cause', () => {
    const unread: ReportInput = { label: 'image', json: null, error: 'could not read trivy-image.json (ENOENT)' };

    expect(checkReportUsability([unread])).toEqual([unread]);
  });

  it('keeps an unusable report from resolving beads that the scan never re-examined', () => {
    const cveBeads = [{ id: 'pv-aaaa', title: 'bump undici', status: 'open', notes: 'CVEs: CVE-2026-0001' }];
    const watchBeads = [{ id: 'pv-bbbb', design: '| CVE-2026-9999 | HIGH | perl | image | 2026-08-01 | none |' }];
    const empty: ReportInput[] = [
      { label: 'repository', json: { Results: null } },
      { label: 'image', json: { Results: null } },
    ];

    const unguarded = computeDelta(inputs({
      reports: empty,
      expectedScans: ['repository', 'image'],
      cveBeads,
      watchBeads,
    }));
    // Without the guard the core has nothing to object to: both labels are
    // present and neither report carries an error, so absence reads as fixed.
    expect(unguarded.resolved.beads).toHaveLength(1);
    expect(unguarded.resolved.watchEntries).toEqual(['CVE-2026-9999']);

    const guarded = computeDelta(inputs({
      reports: checkReportUsability(empty),
      expectedScans: ['repository', 'image'],
      cveBeads,
      watchBeads,
    }));

    expect(guarded.resolution_suppressed).toBe(true);
    expect(guarded.resolved).toEqual({ beads: [], watchEntries: [] });
    expect(guarded.scan_errors).toHaveLength(2);
    expect(guarded.scan_errors[0]).toMatch(/^repository: /);
  });
});
