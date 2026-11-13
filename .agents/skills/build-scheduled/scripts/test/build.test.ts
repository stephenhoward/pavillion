/**
 * Unit tests for .agents/skills/build-scheduled/scripts/lib/build.ts
 *
 * Pure functions take parsed `bd`/`gh` JSON rows or a notes string. The
 * CLI helpers take an injected Runner that returns canned results, so no
 * test touches bd, gh or git.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type BuildBead,
  type PrRow,
  type Runner,
  type RunResult,
  type LockStore,
  QUEUE_GATE,
  GH_PR_LIMIT,
  MAX_FIRINGS,
  validateFlags,
  assertRootId,
  lockDecision,
  passingCi,
  queueGate,
  priorEpicGate,
  selectRoot,
  evaluateGates,
  parseBuildState,
  buildStateWriteArgs,
  stateWriteCommand,
  chainPlanInput,
  readBeads,
  readOpenPrs,
  runPreflight,
  runGates,
  runDryRun,
} from '../lib/build.js';

// =============================================================================
// Fixture builders
// =============================================================================

const NOW = new Date('2026-11-12T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const ANALYSED = '# Bead Analysis\n\nstructure';

function bead(overrides: Partial<BuildBead> & { id: string }): BuildBead {
  return {
    title: `Title ${overrides.id}`,
    status: 'open',
    priority: 1,
    issue_type: 'epic',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    labels: [],
    parent: null,
    notes: ANALYSED,
    ...overrides,
  };
}

function ready(id: string, updated_at: string, extra: Partial<BuildBead> = {}): BuildBead {
  return bead({ id, updated_at, labels: ['spec:ready'], ...extra });
}

const GREEN = [
  { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
  { __typename: 'StatusContext', state: 'SUCCESS' },
];

function pr(number: number, ageDays: number, overrides: Partial<PrRow> = {}): PrRow {
  return {
    number,
    isDraft: false,
    createdAt: new Date(NOW.getTime() - ageDays * DAY).toISOString(),
    reviewDecision: '',
    statusCheckRollup: GREEN,
    ...overrides,
  };
}

function prs(count: number, ageDays = 1): PrRow[] {
  return Array.from({ length: count }, (_, i) => pr(1000 + i, ageDays));
}

function stateBlock(lines: string[], heading = '## Build state'): string {
  return [heading, ...lines].join('\n');
}

const GOOD_BLOCK = stateBlock([
  'firings: 1',
  'restart: none',
  'chain 1: feat.alpha-one → #101, feat.alpha-two → #102; next: done',
  'chain 2: -; next: fix.beta-one',
  'stopped: none',
]);

function ok(stdout: string): RunResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function failed(stderr: string, exitCode = 1): RunResult {
  return { stdout: '', stderr, exitCode };
}

/** A runner that answers by the first matching command prefix and logs calls. */
function fakeRunner(routes: [string, RunResult][]): Runner & { calls: string[][] } {
  const calls: string[][] = [];
  const runner = ((cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    const line = [cmd, ...args].join(' ');
    const hit = routes.find(([prefix]) => line.startsWith(prefix));
    return hit ? hit[1] : failed(`unexpected call: ${line}`);
  }) as Runner & { calls: string[][] };
  runner.calls = calls;
  return runner;
}

function memoryLock(initial: string | null = null): LockStore & { content: string | null } {
  const store = {
    content: initial,
    read: () => store.content,
    write: (c: string) => {
      store.content = c;
    },
    remove: () => {
      store.content = null;
    },
  };
  return store;
}

// =============================================================================
// validate-flags
// =============================================================================

