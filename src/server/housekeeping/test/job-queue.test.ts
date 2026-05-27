import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parse as parseConnectionString } from 'pg-connection-string';
import JobQueueService from '@/server/housekeeping/service/job-queue';
import PgBoss from 'pg-boss';

// Mock pg-boss module
vi.mock('pg-boss', () => {
  const mockPgBoss = vi.fn();
  mockPgBoss.prototype.start = vi.fn();
  mockPgBoss.prototype.stop = vi.fn();
  mockPgBoss.prototype.send = vi.fn();
  mockPgBoss.prototype.work = vi.fn();
  mockPgBoss.prototype.schedule = vi.fn();
  mockPgBoss.prototype.on = vi.fn();
  return { default: mockPgBoss };
});

describe('JobQueueService', () => {
  let service: JobQueueService;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Set up default mock implementations
    (PgBoss.prototype.start as any).mockResolvedValue(undefined);
    (PgBoss.prototype.stop as any).mockResolvedValue(undefined);
    (PgBoss.prototype.send as any).mockResolvedValue('job-id-123');
    (PgBoss.prototype.work as any).mockResolvedValue('worker-id-123');
    (PgBoss.prototype.schedule as any).mockResolvedValue(undefined);
    (PgBoss.prototype.on as any).mockReturnValue(undefined);

    service = new JobQueueService({
      host: 'localhost',
      port: 5432,
      database: 'test_db',
      user: 'test_user',
      password: 'test_pass',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Connection and Lifecycle', () => {
    it('should connect to pg-boss and start successfully', async () => {
      await service.start();

      expect(PgBoss.prototype.start).toHaveBeenCalled();
      expect(service.isStarted()).toBe(true);
    });

    it('should disconnect from pg-boss gracefully', async () => {
      await service.start();
      await service.stop();

      expect(PgBoss.prototype.stop).toHaveBeenCalled();
      expect(service.isStarted()).toBe(false);
    });

    it('should handle connection restart', async () => {
      await service.start();
      await service.stop();
      await service.start();

      expect(PgBoss.prototype.start).toHaveBeenCalledTimes(2);
      expect(PgBoss.prototype.stop).toHaveBeenCalledTimes(1);
    });

    it('passes a connection string parseable by pg-connection-string when the password contains URL-special chars', async () => {
      const tricky = new JobQueueService({
        host: 'db',
        port: 5432,
        database: 'pavillion',
        user: 'pavillion',
        password: 'p@ss/word#1?two[three]',
      });
      await tricky.start();

      const cs = (PgBoss as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string;
      expect(typeof cs).toBe('string');

      // The whole point: this must not throw on a password full of URL-special chars.
      const parsed = parseConnectionString(cs);
      expect(parsed.user).toBe('pavillion');
      expect(parsed.password).toBe('p@ss/word#1?two[three]');
      expect(parsed.host).toBe('db');
      expect(parsed.port).toBe('5432');
      expect(parsed.database).toBe('pavillion');
    });
  });

  describe('Job Submission (publish)', () => {
    it('should publish a job to the queue from web mode', async () => {
      await service.start();
      const jobId = await service.publish('backup:create', { type: 'manual' });

      expect(PgBoss.prototype.send).toHaveBeenCalledWith('backup:create', { type: 'manual' });
      expect(jobId).toBe('job-id-123');
    });

    it('should throw error when publishing before start', async () => {
      await expect(
        service.publish('test:job', { data: 'test' }),
      ).rejects.toThrow('JobQueueService not started');
    });
  });

  describe('Job Processing (subscribe)', () => {
    it('should subscribe to a job queue in worker mode', async () => {
      await service.start();
      const handler = vi.fn().mockResolvedValue(undefined);

      await service.subscribe('backup:create', handler);

      expect(PgBoss.prototype.work).toHaveBeenCalledWith(
        'backup:create',
        { includeMetadata: true },
        expect.any(Function),
      );
    });

    it('should execute handler when job is received', async () => {
      await service.start();
      const handler = vi.fn().mockResolvedValue(undefined);
      let jobHandler: ((job: any) => Promise<void>) | undefined;

      // Capture the handler function passed to work()
      (PgBoss.prototype.work as any).mockImplementation(
        async (_name: string, _options: any, fn: any) => {
          jobHandler = fn;
          return 'worker-id';
        },
      );

      await service.subscribe('backup:create', handler);

      // Simulate pg-boss calling the handler with a job
      const mockJob = { id: 'job-1', data: { type: 'manual' }, retryCount: 0, retryLimit: 2 };
      if (jobHandler) {
        await jobHandler(mockJob);
      }

      expect(handler).toHaveBeenCalledWith(mockJob.data, { retryCount: 0, retryLimit: 2 });
    });

    it('should forward retryCount and retryLimit metadata to handlers that opt in', async () => {
      await service.start();
      let jobHandler: ((job: any) => Promise<void>) | undefined;

      (PgBoss.prototype.work as any).mockImplementation(
        async (_name: string, _options: any, fn: any) => {
          jobHandler = fn;
          return 'worker-id';
        },
      );

      const receivedMeta: { retryCount?: number; retryLimit?: number } = {};
      const handler = vi.fn(async (_data: any, meta?: { retryCount: number; retryLimit: number }) => {
        if (meta) {
          receivedMeta.retryCount = meta.retryCount;
          receivedMeta.retryLimit = meta.retryLimit;
        }
      });

      await service.subscribe('backup:create', handler);

      const mockJob = { id: 'job-1', data: { type: 'manual' }, retryCount: 1, retryLimit: 2 };
      if (jobHandler) {
        await jobHandler(mockJob);
      }

      expect(receivedMeta.retryCount).toBe(1);
      expect(receivedMeta.retryLimit).toBe(2);
    });

    it('should still pass data correctly to legacy single-argument handlers', async () => {
      await service.start();
      let jobHandler: ((job: any) => Promise<void>) | undefined;

      (PgBoss.prototype.work as any).mockImplementation(
        async (_name: string, _options: any, fn: any) => {
          jobHandler = fn;
          return 'worker-id';
        },
      );

      // Legacy handler declares only the data parameter — ignores the second arg
      let receivedData: any;
      const legacyHandler = vi.fn(async (data: any) => {
        receivedData = data;
      });

      await service.subscribe('backup:create', legacyHandler);

      const mockJob = { id: 'job-1', data: { type: 'manual' }, retryCount: 0, retryLimit: 2 };
      await expect(
        jobHandler ? jobHandler(mockJob) : Promise.resolve(),
      ).resolves.not.toThrow();

      expect(receivedData).toEqual({ type: 'manual' });
      expect(legacyHandler).toHaveBeenCalled();
    });

    it('should unwrap pg-boss v10+ job-array input and pass data to the handler', async () => {
      // Regression: pg-boss v10+ delivers an array of jobs (batchSize 1 by
      // default) to the work() handler instead of a single job. Reading
      // `.data` off the array yields undefined and downstream destructuring
      // throws — which is exactly how follow-backfill silently failed in
      // production until this iteration was added.
      await service.start();
      let jobHandler: ((jobs: any) => Promise<void>) | undefined;

      (PgBoss.prototype.work as any).mockImplementation(
        async (_name: string, _options: any, fn: any) => {
          jobHandler = fn;
          return 'worker-id';
        },
      );

      const handler = vi.fn().mockResolvedValue(undefined);
      await service.subscribe('activitypub:follow:backfill', handler);

      const arrayInput = [{ id: 'job-1', data: { followingCalendarId: 'cal-1' }, retryCount: 0, retryLimit: 2 }];
      if (jobHandler) {
        await jobHandler(arrayInput);
      }

      expect(handler).toHaveBeenCalledWith(
        { followingCalendarId: 'cal-1' },
        { retryCount: 0, retryLimit: 2 },
      );
    });

    it('should throw error when subscribing before start', async () => {
      const handler = vi.fn();
      await expect(
        service.subscribe('test:job', handler),
      ).rejects.toThrow('JobQueueService not started');
    });
  });

  describe('Scheduled Jobs (cron)', () => {
    it('should register a scheduled job with cron expression', async () => {
      await service.start();
      const handler = vi.fn().mockResolvedValue(undefined);

      await service.schedule('backup:daily', '0 2 * * *', handler);

      expect(PgBoss.prototype.work).toHaveBeenCalled();
      expect(PgBoss.prototype.schedule).toHaveBeenCalledWith('backup:daily', '0 2 * * *', {});
    });

    it('should throw error when scheduling before start', async () => {
      const handler = vi.fn();
      await expect(
        service.schedule('test:job', '0 * * * *', handler),
      ).rejects.toThrow('JobQueueService not started');
    });
  });

  describe('Error Handling', () => {
    it('should log connection errors gracefully', async () => {
      const error = new Error('Connection failed');

      (PgBoss.prototype.start as any).mockRejectedValue(error);

      await expect(service.start()).rejects.toThrow('Connection failed');
    });

    it('should register error event handler', async () => {
      await service.start();

      expect(PgBoss.prototype.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });
});
