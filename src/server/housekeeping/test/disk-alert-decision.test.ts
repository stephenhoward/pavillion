import { describe, it, expect } from 'vitest';
import {
  decideDiskAlert,
  DiskAlertState,
  DiskLevel,
  DiskAlertDecision,
} from '@/server/housekeeping/service/disk-alert-decision';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

const NONE: DiskAlertState = { level: null, sentAt: null };

/**
 * The disk alert sends on a change of state, then at most once every 24 hours
 * while the state holds. A normal reading clears the stored state so the next
 * crossing sends again.
 */
describe('decideDiskAlert', () => {
  it.each<[string, DiskLevel, DiskAlertState, DiskAlertDecision]>([
    ['normal clears a stored warning', 'normal', { level: 'warning', sentAt: ago(HOUR_MS) }, 'clear'],
    ['normal with nothing stored still clears', 'normal', NONE, 'clear'],
    ['normal → warning sends', 'warning', NONE, 'send'],
    ['normal → critical sends', 'critical', NONE, 'send'],
    ['warning → critical sends', 'critical', { level: 'warning', sentAt: ago(HOUR_MS) }, 'send'],
    ['critical → warning sends', 'warning', { level: 'critical', sentAt: ago(HOUR_MS) }, 'send'],
    ['same level at 23h59m skips', 'critical', { level: 'critical', sentAt: ago(24 * HOUR_MS - 60 * 1000) }, 'skip'],
    ['same level at exactly 24h sends', 'critical', { level: 'critical', sentAt: ago(24 * HOUR_MS) }, 'send'],
    ['non-null level with null sentAt sends', 'warning', { level: 'warning', sentAt: null }, 'send'],
  ])('%s', (_label, level, stored, expected) => {
    expect(decideDiskAlert(level, stored, NOW)).toBe(expected);
  });
});
