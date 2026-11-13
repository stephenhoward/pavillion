/**
 * Unit tests for .agents/skills/build-scheduled/scripts/lib/build.ts
 *
 * Pure functions take parsed `bd`/`gh` JSON rows or a notes string. The
 * CLI helpers take an injected Runner that returns canned results, so no
 * test touches bd, gh or git.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type BuildBead,
  type PrRow,
  type Runner,
  type RunResult,
  type LockStore,
  type WriteInput,
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
  nextFiringCount,
  rootStillOurs,
  startDecision,
  resumePoint,
  formatBuildState,
  formatStallBlock,
  writeGuard,
  applyFiring,
  firingContext,
  lockHeldBy,
  scanNotes,
  STALL_REPORT_MAX,
  recordedPrExpectations,
  validateRecordedPr,
  releaseLock,
  runStillOurs,
  runWrite,
  runValidatePrs,
  runBuildState,
  prTextCheck,
  securityHold,
  validatePublishTarget,
  runPublishPr,
  runSubmitCheck,
} from '../lib/build.js';

// =============================================================================
// Fixture builders
// =============================================================================

const NOW = new Date('2026-11-12T12:00:00Z');

/** Run ids as preflight mints them. */
const RUN_A = '0b5d2c1e-6a3f-4c2d-9e8f-1a2b3c4d5e6f';
const RUN_B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const runId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** A lock file reading held by `run`, as preflight writes it. */
const lockOf = (run: string) => ({ read: () => JSON.stringify({ pid: 10, started: NOW.toISOString(), run }) });
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

/**
 * An in-memory LockStore. `race` simulates another run writing between our
 * read and our write: `create` then finds the lock taken, and `overwrite`
 * is followed by the other run's write.
 */
function memoryLock(
  initial: string | null = null,
  race: string | null = null,
): LockStore & { content: string | null } {
  const store = {
    content: initial,
    read: () => store.content,
    create: (c: string) => {
      if (race !== null) store.content = race;
      if (store.content !== null) return false;
      store.content = c;
      return true;
    },
    overwrite: (c: string) => {
      store.content = race ?? c;
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
    expect(lockDecision(null, alive([])).verdict).toBe('take');
  });

  it('stops on a lock held by a live pid', () => {
    const d = lockDecision(`{"pid":42,"started":"2026-11-12T00:00:00Z","run":"${RUN_A}"}`, alive([42]));
    expect(d.verdict).toBe('held');
    expect(d.reading).toContain('42');
  });

  it('replaces a stale lock whose pid is dead', () => {
    expect(lockDecision('{"pid":42,"started":"x"}', alive([])).verdict).toBe('replace');
  });

  it('holds a live lock whatever its pid: one process may run two firings', () => {
    expect(lockDecision(`{"pid":10,"started":"x","run":"${RUN_A}"}`, alive([10])).verdict).toBe('held');
  });

  it.each([
    'not json', '{}', '{"pid":"42","started":"x"}', '{"pid":-1,"started":"x"}', '{"pid":4.5,"started":"x"}', '[]', '{"pid":42}',
    '{"pid":42,"started":"x","run":"not-a-uuid"}', '{"pid":42,"started":"x","run":7}',
  ])(
    'fails closed on malformed lock %j',
    content => {
      expect(lockDecision(content, alive([])).verdict).toBe('malformed');
    },
  );
});

