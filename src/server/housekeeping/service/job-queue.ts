import PgBoss from 'pg-boss';
import config from 'config';
import { Client } from 'pg';

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
 * Job handler function type
 */
export type JobHandler<T = any> = (data: T) => Promise<void>;

/**
 * Job queue service using pg-boss for PostgreSQL-native job scheduling.
 *
 * Provides methods for publishing jobs (web mode), subscribing to jobs (worker mode),
 * and scheduling recurring jobs with cron expressions.
 */
export default class JobQueueService {
  private boss: PgBoss | null = null;
  private connectionString: string;
  private started: boolean = false;

  /**
   * Creates a new JobQueueService instance.
   *
   * @param dbConfig - Database configuration object (optional, defaults to config library)
   */
  constructor(dbConfig?: DatabaseConfig) {
    const actualConfig = dbConfig || config.get<DatabaseConfig>('database');
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

    const user = dbConfig.user || dbConfig.username || 'postgres';
    const password = dbConfig.password || '';
    const host = dbConfig.host || 'localhost';
    const port = dbConfig.port || 5432;
    const database = dbConfig.database || 'pavillion';

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
        console.error('pg-boss error:', error);
      });

      await this.boss.start();
      this.started = true;
      console.log('[JobQueue] pg-boss connected and started');
    }
    catch (error) {
      console.error('Failed to start pg-boss:', error);
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
      console.log('[JobQueue] pg-boss stopped');
    }
  }

  /**
   * Publishes a job to the queue (web mode).
   *
   * @param jobName - Name of the job queue
   * @param data - Job data to pass to the handler
   * @returns Job ID
   * @throws Error if service not started
   */
  async publish<T = any>(jobName: string, data: T): Promise<string | null> {
    if (!this.started || !this.boss) {
      throw new Error('JobQueueService not started. Call start() first.');
    }

    const jobId = await this.boss.send(jobName, data);
    console.log(`[JobQueue] Published job ${jobName} with ID ${jobId}`);
    return jobId;
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
        console.log(`[JobQueue] Created queue: ${queueName}`);
      }
      else {
        console.log(`[JobQueue] Queue already exists: ${queueName}`);
      }
    }
    catch (error) {
      console.error(`[JobQueue] Failed to create queue ${queueName}:`, error);
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

    await this.boss.work(jobName, async (job) => {
      try {
        console.log(`[JobQueue] Processing job ${jobName} (ID: ${job.id})`);
        await handler(job.data);
        console.log(`[JobQueue] Completed job ${jobName} (ID: ${job.id})`);
      }
      catch (error) {
        console.error(`[JobQueue] Error processing job ${jobName} (ID: ${job.id}):`, error);
        throw error;
      }
    });

    console.log(`[JobQueue] Subscribed to ${jobName}`);
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
    console.log(`[JobQueue] Scheduled ${jobName} with cron: ${cronExpression}`);
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
