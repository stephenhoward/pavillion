import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  summarize,
  renderMarkdown,
  readReports,
  expectedTierFor,
  areaOf,
  main,
} from '../coverage-summary.js';

/**
 * The suite drives the pure `summarize()` / `renderMarkdown()` pair with
 * istanbul-shaped `coverage-summary.json` fixtures, then covers the
 * file-reading and CLI seams separately.
 *
 * The contract under test: unit and integration coverage stay in separate
 * columns, a file with no coverage in any tier is the top-priority gap, a file
 * that misses the tier its area is expected to have is the second, and a tier
 * whose run produced no report is announced as an error rather than silently
 * dragging every file into the untested list.
 */

/** Minimal istanbul file-summary shape — only `lines` is read. */
const cov = (covered: number, total: number) => {
  const metric = { total, covered, skipped: 0, pct: total === 0 ? 100 : (covered / total) * 100 };
  return { lines: metric, statements: metric, functions: metric, branches: metric };
};

const report = (files: Record<string, ReturnType<typeof cov>>) => ({
  total: cov(0, 0),
  ...files,
});

const ROOT = '/repo';
const abs = (file: string) => `${ROOT}/${file}`;

describe('coverage-summary: expectation rules', () => {
  it('expects integration coverage for server API routes', () => {
    expect(expectedTierFor('src/server/calendar/api/v1/events.ts')).toBe('integration');
  });

  it('expects unit coverage for server domain logic', () => {
    expect(expectedTierFor('src/server/calendar/service/events.ts')).toBe('unit');
    expect(expectedTierFor('src/server/calendar/model/event.ts')).toBe('unit');
  });

  it('expects unit coverage for frontend code', () => {
    expect(expectedTierFor('src/client/components/calendar.vue')).toBe('unit');
    expect(expectedTierFor('src/common/utils/dates.ts')).toBe('unit');
  });

  it('groups files by backend domain and by frontend app', () => {
    expect(areaOf('src/server/calendar/service/events.ts')).toBe('server/calendar');
    expect(areaOf('src/server/server.ts')).toBe('server');
    expect(areaOf('src/client/stores/calendar.ts')).toBe('client');
  });
});

