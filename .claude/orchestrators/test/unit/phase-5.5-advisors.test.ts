import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runAnalyzeAdvisors,
  type AnalyzeAdvisorsDeps,
} from '../../lib/phase-5.5-advisors.js';
import { PhaseName, type RunLogger } from '../../lib/context.js';
import type { OrchestratorContext } from '../../process-backlog.js';
import type {
  AdvisorVerdict,
  MatchedAdvisor,
  RefinementReport,
} from '../../lib/fan-out-advisors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubLogger() {
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

function makeCtx(
  logStub: ReturnType<typeof stubLogger>,
  overrides: Partial<OrchestratorContext> = {},
): OrchestratorContext {
  return {
    runId: 'test-run-001',
    beadId: 'pv-test-epic',
    logger: logStub.logger,
    phaseHistory: [],
    dryRun: false,
    ...overrides,
  };
}

function makeAdvisor(name: string): MatchedAdvisor {
  return {
    name,
    path: `.claude/agents/${name}.md`,
    description: `${name} agent`,
    rationale: 'matched by test',
  };
}

function cleanReport(beadId: string, advisors: AdvisorVerdict[]): RefinementReport {
  return {
    beadId,
    phase: 'phase-5-analyze',
    advisors,
    overallVerdict: 'clean',
    summary: `All ${advisors.length} advisor(s) approved the bead plan.`,
  };
}

