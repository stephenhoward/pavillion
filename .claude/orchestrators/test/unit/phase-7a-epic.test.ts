import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { PhaseName, type RunContext, type RunLogger } from '../../lib/context.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function stubLogger(): {
  logger: RunLogger;
  logs: { phase: PhaseName; kind: 'out' | 'err'; data: string }[];
  runJsonEntries: Record<string, unknown>[];
} {
  const logs: { phase: PhaseName; kind: 'out' | 'err'; data: string }[] = [];
  const runJsonEntries: Record<string, unknown>[] = [];

  const logger: RunLogger = {
    writePhaseLog(phase, kind, data) {
      logs.push({ phase, kind, data });
    },
    appendRunJson(entry) {
      runJsonEntries.push(entry);
    },
    runDir() {
      return '/tmp/fake-run-dir';
    },
  };

  return { logger, logs, runJsonEntries };
}

function createMockChild(
  stdout: string,
  stderr: string,
  exitCode: number,
): ChildProcess & EventEmitter {
  const child = new EventEmitter() as ChildProcess & EventEmitter;

  const stdoutStream = new Readable({ read() {} });
  const stderrStream = new Readable({ read() {} });

  child.stdin = { write: vi.fn(), end: vi.fn() } as unknown as ChildProcess['stdin'];
  child.stdout = stdoutStream;
  child.stderr = stderrStream;
  child.pid = 12345;
  child.kill = vi.fn().mockReturnValue(true);

  setImmediate(() => {
    if (stdout) stdoutStream.push(stdout);
    stdoutStream.push(null);
    if (stderr) stderrStream.push(stderr);
    stderrStream.push(null);
    child.emit('close', exitCode);
  });

  return child;
}

// ---------------------------------------------------------------------------
// Standard mock data
// ---------------------------------------------------------------------------

const PASS_AUDIT_VERDICT = {
  agent: 'architecture-auditor',
  verdict: 'pass',
  concerns: [],
  recommendations: [],
  beadId: 'pv-leaf-1',
};

const PASS_WAVE_VERDICT = {
  epicId: 'pv-epic-1',
  waveNumber: 1,
  verdict: 'pass',
  buildStatus: 'green',
  beadsCompleted: ['pv-leaf-1'],
  beadsFailed: [],
  concerns: [],
  nextWaveReady: [],
};

const FAIL_WAVE_VERDICT = {
  epicId: 'pv-epic-1',
  waveNumber: 1,
  verdict: 'fail',
  buildStatus: 'red',
  beadsCompleted: [],
  beadsFailed: ['pv-leaf-1'],
  concerns: ['Test failure in calendar service'],
  nextWaveReady: [],
};

function matchAgentsResult(agents: { name: string }[] = []) {
  return {
    stdout: Buffer.from(JSON.stringify(agents.map(a => ({
      name: a.name,
      path: `.claude/agents/${a.name}.md`,
      description: `${a.name} agent`,
      rationale: 'Matches changed files',
    })))),
    stderr: Buffer.from(''),
    status: 0,
  };
}

/** bd show --json mock for an epic with leaf children. */
function bdShowEpicJson(epicId: string, children: string[]) {
  return {
    id: epicId,
    issue_type: 'epic',
    children: children.map(c => ({
      id: c,
      issue_type: 'task',
      status: 'ready',
    })),
  };
}

/** bd ready mock returning a list of bead IDs. */
function bdReadyJson(beadIds: string[]) {
  return beadIds.map(id => ({
    id,
    issue_type: 'task',
    priority: 3,
    status: 'ready',
  }));
}