describe('coverage-summary: summarize', () => {
  it('reports a file with no coverage in any tier as untested', () => {
    const summary = summarize([
      { tier: 'unit', json: report({ [abs('src/server/calendar/service/events.ts')]: cov(0, 40) }) },
      { tier: 'integration', json: report({ [abs('src/server/calendar/service/events.ts')]: cov(0, 40) }) },
    ], ROOT);

    expect(summary.untested).toHaveLength(1);
    expect(summary.untested[0]).toMatchObject({
      file: 'src/server/calendar/service/events.ts',
      area: 'server/calendar',
      expected: 'unit',
      uncoveredLines: 40,
    });
    expect(summary.misses).toHaveLength(0);
  });

  it('does not call a file untested when another tier covers it', () => {
    const summary = summarize([
      { tier: 'unit', json: report({ [abs('src/server/calendar/api/v1/events.ts')]: cov(0, 40) }) },
      { tier: 'integration', json: report({ [abs('src/server/calendar/api/v1/events.ts')]: cov(38, 40) }) },
    ], ROOT);

    expect(summary.untested).toHaveLength(0);
    expect(summary.misses).toHaveLength(0);
  });

  it('flags an API route covered only by unit tests as missing its expected tier', () => {
    const summary = summarize([
      { tier: 'unit', json: report({ [abs('src/server/calendar/api/v1/events.ts')]: cov(36, 40) }) },
      { tier: 'integration', json: report({ [abs('src/server/calendar/api/v1/events.ts')]: cov(0, 40) }) },
    ], ROOT);

    expect(summary.untested).toHaveLength(0);
    expect(summary.misses).toHaveLength(1);
    expect(summary.misses[0]).toMatchObject({
      file: 'src/server/calendar/api/v1/events.ts',
      expected: 'integration',
      expectedUncovered: 40,
    });
  });

  it('flags a service reachable only through integration tests as missing its expected tier', () => {
    const summary = summarize([
      { tier: 'unit', json: report({ [abs('src/server/calendar/service/events.ts')]: cov(4, 40) }) },
      { tier: 'integration', json: report({ [abs('src/server/calendar/service/events.ts')]: cov(36, 40) }) },
    ], ROOT);

    expect(summary.misses.map(m => m.file)).toEqual(['src/server/calendar/service/events.ts']);
  });

  it('leaves a well-covered file out of both sections', () => {
    const summary = summarize([
      { tier: 'unit', json: report({ [abs('src/server/calendar/service/events.ts')]: cov(38, 40) }) },
      { tier: 'integration', json: report({ [abs('src/server/calendar/service/events.ts')]: cov(20, 40) }) },
    ], ROOT);

    expect(summary.untested).toHaveLength(0);
    expect(summary.misses).toHaveLength(0);
    expect(summary.actionable).toBe(0);
  });

  it('ranks untested files by uncovered line count', () => {
    const summary = summarize([
      { tier: 'unit', json: report({
        [abs('src/server/calendar/service/small.ts')]: cov(0, 10),
        [abs('src/server/calendar/service/large.ts')]: cov(0, 100),
      }) },
      { tier: 'integration', json: report({
        [abs('src/server/calendar/service/small.ts')]: cov(0, 10),
        [abs('src/server/calendar/service/large.ts')]: cov(0, 100),
      }) },
    ], ROOT);

    expect(summary.untested.map(f => f.file)).toEqual([
      'src/server/calendar/service/large.ts',
      'src/server/calendar/service/small.ts',
    ]);
  });

  it('ignores the aggregate total row and files with no executable lines', () => {
    const summary = summarize([
      { tier: 'unit', json: report({ [abs('src/server/calendar/interface/types.ts')]: cov(0, 0) }) },
      { tier: 'integration', json: report({ [abs('src/server/calendar/interface/types.ts')]: cov(0, 0) }) },
    ], ROOT);

    expect(summary.files).toHaveLength(0);
    expect(summary.untested).toHaveLength(0);
  });

  it('rolls coverage up by area', () => {
    const summary = summarize([
      { tier: 'unit', json: report({
        [abs('src/server/calendar/service/events.ts')]: cov(30, 60),
        [abs('src/server/calendar/service/series.ts')]: cov(10, 40),
        [abs('src/client/stores/calendar.ts')]: cov(0, 20),
      }) },
      { tier: 'integration', json: report({}) },
    ], ROOT);

    const calendar = summary.areas.find(a => a.area === 'server/calendar');
    expect(calendar).toMatchObject({ files: 2, totalLines: 100, uncoveredLines: 60 });
    expect(calendar?.unit?.pct).toBeCloseTo(40);
    expect(summary.areas.map(a => a.area)).toContain('client');
  });
});

describe('coverage-summary: incomplete runs', () => {
  const inputs = (error: string) => summarize([
    { tier: 'unit', json: null, error },
    { tier: 'integration', json: report({
      [abs('src/server/calendar/api/v1/events.ts')]: cov(38, 40),
      [abs('src/server/calendar/service/events.ts')]: cov(38, 40),
    }) },
  ], ROOT);

  it('records the failed tier as an error rather than as zero coverage', () => {
    const summary = inputs('unit: could not read coverage/unit/coverage-summary.json');

    expect(summary.errors).toHaveLength(1);
    expect(summary.available).toEqual(['integration']);
    expect(summary.untested).toHaveLength(0);
  });

  it('does not judge files whose expected tier did not run', () => {
    const summary = inputs('unit: could not read coverage/unit/coverage-summary.json');

    // The service expects unit coverage, which was not measured — unjudgeable.
    expect(summary.misses.map(m => m.file)).toEqual([]);
  });

  it('still flags a miss when the expected tier did run', () => {
    const summary = summarize([
      { tier: 'unit', json: null, error: 'unit: missing' },
      { tier: 'integration', json: report({ [abs('src/server/calendar/api/v1/events.ts')]: cov(0, 40) }) },
    ], ROOT);

    expect(summary.misses.map(m => m.file)).toEqual(['src/server/calendar/api/v1/events.ts']);
  });
});

describe('coverage-summary: fingerprint', () => {
  const summaryFor = (files: string[]) => summarize(
    ['unit', 'integration'].map(tier => ({
      tier: tier as 'unit' | 'integration',
      json: report(Object.fromEntries(files.map(f => [abs(f), cov(0, 10)]))),
    })),
    ROOT,
  );

  it('is stable for the same set of untested files', () => {
    expect(summaryFor(['src/server/calendar/service/a.ts']).fingerprint)
      .toBe(summaryFor(['src/server/calendar/service/a.ts']).fingerprint);
  });

  it('changes when a file enters the untested set', () => {
    expect(summaryFor(['src/server/calendar/service/a.ts']).fingerprint)
      .not.toBe(summaryFor(['src/server/calendar/service/a.ts', 'src/server/calendar/service/b.ts']).fingerprint);
  });
});

