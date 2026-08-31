import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import StorageService, { StorageStats } from '@/server/housekeeping/service/storage';
import StatusService, { HousekeepingStatus } from '@/server/housekeeping/service/status';
import JobQueueService, { JobPublishOptions } from '@/server/housekeeping/service/job-queue';
import MetricsService, { OperationalMetrics } from '@/server/housekeeping/service/metrics';
import { BackupEntity } from '@/server/housekeeping/entity/backup';

// Re-exported so other domains set a job's retry/expiry policy via the
// housekeeping boundary without reaching into the pg-boss adapter directly.
export type { JobPublishOptions } from '@/server/housekeeping/service/job-queue';

// Re-exported so callers (e.g. the management CLI) can type backup storage
// stats without importing the StorageService internal.
export type { StorageStats } from '@/server/housekeeping/service/storage';

// Re-exported so callers can type the admin dashboard status payload without
// importing the StatusService internal.
export type { HousekeepingStatus } from '@/server/housekeeping/service/status';

// Re-exported so the metrics exposition can name the operational values it
// renders without importing the MetricsService internal. These are plain typed
// objects rather than TranslatedModel domain models: they never cross the
// client/server JSON boundary, so `toObject`/`fromObject` would be ceremony
// with no consumer.
export type {
  OperationalMetrics,
  BackupMetrics,
  WorkerVolumeMetrics,
  VolumeMetrics,
  QueueMetrics,
} from '@/server/housekeeping/service/metrics';

/**
 * Backup metadata exposed across the housekeeping domain boundary.
 *
 * A plain DTO projection of {@link BackupEntity} so callers (e.g. the
 * management CLI) can read backup records without importing the Sequelize
 * entity directly (DEC-003 domain boundary).
 */
export interface BackupRecord {
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: Date;
  type: 'manual' | 'scheduled';
  category: 'daily' | 'weekly' | 'monthly';
  verified: boolean;
  storageLocation: string;
}

/**
 * Projects a BackupEntity onto the boundary-safe {@link BackupRecord} DTO.
 * BIGINT `size_bytes` arrives as a string from some drivers, so it is coerced
 * to a number here once rather than at every call site.
 */
function toBackupRecord(entity: BackupEntity): BackupRecord {
  return {
    id: entity.id,
    filename: entity.filename,
    sizeBytes: Number(entity.size_bytes),
    createdAt: entity.created_at,
    type: entity.type,
    category: entity.category,
    verified: entity.verified,
    storageLocation: entity.storage_location,
  };
}

/**
 * Housekeeping domain interface for cross-domain communication.
 *
 * Provides access to housekeeping functionality such as backup management,
 * disk monitoring, and system maintenance tasks.
 */
export default class HousekeepingInterface {
  private emailInterface: EmailInterface;
  private accountsInterface: AccountsInterface;
  private storageService: StorageService;
  private statusService: StatusService;
  private metricsService: MetricsService;
  private jobQueueService: JobQueueService | null = null;

  constructor(emailInterface: EmailInterface, accountsInterface: AccountsInterface) {
    this.emailInterface = emailInterface;
    this.accountsInterface = accountsInterface;
    this.storageService = new StorageService();
    this.statusService = new StatusService();
    this.metricsService = new MetricsService();
  }

  /**
   * Wires a started JobQueueService into the interface so other domains can
   * publish background jobs through `publishJob`. Set once by
   * `HousekeepingDomain.initialize()` in the web process. Worker and CLI
   * processes own their own JobQueueService directly and do not call this.
   */
  setJobQueueService(queue: JobQueueService): void {
    this.jobQueueService = queue;
  }

