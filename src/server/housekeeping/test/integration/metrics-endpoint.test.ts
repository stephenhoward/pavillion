import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { v4 as uuidv4 } from 'uuid';

import db from '@/server/common/entity/db';
import EmailInterface from '@/server/email/interface';
import AccountsInterface from '@/server/accounts/interface';
import HousekeepingInterface from '@/server/housekeeping/interface';
import MetricsRoutes, { METRICS_CONTENT_TYPE } from '@/server/housekeeping/api/metrics';
import { BackupEntity } from '@/server/housekeeping/entity/backup';
import { DiskUsageSnapshotEntity } from '@/server/housekeeping/entity/disk-snapshot';
import DiskSnapshotService, { BACKUP_PATH_STAT_KEY } from '@/server/housekeeping/service/disk-snapshot';

/**
 * End-to-end coverage of the metrics listener: a real HTTP server, a real
 * HousekeepingInterface, and a real database behind it.
 *
 * The listener runs on an ephemeral port here. In a deployment it runs on its
 * own configured port that docker-compose.yml does not publish — see
 * docker-config.test.ts for the assertion that keeps it unpublished.
 */
describe('Operational metrics endpoint', () => {
  let server: Server;
  let baseUrl: string;
  let housekeepingInterface: HousekeepingInterface;

  const backupCreatedAt = new Date('2026-08-30T02:00:00.000Z');
  const snapshotWrittenAt = new Date('2026-08-31T09:00:00.000Z');

  /** Parses an exposition document into its sample lines. */
  function samples(document: string): Record<string, number> {
    const parsed: Record<string, number> = {};
    for (const line of document.split('\n')) {
      if (line === '' || line.startsWith('#')) continue;
      const separator = line.lastIndexOf(' ');
      parsed[line.slice(0, separator)] = Number(line.slice(separator + 1));
    }
    return parsed;
  }

  beforeAll(async () => {
    await db.sync({ force: true });

    housekeepingInterface = new HousekeepingInterface(new EmailInterface(), new AccountsInterface());
    // Zero TTL: each test observes the state it just seeded. The cache itself
    // is covered separately below.
    server = new MetricsRoutes(housekeepingInterface, 0).createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    await BackupEntity.destroy({ where: {}, truncate: true });
    await DiskUsageSnapshotEntity.destroy({ where: {}, truncate: true });
  });

  /** Seeds the two data sources this environment can actually populate. */
  async function seedHousekeepingData() {
    await BackupEntity.create({
      id: uuidv4(),
      filename: 'pavillion-2026-08-30.sql.gz',
      size_bytes: 5242880,
      created_at: backupCreatedAt,
      type: 'scheduled',
      category: 'daily',
      verified: true,
      storage_location: '/backups/pavillion-2026-08-30.sql.gz',
    });

    await new DiskSnapshotService().recordSnapshot(
      BACKUP_PATH_STAT_KEY,
      {
        totalBytes: BigInt(1000), usedBytes: BigInt(400), freeBytes: BigInt(600),
        percentageUsed: 40, path: '/backups',
      },
      snapshotWrittenAt,
    );
  }

  it('serves an OpenMetrics document with the OpenMetrics content type', async () => {
    await seedHousekeepingData();

    const response = await fetch(`${baseUrl}/metrics`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(METRICS_CONTENT_TYPE);
    expect(body.endsWith('# EOF\n')).toBe(true);
  });

  it('reports values that agree with the admin status payload', async () => {
    await seedHousekeepingData();

    const status = await housekeepingInterface.getStatus();
    const parsed = samples(await (await fetch(`${baseUrl}/metrics`)).text());

    expect(parsed['pavillion_backup_last_success_size_bytes']).toBe(status.lastBackup!.size);
    expect(parsed['pavillion_backup_last_success_timestamp_seconds'])
      .toBe(Math.floor(Date.parse(status.lastBackup!.date) / 1000));
  });

  it('exposes the worker snapshot values and the snapshot write time', async () => {
    await seedHousekeepingData();

    const parsed = samples(await (await fetch(`${baseUrl}/metrics`)).text());

    expect(parsed['pavillion_backup_volume_total_bytes']).toBe(1000);
    expect(parsed['pavillion_backup_volume_free_bytes']).toBe(600);
    expect(parsed['pavillion_backup_volume_used_bytes']).toBe(400);
    expect(parsed['pavillion_disk_snapshot_timestamp_seconds'])
      .toBe(Math.floor(snapshotWrittenAt.getTime() / 1000));
  });

  it('omits series for data that does not exist yet', async () => {
    const body = await (await fetch(`${baseUrl}/metrics`)).text();

    expect(body).not.toContain('pavillion_backup_last_success_timestamp_seconds');
    expect(body).not.toContain('pavillion_backup_volume_total_bytes');
    // The document stays well formed with nothing in it.
    expect(body).toBe('# EOF\n');
  });

  it('keeps sibling series when one source has no data', async () => {
    await BackupEntity.create({
      id: uuidv4(),
      filename: 'pavillion-2026-08-30.sql.gz',
      size_bytes: 99,
      created_at: backupCreatedAt,
      type: 'scheduled',
      category: 'daily',
      verified: true,
      storage_location: '/backups/pavillion-2026-08-30.sql.gz',
    });

    const parsed = samples(await (await fetch(`${baseUrl}/metrics`)).text());

    // No worker snapshot exists, but the backup series still reports.
    expect(parsed['pavillion_backup_volume_total_bytes']).toBeUndefined();
    expect(parsed['pavillion_backup_last_success_size_bytes']).toBe(99);
  });

  it('answers HEAD with the same headers and no body', async () => {
    await seedHousekeepingData();

    const response = await fetch(`${baseUrl}/metrics`, { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(METRICS_CONTENT_TYPE);
    expect(await response.text()).toBe('');
  });

  it('rejects methods other than GET and HEAD', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = await fetch(`${baseUrl}/metrics`, { method });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET, HEAD');
    }
  });

  it('sends no CORS headers, so a cross-origin page cannot read it', async () => {
    const response = await fetch(`${baseUrl}/metrics`, { headers: { Origin: 'https://evil.example' } });

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('serves nothing on any other path', async () => {
    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('pavillion_');
  });

  it('returns a generic 500 with no internal detail when collection fails', async () => {
    const failing = {
      getOperationalMetrics: async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.5:5432 as pavillion_admin');
      },
    } as unknown as HousekeepingInterface;

    const failingServer = new MetricsRoutes(failing, 0).createServer();
    await new Promise<void>((resolve) => failingServer.listen(0, '127.0.0.1', resolve));
    const port = (failingServer.address() as AddressInfo).port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/metrics`);
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(body).toBe('Internal Server Error\n');
      expect(body).not.toContain('ECONNREFUSED');
      expect(body).not.toContain('pavillion_admin');
    }
    finally {
      await new Promise<void>((resolve) => failingServer.close(() => resolve()));
    }
  });

  it('serves a cached render within the TTL rather than re-querying', async () => {
    let collections = 0;
    const counting = {
      getOperationalMetrics: async () => {
        collections++;
        return { backup: null, backupVolume: null, databaseSizeBytes: 1, mediaVolume: null, queues: null };
      },
    } as unknown as HousekeepingInterface;

    const cachedServer = new MetricsRoutes(counting, 10_000).createServer();
    await new Promise<void>((resolve) => cachedServer.listen(0, '127.0.0.1', resolve));
    const port = (cachedServer.address() as AddressInfo).port;

    try {
      await fetch(`http://127.0.0.1:${port}/metrics`);
      await fetch(`http://127.0.0.1:${port}/metrics`);
      await fetch(`http://127.0.0.1:${port}/metrics`);

      expect(collections).toBe(1);
    }
    finally {
      await new Promise<void>((resolve) => cachedServer.close(() => resolve()));
    }
  });
});