describe('coverage-summary: renderMarkdown', () => {
  const summary = summarize([
    { tier: 'unit', json: report({
      [abs('src/server/calendar/service/events.ts')]: cov(0, 40),
      [abs('src/server/calendar/api/v1/events.ts')]: cov(36, 40),
    }) },
    { tier: 'integration', json: report({
      [abs('src/server/calendar/service/events.ts')]: cov(0, 40),
      [abs('src/server/calendar/api/v1/events.ts')]: cov(0, 40),
    }) },
  ], ROOT);

  it('lists untested files, expectation misses, and the area rollup', () => {
    const markdown = renderMarkdown(summary);

    expect(markdown).toContain('Untested files');
    expect(markdown).toContain('src/server/calendar/service/events.ts');
    expect(markdown).toContain('Below expected tier');
    expect(markdown).toContain('src/server/calendar/api/v1/events.ts');
    expect(markdown).toContain('Coverage by area');
  });

  it('embeds the fingerprint so the workflow can tell a changed report from a repeat', () => {
    expect(renderMarkdown(summary)).toContain(`<!-- coverage-fingerprint: ${summary.fingerprint} -->`);
  });

  it('warns when a tier did not report', () => {
    const incomplete = summarize([
      { tier: 'unit', json: null, error: 'unit: could not read report' },
      { tier: 'integration', json: report({}) },
    ], ROOT);

    expect(renderMarkdown(incomplete)).toContain('[!WARNING]');
    expect(renderMarkdown(incomplete)).toContain('could not read report');
  });
});

describe('coverage-summary: readReports', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-summary-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads a tier report from a label=path pair', () => {
    const file = path.join(dir, 'unit.json');
    fs.writeFileSync(file, JSON.stringify(report({ [abs('src/server/calendar/service/events.ts')]: cov(1, 10) })));

    const [input] = readReports([`unit=${file}`]);

    expect(input.tier).toBe('unit');
    expect(input.error).toBeUndefined();
  });

  it('reports a missing file as a tier error instead of throwing', () => {
    const [input] = readReports([`unit=${path.join(dir, 'absent.json')}`]);

    expect(input.json).toBeNull();
    expect(input.error).toContain('absent.json');
  });
});

describe('coverage-summary: main', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-summary-main-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.GITHUB_OUTPUT;
  });

  const writeTier = (name: string, files: Record<string, ReturnType<typeof cov>>) => {
    const file = path.join(dir, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(report(files)));
    return file;
  };

  it('writes the markdown report, the machine-readable gaps, and the step outputs', () => {
    const unit = writeTier('unit', { [abs('src/server/calendar/service/events.ts')]: cov(0, 40) });
    const integration = writeTier('integration', { [abs('src/server/calendar/service/events.ts')]: cov(0, 40) });
    const out = path.join(dir, 'report.md');
    const jsonOut = path.join(dir, 'gaps.json');
    const githubOutput = path.join(dir, 'github-output');
    process.env.GITHUB_OUTPUT = githubOutput;

    const code = main([
      `unit=${unit}`,
      `integration=${integration}`,
      '--root', ROOT,
      '--out', out,
      '--json-out', jsonOut,
    ]);

    expect(code).toBe(0);
    expect(fs.readFileSync(out, 'utf8')).toContain('src/server/calendar/service/events.ts');

    const gaps = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));
    expect(gaps.untested[0].file).toBe('src/server/calendar/service/events.ts');

    const outputs = fs.readFileSync(githubOutput, 'utf8');
    expect(outputs).toContain('untested=1');
    expect(outputs).toContain('actionable=1');
    expect(outputs).toContain('run_errors=0');
    expect(outputs).toMatch(/fingerprint=\w+/);
  });

  it('exits 0 with findings, reserving a non-zero exit for the script failing', () => {
    const unit = writeTier('unit', { [abs('src/server/calendar/service/events.ts')]: cov(0, 40) });

    expect(main([`unit=${unit}`, '--root', ROOT, '--out', path.join(dir, 'r.md')])).toBe(0);
    expect(main([])).toBe(1);
  });
});
