/**
 * Types and enums for orchestrator run context.
 *
 * This module is types-only (no runtime logic) so that dispatch.ts
 * and run-script.ts can import freely without circular refs.
 */

/**
 * Canonical phase names used throughout the orchestrator pipeline.
 */
export enum PhaseName {
  Preflight = 'phase-0-preflight',
  Select = 'phase-1-select',
  State = 'phase-2-state',
  Shape = 'phase-3-shape',
  ShapeAdvisors = 'phase-3.5-advisors',
  Decompose = 'phase-4-decompose',
  Analyze = 'phase-5-analyze',
  AnalyzeAdvisors = 'phase-5.5-advisors',
  Branch = 'phase-6-branch',
  Epic = 'phase-7a-epic',
  Leaf = 'phase-7b-leaf',
  PR = 'phase-8-pr',
  Report = 'phase-9-report',
  Halt = 'halt',
}

/**
 * Outcome of a single phase execution.
 */
export interface PhaseResult {
  phase: PhaseName;
  ok: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Logger interface consumed by phases.
 * Keeps context.ts runtime-free — the concrete implementation lives in logger.ts.
 */
export interface RunLogger {
  /** Write stdout-style output for a phase. */
  writePhaseLog(phase: PhaseName, kind: 'out' | 'err', data: string): void;
  /** Append a structured entry to run.json. */
  appendRunJson(entry: Record<string, unknown>): void;
  /** Absolute path to the per-run log directory. */
  runDir(): string;
}

/**
 * Shared context threaded through every phase of a single orchestrator run.
 */
export interface RunContext {
  runId: string;
  beadId: string;
  logger: RunLogger;
  phaseHistory: PhaseResult[];
}