describe('phase-7a-epic', () => {
  let logStub: ReturnType<typeof stubLogger>;
  let ctx: RunContext;

  beforeEach(() => {
    logStub = stubLogger();
    ctx = {
      runId: 'test-run-1',
      beadId: 'pv-epic-1',
      logger: logStub.logger,
      phaseHistory: [],
    };
  });

  describe('runEpicExecution — single-wave epic (1-3 beads, all pass)', () => {
    it('should complete a single-wave epic with 2 beads that all pass', async () => {
      const { runEpicExecution } = await import('../../lib/phase-7a-epic.js');

      const epicChildren = ['pv-leaf-1', 'pv-leaf-2'];

      // Track dispatch calls to route appropriately:
      // 1. implementer for pv-leaf-1
      // 2. implementer for pv-leaf-2
      // 3-4. auditor for each leaf (matched via match-agents.sh)
      // 5. cross-bead-integration-verifier (wave size > 1)
      // 6. architecture-auditor (light pass)
      // 7. build-guardian
      let dispatchCallCount = 0;
      const mockSpawnFn = vi.fn().mockImplementation(() => {
        dispatchCallCount++;
        // Implementers and auditors all succeed
        if (dispatchCallCount <= 2) {
          return createMockChild(JSON.stringify({ status: 'closed' }), '', 0);
        }
        // Per-bead auditors
        if (dispatchCallCount <= 4) {
          return createMockChild(JSON.stringify({
            ...PASS_AUDIT_VERDICT,
            beadId: dispatchCallCount === 3 ? 'pv-leaf-1' : 'pv-leaf-2',
          }), '', 0);
        }
        // Cross-bead-integration-verifier
        if (dispatchCallCount === 5) {
          return createMockChild(JSON.stringify({
            ...PASS_WAVE_VERDICT,
            beadsCompleted: epicChildren,
          }), '', 0);
        }
        // Architecture-auditor
        if (dispatchCallCount === 6) {
          return createMockChild(JSON.stringify({
            ...PASS_WAVE_VERDICT,
            beadsCompleted: epicChildren,
          }), '', 0);
        }
        // Build-guardian
        return createMockChild(JSON.stringify({
          ...PASS_WAVE_VERDICT,
          beadsCompleted: epicChildren,
        }), '', 0);
      });

      // Script calls: enrichment checks, match-agents.sh, bd ready, bd show
      const mockSpawnSync = vi.fn().mockImplementation((cmd: string, args: string[]) => {
        const scriptPath = typeof cmd === 'string' ? cmd : '';

        // bd-enrichment-check.sh — all beads enriched
        if (scriptPath.includes('bd-enrichment-check')) {
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), status: 0 };
        }

        // match-agents.sh — return one auditor
        if (scriptPath.includes('match-agents')) {
          return matchAgentsResult([{ name: 'architecture-auditor' }]);
        }

        // bd show --json (for epic children)
        if (scriptPath.includes('bd') && args?.includes('show')) {
          return {
            stdout: Buffer.from(JSON.stringify(bdShowEpicJson('pv-epic-1', epicChildren))),
            stderr: Buffer.from(''),
            status: 0,
          };
        }

        // bd ready (after wave completes — no more beads ready)
        if (scriptPath.includes('bd') && args?.includes('ready')) {
          return {
            stdout: Buffer.from(JSON.stringify([])),
            stderr: Buffer.from(''),
            status: 0,
          };
        }

        // Default: success
        return { stdout: Buffer.from('{}'), stderr: Buffer.from(''), status: 0 };
      });

      const result = await runEpicExecution('pv-epic-1', epicChildren, ctx, {
        spawnFn: mockSpawnFn,
        scriptSpawnFn: mockSpawnSync,
        scriptExistsFn: () => true,
        changedFilesForBead: () => ['src/server/calendar/service/calendar.ts'],
      });

      expect(result.outcome).toBe('complete');
      expect(result.wavesCompleted).toBe(1);
      expect(result.beadsCompleted).toContain('pv-leaf-1');
      expect(result.beadsCompleted).toContain('pv-leaf-2');
    });

    it('should complete a single-bead wave without cross-bead-integration-verifier', async () => {
      const { runEpicExecution } = await import('../../lib/phase-7a-epic.js');

      // Only 1 bead — cross-bead-integration-verifier should be skipped
      const epicChildren = ['pv-leaf-1'];

      let dispatchCallCount = 0;
      const mockSpawnFn = vi.fn().mockImplementation(() => {
        dispatchCallCount++;
        // Implementer
        if (dispatchCallCount === 1) {
          return createMockChild(JSON.stringify({ status: 'closed' }), '', 0);
        }
        // Per-bead auditor
        if (dispatchCallCount === 2) {
          return createMockChild(JSON.stringify(PASS_AUDIT_VERDICT), '', 0);
        }
        // Architecture-auditor (no cross-bead-integration-verifier for single bead)
        if (dispatchCallCount === 3) {
          return createMockChild(JSON.stringify(PASS_WAVE_VERDICT), '', 0);
        }
        // Build-guardian
        return createMockChild(JSON.stringify(PASS_WAVE_VERDICT), '', 0);
      });

      const mockSpawnSync = vi.fn().mockImplementation((cmd: string, args: string[]) => {
        const scriptPath = typeof cmd === 'string' ? cmd : '';
        if (scriptPath.includes('bd-enrichment-check')) {
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), status: 0 };
        }
        if (scriptPath.includes('match-agents')) {
          return matchAgentsResult([{ name: 'architecture-auditor' }]);
        }
        if (scriptPath.includes('bd') && args?.includes('ready')) {
          return { stdout: Buffer.from(JSON.stringify([])), stderr: Buffer.from(''), status: 0 };
        }
        return { stdout: Buffer.from('{}'), stderr: Buffer.from(''), status: 0 };
      });

      const result = await runEpicExecution('pv-epic-1', epicChildren, ctx, {
        spawnFn: mockSpawnFn,
        scriptSpawnFn: mockSpawnSync,
        scriptExistsFn: () => true,
        changedFilesForBead: () => ['src/server/calendar/service/calendar.ts'],
      });

      expect(result.outcome).toBe('complete');
      expect(result.wavesCompleted).toBe(1);
      // Should NOT have dispatched cross-bead-integration-verifier
      // Count dispatches: implementer(1) + auditor(1) + arch-auditor(1) + build-guardian(1) = 4
      expect(mockSpawnFn).toHaveBeenCalledTimes(4);
    });
  });

  describe('runEpicExecution — multi-wave with cascade', () => {
    it('should cascade from wave 1 to wave 2 when new beads become ready', async () => {
      const { runEpicExecution } = await import('../../lib/phase-7a-epic.js');

      // Wave 1: pv-leaf-1 (blocks pv-leaf-2)
      // Wave 2: pv-leaf-2 (unblocked after wave 1)
      const initialBeads = ['pv-leaf-1'];

      // Dispatch sequence per wave:
      //   1. implementer (returns generic success)
      //   2. per-bead auditor (returns AuditorVerdict)
      //   3. architecture-auditor (returns WaveResult) — single-bead wave, no integration verifier
      //   4. build-guardian (returns WaveResult)
      // Wave 2 repeats the same pattern for pv-leaf-2
      let dispatchCallCount = 0;
      const mockSpawnFn = vi.fn().mockImplementation(() => {
        dispatchCallCount++;
        const waveNum = dispatchCallCount <= 4 ? 1 : 2;
        const beadId = waveNum === 1 ? 'pv-leaf-1' : 'pv-leaf-2';

        // Implementer calls (1st and 5th)
        if (dispatchCallCount === 1 || dispatchCallCount === 5) {
          return createMockChild(JSON.stringify({ status: 'closed' }), '', 0);
        }
        // Per-bead auditor calls (2nd and 6th)
        if (dispatchCallCount === 2 || dispatchCallCount === 6) {
          return createMockChild(JSON.stringify({
            agent: 'architecture-auditor',
            verdict: 'pass',
            concerns: [],
            recommendations: [],
            beadId,
          }), '', 0);
        }
        // Architecture-auditor and build-guardian
        return createMockChild(JSON.stringify({
          ...PASS_WAVE_VERDICT,
          waveNumber: waveNum,
          beadsCompleted: [beadId],
          nextWaveReady: waveNum === 1 ? ['pv-leaf-2'] : [],
        }), '', 0);
      });

      let bdReadyCallCount = 0;
      const mockSpawnSync = vi.fn().mockImplementation((cmd: string, args: string[]) => {
        const scriptPath = typeof cmd === 'string' ? cmd : '';
        if (scriptPath.includes('bd-enrichment-check')) {
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), status: 0 };
        }
        if (scriptPath.includes('match-agents')) {
          return matchAgentsResult([{ name: 'architecture-auditor' }]);
        }
        if (scriptPath.includes('bd') && args?.includes('ready')) {
          bdReadyCallCount++;
          // First call after wave 1: pv-leaf-2 is now ready
          if (bdReadyCallCount === 1) {
            return {
              stdout: Buffer.from(JSON.stringify(bdReadyJson(['pv-leaf-2']))),
              stderr: Buffer.from(''),
              status: 0,
            };
          }
          // Second call after wave 2: nothing left
          return {
            stdout: Buffer.from(JSON.stringify([])),
            stderr: Buffer.from(''),
            status: 0,
          };
        }
        if (scriptPath.includes('bd') && args?.includes('show')) {
          return {
            stdout: Buffer.from(JSON.stringify(bdShowEpicJson('pv-epic-1', ['pv-leaf-1', 'pv-leaf-2']))),
            stderr: Buffer.from(''),
            status: 0,
          };
        }
        return { stdout: Buffer.from('{}'), stderr: Buffer.from(''), status: 0 };
      });

      const result = await runEpicExecution('pv-epic-1', initialBeads, ctx, {
        spawnFn: mockSpawnFn,
        scriptSpawnFn: mockSpawnSync,
        scriptExistsFn: () => true,
        changedFilesForBead: () => ['src/server/calendar/service/calendar.ts'],
      });

      expect(result.outcome).toBe('complete');
      expect(result.wavesCompleted).toBe(2);
      expect(result.beadsCompleted).toContain('pv-leaf-1');
      expect(result.beadsCompleted).toContain('pv-leaf-2');
    });
  });

  describe('runEpicExecution — wave-end verification failure + retry', () => {
    it('should retry once on build-guardian failure and succeed', async () => {
      const { runEpicExecution } = await import('../../lib/phase-7a-epic.js');

      const epicChildren = ['pv-leaf-1'];

      let dispatchCallCount = 0;
      const mockSpawnFn = vi.fn().mockImplementation(() => {
        dispatchCallCount++;
        // 1. implementer (pass)
        if (dispatchCallCount === 1) {
          return createMockChild(JSON.stringify({ status: 'closed' }), '', 0);
        }
        // 2. per-bead auditor (pass)
        if (dispatchCallCount === 2) {
          return createMockChild(JSON.stringify(PASS_AUDIT_VERDICT), '', 0);
        }
        // 3. architecture-auditor (pass)
        if (dispatchCallCount === 3) {
          return createMockChild(JSON.stringify(PASS_WAVE_VERDICT), '', 0);
        }
        // 4. build-guardian (FAIL first time)
        if (dispatchCallCount === 4) {
          return createMockChild(JSON.stringify(FAIL_WAVE_VERDICT), '', 0);
        }
        // 5. test-failure-investigator
        if (dispatchCallCount === 5) {
          return createMockChild(JSON.stringify({
            responsibleBead: 'pv-leaf-1',
            diagnosis: 'Missing import in calendar service',
            suggestedFix: 'Add missing import',
          }), '', 0);
        }
        // 6. retry implementer (pass)
        if (dispatchCallCount === 6) {
          return createMockChild(JSON.stringify({ status: 'closed' }), '', 0);
        }
        // 7. retry per-bead auditor (pass)
        if (dispatchCallCount === 7) {
          return createMockChild(JSON.stringify(PASS_AUDIT_VERDICT), '', 0);
        }
        // 8. retry architecture-auditor (pass)
        if (dispatchCallCount === 8) {
          return createMockChild(JSON.stringify(PASS_WAVE_VERDICT), '', 0);
        }
        // 9. retry build-guardian (PASS)
        return createMockChild(JSON.stringify(PASS_WAVE_VERDICT), '', 0);
      });

      const mockSpawnSync = vi.fn().mockImplementation((cmd: string, args: string[]) => {
        const scriptPath = typeof cmd === 'string' ? cmd : '';
        if (scriptPath.includes('bd-enrichment-check')) {
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), status: 0 };
        }
        if (scriptPath.includes('match-agents')) {
          return matchAgentsResult([{ name: 'architecture-auditor' }]);
        }
        if (scriptPath.includes('bd') && args?.includes('ready')) {
          return { stdout: Buffer.from(JSON.stringify([])), stderr: Buffer.from(''), status: 0 };
        }
        return { stdout: Buffer.from('{}'), stderr: Buffer.from(''), status: 0 };
      });

      const result = await runEpicExecution('pv-epic-1', epicChildren, ctx, {
        spawnFn: mockSpawnFn,
        scriptSpawnFn: mockSpawnSync,
        scriptExistsFn: () => true,
        changedFilesForBead: () => ['src/server/calendar/service/calendar.ts'],
      });

      expect(result.outcome).toBe('complete');
      expect(result.wavesCompleted).toBe(1);
      // At least one retry was used
      expect(result.totalRetries).toBeGreaterThan(0);
    });
  });

  describe('runEpicExecution — wave-end failure + escalation', () => {
    it('should escalate after build-guardian fails twice', async () => {
      const { runEpicExecution } = await import('../../lib/phase-7a-epic.js');

      const epicChildren = ['pv-leaf-1'];

      let dispatchCallCount = 0;
      const mockSpawnFn = vi.fn().mockImplementation(() => {
        dispatchCallCount++;
        // 1. implementer (pass)
        if (dispatchCallCount === 1) {
          return createMockChild(JSON.stringify({ status: 'closed' }), '', 0);
        }
        // 2. per-bead auditor (pass)
        if (dispatchCallCount === 2) {
          return createMockChild(JSON.stringify(PASS_AUDIT_VERDICT), '', 0);
        }
        // 3. architecture-auditor (pass)
        if (dispatchCallCount === 3) {
          return createMockChild(JSON.stringify(PASS_WAVE_VERDICT), '', 0);
        }
        // 4. build-guardian (FAIL)
        if (dispatchCallCount === 4) {
          return createMockChild(JSON.stringify(FAIL_WAVE_VERDICT), '', 0);
        }
        // 5. test-failure-investigator
        if (dispatchCallCount === 5) {
          return createMockChild(JSON.stringify({
            responsibleBead: 'pv-leaf-1',
            diagnosis: 'Deep integration issue',
            suggestedFix: 'Needs human review',
          }), '', 0);
        }
        // 6. retry implementer (pass)
        if (dispatchCallCount === 6) {
          return createMockChild(JSON.stringify({ status: 'closed' }), '', 0);
        }
        // 7. retry per-bead auditor (pass)
        if (dispatchCallCount === 7) {
          return createMockChild(JSON.stringify(PASS_AUDIT_VERDICT), '', 0);
        }
        // 8. retry architecture-auditor (pass)
        if (dispatchCallCount === 8) {
          return createMockChild(JSON.stringify(PASS_WAVE_VERDICT), '', 0);
        }
        // 9. retry build-guardian (FAIL again)
        if (dispatchCallCount === 9) {
          return createMockChild(JSON.stringify(FAIL_WAVE_VERDICT), '', 0);
        }
        // 10. second test-failure-investigator
        if (dispatchCallCount === 10) {
          return createMockChild(JSON.stringify({
            responsibleBead: 'pv-leaf-1',
            diagnosis: 'Still broken',
            suggestedFix: 'Needs human',
          }), '', 0);
        }
        // 11. second retry implementer (pass)
        if (dispatchCallCount === 11) {
          return createMockChild(JSON.stringify({ status: 'closed' }), '', 0);
        }
        // 12. second retry per-bead auditor (pass)
        if (dispatchCallCount === 12) {
          return createMockChild(JSON.stringify(PASS_AUDIT_VERDICT), '', 0);
        }
        // 13. second retry architecture-auditor (pass)
        if (dispatchCallCount === 13) {
          return createMockChild(JSON.stringify(PASS_WAVE_VERDICT), '', 0);
        }
        // 14. second retry build-guardian (FAIL again — hits MAX_WAVE_RETRIES)
        return createMockChild(JSON.stringify(FAIL_WAVE_VERDICT), '', 0);
      });

      const mockSpawnSync = vi.fn().mockImplementation((cmd: string, args: string[]) => {
        const scriptPath = typeof cmd === 'string' ? cmd : '';
        if (scriptPath.includes('bd-enrichment-check')) {
          return { stdout: Buffer.from(''), stderr: Buffer.from(''), status: 0 };
        }
        if (scriptPath.includes('match-agents')) {
          return matchAgentsResult([{ name: 'architecture-auditor' }]);
        }
        if (scriptPath.includes('bd') && args?.includes('ready')) {
          return { stdout: Buffer.from(JSON.stringify([])), stderr: Buffer.from(''), status: 0 };
        }
        // bd-escalate.sh
        if (scriptPath.includes('bd-escalate')) {
          return { stdout: Buffer.from('{}'), stderr: Buffer.from(''), status: 0 };
        }
        return { stdout: Buffer.from('{}'), stderr: Buffer.from(''), status: 0 };
      });

      const result = await runEpicExecution('pv-epic-1', epicChildren, ctx, {
        spawnFn: mockSpawnFn,
        scriptSpawnFn: mockSpawnSync,
        scriptExistsFn: () => true,
        changedFilesForBead: () => ['src/server/calendar/service/calendar.ts'],
      });

      expect(result.outcome).toBe('escalated');
      expect(result.escalatedBeads).toContain('pv-leaf-1');
    });
  });

  describe('runWithConcurrencyCap', () => {
    it('should never exceed the concurrency cap', async () => {
      const { runWithConcurrencyCap } = await import('../../lib/phase-7a-epic.js');

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const tasks = Array.from({ length: 6 }, (_, i) => async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        // Simulate async work
        await new Promise(r => setTimeout(r, 10));
        currentConcurrent--;
        return `result-${i}`;
      });

      const results = await runWithConcurrencyCap(tasks, 3);

      expect(results).toHaveLength(6);
      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    it('should return all results in order', async () => {
      const { runWithConcurrencyCap } = await import('../../lib/phase-7a-epic.js');

      const tasks = [
        async () => 'a',
        async () => 'b',
        async () => 'c',
      ];

      const results = await runWithConcurrencyCap(tasks, 3);
      expect(results).toEqual(['a', 'b', 'c']);
    });
  });
});
