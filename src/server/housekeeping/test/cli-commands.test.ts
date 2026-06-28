import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import HousekeepingInterface from '@/server/housekeeping/interface';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import JobQueueService from '@/server/housekeeping/service/job-queue';
import StorageService from '@/server/housekeeping/service/storage';
import { BackupEntity } from '@/server/housekeeping/entity/backup';

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
