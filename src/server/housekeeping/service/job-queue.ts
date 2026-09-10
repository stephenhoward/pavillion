import PgBoss from 'pg-boss';
import config from 'config';
import { Client } from 'pg';
import { logError } from '@/server/common/helper/error-logger';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('housekeeping');

/**
 * Database configuration interface matching Sequelize config structure
 */
interface DatabaseConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  username?: string;
  password?: string;
  dialect?: string;
  storage?: string;
}

/**
 * Job retry metadata forwarded from pg-boss to the handler.
 */
export interface JobMeta {
  retryCount: number;
  retryLimit: number;
}

/**
 * Domain-neutral per-job publish options. Lets a publishing domain set the
 * retry/expiry policy for one job without depending on pg-boss types directly
 * (the mapping to pg-boss `SendOptions` stays inside this adapter, preserving
 * the DEC-003 boundary that keeps queue machinery encapsulated in
 * housekeeping). Any field left unset inherits the queue default established
 * by {@link JobQueueService.ensureQueue}.
 */
export interface JobPublishOptions {
  /** Maximum number of automatic retries after the first failed attempt. */
  retryLimit?: number;
  /** Delay before the first retry, in seconds (grows when retryBackoff is on). */
  retryDelaySeconds?: number;
  /** Exponentially grow the retry delay across successive attempts. */
  retryBackoff?: boolean;
  /** How long a single attempt may run before pg-boss considers it expired. */
  expireInSeconds?: number;
}

/**
 * Job handler function type.
 *
 * Handlers may declare an optional second parameter to receive pg-boss retry
 * metadata (`retryCount`, `retryLimit`). Legacy handlers that ignore the second
 * argument continue to work unchanged.
 */
export type JobHandler<T = any> = (data: T, meta?: JobMeta) => Promise<void>;

/**
 * Aggregate job counts for one queue.
 *
 * Counts only. No job id, payload, or error text is read out of pg-boss —
 * a job payload can carry account- or calendar-scoped data, and these numbers
 * are consumed by an operational-telemetry surface that must describe the
 * instance's operation and never its audience.
 */
export interface QueueJobStats {
  /** pg-boss queue name. */
  queue: string;
  /** Jobs waiting or running (states created, retry, active). */
  depth: number;
  /** Jobs in the failed state within the requested window. */
  failed: number;
}

/**
 * Job queue service using pg-boss for PostgreSQL-native job scheduling.
 *
 * Provides methods for publishing jobs (web mode), subscribing to jobs (worker mode),
 * and scheduling recurring jobs with cron expressions.
 */
export default class JobQueueService {
  private boss: PgBoss | null = null;
  private connectionString: string;
  private dialect: string;
  private started: boolean = false;

  /**
   * Creates a new JobQueueService instance.
   *
   * @param dbConfig - Database configuration object (optional, defaults to config library)
   */
  constructor(dbConfig?: DatabaseConfig) {
    const actualConfig = dbConfig || config.get<DatabaseConfig>('database');
    this.dialect = actualConfig.dialect || 'postgres';
    this.connectionString = this.buildConnectionString(actualConfig);
  }

  /**
   * Builds a PostgreSQL connection string from config object.
   *
   * @param dbConfig - Database configuration
   * @returns PostgreSQL connection string
   */
  private buildConnectionString(dbConfig: DatabaseConfig): string {
    // For SQLite (testing), use a default PostgreSQL connection
    if (dbConfig.dialect === 'sqlite') {
      // In test mode, pg-boss won't actually connect, but we need a valid format
      return 'postgres://test:test@localhost:5432/test';
    }

    // URL-encode credentials and database name so URL-special characters
    // (e.g. @ : / ? # %) in a password don't produce a malformed connection
    // string. pg-connection-string.parse() throws on invalid URLs, which
    // crashes pg-boss start in worker mode.
    const user = encodeURIComponent(dbConfig.user || dbConfig.username || 'postgres');
    const password = encodeURIComponent(dbConfig.password || '');
    const host = dbConfig.host || 'localhost';
    const port = dbConfig.port || 5432;
    const database = encodeURIComponent(dbConfig.database || 'pavillion');

    return `postgres://${user}:${password}@${host}:${port}/${database}`;
  }

