import { describe, it, expect } from 'vitest';
import type {
  ImplementerSlot,
  WaveState,
  WaveResult,
  WaveVerdict,
  BuildStatus,
} from '../../lib/wave-types.js';
import {
  MAX_IMPLEMENTER_SLOTS,
  MAX_WAVE_RETRIES,
  MAX_LEAF_RETRIES,
} from '../../lib/wave-types.js';

describe('wave-types', () => {
  describe('constants', () => {
    it('should enforce 3-implementer cap', () => {
      expect(MAX_IMPLEMENTER_SLOTS).toBe(3);
    });

    it('should allow 2 retries in epic wave context', () => {
      expect(MAX_WAVE_RETRIES).toBe(2);
    });

    it('should allow 1 retry in single-leaf context', () => {
      expect(MAX_LEAF_RETRIES).toBe(1);
    });
  });

  describe('ImplementerSlot', () => {
    it('should model a slot with required fields', () => {
      const slot: ImplementerSlot = {
        beadId: 'pv-1mt6.1',
        startedAt: new Date('2026-04-16T10:00:00Z'),
      };

      expect(slot.beadId).toBe('pv-1mt6.1');
      expect(slot.startedAt).toBeInstanceOf(Date);
      expect(slot.dispatchPid).toBeUndefined();
    });

    it('should allow optional dispatchPid', () => {
      const slot: ImplementerSlot = {
        beadId: 'pv-1mt6.2',
        startedAt: new Date('2026-04-16T10:00:00Z'),
        dispatchPid: 12345,
      };

      expect(slot.dispatchPid).toBe(12345);
    });
  });

  describe('WaveState', () => {
    it('should model a wave in progress', () => {
      const state: WaveState = {
        epicId: 'pv-1mt6',
        waveNumber: 1,
        beadsInProgress: ['pv-1mt6.1', 'pv-1mt6.2'],
        beadsCompleted: [],
        beadsFailed: [],
        implementerSlots: [
          { beadId: 'pv-1mt6.1', startedAt: new Date() },
          { beadId: 'pv-1mt6.2', startedAt: new Date() },
        ],
        cascadeQueue: ['pv-1mt6.3'],
      };

      expect(state.implementerSlots).toHaveLength(2);
      expect(state.implementerSlots.length).toBeLessThanOrEqual(MAX_IMPLEMENTER_SLOTS);
      expect(state.cascadeQueue).toEqual(['pv-1mt6.3']);
    });

    it('should model a completed wave', () => {
      const state: WaveState = {
        epicId: 'pv-1mt6',
        waveNumber: 1,
        beadsInProgress: [],
        beadsCompleted: ['pv-1mt6.1', 'pv-1mt6.2'],
        beadsFailed: [],
        implementerSlots: [],
        cascadeQueue: [],
      };

      expect(state.beadsInProgress).toHaveLength(0);
      expect(state.beadsCompleted).toHaveLength(2);
    });
  });

  describe('WaveResult', () => {
    it('should model a passing wave result', () => {
      const result: WaveResult = {
        epicId: 'pv-1mt6',
        waveNumber: 1,
        verdict: 'pass',
        buildStatus: 'green',
        beadsCompleted: ['pv-1mt6.1', 'pv-1mt6.2'],
        beadsFailed: [],
        concerns: [],
        nextWaveReady: ['pv-1mt6.3'],
      };

      expect(result.verdict).toBe('pass');
      expect(result.buildStatus).toBe('green');
    });

    it('should model a failing wave result', () => {
      const result: WaveResult = {
        epicId: 'pv-1mt6',
        waveNumber: 2,
        verdict: 'fail',
        buildStatus: 'red',
        beadsCompleted: ['pv-1mt6.3'],
        beadsFailed: ['pv-1mt6.4'],
        concerns: ['Build failed after pv-1mt6.4 merge'],
        nextWaveReady: [],
      };

      expect(result.verdict).toBe('fail');
      expect(result.beadsFailed).toContain('pv-1mt6.4');
    });

    it('should have fields matching wave-verdict.json schema', () => {
      // Verify structural alignment: WaveResult has the same fields
      // as the wave-verdict.json schema's required properties.
      const expectedFields = [
        'epicId', 'waveNumber', 'verdict', 'buildStatus',
        'beadsCompleted', 'beadsFailed', 'concerns', 'nextWaveReady',
      ];

      const result: WaveResult = {
        epicId: '',
        waveNumber: 1,
        verdict: 'pass',
        buildStatus: 'green',
        beadsCompleted: [],
        beadsFailed: [],
        concerns: [],
        nextWaveReady: [],
      };

      for (const field of expectedFields) {
        expect(result).toHaveProperty(field);
      }
      // No extra properties beyond the schema's fields
      expect(Object.keys(result).sort()).toEqual(expectedFields.sort());
    });
  });

  describe('type narrowing', () => {
    it('should narrow WaveVerdict to valid values', () => {
      const verdicts: WaveVerdict[] = ['pass', 'fail', 'escalate'];
      expect(verdicts).toHaveLength(3);
    });

    it('should narrow BuildStatus to valid values', () => {
      const statuses: BuildStatus[] = ['green', 'red'];
      expect(statuses).toHaveLength(2);
    });
  });
});
