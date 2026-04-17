import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runShapeAdvisors,
  type ShapeAdvisorsDeps,
} from '../../lib/phase-3.5-advisors.js';
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
    beadId: 'pv-test-1',
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
    phase: 'phase-3-shape',
    advisors,
    overallVerdict: 'clean',
    summary: `All ${advisors.length} advisor(s) approved the bead plan.`,
  };
}

function refinementReport(beadId: string, advisors: AdvisorVerdict[]): RefinementReport {
  return {
    beadId,
    phase: 'phase-3-shape',
    advisors,
    overallVerdict: 'refinement-needed',
    summary: 'Some advisors need refinement',
  };
}

// ---------------------------------------------------------------------------
// runShapeAdvisors — no file hints
// ---------------------------------------------------------------------------

describe('runShapeAdvisors', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
  });

  it('should skip to Decompose when no file hints found', async () => {
    const ctx = makeCtx(logStub);
    const deps: ShapeAdvisorsDeps = {
      getFileHintsFn: () => [],
    };

    const result = await runShapeAdvisors(ctx, deps);

    expect(result.next).toBe(PhaseName.Decompose);
    const skipEntry = logStub.runJsonEntries.find(e => e.event === 'shape_advisors_skipped');
    expect(skipEntry).toBeDefined();
    expect(skipEntry!.reason).toContain('no file hints');
  });

  // -------------------------------------------------------------------------
  // No matched advisors
  // -------------------------------------------------------------------------

  it('should skip to Decompose when no advisors matched', async () => {
    const ctx = makeCtx(logStub);

    // match-agents.sh returns empty array
    const matchSpawn = vi.fn().mockReturnValue({
      stdout: Buffer.from('[]', 'utf-8'),
      stderr: Buffer.from('', 'utf-8'),
      status: 0,
      signal: null,
      pid: 1234,
      output: [null, Buffer.from('[]'), Buffer.from('')],
    });

    const deps: ShapeAdvisorsDeps = {
      getFileHintsFn: () => ['src/server/calendar/service/calendar.ts'],
      runScriptOpts: {
        spawnFn: matchSpawn,
        existsFn: () => true,
      },
      getBeadContextFn: () => 'bead context',
    };

    const result = await runShapeAdvisors(ctx, deps);

    expect(result.next).toBe(PhaseName.Decompose);
    const skipEntry = logStub.runJsonEntries.find(
      e => e.event === 'shape_advisors_skipped' && (e as Record<string, unknown>).reason === 'no advisors matched file set',
    );
    expect(skipEntry).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Single clean advisor → Decompose
  // -------------------------------------------------------------------------

  it('should proceed to Decompose when single advisor is clean', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('architecture-advisor')];
    const cleanAdvisorVerdict: AdvisorVerdict = {
      agent: 'architecture-advisor',
      verdict: 'clean',
      concerns: [],
      recommendations: [],
    };

    const deps: ShapeAdvisorsDeps = {
      getFileHintsFn: () => ['src/server/calendar/service/calendar.ts'],
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
        cleanReport('pv-test-1', [cleanAdvisorVerdict]),
      ),
    };

    const result = await runShapeAdvisors(ctx, deps);

    expect(result.next).toBe(PhaseName.Decompose);
    const passedEntry = logStub.runJsonEntries.find(e => e.event === 'shape_advisors_passed');
    expect(passedEntry).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Multi-advisor all clean → Decompose
  // -------------------------------------------------------------------------

  it('should proceed to Decompose when all advisors are clean', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [
      makeAdvisor('architecture-advisor'),
      makeAdvisor('security-advisor'),
    ];
    const cleanVerdicts: AdvisorVerdict[] = [
      { agent: 'architecture-advisor', verdict: 'clean', concerns: [], recommendations: [] },
      { agent: 'security-advisor', verdict: 'clean', concerns: [], recommendations: [] },
    ];

    const deps: ShapeAdvisorsDeps = {
      getFileHintsFn: () => ['src/server/calendar/service/calendar.ts', 'src/server/auth/api/login.ts'],
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
        cleanReport('pv-test-1', cleanVerdicts),
      ),
    };

    const result = await runShapeAdvisors(ctx, deps);

    expect(result.next).toBe(PhaseName.Decompose);
  });

  // -------------------------------------------------------------------------
  // One advisor escalates → escalate + halt
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

    const deps: ShapeAdvisorsDeps = {
      getFileHintsFn: () => ['src/server/calendar/service/calendar.ts'],
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
        refinementReport('pv-test-1', verdicts),
      ),
      escalateSpawnFn,
    };

    const result = await runShapeAdvisors(ctx, deps);

    expect(result.next).toBe('halt');
    expect(escalateSpawnFn).toHaveBeenCalledWith(
      '.claude/skills/bead-backlog-selection/bd-escalate.sh',
      expect.arrayContaining(['pv-test-1']),
      expect.objectContaining({ shell: true }),
    );
  });

  // -------------------------------------------------------------------------
  // Refinement needed (no escalate) → route back to Shape
  // -------------------------------------------------------------------------

  it('should route to Shape when advisors need refinement but no escalate', async () => {
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

    const deps: ShapeAdvisorsDeps = {
      getFileHintsFn: () => ['src/server/calendar/service/calendar.ts'],
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
        refinementReport('pv-test-1', verdicts),
      ),
    };

    const result = await runShapeAdvisors(ctx, deps);

    expect(result.next).toBe(PhaseName.Shape);
    // Refinement report should be attached to ctx
    expect((result.ctx as OrchestratorContext & { refinementReport?: RefinementReport }).refinementReport).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Logging: file hints event
  // -------------------------------------------------------------------------

  it('should log file hints event', async () => {
    const ctx = makeCtx(logStub);
    const deps: ShapeAdvisorsDeps = {
      getFileHintsFn: () => ['src/server/app.ts'],
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

    await runShapeAdvisors(ctx, deps);

    const hintsEntry = logStub.runJsonEntries.find(e => e.event === 'shape_advisors_file_hints');
    expect(hintsEntry).toBeDefined();
    expect(hintsEntry!.fileCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Logging: matched advisors event
  // -------------------------------------------------------------------------

  it('should log matched advisors event', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('test-advisor')];

    const deps: ShapeAdvisorsDeps = {
      getFileHintsFn: () => ['src/server/app.ts'],
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
        cleanReport('pv-test-1', [{ agent: 'test-advisor', verdict: 'clean', concerns: [], recommendations: [] }]),
      ),
    };

    await runShapeAdvisors(ctx, deps);

    const matchedEntry = logStub.runJsonEntries.find(e => e.event === 'shape_advisors_matched');
    expect(matchedEntry).toBeDefined();
    expect(matchedEntry!.advisorCount).toBe(1);
    expect(matchedEntry!.advisorNames).toEqual(['test-advisor']);
  });

  // -------------------------------------------------------------------------
  // Fan-out called with correct arguments
  // -------------------------------------------------------------------------

  it('should call fanOutFn with correct arguments', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('arch-advisor')];
    const fanOutFn = vi.fn().mockResolvedValue(
      cleanReport('pv-test-1', [{ agent: 'arch-advisor', verdict: 'clean', concerns: [], recommendations: [] }]),
    );

    const deps: ShapeAdvisorsDeps = {
      getFileHintsFn: () => ['src/server/app.ts'],
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

    await runShapeAdvisors(ctx, deps);

    expect(fanOutFn).toHaveBeenCalledWith(
      advisors,
      'pv-test-1',
      'full bead context here',
      'phase-3-shape',
      ctx,
      PhaseName.ShapeAdvisors,
      undefined,
    );
  });
});