  /**
   * Starts the pg-boss connection.
   * Must be called before using other methods.
   *
   * @throws Error if connection fails
   */
  async start(): Promise<void> {
    try {
      this.boss = new PgBoss(this.connectionString);

      // Register error handler
      this.boss.on('error', (error) => {
        logError(error, '[Housekeeping] pg-boss error');
      });

      await this.boss.start();
      this.started = true;
      logger.info('pg-boss connected and started');
    }
    catch (error) {
      logError(error, '[Housekeeping] Failed to start pg-boss');
      throw error;
    }
  }

  /**
   * Stops the pg-boss connection gracefully.
   * Should be called during application shutdown.
   */
  async stop(): Promise<void> {
    if (this.boss) {
      await this.boss.stop();
      this.started = false;
      logger.info('pg-boss stopped');
    }
  }

  /**
   * Publishes a job to the queue (web mode).
   *
   * @param jobName - Name of the job queue
   * @param data - Job data to pass to the handler
   * @param options - Optional per-job retry/expiry policy. When omitted the
   *   queue defaults apply.
   * @returns Job ID
   * @throws Error if service not started
   */
  async publish<T = any>(jobName: string, data: T, options?: JobPublishOptions): Promise<string | null> {
    if (!this.started || !this.boss) {
      throw new Error('JobQueueService not started. Call start() first.');
    }

    const jobId = options
      ? await this.boss.send(jobName, data as object, this.toSendOptions(options))
      : await this.boss.send(jobName, data as object);
    logger.info({ jobName, jobId }, 'Published job');
    return jobId;
  }

  /**
   * Maps the domain-neutral {@link JobPublishOptions} onto pg-boss
   * `SendOptions`. Only explicitly-set fields are forwarded so unset options
   * continue to inherit the queue defaults rather than being overridden with
   * undefined.
   */
  private toSendOptions(options: JobPublishOptions): PgBoss.SendOptions {
    const sendOptions: PgBoss.SendOptions = {};
    if (options.retryLimit !== undefined) {
      sendOptions.retryLimit = options.retryLimit;
    }
    if (options.retryDelaySeconds !== undefined) {
      sendOptions.retryDelay = options.retryDelaySeconds;
    }
    if (options.retryBackoff !== undefined) {
      sendOptions.retryBackoff = options.retryBackoff;
    }
    if (options.expireInSeconds !== undefined) {
      sendOptions.expireInSeconds = options.expireInSeconds;
    }
    return sendOptions;
  }

  /**
   * Ensures a queue exists by creating it directly in the database.
   * This bypasses pg-boss's automatic queue creation which has reliability issues.
   *
   * @param queueName - Name of the job queue to create
   * @private
   */
  private async ensureQueue(queueName: string): Promise<void> {
    // For SQLite (testing), skip queue creation - pg-boss won't actually connect
    const dbConfig = config.get<DatabaseConfig>('database');
    if (dbConfig.dialect === 'sqlite') {
      return;
    }

    // Create a direct PostgreSQL connection for queue creation
    const client = new Client(this.connectionString);

    try {
      await client.connect();

      // Insert queue entry with standard configuration
      // Uses ON CONFLICT DO NOTHING for idempotency
      const query = `
        INSERT INTO pgboss.queue (
          name, policy, retry_limit, retry_delay, retry_backoff,
          expire_seconds, retention_seconds, deletion_seconds,
          partition, table_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (name) DO NOTHING
        RETURNING name;
      `;

      const values = [
        queueName,           // name
        'standard',          // policy
        2,                   // retry_limit
        0,                   // retry_delay
        true,                // retry_backoff
        60,                  // expire_seconds (1 minute)
        86400,               // retention_seconds (1 day)
        86400,               // deletion_seconds (1 day)
        false,               // partition
        'job',               // table_name
      ];

      const result = await client.query(query, values);

      if (result.rows.length > 0) {
        logger.info({ queueName }, 'Created queue');
      }
      else {
        logger.info({ queueName }, 'Queue already exists');
      }
    }
    catch (error) {
      logError(error, `[Housekeeping] Failed to create queue ${queueName}`);
      throw error;
    }
    finally {
      await client.end();
    }
  }

