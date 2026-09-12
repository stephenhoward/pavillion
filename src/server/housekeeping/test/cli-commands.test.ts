import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import sinon from 'sinon';
import HousekeepingInterface from '@/server/housekeeping/interface';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import JobQueueService from '@/server/housekeeping/service/job-queue';
import StorageService from '@/server/housekeeping/service/storage';
import DrillService from '@/server/housekeeping/service/drill';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import { BackupDrillEntity } from '@/server/housekeeping/entity/drill';

/**
 * CLI Commands Test Suite
 *
 * Exercises the HousekeepingInterface methods the management CLI relies on.
 * The CLI (src/server/cli/index.ts) routes every backup / job-queue operation
 * through this interface rather than reaching into housekeeping services or
 * entities directly (DEC-003 domain boundary), so these tests stand in for the
 * CLI command logic without spawning a process.
 */
describe('CLI Commands (HousekeepingInterface)', () => {
  let sandbox: sinon.SinonSandbox;
  let housekeeping: HousekeepingInterface;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const emailInterface = { sendMail: sandbox.stub() } as unknown as EmailInterface;
    const accountsInterface = new AccountsInterface();
    housekeeping = new HousekeepingInterface(emailInterface, accountsInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('backup create command', () => {
    it('should queue backup:create job through a self-managed queue', async () => {
      const startStub = sandbox.stub(JobQueueService.prototype, 'start').resolves();
      const stopStub = sandbox.stub(JobQueueService.prototype, 'stop').resolves();
      const publishStub = sandbox.stub(JobQueueService.prototype, 'publish').resolves('job-123');

      const jobId = await housekeeping.queueManualBackup();

      expect(jobId).toBe('job-123');
      expect(publishStub.calledOnce).toBe(true);
      expect(publishStub.firstCall.args[0]).toBe('backup:create');
      expect(publishStub.firstCall.args[1]).toEqual({ type: 'manual' });
      // Queue lifecycle is owned by the interface, not the CLI.
      expect(startStub.calledOnce).toBe(true);
      expect(stopStub.calledOnce).toBe(true);
    });

    it('should stop the queue even when publishing fails', async () => {
      sandbox.stub(JobQueueService.prototype, 'start').resolves();
      const stopStub = sandbox.stub(JobQueueService.prototype, 'stop').resolves();
      sandbox.stub(JobQueueService.prototype, 'publish').rejects(new Error('boom'));

      await expect(housekeeping.queueManualBackup()).rejects.toThrow('boom');
      expect(stopStub.calledOnce).toBe(true);
    });
  });

  describe('backup list command', () => {
    it('should project backup entities onto boundary-safe records', async () => {
      const mockBackups = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          filename: 'pavillion_20260112_140530_manual.dump',
          size_bytes: 1024000,
          created_at: new Date('2026-01-12T14:05:30Z'),
          type: 'manual' as const,
          category: 'daily' as const,
          verified: true,
          storage_location: '/backups',
        },
        {
          id: '223e4567-e89b-12d3-a456-426614174001',
          filename: 'pavillion_20260111_020000_scheduled.dump',
          size_bytes: 2048000,
          created_at: new Date('2026-01-11T02:00:00Z'),
          type: 'scheduled' as const,
          category: 'weekly' as const,
          verified: true,
          storage_location: '/backups',
        },
      ] as BackupEntity[];

      sandbox.stub(StorageService.prototype, 'listBackups').resolves(mockBackups);

      const backups = await housekeeping.listBackups();

      expect(backups).toHaveLength(2);
      expect(backups[0]).toEqual({
        id: '123e4567-e89b-12d3-a456-426614174000',
        filename: 'pavillion_20260112_140530_manual.dump',
        sizeBytes: 1024000,
        createdAt: new Date('2026-01-12T14:05:30Z'),
        type: 'manual',
        category: 'daily',
        verified: true,
        storageLocation: '/backups',
      });
      expect(backups[1].category).toBe('weekly');
    });

    it('should return an empty array when no backups exist', async () => {
      sandbox.stub(StorageService.prototype, 'listBackups').resolves([]);

      const backups = await housekeeping.listBackups();

      expect(backups).toHaveLength(0);
    });
  });

  describe('backup status command', () => {
    it('should expose storage statistics', async () => {
      const mockStats = {
        totalSize: 10485760,
        count: 5,
        freeSpace: 50000000000,
        totalSpace: 100000000000,
        freeSpacePercent: 50,
      };

      sandbox.stub(StorageService.prototype, 'getStorageStats').resolves(mockStats);

      const stats = await housekeeping.getStorageStats();

      expect(stats.count).toBe(5);
      expect(stats.freeSpacePercent).toBe(50);
      expect(stats.totalSize).toBe(10485760);
    });

    it('should retrieve the last verified backup as a record', async () => {
      const mockBackup = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        filename: 'pavillion_20260112_140530_manual.dump',
        size_bytes: 1024000,
        created_at: new Date('2026-01-12T14:05:30Z'),
        type: 'manual' as const,
        category: 'daily' as const,
        verified: true,
        storage_location: '/backups',
      } as BackupEntity;

      const findOneStub = sandbox.stub(BackupEntity, 'findOne').resolves(mockBackup);

      const lastBackup = await housekeeping.getLastVerifiedBackup();

      expect(lastBackup).not.toBeNull();
      expect(lastBackup!.verified).toBe(true);
      expect(lastBackup!.sizeBytes).toBe(1024000);
      // Only verified backups are considered, newest first.
      expect(findOneStub.firstCall.args[0]).toEqual({
        where: { verified: true },
        order: [['created_at', 'DESC']],
      });
    });

    it('should return null when no verified backup exists', async () => {
      sandbox.stub(BackupEntity, 'findOne').resolves(null);

      const lastBackup = await housekeeping.getLastVerifiedBackup();

      expect(lastBackup).toBeNull();
    });
  });

  describe('backup record-drill command', () => {
    it('should record a drill outcome through the domain boundary', async () => {
      const recordStub = sandbox.stub(DrillService.prototype, 'recordResult').resolves();

      await housekeeping.recordDrillResult({
        backupFilename: 'pavillion_20260901_020000_scheduled.dump',
        passed: false,
        detail: 'pg_restore failed',
      });

      expect(recordStub.calledOnce).toBe(true);
      expect(recordStub.firstCall.args[0]).toEqual({
        backupFilename: 'pavillion_20260901_020000_scheduled.dump',
        passed: false,
        detail: 'pg_restore failed',
      });
    });

    it('should project a drill entity onto a boundary-safe record', async () => {
      sandbox.stub(BackupDrillEntity, 'findOne').resolves(
        BackupDrillEntity.build({
          id: '323e4567-e89b-12d3-a456-426614174002',
          backup_filename: 'pavillion_20260901_020000_scheduled.dump',
          ran_at: new Date('2026-09-01T03:00:00Z'),
          passed: true,
          detail: null,
        }),
      );

      const drill = await housekeeping.getLastSuccessfulDrill();

      // camelCase out of a snake_case entity, as toBackupRecord does above.
      expect(drill).toEqual({
        id: '323e4567-e89b-12d3-a456-426614174002',
        backupFilename: 'pavillion_20260901_020000_scheduled.dump',
        ranAt: new Date('2026-09-01T03:00:00Z'),
        passed: true,
        detail: null,
      });
    });

    it('should return null when no drill has ever passed', async () => {
      sandbox.stub(BackupDrillEntity, 'findOne').resolves(null);

      expect(await housekeeping.getLastSuccessfulDrill()).toBeNull();
    });

    /**
     * The one test in this file that spawns the CLI.
     *
     * The `--result` allowlist lives in handleBackupRecordDrill, above the
     * interface — commander accepts any string for `--result <result>`, so the
     * guard is the only thing between a typo and a drill stored under a third
     * verdict. Every other test here calls HousekeepingInterface directly, which
     * is deliberately the wrong side of that guard: `passed: options.result ===
     * 'pass'` means an unrecognised word would silently record as a FAILED
     * drill, and a run of those reads as "restores are broken" rather than "the
     * caller is broken". Exercising that needs the real argv path, and the
     * module runs main() on import, so it has to be a process.
     *
     * It is also cheap to keep honest: the rejection happens before
     * initDatabase, so nothing here touches a database — asserted below, because
     * a guard that fired after the connection was open would be a different
     * (and worse) guard.
     */
    it('should reject a verdict that is neither pass nor fail, before touching the database', async () => {
      const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
        (resolve) => {
          execFile(
            path.join(repoRoot, 'node_modules', '.bin', 'tsx'),
            [
              path.join('src', 'server', 'cli', 'index.ts'),
              'backup', 'record-drill',
              '--file', 'pavillion_20260901_020000_scheduled.dump',
              '--result', 'maybe',
            ],
            { cwd: repoRoot },
            (error, stdout, stderr) => {
              resolve({
                code: error ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? 1) as number : 0,
                stdout,
                stderr,
              });
            },
          );
        },
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("--result must be 'pass' or 'fail'");
      expect(result.stderr).toContain('maybe');
      // No connection was opened, so no row could have been written.
      expect(result.stdout).not.toContain('Database connected');
      expect(result.stdout).not.toContain('Recorded');
    }, 60000);
  });

  describe('backup restore command', () => {
    it('should retrieve a single backup record by id', async () => {
      const mockBackup = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        filename: 'pavillion_20260112_140530_manual.dump',
        size_bytes: 1024000,
        created_at: new Date('2026-01-12T14:05:30Z'),
        type: 'manual' as const,
        category: 'daily' as const,
        verified: true,
        storage_location: '/backups',
      } as BackupEntity;

      sandbox.stub(StorageService.prototype, 'getBackup').resolves(mockBackup);

      const backup = await housekeeping.getBackup('123e4567-e89b-12d3-a456-426614174000');

      expect(backup).not.toBeNull();
      expect(backup!.id).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(backup!.verified).toBe(true);
      expect(backup!.storageLocation).toBe('/backups');
    });

    it('should return null when the backup id is unknown', async () => {
      sandbox.stub(StorageService.prototype, 'getBackup').resolves(null);

      const backup = await housekeeping.getBackup('missing-id');

      expect(backup).toBeNull();
    });
  });
});
