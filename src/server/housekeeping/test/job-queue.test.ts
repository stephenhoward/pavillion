import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

      expect(PgBoss.prototype.work).toHaveBeenCalledWith('backup:create', expect.any(Function));
    });

    it('should execute handler when job is received', async () => {
      await service.start();
      const handler = vi.fn().mockResolvedValue(undefined);
      let jobHandler: ((job: any) => Promise<void>) | undefined;

      // Capture the handler function passed to work()
      (PgBoss.prototype.work as any).mockImplementation(async (_name: string, fn: any) => {
        jobHandler = fn;
        return 'worker-id';
      });

      await service.subscribe('backup:create', handler);

      // Simulate pg-boss calling the handler with a job
      const mockJob = { id: 'job-1', data: { type: 'manual' } };
      if (jobHandler) {
        await jobHandler(mockJob);
      }

      expect(handler).toHaveBeenCalledWith(mockJob.data);
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
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('Connection failed');

      (PgBoss.prototype.start as any).mockRejectedValue(error);

      await expect(service.start()).rejects.toThrow('Connection failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to start pg-boss:', error);

      consoleErrorSpy.mockRestore();
    });

    it('should register error event handler', async () => {
      await service.start();

      expect(PgBoss.prototype.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });
});