  /**
   * Subscribes to a job queue for processing (worker mode).
   *
   * @param jobName - Name of the job queue to process
   * @param handler - Function to handle jobs
   * @throws Error if service not started
   */
  async subscribe<T = any>(jobName: string, handler: JobHandler<T>): Promise<void> {
    if (!this.started || !this.boss) {
      throw new Error('JobQueueService not started. Call start() first.');
    }

    // Ensure queue exists before subscribing
    await this.ensureQueue(jobName);

    // pg-boss v10+ delivers an array of jobs to the work handler (batchSize
    // defaults to 1, so the array typically has one entry). Iterate so a
    // future batchSize bump doesn't silently drop work, and so payloads
    // reach the handler — earlier code read `job.data` off the array
    // itself, which is undefined.
    await this.boss.work(jobName, { includeMetadata: true }, async (jobs: any) => {
      const jobArray = Array.isArray(jobs) ? jobs : [jobs];
      for (const job of jobArray) {
        try {
          logger.info({ jobName, jobId: job.id }, 'Processing job');
          await handler(job.data, { retryCount: job.retryCount, retryLimit: job.retryLimit });
          logger.info({ jobName, jobId: job.id }, 'Completed job');
        }
        catch (error) {
          logError(error, `[Housekeeping] Error processing job ${jobName} (ID: ${job.id})`);
          throw error;
        }
      }
    });

    logger.info({ jobName }, 'Subscribed to job queue');
  }

  /**
   * Schedules a recurring job with a cron expression (worker mode).
   *
   * @param jobName - Name of the scheduled job
   * @param cronExpression - Cron expression (e.g., "0 2 * * *" for daily at 2 AM)
   * @param handler - Function to handle the scheduled job
   * @throws Error if service not started
   */
  async schedule<T = any>(jobName: string, cronExpression: string, handler: JobHandler<T>, data?: T): Promise<void> {
    if (!this.started || !this.boss) {
      throw new Error('JobQueueService not started. Call start() first.');
    }

    // Register the handler for this job
    await this.subscribe(jobName, handler);

    // Schedule the job with cron expression
    await this.boss.schedule(jobName, cronExpression, data || {} as T);
    logger.info({ jobName, cronExpression }, 'Scheduled job');
  }

  /**
   * Reads aggregate job counts for a fixed set of queues.
   *
   * Queries `pgboss.job` directly rather than through pg-boss's API: the
   * library exposes no batched multi-queue count, and there is deliberately no
   * Sequelize entity for a schema the library owns and migrates.
   *
   * The SQL is a static string; both the queue-name list and the failed-job
   * cutoff are bind parameters, per the raw-SQL contract (scripts/check-raw-sql.ts).
   * Only aggregate counts are selected — never a job id, payload, or error.
   *
   * Does not depend on `start()`: it opens its own short-lived connection, so
   * the web process can read queue health without owning a pg-boss instance.
   *
   * @param queueNames - Queues to report on. A statically enumerated set from
   *   the caller; never derived from user data or per-entity values.
   * @param failedSince - Lower bound for counting failed jobs. pg-boss deletes
   *   jobs a day after creation, so a window wider than that reports nothing
   *   extra.
   * @returns One entry per queue that has at least one job row. A queue with
   *   no rows is absent from the result; the caller decides whether that means
   *   zero or unknown.
   * @throws Error if the deployment is not PostgreSQL-backed, or the query fails
   */
  async getQueueStats(queueNames: string[], failedSince: Date): Promise<QueueJobStats[]> {
    if (this.dialect === 'sqlite') {
      throw new Error('Queue statistics require a PostgreSQL-backed pg-boss installation');
    }

    const client = new Client(this.connectionString);

    try {
      await client.connect();

      // Distinct name from `ensureQueue`'s local: the raw-SQL guard resolves a
      // one-hop const binding and fails closed when the identifier is declared
      // more than once in a file.
      const queueStatsQuery = `
        SELECT name,
               COUNT(*) FILTER (WHERE state IN ('created', 'retry', 'active')) AS depth,
               COUNT(*) FILTER (WHERE state = 'failed' AND created_on >= $2) AS failed
        FROM pgboss.job
        WHERE name = ANY($1::text[])
        GROUP BY name;
      `;

      const result = await client.query(queueStatsQuery, [queueNames, failedSince]);

      return result.rows.map((row: { name: string, depth: string | number, failed: string | number }) => ({
        queue: row.name,
        // COUNT() comes back as a BIGINT string from the pg driver.
        depth: Number(row.depth),
        failed: Number(row.failed),
      }));
    }
    finally {
      await client.end();
    }
  }

  /**
   * Checks if the service is started and ready.
   *
   * @returns true if started, false otherwise
   */
  isStarted(): boolean {
    return this.started;
  }
}
