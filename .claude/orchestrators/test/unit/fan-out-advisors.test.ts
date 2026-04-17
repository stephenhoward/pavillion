import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fanOutAdvisors,
  buildAdvisorPrompt,
  ADVISOR_BUDGET_DEFAULT,
  ADVISOR_TIMEOUT_MS,
  type AdvisorVerdict,
  type MatchedAdvisor,
  type FanOutDeps,
} from '../../lib/fan-out-advisors.js';
import { PhaseName, type RunLogger } from '../../lib/context.js';
import type { RunContext } from '../../lib/context.js';

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

function makeCtx(logStub: ReturnType<typeof stubLogger>): RunContext {
  return {
    runId: 'test-run-001',
    beadId: 'pv-test-1',
    logger: logStub.logger,
    phaseHistory: [],
  };
}

function makeAdvisor(name: string): MatchedAdvisor {
  return {
    name,
    path: `.claude/agents/${name}.md`,
    description: `${name} agent`,
    rationale: `matched by test`,
  };
}

function cleanVerdict(agent: string): AdvisorVerdict {
  return {
    agent,
    verdict: 'clean',
    concerns: [],
    recommendations: [],
  };
}

function refinementVerdict(agent: string): AdvisorVerdict {
  return {
    agent,
    verdict: 'refinement-needed',
    concerns: ['Missing error handling pattern'],
    recommendations: ['Add try/catch around API calls'],
  };
}

function escalateVerdict(agent: string): AdvisorVerdict {
  return {
    agent,
    verdict: 'escalate',
    concerns: ['Critical security gap in design'],
    recommendations: ['Redesign auth flow'],
  };
}

// ---------------------------------------------------------------------------
// buildAdvisorPrompt
// ---------------------------------------------------------------------------

describe('buildAdvisorPrompt', () => {
  it('should include advisor name in prompt', () => {
    const prompt = buildAdvisorPrompt('security-advisor', 'pv-abc-1', 'some context');
    expect(prompt).toContain('security-advisor');
  });

  it('should include bead id in prompt', () => {
    const prompt = buildAdvisorPrompt('security-advisor', 'pv-abc-1', 'some context');
    expect(prompt).toContain('pv-abc-1');
  });

  it('should include bead context in prompt', () => {
    const prompt = buildAdvisorPrompt('security-advisor', 'pv-abc-1', 'Full bead description here');
    expect(prompt).toContain('Full bead description here');
  });

  it('should reference the advisor-verdict schema output format', () => {
    const prompt = buildAdvisorPrompt('security-advisor', 'pv-abc-1', 'ctx');
    expect(prompt).toContain('advisor-verdict');
  });
});

// ---------------------------------------------------------------------------
// fanOutAdvisors — empty advisor list
// ---------------------------------------------------------------------------

