import path from 'path';
import config from 'config';
import db from '@/server/common/entity/db';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import DiskMonitorService from '@/server/housekeeping/service/disk-monitor';
import DiskSnapshotService, { BACKUP_PATH_STAT_KEY } from '@/server/housekeeping/service/disk-snapshot';
import JobQueueService from '@/server/housekeeping/service/job-queue';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('housekeeping');

/**
 * Queues reported on by the operational metrics endpoint.
 *
 * A fixed, statically enumerable list that mirrors the queues the worker
 * registers in `src/server/worker.ts`. It is deliberately not derived from
 * pg-boss at runtime: a queue label must never be per-entity or attacker
 * influenced, and an operator's alert rules should not silently gain or lose
 * series because a queue row appeared in the database.
 */
export const MONITORED_QUEUES = [
  'backup:create',
  'backup:daily',
  'disk:check',
  'moderation:ip-cleanup',
  'notifications:cleanup',
  'inbox:cleanup',
  'activitypub:follow:backfill',
] as const;

/**
 * Window used for the per-queue failed-job count. pg-boss deletes job rows a
 * day after creation, so nothing older than this is observable anyway.
 */
export const FAILED_JOB_WINDOW_HOURS = 24;

/**
 * The metric families the project has declared (DEC-017 rule 4), reserving
 * `pavillion_federation_` for future work.
 *
 * Every published series name must sit inside one of these. The families are
 * the operator contract, not merely the `pavillion_` prefix: a name outside
 * them is a family nobody agreed to, and renaming it after publication costs
 * a deprecation note plus an alert that quietly stops firing.
 */
export const METRIC_FAMILY_PREFIXES = [
  'pavillion_backup_',
  'pavillion_disk_',
  'pavillion_db_',
  'pavillion_media_',
  'pavillion_queue_',
] as const;

/** Last verified backup. Absent when no verified backup exists yet. */
export interface BackupMetrics {
  /** Unix seconds at which the backup was created. */
  lastSuccessTimestampSeconds: number;
  lastSuccessSizeBytes: number;
}

/** Filesystem usage for one volume. */
export interface VolumeMetrics {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}

/**
 * Usage for a filesystem the worker measured on the web process's behalf,
 * plus the age of the snapshot it came from.
 *
 * `statKey` becomes the series label, so measuring a second filesystem
 * worker-side adds label values rather than changing the identity of an
 * already-published series. Only one filesystem is measured today; when a
 * second appears this field becomes a list, which does not change the wire
 * contract.
 */
export interface WorkerVolumeMetrics extends VolumeMetrics {
  /** Snapshot key, exposed as the series label (e.g. 'backup_path'). */
  statKey: string;
  /** Unix seconds at which the worker measured these values. */
  snapshotTimestampSeconds: number;
}

/** Aggregate job counts for one queue. Counts only, never job detail. */
export interface QueueMetrics {
  queue: string;
  depth: number;
  failedJobs: number;
}

/**
 * The complete set of operational values the metrics endpoint may expose.
 *
 * Every family is independently nullable, and null means "emit no series".
 * A metric with no underlying data — and a metric whose source failed — is an
 * absent series, never a defaulted zero, because a zero an operator alerts on
 * must mean the instance measured zero.
 */
export interface OperationalMetrics {
  backup: BackupMetrics | null;
  workerVolume: WorkerVolumeMetrics | null;
  databaseSizeBytes: number | null;
  mediaVolume: VolumeMetrics | null;
  /** Null when queue state could not be read at all; never a partial list. */
  queues: QueueMetrics[] | null;
}

/**
 * Collects the housekeeping values exposed by the operational metrics
 * endpoint.
 *
 * Each metric family is gathered independently and failure-isolated: a source
 * that throws yields null for its own family and leaves its siblings intact,
 * so one unmounted volume or one unreachable schema cannot blank the whole
 * scrape.
 */
export default class MetricsService {
  private diskMonitor: DiskMonitorService;
  private diskSnapshots: DiskSnapshotService;

  constructor() {
    this.diskMonitor = new DiskMonitorService();
    this.diskSnapshots = new DiskSnapshotService();
  }

  /**
   * Gathers every metric family.
   *
   * @param now - Reference time for the failed-job window; defaults to now
   * @returns The operational metric values, with an absent family as null
   */
  async collect(now: Date = new Date()): Promise<OperationalMetrics> {
    const [backup, workerVolume, databaseSizeBytes, mediaVolume, queues] = await Promise.all([
      this.isolate('backup', () => this.getBackupMetrics()),
      this.isolate('workerVolume', () => this.getWorkerVolumeMetrics()),
      this.isolate('databaseSize', () => this.getDatabaseSizeBytes()),
      this.isolate('mediaVolume', () => this.getMediaVolumeMetrics()),
      this.isolate('queues', () => this.getQueueMetrics(now)),
    ]);

    return { backup, workerVolume, databaseSizeBytes, mediaVolume, queues };
  }