describe('validateFlags', () => {
  it('allows --scheduled alone and --scheduled --dry-run', () => {
    expect(validateFlags(['--scheduled'])).toEqual({ ok: true, scheduled: true, dryRun: false });
    expect(validateFlags(['--scheduled', '--dry-run'])).toEqual({ ok: true, scheduled: true, dryRun: true });
  });

  it('leaves attended flags alone', () => {
    expect(validateFlags(['pv-abc', '--only', 'pv-abc.1'])).toMatchObject({ ok: true, scheduled: false });
  });

  it.each([
    [['--scheduled', 'pv-abc'], /epic id/],
    [['--scheduled', '--only', 'pv-abc.1'], /--only/],
    [['--scheduled', '--only=pv-abc.1'], /--only/],
    [['--scheduled', '--sequential'], /--sequential/],
    [['--scheduled', '--resume'], /--resume/],
    [['--scheduled', '--verbose'], /unknown flag/],
  ])('refuses %j', (argv, message) => {
    const result = validateFlags(argv);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });
});

// =============================================================================
// Root id
// =============================================================================

describe('assertRootId', () => {
  it.each(['pv-abc', 'pv-256c', 'pv-256c.2', 'pv-a1.2.3'])('accepts %s', id => {
    expect(() => assertRootId(id)).not.toThrow();
  });

  it.each([
    'pv-abc; rm -rf /',
    'pv-abc && echo hi',
    '$(whoami)',
    'pv-abc`id`',
    'pv-ABC',
    '--json',
    'pv-abc.',
    'pv-abc.x',
    '',
  ])('rejects %j', id => {
    expect(() => assertRootId(id)).toThrow(/invalid root id/);
  });
});

// =============================================================================
// Lock
// =============================================================================

describe('lockDecision', () => {
  const alive = (pids: number[]) => (pid: number) => pids.includes(pid);

  it('takes a free lock', () => {
    expect(lockDecision(null, alive([]), 10).verdict).toBe('take');
  });

  it('stops on a lock held by a live pid', () => {
    const d = lockDecision('{"pid":42,"started":"2026-11-12T00:00:00Z"}', alive([42]), 10);
    expect(d.verdict).toBe('held');
    expect(d.reading).toContain('42');
  });

  it('replaces a stale lock whose pid is dead', () => {
    expect(lockDecision('{"pid":42,"started":"x"}', alive([]), 10).verdict).toBe('replace');
  });

  it('takes a lock this session already holds', () => {
    expect(lockDecision('{"pid":10,"started":"x"}', alive([10]), 10).verdict).toBe('take');
  });

  it.each(['not json', '{}', '{"pid":"42","started":"x"}', '{"pid":-1,"started":"x"}', '{"pid":4.5,"started":"x"}', '[]', '{"pid":42}'])(
    'fails closed on malformed lock %j',
    content => {
      expect(lockDecision(content, alive([]), 10).verdict).toBe('malformed');
    },
  );
});

// =============================================================================
// Queue gate
// =============================================================================

