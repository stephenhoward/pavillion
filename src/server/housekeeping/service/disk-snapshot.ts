import { DiskUsageSnapshotEntity } from '@/server/housekeeping/entity/disk-snapshot';
import { DiskUsageStats } from '@/server/housekeeping/service/disk-monitor';

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
export default class DiskSnapshotService {
  /**
   * Records (upserts) a filesystem usage snapshot.
   *
   * Called from the worker's disk:check job. Overwrites any existing row for
   * the same key rather than appending, so the table stays one row per
   * monitored filesystem.
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
}