describe('fanOutAdvisors', () => {
  let logStub: ReturnType<typeof stubLogger>;

  beforeEach(() => {
    logStub = stubLogger();
  });

  it('should return clean report for empty advisor list', async () => {
    const ctx = makeCtx(logStub);
    const report = await fanOutAdvisors(
      [], 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors,
    );

    expect(report.overallVerdict).toBe('clean');
    expect(report.advisors).toHaveLength(0);
    expect(report.beadId).toBe('pv-test-1');
    expect(report.phase).toBe('phase-3-shape');
  });

  // -------------------------------------------------------------------------
  // Single clean advisor
  // -------------------------------------------------------------------------

  it('should return clean when single advisor approves', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('architecture-advisor')];
    const deps: FanOutDeps = {
      dispatchFn: vi.fn().mockResolvedValue(cleanVerdict('architecture-advisor')),
    };

    const report = await fanOutAdvisors(
      advisors, 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors, deps,
    );

    expect(report.overallVerdict).toBe('clean');
    expect(report.advisors).toHaveLength(1);
    expect(report.advisors[0].verdict).toBe('clean');
  });

  // -------------------------------------------------------------------------
  // Multi-advisor all clean
  // -------------------------------------------------------------------------

  it('should return clean when all advisors approve', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [
      makeAdvisor('architecture-advisor'),
      makeAdvisor('security-advisor'),
      makeAdvisor('consistency-advisor'),
    ];

    const dispatchFn = vi.fn()
      .mockResolvedValueOnce(cleanVerdict('architecture-advisor'))
      .mockResolvedValueOnce(cleanVerdict('security-advisor'))
      .mockResolvedValueOnce(cleanVerdict('consistency-advisor'));

    const deps: FanOutDeps = { dispatchFn };

    const report = await fanOutAdvisors(
      advisors, 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors, deps,
    );

    expect(report.overallVerdict).toBe('clean');
    expect(report.advisors).toHaveLength(3);
    expect(dispatchFn).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // One advisor escalates
  // -------------------------------------------------------------------------

  it('should return refinement-needed when one advisor escalates', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [
      makeAdvisor('architecture-advisor'),
      makeAdvisor('security-advisor'),
    ];

    const dispatchFn = vi.fn()
      .mockResolvedValueOnce(cleanVerdict('architecture-advisor'))
      .mockResolvedValueOnce(escalateVerdict('security-advisor'));

    const deps: FanOutDeps = { dispatchFn };

    const report = await fanOutAdvisors(
      advisors, 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors, deps,
    );

    expect(report.overallVerdict).toBe('refinement-needed');
    expect(report.advisors).toHaveLength(2);
    expect(report.advisors[1].verdict).toBe('escalate');
  });

  // -------------------------------------------------------------------------
  // One advisor requests refinement
  // -------------------------------------------------------------------------

  it('should return refinement-needed when one advisor needs refinement', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [
      makeAdvisor('architecture-advisor'),
      makeAdvisor('consistency-advisor'),
    ];

    const dispatchFn = vi.fn()
      .mockResolvedValueOnce(cleanVerdict('architecture-advisor'))
      .mockResolvedValueOnce(refinementVerdict('consistency-advisor'));

    const deps: FanOutDeps = { dispatchFn };

    const report = await fanOutAdvisors(
      advisors, 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors, deps,
    );

    expect(report.overallVerdict).toBe('refinement-needed');
    expect(report.summary).toContain('consistency-advisor');
  });

  // -------------------------------------------------------------------------
  // Dispatch failure becomes concern entry
  // -------------------------------------------------------------------------

  it('should handle dispatch timeout gracefully as escalate verdict', async () => {
    const { DispatchTimeoutError } = await import('../../lib/dispatch.js');

    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('slow-advisor')];
    const deps: FanOutDeps = {
      dispatchFn: vi.fn().mockRejectedValue(
        new DispatchTimeoutError('slow-advisor', 120_000),
      ),
    };

    const report = await fanOutAdvisors(
      advisors, 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors, deps,
    );

    expect(report.overallVerdict).toBe('refinement-needed');
    expect(report.advisors[0].verdict).toBe('escalate');
    expect(report.advisors[0].concerns[0]).toContain('timed out');
  });

  it('should handle dispatch malformed error gracefully', async () => {
    const { DispatchMalformedError } = await import('../../lib/dispatch.js');

    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('broken-advisor')];
    const deps: FanOutDeps = {
      dispatchFn: vi.fn().mockRejectedValue(
        new DispatchMalformedError('broken-advisor', 'garbage', 'not json'),
      ),
    };

    const report = await fanOutAdvisors(
      advisors, 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors, deps,
    );

    expect(report.overallVerdict).toBe('refinement-needed');
    expect(report.advisors[0].verdict).toBe('escalate');
    expect(report.advisors[0].concerns[0]).toContain('malformed');
  });

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  it('should log fan_out_start event', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('test-advisor')];
    const deps: FanOutDeps = {
      dispatchFn: vi.fn().mockResolvedValue(cleanVerdict('test-advisor')),
    };

    await fanOutAdvisors(
      advisors, 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors, deps,
    );

    const startEntry = logStub.runJsonEntries.find(e => e.event === 'advisors_fan_out_start');
    expect(startEntry).toBeDefined();
    expect(startEntry!.advisorCount).toBe(1);
  });

  it('should log fan_out_complete event', async () => {
    const ctx = makeCtx(logStub);
    const advisors = [makeAdvisor('test-advisor')];
    const deps: FanOutDeps = {
      dispatchFn: vi.fn().mockResolvedValue(cleanVerdict('test-advisor')),
    };

    await fanOutAdvisors(
      advisors, 'pv-test-1', 'context', 'phase-3-shape', ctx, PhaseName.ShapeAdvisors, deps,
    );

    const completeEntry = logStub.runJsonEntries.find(e => e.event === 'advisors_fan_out_complete');
    expect(completeEntry).toBeDefined();
    expect(completeEntry!.overallVerdict).toBe('clean');
  });

  // -------------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------------

  it('should export sensible default constants', () => {
    expect(ADVISOR_BUDGET_DEFAULT).toBeGreaterThan(0);
    expect(ADVISOR_TIMEOUT_MS).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Phase tag in report
  // -------------------------------------------------------------------------

  it('should set the phase tag from the caller', async () => {
    const ctx = makeCtx(logStub);
    const report = await fanOutAdvisors(
      [], 'pv-test-1', 'context', 'phase-5-analyze', ctx, PhaseName.AnalyzeAdvisors,
    );

    expect(report.phase).toBe('phase-5-analyze');
  });
});
