import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { AddressInfo } from 'net';
import { Server } from 'http';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';

import db from '@/server/common/entity/db';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import ExpressHelper from '@/server/common/helper/express';
import { Account } from '@/common/model/account';
import HousekeepingInterface from '@/server/housekeeping/interface';
import HousekeepingStatusRoutes from '@/server/housekeeping/api/v1/status';
import MetricsRoutes from '@/server/housekeeping/api/metrics';
import { DiskUsageSnapshotEntity } from '@/server/housekeeping/entity/disk-snapshot';
import DiskSnapshotService, { BACKUP_PATH_STAT_KEY } from '@/server/housekeeping/service/disk-snapshot';

/**
 * Regression coverage for the admin dashboard's disk panel.
 *
 * In the production compose topology the backup volume is mounted into the
 * worker container only, so the web process's statfs of the backup path always
 * failed and the panel rendered "not configured" on every real deployment.
 * The panel now reads the worker-written snapshot — the same read path the
 * metrics endpoint uses, so the two cannot disagree.
 *
 * The statfs stub below rejects for exactly that reason: it reproduces the
 * unmounted-volume condition that used to blank the panel.
 */
describe('Admin status disk panel reads the worker snapshot', () => {
  let sandbox: sinon.SinonSandbox;
  let housekeepingInterface: HousekeepingInterface;
  let app: express.Application;
  let metricsServer: Server;
  let metricsUrl: string;

  beforeAll(async () => {
    await db.sync({ force: true });
  });

  afterAll(async () => {
    if (metricsServer) {
      await new Promise<void>((resolve) => metricsServer.close(() => resolve()));
    }
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    // The app container does not mount the backup volume.
    sandbox.stub(fs, 'statfs').rejects(new Error('ENOENT: no such file or directory, statfs \'/backups\''));

    sandbox.stub(ExpressHelper, 'adminOnly').value([
      (req: any, _res: any, next: any) => {
        req.user = { id: 'admin-id', isAdmin: true } as unknown as Account;
        next();
      },
    ]);

    await DiskUsageSnapshotEntity.destroy({ where: {}, truncate: true });

    housekeepingInterface = new HousekeepingInterface(new EmailInterface(), new AccountsInterface());

    app = express();
    new HousekeepingStatusRoutes(housekeepingInterface).installHandlers(app, '/api/v1/admin/housekeeping');

    metricsServer = new MetricsRoutes(housekeepingInterface, 0).createServer();
    await new Promise<void>((resolve) => metricsServer.listen(0, '127.0.0.1', resolve));
    metricsUrl = `http://127.0.0.1:${(metricsServer.address() as AddressInfo).port}/metrics`;
  });

  afterEach(async () => {
    sandbox.restore();
    await new Promise<void>((resolve) => metricsServer.close(() => resolve()));
  });

  it('reports the snapshot values even though the backup path cannot be measured here', async () => {
    await new DiskSnapshotService().recordSnapshot(BACKUP_PATH_STAT_KEY, {
      totalBytes: BigInt(100000000000),
      usedBytes: BigInt(75000000000),
      freeBytes: BigInt(25000000000),
      percentageUsed: 75,
      path: '/backups',
    });

    const response = await request(app).get('/api/v1/admin/housekeeping/status').expect(200);

    expect(response.body.diskUsage).toEqual({
      percentageUsed: 75,
      totalBytes: '100000000000',
      freeBytes: '25000000000',
    });
    // The snapshot also drives the alert state the panel renders.
    expect(response.body.alerts).toContain('ok');
  });

  it('raises the disk alert from the snapshot value', async () => {
    await new DiskSnapshotService().recordSnapshot(BACKUP_PATH_STAT_KEY, {
      totalBytes: BigInt(100000000000),
      usedBytes: BigInt(92000000000),
      freeBytes: BigInt(8000000000),
      percentageUsed: 92,
      path: '/backups',
    });

    const response = await request(app).get('/api/v1/admin/housekeeping/status').expect(200);

    expect(response.body.alerts).toContain('critical');
  });

  it('reports null before the worker has written a snapshot', async () => {
    const response = await request(app).get('/api/v1/admin/housekeeping/status').expect(200);

    expect(response.body.diskUsage).toBeNull();
  });

  it('agrees with the metrics endpoint on the same underlying snapshot', async () => {
    await new DiskSnapshotService().recordSnapshot(BACKUP_PATH_STAT_KEY, {
      totalBytes: BigInt(100000000000),
      usedBytes: BigInt(75000000000),
      freeBytes: BigInt(25000000000),
      percentageUsed: 75,
      path: '/backups',
    });

    const status = await request(app).get('/api/v1/admin/housekeeping/status').expect(200);
    const exposition = await (await fetch(metricsUrl)).text();

    const series: Record<string, string> = {};
    for (const line of exposition.split('\n')) {
      if (line === '' || line.startsWith('#')) continue;
      const separator = line.lastIndexOf(' ');
      series[line.slice(0, separator)] = line.slice(separator + 1);
    }

    expect(series['pavillion_disk_total_bytes{volume="backups"}']).toBe(status.body.diskUsage.totalBytes);
    expect(series['pavillion_disk_free_bytes{volume="backups"}']).toBe(status.body.diskUsage.freeBytes);
  });
});