describe('passingCi', () => {
  it('passes only completed, successful checks', () => {
    expect(passingCi(GREEN)).toBe(true);
    expect(passingCi([{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' }])).toBe(true);
  });

  it.each([
    ['empty rollup', []],
    ['pending check', [{ __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' }]],
    ['failed check', [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }]],
    ['pending status', [{ __typename: 'StatusContext', state: 'PENDING' }]],
    ['unknown entry', [{ __typename: 'Mystery' }]],
  ])('does not pass a %s', (_name, rollup) => {
    expect(passingCi(rollup)).toBe(false);
  });
});

describe('queueGate', () => {
  it('passes at 9 counted PRs and fails at 10', () => {
    expect(queueGate(prs(QUEUE_GATE.open - 1), NOW).verdict).toBe('pass');
    const r = queueGate(prs(QUEUE_GATE.open), NOW);
    expect(r.verdict).toBe('fail');
    expect(r.reading).toContain('10');
  });

  it('passes at exactly 7 days and fails beyond', () => {
    expect(queueGate([pr(1, QUEUE_GATE.ageDays)], NOW).verdict).toBe('pass');
    const r = queueGate([pr(1, QUEUE_GATE.ageDays + 0.01)], NOW);
    expect(r.verdict).toBe('fail');
    expect(r.reading).toContain('oldest 7.0 days');
  });

  it('excludes drafts, CI-failing and change-requested PRs from the count and the age', () => {
    const rows = [
      ...prs(QUEUE_GATE.open - 1),
      pr(1, 30, { isDraft: true }),
      pr(2, 30, { statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }] }),
      pr(3, 30, { reviewDecision: 'CHANGES_REQUESTED' }),
    ];
    expect(queueGate(rows, NOW).verdict).toBe('pass');
  });

  it('fails closed when the result reaches the --limit', () => {
    const r = queueGate(Array.from({ length: GH_PR_LIMIT }, (_, i) => pr(i + 1, 1, { isDraft: true })), NOW);
    expect(r.verdict).toBe('fail');
    expect(r.reading).toMatch(/limit/);
  });

  it('pins its constants to the clear-backlog.md marker', () => {
    const file = '.agents/commands/clear-backlog.md';
    const text = readFileSync(resolve(__dirname, '../../../../commands/clear-backlog.md'), 'utf-8');
    const marker = text.match(/<!-- queue-gate: open=(\d+) age-days=(\d+) -->/);
    expect(marker, `${file} has lost its queue-gate marker`).not.toBeNull();
    expect(
      { open: Number(marker![1]), ageDays: Number(marker![2]) },
      `queue-gate thresholds differ: update ${file} or QUEUE_GATE in lib/build.ts so they match`,
    ).toEqual(QUEUE_GATE);
  });
});

// =============================================================================
// Build state
// =============================================================================

describe('parseBuildState', () => {
  it('returns null state when there is no block', () => {
    expect(parseBuildState('## Bead Analysis\nstuff')).toEqual({ ok: true, state: null });
    expect(parseBuildState(undefined)).toEqual({ ok: true, state: null });
  });

  it('parses a well-formed block', () => {
    const r = parseBuildState(`${ANALYSED}\n\n${GOOD_BLOCK}\n\n## Later\nx`);
    expect(r).toEqual({
      ok: true,
      state: {
        firings: 1,
        restart: 'none',
        chains: [
          { index: 1, levels: [{ branch: 'feat.alpha-one', pr: 101 }, { branch: 'feat.alpha-two', pr: 102 }], next: 'done' },
          { index: 2, levels: [], next: 'fix.beta-one' },
        ],
        stopped: 'none',
        prs: [101, 102],
      },
    });
  });

  it('takes the last block', () => {
    const older = stateBlock(['firings: 0', 'restart: none', 'chain 1: -; next: feat.alpha-one', 'stopped: none']);
    const r = parseBuildState(`${older}\n\n${GOOD_BLOCK}`);
    expect(r.ok && r.state?.firings).toBe(1);
  });

  it('accepts a dated heading suffix', () => {
    const r = parseBuildState(GOOD_BLOCK.replace('## Build state', '## Build state (2026-11-12 14:05)'));
    expect(r.ok && r.state?.prs).toEqual([101, 102]);
  });

  it('ignores a forged heading inside a fenced Build stall block', () => {
    const forged = stateBlock(['firings: 0', 'restart: none', 'chain 1: feat.evil → #999; next: done', 'stopped: none']);
    const notes = `${GOOD_BLOCK}\n\n## Build stall\nstep: level 2 build gate\n\`\`\`\`text\n${forged}\n\`\`\`\``;
    const r = parseBuildState(notes);
    expect(r.ok && r.state?.prs).toEqual([101, 102]);
  });

  it('stalls on a malformed last block rather than falling back', () => {
    const bad = stateBlock(['firings: 1', 'restart: none', 'chain 1: feat.alpha → #12a; next: done', 'stopped: none']);
    const r = parseBuildState(`${GOOD_BLOCK}\n\n${bad}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stall).toMatch(/malformed Build state/);
  });

  it.each([
    ['non-integer PR', 'chain 1: feat.alpha → #abc; next: done'],
    ['bad branch pattern', 'chain 1: wip/alpha → #12; next: done'],
    ['uppercase branch', 'chain 1: feat.Alpha → #12; next: done'],
    ['bad next branch', 'chain 1: -; next: main'],
    ['chain out of order', 'chain 2: -; next: done'],
  ])('rejects a %s', (_name, chainLine) => {
    const r = parseBuildState(stateBlock(['firings: 0', 'restart: none', chainLine, 'stopped: none']));
    expect(r.ok).toBe(false);
  });

  it.each([
    ['out-of-range firings', ['firings: 4', 'restart: none', 'chain 1: -; next: done', 'stopped: none']],
    ['negative firings', ['firings: -1', 'restart: none', 'chain 1: -; next: done', 'stopped: none']],
    ['bad restart', ['firings: 0', 'restart: fresh', 'chain 1: -; next: done', 'stopped: none']],
    ['missing stopped line', ['firings: 0', 'restart: none', 'chain 1: -; next: done']],
    ['missing firings line', ['restart: none', 'chain 1: -; next: done', 'stopped: none']],
    ['no chain line', ['firings: 0', 'restart: none', 'stopped: none']],
    ['stray line', ['firings: 0', 'restart: none', 'chain 1: -; next: done', 'note: hi', 'stopped: none']],
  ])('rejects %s', (_name, lines) => {
    expect(parseBuildState(stateBlock(lines)).ok).toBe(false);
  });

  it('bounds firings at MAX_FIRINGS', () => {
    const r = parseBuildState(stateBlock([`firings: ${MAX_FIRINGS}`, 'restart: resume', 'chain 1: -; next: done', 'stopped: stalled']));
    expect(r.ok).toBe(true);
  });
});

// =============================================================================
// Selection
// =============================================================================

describe('selectRoot', () => {
  it('takes the earliest spec:ready root by updated_at and names the source', () => {
    const s = selectRoot([ready('pv-bbb', '2026-11-06T14:00:00Z'), ready('pv-aaa', '2026-11-07T00:00:00Z')]);
    expect(s).toMatchObject({ root: 'pv-bbb', kind: 'ready', source: 'updated_at' });
  });

  it('prefers the label-event time when a root carries one', () => {
    const s = selectRoot([
      ready('pv-bbb', '2026-11-01T00:00:00Z', { spec_ready_at: '2026-11-09T00:00:00Z' }),
      ready('pv-aaa', '2026-11-08T00:00:00Z'),
    ]);
    expect(s).toMatchObject({ root: 'pv-aaa', source: 'updated_at' });
    const t = selectRoot([
      ready('pv-bbb', '2026-11-09T00:00:00Z', { spec_ready_at: '2026-11-01T00:00:00Z' }),
      ready('pv-aaa', '2026-11-08T00:00:00Z'),
    ]);
    expect(t).toMatchObject({ root: 'pv-bbb', source: 'label-event' });
  });

  it('breaks a tie by id', () => {
    const at = '2026-11-06T14:00:00Z';
    expect(selectRoot([ready('pv-zzz', at), ready('pv-aaa', at)]).root).toBe('pv-aaa');
  });

  it('skips build:hold, needs-human, unanalysed and already-built roots with reasons', () => {
    const s = selectRoot([
      ready('pv-a', '2026-11-01T00:00:00Z', { labels: ['spec:ready', 'build:hold'] }),
      ready('pv-b', '2026-11-02T00:00:00Z', { labels: ['spec:ready', 'needs-human'] }),
      ready('pv-c', '2026-11-03T00:00:00Z', { notes: 'no analysis here' }),
      ready('pv-d', '2026-11-04T00:00:00Z', { notes: `${ANALYSED}\n\n${GOOD_BLOCK}` }),
      ready('pv-e', '2026-11-05T00:00:00Z'),
    ]);
    expect(s.root).toBe('pv-e');
    expect(s.skipped).toEqual([
      { id: 'pv-a', reason: 'build:hold' },
      { id: 'pv-b', reason: 'needs-human' },
      { id: 'pv-c', reason: expect.stringMatching(/Bead Analysis/) },
      { id: 'pv-d', reason: expect.stringMatching(/Build state/) },
    ]);
  });

  it('ignores closed roots and children', () => {
    const s = selectRoot([
      ready('pv-a', '2026-11-01T00:00:00Z', { status: 'closed' }),
      ready('pv-b.1', '2026-11-01T00:00:00Z', { parent: 'pv-b' }),
    ]);
    expect(s.root).toBeNull();
  });

  it('resumes a spec:building root before an older spec:ready one', () => {
    const s = selectRoot([
      ready('pv-old', '2026-10-01T00:00:00Z'),
      bead({ id: 'pv-mid', updated_at: '2026-11-10T00:00:00Z', labels: ['spec:building'] }),
    ]);
    expect(s).toMatchObject({ root: 'pv-mid', kind: 'resume', source: null });
  });

  it('does not resume a spec:building root carrying build:hold or needs-human', () => {
    const s = selectRoot([
      bead({ id: 'pv-h', labels: ['spec:building', 'build:hold'] }),
      bead({ id: 'pv-n', labels: ['spec:building', 'needs-human'] }),
      ready('pv-r', '2026-11-01T00:00:00Z'),
    ]);
    expect(s).toMatchObject({ root: 'pv-r', kind: 'ready' });
    expect(s.skipped.map(k => k.id)).toEqual(['pv-h', 'pv-n']);
  });
});

// =============================================================================
// Gates
// =============================================================================

describe('priorEpicGate', () => {
  const built = (id: string, notes: string, status = 'open') =>
    bead({ id, status, labels: ['spec:built'], notes: `${ANALYSED}\n\n${notes}` });

  it('fails when a spec:built root records a PR that is still open', () => {
    const r = priorEpicGate([built('pv-x', GOOD_BLOCK)], new Set([102, 500]));
    expect(r.verdict).toBe('fail');
    expect(r.reading).toContain('#102');
  });

  it('counts a closed spec:built root too', () => {
    expect(priorEpicGate([built('pv-x', GOOD_BLOCK, 'closed')], new Set([101])).verdict).toBe('fail');
  });

  it('passes when every recorded PR is closed or merged', () => {
    expect(priorEpicGate([built('pv-x', GOOD_BLOCK)], new Set([500])).verdict).toBe('pass');
  });

  it('passes a spec:built root with no Build state block', () => {
    expect(priorEpicGate([built('pv-x', '')], new Set([101])).verdict).toBe('pass');
  });

  it('fails closed on a malformed block', () => {
    const bad = stateBlock(['firings: 9', 'restart: none', 'chain 1: -; next: done', 'stopped: none']);
    expect(priorEpicGate([built('pv-x', bad)], new Set()).verdict).toBe('fail');
  });
});

describe('evaluateGates', () => {
  const beads = [ready('pv-r', '2026-11-01T00:00:00Z')];

  it('passes all four in order and selects the root', () => {
    const r = evaluateGates({ beads, prs: prs(2), now: NOW, mode: 'run' });
    expect(r.ok).toBe(true);
    expect(r.gates.map(g => [g.check, g.verdict])).toEqual([
      ['resume-first', 'pass'],
      ['prior-epic-in-review', 'pass'],
      ['queue', 'pass'],
      ['nothing-to-build', 'pass'],
    ]);
    expect(r.selection?.root).toBe('pv-r');
  });

  it('on resume skips gates 2 and 4 but still evaluates the queue gate', () => {
    const resuming = [bead({ id: 'pv-b', labels: ['spec:building'] })];
    const r = evaluateGates({ beads: resuming, prs: prs(QUEUE_GATE.open), now: NOW, mode: 'run' });
    expect(r.gates.map(g => g.verdict)).toEqual(['pass', 'skipped', 'fail', 'not-run']);
    expect(r.ok).toBe(false);
  });

  it('ends at the first failure in a real run and names its reading', () => {
    const blocked = [...beads, bead({ id: 'pv-x', labels: ['spec:built'], notes: GOOD_BLOCK })];
    const r = evaluateGates({ beads: blocked, prs: [pr(101, 1)], now: NOW, mode: 'run' });
    expect(r.gates.map(g => g.verdict)).toEqual(['pass', 'fail', 'not-run', 'not-run']);
    expect(r.gates[1].reading).toContain('pv-x');
  });

  it('evaluates every gate in a dry run', () => {
    const blocked = [...beads, bead({ id: 'pv-x', labels: ['spec:built'], notes: GOOD_BLOCK })];
    const r = evaluateGates({ beads: blocked, prs: [pr(101, 1)], now: NOW, mode: 'dry' });
    expect(r.gates.map(g => g.verdict)).toEqual(['pass', 'fail', 'pass', 'pass']);
    expect(r.selection?.root).toBe('pv-r');
  });

  it('fails gate 4 when nothing is buildable', () => {
    const r = evaluateGates({ beads: [ready('pv-h', '2026-11-01T00:00:00Z', { labels: ['spec:ready', 'build:hold'] })], prs: [], now: NOW, mode: 'run' });
    expect(r.gates[3]).toMatchObject({ check: 'nothing-to-build', verdict: 'fail' });
  });

  it('fails closed when a reading is an error', () => {
    const r = evaluateGates({ beads: { error: 'bd list failed (1)' }, prs: [], now: NOW, mode: 'run' });
    expect(r.gates[0]).toMatchObject({ verdict: 'fail', reading: expect.stringContaining('bd list failed') });
    expect(r.ok).toBe(false);
    const q = evaluateGates({ beads, prs: { error: 'gh pr list failed (4)' }, now: NOW, mode: 'run' });
    expect(q.gates[1].verdict).toBe('fail');
  });
});

// =============================================================================
// State write
// =============================================================================

describe('buildStateWriteArgs / stateWriteCommand', () => {
  it.each(['spec:building', 'spec:built', 'spec:stalled'])('writes %s and clears the other eight', label => {
    const args = buildStateWriteArgs(label);
    expect(args.filter(a => a === '--remove-label')).toHaveLength(8);
    expect(args.slice(-2)).toEqual(['--add-label', label]);
    expect(args).not.toContain('build:hold');
    expect(args).not.toContain('needs-human');
  });

  it('gives the exact flags for spec:building', () => {
    expect(buildStateWriteArgs('spec:building')).toEqual([
      '--remove-label', 'spec:drafted',
      '--remove-label', 'spec:blocked',
      '--remove-label', 'spec:revise',
      '--remove-label', 'spec:approved',
      '--remove-label', 'spec:decomposing',
      '--remove-label', 'spec:ready',
      '--remove-label', 'spec:built',
      '--remove-label', 'spec:stalled',
      '--add-label', 'spec:building',
    ]);
  });

  it.each(['spec:ready', 'spec:drafted', 'build:hold', 'needs-human', 'spec:nope'])('refuses %s', label => {
    expect(() => buildStateWriteArgs(label)).toThrow(/not a build-scheduled label/);
  });

  it('builds a bd update argv for a valid root and refuses a hostile id', () => {
    expect(stateWriteCommand('pv-abc', 'spec:built').slice(0, 2)).toEqual(['update', 'pv-abc']);
    expect(() => stateWriteCommand('pv-abc; bd delete pv-xyz', 'spec:built')).toThrow(/invalid root id/);
  });
});

// =============================================================================
// Chain plan input
// =============================================================================

describe('chainPlanInput', () => {
  // `bd children --json` row shape: {issue_id, depends_on_id, type}.
  const dep = (issue: string, on: string, type: string) => ({ issue_id: issue, depends_on_id: on, type });

  it('keeps non-decision children and the blocks edges among them', () => {
    const children = [
      bead({ id: 'pv-r.1', parent: 'pv-r', issue_type: 'task', dependencies: [dep('pv-r.1', 'pv-r', 'parent-child')] }),
      bead({ id: 'pv-r.2', parent: 'pv-r', issue_type: 'task', dependencies: [dep('pv-r.2', 'pv-r.1', 'blocks'), dep('pv-r.2', 'pv-r.3', 'blocks')] }),
      bead({ id: 'pv-r.3', parent: 'pv-r', issue_type: 'decision' }),
      bead({ id: 'pv-r.4', parent: 'pv-r', issue_type: 'task', dependencies: [dep('pv-r.4', 'pv-other', 'blocks')] }),
    ];
    expect(chainPlanInput(children)).toEqual({
      beads: ['pv-r.1', 'pv-r.2', 'pv-r.4'],
      edges: [{ blocker: 'pv-r.1', blocked: 'pv-r.2', dependencyType: 'blocks' }],
    });
  });

  it('also reads the bd show dependency shape', () => {
    const children = [
      bead({ id: 'pv-r.1', parent: 'pv-r', issue_type: 'task' }),
      bead({ id: 'pv-r.2', parent: 'pv-r', issue_type: 'task', dependencies: [{ id: 'pv-r.1', dependency_type: 'blocks' }] }),
    ];
    expect(chainPlanInput(children).edges).toEqual([{ blocker: 'pv-r.1', blocked: 'pv-r.2', dependencyType: 'blocks' }]);
  });
});

// =============================================================================
// CLI helpers: fail closed
// =============================================================================

describe('readers fail closed', () => {
  it('readBeads throws on a non-zero exit or malformed JSON', () => {
    expect(() => readBeads(fakeRunner([['bd list', failed('boom', 3)]]))).toThrow(/bd list.*3/);
    expect(() => readBeads(fakeRunner([['bd list', ok('{not json')]]))).toThrow(/JSON/);
    expect(() => readBeads(fakeRunner([['bd list', ok('{"id":"pv-a"}')]]))).toThrow(/array/);
    expect(() => readBeads(fakeRunner([['bd list', ok('[{"status":"open"}]')]]))).toThrow(/id/);
  });

  it('readBeads asks for every row', () => {
    const runner = fakeRunner([['bd list', ok('[]')]]);
    readBeads(runner);
    expect(runner.calls[0]).toEqual(['bd', 'list', '--all', '--limit', '0', '--json']);
  });

  it('readOpenPrs passes an explicit limit and rejects rows missing a field', () => {
    const runner = fakeRunner([['gh pr list', ok(JSON.stringify([pr(1, 1)]))]]);
    expect(readOpenPrs(runner)).toHaveLength(1);
    expect(runner.calls[0]).toContain('--limit');
    expect(runner.calls[0]).toContain(String(GH_PR_LIMIT));
    const missing = { ...pr(1, 1) } as Partial<PrRow>;
    delete missing.statusCheckRollup;
    expect(() => readOpenPrs(fakeRunner([['gh pr list', ok(JSON.stringify([missing]))]]))).toThrow(/statusCheckRollup/);
    expect(() => readOpenPrs(fakeRunner([['gh pr list', failed('auth', 4)]]))).toThrow(/gh pr list/);
  });

  it('runGates turns a reader failure into a failed gate', () => {
    const runner = fakeRunner([['bd list', failed('down')], ['gh pr list', ok('[]')]]);
    const r = runGates(runner, NOW, 'run');
    expect(r.ok).toBe(false);
    expect(r.gates[0].verdict).toBe('fail');
  });
});

// =============================================================================
// Preflight
// =============================================================================

describe('runPreflight', () => {
  const safe = ok('{"ok":true}');
  const deps = (lock: LockStore, alive: number[] = []) => ({
    lock,
    isAlive: (pid: number) => alive.includes(pid),
    ownerPid: 10,
    now: NOW,
  });

  it('checks the report path, takes the lock, then checks the tree', () => {
    const lock = memoryLock();
    const runner = fakeRunner([['git check-ignore', ok('')], ['npx tsx', safe]]);
    const r = runPreflight(runner, deps(lock), 'run');
    expect(r.ok).toBe(true);
    expect(r.checks.map(c => c.check)).toEqual(['report-path', 'lock', 'clean-tree']);
    expect(JSON.parse(lock.content!)).toEqual({ pid: 10, started: NOW.toISOString() });
    expect(runner.calls[0]).toEqual(['git', 'check-ignore', '-q', 'reports/spawn-bead-workers/']);
  });

  it('stops before touching the lock when the report path is not ignored', () => {
    const lock = memoryLock();
    const r = runPreflight(fakeRunner([['git check-ignore', failed('', 1)]]), deps(lock), 'run');
    expect(r.ok).toBe(false);
    expect(r.checks.map(c => c.verdict)).toEqual(['fail', 'not-run', 'not-run']);
    expect(lock.content).toBeNull();
  });

  it('stops on a live lock and leaves it in place', () => {
    const held = '{"pid":42,"started":"x"}';
    const lock = memoryLock(held);
    const r = runPreflight(fakeRunner([['git check-ignore', ok('')]]), deps(lock, [42]), 'run');
    expect(r.checks[1].verdict).toBe('fail');
    expect(lock.content).toBe(held);
  });

  it('releases the lock it took when the tree is not clean', () => {
    const lock = memoryLock();
    const runner = fakeRunner([['git check-ignore', ok('')], ['npx tsx', { stdout: '{"ok":false,"reason":"dirty tree"}', stderr: '', exitCode: 1 }]]);
    const r = runPreflight(runner, deps(lock), 'run');
    expect(r.checks[2]).toMatchObject({ verdict: 'fail', reading: expect.stringContaining('dirty tree') });
    expect(lock.content).toBeNull();
  });

  it('neither reads nor writes the lock in a dry run, and evaluates every check', () => {
    const lock = memoryLock('garbage');
    let reads = 0;
    const spy: LockStore = { read: () => { reads++; return lock.read(); }, write: lock.write, remove: lock.remove };
    const runner = fakeRunner([['git check-ignore', failed('', 1)], ['npx tsx', safe]]);
    const r = runPreflight(runner, deps(spy), 'dry');
    expect(r.checks.map(c => c.verdict)).toEqual(['fail', 'skipped', 'pass']);
    expect(reads).toBe(0);
    expect(lock.content).toBe('garbage');
  });
});

// =============================================================================
// Dry run
// =============================================================================

describe('runDryRun', () => {
  it('prints preflight, gates, selection, chain plan and labels, writing nothing', () => {
    const children = [
      bead({ id: 'pv-r.1', parent: 'pv-r', issue_type: 'task' }),
      bead({ id: 'pv-r.2', parent: 'pv-r', issue_type: 'task', dependencies: [{ issue_id: 'pv-r.2', depends_on_id: 'pv-r.1', type: 'blocks' }] }),
    ];
    const plan = { chains: [['pv-r.1', 'pv-r.2']], flat: false, warnings: [] };
    const runner = fakeRunner([
      ['git check-ignore', ok('')],
      ['npx tsx .agents/skills/bead-branch-and-pr/scripts/stack.ts safe-to-start', ok('{"ok":true}')],
      ['npx tsx .agents/skills/bead-branch-and-pr/scripts/stack.ts plan', ok(JSON.stringify(plan))],
      ['bd list', ok(JSON.stringify([ready('pv-r', '2026-11-01T00:00:00Z')]))],
      ['gh pr list', ok('[]')],
      ['bd children pv-r', ok(JSON.stringify(children))],
    ]);
    const lock = memoryLock();
    const r = runDryRun(runner, { lock, isAlive: () => false, ownerPid: 1, now: NOW });
    expect(Object.keys(r)).toEqual(['preflight', 'gates', 'selection', 'chain_plan', 'labels']);
    expect(r.selection?.root).toBe('pv-r');
    expect(r.chain_plan).toEqual(plan);
    const planCall = runner.calls.find(c => c.includes('plan'))!;
    expect(JSON.parse(planCall[planCall.length - 1])).toEqual({
      beads: ['pv-r.1', 'pv-r.2'],
      edges: [{ blocker: 'pv-r.1', blocked: 'pv-r.2', dependencyType: 'blocks' }],
    });
    expect(r.labels).toEqual(['bd', 'update', 'pv-r', ...buildStateWriteArgs('spec:building')]);
    expect(lock.content).toBeNull();
    const writes = runner.calls.filter(c => c[0] === 'bd' && !['list', 'children'].includes(c[1]));
    expect(writes).toEqual([]);
  });
});

// =============================================================================
// Never-shell guard
// =============================================================================

describe('shell-out hygiene', () => {
  it('spawns nothing through a shell', () => {
    for (const rel of ['../lib/build.ts', '../build.ts']) {
      const src = readFileSync(resolve(__dirname, rel), 'utf-8');
      expect(src, rel).not.toMatch(/shell:\s*true/);
      expect(src, rel).not.toMatch(/\bexecSync\(|\bexec\(/);
    }
  });
});
