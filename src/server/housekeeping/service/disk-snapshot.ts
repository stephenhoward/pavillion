import { DiskUsageSnapshotEntity } from '@/server/housekeeping/entity/disk-snapshot';
import { DiskUsageStats } from '@/server/housekeeping/service/disk-monitor';
import { DiskAlertLevel, DiskAlertState } from '@/server/housekeeping/service/disk-alert-decision';

/**
 * Stable key for the backup volume's usage snapshot. The worker writes under
 * this key; the admin status panel and the metrics endpoint read it.
 */
export const BACKUP_PATH_STAT_KEY = 'backup_path';

/**
 * A filesystem usage snapshot as read back by the web process.
 *
 * Byte counts are plain numbers rather than bigints: they cross into JSON
 * responses and metric text, and `Number.MAX_SAFE_INTEGER` bytes is ~9 exabytes.
 */
export interface DiskSnapshot {
  statKey: string;
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  percentageUsed: number;
  /** When the worker measured these values. */
  writtenAt: Date;
}

/**
 * Reads and writes worker-measured filesystem usage snapshots.
 *
 * This is the single read path for backup-volume disk usage in the web
 * process. The app container does not mount the backup volume, so statfs of
 * the backup path fails there — the worker measures, this table carries the
 * result across the process boundary.
 */
const MEASUREMENT_COLUMNS: (keyof DiskUsageSnapshotEntity)[] = [
  'path',
  'total_bytes',
  'free_bytes',
  'used_bytes',
  'percentage_used',
  'written_at',
];

export default class DiskSnapshotService {
  /**
   * Records (upserts) a filesystem usage snapshot.
   *
   * Called from the worker's disk:check job. Overwrites any existing row for
   * the same key rather than appending, so the table stays one row per
   * monitored filesystem. Only the measurement columns are written: the
   * row's alert state belongs to setAlertState and survives every hourly write.
   *
   * @param statKey - Stable identifier for the monitored filesystem
   * @param stats - Usage statistics as measured by DiskMonitorService
   * @param writtenAt - Measurement time; defaults to now
   */
  async recordSnapshot(statKey: string, stats: DiskUsageStats, writtenAt: Date = new Date()): Promise<void> {
    await DiskUsageSnapshotEntity.upsert({
      stat_key: statKey,
      path: stats.path,
      total_bytes: stats.totalBytes.toString(),
      free_bytes: stats.freeBytes.toString(),
      used_bytes: stats.usedBytes.toString(),
      percentage_used: stats.percentageUsed,
      written_at: writtenAt,
    }, {
      fields: MEASUREMENT_COLUMNS,
    });
  }

  /**
   * Reads the most recent snapshot for a monitored filesystem.
   *
   * @param statKey - Stable identifier for the monitored filesystem
   * @returns The snapshot, or null when the worker has never written one
   */
  async getSnapshot(statKey: string): Promise<DiskSnapshot | null> {
    const row = await DiskUsageSnapshotEntity.findByPk(statKey);
    if (!row) {
      return null;
    }

    return {
      statKey: row.stat_key,
      path: row.path,
      // BIGINT arrives as a string from the postgres driver and as a number
      // from sqlite, so coerce once here rather than at every call site.
      totalBytes: Number(row.total_bytes),
      freeBytes: Number(row.free_bytes),
      usedBytes: Number(row.used_bytes),
      percentageUsed: Number(row.percentage_used),
      writtenAt: row.written_at,
    };
  }

  /**
   * Reads the disk alert state stored beside a filesystem's snapshot.
   *
   * @param statKey - Stable identifier for the monitored filesystem
   * @returns The level last alerted and when; both null when no alert is
   *   outstanding or no snapshot exists
   */
  async getAlertState(statKey: string): Promise<DiskAlertState> {
    const row = await DiskUsageSnapshotEntity.findByPk(statKey, {
      attributes: ['alert_level', 'alert_sent_at'],
    });

    return {
      level: row?.alert_level ?? null,
      sentAt: row?.alert_sent_at ?? null,
    };
  }

  /**
   * Records the disk alert state for a filesystem; `(null, null)` clears it.
   *
   * Writes only the two alert columns, so it never moves `written_at` — the
   * measurement time behind the status panel's reading and the snapshot
   * timestamp metric. A filesystem with no snapshot row has nothing to update:
   * the worker records the snapshot before it alerts.
   *
   * @param statKey - Stable identifier for the monitored filesystem
   * @param level - Alert level just sent, or null to clear
   * @param sentAt - When it was sent, or null to clear
   */
  async setAlertState(statKey: string, level: DiskAlertLevel | null, sentAt: Date | null): Promise<void> {
    await DiskUsageSnapshotEntity.update(
      { alert_level: level, alert_sent_at: sentAt },
      { where: { stat_key: statKey } },
    );
  }
}
