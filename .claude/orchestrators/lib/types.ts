/**
 * Shared types, enums, constants, and logger for orchestrator runs.
 *
 * This module merges:
 *   - context.ts  — PhaseName enum, PhaseResult, RunLogger, RunContext interfaces
 *   - wave-types.ts — ImplementerSlot, WaveState, WaveVerdict, BuildStatus, WaveResult types + constants
 *   - logger.ts — createRunLogger() factory function
 *
 * All other orchestrator modules import from here instead of the three separate files.
 */

// ─── from context.ts ────────────────────────────────────────────────────────

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
  /** Append a structured entry to run.jsonl (newline-delimited JSON). */
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

// ─── from wave-types.ts ──────────────────────────────────────────────────────

/**
 * A single implementer slot within a wave.
 * The orchestrator maintains at most 3 concurrent slots.
 */
export interface ImplementerSlot {
  /** Bead ID assigned to this slot. */
  beadId: string;
  /** When the implementer was dispatched. */
  startedAt: Date;
  /** OS process ID of the dispatched subagent, if available. */
  dispatchPid?: number;
}

/**
 * Mutable state of a wave in progress.
 * The orchestrator updates this as implementers close and auditors report.
 */
export interface WaveState {
  /** The epic this wave belongs to. */
  epicId: string;
  /** 1-indexed wave number. */
  waveNumber: number;
  /** Bead IDs currently being implemented (in-flight). */
  beadsInProgress: string[];
  /** Bead IDs that have been closed in this wave. */
  beadsCompleted: string[];
  /** Bead IDs that failed or were escalated in this wave. */
  beadsFailed: string[];
  /** Active implementer slots (max 3). */
  implementerSlots: ImplementerSlot[];
  /** Bead IDs queued for dispatch when a slot opens. */
  cascadeQueue: string[];
}

/**
 * Verdict values for wave-end verification.
 */
export type WaveVerdict = 'pass' | 'fail' | 'escalate';

/**
 * Build status reported by the build-guardian.
 */
export type BuildStatus = 'green' | 'red';

/**
 * Immutable result of a completed wave, matching the wave-verdict.json schema.
 */
export interface WaveResult {
  /** The epic this wave belongs to. */
  epicId: string;
  /** 1-indexed wave number. */
  waveNumber: number;
  /** Wave-end verification verdict. */
  verdict: WaveVerdict;
  /** Build-guardian outcome. */
  buildStatus: BuildStatus;
  /** Bead IDs successfully closed in this wave. */
  beadsCompleted: string[];
  /** Bead IDs that failed or were escalated. */
  beadsFailed: string[];
  /** Issues identified during wave-end verification. */
  concerns: string[];
  /** Bead IDs unblocked by this wave's completion. */
  nextWaveReady: string[];
}

/** Maximum concurrent implementer slots per wave. */
export const MAX_IMPLEMENTER_SLOTS = 3;

/** Maximum retries per bead in epic wave context. */
export const MAX_WAVE_RETRIES = 2;

/** Maximum retries per bead in single-leaf context. */
export const MAX_LEAF_RETRIES = 1;

// ─── from logger.ts ──────────────────────────────────────────────────────────

import { mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const LOGS_ROOT = join(dirname(import.meta.url.replace('file://', '')), '..', 'logs');

/**
 * Generate a unique run-id: ISO timestamp (compact) + 4-char hex suffix.
 *
 * Example: `20260416T143022-a1b2`
 */
function generateRunId(): string {
  const now = new Date();
  const ts = now.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', 'T')
    .split('.')[0];
  const suffix = randomBytes(2).toString('hex');
  return `${ts}-${suffix}`;
}

/**
 * Create a RunLogger bound to a specific run-id.
 *
 * The run directory is created lazily on the first write call.
 */
export function createRunLogger(runId?: string): RunLogger & { runId: string } {
  const id = runId ?? generateRunId();
  const dir = join(LOGS_ROOT, id);
  let dirCreated = false;

  function ensureDir(): void {
    if (!dirCreated) {
      mkdirSync(dir, { recursive: true });
      dirCreated = true;
    }
  }

  return {
    runId: id,

    writePhaseLog(phase: PhaseName, kind: 'out' | 'err', data: string): void {
      ensureDir();
      const ext = kind === 'out' ? 'log' : 'err';
      const filePath = join(dir, `${phase}.${ext}`);
      appendFileSync(filePath, data);
    },

    appendRunJson(entry: Record<string, unknown>): void {
      ensureDir();
      const filePath = join(dir, 'run.jsonl');
      appendFileSync(filePath, JSON.stringify(entry) + '\n');
    },

    runDir(): string {
      ensureDir();
      return dir;
    },
  };
}