  /**
   * Publishes a background job through the housekeeping-owned pg-boss queue.
   * Other domains call this rather than importing JobQueueService directly,
   * keeping the queue infrastructure encapsulated inside the housekeeping
   * domain (DEC-003 domain boundary).
   *
   * @param jobName - pg-boss queue name (e.g. `activitypub:follow:backfill`)
   * @param data - JSON-serialisable job payload
   * @param options - Optional per-job retry/expiry policy (domain-neutral;
   *   see {@link JobPublishOptions}). Omit to inherit the queue defaults.
   * @throws Error if the queue has not been wired in via setJobQueueService.
   *   In production this should never happen — `HousekeepingDomain.initialize`
   *   wires the queue before AP handlers can fire. The throw exists so
   *   miswiring fails loudly rather than silently dropping jobs.
   */
  async publishJob<T = any>(jobName: string, data: T, options?: JobPublishOptions): Promise<void> {
    if (!this.jobQueueService) {
      throw new Error(
        `HousekeepingInterface.publishJob('${jobName}') called before a JobQueueService was wired in. ` +
        'This indicates a server-startup ordering bug — housekeeping must initialize before any domain that publishes jobs.',
      );
    }
    await this.jobQueueService.publish(jobName, data, options);
  }

  /**
   * Gets the status of the housekeeping system.
   * Used by dashboard and API endpoints.
   *
   * @returns Status information including backups, disk usage, and alerts
   */
  async getStatus(): Promise<HousekeepingStatus> {
    return this.statusService.getStatus();
  }

  /**
   * Gets the operational values exposed by the metrics endpoint.
   *
   * The single read path for every metric family, so the exposition layer
   * never reaches past the domain boundary into a housekeeping service or
   * entity (DEC-003). Each family is independently nullable; null means the
   * value has no data or could not be read, and the caller must emit no series
   * rather than a defaulted zero.
   *
   * @param now - Reference time for time-windowed counts; defaults to now
   * @returns The operational metric values
   */
  async getOperationalMetrics(now?: Date): Promise<OperationalMetrics> {
    return this.metricsService.collect(now);
  }

  /**
   * Gets the email interface for sending alerts.
   *
   * @returns EmailInterface instance
   */
  getEmailInterface(): EmailInterface {
    return this.emailInterface;
  }

  /**
   * Gets the accounts interface for querying admin users.
   *
   * @returns AccountsInterface instance
   */
  getAccountsInterface(): AccountsInterface {
    return this.accountsInterface;
  }

  /**
   * Lists all recorded backups, newest first.
   *
   * Used by the management CLI's `backup list` command so it can render the
   * backup inventory without importing the StorageService internal.
   *
   * @returns Backup records ordered by creation date descending
   */
  async listBackups(): Promise<BackupRecord[]> {
    const backups = await this.storageService.listBackups();
    return backups.map(toBackupRecord);
  }

  /**
   * Gets a single backup by id.
   *
   * Used by the management CLI's `backup restore` command to look up the
   * backup to restore.
   *
   * @param id - Backup id
   * @returns The backup record, or null if no backup has that id
   */
  async getBackup(id: string): Promise<BackupRecord | null> {
    const backup = await this.storageService.getBackup(id);
    return backup ? toBackupRecord(backup) : null;
  }

  /**
   * Gets the most recent verified backup.
   *
   * Used by the management CLI's `backup status` command. Distinct from
   * StatusService's `lastBackup` (which returns the trimmed shape the admin
   * dashboard needs) — the CLI needs the full record.
   *
   * @returns The latest verified backup record, or null if none exist
   */
  async getLastVerifiedBackup(): Promise<BackupRecord | null> {
    const lastBackup = await BackupEntity.findOne({
      where: { verified: true },
      order: [['created_at', 'DESC']],
    });
    return lastBackup ? toBackupRecord(lastBackup) : null;
  }

  /**
   * Gets storage statistics for the backup volume.
   *
   * Used by the management CLI's `backup status` command.
   *
   * @returns Storage statistics including total size, count, and free space
   */
  async getStorageStats(): Promise<StorageStats> {
    return this.storageService.getStorageStats();
  }

  /**
   * Queues a one-off manual backup job and returns its id.
   *
   * Used by the management CLI's `backup create` command. Self-contained: it
   * owns a short-lived JobQueueService for the publish rather than the
   * long-lived queue wired in by `setJobQueueService`, because CLI invocations
   * are separate processes that don't go through `HousekeepingDomain.initialize`.
   * The queue is always stopped afterwards so the CLI process can exit cleanly.
   *
   * @returns The published job's id, or null if pg-boss returns none
   */
  async queueManualBackup(): Promise<string | null> {
    const queue = new JobQueueService();
    await queue.start();
    try {
      return await queue.publish('backup:create', { type: 'manual' });
    }
    finally {
      await queue.stop();
    }
  }
}