  /**
   * Runs one metric source, converting a throw into an absent family.
   *
   * Logged at warn rather than error: an unmounted volume or a SQLite
   * development database is an expected shape of "no data", not a fault.
   *
   * @param family - Metric family name, for the log line only
   * @param source - The collector to run
   * @returns The collected value, or null if the source failed
   */
  private async isolate<T>(family: string, source: () => Promise<T | null>): Promise<T | null> {
    try {
      return await source();
    }
    catch (error) {
      logger.warn({ err: error, family }, 'Metric source unavailable; omitting series');
      return null;
    }
  }

  /**
   * Reads the most recent verified backup.
   *
   * Uses the same criteria as StatusService's `lastBackup` so the metric and
   * the admin status panel cannot disagree about which backup is current.
   */
  private async getBackupMetrics(): Promise<BackupMetrics | null> {
    const lastBackup = await BackupEntity.findOne({
      where: { verified: true },
      order: [['created_at', 'DESC']],
    });

    if (!lastBackup) {
      return null;
    }

    return {
      lastSuccessTimestampSeconds: Math.floor(lastBackup.created_at.getTime() / 1000),
      lastSuccessSizeBytes: Number(lastBackup.size_bytes),
    };
  }

  /**
   * Reads backup-volume usage from the worker-written snapshot.
   *
   * The web process cannot statfs the backup path — the volume is mounted
   * into the worker container only — so the snapshot table is the only source.
   */
  private async getWorkerVolumeMetrics(): Promise<WorkerVolumeMetrics | null> {
    const snapshot = await this.diskSnapshots.getSnapshot(BACKUP_PATH_STAT_KEY);
    if (!snapshot) {
      return null;
    }

    return {
      // Deliberately the snapshot key, not `snapshot.path`: the key is a
      // stable in-code identifier, while the path is host filesystem layout
      // that has no business in a scrapeable series.
      statKey: snapshot.statKey,
      totalBytes: snapshot.totalBytes,
      freeBytes: snapshot.freeBytes,
      usedBytes: snapshot.usedBytes,
      snapshotTimestampSeconds: Math.floor(snapshot.writtenAt.getTime() / 1000),
    };
  }

  /**
   * Reads the on-disk size of the application database.
   *
   * PostgreSQL-only by construction: `pg_database_size` does not exist on
   * SQLite, so a development instance throws here and the series is absent.
   */
  private async getDatabaseSizeBytes(): Promise<number | null> {
    const [rows] = await db.query('SELECT pg_database_size(current_database()) AS size_bytes');
    const sizeBytes = (rows as { size_bytes: string | number }[])[0]?.size_bytes;

    return sizeBytes === undefined ? null : Number(sizeBytes);
  }

  /**
   * Measures the media volume, which does mount on the app container.
   *
   * Returns null for object-storage deployments: there is no local volume to
   * report on, and a zero would misrepresent that as an empty disk.
   */
  private async getMediaVolumeMetrics(): Promise<VolumeMetrics | null> {
    if (config.get<string>('media.storage.driver') !== 'local') {
      return null;
    }

    const basePath = config.get<string>('media.storage.basePath');
    const resolved = path.isAbsolute(basePath) ? basePath : path.join(process.cwd(), basePath);
    const usage = await this.diskMonitor.checkDiskUsage(resolved);

    return {
      totalBytes: Number(usage.totalBytes),
      freeBytes: Number(usage.freeBytes),
      usedBytes: Number(usage.usedBytes),
    };
  }

  /**
   * Reads per-queue depth and recent failure counts.
   *
   * A queue with no rows at all is reported as zero rather than omitted: when
   * the query succeeds we genuinely know the count is zero, and "no failures"
   * is the signal an operator most needs to be able to see.
   *
   * @param now - Reference time for the failed-job window
   */
  private async getQueueMetrics(now: Date): Promise<QueueMetrics[]> {
    const failedSince = new Date(now.getTime() - FAILED_JOB_WINDOW_HOURS * 60 * 60 * 1000);
    const queueNames = [...MONITORED_QUEUES];

    const stats = await new JobQueueService().getQueueStats(queueNames, failedSince);
    const byQueue = new Map(stats.map((entry) => [entry.queue, entry]));

    return queueNames.map((queue) => ({
      queue,
      depth: byQueue.get(queue)?.depth ?? 0,
      failedJobs: byQueue.get(queue)?.failed ?? 0,
    }));
  }
}
