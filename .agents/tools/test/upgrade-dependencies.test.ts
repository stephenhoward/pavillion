/**
 * Unit tests for .agents/tools/lib/upgrade-dependencies.ts
 *
 * Pure functions are tested on literal dashboard/PR data; `tick` injects a
 * fake spawnFn that serves a canned dashboard and captures the edited body.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SpawnSyncReturns } from 'node:child_process';
import {
  admissionOrder,
  admissionQueue,
  alreadyAtMajor,
  annotateBody,
  classifyDemand,
  classifyPr,
  commitOrigin,
  dashboardMajors,
  firstStableRelease,
  isMajorTitle,
  MIGRATION_HEADING,
  newestPeers,
  packageSource,
  parsePendingApproval,
  parseUpdateTitle,
  prepareWorktree,
  rangeAdmitsMajor,
  rollup,
  tick,
  tickPendingApproval,
  tierFor,
  TRAILER,
  triggerRenovate,
  type Candidate,
  type CheckFact,
  type CommitFact,
} from '../lib/upgrade-dependencies.js';

// =============================================================================
// Fixtures
// =============================================================================

const DASHBOARD = `## Pending Approval

The following branches are pending approval. To create them, click on a checkbox below.

 - [ ] <!-- approve-branch=renovate/config-4.x -->chore(deps): update dependency @types/config to v4
 - [x] <!-- approve-branch=renovate/jsdom-30.x -->chore(deps): update dependency jsdom to v30 (\`jsdom\`, \`@types/jsdom\`)
 - [ ] <!-- approve-branch=renovate/express-5.x -->fix(deps): update dependency express to v5
 - [ ] <!-- approve-all-pending-prs -->🔐 **Create all pending approval PRs at once** 🔐

## Rate-Limited

 - [ ] <!-- unlimit-branch=renovate/tsx-4.x-lockfile -->chore(deps): update dependency tsx to v4.23.15
 - [ ] <!-- create-all-rate-limited-prs -->🔐 **Create all rate-limited PRs at once** 🔐
`;

function fakeSpawn(stdout: string, status = 0): SpawnSyncReturns<string> {
  return { stdout, stderr: '', status, signal: null, pid: 1, output: [null, stdout, ''] };
}

const renovateCommit: CommitFact = {
  oid: 'aaa',
  authors: [{ login: 'renovate-bot' }],
  messageHeadline: 'chore(deps): update dependency vite to v8',
  messageBody: '',
};
const commandCommit: CommitFact = {
  oid: 'bbb',
  authors: [{ login: 'stephenhoward' }],
  messageHeadline: 'build: migrate vite config to v8',
  messageBody: `Rename the build option.\n\n${TRAILER}`,
};
const handCommit: CommitFact = {
  oid: 'ccc',
  authors: [{ login: 'stephenhoward' }],
  messageHeadline: 'build: upgrade stylelint to v17',
  messageBody: '',
};

const run = (id: number) => `https://github.com/o/r/actions/runs/${id}/job/9`;
const pass = (name: string): CheckFact => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: run(1) });
const fail = (name: string, runId = 7): CheckFact => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: run(runId) });
const running = (name: string): CheckFact => ({ __typename: 'CheckRun', name, status: 'IN_PROGRESS', detailsUrl: run(1) });

// =============================================================================
// Dashboard
// =============================================================================

describe('parsePendingApproval', () => {
  it('reads only approve-branch lines from the Pending Approval section', () => {
    expect(parsePendingApproval(DASHBOARD)).toEqual([
      { key: 'renovate/config-4.x', title: 'chore(deps): update dependency @types/config to v4', checked: false },
      { key: 'renovate/jsdom-30.x', title: 'chore(deps): update dependency jsdom to v30 (`jsdom`, `@types/jsdom`)', checked: true },
      { key: 'renovate/express-5.x', title: 'fix(deps): update dependency express to v5', checked: false },
    ]);
  });

  it('returns nothing when the section is absent', () => {
    expect(parsePendingApproval('## Open\n')).toEqual([]);
  });
});

describe('tickPendingApproval', () => {
  it('ticks exactly the named checkbox and changes nothing else', () => {
    const out = tickPendingApproval(DASHBOARD, 'renovate/express-5.x');
    expect(out).toBe(DASHBOARD.replace(
      '- [ ] <!-- approve-branch=renovate/express-5.x -->',
      '- [x] <!-- approve-branch=renovate/express-5.x -->',
    ));
  });

  it('refuses the bulk checkboxes', () => {
    expect(() => tickPendingApproval(DASHBOARD, 'approve-all-pending-prs')).toThrow(/refusing/);
    expect(() => tickPendingApproval(DASHBOARD, 'create-all-rate-limited-prs')).toThrow(/refusing/);
  });

  it('refuses a key that is already ticked or not pending approval', () => {
    expect(() => tickPendingApproval(DASHBOARD, 'renovate/jsdom-30.x')).toThrow(/already ticked/);
    expect(() => tickPendingApproval(DASHBOARD, 'renovate/tsx-4.x-lockfile')).toThrow(/found 0/);
  });
});

describe('tick', () => {
  it('writes the ticked body back to the dashboard issue', () => {
    let written = '';
    const spawn = (_cmd: string, args: string[]) => {
      if (args[0] === 'issue' && args[1] === 'view') return fakeSpawn(JSON.stringify({ body: DASHBOARD }));
      written = readFileSync(args[args.indexOf('--body-file') + 1], 'utf-8');
      return fakeSpawn('');
    };
    tick('renovate/config-4.x', { spawnFn: spawn as never });
    expect(written).toBe(tickPendingApproval(DASHBOARD, 'renovate/config-4.x'));
  });
});

describe('parseUpdateTitle', () => {
  it.each([
    ['chore(deps): update dependency @types/config to v4', ['@types/config'], 4, null],
    ['chore(deps): update dependency jsdom to v30 (`jsdom`, `@types/jsdom`)', ['jsdom', '@types/jsdom'], 30, null],
    ['chore(deps): update docker/login-action action to v4', ['docker/login-action'], 4, 'action'],
    ['chore(deps): update postgres docker tag to v18', ['postgres'], 18, 'docker'],
    ['chore(deps): update eslint monorepo to v10 (`@eslint/js`, `eslint`)', ['@eslint/js', 'eslint'], 10, null],
    ['chore(deps): update github artifact actions (major) (`actions/download-artifact`, `actions/upload-artifact`)',
      ['actions/download-artifact', 'actions/upload-artifact'], null, 'action'],
  ])('%s', (title, packages, targetMajor, hint) => {
    expect(parseUpdateTitle(title)).toEqual({ packages, targetMajor, hint });
  });
});

describe('isMajorTitle', () => {
  it.each([
    ['chore(deps): update dependency vite to v8', true],
    ['chore(deps): update eslint monorepo to v10', true],
    ['chore(deps): update github artifact actions (major)', true],
    ['chore(deps): update dependency happy-dom to v20 [security]', true],
    ['chore(deps): update dependency concurrently to v9.2.5', false],
    ['chore(deps): update haproxy docker tag to v3.4', false],
    ['fix(deps): update dependency lucide-vue-next to ^0.577.0', false],
    ['chore(deps): update haproxy:3.2-alpine docker digest to 254e637', false],
  ])('%s → %s', (title, expected) => {
    expect(isMajorTitle(title)).toBe(expected);
  });
});

// =============================================================================
// Admission order
// =============================================================================

describe('packageSource', () => {
  const manifest = { dependencies: { express: '^4', '@types/multer': '^1' }, devDependencies: { vite: '^6' } };
  const actions = new Set(['docker/login-action']);

  it('classifies type packages as types even when they are runtime dependencies', () => {
    expect(packageSource('@types/multer', manifest, actions, null)).toBe('types');
  });

  it('distinguishes runtime, dev, action, docker and unknown', () => {
    expect(packageSource('express', manifest, actions, null)).toBe('runtime');
    expect(packageSource('vite', manifest, actions, null)).toBe('dev');
    expect(packageSource('docker/login-action', manifest, actions, null)).toBe('action');
    expect(packageSource('postgres', manifest, actions, 'docker')).toBe('docker');
    expect(packageSource('mystery', manifest, actions, null)).toBe('unknown');
  });
});

describe('alreadyAtMajor', () => {
  const manifest = { dependencies: { express: '^4.21.0' }, devDependencies: { stylelint: '^17.16.0', '@types/jsdom': '~30.0.0' } };

  it('is true when every package is already on the target major', () => {
    expect(alreadyAtMajor(['stylelint'], 17, manifest)).toBe(true);
  });

  it('is false while any package lags, or when the target is unknown', () => {
    expect(alreadyAtMajor(['express'], 5, manifest)).toBe(false);
    expect(alreadyAtMajor(['jsdom', '@types/jsdom'], 30, manifest)).toBe(false);
    expect(alreadyAtMajor(['stylelint'], null, manifest)).toBe(false);
    expect(alreadyAtMajor(['docker/login-action'], 4, manifest)).toBe(false);
  });
});

describe('tierFor', () => {
  it('puts tooling with no runtime footprint in tier 1', () => {
    expect(tierFor(['dev', 'types'], 0)).toBe(1);
    expect(tierFor(['action', 'action'], 0)).toBe(1);
    expect(tierFor(['docker'], 0)).toBe(1);
  });

  it('splits runtime libraries at two importing files', () => {
    expect(tierFor(['runtime'], 2)).toBe(2);
    expect(tierFor(['runtime', 'types'], 3)).toBe(3);
  });

  it('treats an unrecognised package as broad surface', () => {
    expect(tierFor(['dev', 'unknown'], 0)).toBe(3);
    expect(tierFor([], 0)).toBe(3);
  });
});

const candidate = (
  key: string, tier: 1 | 2 | 3, releasedAt: string | null, index: number, demands: string[] = [], waitsFor: string[] = [],
): Candidate => ({
  key, title: key, checked: false, index, packages: [], targetMajor: 1, tier, importFiles: 0, releasedAt, demands, waitsFor,
});

describe('admissionOrder', () => {
  const c = candidate;

  it('orders by tier, then oldest release, then dashboard order for undated items', () => {
    const order = admissionOrder([
      c('runtime-old', 2, '2024-01-01', 0),
      c('tool-undated-late', 1, null, 5),
      c('tool-new', 1, '2026-01-01', 1),
      c('tool-undated-early', 1, null, 2),
      c('tool-old', 1, '2025-01-01', 3),
    ]).map(x => x.key);
    expect(order).toEqual(['tool-old', 'tool-new', 'tool-undated-early', 'tool-undated-late', 'runtime-old']);
  });
});

describe('rangeAdmitsMajor', () => {
  it.each([
    ['^17.6.0', 16, false],
    ['^17.6.0', 17, true],
    ['>=5.0.0', 5, true],
    ['>=5.0.0', 4, false],
    ['^16.0.0 || ^17.0.0', 16, true],
    ['>=6 <8', 8, false],
    ['>=6 <8', 7, true],
    ['<6.2.0', 6, true],
    ['<6', 6, false],
    ['5 - 7', 6, true],
    ['*', 1, true],
    ['17.x', 17, true],
    ['workspace:^', 1, true],
  ])('%s admits %i → %s', (range, major, expected) => {
    expect(rangeAdmitsMajor(range, major)).toBe(expected);
  });
});

describe('newestPeers', () => {
  it('takes the last entry when several versions match, the object when one does', () => {
    expect(newestPeers('[{"vite":"^5"},{"vite":"^6"}]')).toEqual({ vite: '^6' });
    expect(newestPeers('{"vite":"^6"}')).toEqual({ vite: '^6' });
    expect(newestPeers('')).toEqual({});
  });
});

describe('admissionQueue', () => {
  it('admits a coupled pair once, through its primary, even when the peer comes first', () => {
    const queue = admissionQueue([
      candidate('stylelint', 1, '2025-01-01', 0),
      candidate('vite', 1, '2025-02-01', 1),
      candidate('stylistic-plugin', 1, '2025-03-01', 2, ['stylelint']),
    ]);
    expect(queue).toEqual([
      { key: 'stylistic-plugin', peers: ['stylelint'] },
      { key: 'vite', peers: [] },
    ]);
  });

  it('leaves out a candidate that waits on another item', () => {
    const queue = admissionQueue([
      candidate('vite', 1, '2025-01-01', 0),
      candidate('vue-router', 3, '2025-02-01', 1, [], ['vite']),
    ]);
    expect(queue).toEqual([{ key: 'vite', peers: [] }]);
  });
});

describe('dashboardMajors', () => {
  it('collects pending items and open major PRs, skipping open minors', () => {
    const body = `${DASHBOARD}
## Open

 - [ ] <!-- rebase-branch=renovate/major-eslint-monorepo -->[chore(deps): update eslint monorepo to v10](../pull/841) (\`@eslint/js\`, \`eslint\`)
 - [ ] <!-- rebase-branch=renovate/vite-6.x-lockfile -->[chore(deps): update dependency vite to v6.4.4](../pull/830)
`;
    expect(dashboardMajors(body).map(m => m.key)).toEqual([
      'renovate/config-4.x', 'renovate/jsdom-30.x', 'renovate/express-5.x', 'renovate/major-eslint-monorepo',
    ]);
    expect(dashboardMajors(body)[3]).toMatchObject({ packages: ['@eslint/js', 'eslint'], targetMajor: 10 });
  });
});

describe('classifyDemand', () => {
  const ctx = {
    manifest: { devDependencies: { 'stylelint': '^16.0.0', 'vite': '^6.3.5', '@stylistic/stylelint-plugin': '^3.1.3' }, dependencies: { 'vue-router': '^4.5.0' } },
    majors: [
      { key: 'renovate/stylelint-17.x', packages: ['stylelint'], targetMajor: 17 },
      { key: 'renovate/vite-8.x', packages: ['vite'], targetMajor: 8 },
      { key: 'renovate/stylistic-5.x', packages: ['@stylistic/stylelint-plugin'], targetMajor: 5 },
    ],
    candidateKeys: new Set(['renovate/stylelint-17.x', 'renovate/vite-8.x', 'renovate/stylistic-5.x']),
  };

  it('folds a mutual coupling into the primary', () => {
    // plugin v5 needs stylelint 17; the installed plugin v3 refuses stylelint 17
    expect(classifyDemand('renovate/stylistic-5.x', 'stylelint', '^17.6.0', '^16.0.0', ctx))
      .toEqual({ kind: 'fold', key: 'renovate/stylelint-17.x' });
  });

  it('waits when the demanded package can go green alone', () => {
    // vue-router 5 needs vite 7+; vue-router 4 has no vite peer, so vite 8 can go first
    expect(classifyDemand('renovate/vue-router-5.x', 'vite', '^7.3.0 || ^8.0.0', undefined, ctx))
      .toEqual({ kind: 'wait', key: 'renovate/vite-8.x' });
  });

  it('waits when the demanded item is already ticked or open', () => {
    const ticked = { ...ctx, candidateKeys: new Set(['renovate/stylistic-5.x']) };
    expect(classifyDemand('renovate/stylistic-5.x', 'stylelint', '^17.6.0', '^16.0.0', ticked))
      .toEqual({ kind: 'wait', key: 'renovate/stylelint-17.x' });
  });

  it('ignores a satisfied peer, or one no dashboard item will deliver', () => {
    expect(classifyDemand('renovate/x', 'vite', '>=5', undefined, ctx)).toBeNull();
    expect(classifyDemand('renovate/x', 'vue-router', '^5.0.0', undefined, ctx)).toBeNull();
    // the only item for vite targets 8, which does not satisfy ^9
    expect(classifyDemand('renovate/x', 'vite', '^9.0.0', undefined, ctx)).toBeNull();
  });
});

describe('firstStableRelease', () => {
  it('returns the earliest non-prerelease of the major', () => {
    expect(firstStableRelease({
      'created': '2010-01-01',
      '8.0.0-beta.1': '2025-12-01',
      '7.9.0': '2026-02-01',
      '8.1.0': '2026-03-01',
      '8.0.0': '2026-01-15',
    }, 8)).toBe('2026-01-15');
    expect(firstStableRelease({ '7.0.0': '2025-01-01' }, 8)).toBeNull();
  });
});

// =============================================================================
// PR classification
// =============================================================================

describe('commitOrigin', () => {
  it('recognises this command by its trailer, not its author', () => {
    expect(commitOrigin(renovateCommit)).toBe('renovate');
    expect(commitOrigin(commandCommit)).toBe('command');
    expect(commitOrigin(handCommit)).toBe('foreign');
  });

  it('does not accept the trailer text mid-line', () => {
    expect(commitOrigin({ ...handCommit, messageBody: `see ${TRAILER} below` })).toBe('foreign');
  });
});

describe('rollup', () => {
  it('is pending while any check runs, or before any check exists', () => {
    expect(rollup([pass('lint'), running('e2e'), fail('unit')]).state).toBe('pending');
    expect(rollup([]).state).toBe('pending');
  });

  it('collects failing checks with their workflow run ids', () => {
    expect(rollup([pass('lint'), fail('e2e', 42)])).toEqual({ state: 'red', failing: [{ name: 'e2e', runId: 42 }] });
  });

  it('reads commit statuses as well as check runs', () => {
    expect(rollup([{ __typename: 'StatusContext', context: 'scan', state: 'ERROR' }]))
      .toEqual({ state: 'red', failing: [{ name: 'scan', runId: null }] });
    expect(rollup([pass('lint'), { __typename: 'CheckRun', name: 'skip', status: 'COMPLETED', conclusion: 'SKIPPED' }]).state)
      .toBe('green');
  });
});

describe('classifyPr', () => {
  const facts = (commits: CommitFact[], checks: CheckFact[], attempts: Record<number, number> = {}, labels: string[] = []) =>
    classifyPr({ labels, commits, checks, attempts });

  it('marks a branch with a hand-made commit as in hand whatever its CI', () => {
    expect(facts([renovateCommit, handCommit], [fail('e2e')], { 7: 2 }).kind).toBe('in-hand');
    expect(facts([renovateCommit, handCommit], [pass('e2e')]).kind).toBe('in-hand');
  });

  it('reports green as ready, noting whether a migration made it so', () => {
    expect(facts([renovateCommit], [pass('e2e')])).toMatchObject({ kind: 'ready', migrated: false });
    expect(facts([renovateCommit, commandCommit], [pass('e2e')])).toMatchObject({ kind: 'ready', migrated: true });
  });

  it('spends the one re-run before classifying red', () => {
    expect(facts([renovateCommit], [fail('e2e', 7), fail('unit', 7)], { 7: 1 }))
      .toMatchObject({ kind: 'rerun', rerunRunIds: [7] });
  });

  it('classifies red after the re-run by whose commit is on top', () => {
    expect(facts([renovateCommit], [fail('e2e', 7)], { 7: 2 }).kind).toBe('gate-2');
    expect(facts([renovateCommit, commandCommit], [fail('e2e', 7)], { 7: 2 }))
      .toMatchObject({ kind: 'migration-failed', failing: ['e2e'] });
  });

  it('classifies red without a re-run when no failing check is a workflow run', () => {
    expect(facts([renovateCommit], [{ __typename: 'StatusContext', context: 'scan', state: 'FAILURE' }]).kind).toBe('gate-2');
  });

  it('does not re-judge an escalated PR', () => {
    expect(facts([renovateCommit], [fail('e2e', 7)], { 7: 2 }, ['needs-human']).kind).toBe('escalated');
  });

  it('leaves running CI pending', () => {
    expect(facts([renovateCommit], [running('e2e')]).kind).toBe('pending');
  });
});

// =============================================================================
// Renovate dispatch and worktree
// =============================================================================

describe('triggerRenovate', () => {
  const T0 = Date.parse('2026-10-21T12:00:00Z');

  function clock() {
    let t = T0;
    return { now: () => t, sleep: (ms: number) => { t += ms; } };
  }

  it('waits for the dispatched run to complete, ignoring older dispatches', () => {
    let polls = 0;
    const spawn = (_cmd: string, args: string[]) => {
      if (args[0] === 'workflow') return fakeSpawn('');
      polls += 1;
      const ours = { databaseId: 9, createdAt: '2026-10-21T12:00:05Z', status: polls < 3 ? 'in_progress' : 'completed', conclusion: polls < 3 ? '' : 'success' };
      const old = { databaseId: 8, createdAt: '2026-10-21T10:00:00Z', status: 'completed', conclusion: 'success' };
      return fakeSpawn(JSON.stringify(polls === 1 ? [old] : [ours, old]));
    };
    expect(triggerRenovate(15 * 60_000, { spawnFn: spawn as never, ...clock() }))
      .toEqual({ runId: 9, status: 'completed', conclusion: 'success', timedOut: false });
    expect(polls).toBe(3);
  });

  it('gives up at the timeout and says so', () => {
    const spawn = (_cmd: string, args: string[]) => fakeSpawn(args[0] === 'workflow' ? '' : '[]');
    expect(triggerRenovate(60_000, { spawnFn: spawn as never, ...clock() }))
      .toEqual({ runId: null, status: null, conclusion: null, timedOut: true });
  });
});

describe('prepareWorktree', () => {
  it('refuses a branch that is not Renovate\'s', () => {
    expect(() => prepareWorktree('main', { spawnFn: (() => fakeSpawn('')) as never })).toThrow(/refusing/);
  });

  it('creates the worktree once, checks the branch out there and installs there', () => {
    const calls: { cmd: string; args: string[]; cwd?: string }[] = [];
    const spawn = (cmd: string, args: string[], opts: { cwd?: string }) => {
      calls.push({ cmd, args, cwd: opts.cwd });
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return fakeSpawn('/repo');
      if (args[0] === 'worktree' && args[1] === 'list') return fakeSpawn('worktree /repo\nHEAD abc\n');
      if (args[0] === 'rev-parse') return fakeSpawn('deadbeef');
      return fakeSpawn('');
    };
    const wt = prepareWorktree('renovate/vite-8.x', { spawnFn: spawn as never });
    const path = '/repo/.agents/worktrees/upgrade-dependencies';
    expect(wt).toEqual({ path, branch: 'renovate/vite-8.x', resetSha: 'deadbeef' });
    expect(calls.map(c => `${c.cmd} ${c.args.join(' ')}`)).toContain(`git worktree add --detach ${path} origin/main`);
    expect(calls.filter(c => c.args[0] === 'checkout' || c.cmd === 'npm').every(c => c.cwd === path)).toBe(true);
  });
});

// =============================================================================
// PR annotation
// =============================================================================

describe('annotateBody', () => {
  const renovateBody = 'This PR contains the following updates:\n\n| Package |\n\n---\n\nThis PR was generated by Mend Renovate.\n';

  it('keeps Renovate\'s body and appends the ruling and files', () => {
    const out = annotateBody(renovateBody, '**Translation.** Renamed option.', ['vite.config.ts', 'src/a.ts']);
    expect(out.startsWith(renovateBody.trimEnd())).toBe(true);
    expect(out).toContain(`${MIGRATION_HEADING}\n\n**Translation.** Renamed option.\n\n### Files changed\n\n- \`vite.config.ts\`\n- \`src/a.ts\`\n`);
  });

  it('replaces an earlier migration section instead of stacking a second', () => {
    const once = annotateBody(renovateBody, 'first', ['a.ts']);
    const twice = annotateBody(once, 'second', ['b.ts']);
    expect(twice.split(MIGRATION_HEADING)).toHaveLength(2);
    expect(twice).toContain('second');
    expect(twice).not.toContain('first');
  });
});
