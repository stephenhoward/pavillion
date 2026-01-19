import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import * as fs from 'fs';
import HousekeepingStatusRoutes from '@/server/housekeeping/api/v1/status';
import HousekeepingInterface from '@/server/housekeeping/interface';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import DiskMonitorService from '@/server/housekeeping/service/disk-monitor';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import { Account } from '@/common/model/account';
import ExpressHelper from '@/server/common/helper/express';

describe('Housekeeping Dashboard Status', () => {
  let sandbox: sinon.SinonSandbox;
  let emailInterface: EmailInterface;
  let accountsInterface: AccountsInterface;
  let housekeepingInterface: HousekeepingInterface;
  const testBackupPath = '/tmp/pavillion-test-backups';

  // Helper to create app with auth middleware
  function createAppWithAuth(isAdmin: boolean = true) {
    const testApp = express();
    testApp.use(express.json());

    // Add auth middleware BEFORE routes
    testApp.use((req, res, next) => {
      req.user = { id: isAdmin ? 'admin-id' : 'user-id', isAdmin } as unknown as Account;
      next();
    });

    // Install routes after auth middleware
    const routes = new HousekeepingStatusRoutes(housekeepingInterface);
    routes.installHandlers(testApp, '/api/v1/admin/housekeeping');

    return testApp;
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Stub ExpressHelper.adminOnly to avoid Passport JWT dependency
    sandbox.stub(ExpressHelper, 'adminOnly').value([
      (req: any, res: any, next: any) => {
        if (req.user && req.user.isAdmin) {
          next();
        }
        else {
          res.status(403).json({ error: 'Forbidden' });
        }
      },
    ]);

    // Ensure backup directory exists for testing
    if (!fs.existsSync(testBackupPath)) {
      fs.mkdirSync(testBackupPath, { recursive: true });
    }

    // Create email interface stub
    emailInterface = {
      sendMail: sandbox.stub(),
    } as unknown as EmailInterface;

    // Create accounts interface stub
    accountsInterface = new AccountsInterface();

    // Create housekeeping interface
    housekeepingInterface = new HousekeepingInterface(emailInterface, accountsInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('GET /api/v1/admin/housekeeping/status', () => {
    it('should return backup status data', async () => {
      // Stub BackupEntity to return mock backup
      const mockBackup = {
        id: 'test-id',
        filename: 'pavillion_20260113_020000_scheduled.dump',
        size_bytes: 1024000,
        created_at: new Date('2026-01-13T02:00:00Z'),
        type: 'scheduled',
        category: 'daily',
        verified: true,
        storage_location: '/backups',
      };

      sandbox.stub(BackupEntity, 'findOne').resolves(mockBackup as any);
      sandbox.stub(BackupEntity, 'count').resolves(5);

      // Stub DiskMonitorService to avoid filesystem access
      sandbox.stub(DiskMonitorService.prototype, 'checkDiskUsage').resolves({
        totalBytes: BigInt(100000000000),
        usedBytes: BigInt(50000000000),
        freeBytes: BigInt(50000000000),
        percentageUsed: 50.0,
        path: '/backups',
      });

      // Create app with admin auth
      const testApp = createAppWithAuth(true);

      const response = await request(testApp)
        .get('/api/v1/admin/housekeeping/status')
        .expect(200);

      expect(response.body).toHaveProperty('lastBackup');
      expect(response.body.lastBackup).toEqual({
        date: '2026-01-13T02:00:00.000Z',
        size: 1024000,
        type: 'scheduled',
      });
    });

    it('should return disk usage data', async () => {
      // Stub BackupEntity
      sandbox.stub(BackupEntity, 'findOne').resolves(null);
      sandbox.stub(BackupEntity, 'count').resolves(0);

      // Stub DiskMonitorService
      const diskMonitorStub = sandbox.stub(DiskMonitorService.prototype, 'checkDiskUsage');
      diskMonitorStub.resolves({
        totalBytes: BigInt(100000000000), // 100 GB
        usedBytes: BigInt(75000000000),   // 75 GB
        freeBytes: BigInt(25000000000),   // 25 GB
        percentageUsed: 75.0,
        path: '/backups',
      });

      // Create app with admin auth
      const testApp = createAppWithAuth(true);

      const response = await request(testApp)
        .get('/api/v1/admin/housekeeping/status')
        .expect(200);

      expect(response.body).toHaveProperty('diskUsage');
      expect(response.body.diskUsage).toEqual({
        percentageUsed: 75.0,
        totalBytes: '100000000000',
        freeBytes: '25000000000',
      });
    });

    it('should require admin authentication', async () => {
      // Stub BackupEntity
      sandbox.stub(BackupEntity, 'findOne').resolves(null);
      sandbox.stub(BackupEntity, 'count').resolves(0);

      // Stub DiskMonitorService
      sandbox.stub(DiskMonitorService.prototype, 'checkDiskUsage').resolves({
        totalBytes: BigInt(100000000000),
        usedBytes: BigInt(50000000000),
        freeBytes: BigInt(50000000000),
        percentageUsed: 50.0,
        path: '/backups',
      });

      // Create app with non-admin user
      const testApp = createAppWithAuth(false);

      const response = await request(testApp)
        .get('/api/v1/admin/housekeeping/status')
        .expect(403);

      expect(response.body).toHaveProperty('error');
    });

    it('should show alert state when threshold exceeded', async () => {
      // Stub BackupEntity
      sandbox.stub(BackupEntity, 'findOne').resolves(null);
      sandbox.stub(BackupEntity, 'count').resolves(0);

      // Stub DiskMonitorService with high usage
      const diskMonitorStub = sandbox.stub(DiskMonitorService.prototype, 'checkDiskUsage');
      diskMonitorStub.resolves({
        totalBytes: BigInt(100000000000),
        usedBytes: BigInt(85000000000),   // 85% used - warning level
        freeBytes: BigInt(15000000000),
        percentageUsed: 85.0,
        path: '/backups',
      });

      // Create app with admin auth
      const testApp = createAppWithAuth(true);

      const response = await request(testApp)
        .get('/api/v1/admin/housekeeping/status')
        .expect(200);

      expect(response.body).toHaveProperty('alerts');
      expect(response.body.alerts).toContain('warning');
      expect(response.body.diskUsage.percentageUsed).toBe(85.0);
    });

    it('should show critical alert when critical threshold exceeded', async () => {
      // Stub BackupEntity
      sandbox.stub(BackupEntity, 'findOne').resolves(null);
      sandbox.stub(BackupEntity, 'count').resolves(0);

      // Stub DiskMonitorService with critical usage
      const diskMonitorStub = sandbox.stub(DiskMonitorService.prototype, 'checkDiskUsage');
      diskMonitorStub.resolves({
        totalBytes: BigInt(100000000000),
        usedBytes: BigInt(92000000000),   // 92% used - critical level
        freeBytes: BigInt(8000000000),
        percentageUsed: 92.0,
        path: '/backups',
      });

      // Create app with admin auth
      const testApp = createAppWithAuth(true);

      const response = await request(testApp)
        .get('/api/v1/admin/housekeeping/status')
        .expect(200);

      expect(response.body).toHaveProperty('alerts');
      expect(response.body.alerts).toContain('critical');
      expect(response.body.diskUsage.percentageUsed).toBe(92.0);
    });

    it('should return next scheduled backup time', async () => {
      // Stub BackupEntity
      sandbox.stub(BackupEntity, 'findOne').resolves(null);
      sandbox.stub(BackupEntity, 'count').resolves(0);

      // Stub DiskMonitorService
      sandbox.stub(DiskMonitorService.prototype, 'checkDiskUsage').resolves({
        totalBytes: BigInt(100000000000),
        usedBytes: BigInt(50000000000),
        freeBytes: BigInt(50000000000),
        percentageUsed: 50.0,
        path: '/backups',
      });

      // Create app with admin auth
      const testApp = createAppWithAuth(true);

      const response = await request(testApp)
        .get('/api/v1/admin/housekeeping/status')
        .expect(200);

      expect(response.body).toHaveProperty('nextBackup');
      // Should be a valid ISO date string
      if (response.body.nextBackup) {
        expect(() => new Date(response.body.nextBackup)).not.toThrow();
      }
    });
  });
});
