/**
 * How full a monitored filesystem is, relative to the configured thresholds.
 */
export type DiskLevel = 'normal' | 'warning' | 'critical';

/**
 * The alert level last sent for a monitored filesystem. `normal` is never
 * stored: a normal reading clears the state instead.
 */
export type DiskAlertLevel = Exclude<DiskLevel, 'normal'>;

/**
 * The alert state stored beside a filesystem's usage snapshot: which level was
 * last alerted, and when. Both null when no alert is outstanding.
 */
export interface DiskAlertState {
  level: DiskAlertLevel | null;
  sentAt: Date | null;
}

/**
 * What the disk:check run should do with its reading:
 * - `send`: alert the administrators, then record the state
 * - `skip`: an alert for this level went out within the resend interval
 * - `clear`: usage is normal; forget any stored alert state
 */
export type DiskAlertDecision = 'send' | 'skip' | 'clear';

/** While a level holds, the alert repeats at most this often. */
export const DISK_ALERT_RESEND_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Decides whether a disk reading should alert.
 *
 * Sends on any change of level, in either direction (critical → warning sends
 * once too), and then at most once per resend interval while the level holds.
 * A stored level without a send time is treated as never sent.
 *
 * @param level - Level of the current reading
 * @param stored - Alert state stored from earlier runs
 * @param now - Time of the current reading
 * @returns The action to take
 */
export function decideDiskAlert(level: DiskLevel, stored: DiskAlertState, now: Date): DiskAlertDecision {
  if (level === 'normal') {
    return 'clear';
  }

  if (level !== stored.level || stored.sentAt === null) {
    return 'send';
  }

  return now.getTime() - stored.sentAt.getTime() >= DISK_ALERT_RESEND_INTERVAL_MS ? 'send' : 'skip';
}