function refinementReport(beadId: string, advisors: AdvisorVerdict[]): RefinementReport {
  return {
    beadId,
    phase: 'phase-5-analyze',
    advisors,
    overallVerdict: 'refinement-needed',
    summary: 'Some advisors need refinement',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runAnalyzeAdvisors', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
  });

  // -------------------------------------------------------------------------
  // Skip condition: leaf bead (not epic)
  // -------------------------------------------------------------------------

  it('should skip to Branch when bead is a leaf (not epic)', async () => {
    const ctx = makeCtx(logStub);
    const deps: AnalyzeAdvisorsDeps = {
      isEpicFn: () => false,
    };

    const result = await runAnalyzeAdvisors(ctx, deps);

    expect(result.next).toBe(PhaseName.Branch);
    const skipEntry = logStub.runJsonEntries.find(e => e.event === 'analyze_advisors_skipped');
    expect(skipEntry).toBeDefined();
    expect(skipEntry!.reason).toContain('leaf');
  });

  // -------------------------------------------------------------------------
  // No file hints → skip to Branch
  // -------------------------------------------------------------------------

  it('should skip to Branch when no file hints found', async () => {
    const ctx = makeCtx(logStub);
    const deps: AnalyzeAdvisorsDeps = {
      isEpicFn: () => true,
      getLeafFileHintsFn: () => [],
    };

    const result = await runAnalyzeAdvisors(ctx, deps);

    expect(result.next).toBe(PhaseName.Branch);
    const skipEntry = logStub.runJsonEntries.find(e => e.event === 'analyze_advisors_skipped');
    expect(skipEntry).toBeDefined();
    expect(skipEntry!.reason).toContain('no file hints');
  });

  // -------------------------------------------------------------------------
  // No matched advisors → skip to Branch
  // -------------------------------------------------------------------------

  it('should skip to Branch when no advisors matched', async () => {
    const ctx = makeCtx(logStub);

    const matchSpawn = vi.fn().mockReturnValue({
      stdout: Buffer.from('[]', 'utf-8'),
      stderr: Buffer.from('', 'utf-8'),
      status: 0,
      signal: null,
      pid: 1234,
      output: [null, Buffer.from('[]'), Buffer.from('')],
    });

    const deps: AnalyzeAdvisorsDeps = {
      isEpicFn: () => true,
      getLeafFileHintsFn: () => ['src/server/calendar/service/calendar.ts'],
      runScriptOpts: {
        spawnFn: matchSpawn,
        existsFn: () => true,
      },
      getBeadContextFn: () => 'bead context',
    };

    const result = await runAnalyzeAdvisors(ctx, deps);

    expect(result.next).toBe(PhaseName.Branch);
    const skipEntry = logStub.runJsonEntries.find(
      e => e.event === 'analyze_advisors_skipped' && (e as Record<string, unknown>).reason === 'no advisors matched file set',
    );
    expect(skipEntry).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Clean verdict → proceed to Branch (Phase 6)
  // -------------------------------------------------------------------------

  it('should proceed to Branch when single advisor is clean', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('architecture-advisor')];
    const cleanAdvisorVerdict: AdvisorVerdict = {
      agent: 'architecture-advisor',
      verdict: 'clean',
      concerns: [],
      recommendations: [],
    };

    const deps: AnalyzeAdvisorsDeps = {
      isEpicFn: () => true,
      getLeafFileHintsFn: () => ['src/server/calendar/service/calendar.ts'],
      runScriptOpts: {
        spawnFn: vi.fn().mockReturnValue({
          stdout: Buffer.from(JSON.stringify(advisors), 'utf-8'),
          stderr: Buffer.from('', 'utf-8'),
          status: 0,
          signal: null,
          pid: 1234,
          output: [null, Buffer.from(JSON.stringify(advisors)), Buffer.from('')],
        }),
        existsFn: () => true,
      },
      getBeadContextFn: () => 'bead context',
      fanOutFn: vi.fn().mockResolvedValue(
        cleanReport('pv-test-epic', [cleanAdvisorVerdict]),
      ),
    };

    const result = await runAnalyzeAdvisors(ctx, deps);

    expect(result.next).toBe(PhaseName.Branch);
    const passedEntry = logStub.runJsonEntries.find(e => e.event === 'analyze_advisors_passed');
    expect(passedEntry).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Multi-advisor all clean → Branch
  // -------------------------------------------------------------------------

  it('should proceed to Branch when all advisors are clean', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [
      makeAdvisor('architecture-advisor'),
      makeAdvisor('security-advisor'),
    ];
    const cleanVerdicts: AdvisorVerdict[] = [
      { agent: 'architecture-advisor', verdict: 'clean', concerns: [], recommendations: [] },
      { agent: 'security-advisor', verdict: 'clean', concerns: [], recommendations: [] },
    ];

    const deps: AnalyzeAdvisorsDeps = {
      isEpicFn: () => true,
      getLeafFileHintsFn: () => ['src/server/calendar/service/calendar.ts', 'src/server/auth/api/login.ts'],
      runScriptOpts: {
        spawnFn: vi.fn().mockReturnValue({
          stdout: Buffer.from(JSON.stringify(advisors), 'utf-8'),
          stderr: Buffer.from('', 'utf-8'),
          status: 0,
          signal: null,
          pid: 1234,
          output: [null, Buffer.from(JSON.stringify(advisors)), Buffer.from('')],
        }),
        existsFn: () => true,
      },
      getBeadContextFn: () => 'bead context',
      fanOutFn: vi.fn().mockResolvedValue(
        cleanReport('pv-test-epic', cleanVerdicts),
      ),
    };

    const result = await runAnalyzeAdvisors(ctx, deps);

    expect(result.next).toBe(PhaseName.Branch);
  });

  // -------------------------------------------------------------------------
  // Escalate → escalate + halt
  // -------------------------------------------------------------------------

  it('should escalate and halt when an advisor escalates', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [
      makeAdvisor('architecture-advisor'),
      makeAdvisor('security-advisor'),
    ];
    const verdicts: AdvisorVerdict[] = [
      { agent: 'architecture-advisor', verdict: 'clean', concerns: [], recommendations: [] },
      { agent: 'security-advisor', verdict: 'escalate', concerns: ['Critical gap'], recommendations: ['Fix it'] },
    ];

    const escalateSpawnFn = vi.fn().mockReturnValue({
      stdout: Buffer.from('', 'utf-8'),
      stderr: Buffer.from('', 'utf-8'),
      status: 0,
      signal: null,
      pid: 1234,
      output: [null, Buffer.from(''), Buffer.from('')],
    });

    const deps: AnalyzeAdvisorsDeps = {
      isEpicFn: () => true,
      getLeafFileHintsFn: () => ['src/server/calendar/service/calendar.ts'],
      runScriptOpts: {
        spawnFn: vi.fn().mockReturnValue({
          stdout: Buffer.from(JSON.stringify(advisors), 'utf-8'),
          stderr: Buffer.from('', 'utf-8'),
          status: 0,
          signal: null,
          pid: 1234,
          output: [null, Buffer.from(JSON.stringify(advisors)), Buffer.from('')],
        }),
        existsFn: () => true,
      },
      getBeadContextFn: () => 'bead context',
      fanOutFn: vi.fn().mockResolvedValue(
        refinementReport('pv-test-epic', verdicts),
      ),
      escalateSpawnFn,
    };

    const result = await runAnalyzeAdvisors(ctx, deps);

    expect(result.next).toBe('halt');
    expect(escalateSpawnFn).toHaveBeenCalledWith(
      '.claude/skills/bead-backlog-selection/bd-escalate.sh',
      expect.arrayContaining(['pv-test-epic']),
      expect.objectContaining({ shell: true }),
    );
  });

  // -------------------------------------------------------------------------
  // Escalation uses phase tag "5.5"
  // -------------------------------------------------------------------------

  it('should use phase tag "5.5" for escalation', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('security-advisor')];
    const verdicts: AdvisorVerdict[] = [
      { agent: 'security-advisor', verdict: 'escalate', concerns: ['Severe'], recommendations: [] },
    ];

    const escalateSpawnFn = vi.fn().mockReturnValue({
      stdout: Buffer.from('', 'utf-8'),
      stderr: Buffer.from('', 'utf-8'),
      status: 0,
      signal: null,
      pid: 1234,
      output: [null, Buffer.from(''), Buffer.from('')],
    });

    const deps: AnalyzeAdvisorsDeps = {
      isEpicFn: () => true,
      getLeafFileHintsFn: () => ['src/server/app.ts'],
      runScriptOpts: {
        spawnFn: vi.fn().mockReturnValue({
          stdout: Buffer.from(JSON.stringify(advisors), 'utf-8'),
          stderr: Buffer.from('', 'utf-8'),
          status: 0,
          signal: null,
          pid: 1234,
          output: [null, Buffer.from(JSON.stringify(advisors)), Buffer.from('')],
        }),
        existsFn: () => true,
      },
      getBeadContextFn: () => 'bead context',
      fanOutFn: vi.fn().mockResolvedValue(
        refinementReport('pv-test-epic', verdicts),
      ),
      escalateSpawnFn,
    };

    await runAnalyzeAdvisors(ctx, deps);

    // The third argument to bd-escalate.sh should be "5.5"
    expect(escalateSpawnFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['5.5']),
      expect.any(Object),
    );
  });

  // -------------------------------------------------------------------------
  // Refinement needed (no escalate) → route back to Analyze (Phase 5)
  // -------------------------------------------------------------------------

  it('should route to Analyze when advisors need refinement but no escalate', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('consistency-advisor')];
    const verdicts: AdvisorVerdict[] = [
      {
        agent: 'consistency-advisor',
        verdict: 'refinement-needed',
        concerns: ['Missing pattern'],
        recommendations: ['Add the pattern'],
      },
    ];

    const deps: AnalyzeAdvisorsDeps = {
      isEpicFn: () => true,
      getLeafFileHintsFn: () => ['src/server/calendar/service/calendar.ts'],
      runScriptOpts: {
        spawnFn: vi.fn().mockReturnValue({
          stdout: Buffer.from(JSON.stringify(advisors), 'utf-8'),
          stderr: Buffer.from('', 'utf-8'),
          status: 0,
          signal: null,
          pid: 1234,
          output: [null, Buffer.from(JSON.stringify(advisors)), Buffer.from('')],
        }),
        existsFn: () => true,
      },
      getBeadContextFn: () => 'bead context',
      fanOutFn: vi.fn().mockResolvedValue(
        refinementReport('pv-test-epic', verdicts),
      ),
    };

    const result = await runAnalyzeAdvisors(ctx, deps);

    expect(result.next).toBe(PhaseName.Analyze);
    // Refinement report should be attached to ctx
    expect((result.ctx as OrchestratorContext & { refinementReport?: RefinementReport }).refinementReport).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Fan-out called with 'phase-5-analyze' phase tag
  // -------------------------------------------------------------------------

  it('should call fanOutFn with phase-5-analyze and AnalyzeAdvisors log tag', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('arch-advisor')];
    const fanOutFn = vi.fn().mockResolvedValue(
      cleanReport('pv-test-epic', [{ agent: 'arch-advisor', verdict: 'clean', concerns: [], recommendations: [] }]),
    );

    const deps: AnalyzeAdvisorsDeps = {
      isEpicFn: () => true,
      getLeafFileHintsFn: () => ['src/server/app.ts'],
      runScriptOpts: {
        spawnFn: vi.fn().mockReturnValue({
          stdout: Buffer.from(JSON.stringify(advisors), 'utf-8'),
          stderr: Buffer.from('', 'utf-8'),
          status: 0,
          signal: null,
          pid: 1234,
          output: [null, Buffer.from(JSON.stringify(advisors)), Buffer.from('')],
        }),
        existsFn: () => true,
      },
      getBeadContextFn: () => 'full bead context here',
      fanOutFn,
    };

    await runAnalyzeAdvisors(ctx, deps);

    expect(fanOutFn).toHaveBeenCalledWith(
      advisors,
      'pv-test-epic',
      'full bead context here',
      'phase-5-analyze',
      ctx,
      PhaseName.AnalyzeAdvisors,
      undefined,
    );
  });

  // -------------------------------------------------------------------------
  // Logging: file hints event
  // -------------------------------------------------------------------------

  it('should log file hints event', async () => {
    const ctx = makeCtx(logStub);
    const deps: AnalyzeAdvisorsDeps = {
      isEpicFn: () => true,
      getLeafFileHintsFn: () => ['src/server/app.ts'],
      runScriptOpts: {
        spawnFn: vi.fn().mockReturnValue({
          stdout: Buffer.from('[]', 'utf-8'),
          stderr: Buffer.from('', 'utf-8'),
          status: 0,
          signal: null,
          pid: 1234,
          output: [null, Buffer.from('[]'), Buffer.from('')],
        }),
        existsFn: () => true,
      },
    };

    await runAnalyzeAdvisors(ctx, deps);

    const hintsEntry = logStub.runJsonEntries.find(e => e.event === 'analyze_advisors_file_hints');
    expect(hintsEntry).toBeDefined();
    expect(hintsEntry!.fileCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Logging: matched advisors event
  // -------------------------------------------------------------------------

  it('should log matched advisors event', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('test-advisor')];

    const deps: AnalyzeAdvisorsDeps = {
      isEpicFn: () => true,
      getLeafFileHintsFn: () => ['src/server/app.ts'],
      runScriptOpts: {
        spawnFn: vi.fn().mockReturnValue({
          stdout: Buffer.from(JSON.stringify(advisors), 'utf-8'),
          stderr: Buffer.from('', 'utf-8'),
          status: 0,
          signal: null,
          pid: 1234,
          output: [null, Buffer.from(JSON.stringify(advisors)), Buffer.from('')],
        }),
        existsFn: () => true,
      },
      getBeadContextFn: () => 'bead context',
      fanOutFn: vi.fn().mockResolvedValue(
        cleanReport('pv-test-epic', [{ agent: 'test-advisor', verdict: 'clean', concerns: [], recommendations: [] }]),
      ),
    };

    await runAnalyzeAdvisors(ctx, deps);

    const matchedEntry = logStub.runJsonEntries.find(e => e.event === 'analyze_advisors_matched');
    expect(matchedEntry).toBeDefined();
    expect(matchedEntry!.advisorCount).toBe(1);
    expect(matchedEntry!.advisorNames).toEqual(['test-advisor']);
  });
});
