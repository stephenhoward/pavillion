/**
 * Types for epic wave orchestration (phase-7a-epic).
 *
 * This module defines the state and result types that drive
 * the wave lifecycle documented in bead-wave-orchestration SKILL.md.
 * It is types-only (no runtime logic) to keep imports clean.
 */

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
