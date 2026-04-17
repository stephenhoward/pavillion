import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { PhaseName, type RunContext, type RunLogger } from '../../lib/context.js';

/**
 * Build a stub logger that captures calls for assertions.
 */
function stubLogger(): { logger: RunLogger; logs: { phase: PhaseName; kind: 'out' | 'err'; data: string }[]; runJsonEntries: Record<string, unknown>[] } {
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

/**
 * Create a mock child process that emits data and close asynchronously.
 */
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

// We need to dynamically import the module under test so mocks are in place.
// The module uses dispatch + runScript, which we control via spawnFn injection.

describe('phase-7b-leaf', () => {
  let logStub: ReturnType<typeof stubLogger>;
  let ctx: RunContext;

  beforeEach(() => {
    logStub = stubLogger();
    ctx = {
      runId: 'test-run-1',
      beadId: 'pv-test-1',
      logger: logStub.logger,
      phaseHistory: [],
    };
  });

  describe('dispatchImplementer', () => {
    it('should dispatch implementer with canonical prompt containing bead id', async () => {
      const { dispatchImplementer } = await import('../../lib/phase-7b-leaf.js');

      const mockSpawnFn = vi.fn().mockReturnValue(
        createMockChild(JSON.stringify({ status: 'closed' }), '', 0),
      );

      const result = await dispatchImplementer('pv-test-1', ctx, {
        spawnFn: mockSpawnFn,
      });

      expect(result.ok).toBe(true);

      // Verify prompt contains bead id
      const [, args] = mockSpawnFn.mock.calls[0];
      const pIdx = args.indexOf('-p');
      expect(pIdx).toBeGreaterThan(-1);
      // stdin gets the prompt for non-retry; check that stdin.write was called with the prompt
      const child = mockSpawnFn.mock.results[0].value;
      const writtenPrompt = child.stdin.write.mock.calls[0][0] as string;
      expect(writtenPrompt).toContain('pv-test-1');
      expect(writtenPrompt).toContain('Implement Bead');
      expect(writtenPrompt).toContain('bd show pv-test-1');
    });

    it('should dispatch implementer with retry context when provided', async () => {
      const { dispatchImplementer } = await import('../../lib/phase-7b-leaf.js');

      const mockSpawnFn = vi.fn().mockReturnValue(
        createMockChild(JSON.stringify({ status: 'closed' }), '', 0),
      );

      const retryContext = {
        concerns: ['Missing null check in handler', 'No error boundary'],
        attempt: 2,
      };

      const result = await dispatchImplementer('pv-test-1', ctx, {
        spawnFn: mockSpawnFn,
        retryContext,
      });

      expect(result.ok).toBe(true);

      const child = mockSpawnFn.mock.results[0].value;
      const writtenPrompt = child.stdin.write.mock.calls[0][0] as string;
      expect(writtenPrompt).toContain('Missing null check in handler');
      expect(writtenPrompt).toContain('No error boundary');
      expect(writtenPrompt).toContain('Previous audit failed');
    });

    it('should return not-ok on dispatch timeout', async () => {
      const { dispatchImplementer } = await import('../../lib/phase-7b-leaf.js');

      // Create a hanging child that never closes
      const child = new EventEmitter() as ChildProcess & EventEmitter;
      const stdoutStream = new Readable({ read() {} });
      const stderrStream = new Readable({ read() {} });
      child.stdin = { write: vi.fn(), end: vi.fn() } as unknown as ChildProcess['stdin'];
      child.stdout = stdoutStream;
      child.stderr = stderrStream;
      child.pid = 12345;
      child.kill = vi.fn().mockImplementation(() => {
        setImmediate(() => {
          stdoutStream.push(null);
          stderrStream.push(null);
          child.emit('close', null, 'SIGTERM');
        });
        return true;
      });

      const mockSpawnFn = vi.fn().mockReturnValue(child);

      const result = await dispatchImplementer('pv-test-1', ctx, {
        spawnFn: mockSpawnFn,
        timeoutMs: 50,
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('timed out');
    });
  });

  describe('runAudit', () => {
    it('should return pass verdict when all auditors pass', async () => {
      const { runAudit } = await import('../../lib/phase-7b-leaf.js');

      const passVerdict = {
        agent: 'architecture-auditor',
        verdict: 'pass',
        concerns: [],
        recommendations: [],
        beadId: 'pv-test-1',
      };

      const mockSpawnFn = vi.fn().mockReturnValue(
        createMockChild(JSON.stringify(passVerdict), '', 0),
      );

      // Mock runScript for match-agents.sh (returns JSON array of matched auditors)
      const matchResult = [
        { name: 'architecture-auditor', path: '.claude/agents/architecture-auditor.md', description: 'Architecture auditor', rationale: 'Matches backend files' },
      ];

      const mockSpawnSync = vi.fn().mockReturnValue({
        stdout: Buffer.from(JSON.stringify(matchResult)),
        stderr: Buffer.from(''),
        status: 0,
      });

      const result = await runAudit('pv-test-1', ctx, {
        spawnFn: mockSpawnFn,
        scriptSpawnFn: mockSpawnSync,
        changedFiles: ['src/server/calendar/service/calendar.ts'],
      });

      expect(result.passed).toBe(true);
      expect(result.verdicts).toHaveLength(1);
      expect(result.verdicts[0].verdict).toBe('pass');
    });

    it('should return failed verdict when any auditor fails', async () => {
      const { runAudit } = await import('../../lib/phase-7b-leaf.js');

      const failVerdict = {
        agent: 'security-auditor',
        verdict: 'fail',
        concerns: ['XSS vulnerability in template rendering'],
        recommendations: ['Sanitize user input before rendering'],
        beadId: 'pv-test-1',
      };

      const mockSpawnFn = vi.fn().mockReturnValue(
        createMockChild(JSON.stringify(failVerdict), '', 0),
      );

      const matchResult = [
        { name: 'security-auditor', path: '.claude/agents/security-auditor.md', description: 'Security auditor', rationale: 'Matches server files' },
      ];

      const mockSpawnSync = vi.fn().mockReturnValue({
        stdout: Buffer.from(JSON.stringify(matchResult)),
        stderr: Buffer.from(''),
        status: 0,
      });

      const result = await runAudit('pv-test-1', ctx, {
        spawnFn: mockSpawnFn,
        scriptSpawnFn: mockSpawnSync,
        changedFiles: ['src/server/calendar/service/calendar.ts'],
      });

      expect(result.passed).toBe(false);
      expect(result.concerns).toContain('XSS vulnerability in template rendering');
    });

    it('should pass when no auditors match', async () => {
      const { runAudit } = await import('../../lib/phase-7b-leaf.js');

      const mockSpawnFn = vi.fn();

      const mockSpawnSync = vi.fn().mockReturnValue({
        stdout: Buffer.from('[]'),
        stderr: Buffer.from(''),
        status: 0,
      });

      const result = await runAudit('pv-test-1', ctx, {
        spawnFn: mockSpawnFn,
        scriptSpawnFn: mockSpawnSync,
        changedFiles: ['README.md'],
      });

      expect(result.passed).toBe(true);
      expect(result.verdicts).toHaveLength(0);
      // No dispatch should have been called since no auditors matched
      expect(mockSpawnFn).not.toHaveBeenCalled();
    });

    it('should aggregate concerns from multiple failing auditors', async () => {
      const { runAudit } = await import('../../lib/phase-7b-leaf.js');

      const failVerdict1 = {
        agent: 'security-auditor',
        verdict: 'fail',
        concerns: ['XSS issue'],
        recommendations: ['Sanitize input'],
        beadId: 'pv-test-1',
      };

      const failVerdict2 = {
        agent: 'architecture-auditor',
        verdict: 'fail',
        concerns: ['Cross-domain import violation'],
        recommendations: ['Use interface instead'],
        beadId: 'pv-test-1',
      };

      let callCount = 0;
      const mockSpawnFn = vi.fn().mockImplementation(() => {
        callCount++;
        const verdict = callCount === 1 ? failVerdict1 : failVerdict2;
        return createMockChild(JSON.stringify(verdict), '', 0);
      });

      const matchResult = [
        { name: 'security-auditor', path: '.claude/agents/security-auditor.md', description: 'Security', rationale: 'Match' },
        { name: 'architecture-auditor', path: '.claude/agents/architecture-auditor.md', description: 'Architecture', rationale: 'Match' },
      ];

      const mockSpawnSync = vi.fn().mockReturnValue({
        stdout: Buffer.from(JSON.stringify(matchResult)),
        stderr: Buffer.from(''),
        status: 0,
      });

      const result = await runAudit('pv-test-1', ctx, {
        spawnFn: mockSpawnFn,
        scriptSpawnFn: mockSpawnSync,
        changedFiles: ['src/server/calendar/service/calendar.ts'],
      });

      expect(result.passed).toBe(false);
      expect(result.concerns).toContain('XSS issue');
      expect(result.concerns).toContain('Cross-domain import violation');
    });
  });

  describe('runLeafExecution (full flow)', () => {
    it('should complete successfully on clean pass (implementer ok, audit pass)', async () => {
      const { runLeafExecution } = await import('../../lib/phase-7b-leaf.js');

      const implementerResult = { status: 'closed' };
      const auditVerdict = {
        agent: 'architecture-auditor',
        verdict: 'pass',
        concerns: [],
        recommendations: [],
        beadId: 'pv-test-1',
      };

      let dispatchCallCount = 0;
      const mockSpawnFn = vi.fn().mockImplementation(() => {
        dispatchCallCount++;
        if (dispatchCallCount === 1) {
          return createMockChild(JSON.stringify(implementerResult), '', 0);
        }
        return createMockChild(JSON.stringify(auditVerdict), '', 0);
      });

      const matchResult = [
        { name: 'architecture-auditor', path: '.claude/agents/architecture-auditor.md', description: 'Arch', rationale: 'Match' },
      ];

      const mockSpawnSync = vi.fn().mockReturnValue({
        stdout: Buffer.from(JSON.stringify(matchResult)),
        stderr: Buffer.from(''),
        status: 0,
      });

      const result = await runLeafExecution('pv-test-1', ctx, {
        spawnFn: mockSpawnFn,
        scriptSpawnFn: mockSpawnSync,
        changedFiles: ['src/server/calendar/service/calendar.ts'],
      });

      expect(result.outcome).toBe('complete');
    });

    it('should retry once on audit fail and succeed on second attempt', async () => {
      const { runLeafExecution } = await import('../../lib/phase-7b-leaf.js');

      const implementerResult = { status: 'closed' };
      const failVerdict = {
        agent: 'security-auditor',
        verdict: 'fail',
        concerns: ['Missing input validation'],
        recommendations: ['Add validation'],
        beadId: 'pv-test-1',
      };
      const passVerdict = {
        agent: 'security-auditor',
        verdict: 'pass',
        concerns: [],
        recommendations: [],
        beadId: 'pv-test-1',
      };

      // Call sequence: implementer -> auditor(fail) -> retry implementer -> auditor(pass)
      let dispatchCallCount = 0;
      const mockSpawnFn = vi.fn().mockImplementation(() => {
        dispatchCallCount++;
        switch (dispatchCallCount) {
          case 1: return createMockChild(JSON.stringify(implementerResult), '', 0); // 1st implementer
          case 2: return createMockChild(JSON.stringify(failVerdict), '', 0);        // 1st audit
          case 3: return createMockChild(JSON.stringify(implementerResult), '', 0); // retry implementer
          case 4: return createMockChild(JSON.stringify(passVerdict), '', 0);        // 2nd audit
          default: return createMockChild(JSON.stringify(implementerResult), '', 0);
        }
      });

      const matchResult = [
        { name: 'security-auditor', path: '.claude/agents/security-auditor.md', description: 'Security', rationale: 'Match' },
      ];

      const mockSpawnSync = vi.fn().mockReturnValue({
        stdout: Buffer.from(JSON.stringify(matchResult)),
        stderr: Buffer.from(''),
        status: 0,
      });

      const result = await runLeafExecution('pv-test-1', ctx, {
        spawnFn: mockSpawnFn,
        scriptSpawnFn: mockSpawnSync,
        changedFiles: ['src/server/calendar/service/calendar.ts'],
      });

      expect(result.outcome).toBe('complete');
      expect(result.retryCount).toBe(1);
    });

    it('should escalate after retry exhaustion (audit fails twice)', async () => {
      const { runLeafExecution } = await import('../../lib/phase-7b-leaf.js');

      const implementerResult = { status: 'closed' };
      const failVerdict = {
        agent: 'security-auditor',
        verdict: 'fail',
        concerns: ['Persistent security issue'],
        recommendations: ['Needs human review'],
        beadId: 'pv-test-1',
      };

      let dispatchCallCount = 0;
      const mockSpawnFn = vi.fn().mockImplementation(() => {
        dispatchCallCount++;
        if (dispatchCallCount % 2 === 1) {
          return createMockChild(JSON.stringify(implementerResult), '', 0); // implementer
        }
        return createMockChild(JSON.stringify(failVerdict), '', 0); // auditor always fails
      });

      const matchResult = [
        { name: 'security-auditor', path: '.claude/agents/security-auditor.md', description: 'Security', rationale: 'Match' },
      ];

      // Mock for match-agents.sh
      const mockSpawnSync = vi.fn().mockImplementation((cmd: string) => {
        const scriptPath = typeof cmd === 'string' ? cmd : '';
        if (scriptPath.includes('match-agents')) {
          return {
            stdout: Buffer.from(JSON.stringify(matchResult)),
            stderr: Buffer.from(''),
            status: 0,
          };
        }
        // bd-escalate.sh
        return {
          stdout: Buffer.from('{}'),
          stderr: Buffer.from(''),
          status: 0,
        };
      });

      const result = await runLeafExecution('pv-test-1', ctx, {
        spawnFn: mockSpawnFn,
        scriptSpawnFn: mockSpawnSync,
        changedFiles: ['src/server/calendar/service/calendar.ts'],
        scriptExistsFn: () => true,
      });

      expect(result.outcome).toBe('halt');
      expect(result.reason).toContain('retry exhausted');
    });

    it('should escalate on implementer timeout', async () => {
      const { runLeafExecution } = await import('../../lib/phase-7b-leaf.js');

      // Create a hanging child that never closes (timeout)
      const child = new EventEmitter() as ChildProcess & EventEmitter;
      const stdoutStream = new Readable({ read() {} });
      const stderrStream = new Readable({ read() {} });
      child.stdin = { write: vi.fn(), end: vi.fn() } as unknown as ChildProcess['stdin'];
      child.stdout = stdoutStream;
      child.stderr = stderrStream;
      child.pid = 12345;
      child.kill = vi.fn().mockImplementation(() => {
        setImmediate(() => {
          stdoutStream.push(null);
          stderrStream.push(null);
          child.emit('close', null, 'SIGTERM');
        });
        return true;
      });

      const mockSpawnFn = vi.fn().mockReturnValue(child);

      const mockSpawnSync = vi.fn().mockImplementation(() => {
        return {
          stdout: Buffer.from('{}'),
          stderr: Buffer.from(''),
          status: 0,
        };
      });

      const result = await runLeafExecution('pv-test-1', ctx, {
        spawnFn: mockSpawnFn,
        scriptSpawnFn: mockSpawnSync,
        changedFiles: ['src/server/calendar/service/calendar.ts'],
        timeoutMs: 50,
        scriptExistsFn: () => true,
      });

      expect(result.outcome).toBe('halt');
      expect(result.reason).toContain('timed out');
    });
  });
});