describe('lockHeldBy', () => {
  const lock = (run?: string) => JSON.stringify({ pid: 10, started: 'x', ...(run ? { run } : {}) });

  it('holds only for the run that took the lock', () => {
    expect(lockHeldBy(lock(RUN_A), RUN_A)).toEqual({ ok: true });
    expect(lockHeldBy(lock(RUN_A), RUN_B)).toMatchObject({ ok: false, reason: expect.stringMatching(/another run/) });
    expect(lockHeldBy(lock(), RUN_A)).toMatchObject({ ok: false, reason: expect.stringMatching(/another run/) });
  });

  it('refuses with no lock, a malformed lock or a malformed run id', () => {
    expect(lockHeldBy(null, RUN_A)).toMatchObject({ ok: false, reason: expect.stringMatching(/no lock/) });
    expect(lockHeldBy('garbage', RUN_A)).toMatchObject({ ok: false, reason: expect.stringMatching(/malformed/) });
    expect(lockHeldBy(lock(RUN_A), 'pid 10')).toMatchObject({ ok: false, reason: expect.stringMatching(/run id/) });
  });
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

  it.each([
    ['an unknown __typename', { __typename: 'Mystery' }],
    ['a missing __typename', { status: 'COMPLETED', conclusion: 'SUCCESS' }],
  ])('fails closed on a status check with %s, even on a draft', (_name, entry) => {
    const r = queueGate([pr(1, 1), pr(7, 1, { isDraft: true, statusCheckRollup: [entry] })], NOW);
    expect(r).toMatchObject({ verdict: 'fail', reading: expect.stringContaining('#7') });
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
        firing: null,
        prs: [101, 102],
      },
    });
  });

  it('parses the firing line that names the run which wrote the block', () => {
    const block = stateBlock(['firings: 1', 'restart: none', `firing: ${RUN_A}`, 'chain 1: -; next: feat.alpha-one', 'stopped: none']);
    const r = parseBuildState(block);
    expect(r.ok && r.state).toMatchObject({ firing: RUN_A, chains: [{ index: 1 }] });
  });

  it.each([
    ['a firing line out of place', ['firings: 1', `firing: ${RUN_A}`, 'restart: none', 'chain 1: -; next: done', 'stopped: none']],
    ['a firing line that is not a run id', ['firings: 1', 'restart: none', 'firing: pid 500 started x', 'chain 1: -; next: done', 'stopped: none']],
    ['a firing line and no chain', ['firings: 1', 'restart: none', `firing: ${RUN_A}`, 'stopped: none']],
  ])('rejects %s', (_name, lines) => {
    expect(parseBuildState(stateBlock(lines)).ok).toBe(false);
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
    ['branch submitted twice', 'chain 1: feat.alpha → #1, feat.alpha → #2; next: done'],
    ['next that repeats a submitted branch', 'chain 1: feat.alpha → #1; next: feat.alpha'],
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

  it.each(['spec:building', 'spec:ready'])('skips a %s root whose notes end inside an open fence', label => {
    const s = selectRoot([
      bead({ id: 'pv-f', updated_at: '2026-10-01T00:00:00Z', labels: [label], notes: `${ANALYSED}\n\n\`\`\`\nunclosed` }),
      ready('pv-ok', '2026-11-09T00:00:00Z'),
    ]);
    expect(s).toMatchObject({ root: 'pv-ok', kind: 'ready' });
    expect(s.skipped).toEqual([{ id: 'pv-f', reason: 'notes end inside an open fence' }]);
  });

  it('resumes the lowest id of two spec:building roots and names the other', () => {
    const s = selectRoot([
      bead({ id: 'pv-y', labels: ['spec:building'] }),
      bead({ id: 'pv-x', labels: ['spec:building'] }),
    ]);
    expect(s).toMatchObject({ root: 'pv-x', kind: 'resume' });
    expect(s.skipped).toEqual([{ id: 'pv-y', reason: 'another spec:building root (pv-x) resumes first' }]);
  });

  it('never resumes a closed spec:building root', () => {
    const s = selectRoot([bead({ id: 'pv-c', status: 'closed', labels: ['spec:building'] })]);
    expect(s).toMatchObject({ root: null, kind: null, skipped: [] });
  });

  it.each([
    ['an id failing the root-id pattern', ready('pv-BAD', '2026-11-01T00:00:00Z'), /root-id pattern/],
    ['no updated_at', ready('pv-a', '2026-11-01T00:00:00Z', { updated_at: undefined }), /no updated_at/],
    ['an unparsable updated_at', ready('pv-a', 'yesterday'), /unparsable updated_at timestamp "yesterday"/],
    ['an unparsable label-event time', ready('pv-a', '2026-11-01T00:00:00Z', { spec_ready_at: 'soon' }), /unparsable label-event/],
    [
      'a malformed Build state block',
      ready('pv-a', '2026-11-01T00:00:00Z', { notes: `${ANALYSED}\n\n## Build state\nfirings: x` }),
      /Build state/,
    ],
  ])('skips a spec:ready root with %s', (_name, root, reason) => {
    const s = selectRoot([root, ready('pv-ok', '2026-11-09T00:00:00Z')]);
    expect(s.root).toBe('pv-ok');
    expect(s.skipped).toEqual([{ id: root.id, reason: expect.stringMatching(reason) }]);
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

  it('fails closed on a spec:built root with no Build state block', () => {
    const r = priorEpicGate([built('pv-x', '')], new Set([101]));
    expect(r).toMatchObject({ verdict: 'fail', reading: 'spec:built root pv-x has no Build state block' });
  });

  it('fails closed when bd omits the notes key', () => {
    const root = bead({ id: 'pv-x', labels: ['spec:built'] });
    delete root.notes;
    expect(priorEpicGate([root], new Set()).verdict).toBe('fail');
  });

  it('names every spec:built root with an open recorded PR', () => {
    const other = GOOD_BLOCK.replace('#101', '#201').replace('#102', '#202');
    const r = priorEpicGate([built('pv-x', GOOD_BLOCK), built('pv-y', other), built('pv-z', other)], new Set([102, 201]));
    expect(r.verdict).toBe('fail');
    expect(r.reading).toBe('pv-x has open PR #102; pv-y has open PR #201; pv-z has open PR #201');
  });

  it('passes several spec:built roots when none has an open PR', () => {
    const r = priorEpicGate([built('pv-x', GOOD_BLOCK), built('pv-y', GOOD_BLOCK, 'closed')], new Set([999]));
    expect(r).toMatchObject({ verdict: 'pass', reading: expect.stringContaining('2 spec:built') });
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

  const built = bead({ id: 'pv-x', labels: ['spec:built'], notes: GOOD_BLOCK });
  const held = [ready('pv-h', '2026-11-01T00:00:00Z', { labels: ['spec:ready', 'build:hold'] })];
  const bdDown = { error: 'bd list failed (1)' };
  const ghDown = { error: 'gh pr list failed (4)' };

  it.each([
    ['gate 2 ends a real run', [...beads, built], [pr(101, 1)], 'run', ['pass', 'fail', 'not-run', 'not-run'], 1, 'pv-x'],
    ['a dry run evaluates past gate 2', [...beads, built], [pr(101, 1)], 'dry', ['pass', 'fail', 'pass', 'pass'], 3, 'pv-r'],
    ['gate 3 ends a run with a spec:ready pick', beads, prs(QUEUE_GATE.open), 'run', ['pass', 'pass', 'fail', 'not-run'], 2, '10 open'],
    ['gate 4 fails when nothing is buildable', held, [], 'run', ['pass', 'pass', 'pass', 'fail'], 3, 'no eligible'],
    ['a bd failure ends a real run at gate 1', bdDown, [], 'run', ['fail', 'not-run', 'not-run', 'not-run'], 0, 'bd list failed'],
    ['a bd failure fails gates 1, 2 and 4 in a dry run', bdDown, [], 'dry', ['fail', 'fail', 'pass', 'fail'], 1, 'bd list failed'],
    ['a gh failure fails gate 2 with its reading', beads, ghDown, 'run', ['pass', 'fail', 'not-run', 'not-run'], 1, 'gh pr list failed'],
    ['a gh failure fails gates 2 and 3 in a dry run', beads, ghDown, 'dry', ['pass', 'fail', 'fail', 'pass'], 2, 'gh pr list failed'],
  ] as const)('%s', (_name, input, prRows, mode, verdicts, at, reading) => {
    const r = evaluateGates({ beads: input as BuildBead[], prs: prRows as PrRow[], now: NOW, mode });
    expect(r.gates.map(g => g.verdict)).toEqual(verdicts);
    expect(r.gates[at].reading).toContain(reading);
    expect(r.ok).toBe(!verdicts.includes('fail'));
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
  const deps = (lock: LockStore, alive: number[] = [10]) => ({
    lock,
    isAlive: (pid: number) => alive.includes(pid),
    ownerPid: 10,
    run: RUN_A,
    now: NOW,
  });
  const ours = JSON.stringify({ pid: 10, started: NOW.toISOString(), run: RUN_A });

  it('checks the report path, takes the lock, then checks the tree', () => {
    const lock = memoryLock();
    const runner = fakeRunner([['git check-ignore', ok('')], ['npx --no-install tsx', safe]]);
    const r = runPreflight(runner, deps(lock));
    expect(r.ok).toBe(true);
    expect(r.run).toBe(RUN_A);
    expect(r.checks.map(c => c.check)).toEqual(['report-path', 'lock', 'clean-tree']);
    expect(lock.content).toBe(ours);
    expect(runner.calls[0]).toEqual(['git', 'check-ignore', '-q', 'reports/spawn-bead-workers/']);
  });

  it('stops before touching the lock when the report path is not ignored', () => {
    const lock = memoryLock();
    const r = runPreflight(fakeRunner([['git check-ignore', failed('', 1)]]), deps(lock));
    expect(r.ok).toBe(false);
    expect(r.checks.map(c => c.verdict)).toEqual(['fail', 'not-run', 'not-run']);
    expect(lock.content).toBeNull();
  });

  it('stops on a live lock and leaves it in place', () => {
    const held = '{"pid":42,"started":"x"}';
    const lock = memoryLock(held);
    const r = runPreflight(fakeRunner([['git check-ignore', ok('')]]), deps(lock, [10, 42]));
    expect(r.checks[1].verdict).toBe('fail');
    expect(lock.content).toBe(held);
  });

  it('refuses an overlapping run from the same process, and leaves its lock', () => {
    const first = JSON.stringify({ pid: 10, started: 'x', run: RUN_B });
    const lock = memoryLock(first);
    const r = runPreflight(fakeRunner([['git check-ignore', ok('')]]), deps(lock));
    expect(r).toMatchObject({ ok: false, run: null });
    expect(r.checks[1]).toMatchObject({ verdict: 'fail', reading: expect.stringContaining('pid 10') });
    expect(lock.content).toBe(first);
  });

  it('replaces a stale lock and confirms the record is ours', () => {
    const lock = memoryLock('{"pid":42,"started":"x"}');
    const r = runPreflight(fakeRunner([['git check-ignore', ok('')], ['npx --no-install tsx', safe]]), deps(lock));
    expect(r.checks[1]).toMatchObject({ verdict: 'pass', reading: expect.stringContaining('stale') });
    expect(lock.content).toBe(ours);
  });

  it('fails closed when another run creates the lock first', () => {
    const theirs = '{"pid":77,"started":"y"}';
    const lock = memoryLock(null, theirs);
    const r = runPreflight(fakeRunner([['git check-ignore', ok('')]]), deps(lock));
    expect(r.checks[1]).toMatchObject({ verdict: 'fail', reading: expect.stringContaining('another run') });
    expect(lock.content).toBe(theirs);
  });

  it('fails closed when another run overwrites a stale lock in between', () => {
    const theirs = '{"pid":77,"started":"y"}';
    const lock = memoryLock('{"pid":42,"started":"x"}', theirs);
    const r = runPreflight(fakeRunner([['git check-ignore', ok('')]]), deps(lock));
    expect(r.checks.map(c => c.verdict)).toEqual(['pass', 'fail', 'not-run']);
    expect(lock.content).toBe(theirs);
  });

  it('refuses to take the lock for an owner pid that is not running', () => {
    const lock = memoryLock();
    const r = runPreflight(fakeRunner([['git check-ignore', ok('')]]), deps(lock, []));
    expect(r.checks[1]).toMatchObject({ verdict: 'fail', reading: 'owner pid 10 is not running' });
    expect(lock.content).toBeNull();
  });

  it('releases the lock it took when the tree is not clean', () => {
    const lock = memoryLock();
    const dirty = { stdout: '{"ok":false,"reason":"dirty tree"}', stderr: '', exitCode: 1 };
    const r = runPreflight(fakeRunner([['git check-ignore', ok('')], ['npx --no-install tsx', dirty]]), deps(lock));
    expect(r.checks[2]).toMatchObject({ verdict: 'fail', reading: expect.stringContaining('dirty tree') });
    expect(lock.content).toBeNull();
  });

  it('evaluates every check in a dry run and reads no lock', () => {
    const runner = fakeRunner([['git check-ignore', failed('', 1)], ['npx --no-install tsx', safe]]);
    const r = runPreflight(runner, null);
    expect(r.checks.map(c => c.verdict)).toEqual(['fail', 'skipped', 'pass']);
    expect(r.run).toBeNull();
  });
});

// =============================================================================
// Dry run
// =============================================================================

describe('runDryRun', () => {
  const STACK = 'npx --no-install tsx .agents/skills/bead-branch-and-pr/scripts/stack.ts';
  const plan = { chains: [['pv-r.1', 'pv-r.2']], flat: false, warnings: [] };
  const children = [
    bead({ id: 'pv-r.1', parent: 'pv-r', issue_type: 'task' }),
    bead({ id: 'pv-r.2', parent: 'pv-r', issue_type: 'task', dependencies: [{ issue_id: 'pv-r.2', depends_on_id: 'pv-r.1', type: 'blocks' }] }),
  ];

  /** Every call a dry run may make; anything else would be a write. */
  const READ_ONLY = [
    /^git check-ignore -q /,
    /^bd list --all --limit 0 --json$/,
    /^bd show [a-z0-9.-]+ --json$/,
    /^bd children [a-z0-9.-]+ --json$/,
    /^gh pr list --state open /,
    new RegExp(`^${STACK} (safe-to-start$|plan )`),
  ];

  function runnerFor(beads: BuildBead[], overrides: [string, RunResult][] = []) {
    return fakeRunner([
      ...overrides,
      ['git check-ignore', ok('')],
      [`${STACK} safe-to-start`, ok('{"ok":true}')],
      [`${STACK} plan`, ok(JSON.stringify(plan))],
      ['bd list', ok(JSON.stringify(beads))],
      ['gh pr list', ok('[]')],
      ['bd children pv-r', ok(JSON.stringify(children))],
    ]);
  }

  function expectReadOnly(calls: string[][]): void {
    for (const call of calls) {
      const line = call.join(' ');
      expect(READ_ONLY.some(re => re.test(line)), `not a read-only call: ${line}`).toBe(true);
    }
  }

  it('prints preflight, gates, selection, chain plan and labels, writing nothing', () => {
    const runner = runnerFor([ready('pv-r', '2026-11-01T00:00:00Z')]);
    const r = runDryRun(runner, NOW);
    expect(Object.keys(r)).toEqual(['preflight', 'gates', 'selection', 'chain_plan', 'labels']);
    expect(r.selection?.root).toBe('pv-r');
    expect(r.chain_plan).toEqual(plan);
    const planCall = runner.calls.find(c => c.includes('plan'))!;
    expect(JSON.parse(planCall[planCall.length - 1])).toEqual({
      beads: ['pv-r.1', 'pv-r.2'],
      edges: [{ blocker: 'pv-r.1', blocked: 'pv-r.2', dependencyType: 'blocks' }],
    });
    expect(r.labels).toEqual(['bd', 'update', 'pv-r', ...buildStateWriteArgs('spec:building')]);
    expectReadOnly(runner.calls);
  });

  it('plans a resumed root and writes no label', () => {
    const runner = runnerFor([bead({ id: 'pv-r', labels: ['spec:building'] })]);
    const r = runDryRun(runner, NOW);
    expect(r.selection).toMatchObject({ root: 'pv-r', kind: 'resume' });
    expect(r.chain_plan).toEqual(plan);
    expect(r.labels).toBe('none: root already carries spec:building');
    expectReadOnly(runner.calls);
  });

  it('reports nothing selected without planning', () => {
    const runner = runnerFor([]);
    const r = runDryRun(runner, NOW);
    expect(r).toMatchObject({ selection: { root: null }, chain_plan: null, labels: 'none: nothing selected' });
    expect(runner.calls.some(c => c.includes('plan') || c[1] === 'children')).toBe(false);
    expectReadOnly(runner.calls);
  });

  it('reports a chain-plan error as a reading, not a crash', () => {
    const runner = runnerFor([ready('pv-r', '2026-11-01T00:00:00Z')], [['bd children pv-r', failed('db locked', 2)]]);
    const r = runDryRun(runner, NOW);
    expect(r.chain_plan).toEqual({ error: expect.stringContaining('bd children') });
    expect(r.labels).toEqual(['bd', 'update', 'pv-r', ...buildStateWriteArgs('spec:building')]);
    expectReadOnly(runner.calls);
  });

  it('still selects and plans when preflight fails', () => {
    const runner = runnerFor(
      [ready('pv-r', '2026-11-01T00:00:00Z')],
      [['git check-ignore', failed('', 1)], [`${STACK} safe-to-start`, failed('', 1)]],
    );
    const r = runDryRun(runner, NOW);
    expect(r.preflight.checks.map(c => c.verdict)).toEqual(['fail', 'skipped', 'fail']);
    expect(r.selection?.root).toBe('pv-r');
    expect(r.chain_plan).toEqual(plan);
    expectReadOnly(runner.calls);
  });
});

// =============================================================================
// Counted firings
// =============================================================================

describe('nextFiringCount', () => {
  it.each(['gate-skipped', 'dry-run', 'decision-blocked', 'kill-switch'] as const)('does not count a %s firing', kind => {
    expect(nextFiringCount(1, kind)).toEqual({ count: 1, stall: false });
  });

  it('counts a firing that started or resumed a level', () => {
    expect(nextFiringCount(0, 'building')).toEqual({ count: 1, stall: false });
  });

  it('does not stall on the second counted firing and stalls on the third', () => {
    expect(nextFiringCount(1, 'building')).toEqual({ count: 2, stall: false });
    expect(nextFiringCount(MAX_FIRINGS - 1, 'building')).toEqual({ count: MAX_FIRINGS, stall: true });
  });

  it('counts but never stalls a firing that ended the build itself', () => {
    expect(nextFiringCount(MAX_FIRINGS - 1, 'ended')).toEqual({ count: MAX_FIRINGS, stall: false });
  });

  it('stays within the parser bound past MAX_FIRINGS', () => {
    expect(nextFiringCount(MAX_FIRINGS, 'building')).toEqual({ count: MAX_FIRINGS, stall: true });
  });
});

// =============================================================================
// Kill switch
// =============================================================================

describe('rootStillOurs', () => {
  it('holds a root carrying spec:building alone', () => {
    expect(rootStillOurs(['spec:building', 'office:engineering'])).toEqual({ ok: true });
  });

  it.each([
    ['build:hold', ['spec:building', 'build:hold'], /build:hold/],
    ['needs-human', ['spec:building', 'needs-human'], /needs-human/],
    ['spec:stalled', ['spec:stalled'], /spec:stalled/],
    ['spec:built', ['spec:built'], /spec:built/],
    ['no spec label', [], /absent/],
    ['two spec labels', ['spec:building', 'spec:ready'], /spec:building, spec:ready/],
  ])('stops on %s', (_name, labels, reason) => {
    const r = rootStillOurs(labels);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });
});

// =============================================================================
// Start, restart and resume
// =============================================================================

const BUILDING_BLOCK = stateBlock([
  'firings: 2',
  'restart: none',
  'chain 1: feat.alpha-one → #101; next: feat.alpha-two',
  'chain 2: -; next: fix.beta-one',
  'stopped: budget',
]);

describe('startDecision', () => {
  it('starts a spec:ready root with no block', () => {
    expect(startDecision(['spec:ready'], parseBuildState(ANALYSED))).toEqual({ action: 'start', firings: 0, restart: 'none' });
  });

  it('stalls a spec:ready root that already has a Build state block', () => {
    const r = startDecision(['spec:ready'], parseBuildState(GOOD_BLOCK));
    expect(r).toEqual({ action: 'stall', reason: expect.stringMatching(/spec:ready.*already has a Build state block/) });
  });

  it('continues a spec:building root from its last block', () => {
    const r = startDecision(['spec:building'], parseBuildState(BUILDING_BLOCK));
    expect(r).toMatchObject({ action: 'continue', firings: 2, restart: 'none' });
  });

  it('restarts a root the maintainer moved from spec:stalled: firings reset, submitted levels kept', () => {
    const stalled = BUILDING_BLOCK.replace('firings: 2', 'firings: 3').replace('stopped: budget', 'stopped: stalled');
    const r = startDecision(['spec:building'], parseBuildState(stalled));
    expect(r).toMatchObject({ action: 'restart', firings: 0, restart: 'resume' });
    if (r.action === 'restart') expect(r.state.prs).toEqual([101]);
  });

  it('stalls a spec:building root with a malformed or missing block', () => {
    const bad = parseBuildState(stateBlock(['firings: x']));
    expect(startDecision(['spec:building'], bad)).toMatchObject({ action: 'stall', reason: expect.stringMatching(/malformed/) });
    expect(startDecision(['spec:building'], parseBuildState(''))).toMatchObject({ action: 'stall', reason: expect.stringMatching(/no Build state/) });
  });

  it('stalls a root whose spec label is neither spec:ready nor spec:building', () => {
    expect(startDecision(['spec:built'], parseBuildState(GOOD_BLOCK)).action).toBe('stall');
    expect(startDecision(['spec:ready', 'spec:building'], parseBuildState('')).action).toBe('stall');
  });
});

describe('resumePoint', () => {
  const plan = [['pv-r.1', 'pv-r.2', 'pv-r.3'], ['pv-r.4']];
  const leaf = (id: string, status: string, labels: string[] = []) => bead({ id, status, labels, parent: 'pv-r', issue_type: 'task' });
  const state = () => {
    const r = parseBuildState(BUILDING_BLOCK);
    if (!r.ok || !r.state) throw new Error('fixture');
    return r.state;
  };

  it('continues each chain at its next unsubmitted level', () => {
    const r = resumePoint(state(), plan, [leaf('pv-r.1', 'closed'), leaf('pv-r.2', 'open'), leaf('pv-r.3', 'open'), leaf('pv-r.4', 'open')]);
    expect(r).toEqual({
      ok: true,
      chains: [
        { index: 1, submitted: 1, top: { branch: 'feat.alpha-one', pr: 101 }, next: 'feat.alpha-two', nextBead: 'pv-r.2' },
        { index: 2, submitted: 0, top: null, next: 'fix.beta-one', nextBead: 'pv-r.4' },
      ],
      redo: [],
    });
  });

  it('redoes a leaf left in progress, or closed, with no submitted level, and never a submitted or escalated one', () => {
    const r = resumePoint(state(), plan, [
      leaf('pv-r.1', 'in_progress'),
      leaf('pv-r.2', 'in_progress'),
      leaf('pv-r.3', 'closed'),
      leaf('pv-r.4', 'in_progress', ['needs-human']),
    ]);
    expect(r.ok && r.redo).toEqual(['pv-r.2', 'pv-r.3']);
  });

  it('has no next bead on a chain recorded done', () => {
    const done = parseBuildState(stateBlock(['firings: 1', 'restart: none', 'chain 1: feat.alpha-one → #101; next: done', 'chain 2: -; next: fix.beta-one', 'stopped: budget']));
    if (!done.ok || !done.state) throw new Error('fixture');
    const r = resumePoint(done.state, plan, [leaf('pv-r.2', 'in_progress')]);
    expect(r.ok && r.chains[0]).toMatchObject({ next: 'done', nextBead: null });
    expect(r.ok && r.redo).toEqual([]);
  });

  it.each([
    ['a different chain count', [['pv-r.1']], /2 chains.*1/],
    ['more submitted levels than the chain holds', [[], ['pv-r.4']], /chain 1/],
    ['a next branch past the chain end', [['pv-r.1'], ['pv-r.4']], /chain 1/],
  ])('stalls on %s', (_name, chains, reason) => {
    const r = resumePoint(state(), chains, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stall).toMatch(reason);
  });
});

// =============================================================================
// Block formatting and the write guard
// =============================================================================

const AT = new Date('2026-11-12T14:05:00Z');

const INPUT = {
  firings: 1,
  restart: 'none',
  chains: [
    { levels: [{ branch: 'feat.alpha-one', pr: 101 }], next: 'feat.alpha-two' },
    { levels: [], next: 'fix.beta-one' },
  ],
  stopped: 'budget: context 75%',
};

describe('formatBuildState', () => {
  it('writes the fixed line schema under a dated heading, and parses back', () => {
    const { text, state } = formatBuildState(INPUT, AT);
    expect(text).toBe([
      '## Build state (2026-11-12 14:05 UTC)',
      'firings: 1',
      'restart: none',
      'chain 1: feat.alpha-one → #101; next: feat.alpha-two',
      'chain 2: -; next: fix.beta-one',
      'stopped: budget: context 75%',
    ].join('\n'));
    expect(parseBuildState(text)).toEqual({ ok: true, state });
  });

  it('accepts the state build-state prints, extra fields included', () => {
    const parsed = parseBuildState(GOOD_BLOCK);
    if (!parsed.ok || !parsed.state) throw new Error('fixture');
    expect(formatBuildState(parsed.state, AT).state).toEqual(parsed.state);
  });

  it.each([
    ['firings over the bound', { ...INPUT, firings: MAX_FIRINGS + 1 }],
    ['fractional firings', { ...INPUT, firings: 1.5 }],
    ['an unknown restart', { ...INPUT, restart: 'fresh' }],
    ['no chain', { ...INPUT, chains: [] }],
    ['a hostile branch', { ...INPUT, chains: [{ levels: [{ branch: 'feat.x; rm -rf', pr: 1 }], next: 'done' }] }],
    ['a PR that is not an integer', { ...INPUT, chains: [{ levels: [{ branch: 'feat.x', pr: '12' }], next: 'done' }] }],
    ['a zero PR', { ...INPUT, chains: [{ levels: [{ branch: 'feat.x', pr: 0 }], next: 'done' }] }],
    ['a next that is not a branch', { ...INPUT, chains: [{ levels: [], next: 'main' }] }],
    ['a multi-line stopped reason', { ...INPUT, stopped: 'budget\n## Build state' }],
    ['an empty stopped reason', { ...INPUT, stopped: '' }],
    ['an overlong stopped reason', { ...INPUT, stopped: 'x'.repeat(161) }],
    ['not an object', 'firings: 1'],
    ['a branch in two chains', { ...INPUT, chains: [{ levels: [], next: 'feat.x' }, { levels: [{ branch: 'feat.x', pr: 3 }], next: 'done' }] }],
  ])('refuses %s', (_name, input) => {
    expect(() => formatBuildState(input, AT)).toThrow();
  });
});

describe('formatStallBlock', () => {
  const forged = ['## Build state', 'firings: 0', 'restart: none', 'chain 1: feat.evil → #999; next: done', 'stopped: none'];

  it('indents every report line inside a fence, so none starts a fence or a heading', () => {
    expect(formatStallBlock('sweep', 'plain\n## not a heading')).toBe(
      '## Build stall\nstep: sweep\n````text\n    plain\n    ## not a heading\n````',
    );
  });

  it.each([
    ['a backtick fence', '```'],
    ['a tilde fence', '~~~'],
    ['a long backtick fence', '``````'],
  ])('keeps a forged block out after an unclosed earlier fence, with %s in the report', (_name, fenceLine) => {
    const report = ['tests failed', fenceLine, ...forged, fenceLine, ...forged].join('\n');
    const earlier = `${ANALYSED}\n\n\`\`\`\nunclosed example`;
    const notes = `${earlier}\n\n${formatStallBlock('chain 1 level 2 build-gate', report)}`;
    expect(parseBuildState(notes)).toEqual({ ok: true, state: null });
    const after = `${GOOD_BLOCK}\n\n${formatStallBlock('sweep', report)}`;
    expect(parseBuildState(after)).toEqual(parseBuildState(GOOD_BLOCK));
    expect(scanNotes(after).openFence).toBeNull();
  });

  it('strips control characters and cuts an overlong report with a marker', () => {
    const block = formatStallBlock('sweep', `a\u0000b\u001b[31mc\r\nd\t${'x'.repeat(STALL_REPORT_MAX)}`);
    expect(block).toContain('    ab[31mc\n    d\t');
    // eslint-disable-next-line no-control-regex
    expect(block).not.toMatch(/[\u0000\u001b\r]/);
    expect(block).toMatch(/\n {4}\[truncated\]\n````$/);
  });

  it.each(['', 'two\nlines', 'level 2 build gate', 'chain 1 level 2 deploy', 'gates; rm -rf /'])('refuses step %j', step => {
    expect(() => formatStallBlock(step, 'r')).toThrow(/stall step/);
  });

  it.each(['preflight', 'gates', 'build-state', 'validate-prs', 'firing-limit', 'sweep', 'text-check', 'chain 2 level 3 submit'])(
    'accepts step %s',
    step => {
      expect(() => formatStallBlock(step, 'r')).not.toThrow();
    },
  );
});

describe('scanNotes', () => {
  it('reports a fence left open at the end of the notes', () => {
    expect(scanNotes('a\n~~~\nb').openFence).toBe('~~~');
    expect(scanNotes('a\n```\nb\n```').openFence).toBeNull();
  });
});

describe('writeGuard', () => {
  const root = (labels: string[], status = 'open') => bead({ id: 'pv-r', labels, status });
  const withBlock = (block: string) => bead({ id: 'pv-r', labels: ['spec:building'], notes: `${ANALYSED}\n\n${block}` });
  const STALLED_BLOCK = BUILDING_BLOCK.replace('firings: 2', 'firings: 3').replace('stopped: budget', 'stopped: stalled');
  const state = (overrides: Partial<typeof INPUT> = {}) => formatBuildState({ ...INPUT, ...overrides }, AT).state;
  const first = state({ firings: 0, chains: [{ levels: [], next: 'feat.alpha-one' }], stopped: 'none' });
  const built = state({ chains: [{ levels: [{ branch: 'feat.alpha-one', pr: 101 }], next: 'done' }], stopped: 'built' });
  const stalled = state({ stopped: 'stalled' });

  it.each([
    ['the first block over spec:ready', ['spec:ready'], 'spec:building', first, false],
    ['a level block on spec:building', ['spec:building'], null, state(), false],
    ['spec:built with every chain done', ['spec:building'], 'spec:built', built, false],
    ['spec:stalled with a block and a stall', ['spec:building'], 'spec:stalled', stalled, true],
    ['spec:stalled with only a stall (malformed last block)', ['spec:building'], 'spec:stalled', null, true],
    ['spec:stalled over spec:ready that already has a block', ['spec:ready'], 'spec:stalled', null, true],
  ] as const)('allows %s', (_name, labels, label, s, hasStall) => {
    expect(writeGuard(root([...labels]), label, s, hasStall)).toBeNull();
  });

  it.each([
    ['a block that keeps the last firing count', BUILDING_BLOCK, state({ firings: 2 })],
    ['a block that raises it', BUILDING_BLOCK, state({ firings: 3 })],
    ['a restart with firings reset after stopped: stalled', STALLED_BLOCK, state({ firings: 1, restart: 'resume' })],
  ] as const)('allows %s', (_name, last, s) => {
    expect(writeGuard(withBlock(last), null, s, false)).toBeNull();
  });

  it.each([
    ['a closed root', root(['spec:building'], 'closed'), null, state(), false, /closed/],
    ['build:hold', root(['spec:building', 'build:hold']), null, state(), false, /build:hold/],
    ['needs-human on a start', root(['spec:ready', 'needs-human']), 'spec:building', first, false, /needs-human/],
    ['a block on a root that is not spec:building', root(['spec:stalled']), null, state(), false, /spec:stalled/],
    ['spec:building over anything but spec:ready', root(['spec:building']), 'spec:building', first, false, /spec:ready/],
    ['a first block that records progress', root(['spec:ready']), 'spec:building', state(), false, /first Build state block/],
    ['spec:built with a chain not done', root(['spec:building']), 'spec:built', state(), false, /next: done/],
    ['stopped: stalled without the label', root(['spec:building']), null, stalled, false, /stalled/],
    ['spec:stalled without a stall block', root(['spec:building']), 'spec:stalled', stalled, false, /Build stall/],
    ['a stall block without the label', root(['spec:building']), null, state(), true, /Build stall/],
    ['no block on a write that is not a stall', root(['spec:building']), null, null, false, /Build state block/],
    ['a stall with no Build stall block and no state', root(['spec:building']), 'spec:stalled', null, false, /Build stall/],
    ['spec:building over a spec:ready root that has a block', bead({ id: 'pv-r', labels: ['spec:ready'], notes: GOOD_BLOCK }), 'spec:building', first, false, /never start over/],
    ['a firing count lowered below the last block\'s', withBlock(BUILDING_BLOCK), null, state({ firings: 1 }), false, /below the last block's 2/],
    ['a restart that does not follow stopped: stalled', withBlock(BUILDING_BLOCK), null, state({ firings: 0, restart: 'resume' }), false, /only follows/],
    ['a block after stopped: stalled that is not a restart', withBlock(STALLED_BLOCK), null, state({ firings: 3 }), false, /carries restart: resume/],
    ['a block over a malformed last block', withBlock('## Build state\nfirings: x'), null, state(), false, /malformed/],
    ['notes that end inside an open fence', bead({ id: 'pv-r', labels: ['spec:building'], notes: '```\nopen' }), null, state(), false, /open ``` fence/],
  ] as const)('refuses %s', (_name, b, label, s, hasStall, reason) => {
    expect(writeGuard(b, label, s, hasStall)).toMatch(reason);
  });
});

// =============================================================================
// Recorded-PR validation
// =============================================================================

describe('recordedPrExpectations', () => {
  it('expects each level on the trunk or its predecessor, merged allowed below the top', () => {
    const parsed = parseBuildState(GOOD_BLOCK);
    if (!parsed.ok || !parsed.state) throw new Error('fixture');
    expect(recordedPrExpectations(parsed.state)).toEqual([
      { pr: 101, branch: 'feat.alpha-one', predecessor: null, lowerLevel: true },
      { pr: 102, branch: 'feat.alpha-two', predecessor: 'feat.alpha-one', lowerLevel: false },
    ]);
  });
});

describe('validateRecordedPr', () => {
  const view = (overrides: Record<string, unknown> = {}) => ({
    number: 102,
    state: 'OPEN',
    author: { login: 'Maint' },
    isCrossRepository: false,
    headRefName: 'feat.alpha-two',
    baseRefName: 'feat.alpha-one',
    autoMergeRequest: null,
    ...overrides,
  });
  const top = { pr: 102, branch: 'feat.alpha-two', predecessor: 'feat.alpha-one', lowerLevel: false };
  const lower = { pr: 101, branch: 'feat.alpha-one', predecessor: null, lowerLevel: true };

  it('accepts an open PR on its predecessor or, once that merged, on the trunk', () => {
    expect(validateRecordedPr(view(), top, 'maint')).toEqual({ ok: true, merged: false });
    expect(validateRecordedPr(view({ baseRefName: 'main' }), top, 'maint')).toEqual({ ok: true, merged: false });
  });

  it('accepts a merged lower level and says to sync first', () => {
    const pr = view({ number: 101, state: 'MERGED', headRefName: 'feat.alpha-one', baseRefName: 'main' });
    expect(validateRecordedPr(pr, lower, 'maint')).toEqual({ ok: true, merged: true });
  });

  it.each([
    ['another author', view({ author: { login: 'mallory' } }), top, /author/],
    ['a fork', view({ isCrossRepository: true }), top, /fork/],
    ['a mismatched head', view({ headRefName: 'feat.other' }), top, /head/],
    ['a mismatched base', view({ baseRefName: 'feat.other' }), top, /base/],
    ['a level-1 PR on a branch base', view({ number: 101, headRefName: 'feat.alpha-one', baseRefName: 'feat.x' }), lower, /base/],
    ['a closed unmerged PR', view({ state: 'CLOSED' }), top, /CLOSED/],
    ['a merged top level', view({ state: 'MERGED' }), top, /MERGED/],
    ['another number', view({ number: 7 }), top, /#7/],
    ['auto-merge set', view({ autoMergeRequest: { enabledAt: '2026-11-12T00:00:00Z' } }), top, /auto-merge/],
    ['no auto-merge reading', (({ autoMergeRequest: _a, ...rest }) => rest)(view()), top, /autoMergeRequest/],
    ['a missing field', { number: 102, state: 'OPEN' }, top, /author/],
    ['no reading at all', null, top, /not an object/],
  ])('rejects %s', (_name, pr, expected, reason) => {
    const r = validateRecordedPr(pr, expected, 'maint');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });

  it('rejects everything when the gh login is unknown', () => {
    expect(validateRecordedPr(view(), top, '').ok).toBe(false);
  });
});

// =============================================================================
// Lock release
// =============================================================================

describe('releaseLock', () => {
  it('removes the lock this run took', () => {
    const lock = memoryLock(`{"pid":10,"started":"x","run":"${RUN_A}"}`);
    expect(releaseLock(lock, RUN_A).verdict).toBe('pass');
    expect(lock.content).toBeNull();
  });

  it.each([
    ['another run in the same process', `{"pid":10,"started":"x","run":"${RUN_B}"}`],
    ['a lock with no run id', '{"pid":10,"started":"x"}'],
    ['a malformed lock', 'garbage'],
  ])('leaves a lock held by %s', (_name, content) => {
    const lock = memoryLock(content);
    expect(releaseLock(lock, RUN_A).verdict).toBe('fail');
    expect(lock.content).toBe(content);
  });

  it('passes when there is no lock', () => {
    expect(releaseLock(memoryLock(), RUN_A)).toMatchObject({ verdict: 'pass', reading: 'no lock' });
  });
});

// =============================================================================
// CLI helpers: kill switch, write, PR validation, build state
// =============================================================================

describe('runStillOurs', () => {
  const show = (b: BuildBead) => fakeRunner([['bd show pv-r', ok(JSON.stringify([b]))]]);

  it('re-reads the root and holds it while it is spec:building', () => {
    const runner = show(bead({ id: 'pv-r', labels: ['spec:building'] }));
    expect(runStillOurs(runner, 'pv-r')).toEqual({ ok: true });
    expect(runner.calls).toEqual([['bd', 'show', 'pv-r', '--json']]);
  });

  it('stops on a closed root, a hold or an unreadable root', () => {
    expect(runStillOurs(show(bead({ id: 'pv-r', status: 'closed', labels: ['spec:building'] })), 'pv-r').ok).toBe(false);
    expect(runStillOurs(show(bead({ id: 'pv-r', labels: ['spec:building', 'build:hold'] })), 'pv-r').ok).toBe(false);
    expect(runStillOurs(fakeRunner([['bd show', failed('db locked')]]), 'pv-r')).toMatchObject({ ok: false, reason: expect.stringMatching(/db locked/) });
  });
});

describe('runWrite', () => {
  const show = (labels: string[], notes = ANALYSED) => ['bd show pv-r', ok(JSON.stringify([bead({ id: 'pv-r', labels, notes })]))] as [string, RunResult];
  const update: [string, RunResult] = ['bd update', ok('')];
  const firstInput = { chains: [{ levels: [], next: 'feat.alpha-one' }], stopped: 'none' };
  /** The last block an earlier firing wrote: one counted firing, no firing line. */
  const EARLIER = `${ANALYSED}\n\n${BUILDING_BLOCK.replace('firings: 2', 'firings: 1')}`;
  const write = (runner: Runner, overrides: Partial<WriteInput> = {}, lock: Pick<LockStore, 'read'> = lockOf(RUN_A)) => runWrite(runner, {
    root: 'pv-r', label: null, state: INPUT, stall: null, firing: 'building', run: RUN_A, now: AT, ...overrides,
  }, lock);

  it('writes spec:ready -> spec:building and the first block in one bd update, argv only', () => {
    const runner = fakeRunner([show(['spec:ready']), update]);
    const r = write(runner, { label: 'spec:building', state: firstInput, firing: null });
    expect(r.ok).toBe(true);
    const writes = runner.calls.filter(c => c[1] === 'update');
    expect(writes).toHaveLength(1);
    const argv = writes[0];
    expect(argv.slice(0, 3)).toEqual(['bd', 'update', 'pv-r']);
    expect(argv).toContain('spec:building');
    expect(argv).not.toContain('--notes');
    const notes = argv[argv.indexOf('--append-notes') + 1];
    expect(parseBuildState(notes)).toMatchObject({ ok: true, state: { firings: 0, restart: 'none', firing: RUN_A } });
  });

  it('appends a block with no label flags after a level submit, one firing above the earlier firing\'s count', () => {
    const runner = fakeRunner([show(['spec:building'], EARLIER), update]);
    expect(write(runner).ok).toBe(true);
    const argv = runner.calls.find(c => c[1] === 'update')!;
    expect(argv).not.toContain('--add-label');
    expect(argv.slice(0, 4)).toEqual(['bd', 'update', 'pv-r', '--append-notes']);
    expect(argv[4]).toBe(`\n${formatBuildState({ ...INPUT, firings: 2, firing: RUN_A }, AT).text}`);
  });

  it('derives firings and restart from the notes, whatever the input carries', () => {
    const runner = fakeRunner([show(['spec:building'], EARLIER), update]);
    expect(write(runner, { state: { ...INPUT, firings: 0, restart: 'resume' } }).ok).toBe(true);
    const argv = runner.calls.find(c => c[1] === 'update')!;
    expect(parseBuildState(argv[4])).toMatchObject({ ok: true, state: { firings: 2, restart: 'none' } });
  });

  it('stalls with the Build state and a separate fenced Build stall block in the same call', () => {
    const runner = fakeRunner([show(['spec:building']), update]);
    const stall = { step: 'chain 1 level 2 build-gate', report: '## Build state\nfirings: 0' };
    const r = write(runner, { label: 'spec:stalled', state: { ...INPUT, stopped: 'stalled' }, stall });
    expect(r.ok).toBe(true);
    const argv = runner.calls.find(c => c[1] === 'update')!;
    expect(argv).toContain('spec:stalled');
    const notes = argv[argv.indexOf('--append-notes') + 1];
    expect(notes).toMatch(/\n## Build stall\nstep: chain 1 level 2 build-gate\n````text\n {4}## Build state\n/);
    expect(parseBuildState(notes)).toMatchObject({ ok: true, state: { stopped: 'stalled' } });
  });

  it.each([
    ['the kill switch fires', [show(['spec:building', 'build:hold'])], null, INPUT, /build:hold/],
    ['the block is malformed', [show(['spec:building'])], null, { ...INPUT, stopped: '' }, /stopped/],
    ['the root cannot be read', [['bd show', failed('db locked')] as [string, RunResult]], null, INPUT, /db locked/],
    ['the label is not ours', [show(['spec:building'])], 'spec:ready', INPUT, /not a build-scheduled label/],
    ['the last block is malformed', [show(['spec:building'], `${ANALYSED}\n\n## Build state\nfirings: x`)], null, INPUT, /malformed/],
  ] as const)('writes nothing when %s', (_name, routes, label, state, reason) => {
    const runner = fakeRunner([...routes, update]);
    const r = write(runner, { label: label as never, state });
    expect(r).toMatchObject({ ok: false, reading: expect.stringMatching(reason) });
    expect(runner.calls.some(c => c[1] === 'update')).toBe(false);
  });

  it.each([
    ['there is no lock', { read: () => null }, /no lock/],
    ['another run holds the lock', lockOf(RUN_B), /another run/],
  ])('writes nothing, not even a stall, when %s', (_name, lock, reason) => {
    const runner = fakeRunner([show(['spec:building']), update]);
    expect(write(runner, {}, lock)).toMatchObject({ ok: false, reading: expect.stringMatching(reason) });
    const stall = { step: 'build-state', report: 'r' };
    expect(write(runner, { label: 'spec:stalled', state: null, stall, firing: null }, lock).ok).toBe(false);
    expect(runner.calls).toEqual([]);
  });

  it('refuses a hostile root id before any call', () => {
    const runner = fakeRunner([update]);
    expect(write(runner, { root: 'pv-r; bd delete pv-x' }).ok).toBe(false);
    expect(runner.calls).toEqual([]);
  });

  it('reports a failed bd update', () => {
    const runner = fakeRunner([show(['spec:building']), ['bd update', failed('conflict', 3)]]);
    expect(write(runner)).toMatchObject({ ok: false });
  });

  it('stalls over an unreadable block with only the Build stall block, which it requires', () => {
    const runner = fakeRunner([show(['spec:building']), update]);
    const stall = { step: 'build-state', report: 'malformed Build state block' };
    expect(write(runner, { label: 'spec:stalled', state: null, stall, firing: null }).ok).toBe(true);
    const argv = runner.calls.find(c => c[1] === 'update')!;
    expect(argv[argv.length - 1]).toBe(`\n${formatStallBlock('build-state', 'malformed Build state block')}`);

    const bare = fakeRunner([show(['spec:building']), update]);
    expect(write(bare, { label: 'spec:stalled', state: null, stall: null, firing: null }).ok).toBe(false);
    expect(bare.calls.some(c => c[1] === 'update')).toBe(false);
  });

  it('refuses the stop of a third counted firing that leaves the root building, and takes it as a stall', () => {
    const second = `${ANALYSED}\n\n${BUILDING_BLOCK}`;
    const refused = fakeRunner([show(['spec:building'], second), update]);
    expect(write(refused)).toMatchObject({ ok: false, reading: expect.stringMatching(/firing-limit/) });
    expect(refused.calls.some(c => c[1] === 'update')).toBe(false);

    const runner = fakeRunner([show(['spec:building'], second), update]);
    const stall = { step: 'firing-limit', report: 'three counted firings' };
    expect(write(runner, { label: 'spec:stalled', state: { ...INPUT, stopped: 'stalled' }, stall }).ok).toBe(true);
    const argv = runner.calls.find(c => c[1] === 'update')!;
    expect(parseBuildState(argv[argv.length - 1])).toMatchObject({ ok: true, state: { firings: MAX_FIRINGS } });
  });
});

describe('firingContext', () => {
  const G = RUN_B;
  const block = (firings: number, stopped: string, firing: string | null, restart = 'none') => stateBlock([
    `firings: ${firings}`, `restart: ${restart}`, ...(firing ? [`firing: ${firing}`] : []), 'chain 1: -; next: feat.alpha-one', `stopped: ${stopped}`,
  ]);
  const notes = (...blocks: string[]) => [ANALYSED, ...blocks].join('\n\n');

  it('starts at 0 with no block', () => {
    expect(firingContext(ANALYSED, RUN_A)).toEqual({ ok: true, firing: RUN_A, start: 0, restart: 'none', counted: false });
  });

  it('starts a new firing from the last block of an earlier one, with or without a firing line', () => {
    expect(firingContext(notes(block(2, 'budget', G)), RUN_A)).toMatchObject({ start: 2, restart: 'none', counted: false });
    expect(firingContext(notes(block(1, 'budget', null)), RUN_A)).toMatchObject({ start: 1, counted: false });
  });

  it('keeps the firing\'s starting count across the blocks it has written', () => {
    expect(firingContext(notes(block(1, 'budget', G), block(2, 'none', RUN_A), block(2, 'none', RUN_A)), RUN_A))
      .toMatchObject({ start: 1, restart: 'none', counted: true });
  });

  it('does not count a firing for its first spec:building block', () => {
    expect(firingContext(notes(block(0, 'none', RUN_A)), RUN_A)).toMatchObject({ start: 0, counted: false });
  });

  it('restarts from 0 after stopped: stalled, and resumes only the first block after it', () => {
    expect(firingContext(notes(block(3, 'stalled', G)), RUN_A)).toMatchObject({ start: 0, restart: 'resume', counted: false });
    expect(firingContext(notes(block(3, 'stalled', G), block(1, 'none', RUN_A, 'resume')), RUN_A))
      .toMatchObject({ start: 0, restart: 'none', counted: true });
  });

  it('fails on a malformed block it has to read', () => {
    expect(firingContext(notes(block(1, 'budget', G), '## Build state\nfirings: x'), RUN_A)).toMatchObject({ ok: false, stall: expect.stringMatching(/malformed/) });
  });
});

describe('applyFiring', () => {
  const ctx = (overrides: Partial<{ start: number; restart: 'none' | 'resume'; counted: boolean }> = {}) => ({
    firing: RUN_A, start: 1, restart: 'none' as const, counted: false, ...overrides,
  });

  it('derives firings, restart and the firing line, keeping only chains and stopped from the input', () => {
    expect(applyFiring({ ...INPUT, firings: 3, restart: 'resume', prs: [7] }, null, 'building', ctx()))
      .toEqual({ firings: 2, restart: 'none', firing: RUN_A, chains: INPUT.chains, stopped: INPUT.stopped });
    expect(applyFiring(INPUT, null, 'gate-skipped', ctx())).toMatchObject({ firings: 1 });
    expect(applyFiring(INPUT, null, 'building', ctx({ start: 0, restart: 'resume' }))).toMatchObject({ firings: 1, restart: 'resume' });
  });

  it('keeps a firing counted once one of its blocks counted it', () => {
    expect(applyFiring(INPUT, null, 'kill-switch', ctx({ counted: true }))).toMatchObject({ firings: 2 });
  });

  it('writes the first spec:building block at 0 with the firing line', () => {
    expect(applyFiring(firstInputOf(), 'spec:building', null, ctx({ start: 0 }))).toMatchObject({ firings: 0, restart: 'none', firing: RUN_A });
  });

  it('refuses the stop of the third counted firing that leaves the root building, never its progress blocks', () => {
    expect(() => applyFiring(INPUT, null, 'building', ctx({ start: MAX_FIRINGS - 1 }))).toThrow(/firing-limit/);
    expect(applyFiring({ ...INPUT, stopped: 'none' }, null, 'building', ctx({ start: MAX_FIRINGS - 1 }))).toMatchObject({ firings: MAX_FIRINGS });
  });

  it.each([
    ['a firing on the first block', 'spec:building', 'building', /does not go with spec:building/],
    ['no firing on a later block', null, null, /required/],
    ['an unknown firing', null, 'sometimes', /unknown firing/],
    ['spec:built from a building firing', 'spec:built', 'building', /ended/],
  ])('refuses %s', (_name, label, firing, reason) => {
    expect(() => applyFiring(INPUT, label, firing, ctx())).toThrow(reason);
  });

  function firstInputOf() {
    return { chains: [{ levels: [], next: 'feat.alpha-one' }], stopped: 'none' };
  }
});

describe('firing hand-off from build-state to write', () => {
  const STACK = 'npx --no-install tsx .agents/skills/bead-branch-and-pr/scripts/stack.ts';
  const children = ['pv-r.1', 'pv-r.2', 'pv-r.3', 'pv-r.4'].map(id => bead({ id, parent: 'pv-r', issue_type: 'task' }));
  const plan = { chains: [['pv-r.1', 'pv-r.2', 'pv-r.3'], ['pv-r.4']], flat: false, warnings: [] };

  /** A root whose notes and labels every bd update changes, as bd does. */
  function memoryRoot(initial: BuildBead): Runner & { root: BuildBead } {
    const root = { ...initial, labels: [...(initial.labels ?? [])] };
    const runner = ((cmd: string, args: string[]) => {
      const line = [cmd, ...args].join(' ');
      if (line === 'bd show pv-r --json') return ok(JSON.stringify([root]));
      if (line === 'bd children pv-r --json') return ok(JSON.stringify(children));
      if (line.startsWith(`${STACK} plan`)) return ok(JSON.stringify(plan));
      if (cmd === 'bd' && args[0] === 'update' && args[1] === 'pv-r') {
        for (let i = 2; i < args.length; i += 2) {
          const value = args[i + 1];
          if (args[i] === '--remove-label') root.labels = root.labels.filter(l => l !== value);
          else if (args[i] === '--add-label') root.labels.push(value);
          else if (args[i] === '--append-notes') root.notes = `${root.notes ?? ''}${value}`;
          else return failed(`unexpected flag ${args[i]}`);
        }
        return ok('');
      }
      return failed(`unexpected call: ${line}`);
    }) as Runner & { root: BuildBead };
    runner.root = root;
    return runner;
  }

  /** The `next_state` build-state prints, as the agent copies it into a state file. */
  function printed(runner: Runner) {
    const r = runBuildState(runner, 'pv-r');
    expect(r.ok).toBe(true);
    if (!r.next_state) throw new Error('build-state printed no next_state');
    return r.next_state;
  }

  /** That state with one more submitted level on chain `k` (0-based). */
  function submitted(runner: Runner, k: number, branch: string, pr: number, next: string) {
    const state = printed(runner);
    return {
      ...state,
      chains: state.chains.map((c, i) => (i === k ? { ...c, levels: [...c.levels, { branch, pr }], next } : c)),
      stopped: 'none',
    };
  }

  /** A write by firing `n`: every firing's lock names the same pid, as one long-lived process would. */
  const write = (runner: Runner, n: number, state: unknown, overrides: Partial<WriteInput> = {}) => runWrite(runner, {
    root: 'pv-r', label: null, state, stall: null, firing: 'building', run: runId(n), now: AT, ...overrides,
  }, lockOf(runId(n)));

  /** Every block's firings and restart, in order. */
  const recorded = (runner: Runner & { root: BuildBead }) =>
    [...(runner.root.notes ?? '').matchAll(/^firings: (\d+)\nrestart: (\w+)$/gm)].map(m => `${m[1]} ${m[2]}`);

  it('counts a start firing once however many blocks it writes, and each later firing of the same process once more', () => {
    const runner = memoryRoot(bead({ id: 'pv-r', labels: ['spec:ready'] }));
    const started = runBuildState(runner, 'pv-r');
    expect(started.start).toEqual({ action: 'start', firings: 0, restart: 'none' });
    expect(started.next_state).toEqual({
      chains: [{ levels: [], next: null, first_leaf: 'pv-r.1' }, { levels: [], next: null, first_leaf: 'pv-r.4' }],
      stopped: 'none',
    });
    // Unedited, the start state is refused: next must name a branch.
    expect(write(runner, 600, started.next_state, { label: 'spec:building', firing: null })).toMatchObject({ ok: false, reading: expect.stringMatching(/next/) });
    const branch: Record<string, string> = { 'pv-r.1': 'feat.alpha-one', 'pv-r.4': 'fix.beta-one' };
    const first = { ...started.next_state!, chains: started.next_state!.chains.map(c => ({ ...c, next: branch[c.first_leaf!] })) };
    expect(write(runner, 600, first, { label: 'spec:building', firing: null })).toMatchObject({ ok: true });

    // One firing: three submits, then a budget stop. None is refused.
    expect(write(runner, 600, submitted(runner, 0, 'feat.alpha-one', 101, 'feat.alpha-two'))).toMatchObject({ ok: true });
    expect(write(runner, 600, submitted(runner, 1, 'fix.beta-one', 102, 'done'))).toMatchObject({ ok: true });
    expect(write(runner, 600, submitted(runner, 0, 'feat.alpha-two', 103, 'feat.alpha-three'))).toMatchObject({ ok: true });
    expect(write(runner, 600, { ...printed(runner), stopped: 'budget: context 75%' })).toMatchObject({ ok: true });
    expect(recorded(runner)).toEqual(['0 none', '1 none', '1 none', '1 none', '1 none']);

    // The next firing resumes and counts once more.
    expect(runBuildState(runner, 'pv-r').start).toMatchObject({ action: 'continue', firings: 1 });
    expect(write(runner, 601, submitted(runner, 0, 'feat.alpha-three', 104, 'done'))).toMatchObject({ ok: true });
    expect(write(runner, 601, { ...printed(runner), stopped: 'budget: session 92%' })).toMatchObject({ ok: true });
    expect(recorded(runner).slice(5)).toEqual(['2 none', '2 none']);

    // The third counted firing may not stop at spec:building; spec:stalled takes it.
    expect(write(runner, 602, { ...printed(runner), stopped: 'budget: context 75%' }))
      .toMatchObject({ ok: false, reading: expect.stringMatching(/firing-limit/) });
    const stall = { step: 'firing-limit', report: 'three counted firings' };
    expect(write(runner, 602, { ...printed(runner), stopped: 'stalled' }, { label: 'spec:stalled', stall })).toMatchObject({ ok: true });
    expect(recorded(runner).slice(7)).toEqual(['3 none']);
    expect(runner.root.labels).toContain('spec:stalled');
  });

  it('restarts from build-state\'s next_state after a stall: the count resets, then rises by one per firing', () => {
    const stalled = stateBlock(['firings: 3', 'restart: none', 'chain 1: feat.alpha-one → #101; next: feat.alpha-two', 'chain 2: -; next: fix.beta-one', 'stopped: stalled']);
    const runner = memoryRoot(bead({ id: 'pv-r', labels: ['spec:building'], notes: `${ANALYSED}\n\n${stalled}` }));
    expect(runBuildState(runner, 'pv-r').start).toMatchObject({ action: 'restart', firings: 0, restart: 'resume' });

    // The last block still reads firings 3; write derives the restart itself.
    expect(write(runner, 700, submitted(runner, 0, 'feat.alpha-two', 102, 'feat.alpha-three'))).toMatchObject({ ok: true });
    expect(write(runner, 700, submitted(runner, 1, 'fix.beta-one', 103, 'done'))).toMatchObject({ ok: true });
    expect(write(runner, 700, submitted(runner, 0, 'feat.alpha-three', 104, 'done'))).toMatchObject({ ok: true });
    expect(write(runner, 700, { ...printed(runner), stopped: 'budget: context 75%' })).toMatchObject({ ok: true });

    expect(write(runner, 701, { ...printed(runner), stopped: 'budget: context 75%' })).toMatchObject({ ok: true });
    expect(recorded(runner)).toEqual(['3 none', '1 resume', '1 none', '1 none', '1 none', '2 none']);
  });
});

describe('runValidatePrs', () => {
  const notes = `${ANALYSED}\n\n${GOOD_BLOCK}`;
  const view = (n: number, overrides: Record<string, unknown> = {}) => ok(JSON.stringify({
    number: n,
    state: 'OPEN',
    author: { login: 'maint' },
    isCrossRepository: false,
    headRefName: n === 101 ? 'feat.alpha-one' : 'feat.alpha-two',
    baseRefName: n === 101 ? 'main' : 'feat.alpha-one',
    autoMergeRequest: null,
    ...overrides,
  }));
  const routes = (pr102: RunResult): [string, RunResult][] => [
    ['bd show pv-r', ok(JSON.stringify([bead({ id: 'pv-r', labels: ['spec:building'], notes })]))],
    ['gh api user', ok('maint')],
    ['gh pr view 101', view(101, { state: 'MERGED' })],
    ['gh pr view 102', pr102],
    ['git ls-remote', { stdout: '', stderr: '', exitCode: 2 }],
  ];

  it('validates every recorded PR read-only and says to sync after a merged lower level', () => {
    const runner = fakeRunner(routes(view(102)));
    const r = runValidatePrs(runner, 'pv-r');
    expect(r).toMatchObject({ ok: true, sync_first: true, next: [{ branch: 'fix.beta-one', ok: true }] });
    expect(r.prs.map(p => p.pr)).toEqual([101, 102]);
    expect(runner.calls).toContainEqual(['gh', 'pr', 'view', '102', '--json', 'number,state,author,isCrossRepository,headRefName,baseRefName,autoMergeRequest']);
    expect(runner.calls).toContainEqual(['git', 'ls-remote', '--exit-code', '--heads', 'origin', 'refs/heads/fix.beta-one']);
    for (const call of runner.calls) expect(call.join(' ')).toMatch(/^(bd show|gh api user --jq \.login$|gh pr view |git ls-remote )/);
  });

  it('fails on any mismatch or unreadable PR', () => {
    expect(runValidatePrs(fakeRunner(routes(view(102, { author: { login: 'mallory' } }))), 'pv-r').ok).toBe(false);
    expect(runValidatePrs(fakeRunner(routes(failed('not found'))), 'pv-r').ok).toBe(false);
  });

  it('says no sync is needed when every recorded PR is open', () => {
    const r = runValidatePrs(fakeRunner([['gh pr view 101', view(101)], ...routes(view(102))]), 'pv-r');
    expect(r).toMatchObject({ ok: true, sync_first: false });
  });

  it.each([
    ['already on origin', ok('abc\trefs/heads/fix.beta-one'), /already on origin/],
    ['unreadable', failed('no network', 128), /ls-remote failed/],
  ])('stalls when a next branch is %s', (_name, lsRemote, reason) => {
    const r = runValidatePrs(fakeRunner([['git ls-remote', lsRemote], ...routes(view(102))]), 'pv-r');
    expect(r.ok).toBe(false);
    expect(r.next[0].reading).toMatch(reason);
  });

  it('fails when the root has no Build state block', () => {
    const runner = fakeRunner([['bd show pv-r', ok(JSON.stringify([bead({ id: 'pv-r' })]))]]);
    expect(runValidatePrs(runner, 'pv-r')).toMatchObject({ ok: false, reading: 'pv-r has no Build state block' });
  });

  it('fails when the gh login cannot be read', () => {
    const runner = fakeRunner([routes(view(102))[0], ['gh api user', failed('auth')]]);
    expect(runValidatePrs(runner, 'pv-r')).toMatchObject({ ok: false, reading: expect.stringMatching(/login/) });
  });

  it('fails on a malformed last block', () => {
    const bad = `${notes}\n\n## Build state\nfirings: x`;
    const runner = fakeRunner([['bd show pv-r', ok(JSON.stringify([bead({ id: 'pv-r', notes: bad })]))]]);
    expect(runValidatePrs(runner, 'pv-r')).toMatchObject({ ok: false, reading: expect.stringMatching(/malformed/) });
  });

  describe('with text (the post-submit check)', () => {
    const CLEAN = { title: 'feat(agents): add the thing', body: '## Motivation\n\nWhy.\n\n## Approach\n\nHow.\n\n## Validation\n\nVerified.' };
    const textRoutes = (pr102: Record<string, unknown>): [string, RunResult][] => [
      ['gh pr view 101', view(101, { state: 'MERGED', ...CLEAN })],
      ...routes(view(102, { ...CLEAN, ...pr102 })),
    ];

    it('reads title and body with the validation fields and passes clean published text', () => {
      const runner = fakeRunner(textRoutes({}));
      const r = runValidatePrs(runner, 'pv-r', { text: true });
      expect(r.ok).toBe(true);
      expect(runner.calls).toContainEqual(['gh', 'pr', 'view', '102', '--json', 'number,state,author,isCrossRepository,headRefName,baseRefName,autoMergeRequest,title,body']);
    });

    it.each([
      ['a bead id in the body', { body: 'Implements pv-256c.4.' }],
      ['a session trailer in the title', { title: 'Claude-Session: abc' }],
    ])('fails on %s', (_name, published) => {
      const r = runValidatePrs(fakeRunner(textRoutes(published)), 'pv-r', { text: true });
      expect(r.ok).toBe(false);
      expect(r.prs.find(p => p.pr === 102)).toMatchObject({ ok: false, reason: expect.stringMatching(/#102: published text/) });
    });

    it('fails closed when title or body is missing', () => {
      const r = runValidatePrs(fakeRunner(textRoutes({ body: null })), 'pv-r', { text: true });
      expect(r.prs.find(p => p.pr === 102)).toMatchObject({ ok: false, reason: expect.stringMatching(/body/) });
    });

    it('does not read title or body without it', () => {
      const runner = fakeRunner(textRoutes({ body: 'pv-256c' }));
      expect(runValidatePrs(runner, 'pv-r').ok).toBe(true);
      const fields = runner.calls.filter(c => c[1] === 'pr' && c[2] === 'view').map(c => c[5].split(','));
      expect(fields.length).toBe(2);
      for (const f of fields) expect(f).not.toEqual(expect.arrayContaining(['title']));
      for (const f of fields) expect(f).not.toEqual(expect.arrayContaining(['body']));
    });

    it('fails on a published head branch that carries a bead id', () => {
      const block = stateBlock(['firings: 1', 'restart: none', 'chain 1: feat.pv-abcd-two → #102; next: done', 'stopped: none']);
      const runner = fakeRunner([
        ['bd show pv-r', ok(JSON.stringify([bead({ id: 'pv-r', labels: ['spec:building'], notes: `${ANALYSED}\n\n${block}` })]))],
        ['gh api user', ok('maint')],
        ['gh pr view 102', view(102, { ...CLEAN, headRefName: 'feat.pv-abcd-two', baseRefName: 'main' })],
      ]);
      const r = runValidatePrs(runner, 'pv-r', { text: true });
      expect(r.ok).toBe(false);
      expect(r.prs[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/bead-id "pv-abcd"/) });
    });
  });
});

describe('runBuildState', () => {
  const STACK = 'npx --no-install tsx .agents/skills/bead-branch-and-pr/scripts/stack.ts';
  const leaf = (id: string, status: string) => bead({ id, status, parent: 'pv-r', issue_type: 'task' });
  const children = [leaf('pv-r.1', 'closed'), leaf('pv-r.2', 'in_progress'), leaf('pv-r.3', 'open')];
  const plan = { chains: [['pv-r.1', 'pv-r.2'], ['pv-r.3']], flat: false, warnings: [] };
  const runner = (notes: string, labels = ['spec:building']) => fakeRunner([
    ['bd show pv-r', ok(JSON.stringify([bead({ id: 'pv-r', labels, notes })]))],
    ['bd children pv-r', ok(JSON.stringify(children))],
    [`${STACK} plan`, ok(JSON.stringify(plan))],
  ]);

  it('resumes a run cut off between levels at the next unsubmitted level', () => {
    const r = runBuildState(runner(`${ANALYSED}\n\n${BUILDING_BLOCK}`), 'pv-r');
    expect(r.ok).toBe(true);
    expect(r.start).toMatchObject({ action: 'continue', firings: 2 });
    expect(r.resume).toMatchObject({
      ok: true,
      chains: [{ index: 1, submitted: 1, nextBead: 'pv-r.2' }, { index: 2, submitted: 0, nextBead: 'pv-r.3' }],
      redo: ['pv-r.2'],
    });
    // The next firing that resumes a level counts once more.
    expect(nextFiringCount(r.start.action === 'continue' ? r.start.firings : -1, 'building').count).toBe(3);
  });

  it('restarts a root moved back from spec:stalled, carrying its submitted levels', () => {
    const stalled = BUILDING_BLOCK.replace('firings: 2', 'firings: 3').replace('stopped: budget', 'stopped: stalled');
    const r = runBuildState(runner(`${ANALYSED}\n\n${stalled}`), 'pv-r');
    expect(r).toMatchObject({ ok: true, start: { action: 'restart', firings: 0, restart: 'resume' } });
    expect(r.resume).toMatchObject({ ok: true, chains: [{ submitted: 1, top: { pr: 101 }, nextBead: 'pv-r.2' }, { submitted: 0 }] });
  });

  it('reports an unusable chain plan as a failed resume', () => {
    const bad = fakeRunner([
      ['bd show pv-r', ok(JSON.stringify([bead({ id: 'pv-r', labels: ['spec:building'], notes: BUILDING_BLOCK })]))],
      ['bd children pv-r', ok(JSON.stringify(children))],
      [`${STACK} plan`, ok('{"flat":true}')],
    ]);
    expect(runBuildState(bad, 'pv-r')).toMatchObject({ ok: false, resume: { error: expect.stringMatching(/chains/) } });
  });

  it('starts a spec:ready root with a next_state built from the chain plan, and no resume', () => {
    const r = runBuildState(runner(ANALYSED, ['spec:ready']), 'pv-r');
    expect(r).toMatchObject({ ok: true, start: { action: 'start' }, resume: null });
    expect(r.next_state).toEqual({
      chains: [{ levels: [], next: null, first_leaf: 'pv-r.1' }, { levels: [], next: null, first_leaf: 'pv-r.3' }],
      stopped: 'none',
    });
  });

  it('prints the last block\'s chains as next_state on continue, without firings or restart', () => {
    const r = runBuildState(runner(`${ANALYSED}\n\n${BUILDING_BLOCK}`), 'pv-r');
    expect(r.next_state).toEqual({
      chains: [{ levels: [{ branch: 'feat.alpha-one', pr: 101 }], next: 'feat.alpha-two' }, { levels: [], next: 'fix.beta-one' }],
      stopped: 'none',
    });
  });

  it('stalls on a spec:ready root with a block, and on a plan that no longer matches', () => {
    expect(runBuildState(runner(`${ANALYSED}\n\n${GOOD_BLOCK}`, ['spec:ready']), 'pv-r')).toMatchObject({ ok: false, start: { action: 'stall' } });
    const three = stateBlock(['firings: 1', 'restart: none', 'chain 1: -; next: feat.a', 'chain 2: -; next: feat.b', 'chain 3: -; next: feat.c', 'stopped: budget']);
    expect(runBuildState(runner(three), 'pv-r')).toMatchObject({ ok: false, resume: { ok: false } });
  });
});

describe('chainPlanInput ordering', () => {
  it('orders children by id, numerically, so the chain plan is the same every firing', () => {
    const ids = ['pv-r.10', 'pv-r.2', 'pv-r.1'].map(id => bead({ id, parent: 'pv-r', issue_type: 'task' }));
    expect(chainPlanInput(ids).beads).toEqual(['pv-r.1', 'pv-r.2', 'pv-r.10']);
  });
});

// =============================================================================
// Publication text check
// =============================================================================

describe('prTextCheck', () => {
  const TEMPLATE = [
    '## Motivation',
    '',
    'Scheduled epic builds left the sweep blind to every chain but one.',
    '',
    '## Approach',
    '',
    'Changed 3 files under .agents/skills/ and .agents/commands/.',
    '',
    '## Validation',
    '',
    '- build-guardian: pass',
    '- architecture-auditor: pass with warnings',
    '- Reviewed with #1201 and #1204; commit 8ce8bbc4f0e1a2b3c4d5e6f708192a3b4c5d6e7f.',
    '- `npx vitest run --config .agents/tools/vitest.config.ts` passes.',
  ].join('\n');

  it('passes a clean template body', () => {
    expect(prTextCheck(TEMPLATE)).toEqual([]);
  });

  it.each([
    ['a bead id', 'Implements pv-256c.', 'bead-id', 'pv-256c'],
    ['a child bead id', 'see pv-256c.4 for details', 'bead-id', 'pv-256c.4'],
    ['a bead id in a branch name', 'chore.pv-mgsz-scheduled', 'bead-id', 'pv-mgsz'],
    ['a bead id after an underscore', 'feature_pv-256c-thing', 'bead-id', 'pv-256c'],
    ['a bead id after a digit', 'fix2pv-256c', 'bead-id', 'pv-256c'],
    ['a macOS home path', 'saved to /Users/someone/notes.md', 'home-path', '/Users/someone'],
    ['a lower-case home path', 'see /users/someone/notes', 'home-path', '/users/someone'],
    ['a Linux home path', 'cat /home/dev/.config', 'home-path', '/home/dev'],
    ['the root home', 'ls /root/.ssh', 'home-path', '/root'],
    ['a Windows home path', 'C:\\Users\\someone\\x', 'home-path', 'C:\\Users\\someone'],
    ['a Windows home path with forward slashes', 'C:/Users/someone/x', 'home-path', 'C:/Users/someone'],
    ['a tilde home path', 'read ~/.claude/settings.json', 'home-path', '~/.claude/settings.json'],
    ['a named tilde home path', 'in ~someone/notes', 'home-path', '~someone/notes'],
    ['a mounted volume', 'copied to /Volumes/Backup/x', 'home-path', '/Volumes/Backup'],
    ['a private temp path', 'at /private/tmp/x.md', 'home-path', '/private/tmp/x.md'],
    ['a private var path', 'at /private/var/db/x', 'home-path', '/private/var/db/x'],
    ['a per-user temp folder', 'at /var/folders/ab/T/x', 'home-path', '/var/folders/ab/T/x'],
    ['an agent temp path', 'at /tmp/claude-501/x', 'home-path', '/tmp/claude-501/x'],
    ['a home encoded into a path segment', 'project -Users-someone--repo', 'home-path', '-Users-someone-'],
    ['a Claude-Session trailer', 'fix: x\n\nClaude-Session: https://example.test/s/1', 'session-trailer', 'Claude-Session:'],
    ['a bulleted session trailer', '- Claude-Session: abc', 'session-trailer', '- Claude-Session:'],
    ['a quoted assistant co-author', '> Co-authored-by: Claude <noreply@anthropic.com>', 'session-trailer', '> Co-authored-by: Claude <noreply@anthropic.com>'],
    ['an assistant co-author trailer', 'Co-authored-by: Claude <noreply@anthropic.com>', 'session-trailer', 'Co-authored-by: Claude <noreply@anthropic.com>'],
    ['a Generated-by trailer', 'Generated-by: some tool', 'session-trailer', 'Generated-by: some tool'],
    ['a generated-with footer', '🤖 Generated with [Claude Code](https://claude.com/claude-code)', 'session-trailer', 'Generated with [Claude'],
    ['a bare generated-with line', 'Generated with Claude', 'session-trailer', 'Generated with Claude'],
    ['a session URL', 'https://claude.ai/code/session_01Hx', 'session-trailer', 'claude.ai/code/session_01Hx'],
    ['an office label', 'labels: office:engineering', 'office-label', 'office:engineering'],
    ['an email address', 'ask someone@example.org', 'email', 'someone@example.org'],
  ])('rejects %s', (_name, text, rule, match) => {
    expect(prTextCheck(text)).toContainEqual(expect.objectContaining({ rule, match }));
  });

  it.each([
    ['a GitHub token', `token ghp_${'a1B2'.repeat(9)}`, 'ghp_'],
    ['a fine-grained GitHub token', `github_pat_${'x9Y'.repeat(10)}`, 'gith'],
    ['a Stripe secret key', `sk_live_${'Ab1'.repeat(8)}`, 'sk_l'],
    ['a Stripe restricted key', `rk_test_${'Ab1'.repeat(8)}`, 'rk_t'],
    ['a Stripe publishable key', `pk_live_${'Ab1'.repeat(8)}`, 'pk_l'],
    ['a webhook secret', `whsec_${'Ab1'.repeat(8)}`, 'whse'],
    ['an Anthropic key', `sk-ant-${'Ab1_'.repeat(8)}`, 'sk-a'],
    ['an AWS access key', 'AKIAABCDEFGHIJKLMNOP', 'AKIA'],
    ['an AWS session key', 'ASIAABCDEFGHIJKLMNOP', 'ASIA'],
    ['a Slack token', 'xoxb-1234567890-abcdef', 'xoxb'],
    ['a Slack webhook', 'https://hooks.slack.com/services/T0/B0/XXXX', 'hook'],
    ['an npm token', `npm_${'a1B2c3D4'.repeat(4)}ab12`, 'npm_'],
    ['a Google API key', `AIza${'A1b2C3d4E5'.repeat(3)}abcde`, 'AIza'],
    ['a private key header', '-----BEGIN OPENSSH PRIVATE KEY-----', '----'],
    ['a JWT', 'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4f', 'eyJh'],
    ['a hex run longer than a SHA', `secret ${'3f2a9c1b'.repeat(8)}`, '3f2a'],
    ['a long mixed-case secret', `secret=${'Q7wErTy9'.repeat(5)}`, 'secr'],
  ])('rejects %s, showing only its first four characters', (_name, text, prefix) => {
    const tokens = prTextCheck(text).filter(m => m.rule === 'token');
    expect(tokens.map(m => m.match)).toEqual([`${prefix}…`]);
  });

  it('names the line of each match', () => {
    expect(prTextCheck('clean\nalso clean\nsee pv-abcd')).toEqual([{ rule: 'bead-id', line: 3, match: 'pv-abcd' }]);
  });

  it.each([
    ['a commit SHA', 'commit 8ce8bbc4f0e1a2b3c4d5e6f708192a3b4c5d6e7f'],
    ['a kebab-case agent name', 'cross-bead-integration-verifier-and-architecture-auditor'],
    ['a repository path', '.agents/skills/build-scheduled/scripts/lib/build.ts'],
    ['a long camelCase path', 'src/server/activitypub/test/federatedReportRoutingOAuth2IntegrationScenarios.test.ts'],
    ['a word ending in pv', 'npv-1234 is not a bead'],
    ['a human co-author', 'Co-authored-by: Jane Doe <jane@users.noreply.github.com>'],
    ['a package at a version', 'bumps vitest@4.0.1 and @anthropic-ai/sdk@0.30.1'],
  ])('accepts %s', (_name, text) => {
    expect(prTextCheck(text)).toEqual([]);
  });
});

// =============================================================================
// Publishing a PR
// =============================================================================

describe('securityHold', () => {
  it.each([['security'], ['cve-watch']])('holds a leaf carrying %s', label => {
    expect(securityHold(['office:x', label])).toMatch(label);
  });

  it('lets any other leaf through', () => {
    expect(securityHold(['bug', 'needs-review'])).toBeNull();
  });
});

describe('validatePublishTarget', () => {
  const view = (overrides: Record<string, unknown> = {}) => ({
    number: 102,
    state: 'OPEN',
    author: { login: 'Maint' },
    isCrossRepository: false,
    headRefName: 'feat.alpha-two',
    baseRefName: 'feat.alpha-one',
    autoMergeRequest: null,
    ...overrides,
  });

  it('accepts an open PR of ours and returns its head and base', () => {
    expect(validatePublishTarget(view(), 102, 'maint')).toEqual({ ok: true, head: 'feat.alpha-two', base: 'feat.alpha-one' });
    expect(validatePublishTarget(view({ baseRefName: 'main' }), 102, 'maint')).toMatchObject({ ok: true, base: 'main' });
  });

  it.each([
    ['another number', view({ number: 7 }), /returned #7/],
    ['a merged PR', view({ state: 'MERGED' }), /MERGED/],
    ['another author', view({ author: { login: 'mallory' } }), /author/],
    ['a fork', view({ isCrossRepository: true }), /repository/],
    ['auto-merge set', view({ autoMergeRequest: { enabledAt: 'x' } }), /auto-merge/],
    ['no auto-merge reading', (({ autoMergeRequest: _a, ...rest }) => rest)(view()), /auto-merge/],
    ['a head that is not a branch name', view({ headRefName: '--upload-pack=x' }), /head/],
    ['a base that is not a branch name', view({ baseRefName: 'feat/x' }), /base/],
    ['no reading', null, /not an object/],
    ['no fork reading', (({ isCrossRepository: _c, ...rest }) => rest)(view()), /repository/],
  ])('rejects %s', (_name, pr, reason) => {
    const r = validatePublishTarget(pr, 102, 'maint');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });
});

describe('runPublishPr', () => {
  const BODY = '## Motivation\n\nWhy.\n\n## Approach\n\nHow.\n\n## Validation\n\nbuild-guardian: pass';
  const input = (overrides: Partial<Parameters<typeof runPublishPr>[1]> = {}) => ({
    root: 'pv-r',
    pr: 102,
    leaf: 'pv-r.2',
    title: 'feat(agents): add the thing\n',
    body: BODY,
    ...overrides,
  });
  const prView = (overrides: Record<string, unknown> = {}) => ok(JSON.stringify({
    number: 102,
    state: 'OPEN',
    author: { login: 'maint' },
    isCrossRepository: false,
    headRefName: 'feat.alpha-two',
    baseRefName: 'feat.alpha-one',
    autoMergeRequest: null,
    ...overrides,
  }));
  const routes = (o: { leafLabels?: string[]; view?: RunResult; log?: string; rootLabels?: string[] } = {}): [string, RunResult][] => [
    ['bd show pv-r.2', ok(JSON.stringify([bead({ id: 'pv-r.2', parent: 'pv-r', issue_type: 'task', labels: o.leafLabels ?? [] })]))],
    ['bd show pv-r', ok(JSON.stringify([bead({ id: 'pv-r', labels: o.rootLabels ?? ['spec:building'] })]))],
    ['gh api user', ok('maint')],
    ['gh pr view 102', o.view ?? prView()],
    ['git fetch', ok('')],
    ['git log', ok(o.log ?? 'feat(agents): add the thing\n\nBody text.')],
    ['gh pr edit', ok('')],
  ];

  it('checks everything, then edits the PR through argv with the checked title', () => {
    const runner = fakeRunner(routes());
    const r = runPublishPr(runner, input({ title: 'feat(agents): `id` $(whoami)\n' }));
    expect(r).toMatchObject({ ok: true, hold: false });
    expect(runner.calls).toContainEqual([
      'git', 'fetch', '--quiet', 'origin',
      '+refs/heads/feat.alpha-one:refs/remotes/origin/feat.alpha-one',
      '+refs/heads/feat.alpha-two:refs/remotes/origin/feat.alpha-two',
    ]);
    expect(runner.calls).toContainEqual(['git', 'log', '--format=%B', 'origin/feat.alpha-one..origin/feat.alpha-two']);
    const edit = runner.calls[runner.calls.length - 1];
    expect(edit.slice(0, 7)).toEqual(['gh', 'pr', 'edit', '102', '--title', 'feat(agents): `id` $(whoami)', '--body-file']);
  });

  it('publishes the body it checked from a file of its own, removed afterwards', () => {
    let published: { path: string; text: string } | null = null;
    const base = fakeRunner(routes());
    const runner = ((cmd: string, args: string[]) => {
      if (cmd === 'gh' && args[1] === 'edit') {
        const path = args[args.indexOf('--body-file') + 1];
        published = { path, text: readFileSync(path, 'utf-8') };
      }
      return base(cmd, args);
    }) as Runner;
    expect(runPublishPr(runner, input()).ok).toBe(true);
    expect(published).not.toBeNull();
    const { path, text } = published!;
    expect(text).toBe(BODY);
    expect(path).toMatch(/publish-pr-[^/]+\/body\.md$/);
    expect(existsSync(path)).toBe(false);
  });

  it.each([['security'], ['cve-watch']])('holds a %s leaf and touches no PR', label => {
    const runner = fakeRunner(routes({ leafLabels: [label] }));
    expect(runPublishPr(runner, input())).toMatchObject({ ok: false, hold: true });
    expect(runner.calls.map(c => c.slice(0, 2).join(' '))).toEqual(['bd show']);
  });

  it.each([
    ['the title', { title: 'fix: pv-abcd' }, {}, 'title'],
    ['the body', { body: `${BODY}\n\nSaved in /Users/someone/x` }, {}, 'body'],
    ['the head branch', {}, { view: prView({ headRefName: 'feat.pv-abcd-two' }) }, 'branch'],
    ['a published commit', {}, { log: 'fix: x\n\nClaude-Session: abc' }, 'commits'],
  ])('publishes nothing when %s fails the text check', (_name, over, route, source) => {
    const runner = fakeRunner(routes(route));
    const r = runPublishPr(runner, input(over));
    expect(r.ok).toBe(false);
    expect(r.matches.map(m => m.source)).toContain(source);
    expect(runner.calls.some(c => c[1] === 'pr' && c[2] === 'edit')).toBe(false);
  });

  it.each([
    ['auto-merge set on the PR', { view: prView({ autoMergeRequest: { enabledAt: 'x' } }) }, /auto-merge/],
    ['the kill switch', { rootLabels: ['spec:building', 'build:hold'] }, /kill switch/],
    ['an unreadable PR', { view: failed('not found') }, /gh pr view/],
  ])('edits nothing on %s', (_name, route, reason) => {
    const runner = fakeRunner(routes(route));
    const r = runPublishPr(runner, input());
    expect(r).toMatchObject({ ok: false, reading: expect.stringMatching(reason) });
    expect(runner.calls.some(c => c[1] === 'pr' && c[2] === 'edit')).toBe(false);
  });

  it.each([
    ['a hostile root id', { root: 'pv-r; rm -rf /' }],
    ['a hostile leaf id', { leaf: '--all' }],
    ['a two-line title', { title: 'feat: a\nb' }],
    ['an empty title', { title: '  \n' }],
    ['a bad PR number', { pr: 0 }],
  ])('refuses %s before any call', (_name, over) => {
    const runner = fakeRunner(routes());
    expect(runPublishPr(runner, input(over)).ok).toBe(false);
    expect(runner.calls).toEqual([]);
  });
});

describe('runSubmitCheck', () => {
  const routes = (o: { leafLabels?: string[]; head?: string; log?: string; rootLabels?: string[] } = {}): [string, RunResult][] => [
    ['bd show pv-r.2', ok(JSON.stringify([bead({ id: 'pv-r.2', parent: 'pv-r', issue_type: 'task', labels: o.leafLabels ?? [] })]))],
    ['bd show pv-r', ok(JSON.stringify([bead({ id: 'pv-r', labels: o.rootLabels ?? ['spec:building'] })]))],
    ['git rev-parse', ok(o.head ?? 'feat.alpha-two')],
    ['git fetch', ok('')],
    ['git log', ok(o.log ?? 'feat(agents): add the thing')],
  ];
  const input = { root: 'pv-r', leaf: 'pv-r.2', base: 'feat.alpha-one' };

  it('passes a clean level and reads its commits since the base', () => {
    const runner = fakeRunner(routes());
    expect(runSubmitCheck(runner, input)).toMatchObject({ ok: true, hold: false });
    expect(runner.calls).toContainEqual(['git', 'log', '--format=%B', 'feat.alpha-one..HEAD']);
    expect(runner.calls.some(c => c[1] === 'fetch')).toBe(false);
  });

  it('reads a first level against freshly fetched origin/main', () => {
    const runner = fakeRunner(routes());
    expect(runSubmitCheck(runner, { ...input, base: 'main' }).ok).toBe(true);
    expect(runner.calls).toContainEqual(['git', 'fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
    expect(runner.calls).toContainEqual(['git', 'log', '--format=%B', 'origin/main..HEAD']);
  });

  it('holds a security leaf before reading git', () => {
    const runner = fakeRunner(routes({ leafLabels: ['security'] }));
    expect(runSubmitCheck(runner, input)).toMatchObject({ ok: false, hold: true });
    expect(runner.calls.some(c => c[0] === 'git')).toBe(false);
  });

  it.each([
    ['a bead id in the branch', { head: 'feat.pv-abcd-two' }, 'branch'],
    ['a session trailer in a commit', { log: 'fix: x\n\nClaude-Session: abc' }, 'commits'],
  ])('submits nothing on %s', (_name, route, source) => {
    const r = runSubmitCheck(fakeRunner(routes(route)), input);
    expect(r.ok).toBe(false);
    expect(r.matches.map(m => m.source)).toEqual([source]);
  });

  it.each([
    ['the kill switch', routes({ rootLabels: ['spec:stalled'] }), input, /kill switch/],
    ['an unnamed checkout', routes({ head: 'HEAD' }), input, /checked-out branch/],
    ['a hostile base', routes(), { ...input, base: '--output=/tmp/x' }, /base/],
  ])('refuses on %s', (_name, r, args, reason) => {
    expect(runSubmitCheck(fakeRunner(r), args)).toMatchObject({ ok: false, reading: expect.stringMatching(reason) });
  });
});

// =============================================================================
// Never merges
// =============================================================================

/** The only line start on which a merge or force-push pattern may appear. */
const NEVER_PREFIX = 'Never:';
const NEVER_PATTERNS = [
  /pr merge/,
  /['"]pr['"]\s*,\s*['"]merge['"]/,
  /enablePullRequestAutoMerge/,
  /mergePullRequest/,
  /pulls\/[^/]+\/merge/,
  /--auto-merge/,
  /push --force/,
  /push\s+(-f\b|\+)/,
  /--force-with-lease/,
];

/** Lines naming a merge or force-push that do not start with NEVER_PREFIX, as `n: line`. */
function forbiddenLines(text: string): string[] {
  return text.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => NEVER_PATTERNS.some(p => p.test(line)) && !line.startsWith(NEVER_PREFIX))
    .map(({ line, n }) => `${n}: ${line}`);
}

describe('never merges', () => {
  /** The command, the skills and the scripts the run executes. This test file is not scanned: it names every pattern. */
  const FILES = [
    '../../../../commands/spawn-bead-workers.md',
    '../../SKILL.md',
    '../lib/build.ts',
    '../build.ts',
    '../../../bead-branch-and-pr/scripts/lib/stack.ts',
    '../../../bead-wave-orchestration/SKILL.md',
  ];

  it('finds a forbidden line and lets a Never: line through', () => {
    expect(forbiddenLines("run(['gh', 'pr', 'merge', '1'])\ngit push -f origin x")).toEqual([
      "1: run(['gh', 'pr', 'merge', '1'])",
      '2: git push -f origin x',
    ]);
    expect(forbiddenLines('Never: run `gh pr merge` or `git push --force-with-lease`.')).toEqual([]);
  });

  it('names merge, auto-merge and force-push only on Never: lines', () => {
    for (const rel of FILES) {
      expect(forbiddenLines(readFileSync(resolve(__dirname, rel), 'utf-8')), rel).toEqual([]);
    }
  });

  it('states the never-merge rule in the skill', () => {
    const skill = readFileSync(resolve(__dirname, '../../SKILL.md'), 'utf-8');
    expect(skill.split('\n').some(l => l.startsWith(NEVER_PREFIX) && /pr merge/.test(l))).toBe(true);
  });

  it('ships a slot deny list covering merge, publishing, repository settings and their wrappers', () => {
    const settings = JSON.parse(readFileSync(resolve(__dirname, '../../slot-settings.json'), 'utf-8'));
    expect(settings.permissions.deny).toEqual(expect.arrayContaining([
      'Bash(gh pr merge:*)',
      'Bash(gh pr edit:*)',
      'Bash(gh api:*)',
      'Bash(gh repo edit:*)',
      'Bash(gh repo delete:*)',
      'Bash(gh repo rename:*)',
      'Bash(gh repo archive:*)',
      'Bash(gh secret:*)',
      'Bash(gh variable:*)',
      'Bash(gh workflow:*)',
      'Bash(gh release:*)',
      'Bash(gh alias:*)',
      'Bash(git push:*)',
      'Bash(git -C:*)',
      'Bash(sh -c:*)',
      'Bash(bash -c:*)',
      'Bash(zsh -c:*)',
      'Bash(env:*)',
      'mcp__github__merge_pull_request',
    ]));
  });

  it('instructs no command the slot deny list refuses', () => {
    for (const rel of ['../../SKILL.md', '../../../bead-wave-orchestration/SKILL.md', '../../../../commands/spawn-bead-workers.md']) {
      const text = readFileSync(resolve(__dirname, rel), 'utf-8');
      // A bare `git -C` naming the bypass class is prose; with an argument it is an instruction.
      expect(text, rel).not.toMatch(/\bgit -C\s+[^`\s]|\bgh repo view\b/);
    }
  });

  it('sets PR text only through publish-pr: the skill names a bare gh pr edit only to forbid it', () => {
    const skill = readFileSync(resolve(__dirname, '../../SKILL.md'), 'utf-8');
    const edits = skill.split('\n').filter(l => /gh pr edit/.test(l));
    expect(edits.length).toBeGreaterThan(0);
    for (const line of edits) expect(line).toMatch(/never `gh pr edit`/);
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
